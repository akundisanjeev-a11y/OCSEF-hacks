import json
from io import BytesIO
from zipfile import ZipFile

import numpy as np
import pandas as pd
import pytest

from training.activity_forecast.collect import DATASET, WORLD, month_windows, validate_export
from training.activity_forecast.common import FEATURES
from training.activity_forecast.prepare import build_features, cell_for
from training.activity_forecast.train import chronological_split


def daily_table(days=140):
    return pd.DataFrame({'cell_id': ['lat20_lon40'] * days,
                         'date': pd.date_range('2025-01-01', periods=days),
                         'fishing_hours': np.arange(days, dtype=float)})


def test_three_features_and_delayed_target_are_exact():
    rows = build_features(daily_table(50))
    row = rows.loc[rows['date'] == pd.Timestamp('2025-01-28')].iloc[0]
    assert row[FEATURES[0]] == 24
    assert row[FEATURES[1]] == 17
    assert row[FEATURES[2]] == 13.5
    assert row['target_week_hours'] == sum(range(31, 38))
    assert row['issue_date'] == pd.Timestamp('2025-01-31')
    assert row['target_start'] == pd.Timestamp('2025-02-01')
    assert row['target_end'] == pd.Timestamp('2025-02-07')


def test_future_activity_cannot_change_features():
    data = daily_table()
    original = build_features(data)
    data.loc[data['date'] > pd.Timestamp('2025-02-15'), 'fishing_hours'] = 99999
    changed = build_features(data)
    before = original.loc[original['date'] <= pd.Timestamp('2025-02-15'), FEATURES]
    after = changed.loc[changed['date'] <= pd.Timestamp('2025-02-15'), FEATURES]
    pd.testing.assert_frame_equal(before, after)


def test_date_split_purges_unavailable_targets():
    train, val, test = chronological_split(build_features(daily_table()))
    assert train['label_available_at'].max() < val['issue_date'].min()
    assert val['label_available_at'].max() < test['issue_date'].min()
    assert set(train['issue_date']).isdisjoint(test['issue_date'])


@pytest.mark.parametrize('problem', ['gap', 'duplicate', 'negative', 'infinity'])
def test_invalid_history_rejected(problem):
    data = daily_table()
    if problem == 'gap':
        data = data.drop(index=50)
    elif problem == 'duplicate':
        data = pd.concat([data, data.iloc[[50]]])
    else:
        data.loc[50, 'fishing_hours'] = -1 if problem == 'negative' else float('inf')
    with pytest.raises(ValueError):
        build_features(data)


def test_zero_history_is_not_a_confident_training_example():
    data = daily_table()
    data['fishing_hours'] = 0
    assert build_features(data).empty


def test_world_grid_handles_poles_and_date_line():
    assert cell_for(0, 180) == cell_for(0, -180)
    assert cell_for(90, 0) == 'lat35_lon36'
    assert cell_for(-90, -180) == 'lat00_lon00'
    assert cell_for(40, -120) != cell_for(-40, 120)
    with pytest.raises(ValueError):
        cell_for(float('nan'), 0)


def test_month_ranges_have_no_overlap():
    from datetime import date
    assert list(month_windows(date(2025, 1, 1), date(2025, 3, 1))) == [
        ('2025-01-01', '2025-02-01'), ('2025-02-01', '2025-03-01')]


def report_zip(geometry=WORLD):
    buffer = BytesIO()
    with ZipFile(buffer, 'w') as archive:
        archive.writestr('data.csv', 'Lat,Lon,Time Range,Apparent Fishing Hours\n')
        archive.writestr('readme.md', DATASET + ' 2025-01-01 2025-02-01')
        archive.writestr('geometry.geojson', json.dumps({'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'geometry': geometry, 'properties': {}}]}))
    return buffer.getvalue()


def test_recovered_report_must_match_world_geometry():
    validate_export(report_zip(), '2025-01-01', '2025-02-01')
    with pytest.raises(ValueError, match='world polygon'):
        validate_export(report_zip({'type': 'Point', 'coordinates': [0, 0]}), '2025-01-01', '2025-02-01')


def test_training_exports_explanations_and_predicts(tmp_path, monkeypatch):
    import joblib
    import training.activity_forecast.train as training
    from training.activity_forecast.predict import explain, predict_location
    processed = tmp_path / 'processed'
    processed.mkdir()
    data = daily_table()
    build_features(data).to_csv(processed / 'training_rows.csv', index=False)
    (processed / 'metadata.json').write_text(json.dumps({
        'feature_names': FEATURES, 'grid_degrees': 5, 'availability_lag_days': 3, 'dataset': DATASET}))
    monkeypatch.setattr(training, 'DATA', tmp_path)
    report = training.train_model(tmp_path / 'model', min_samples_leaf=5)
    assert set(report['metrics']) == {'validation'}
    assert not (tmp_path / 'model/test_predictions.csv').exists()
    assert (tmp_path / 'model/validation_predictions.csv').exists()
    bundle = joblib.load(tmp_path / 'model/model.joblib')
    result = explain(bundle, dict(zip(FEATURES, [90., 83., 80.])))
    assert len(result['decision_path']) <= 3
    assert result['predicted_week_hours'] >= 0
    assert report['leaf_count'] <= 8
    location = predict_location(12, 22, bundle, data)
    assert location['status'] == 'scored'
    assert location['cell_id'] == 'lat20_lon40'
    assert location['selected_method'] == bundle['default_method']
    if location['selected_method'] == 'repeat_last_week':
        assert location['predicted_week_hours'] == location['repeat_last_week_hours']
    elif location['selected_method'] == 'trained_calibration':
        assert location['predicted_week_hours'] == location['calibration_predicted_week_hours']
    else:
        assert location['predicted_week_hours'] == location['tree_predicted_week_hours']
    no_history = predict_location(-12, -22, bundle, data)
    assert no_history['status'] == 'insufficient_data'


def test_calibration_learns_coefficient_instead_of_hardcoding_it():
    from training.activity_forecast.calibration import fit_scale
    assert fit_scale([10, 20, 30], [20, 40, 60]) == 2
    assert fit_scale([10, 20, 30], [5, 10, 15]) == 0.5
    assert fit_scale([0, 0], [0, 5]) == 1
    with pytest.raises(ValueError):
        fit_scale([1, -1], [1, 2])


def test_scale_training_optimizes_absolute_error():
    from training.activity_forecast.calibration import fit_scale
    x = np.array([1., 2., 20.])
    y = np.array([1., 2., 10.])
    scale = fit_scale(x, y)
    assert scale == 0.5
    for other in [0, 0.4, 0.6, 1, 2]:
        assert np.abs(y-scale*x).mean() <= np.abs(y-other*x).mean()


def test_cli_tree_arguments_reach_the_model(tmp_path, monkeypatch):
    import joblib
    import training.activity_forecast.train as training
    processed = tmp_path / 'processed'
    processed.mkdir()
    build_features(daily_table()).to_csv(processed / 'training_rows.csv', index=False)
    (processed / 'metadata.json').write_text(json.dumps({'feature_names': FEATURES}))
    monkeypatch.setattr(training, 'DATA', tmp_path)
    training.train_model(tmp_path / 'model', max_depth=2, min_samples_leaf=7, criterion='squared_error')
    model = joblib.load(tmp_path / 'model/model.joblib')['model']
    assert model.max_depth == 2
    assert model.min_samples_leaf == 7
    assert model.criterion == 'squared_error'
