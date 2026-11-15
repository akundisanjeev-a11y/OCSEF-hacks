"""Train explainable candidates and compare validation only; test evaluation is separate."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error
from sklearn.tree import DecisionTreeRegressor, export_text

from training.activity_forecast.common import DATA, FEATURES, ROOT
from training.activity_forecast.calibration import fit_scale


def chronological_split(rows: pd.DataFrame):
    data = rows.copy()
    for name in ('date', 'issue_date', 'target_start', 'target_end', 'label_available_at'):
        data[name] = pd.to_datetime(data[name])
    dates = sorted(data['issue_date'].unique())
    if len(dates) < 30:
        raise ValueError('Need at least 30 usable issue dates for date-based evaluation')
    validation_start, test_start = dates[int(len(dates)*0.6)], dates[int(len(dates)*0.8)]
    # A training target must already be available before the first validation issue.
    train = data.loc[(data['issue_date'] < validation_start) & (data['label_available_at'] < validation_start)]
    validation = data.loc[(data['issue_date'] >= validation_start) & (data['issue_date'] < test_start)
                          & (data['label_available_at'] < test_start)]
    test = data.loc[data['issue_date'] >= test_start]
    if any(part.empty for part in (train, validation, test)):
        raise ValueError('Not enough data after removing unavailable/overlapping target windows')
    return train, validation, test


def score_candidates(model, scale, part):
    baseline = part[FEATURES[0]].to_numpy() * 7
    predictions = {'decision_tree': model.predict(part[FEATURES]),
                   'trained_calibration': scale * baseline, 'repeat_last_week': baseline}
    errors = {name: float(mean_absolute_error(part['target_week_hours'], value))
              for name, value in predictions.items()}
    metrics = {'rows': len(part), 'cells': int(part['cell_id'].nunique()),
               'issue_start': part['issue_date'].min().date().isoformat(),
               'issue_end': part['issue_date'].max().date().isoformat(),
               'tree_mae_hours': errors['decision_tree'],
               'calibration_mae_hours': errors['trained_calibration'],
               'repeat_last_week_mae_hours': errors['repeat_last_week'],
               'tree_beats_baseline': errors['decision_tree'] < errors['repeat_last_week'],
               'calibration_beats_baseline': errors['trained_calibration'] < errors['repeat_last_week']}
    return metrics, predictions, errors


def train_model(output: Path, max_depth: int = 3, min_samples_leaf: int = 50, criterion: str = 'absolute_error'):
    if not 1 <= max_depth <= 3 or min_samples_leaf < 1:
        raise ValueError('Keep the explainable tree between 1 and 3 levels with positive leaf size')
    metadata = json.loads((DATA / 'processed/metadata.json').read_text())
    if metadata['feature_names'] != FEATURES:
        raise ValueError('Prepared feature order does not match this training script')
    rows = pd.read_csv(DATA / 'processed/training_rows.csv')
    if not np.isfinite(rows[FEATURES + ['target_week_hours']].to_numpy()).all():
        raise ValueError('Training data contains missing or nonfinite numbers')
    training, validation, _ = chronological_split(rows)
    model = DecisionTreeRegressor(criterion=criterion, max_depth=max_depth,
                                  min_samples_leaf=min_samples_leaf, random_state=42)
    model.fit(training[FEATURES], training['target_week_hours'])
    scale = fit_scale(training[FEATURES[0]].to_numpy() * 7, training['target_week_hours'].to_numpy())
    validation_metrics, predictions, errors = score_candidates(model, scale, validation)
    metrics = {'validation': validation_metrics}
    # Prefer the untrained baseline on exact ties; select using validation only.
    methods = ['repeat_last_week', 'trained_calibration', 'decision_tree']
    selected = min(methods, key=errors.get)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    version = datetime.now(timezone.utc).strftime('world-forecast-%Y%m%dT%H%M%SZ')
    bundle = {'model': model, 'feature_names': FEATURES, 'data_metadata': metadata,
              'version': version, 'trained_label_available_through': training['label_available_at'].max().date().isoformat(),
              'calibration_scale': scale, 'default_method': selected,
              'selection_basis': 'Lower validation MAE; held-out test is not used to select the method'}
    joblib.dump(bundle, output / 'model.joblib')
    rules = (f'Selected forecast method: {selected}\n'
             f'Learned calibration: next_week_hours = {scale:.10f} * last_week_hours\n'
             'The scale was fitted on training data, not chosen from test results.\n\n'
             'Decision-tree candidate rules:\n' + export_text(model, feature_names=FEATURES, decimals=3))
    (output / 'rules.txt').write_text(rules, encoding='utf-8')
    report = {'model': selected, 'tree_candidate': 'DecisionTreeRegressor',
              'max_depth': int(model.get_depth()), 'leaf_count': int(model.get_n_leaves()),
              'criterion': criterion, 'min_samples_leaf': min_samples_leaf,
              'calibration_scale': scale,
              'version': version, 'scope': 'worldwide', 'training_rows': len(training),
              'training_issue_start': training['issue_date'].min().date().isoformat(),
              'training_issue_end': training['issue_date'].max().date().isoformat(),
              'metrics': metrics, 'data_metadata': metadata,
              'recommended_forecast_method': bundle['default_method'],
              'evaluation_scope': 'Validation only. Prior test results were already viewed; a fresh period is needed for final confirmation.',
              'interpretation': 'Forecast of GFW-reported apparent fishing vessel-hours; no authorization determination.'}
    (output / 'evaluation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    preview = validation[['cell_id', 'date', 'issue_date', 'target_start', 'target_end', 'target_week_hours']].copy()
    for method, values in predictions.items():
        preview[method + '_prediction_hours'] = values
    preview.to_csv(output / 'validation_predictions.csv', index=False, date_format='%Y-%m-%d')
    print(f'Trained {model.get_depth()}-level tree with {model.get_n_leaves()} leaves on {len(training):,} rows')
    print(json.dumps(metrics, indent=2))
    print(f'Selected: {selected}; learned multiplier: {scale:.6f}')
    print('Test data was not evaluated. See evaluate.py for explicit final evaluation.')
    print(f'Model: {(output / "model.joblib").resolve()}')
    print(f'Explainable rules: {(output / "rules.txt").resolve()}')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'weights/activity_forecast')
    parser.add_argument('--max-depth', type=int, default=3)
    parser.add_argument('--min-samples-leaf', type=int, default=50)
    parser.add_argument('--criterion', choices=['squared_error', 'absolute_error'], default='absolute_error')
    parser.add_argument('--legacy', action='store_true', help='Use the original nonseasonal candidates')
    args = parser.parse_args()
    if not args.legacy and (DATA / 'processed/seasonal_history/daily_world.csv').is_file():
        from training.activity_forecast.improve import train_improved
        print('Using the season-aware model; tree settings are fixed at depth 2 for explainability.')
        train_improved(args.output)
    else:
        train_model(args.output, args.max_depth, args.min_samples_leaf, args.criterion)
