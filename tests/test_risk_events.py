import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.services import risk_events as service

EVENT = {"id": "event-1", "vessel": {"id": "boat-1"}, "type": "gap", "start": "2026-01-01T01:00:00Z", "end": "2026-01-01T13:00:00Z", "position": {"lat": 5, "lon": 5}, "distances": {"startDistanceFromPortKm": 21}, "regions": {"mpaNoTake": [], "rfmo": ["ICCAT"]}}

def query(**changes):
    return service.RiskEventRequest(**{"vessel_id": "boat-1", "code": "ais_gap", "event_ids": ["event-1"], "start": "2026-01-01T00:00:00Z", "end": "2026-01-02T00:00:00Z", "area": {"west": 0, "east": 1, "south": 0, "north": 1}, **changes})

def test_source_event_facts_do_not_assume_location_inside_selection_or_port_visit():
    result = service.summarize_event(EVENT, "event-1", query())
    assert result['status'] == 'matched'
    assert result['reported_point_in_selected_area'] is False
    assert result['duration_hours'] == 12
    assert result['start_distance_from_port_km'] == 21
    assert 'intent' in result['scope_note']
    assert 'port_visit' not in result

@pytest.mark.parametrize('change', [
    {'vessel': {'id': 'other-boat'}}, {'start': '2025-01-01T00:00:00Z', 'end': '2025-01-02T00:00:00Z'},
    {'id': 'other-event'}, {'start': 'invalid'}, {'start': '2026-01-01T00:00:00'},
])
def test_irrelevant_or_unverifiable_records_are_not_used(change):
    result = service.summarize_event({**EVENT, **change}, 'event-1', query())
    assert result['status'] == 'unverified'
    assert 'position' not in result

def test_missing_coordinates_and_distances_are_not_invented_or_swapped():
    result = service.summarize_event({**EVENT, 'position': {'lat': 125, 'lon': 12}, 'distances': {'startDistanceFromPortKm': False}}, 'event-1', query())
    assert result['position'] is None
    assert result['reported_point_in_selected_area'] is None
    assert result['start_distance_from_port_km'] is None

@pytest.mark.parametrize('event', [None, [], {**EVENT, 'type': 'fishing'}, {**EVENT, 'end': EVENT['start']}])
def test_unrelated_event_types_and_invalid_event_shapes_cannot_explain_a_gap(event):
    result = service.summarize_event(event, 'event-1', query())
    assert result['status'] == 'unverified'
    assert 'position' not in result


def test_cached_source_is_revalidated_for_each_boat_and_area():
    service._cache.clear()
    mock = AsyncMock(return_value=deepcopy(EVENT))
    async def run():
        with patch.object(service, 'gfw_request', mock):
            first = await service.load_risk_events(query())
            other = await service.load_risk_events(query(vessel_id='boat-2'))
        return first, other
    first, other = asyncio.run(run())
    assert first['events'][0]['status'] == 'matched'
    assert other['events'][0]['status'] == 'unverified'
    assert mock.await_count == 1

def test_event_access_failure_stays_unavailable_and_requests_are_bounded():
    service._cache.clear()
    with TestClient(create_app(seed_fixtures=False, load_forecast=False)) as client:
        for changes in [{'event_ids':['a','b','c','d']}, {'event_ids':['bad/id']}, {'code':'unknown'}]:
            payload=query().model_dump(mode='json'); payload.update(changes)
            assert client.post('/historical/risk-events',json=payload).status_code == 422
        with patch.object(service, 'gfw_request', AsyncMock(side_effect=HTTPException(403, 'Dataset access denied'))):
            response=client.post('/historical/risk-events',json=query().model_dump(mode='json'))
        assert response.status_code == 200
        assert response.json()['events'][0]['status'] == 'unavailable'
    assert not service._cache
