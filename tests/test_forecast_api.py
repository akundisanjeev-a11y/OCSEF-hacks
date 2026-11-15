import hashlib
import json

from fastapi.testclient import TestClient
import joblib
import pandas as pd
import pytest
from sklearn.tree import DecisionTreeRegressor

from backend.config import Settings
from backend.main import create_app
from backend.services.activity_forecast import ActivityForecaster
from training.activity_forecast.common import FEATURES
from training.activity_forecast.seasonal import RULE_FEATURES


@pytest.fixture
def forecast_files(tmp_path):
    processed = tmp_path / "processed"
    metadata = {"dataset": "test-source", "grid_degrees": 5, "availability_lag_days": 3}

    def write_block(name, start, end):
        directory = processed / name
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "metadata.json").write_text(json.dumps(metadata))
        frame = pd.concat([
            pd.DataFrame({"cell_id": cell, "date": pd.date_range(start, end), "fishing_hours": hours})
            for cell, hours in [("lat23_lon60", 20.), ("lat20_lon40", 0.)]
        ], ignore_index=True)
        frame.to_csv(directory / "daily_world.csv", index=False)

    write_block("", "2025-07-01", "2025-07-20")
    write_block("fresh_test", "2025-07-21", "2025-07-31")
    write_block("seasonal_history", "2024-07-01", "2024-07-31")
    write_block("inference_reference", "2024-08-01", "2024-08-31")
    tree = DecisionTreeRegressor(max_depth=2).fit(
        pd.DataFrame([[0., 0.], [1., 1.]], columns=RULE_FEATURES), [0.1, 0.1])
    bundle = {
        "schema_version": 2, "feature_names": FEATURES,
        "data_metadata": metadata, "version": "test-model", "default_method": "seasonal_correction_tree",
        "trained_label_available_through": "2025-06-30",
        "models": {"correction_tree": tree, "blend_weights": [1., 0.], "calibration_scale": 1.},
    }
    model = tmp_path / "best_model.joblib"
    joblib.dump(bundle, model)
    sha = hashlib.sha256(model.read_bytes()).hexdigest()
    model.with_name("best_model_metadata.json").write_text(json.dumps({
        "model_sha256": sha, "evaluation": {"model_sha256": sha, "fresh_test": {
            "issue_start": "2025-07-05", "issue_end": "2025-07-24", "rows": 10, "cells": 2,
            "mae_hours": 9., "baseline_mae_hours": 10., "rmse_hours": 11.,
            "baseline_rmse_hours": 12., "mae_reduction_percent": 10.,
        }},
    }))
    return model, processed


@pytest.fixture
def client(forecast_files, tmp_path):
    model, processed = forecast_files
    settings = Settings(model_path=tmp_path / "missing.pt", forecast_model_path=model,
                        forecast_processed_dir=processed)
    with TestClient(create_app(settings)) as client:
        yield client


def test_real_model_pipeline_and_info_contract(client):
    assert client.get("/health").json()["forecast_ready"] is True
    info = client.get("/api/activity-forecast/info")
    assert info.status_code == 200
    assert info.json()["data_mode"] == "historical_demo"
    assert info.json()["evaluation"]["mae_reduction_percent"] == 10.
    response = client.post("/api/activity-forecast", json={"latitude": 27.5, "longitude": 122.5})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "scored"
    assert body["predicted_week_hours"] == pytest.approx(154.)
    assert body["repeat_last_week_hours"] == 140.
    assert body["seasonal_reference_available"] is True
    assert body["observation_cutoff"] == "2025-07-31"
    assert body["target_start"] == "2025-08-04"
    assert body["target_end"] == "2025-08-10"
    assert body["bounds"] == {"south": 25, "north": 30, "west": 120, "east": 125}
    assert body["model_version"] == "test-model"


def test_zero_history_is_not_reported_as_zero_prediction(client):
    response = client.post("/api/activity-forecast", json={"latitude": 12, "longitude": 22})
    assert response.status_code == 200
    assert response.json()["status"] == "insufficient_data"
    assert "predicted_week_hours" not in response.json()
    assert response.json()["target_start"] == "2025-08-04"


def test_no_history_for_a_cell_is_supported(client):
    response = client.post("/api/activity-forecast", json={"latitude": 89, "longitude": -170})
    assert response.status_code == 200
    assert response.json()["reason"] == "no_downloaded_history"


@pytest.mark.parametrize("payload", [
    {"latitude": 91, "longitude": 0}, {"latitude": 0, "longitude": -181},
    {"latitude": "27.5", "longitude": 122.5}, {"latitude": True, "longitude": 0},
    {"latitude": 0}, {"latitude": 0, "longitude": 0, "cutoff": "2025-07-31"},
])
def test_invalid_coordinates_and_extra_input_are_422(client, payload):
    assert client.post("/api/activity-forecast", json=payload).status_code == 422


def test_missing_model_returns_503_and_other_routes_stay_available(tmp_path):
    settings = Settings(model_path=tmp_path / "missing.pt", forecast_model_path=tmp_path / "missing.joblib")
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").json()["forecast_ready"] is False
        assert client.get("/api/activity-forecast/info").status_code == 503
        response = client.post("/api/activity-forecast", json={"latitude": 27.5, "longitude": 122.5})
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "forecast_unavailable"
        assert "missing.joblib" not in response.text
        assert client.get("/demo/matches").status_code == 200


def test_bad_source_or_duplicate_rows_are_rejected(forecast_files):
    model, processed = forecast_files
    metadata_path = processed / "inference_reference/metadata.json"
    original = metadata_path.read_text()
    metadata_path.write_text(json.dumps({"dataset": "wrong", "grid_degrees": 5}))
    with pytest.raises(ValueError, match="source/grid"):
        ActivityForecaster(model, processed)
    metadata_path.write_text(original)
    path = processed / "fresh_test/daily_world.csv"
    frame = pd.read_csv(path)
    pd.concat([frame, frame.iloc[[0]]]).to_csv(path, index=False)
    with pytest.raises(ValueError, match="Duplicate"):
        ActivityForecaster(model, processed)


def test_saved_checkpoint_checksum_is_enforced(forecast_files):
    model, processed = forecast_files
    path = model.with_name("best_model_metadata.json")
    metadata = json.loads(path.read_text())
    metadata["model_sha256"] = "different"
    path.write_text(json.dumps(metadata))
    with pytest.raises(ValueError, match="checksum"):
        ActivityForecaster(model, processed)


def test_forecast_route_cors(client):
    response = client.options("/api/activity-forecast", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    response = client.options("/api/activity-forecast", headers={
        "Origin": "https://unlisted.example", "Access-Control-Request-Method": "POST",
    })
    assert "access-control-allow-origin" not in response.headers


def test_prediction_uses_loaded_files_without_reloading_or_training(client, monkeypatch):
    def unexpected_read(*args, **kwargs):
        raise AssertionError("Prediction requests must use the already loaded files")
    monkeypatch.setattr(pd, "read_csv", unexpected_read)
    monkeypatch.setattr(joblib, "load", unexpected_read)
    for _ in range(2):
        response = client.post("/api/activity-forecast", json={"latitude": 27.5, "longitude": 122.5})
        assert response.status_code == 200
        assert response.json()["status"] == "scored"


def test_missing_optional_annual_extension_discloses_fallback(forecast_files):
    model, processed = forecast_files
    (processed / "inference_reference/daily_world.csv").unlink()
    result = ActivityForecaster(model, processed).predict(27.5, 122.5)
    assert result["status"] == "scored"
    assert result["seasonal_reference_available"] is False
    assert result["data_quality_notes"]
