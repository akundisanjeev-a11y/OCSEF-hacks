"""Forecast a worldwide grid cell and explain the exact decision-tree path."""

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import joblib
import numpy as np
import pandas as pd

from training.activity_forecast.common import DATA, FEATURES, ROOT
from training.activity_forecast.prepare import cell_for


def explain(bundle, feature_values: dict):
    if bundle['feature_names'] != FEATURES or set(feature_values) != set(FEATURES):
        raise ValueError('Feature names/order do not match the trained bundle')
    row = pd.DataFrame([[feature_values[name] for name in FEATURES]], columns=FEATURES)
    if not np.isfinite(row.to_numpy()).all() or (row.to_numpy() < 0).any():
        raise ValueError('Feature means must be finite and nonnegative')
    model = bundle['model']
    value = float(model.predict(row)[0])
    rules = []
    node = 0
    while model.tree_.children_left[node] != model.tree_.children_right[node]:
        feature = FEATURES[model.tree_.feature[node]]
        threshold = float(model.tree_.threshold[node])
        observed = float(feature_values[feature])
        # sklearn trees evaluate float32 inputs; follow the same comparison.
        left = np.float32(observed) <= threshold
        rules.append({'feature': feature, 'observed': observed,
                      'comparison': '<=' if left else '>', 'threshold': threshold,
                      'unit': 'reported apparent fishing hours per day'})
        node = model.tree_.children_left[node] if left else model.tree_.children_right[node]
    return {'predicted_week_hours': value, 'decision_path': rules,
            'training_examples_in_leaf': int(model.tree_.n_node_samples[node]),
            'model_version': bundle['version']}


def predict_location(lat: float, lon: float, bundle, daily: pd.DataFrame, cutoff: str | None = None):
    if bundle.get('schema_version') == 2:
        from training.activity_forecast.improve import predict_improved_location
        return predict_improved_location(lat, lon, bundle, daily, cutoff)
    grid = bundle['data_metadata']['grid_degrees']
    cell = cell_for(lat, lon, grid)
    data = daily.loc[daily['cell_id'] == cell].copy()
    data['date'] = pd.to_datetime(data['date'], format='%Y-%m-%d')
    if data.empty:
        return {'status': 'insufficient_data', 'cell_id': cell, 'reason': 'no_downloaded_history'}
    day = pd.Timestamp(cutoff) if cutoff else data['date'].max()
    history = data.loc[data['date'].between(day - pd.Timedelta(days=27), day)].sort_values('date')
    if len(history) != 28 or history['date'].duplicated().any() or not np.array_equal(history['date'].to_numpy(), pd.date_range(day - pd.Timedelta(days=27), day).to_numpy()):
        return {'status': 'insufficient_data', 'cell_id': cell, 'reason': 'need_28_complete_days'}
    hours = history['fishing_hours'].to_numpy()
    if not np.isfinite(hours).all() or (hours < 0).any():
        return {'status': 'insufficient_data', 'cell_id': cell, 'reason': 'invalid_activity_history'}
    if hours.sum() == 0:
        return {'status': 'insufficient_data', 'cell_id': cell,
                'reason': 'no_reported_activity_in_28_day_history; not proof of no boats or good coverage'}
    lag = bundle['data_metadata']['availability_lag_days']
    issue = day + pd.Timedelta(days=lag)
    if issue <= pd.Timestamp(bundle['trained_label_available_through']):
        raise ValueError('Forecast issue date precedes availability of training labels; use a later cutoff')
    values = dict(zip(FEATURES, [float(hours[-7:].mean()), float(hours[-14:-7].mean()), float(hours.mean())]))
    result = explain(bundle, values)
    result['tree_predicted_week_hours'] = result['predicted_week_hours']
    result['decision_path_applies_to'] = 'decision_tree_candidate'
    result['selected_method'] = bundle.get('default_method', 'decision_tree')
    factor = bundle.get('calibration_scale', 1.0)
    result['calibration_scale'] = factor
    result['calibration_predicted_week_hours'] = factor * values[FEATURES[0]] * 7
    if result['selected_method'] == 'repeat_last_week':
        result['predicted_week_hours'] = values[FEATURES[0]] * 7
        result['selected_explanation'] = 'Repeat the latest observed week without training.'
    elif result['selected_method'] == 'trained_calibration':
        result['predicted_week_hours'] = result['calibration_predicted_week_hours']
        result['selected_explanation'] = f"Latest observed week's hours multiplied by {factor:.6f}, learned from training data."
    else:
        result['selected_explanation'] = 'Follow the learned decision-tree path shown separately.'
    result['method_selection_reason'] = bundle.get('selection_basis', 'Model bundle configuration')
    row, col = [int(part[3:]) for part in cell.split('_')]
    result.update(status='scored', cell_id=cell,
                  bounds={'south': row*grid-90, 'north': (row+1)*grid-90,
                          'west': col*grid-180, 'east': (col+1)*grid-180},
                  observation_cutoff=day.date().isoformat(), simulated_issue_date=issue.date().isoformat(),
                  target_start=(issue+pd.Timedelta(days=1)).date().isoformat(),
                  target_end=(issue+pd.Timedelta(days=7)).date().isoformat(),
                  repeat_last_week_hours=values[FEATURES[0]]*7,
                  source_dataset=bundle['data_metadata']['dataset'],
                  interpretation='Historical-data forecast of reported apparent fishing hours; not an authorization assessment.')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lat', type=float, required=True)
    parser.add_argument('--lon', type=float, required=True)
    parser.add_argument('--cutoff')
    parser.add_argument('--model', type=Path, default=ROOT / 'weights/activity_forecast/best_model.joblib')
    args = parser.parse_args()
    # Only load your own trusted model files.
    bundle = joblib.load(args.model)
    daily = pd.read_csv(DATA / 'processed/daily_world.csv')
    if bundle.get('schema_version') == 2 and (DATA / 'processed/fresh_test/daily_world.csv').is_file():
        daily = pd.concat([daily, pd.read_csv(DATA / 'processed/fresh_test/daily_world.csv')], ignore_index=True)
    print(json.dumps(predict_location(args.lat, args.lon, bundle, daily, args.cutoff), indent=2))
