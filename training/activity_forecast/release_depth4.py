"""Freeze, validate, independently test, and release the selected five-degree tree.

Stages are deliberately separate. Validation downloads only August targets;
September/October targets are not collected until the frozen validation is saved.
"""
import argparse
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

import joblib
import numpy as np
import pandas as pd
from dotenv import set_key
from sklearn.tree import export_text

from training.activity_forecast.common import DATA, ROOT, FEATURES
from training.activity_forecast.collect import collect
from training.activity_forecast.prepare import prepare, build_features
from training.activity_forecast.seasonal import (
    RULE_FEATURES, add_seasonality, fit_candidates, candidate_predictions,
)
from training.activity_forecast.improve import metrics_for, write_errors
from training.activity_forecast.rolling_backtest import metrics as spatial_metrics

OUTPUT = ROOT/'weights/activity_forecast/depth4_release'
RELEASE_DATA = DATA/'releases/depth4'
PROTOCOL_ID = 'depth4_holdout_v1'
LAG = 4


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False)+'\n', encoding='utf-8')


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def combine_manifests(paths, destination):
    sources = [read_json(path) for path in paths]
    reports = sorted([report for source in sources for report in source['reports']],
                     key=lambda report: report['params']['date-range'])
    if len({source['dataset'] for source in sources}) != 1:
        raise ValueError('Source versions differ')
    result = {**sources[0], 'start': min(source['start'] for source in sources),
              'end_exclusive': max(source['end_exclusive'] for source in sources), 'reports': reports}
    save_json(destination, result)
    return destination


def load_block(path):
    metadata = read_json(path/'metadata.json')
    frame = pd.read_csv(path/'daily_world.csv', parse_dates=['date'])
    if metadata['grid_degrees'] != 5 or metadata['dataset'] != 'public-global-fishing-effort:v5.0':
        raise ValueError('Wrong source or grid')
    return frame, metadata


