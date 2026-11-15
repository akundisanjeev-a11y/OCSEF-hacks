from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.services import risk_screening


def test_full_report_and_screening_send_the_same_boat_and_exact_utc_period():
    period = {'start': '2025-12-31T16:00:00-08:00', 'end': '2026-01-01T16:00:00-08:00'}
    insights = {'gap': {'aisOff': ['source-event']}}
    full_upstream = AsyncMock(side_effect=[{'selfReportedInfo': [{'id': 'boat-one'}]}, insights])
    risk_upstream = AsyncMock(return_value=insights)
    risk_screening._cache.clear()
    with TestClient(create_app(seed_fixtures=False, load_forecast=False)) as client:
        with patch('backend.services.historical.gfw_request', full_upstream):
            full = client.post('/historical/vessel', json={'mode': 'gfw', 'vessel_id': 'boat-one', **period})
        with patch('backend.services.risk_screening.gfw_request', risk_upstream):
            screen = client.post('/historical/risks', json={'vessel_ids': ['boat-one'], **period})
    assert full.status_code == screen.status_code == 200
    full_body = full_upstream.await_args_list[1].kwargs['body']
    screen_body = risk_upstream.await_args.kwargs['body']
    for body in [full_body, screen_body]:
        assert body['vessels'][0]['vesselId'] == 'boat-one'
        assert body['startDate'] == full.json()['start'] == '2026-01-01T00:00:00.000Z'
        assert body['endDate'] == full.json()['end'] == '2026-01-02T00:00:00.000Z'
    result = screen.json()['results'][0]
    assert result['vessel_id'] == full.json()['vessel_id'] == 'boat-one'
    assert [(i['code'], i['count']) for i in result['indicators']] == [(i['code'], i['count']) for i in full.json()['indicators']]
