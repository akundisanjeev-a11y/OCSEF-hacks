from fastapi.testclient import TestClient

from backend.main import create_app


def test_health_reports_process_readiness_without_external_api_calls():
    with TestClient(create_app(seed_fixtures=False)) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
