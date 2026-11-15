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
            assert response.json()['predicted_week_hours'] == pytest.approx(34722.984290720226)
            assert response.json()['data_mode'] == 'historical_demo'
        assert client.get('/activity-forecast/info').json()['evaluation']['mae_reduction_percent'] == pytest.approx(6.78043254)
        empty = client.post('/activity-forecast',json={'latitude':89,'longitude':0})
        assert empty.json()['status'] == 'insufficient_data'
        assert client.get('/cases').json() == {'cases': []}
        assert client.get('/health').json() == {'status':'ok'}
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
