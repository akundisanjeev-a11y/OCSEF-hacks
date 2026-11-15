from pathlib import Path
from zipfile import ZipFile
import json

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.services.activity_forecast import ActivityForecaster
from training.activity_forecast.setup_inference import setup


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
