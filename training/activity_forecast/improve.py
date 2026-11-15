"""Season-aware, explainable forecasting; frozen model selection before fresh evaluation."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.tree import export_text

from training.activity_forecast.common import DATA, FEATURES, ROOT
from training.activity_forecast.prepare import build_features, cell_for
from training.activity_forecast.seasonal import (RULE_FEATURES, add_seasonality,
                                                fit_candidates, candidate_predictions)
from training.activity_forecast.train import chronological_split

FRESH_ISSUE_START = '2025-07-05'
FRESH_ISSUE_END = '2025-07-24'
FIT_LABEL_CUTOFF = '2025-07-04'


def metrics_for(rows, predictions, baseline):
    actual = rows.target_week_hours.to_numpy()
    errors, baseline_errors = np.abs(predictions-actual), np.abs(baseline-actual)
    grouped = pd.DataFrame({'cell': rows.cell_id.to_numpy(), 'error': errors,
                            'baseline': baseline_errors}).groupby('cell').mean()
    baseline_mae = float(baseline_errors.mean())
    return {'rows': len(rows), 'cells': int(rows.cell_id.nunique()),
            'issue_start': rows.issue_date.min().date().isoformat(),
            'issue_end': rows.issue_date.max().date().isoformat(),
            'mae_hours': float(errors.mean()),
            'rmse_hours': float(np.sqrt(mean_squared_error(actual, predictions))),
            'baseline_mae_hours': baseline_mae,
            'baseline_rmse_hours': float(np.sqrt(mean_squared_error(actual, baseline))),
            'mae_reduction_percent': float(100*(baseline_mae-errors.mean())/baseline_mae) if baseline_mae else None,
            'beats_baseline': bool(errors.mean() < baseline_mae),
            'fraction_of_cells_with_lower_mae': float((grouped.error < grouped.baseline).mean()),
            'note': 'Hours are summed across vessels; this is not classification accuracy.'}


def write_errors(rows, predictions, baseline, destination):
    data = rows[['cell_id', 'date', 'issue_date', 'target_start', 'target_end', 'target_week_hours']].copy()
    data['prediction_hours'] = predictions
    data['baseline_hours'] = baseline
    data['signed_error_hours'] = predictions-data.target_week_hours
    data['absolute_error_hours'] = data.signed_error_hours.abs()
    data['squared_error_hours'] = data.signed_error_hours**2
    data['baseline_absolute_error_hours'] = np.abs(baseline-data.target_week_hours)
    data['extra_error_vs_baseline_hours'] = data.absolute_error_hours-data.baseline_absolute_error_hours
    data.to_csv(destination / 'all_prediction_errors.csv', index=False, date_format='%Y-%m-%d')
    data.groupby('cell_id').agg(rows=('target_week_hours','size'),
        model_mae=('absolute_error_hours','mean'), baseline_mae=('baseline_absolute_error_hours','mean'),
        max_absolute_error=('absolute_error_hours','max')).to_csv(destination / 'errors_by_cell.csv')
    data.groupby('issue_date').agg(rows=('target_week_hours','size'),
        model_mae=('absolute_error_hours','mean'), baseline_mae=('baseline_absolute_error_hours','mean')).to_csv(destination / 'errors_by_issue_date.csv')
    data.nlargest(100,'absolute_error_hours').to_csv(destination / 'largest_100_errors.csv', index=False)


def train_improved(output: Path):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    metadata = json.loads((DATA/'processed/metadata.json').read_text())
    annual_metadata = json.loads((DATA/'processed/seasonal_history/metadata.json').read_text())
    if any(metadata[key] != annual_metadata[key] for key in ('dataset','grid_degrees')):
        raise ValueError('Annual history uses a different dataset version or grid')
    daily = pd.read_csv(DATA/'processed/daily_world.csv')
    annual = pd.read_csv(DATA/'processed/seasonal_history/daily_world.csv')
    original = pd.read_csv(DATA/'processed/training_rows.csv')
    rows = add_seasonality(original, daily, annual)
    train, validation, _ = chronological_split(rows)
    candidates = fit_candidates(train)
    predictions = candidate_predictions(candidates, validation)
    reports = {name: metrics_for(validation, pred, predictions['repeat_last_week'])
               for name, pred in predictions.items()}
    # The first candidate is the baseline, so exact ties keep the simpler baseline.
    selected = min(reports, key=lambda name: reports[name]['mae_hours'])
    # All January-June labels known before the fixed July evaluation issue dates.
    deployment_rows = rows.copy()
    deployment_rows['label_available_at'] = pd.to_datetime(deployment_rows.label_available_at)
    deployment_rows = deployment_rows.loc[deployment_rows.label_available_at < pd.Timestamp(FIT_LABEL_CUTOFF)]
    models = fit_candidates(deployment_rows)
    selection = {'candidate_names': list(predictions), 'selected_method': selected,
                 'selection_scope': 'validation only', 'validation': reports,
                 'fresh_issue_start': FRESH_ISSUE_START, 'fresh_issue_end': FRESH_ISSUE_END,
                 'refit_label_cutoff_exclusive': FIT_LABEL_CUTOFF,
                 'fixed_tree_depth': 2, 'fixed_min_samples_leaf': 500,
                 'growth_ratio_cap': 5,
                 'refit_rows': len(deployment_rows),
                 'development_csv_sha256': hashlib.sha256((DATA/'processed/daily_world.csv').read_bytes()).hexdigest(),
                 'annual_csv_sha256': hashlib.sha256((DATA/'processed/seasonal_history/daily_world.csv').read_bytes()).hexdigest(),
                 'test_policy': 'No fresh-test values used to choose model, thresholds or examples; report failure as well as success.'}
    version = datetime.now(timezone.utc).strftime('world-seasonal-%Y%m%dT%H%M%SZ')
    bundle = {'schema_version': 2, 'models': models, 'default_method': selected,
              'feature_names': FEATURES, 'rule_features': RULE_FEATURES,
              'version': version, 'data_metadata': metadata,
              'annual_metadata': annual_metadata,
              'trained_label_available_through': deployment_rows.label_available_at.max().date().isoformat(),
              'selection': selection, 'selection_basis': 'Lowest original-validation MAE, frozen before fresh July test'}
    joblib.dump(bundle, output/'model.joblib')
    selection['frozen_model_sha256'] = hashlib.sha256((output/'model.joblib').read_bytes()).hexdigest()
    selection['frozen_at_utc'] = datetime.now(timezone.utc).isoformat()
    (output/'selection_freeze.json').write_text(json.dumps(selection,indent=2)+'\n',encoding='utf-8')
    (output/'evaluation.json').write_text(json.dumps(selection,indent=2)+'\n',encoding='utf-8')
    rules = (f'Selected: {selected}\n'
             'Baseline = latest observed 7-day total.\n'
             'Seasonal estimate = same target dates last year, scaled by the current/past 28-day activity ratio (capped at 5).\n'
             'If annual history is missing or its average is zero, seasonal estimate = baseline.\n'
             'Scale = max(last-week hours, monthly-average hours * 7, 1 hour).\n'
             'Tree forecast = max(0, baseline + leaf correction * scale).\n'
             'Leaf corrections are weighted-median training outcomes, not manual constants.\n\n'
             + export_text(models['correction_tree'], feature_names=RULE_FEATURES, decimals=4)
             + f"\nBlend candidate: {models['blend_weights'][0]:.8f} * baseline + {models['blend_weights'][1]:.8f} * seasonal estimate\n")
    (output/'rules.txt').write_text(rules,encoding='utf-8')
    audit = DATA/'audit/improved_validation'
    audit.mkdir(parents=True,exist_ok=True)
    write_errors(validation, predictions[selected], predictions['repeat_last_week'], audit)
    (output/'validation_predictions.csv').write_bytes((audit/'all_prediction_errors.csv').read_bytes())
    print(json.dumps({'selected_method': selected, 'validation': reports[selected],
                      'refit_rows':len(deployment_rows)},indent=2),flush=True)
    print('Model frozen. Fresh test has not been evaluated.',flush=True)
    return selection


def evaluate_fresh(output: Path):
    output = Path(output)
    bundle = joblib.load(output/'model.joblib')
    freeze = json.loads((output/'selection_freeze.json').read_text())
    if hashlib.sha256((output/'model.joblib').read_bytes()).hexdigest() != freeze['frozen_model_sha256']:
        raise ValueError('Model changed after selection was frozen')
    for key,path in [('development_csv_sha256',DATA/'processed/daily_world.csv'),
                     ('annual_csv_sha256',DATA/'processed/seasonal_history/daily_world.csv')]:
        if key in freeze and hashlib.sha256(path.read_bytes()).hexdigest()!=freeze[key]:
            raise ValueError('Feature source data changed after the model was frozen')
    fresh_hash=hashlib.sha256((DATA/'processed/fresh_test/daily_world.csv').read_bytes()).hexdigest()
    registry_path=DATA/'audit/fresh_test/evaluation_registry.json'
    registry=json.loads(registry_path.read_text()) if registry_path.is_file() else {}
    report_path = output/'fresh_test_evaluation.json'
    if report_path.is_file():
        saved = json.loads(report_path.read_text())
        if saved.get('model_sha256') == freeze['frozen_model_sha256']:
            if saved.get('fresh_csv_sha256',fresh_hash)!=fresh_hash:
                raise ValueError('Test data changed; recorded results cannot be reused')
            if fresh_hash not in registry:
                registry_path.parent.mkdir(parents=True,exist_ok=True)
                registry[fresh_hash]={'first_evaluated_model_sha256':saved['model_sha256'],
                                      'first_result_source':str(report_path)}
                registry_path.write_text(json.dumps(registry,indent=2)+'\n')
            print('Returning the recorded fresh-test result; no new evaluation or selection.',flush=True)
            print(json.dumps(saved,indent=2))
            return saved
    current = pd.read_csv(DATA/'processed/daily_world.csv')
    fresh = pd.read_csv(DATA/'processed/fresh_test/daily_world.csv')
    fresh_metadata=json.loads((DATA/'processed/fresh_test/metadata.json').read_text())
    if any(fresh_metadata[key]!=bundle['data_metadata'][key] for key in ('dataset','grid_degrees')):
        raise ValueError('Fresh test source/grid differs from training data')
    current = pd.concat([current,fresh],ignore_index=True)
    rows = build_features(current, bundle['data_metadata']['availability_lag_days'])
    rows = rows.loc[rows.issue_date.between(pd.Timestamp(freeze['fresh_issue_start']),
                                           pd.Timestamp(freeze['fresh_issue_end']))].copy()
    if rows.empty or rows.issue_date.min() <= pd.Timestamp(bundle['trained_label_available_through']):
        raise ValueError('Fresh issue dates must follow availability of all refit labels')
    annual = pd.read_csv(DATA/'processed/seasonal_history/daily_world.csv')
    rows = add_seasonality(rows,current,annual)
    predictions = candidate_predictions(bundle['models'],rows)
    # Score the ONE preselected method, not whichever candidate looks best on July.
    metrics = metrics_for(rows,predictions[bundle['default_method']],predictions['repeat_last_week'])
    report = {'model_version':bundle['version'], 'model_sha256':freeze['frozen_model_sha256'],
              'fresh_csv_sha256':fresh_hash,
              'selected_method':bundle['default_method'], 'fresh_test':metrics,
              'protocol': 'July targets were not inspected to choose or change this model; do not tune against this report.',
              'limitations': 'Retrospective revised GFW measurements, assumed 3-day publishing lag, overlapping weekly targets; no guarantee of future or per-area improvement.'}
    if fresh_hash in registry:
        report['protocol']='These July outcomes were previously evaluated for another model. This run is not a new independent test.'
        report['test_previously_viewed']=True
    else:
        report['test_previously_viewed']=False
    report_path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    audit = DATA/'audit/fresh_test'
    audit.mkdir(parents=True,exist_ok=True)
    write_errors(rows,predictions[bundle['default_method']],predictions['repeat_last_week'],audit)
    if fresh_hash not in registry:
        registry[fresh_hash]={'first_evaluated_model_sha256':freeze['frozen_model_sha256'],
                              'first_result_source':str(report_path)}
        registry_path.write_text(json.dumps(registry,indent=2)+'\n')
    print(json.dumps(report,indent=2),flush=True)
    return report


def predict_improved_location(lat,lon,bundle,daily,cutoff=None,annual_history=None):
    cell = cell_for(lat,lon,bundle['data_metadata']['grid_degrees'])
    current = daily.loc[daily.cell_id == cell].copy()
    current['date'] = pd.to_datetime(current.date)
    if current.empty:
        return {'status':'insufficient_data','cell_id':cell,'reason':'no_downloaded_history'}
    day = pd.Timestamp(cutoff) if cutoff else current.date.max()
    history = current.loc[current.date.between(day-pd.Timedelta(days=27),day)].sort_values('date')
    if len(history)!=28 or history.date.duplicated().any() or not np.array_equal(history.date.to_numpy(),pd.date_range(day-pd.Timedelta(days=27),day).to_numpy()):
        return {'status':'insufficient_data','cell_id':cell,'reason':'need_28_complete_days'}
    hours=history.fishing_hours.to_numpy()
    if not np.isfinite(hours).all() or (hours<0).any() or hours.sum()==0:
        return {'status':'insufficient_data','cell_id':cell,'reason':'invalid_or_no_reported_activity_history'}
    lag=bundle['data_metadata']['availability_lag_days']
    issue=day+pd.Timedelta(days=lag)
    if issue<=pd.Timestamp(bundle['trained_label_available_through']):
        raise ValueError('Issue date precedes availability of refit labels')
    annual=annual_history if annual_history is not None else pd.read_csv(DATA/'processed/seasonal_history/daily_world.csv')
    # Inference-only extra reference months do not modify the frozen training/test sources.
    extension=DATA/'processed/inference_reference/daily_world.csv'
    if annual_history is None and extension.is_file():
        extra_metadata=json.loads((extension.parent/'metadata.json').read_text())
        if any(extra_metadata[key]!=bundle['data_metadata'][key] for key in ('dataset','grid_degrees')):
            raise ValueError('Additional inference reference uses a different source/grid')
        annual=pd.concat([annual,pd.read_csv(extension)],ignore_index=True)
    row=pd.DataFrame([{'cell_id':cell,'date':day,'issue_date':issue,'target_start':issue+pd.Timedelta(days=1),
                       FEATURES[0]:hours[-7:].mean(),FEATURES[1]:hours[-14:-7].mean(),FEATURES[2]:hours.mean()}])
    row=add_seasonality(row,history,annual)
    values=candidate_predictions(bundle['models'],row)
    selected=bundle['default_method']
    tree=bundle['models']['correction_tree'];node=0;path=[]
    while tree.tree_.children_left[node]!=tree.tree_.children_right[node]:
        feature=RULE_FEATURES[tree.tree_.feature[node]];observed=float(row.iloc[0][feature]);threshold=float(tree.tree_.threshold[node])
        left=np.float32(observed)<=threshold
        path.append({'feature':feature,'observed':observed,'comparison':'<=' if left else '>','threshold':threshold})
        node=tree.tree_.children_left[node] if left else tree.tree_.children_right[node]
    baseline=float(values['repeat_last_week'][0]);prediction=float(values[selected][0])
    correction_scale=max(baseline,float(row.iloc[0][FEATURES[2]])*7,1.)
    if selected=='seasonal_correction_tree':
        explanation=(f'Start with {baseline:.2f} last-week hours. The learned tree correction '
                     f'is {float(tree.tree_.value[node][0,0]):.6f} times a local scale of '
                     f'{correction_scale:.2f} hours, producing {prediction:.2f} hours.')
    elif selected=='seasonal_blend':
        explanation=f"Learned blend: {bundle['models']['blend_weights'][0]:.6f} * last-week hours + {bundle['models']['blend_weights'][1]:.6f} * seasonal estimate."
    elif selected=='trained_calibration':
        explanation=f"Multiply last-week hours by the training-learned factor {bundle['models']['calibration_scale']:.6f}."
    else:
        explanation='Repeat the last observed week without training.'
    grid=bundle['data_metadata']['grid_degrees'];r,c=[int(part[3:]) for part in cell.split('_')]
    return {'status':'scored','cell_id':cell,'selected_method':selected,'model_version':bundle['version'],
            'predicted_week_hours':prediction,'repeat_last_week_hours':baseline,
            'seasonal_estimate_hours':float(row.iloc[0].seasonal_estimate_hours),
            'seasonal_reference_available':bool(row.iloc[0].seasonal_reference_available),
            'data_quality_notes':[] if bool(row.iloc[0].seasonal_reference_available) else ['Annual reference missing or zero; seasonal estimate falls back to the last observed week.'],
            'decision_path':path,'decision_path_applies_to':'seasonal_correction_tree',
            'learned_leaf_correction_fraction':float(tree.tree_.value[node][0,0]),
            'correction_scale_hours':correction_scale,
            'selected_explanation':explanation,
            'observation_cutoff':day.date().isoformat(),'simulated_issue_date':issue.date().isoformat(),
            'target_start':(issue+pd.Timedelta(days=1)).date().isoformat(),'target_end':(issue+pd.Timedelta(days=7)).date().isoformat(),
            'bounds':{'south':r*grid-90,'north':(r+1)*grid-90,'west':c*grid-180,'east':(c+1)*grid-180},
            'source_dataset':bundle['data_metadata']['dataset'],
            'interpretation':'Forecast of reported apparent fishing vessel-hours; not proof of activity, harm or authorization.'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'weights/activity_forecast/improved')
    parser.add_argument('--evaluate-fresh',action='store_true')
    args=parser.parse_args()
    if args.evaluate_fresh:
        evaluate_fresh(args.output)
    else:
        train_improved(args.output)
