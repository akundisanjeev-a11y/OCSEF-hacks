import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.services.vessel_search import VesselSearch, search_vessels
from backend.services.historical import IDENTITY


def test_search_uses_gfw_identity_and_preserves_distinct_historical_ids():
    upstream = AsyncMock(return_value={"entries": [
        {"selfReportedInfo": [{"id": "a", "ssvid": "211307720", "shipname": "SHIP"}, {"id": "b", "ssvid": "211307720"}]},
        {"selfReportedInfo": [{"id": "a"}]}, {"registryInfo": [{"id": "registry-id", "shipname": "OTHER"}]},
        {"selfReportedInfo": [{"shipname": "NO RESOLVABLE ID"}]}, None], "since": "next-page"})
    with patch("backend.services.vessel_search.gfw_request", upstream):
        result = asyncio.run(search_vessels(VesselSearch(query=" 211307720 ", since="cursor")))
    assert [row["vessel_id"] for row in result["results"]] == ["a", "b", "registry-id"]
    assert result["since"] == "next-page"
    upstream.assert_awaited_once_with("vessels/search", params={"datasets[0]": IDENTITY, "query": "211307720", "limit": 20, "since": "cursor"})


def test_empty_search_never_substitutes_fixture_vessels():
    with patch("backend.services.vessel_search.gfw_request", AsyncMock(return_value={"entries": []})):
        assert asyncio.run(search_vessels(VesselSearch(query="missing")))["results"] == []


def test_search_route_rejects_blank_query_and_propagates_provider_failure():
    app = create_app(seed_fixtures=False, load_forecast=False)
    with TestClient(app) as client:
        assert client.post("/historical/vessels/search", json={"query": "   "}).status_code == 422
        with patch("backend.services.vessel_search.gfw_request", AsyncMock(side_effect=HTTPException(401, "GFW token rejected"))):
            response = client.post("/historical/vessels/search", json={"query": "211307720"})
    assert response.status_code == 401
    assert response.json()["detail"] == "GFW token rejected"


def test_search_explains_missing_identity_permissions_without_demo_fallback():
    with patch("backend.services.vessel_search.gfw_request", AsyncMock(side_effect=HTTPException(403, "Not authorized by permissions"))):
        with pytest.raises(HTTPException) as error:
            asyncio.run(search_vessels(VesselSearch(query="368045130")))
    assert error.value.status_code == 403
    assert "Vessels API" in error.value.detail
    assert "Activity-map access alone is insufficient" in error.value.detail