def freeze(output=OUTPUT):
    output = Path(output)
    if (output/'selection_freeze.json').exists():
        check_frozen(output)
        print('Using existing frozen candidate; no refitting.', flush=True)
        return read_json(output/'selection_freeze.json')
    # This release's outcome periods must not already have been downloaded.
    for first, last in [('2025-08-01','2025-09-01'),('2025-09-01','2025-10-01'),
                        ('2025-10-01','2025-11-01')]:
        if (DATA/'raw'/f'world_{first}_{last}_v5.zip').exists():
            raise ValueError('Holdout archive already exists before freezing; audit provenance first')
    current, metadata = load_block(DATA/'processed')
    july, july_metadata = load_block(DATA/'processed/fresh_test')
    annual, _ = load_block(DATA/'processed/seasonal_history')
    if any(metadata[k] != july_metadata[k] for k in ('dataset','grid_degrees')):
        raise ValueError('Training source versions differ')
    current = pd.concat([current,july],ignore_index=True)
    rows = add_seasonality(build_features(current,LAG), current, annual)
    rows = rows.loc[rows.label_available_at < pd.Timestamp('2025-08-01')].copy()
    if rows.empty or rows.target_end.max() >= pd.Timestamp('2025-08-01'):
        raise ValueError('Training crosses the fresh holdout boundary')
    models = fit_candidates(rows,max_depth=4,min_samples_leaf=500)
    version = datetime.now(timezone.utc).strftime('world-seasonal-depth4-lag4-%Y%m%dT%H%M%SZ')
    metadata = {**metadata,'availability_lag_days':LAG,'end_exclusive':'2025-08-01',
                'daily_rows':len(current),'training_rows':len(rows),
                'trainable_cells':int(rows.cell_id.nunique())}
    protocol = {
        'protocol_id':PROTOCOL_ID,'version':version,'grid_degrees':5,'max_depth':4,
        'min_samples_leaf':500,'criterion':'absolute_error','seed':42,
        'features':RULE_FEATURES,'availability_lag_days':LAG,'horizon_days':7,
        'training_label_cutoff_exclusive':'2025-08-01',
        'validation_issues':pd.date_range('2025-08-03',periods=4,freq='7D').strftime('%Y-%m-%d').tolist(),
        'test_issues':pd.date_range('2025-09-06',periods=7,freq='7D').strftime('%Y-%m-%d').tolist(),
        'selection_basis':'Five-degree depth four chosen from April-June development backtests before these outcomes were collected.',
        'promotion_rule':'MAE below persistence and a strict majority of weekly wins in BOTH validation and test. No retuning/refitting after validation or test.',
        'limitations':['Revised historical GFW exports, not archived as-published snapshots.',
                       'Four-day availability delay is an assumption; no historical publication timestamps.',
                       'Scores apply to cells with positive trailing 28-day reported activity; no coverage assertion.',
                       'Aggregate global results do not establish improvement in every selected rectangle.',
                       'Only fishing-activity vessel-hours are forecast; not all vessel types or authorization.'],
        'training_rows':len(rows),'trained_label_available_through':str(rows.label_available_at.max().date()),
        'training_source_sha256':{str(path.relative_to(ROOT)):sha(path) for path in [
            DATA/'processed/daily_world.csv',DATA/'processed/fresh_test/daily_world.csv',
            DATA/'processed/seasonal_history/daily_world.csv']},
    }
    bundle = {'schema_version':2,'evaluation_protocol':PROTOCOL_ID,'models':models,
              'default_method':'seasonal_correction_tree','feature_names':FEATURES,
              'rule_features':RULE_FEATURES,'version':version,'data_metadata':metadata,
              'trained_label_available_through':protocol['trained_label_available_through'],
              'selection_basis':protocol['selection_basis']}
    output.mkdir(parents=True,exist_ok=True)
    joblib.dump(bundle,output/'model.joblib')
    protocol['frozen_model_sha256'] = sha(output/'model.joblib')
    protocol['frozen_at_utc'] = datetime.now(timezone.utc).isoformat()
    save_json(output/'selection_freeze.json',protocol)
    rules = ('Five-degree seasonal correction tree; maximum depth 4; minimum leaf 500.\n'
             'Baseline = last observed 7-day total; publication lag = 4 days.\n'
             'Scale = max(baseline, 28-day daily mean * 7, 1).\n'
             'Forecast = max(0, baseline + learned leaf correction * scale).\n'
             'Annual estimate uses the same target days last year, scaled by the past-only 28-day ratio, capped at 5.\n'
             'No annual reference or zero prior-year mean: annual estimate falls back to baseline.\n\n')
    (output/'rules.txt').write_text(rules+export_text(models['correction_tree'],feature_names=RULE_FEATURES,decimals=6))
    print(json.dumps({'version':version,'training_rows':len(rows),
                     'depth':int(models['correction_tree'].get_depth()),
                     'leaves':int(models['correction_tree'].get_n_leaves()),
                     'frozen_model_sha256':protocol['frozen_model_sha256']}),flush=True)
    return protocol


def check_frozen(output):
    protocol = read_json(output/'selection_freeze.json')
    if sha(output/'model.joblib') != protocol['frozen_model_sha256']:
        raise ValueError('Model changed after freezing')
    for path, expected in protocol['training_source_sha256'].items():
        if sha(ROOT/path) != expected:
            raise ValueError('Training source changed after freezing')
    return protocol


def prepare_validation(output):
    check_frozen(output)
    collect(date(2025,8,1),date(2025,9,1),'depth4_validation_manifest.json')
    manifest = combine_manifests([DATA/'collection_manifest.json',DATA/'fresh_test_manifest.json',
        DATA/'depth4_validation_manifest.json'],RELEASE_DATA/'validation_manifest.json')
    annual_manifest = combine_manifests([DATA/'seasonal_history_manifest.json',
        DATA/'inference_reference_manifest.json'],RELEASE_DATA/'validation_annual_manifest.json')
    destination = RELEASE_DATA/'validation_processed'
    prepare(5,LAG,manifest,destination,daily_only=True)
    prepare(5,LAG,annual_manifest,destination/'seasonal_history',daily_only=True)
    return destination


def concatenate_blocks(first, second, destination):
    left, metadata = load_block(first)
    right, extra = load_block(second)
    if any(metadata[k] != extra[k] for k in ('dataset','grid_degrees','availability_lag_days')):
        raise ValueError('History blocks differ')
    frame = pd.concat([left,right],ignore_index=True).sort_values(['cell_id','date'])
    if frame.duplicated(['cell_id','date']).any() or not (
        frame.groupby('cell_id').date.diff().dropna()==pd.Timedelta(days=1)).all():
        raise ValueError('History blocks overlap or have gaps')
    destination.mkdir(parents=True,exist_ok=True)
    frame.to_csv(destination/'daily_world.csv',index=False,date_format='%Y-%m-%d',float_format='%.8f')
    save_json(destination/'metadata.json',{**metadata,'end_exclusive':extra['end_exclusive'],
        'daily_rows':len(frame),'training_rows':0,'trainable_cells':0})


