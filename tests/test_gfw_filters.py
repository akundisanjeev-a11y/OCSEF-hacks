import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError

from backend.services.gfw_credentials import get_gfw_token, KEYS
from backend.services import gfw_credentials
from backend.services.historical import AreaQuery, activity_filter, report, report_rows, DATASETS


def test_env_and_bare_file_credentials_are_read_without_rewriting(tmp_path,monkeypatch):
    for key in KEYS: monkeypatch.delenv(key,raising=False)
    monkeypatch.setattr(gfw_credentials,'ROOT',tmp_path)
    (tmp_path/'backend').mkdir()
    path=tmp_path/'backend/.env'
    path.write_text('abc.def.ghi')
    assert get_gfw_token()=='abc.def.ghi'
    monkeypatch.setenv('GFW_API_TOKEN','environment-value')
    assert get_gfw_token()=='environment-value'
    assert path.read_text()=='abc.def.ghi'
    monkeypatch.delenv('GFW_API_TOKEN')
    path.write_text('GFW_API_TOKEN\nGFW_TOKEN=dotenv-value\n')
    assert get_gfw_token()=='dotenv-value'


def test_structured_filters_are_applied_to_both_report_types():
    q=AreaQuery(west=1,east=2,south=1,north=2,layer='fishing',flag=['ESP','USA'],
                geartype=['trawlers'],distance_from_port_km=3)
    upstream=AsyncMock(return_value={'entries':[{DATASETS['fishing']:[]}]})
    async def run():
        with patch('backend.services.historical.gfw_request',upstream):
            for vessels in [False,True]: await report(q,'start','end',vessels=vessels)
    asyncio.run(run())
    for call in upstream.call_args_list:
        filters=call.kwargs['params']['filters[0]']
        assert "flag in ('ESP', 'USA')" in filters
        assert "geartype in ('trawlers')" in filters
        assert 'distance_from_port_km = 3' in filters


@pytest.mark.parametrize('changes',[
    {'flag':["USA') OR 1=1"]}, {'vessel_type':"cargo'"},
    {'layer':'presence','geartype':['trawlers']},
    {'layer':'sar','hours_ago':124,'flag':['USA']},
    {'distance_from_port_km':6}, {'layer':'fishing','speed':'2-4'},
])
def test_invalid_or_incompatible_filters_are_rejected(changes):
    with pytest.raises(ValidationError):AreaQuery(west=1,east=2,south=1,north=2,**changes)


def test_empty_resolved_reports_and_sar_thresholds():
    assert report_rows({'entries':[{'public-global-sar-presence:v5.0':None}]},DATASETS['sar'])==[]
    q=AreaQuery(west=1,east=2,south=1,north=2,layer='sar',hours_ago=124,sar_matched='true',
                flag=['USA'],shiptype='cargo')
    filters=activity_filter(q)
    assert "matched='true'" in filters and "shiptype = 'cargo'" in filters
    with pytest.raises(ValidationError,match='stored as text'):
        AreaQuery(west=1,east=2,south=1,north=2,layer='sar',hours_ago=124,neural_vessel_type='likely_fishing')
