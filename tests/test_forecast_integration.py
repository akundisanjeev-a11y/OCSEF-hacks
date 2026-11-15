from pathlib import Path
from zipfile import ZipFile
import json

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.services.activity_forecast import ActivityForecaster
from training.activity_forecast.setup_inference import setup, setup_bundled


ROOT = Path(__file__).resolve().parents[1]


def test_bundled_files_work_in_an_empty_data_directory(tmp_path):
    processed = setup(destination=tmp_path/'processed')
    assert setup(destination=processed) == processed
    service = ActivityForecaster(ROOT/'weights/activity_forecast/best_model.joblib', processed)
    with TestClient(create_app(seed_fixtures=False, load_forecast=False)) as client:
        client.app.state.forecaster = service
        assert client.get('/forecast/health').json()['forecast_ready']
        for route in ['/activity-forecast', '/api/activity-forecast']:
            response = client.post(route, json={'latitude':27.5,'longitude':122.5})
            assert response.status_code == 200
            assert response.json()['predicted_week_hours'] == pytest.approx(386414.9500615278)
            assert response.json()['data_mode'] == 'historical_demo'
            evidence = response.json()['reasoning_evidence']
            cell_history = service.daily.loc[service.daily.cell_id == response.json()['cell_id']].sort_values('date').tail(28)
            assert evidence['last_week_daily_mean'] == pytest.approx(cell_history.fishing_hours.tail(7).mean())
            assert evidence['recent_three_day_daily_mean'] == pytest.approx(cell_history.fishing_hours.tail(3).mean())
            assert evidence['month_daily_mean'] == pytest.approx(cell_history.fishing_hours.mean())
            assert evidence['seasonal_reference_start'] == '2024-11-05'
            assert evidence['prediction_change_hours'] == pytest.approx(response.json()['predicted_week_hours']-response.json()['repeat_last_week_hours'])
            assert 'recent_three_day_change_fraction' in evidence['used_signals']
        assert client.get('/activity-forecast/info').json()['evaluation']['mae_reduction_percent'] == pytest.approx(1.02331675)
        empty = client.post('/activity-forecast',json={'latitude':89,'longitude':0})
        assert empty.json()['status'] == 'insufficient_data'
        assert client.get('/cases').json() == {'cases': []}
        assert client.get('/health').json() == {'status':'ok'}
        selected_method = service.bundle['default_method']
        service.bundle['default_method'] = 'repeat_last_week'
        repeated = service.predict(27.5, 122.5)
        assert repeated['reasoning_evidence']['used_signals'] == ['last_week']
        assert repeated['reasoning_evidence']['prediction_change_hours'] == pytest.approx(0)
        service.bundle['default_method'] = selected_method
    (processed/'metadata.json').write_text('changed')
    with pytest.raises(ValueError,match='Local history differs'):
        setup(destination=processed)


def test_setup_rejects_unexpected_archive_paths(tmp_path):
    archive = tmp_path/'bad.zip'
    with ZipFile(archive,'w') as zipped:
        zipped.writestr('manifest.json',json.dumps({'../unsafe.txt':'x'}))
        zipped.writestr('../unsafe.txt','unexpected')
    with pytest.raises(ValueError,match='Unexpected inference archive'):
        setup(archive=archive,destination=tmp_path/'output')
    assert not (tmp_path/'unsafe.txt').exists()


def test_forecast_dependency_failure_does_not_disable_gfw_api(monkeypatch):
    import builtins
    original_import = builtins.__import__
    def guarded_import(name, *args, **kwargs):
        if name == 'backend.services.activity_forecast':
            raise ModuleNotFoundError("No module named 'joblib'")
        return original_import(name, *args, **kwargs)
    monkeypatch.setattr(builtins, '__import__', guarded_import)
    with TestClient(create_app(seed_fixtures=False)) as client:
        assert client.get('/health').json() == {'status': 'ok'}
        assert client.get('/cases').json() == {'cases': []}
        assert client.get('/forecast/health').json()['forecast_ready'] is False
        assert client.get('/activity-forecast/info').status_code == 503


def test_default_startup_uses_current_bundle_without_replacing_legacy_history(tmp_path, monkeypatch):
    import training.activity_forecast.setup_inference as restore
    monkeypatch.delenv('ACTIVITY_FORECAST_DATA_DIR', raising=False)
    monkeypatch.delenv('ACTIVITY_FORECAST_MODEL_PATH', raising=False)
    legacy = ROOT/'datasets/activity_forecast/processed/metadata.json'
    before = legacy.read_bytes() if legacy.exists() else None
    monkeypatch.setattr(restore, 'setup_bundled', lambda: setup_bundled(cache_root=tmp_path/'bundled'))
    with TestClient(create_app(seed_fixtures=False)) as client:
        assert client.get('/forecast/health').json()['forecast_ready'] is True
        result = client.post('/activity-forecast', json={'latitude':27.5,'longitude':122.5})
        assert result.status_code == 200 and result.json()['status'] == 'scored'
        assert client.get('/priority/health').json()['forecast_ready'] is True
    assert (legacy.read_bytes() if legacy.exists() else None) == before


def test_explicit_custom_history_is_honored_and_failure_is_actionable(tmp_path, monkeypatch):
    custom = tmp_path/'custom'
    custom.mkdir()
    original = b'{"local_training_history":true}'
    (custom/'metadata.json').write_bytes(original)
    monkeypatch.setenv('ACTIVITY_FORECAST_DATA_DIR', str(custom))
    with TestClient(create_app(seed_fixtures=False)) as client:
        assert client.get('/health').status_code == 200
        assert client.get('/forecast/health').json()['forecast_ready'] is False
        response = client.get('/activity-forecast/info')
        assert response.status_code == 503
        assert 'ACTIVITY_FORECAST_DATA_DIR' in response.json()['detail']['message']
    assert (custom/'metadata.json').read_bytes() == original


def test_bundled_cache_is_repeatable_and_changes_with_the_release(tmp_path):
    import hashlib
    archive = ROOT/'datasets/activity_forecast/inference_history.zip'
    first = setup_bundled(archive=archive, cache_root=tmp_path/'cache')
    assert setup_bundled(archive=archive, cache_root=tmp_path/'cache') == first
    revised = tmp_path/'next.zip'
    with ZipFile(archive) as source:
        files = {name: source.read(name) for name in source.namelist() if name != 'manifest.json'}
    original = files['metadata.json']
    metadata = json.loads(original)
    metadata['release_test_marker'] = 'new release'
    files['metadata.json'] = json.dumps(metadata).encode()
    with ZipFile(revised,'w') as target:
        for name, payload in files.items():
            target.writestr(name,payload)
        target.writestr('manifest.json',json.dumps({name:hashlib.sha256(payload).hexdigest() for name,payload in files.items()}))
    second = setup_bundled(archive=revised, cache_root=tmp_path/'cache')
    assert second != first
    assert (first/'metadata.json').read_bytes() == original
    assert json.loads((second/'metadata.json').read_text())['release_test_marker'] == 'new release'
