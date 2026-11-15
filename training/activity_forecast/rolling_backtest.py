"""Development-only rolling weekly forecasts and a controlled grid-resolution comparison.

Does not load/replace the deployment model or read July 2025 test outcomes.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeRegressor

from training.activity_forecast.common import DATA

LAG = 3
HORIZON = 7
LEAF_SIZE = 500
EPS = 1e-6


def load_one_degree(manifest_path, destination):
    manifest = json.loads(Path(manifest_path).read_text())
    dates = pd.date_range(manifest['start'], manifest['end_exclusive'], inclusive='left')
    fingerprint = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    stamp = destination.with_suffix('.json')
    if destination.exists() and stamp.exists():
        metadata = json.loads(stamp.read_text())
        if metadata['manifest_sha256'] == fingerprint:
            with np.load(destination) as cached:
                return cached['hours'], pd.DatetimeIndex(cached['dates'])
    hours = np.zeros((180*360, len(dates)), dtype=np.float64)
    seen = set()
    for report in manifest['reports']:
        if report['status'] != 'complete':
            raise ValueError('Incomplete export cannot become zero activity')
        start, end = report['params']['date-range'].split(',')
        days = set(pd.date_range(start, end, inclusive='left'))
        if seen & days:
            raise ValueError('Overlapping source reports')
        seen |= days
        source = DATA/'raw'/report['file']
        with source.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != report['sha256']:
                raise ValueError('Source archive hash differs from manifest')
        with ZipFile(source) as archive:
            names = [name for name in archive.namelist() if name.endswith('.csv')]
            if len(names) != 1:
                raise ValueError('Expected one source CSV')
            with archive.open(names[0]) as stream:
                for frame in pd.read_csv(stream, usecols=['Lat','Lon','Time Range','Apparent Fishing Hours'], chunksize=250000):
                    lat, lon, values = [frame[c].to_numpy() for c in ('Lat','Lon','Apparent Fishing Hours')]
                    if not np.isfinite(np.column_stack([lat,lon,values])).all() or (abs(lat)>90).any() or (abs(lon)>180).any() or (values<0).any():
                        raise ValueError('Invalid source coordinates or hours')
                    source_dates = pd.to_datetime(frame['Time Range'])
                    if not source_dates.isin(days).all():
                        raise ValueError('Source row outside its complete report dates')
                    row = np.minimum(np.floor(lat+90).astype(int),179)
                    col = np.floor((lon+180)%360).astype(int)
                    day = (source_dates-dates[0]).dt.days.to_numpy()
                    np.add.at(hours, (row*360+col, day), values)
        print('Reaggregated', report['file'], flush=True)
    if seen != set(dates):
        raise ValueError('Source coverage has missing/extra days')
    destination.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(destination, hours=hours, dates=dates.to_numpy())
    stamp.write_text(json.dumps({'manifest_sha256':fingerprint,'dataset':manifest['dataset'],
        'grid_degrees':1,'shape':list(hours.shape),'start':str(dates[0].date()),
        'end':str(dates[-1].date()),'zero_meaning':'No activity reported in complete exports; no coverage assertion.'},indent=2)+'\n')
    return hours, dates


def aggregate_five(hours):
    return hours.reshape(36,5,72,5,hours.shape[1]).sum(axis=(1,3)).reshape(2592,hours.shape[1])


def rolling_sum(values, window):
    cumulative = np.column_stack([np.zeros(len(values)), np.cumsum(values, axis=1)])
    result = np.full_like(values, np.nan)
    result[:,window-1:] = cumulative[:,window:]-cumulative[:,:-window]
    return result


def make_rows(hours, dates, annual, annual_dates):
    # Computational sparsity only. Evaluation still includes quiet subcells via
    # an explicit last-week fallback; future activity never makes a row eligible.
    active = np.flatnonzero(hours.sum(axis=1)>0)
    current = hours[active]
    last7, month28 = rolling_sum(current,7), rolling_sum(current,28)
    cutoffs = np.arange(27, len(dates)-LAG-HORIZON)
    r, t = np.nonzero(month28[:,cutoffs]>0)
    day = cutoffs[t]
    cell = active[r]
    baseline = last7[r,day]
    month = month28[r,day]/28
    scale = np.maximum.reduce([baseline,month*7,np.ones(len(day))])
    target = sum(hours[cell,day+i] for i in range(LAG+1,LAG+HORIZON+1))
    prior = dates-pd.DateOffset(years=1)
    lookup = annual_dates.get_indexer(prior)
    def reference(offset):
        positions = lookup[day+offset]
        found = positions>=0
        value = np.full(len(day),np.nan)
        value[found] = annual[cell[found],positions[found]]
        return value
    previous_mean = sum(reference(-i) for i in range(28))/28
    previous_target = sum(reference(i) for i in range(LAG+1,LAG+HORIZON+1))
    available = np.isfinite(previous_mean)&np.isfinite(previous_target)&(previous_mean>0)
    growth = np.divide(month,previous_mean,out=np.ones(len(day)),where=available)
    seasonal = np.where(available,previous_target*np.clip(growth,0,5),baseline)
    recent = sum(hours[cell,day-i] for i in range(3))*7/3
    return {'cell':cell,'day':day,'baseline':baseline,'target':target,'scale':scale,
            'x':np.column_stack([(seasonal-baseline)/scale,(recent-baseline)/scale])}


def training_mask(days, issue_index):
    # Label availability = observation cutoff + lag + horizon + lag.
    return days+2*LAG+HORIZON < issue_index


def direction(values):
    return np.where(values>EPS,1,np.where(values < -EPS,-1,0))


def metrics(actual, prediction, baseline):
    errors = prediction-actual
    actual_change, predicted_change = actual-baseline, prediction-baseline
    k = max(1,int(np.ceil(len(actual)*.1)))
    actual_order = np.argsort(-actual_change,kind='stable')[:k]
    predicted_order = np.argsort(-predicted_change,kind='stable')[:k]
    observed = set(actual_order[actual_change[actual_order]>EPS])
    predicted = set(predicted_order[predicted_change[predicted_order]>EPS])
    intersection = len(observed & predicted)
    return {'mae_hours':float(np.abs(errors).mean()),'rmse_hours':float(np.sqrt((errors**2).mean())),
            'baseline_mae_hours':float(np.abs(actual-baseline).mean()),
            'baseline_rmse_hours':float(np.sqrt(((actual-baseline)**2).mean())),
            'directional_accuracy':float((direction(actual_change)==direction(predicted_change)).mean()),
            'baseline_directional_accuracy':float((direction(actual_change)==0).mean()),
            'regional_total_absolute_error_hours':float(abs(prediction.sum()-actual.sum())),
            'baseline_regional_total_absolute_error_hours':float(abs(baseline.sum()-actual.sum())),
            'spatial_top_decile_precision':intersection/len(predicted) if predicted else None,
            'spatial_top_decile_recall':intersection/len(observed) if observed else None,
            'spatial_top_decile_jaccard':intersection/len(predicted|observed) if predicted|observed else None,
            'actual_top_increase_cells':len(observed),'predicted_top_increase_cells':len(predicted)}


def summarize_folds(frame):
    summary = []
    for keys, group in frame.groupby(['region','grid_degrees','tree_depth']):
        weights = group.common_five_degree_cells.to_numpy()
        model_mae = float(np.average(group.mae_hours,weights=weights))
        base_mae = float(np.average(group.baseline_mae_hours,weights=weights))
        result = {'region':keys[0],'grid_degrees':int(keys[1]),'tree_depth':int(keys[2]),
            'folds':len(group),'common_five_degree_mae_hours':model_mae,'baseline_mae_hours':base_mae,
            'common_five_degree_rmse_hours':float(np.sqrt(np.average(group.rmse_hours**2,weights=weights))),
            'baseline_rmse_hours':float(np.sqrt(np.average(group.baseline_rmse_hours**2,weights=weights))),
            'mae_reduction_percent':100*(base_mae-model_mae)/base_mae if base_mae else None,
            'folds_beating_baseline':int((group.mae_hours<group.baseline_mae_hours).sum()),
            'directional_accuracy':float(np.average(group.directional_accuracy,weights=weights)),
            'mean_regional_total_absolute_error_hours':float(group.regional_total_absolute_error_hours.mean()),
            'mean_baseline_regional_total_absolute_error_hours':float(group.baseline_regional_total_absolute_error_hours.mean())}
        for metric in ('precision','recall','jaccard'):
            values = group[f'spatial_top_decile_{metric}'].dropna()
            result[f'mean_spatial_top_decile_{metric}'] = float(values.mean()) if len(values) else None
            result[f'spatial_{metric}_scorable_folds'] = len(values)
        summary.append(result)
    return summary


def export_saved_comparisons(output, frame):
    """Export all cells using saved predictions, without fitting or selecting a model."""
    with np.load(output/'daily_2025_1deg.npz') as cached:
        fine, dates = cached['hours'], pd.DatetimeIndex(cached['dates'])
    coarse = aggregate_five(fine)
    parent = (np.arange(64800)//360//5)*72+(np.arange(64800)%360//5)
    coarse_ids = np.arange(2592)
    south, west = coarse_ids//72*5-90, coarse_ids%72*5-180
    galapagos = (west>=-95)&(west < -85)&(south>=-5)&(south<5)
    comparisons = output/'cell_comparisons'
    comparisons.mkdir(exist_ok=True)
    for issue_date, folds in frame.groupby('issue_date'):
        issue = int((pd.Timestamp(issue_date)-dates[0]).days)
        observation = issue-LAG
        eligible = coarse[:,observation-27:observation+1].sum(axis=1)>0
        coarse_truth = coarse[:,issue+1:issue+HORIZON+1].sum(axis=1)
        coarse_baseline = coarse[:,observation-6:observation+1].sum(axis=1)
        for (grid, depth), groups in folds.groupby(['grid_degrees','tree_depth']):
            values = coarse if grid==5 else fine
            baseline = values[:,observation-6:observation+1].sum(axis=1)
            actual = values[:,issue+1:issue+HORIZON+1].sum(axis=1)
            prediction = baseline.copy()
            saved = pd.read_csv(output/f'errors_{issue_date}_{grid}deg_depth{depth}.csv.gz')
            ids = saved.cell.to_numpy(dtype=int)
            np.testing.assert_allclose(actual[ids],saved.actual_hours,atol=1e-6)
            np.testing.assert_allclose(baseline[ids],saved.baseline_hours,atol=1e-6)
            prediction[ids] = saved.prediction_hours
            scored = np.zeros(len(values),dtype=bool)
            scored[ids] = True
            cell = np.arange(len(values))
            columns = 360//grid
            native = pd.DataFrame({'cell':cell,'south':cell//columns*grid-90,
                'west':cell%columns*grid-180,'grid_degrees':grid,
                'actual_hours':actual,'prediction_hours':prediction,'baseline_hours':baseline,
                'absolute_error_hours':abs(actual-prediction),
                'baseline_absolute_error_hours':abs(actual-baseline),'ml_scored':scored,
                'in_common_footprint':eligible if grid==5 else eligible[parent]})
            native.to_csv(comparisons/f'native_{issue_date}_{grid}deg_depth{depth}.csv.gz',index=False)
            compared = prediction if grid==5 else np.bincount(parent,weights=prediction,minlength=2592)
            for fold in groups.itertuples():
                mask = eligible if fold.region=='world' else eligible & galapagos
                check = metrics(coarse_truth[mask],compared[mask],coarse_baseline[mask])
                np.testing.assert_allclose([check['mae_hours'],check['rmse_hours']],
                    [fold.mae_hours,fold.rmse_hours],rtol=1e-10,atol=1e-6)
            pd.DataFrame({'cell':coarse_ids,'south':south,'west':west,
                'included_in_world_metrics':eligible,'in_galapagos_example':galapagos,
                'actual_hours':coarse_truth,'prediction_hours':compared,
                'baseline_hours':coarse_baseline,'absolute_error_hours':abs(coarse_truth-compared),
                'baseline_absolute_error_hours':abs(coarse_truth-coarse_baseline)}).to_csv(
                    comparisons/f'common_{issue_date}_{grid}deg_depth{depth}.csv.gz',index=False)


def run(output):
    output = Path(output)
    output.mkdir(parents=True,exist_ok=True)
    current, dates = load_one_degree(DATA/'collection_manifest.json',output/'daily_2025_1deg.npz')
    annual, annual_dates = load_one_degree(DATA/'seasonal_history_manifest.json',output/'daily_2024_1deg.npz')
    coarse, coarse_annual = aggregate_five(current), aggregate_five(annual)
    original = pd.read_csv(DATA/'processed/daily_world.csv')
    row = original.cell_id.str.slice(3,5).astype(int).to_numpy()
    col = original.cell_id.str.slice(9).astype(int).to_numpy()
    day = (pd.to_datetime(original.date)-dates[0]).dt.days.to_numpy()
    if not np.allclose(coarse[row*72+col,day],original.fishing_hours,rtol=1e-10,atol=1e-6):
        raise ValueError('One-degree aggregation does not conserve the original five-degree history')
    rows = {5:make_rows(coarse,dates,coarse_annual,annual_dates),
            1:make_rows(current,dates,annual,annual_dates)}
    issues = pd.date_range('2025-04-05','2025-06-21',freq='7D')
    one_ids = np.arange(64800)
    parent = (one_ids//360//5)*72+(one_ids%360//5)
    coarse_ids = np.arange(2592)
    south, west = coarse_ids//72*5-90, coarse_ids%72*5-180
    galapagos = (west>=-95)&(west < -85)&(south>=-5)&(south<5)
    records = []
    for issue in issues:
        issue_index = int((issue-dates[0]).days)
        observation = issue_index-LAG
        truth = coarse[:,issue_index+1:issue_index+HORIZON+1].sum(axis=1)
        base = coarse[:,observation-6:observation+1].sum(axis=1)
        eligible = coarse[:,observation-27:observation+1].sum(axis=1)>0
        for grid in (5,1):
            samples = rows[grid]
            fit = training_mask(samples['day'],issue_index)
            score = samples['day']==observation
            data = coarse if grid==5 else current
            grid_baseline = data[:,observation-6:observation+1].sum(axis=1)
            for depth in (2,4):
                model = DecisionTreeRegressor(criterion='absolute_error',max_depth=depth,
                                              min_samples_leaf=LEAF_SIZE,random_state=42)
                model.fit(samples['x'][fit],((samples['target']-samples['baseline'])/samples['scale'])[fit],
                          sample_weight=samples['scale'][fit])
                prediction = grid_baseline.copy()
                prediction[samples['cell'][score]] = np.maximum(0,samples['baseline'][score]+
                    model.predict(samples['x'][score])*samples['scale'][score])
                # Quiet subcells use the declared untrained baseline, not a claim
                # that missing/zero history is a successful ML prediction.
                comparison = prediction if grid==5 else np.bincount(parent,weights=prediction,minlength=2592)
                for region, mask in [('world',eligible),('galapagos_example',eligible & galapagos)]:
                    if not mask.any(): continue
                    result = {'issue_date':str(issue.date()),'region':region,'grid_degrees':grid,
                              'tree_depth':depth,'training_rows':int(fit.sum()),'common_five_degree_cells':int(mask.sum()),
                              **metrics(truth[mask],comparison[mask],base[mask])}
                    records.append(result)
                per_cell = pd.DataFrame({'cell':samples['cell'][score],
                    'actual_hours':samples['target'][score],
                    'prediction_hours':prediction[samples['cell'][score]],
                    'baseline_hours':samples['baseline'][score]})
                per_cell.to_csv(output/f'errors_{issue.date()}_{grid}deg_depth{depth}.csv.gz',index=False)
        print('Completed weekly issue',issue.date(),flush=True)
    frame = pd.DataFrame(records)
    frame.to_csv(output/'fold_metrics.csv',index=False)
    summary = summarize_folds(frame)
    report = {'created_at_utc':datetime.now(timezone.utc).isoformat(),'horizon_days':HORIZON,
        'assumed_publication_lag_days':LAG,'issue_start':str(issues[0].date()),'issue_end':str(issues[-1].date()),
        'protocol':'Expanding historical training; labels must be available strictly before each issue. Same two-feature seasonal correction family. Both resolutions scored on identical eligible five-degree areas. One-degree quiet subcells explicitly fall back to last observed week.',
        'limitations':['Retrospective revised GFW exports, not archived as-published snapshots.',
            'Development backtest: dates and validation outcomes were previously viewed; not a new independent test.',
            'April-June issues do not validate an entire warm/cold seasonal cycle.',
            'Galapagos example is an illustrative aligned rectangle [-95,-5,-85,5], not a reserve boundary.',
            'Spatial metric is overlap of top-decile positive increases on the common five-degree grid, not vessel-location accuracy.',
            'Repeat-last-week predicts no change by definition; its directional/spatial scores are degenerate. MAE/RMSE remain primary.',
            'No serving checkpoint is replaced and no July test outcomes are scored.'],
        'summary':summary}
    (output/'summary.json').write_text(json.dumps(report,indent=2)+'\n')
    export_saved_comparisons(output, frame)
    print(json.dumps(report,indent=2),flush=True)
    return report


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=DATA/'rolling_backtest')
    parser.add_argument('--summarize-only',action='store_true',
                        help='Summarize/export recorded predictions without any model fitting.')
    args = parser.parse_args()
    if args.summarize_only:
        report = json.loads((args.output/'summary.json').read_text())
        frame = pd.read_csv(args.output/'fold_metrics.csv')
        report['summary'] = summarize_folds(frame)
        report['summary_updated_at_utc'] = datetime.now(timezone.utc).isoformat()
        export_saved_comparisons(args.output, frame)
        (args.output/'summary.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
        print('Summarized recorded folds and verified per-cell comparisons; no refitting.')
    else:
        run(args.output)