def prepare_test(output):
    validation = recorded_stage(output,'validation')
    if validation is None:
        raise ValueError('Freeze and record validation before collecting test outcomes')
    collect(date(2025,9,1),date(2025,11,1),'depth4_test_manifest.json')
    # Earlier-year references are input features, not September/October 2025 targets.
    # Include November references so the released historical demo can forecast past Oct 31.
    collect(date(2024,9,1),date(2024,12,1),'depth4_test_annual_manifest.json')
    extension = RELEASE_DATA/'test_extension'
    prepare(5,LAG,DATA/'depth4_test_manifest.json',extension,daily_only=True)
    prepare(5,LAG,DATA/'depth4_test_annual_manifest.json',extension/'seasonal_history',daily_only=True)
    destination = RELEASE_DATA/'test_processed'
    concatenate_blocks(RELEASE_DATA/'validation_processed',extension,destination)
    concatenate_blocks(RELEASE_DATA/'validation_processed/seasonal_history',
                       extension/'seasonal_history',destination/'seasonal_history')
    return destination


def recorded_stage(output, stage):
    protocol = check_frozen(output)
    path = output/f'{stage}_evaluation.json'
    if not path.exists():
        return None
    result = read_json(path)
    if result['model_sha256'] != protocol['frozen_model_sha256'] or result['protocol_sha256'] != sha(output/'selection_freeze.json'):
        raise ValueError('Recorded result belongs to another model or protocol')
    for source, expected in result['source_sha256'].items():
        if sha(ROOT/source) != expected:
            raise ValueError('Recorded evaluation source has changed')
    return result


def evaluate_stage(output, stage):
    output = Path(output)
    saved = recorded_stage(output,stage)
    if saved is not None:
        print(f'Returning recorded {stage}; no new evaluation or selection.',flush=True)
        return saved
    protocol = check_frozen(output)
    processed = prepare_validation(output) if stage=='validation' else prepare_test(output)
    sources = [processed/'daily_world.csv',processed/'seasonal_history/daily_world.csv']
    hashes = {str(path.relative_to(ROOT)):sha(path) for path in sources}
    registry_path = RELEASE_DATA/'evaluation_registry.json'
    registry = read_json(registry_path) if registry_path.exists() else {}
    # A stage cannot be recycled for a changed model, protocol or set of observations.
    identity = {'model_sha256':protocol['frozen_model_sha256'],'source_sha256':hashes,
                'protocol_sha256':sha(output/'selection_freeze.json')}
    if stage in registry and registry[stage] != identity:
        raise ValueError('These outcomes were already exposed under another evaluation identity')
    registry[stage] = identity
    save_json(registry_path,registry)
    daily, _ = load_block(processed)
    annual, _ = load_block(processed/'seasonal_history')
    rows = build_features(daily,LAG)
    rows = rows.loc[rows.issue_date.isin(pd.to_datetime(protocol[f'{stage}_issues']))].copy()
    if rows.empty or rows.issue_date.nunique()!=len(protocol[f'{stage}_issues']):
        raise ValueError('Missing planned issue dates')
    if rows.issue_date.min() <= pd.Timestamp(protocol['trained_label_available_through']):
        raise ValueError('Training labels were unavailable at the evaluation issue date')
    rows = add_seasonality(rows,daily,annual)
    bundle = joblib.load(output/'model.joblib')
    predictions = candidate_predictions(bundle['models'],rows)
    prediction, baseline = predictions['seasonal_correction_tree'], predictions['repeat_last_week']
    overall = metrics_for(rows,prediction,baseline)
    fold_records = []
    for issue in pd.to_datetime(protocol[f'{stage}_issues']):
        mask = (rows.issue_date==issue).to_numpy()
        fold_records.append({'issue_date':str(issue.date()),'cells':int(mask.sum()),
            **spatial_metrics(rows.loc[mask,'target_week_hours'].to_numpy(),prediction[mask],baseline[mask])})
    folds = pd.DataFrame(fold_records)
    overall.update(weekly_folds=len(folds),weeks_beating_baseline=int((folds.mae_hours<folds.baseline_mae_hours).sum()),
        directional_accuracy=float(np.average(folds.directional_accuracy,weights=folds.cells)))
    for name in ('precision','recall','jaccard'):
        values = folds[f'spatial_top_decile_{name}'].dropna()
        overall[f'mean_spatial_top_decile_{name}'] = float(values.mean()) if len(values) else None
    report = {'stage':stage,'model_version':bundle['version'],'model_sha256':identity['model_sha256'],
        'protocol_sha256':identity['protocol_sha256'],'source_sha256':hashes,
        'selected_method':'seasonal_correction_tree','metrics':overall,'folds':fold_records,
        'completed_at_utc':datetime.now(timezone.utc).isoformat(),
        'protocol':'One fixed candidate, chosen and saved before collecting these targets. No refitting or hyperparameter selection from this report.',
        'limitations':protocol['limitations']}
    audit = RELEASE_DATA/f'{stage}_errors'
    audit.mkdir(parents=True,exist_ok=True)
    write_errors(rows,prediction,baseline,audit)
    folds.to_csv(output/f'{stage}_fold_metrics.csv',index=False)
    save_json(output/f'{stage}_evaluation.json',report)
    print(json.dumps({'stage':stage,**overall},indent=2),flush=True)
    return report


