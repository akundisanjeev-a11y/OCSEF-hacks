import asyncio
from unittest.mock import AsyncMock

from backend.services import historical
from backend.services.priority_features import source_date


def test_optional_pinned_report_and_shared_client_preserve_legacy_defaults(monkeypatch):
    query=historical.AreaQuery(west=0,south=0,east=5,north=5)
    call=AsyncMock(return_value={'entries':[]})
    monkeypatch.setattr(historical,'gfw_request',call)
    asyncio.run(historical.report(query,'2025-11-05','2025-11-12'))
    assert call.call_args.kwargs['params']['datasets[0]']==historical.DATASETS['presence']
    assert 'client' not in call.call_args.kwargs
    shared=object()
    asyncio.run(historical.report(query,'2025-11-05','2025-11-12',dataset='public-global-presence:v5.0',client=shared))
    assert call.call_args.kwargs['params']['datasets[0]']=='public-global-presence:v5.0'
    assert call.call_args.kwargs['client'] is shared


def test_pinned_identity_and_insights_keep_requested_period_and_client(monkeypatch):
    call=AsyncMock(side_effect=[{'selfReportedInfo':[]},{}])
    monkeypatch.setattr(historical,'gfw_request',call)
    query=historical.VesselEnrichment(vessel_id='v1',start='2025-11-05T00:00:00Z',end='2025-11-12T00:00:00Z')
    shared=object()
    result=asyncio.run(historical.enrich_vessel(query,client=shared,identity_dataset='public-global-vessel-identity:v5.0'))
    assert call.call_args_list[0].kwargs['params']['dataset']=='public-global-vessel-identity:v5.0'
    body=call.call_args_list[1].kwargs['body']
    assert body['vessels'][0]['datasetId']=='public-global-vessel-identity:v5.0'
    assert source_date(body['startDate'])==query.start
    assert source_date(result['end'])==query.end
    assert all(item.kwargs['client'] is shared for item in call.call_args_list)
