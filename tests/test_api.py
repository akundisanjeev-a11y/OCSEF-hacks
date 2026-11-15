from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from backend.config import Settings
from backend.main import create_app
from backend.ml.detector import PixelDetection


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(model_path=tmp_path / "missing.pt",
                              forecast_model_path=tmp_path / "missing.joblib", max_upload_bytes=1024))
    with TestClient(app) as client:
        yield client


def image_bytes(format="PNG", size=(40, 30)):
    buffer = BytesIO()
    Image.new("RGB", size).save(buffer, format=format)
    return buffer.getvalue()


def test_health_and_fictional_examples_work_without_weights(client):
    assert client.get("/health").json()["detector_ready"] is False
    assert client.get("/health").json()["detector_enabled"] is False
    data = client.get("/demo/matches").json()
    assert data["data_mode"] == "synthetic"
    assert {scene["observations"][0]["identity_status"] for scene in data["scenes"]} == {
        "matched", "ambiguous", "unmatched", "insufficient_data",
    }


def test_missing_weights_returns_503(client):
    response = client.post("/detections", files={"image": ("scene.png", image_bytes(), "image/png")})
    assert response.status_code == 503


def test_disabled_detector_does_not_attempt_to_load_weights(tmp_path, monkeypatch, caplog):
    def unexpected_load(*args, **kwargs):
        raise AssertionError("Disabled image detector must not attempt to load YOLO")
    monkeypatch.setattr("backend.main.ShipDetector", unexpected_load)
    settings = Settings(forecast_model_path=tmp_path / "missing-forecast.joblib")
    with TestClient(create_app(settings)) as separate:
        health = separate.get("/health").json()
        assert health["detector_enabled"] is False
        assert "disabled" in health["detector_message"]
    assert "Ship detector unavailable" not in caplog.text


def test_explicitly_enabled_detector_reports_missing_weights(tmp_path):
    settings = Settings(enable_ship_detector=True, model_path=tmp_path / "missing.pt",
                        forecast_model_path=tmp_path / "missing.joblib")
    with TestClient(create_app(settings)) as client:
        health = client.get("/health").json()
        assert health["detector_enabled"] is True
        assert health["detector_ready"] is False
        assert "MODEL_PATH" in health["detector_message"]


@pytest.mark.parametrize("payload, expected", [(b"not an image", 400), (b"x" * 1025, 413)])
def test_invalid_uploads(client, payload, expected):
    assert client.post("/detections", files={"image": ("test.png", payload, "image/png")}).status_code == expected


def test_rejects_decoded_gif_despite_png_filename(client):
    response = client.post("/detections", files={"image": ("test.png", image_bytes("GIF"), "image/png")})
    assert response.status_code == 415


def test_decoded_pixel_limit(tmp_path):
    with TestClient(create_app(Settings(model_path=tmp_path / "missing.pt",
                                       forecast_model_path=tmp_path / "missing.joblib", max_image_pixels=100))) as client:
        response = client.post("/detections", files={"image": ("test.png", image_bytes(), "image/png")})
        assert response.status_code == 413


@pytest.mark.parametrize("detections", [[], [PixelDetection((1, 2, 10, 12), 0.8)]])
def test_upload_contract_with_injected_detector(client, detections):
    # This verifies the API contract, not model accuracy.
    class StubDetector:
        def detect(self, image):
            assert image.mode == "RGB"
            return detections

    client.app.state.detector = StubDetector()
    response = client.post("/detections", files={"image": ("test.png", image_bytes(), "image/png")})
    assert response.status_code == 200
    result = response.json()
    assert (result["image_width"], result["image_height"]) == (40, 30)
    assert len(result["observations"]) == len(detections)
    for observation in result["observations"]:
        assert observation["identity_status"] == "insufficient_data"
        assert observation["mmsi"] is None and observation["position"] is None
        assert observation["data_mode"] == "model_upload"


def test_matches_route(client):
    from tests.test_matching import SCENES
    response = client.post("/matches", json=SCENES[0]["request"])
    assert response.status_code == 200
    assert response.json()["observations"][0]["mmsi"] == "999000001"


def test_malformed_match_is_422(client):
    assert client.post("/matches", json={"observations": []}).status_code == 422


def test_cors_for_local_frontend(client):
    response = client.options("/matches", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
    })
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    response = client.options("/matches", headers={
        "Origin": "https://unlisted.example", "Access-Control-Request-Method": "POST",
    })
    assert "access-control-allow-origin" not in response.headers