def passes_gate(report):
    metrics = report['metrics']
    return metrics['beats_baseline'] and metrics['weeks_beating_baseline'] > metrics['weekly_folds']/2


def promote(output=OUTPUT, replace_if_better_than_previous=False):
    output = Path(output)
    validation, test = recorded_stage(output,'validation'), recorded_stage(output,'test')
    if validation is None or test is None:
        raise ValueError('Both recorded evaluations are required before release')
    comparison = None
    if replace_if_better_than_previous:
        comparison = read_json(output/'paired_comparison.json')
        if comparison['depth4_model_sha256'] != test['model_sha256']:
            raise ValueError('Paired comparison belongs to another replacement checkpoint')
        previous = ROOT/'weights/activity_forecast/model.joblib'
        if sha(previous) != comparison['previous_model_sha256']:
            raise ValueError('Previous checkpoint differs from the recorded paired comparison')
        accepted = comparison['depth4_better_under_comparison_rule']
    else:
        accepted = passes_gate(validation) and passes_gate(test)
    if not accepted:
        save_json(output/'release_decision.json',{
            'promoted':False,'model_sha256':test['model_sha256'],
            'validation_passes_gate':passes_gate(validation),'test_passes_gate':passes_gate(test),
            'reason':'Both validation and test must have lower MAE and a strict majority of weekly wins. Existing checkpoint retained.',
            'recorded_at_utc':datetime.now(timezone.utc).isoformat()})
        print('Candidate saved, but it failed the predeclared release gate. Existing best model retained.',flush=True)
        return False
    protocol = check_frozen(output)
    env = ROOT/'.env'
    if env.exists() and '=' not in env.read_text():
        raise ValueError('Bare-token root .env must not be rewritten during model configuration')
    destination = ROOT/'weights/activity_forecast'
    archive = destination/'archive'/protocol['version']
    files = ['best_model.joblib','best_model_metadata.json','model.joblib','model_metadata.json',
             'selection_freeze.json','evaluation.json','fresh_test_evaluation.json','rules.txt',
             'release_evaluation.json']
    archive.mkdir(parents=True,exist_ok=True)
    for name in files:
        if (destination/name).exists() and not (archive/name).exists():
            shutil.copy2(destination/name,archive/name)
    evaluation = {'model_version':protocol['version'],'model_sha256':protocol['frozen_model_sha256'],
        'selected_method':'seasonal_correction_tree','validation':validation['metrics'],
        'fresh_test':test['metrics'],'protocol':test['protocol'],'limitations':protocol['limitations'],
        'validation_report_sha256':sha(output/'validation_evaluation.json'),
        'test_report_sha256':sha(output/'test_evaluation.json')}
    if comparison is not None:
        evaluation['paired_previous_model_comparison'] = comparison
        evaluation['release_policy'] = 'User requested permanent replacement if better than the previous model. Paired comparison passed; original baseline validation gate did not pass.'
    metadata = {'model_sha256':protocol['frozen_model_sha256'],'evaluation':evaluation,
        'max_depth':4,'grid_degrees':5,'availability_lag_days':LAG,
        'candidate_directory':str(output.relative_to(ROOT))}
    for name in ('best_model.joblib','model.joblib'):
        shutil.copy2(output/'model.joblib',destination/name)
        save_json(destination/(Path(name).stem+'_metadata.json'),metadata)
    for name in ('selection_freeze.json','rules.txt'):
        shutil.copy2(output/name,destination/name)
    for name in ('evaluation.json','fresh_test_evaluation.json','release_evaluation.json'):
        save_json(destination/name,evaluation)
    # A separate prepared directory preserves the original study's data and metadata.
    set_key(str(env),'ACTIVITY_FORECAST_MODEL_PATH','weights/activity_forecast/best_model.joblib')
    set_key(str(env),'ACTIVITY_FORECAST_DATA_DIR',str((RELEASE_DATA/'test_processed').relative_to(ROOT)).replace('\\','/'))
    decision = output/'release_decision.json'
    if decision.exists() and not (output/'baseline_release_decision.json').exists():
        shutil.copy2(decision,output/'baseline_release_decision.json')
    save_json(decision,{'promoted':True,'permanent':True,
        'model_sha256':protocol['frozen_model_sha256'],'validation_passes_gate':passes_gate(validation),
        'test_passes_gate':passes_gate(test),'previous_model_comparison_passes':comparison is not None,
        'release_policy':evaluation.get('release_policy','Original baseline validation/test gate'),
        'recorded_at_utc':datetime.now(timezone.utc).isoformat()})
    print('Released verified candidate. Previous files archived; forecast paths configured in root .env.',flush=True)
    return True


def recorded_release(output):
    output = Path(output)
    for name in ('best_model','model'):
        checkpoint=output/(name+'.joblib')
        sidecar=output/(name+'_metadata.json')
        if checkpoint.is_file() and sidecar.is_file():
            metadata=read_json(sidecar)
            report=metadata.get('evaluation',{})
            if sha(checkpoint)!=metadata.get('model_sha256') or report.get('model_sha256')!=metadata.get('model_sha256'):
                raise ValueError('Recorded evaluation belongs to another checkpoint')
            if report.get('fresh_test'):
                print('Recorded checksum-linked evaluation; no new scoring. Raw holdout data is not required or bundled.',flush=True)
                print(json.dumps(report,indent=2),flush=True)
                return report
    if not (output/'release_evaluation.json').exists():
        test = recorded_stage(output,'test')
        validation = recorded_stage(output,'validation')
        if test is None or validation is None:
            raise ValueError('Run the planned validation and test before requesting recorded metrics')
        report = {'model_version':test['model_version'],'model_sha256':test['model_sha256'],
            'selected_method':test['selected_method'],'fresh_test':test['metrics'],
            'validation':validation['metrics'],'protocol':test['protocol'],
            'limitations':test['limitations']}
        print('Returning the recorded candidate result; no new evaluation or model promotion.',flush=True)
        print(json.dumps(report,indent=2),flush=True)
        return report
    report = read_json(output/'release_evaluation.json')
    if sha(output/'model.joblib') != report['model_sha256']:
        raise ValueError('Saved evaluation belongs to another checkpoint')
    metadata = read_json(output/'model_metadata.json')
    candidate = ROOT/metadata['candidate_directory']
    test = recorded_stage(candidate,'test')
    if test is None or sha(candidate/'test_evaluation.json') != report['test_report_sha256']:
        raise ValueError('Recorded independent-test evidence has changed')
    print('Returning recorded September-October independent-test result; no new selection or evaluation.',flush=True)
    print(json.dumps(report,indent=2),flush=True)
    return report


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage',choices=['freeze','validation','test','promote'])
    parser.add_argument('--output',type=Path,default=OUTPUT)
    parser.add_argument('--replace-if-better-than-previous',action='store_true',
                        help='Use an explicitly authorized paired-checkpoint replacement policy, preserving the original failed baseline gate.')
    args = parser.parse_args()
    if args.stage=='freeze':
        freeze(args.output)
    elif args.stage=='promote':
        promote(args.output,args.replace_if_better_than_previous)
    else:
        evaluate_stage(args.output,args.stage)
