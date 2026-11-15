"""Independent truth tables and hostile-source cases, not accuracy claims."""
import asyncio
from copy import deepcopy
from itertools import product
import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.services.historical import decode_response, summarize_evidence
from backend.services.risk_evidence import assess_risk
from backend.services import risk_screening as screening

PERIOD = {'start': '2026-01-01T00:00:00Z', 'end': '2026-01-02T00:00:00Z'}
CONTEXT = {'vessel_id': 'boat-one', **PERIOD}


def source(counts=(0, 0, 0, 0)):
    return {
        'apparentFishing': {'periodSelectedCounters': {'eventsInNoTakeMPAs': counts[0], 'eventsInRFMOWithoutKnownAuthorization': counts[1]}},
        'gap': {'aisOff': None if counts[2] is None else [f'gap-{i}' for i in range(counts[2])]},
        'vesselIdentity': {'iuuVesselList': {'totalTimesListedInThePeriod': counts[3]}},
    }


@pytest.mark.parametrize('counts', list(product([0, 1, None], repeat=4)))
def test_all_81_positive_zero_and_missing_combinations(counts):
    payload = source(counts)
    original = deepcopy(payload)
    result = assess_risk(payload, **CONTEXT)
    expected = 'flagged' if 1 in counts else 'unknown' if None in counts else 'no_flags'
    assert result['state'] == expected
    assert result['flag_count'] == counts.count(1)
    assert result['missing_count'] == counts.count(None)
    assert [i['count'] for i in result['indicators']] == list(counts)
    assert summarize_evidence({}, payload)[1] == result['indicators']
    assert payload == original  # Parsing never rewrites source evidence.
    assert 'authorization' not in result


@pytest.mark.parametrize('value', [True, False, -1, -0.5, 0.5, 1.25, '0', '2', '', {}, [], float('nan'), float('inf'), -float('inf'), 2**53, 10**500])
@pytest.mark.parametrize('index', [0, 1, 3])
def test_invalid_counts_never_create_a_flag_or_a_clean_check(value, index):
    counts = [0, 0, 0, 0]
    counts[index] = value
    result = assess_risk(source(counts), **CONTEXT)
    assert result['state'] == 'unknown'
    assert result['flag_count'] == 0
    assert result['missing_count'] == 1
    assert result['indicators'][index]['count'] is None
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize('field', ['apparentFishing', 'gap', 'gaps', 'vesselIdentity', 'period', 'vesselIdsWithoutIdentity'])
@pytest.mark.parametrize('value', [None, True, 3, 'invalid', [], [None], {'unexpected': 1}])
def test_malformed_nested_fields_are_bounded_serializable_and_never_raise(field, value):
    payload = {field: value}
    result = assess_risk(payload, **CONTEXT)
    assert result['state'] == 'unknown'
    assert result['flag_count'] == 0
    assert len(result['indicators']) == 4
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize('payload', [None, [], True, 0, 'error'])
def test_malformed_root_does_not_crash_or_become_clean(payload):
    result = assess_risk(payload, **CONTEXT)
    assert result['state'] == 'unknown' and result['missing_count'] == 4


def test_unique_valid_events_are_counted_once_and_invalid_entries_are_not_invented():
    good = assess_risk({'gap': {'aisOff': ['one', 'one', 'two']}}, **CONTEXT)['indicators'][2]
    assert good['count'] == 2 and good['event_ids'] == ['one', 'two']
    assert good['count_is_lower_bound']
    bad = assess_risk({'gap': {'aisOff': ['one', None, {}, True, '', 'bad/id', 'a'*201]}}, **CONTEXT)
    assert bad['state'] == 'flagged' and bad['missing_count'] == 4
    assert bad['indicators'][2]['count'] is None
    assert bad['indicators'][2]['event_ids'] == ['one']
    assert bad['indicators'][2]['quality_notes']
    assert assess_risk({'gap': {'aisOff': [None, True, {}]}}, **CONTEXT)['state'] == 'unknown'


def test_conflicting_zero_and_positive_source_is_flagged_without_inventing_exact_count():
    payload = source()
    payload['apparentFishing']['eventsInNoTakeMpas'] = ['event-one']
    result = assess_risk(payload, **CONTEXT)
    assert result['state'] == 'flagged' and result['missing_count'] == 1
    indicator = result['indicators'][0]
    assert indicator['status'] == 'conflicting' and indicator['count'] is None
    assert indicator['reported_positive'] and indicator['quality_notes']
    # Documentation permits event arrays shorter than the summary counter.
    payload['apparentFishing']['periodSelectedCounters']['eventsInNoTakeMPAs'] = 5
    assert assess_risk(payload, **CONTEXT)['indicators'][0]['count'] == 5


def test_explicit_invalid_counter_is_not_replaced_with_zero_from_an_empty_array():
    payload = source((None, 0, 0, 0))
    payload['apparentFishing']['eventsInNoTakeMpas'] = []
    assert assess_risk(payload, **CONTEXT)['state'] == 'unknown'
    del payload['apparentFishing']['periodSelectedCounters']['eventsInNoTakeMPAs']
    assert assess_risk(payload, **CONTEXT)['state'] == 'no_flags'


def test_conflicting_gap_aliases_do_not_silently_choose_the_empty_one():
    payload = source()
    payload['gaps'] = {'aisOff': ['real-gap']}
    result = assess_risk(payload, **CONTEXT)
    assert result['state'] == 'flagged'
    assert result['indicators'][2]['count'] is None
    assert result['indicators'][2]['event_ids'] == ['real-gap']


@pytest.mark.parametrize('section', ['apparentFishing', 'gap', 'vesselIdentity'])
def test_other_vessel_sections_cannot_flag_the_requested_vessel(section):
    payload = source((1, 1, 1, 1))
    payload[section]['vesselId'] = 'other-boat'
    result = assess_risk(payload, **CONTEXT)
    indexes = [0, 1] if section == 'apparentFishing' else [2] if section == 'gap' else [3]
    for index in indexes:
        assert result['indicators'][index]['status'] == 'unverified'
        assert result['indicators'][index]['count'] is None
        assert not result['indicators'][index]['event_ids']
        assert not result['indicators'][index]['reported_positive']


@pytest.mark.parametrize('extra', [{'vesselIdsWithoutIdentity': ['boat-one']}, {'vesselId': 'wrong-boat'}, {'period': {'startDate': '2025-01-01'}}, {'period': {'endDate': 'not-a-date'}}, {'period': {'startDate': '2026-01-01T01:00:00Z'}}])
def test_unattributable_source_cannot_flag_or_clear_any_check(extra):
    result = assess_risk({**source((1, 1, 1, 1)), **extra}, **CONTEXT)
    assert result['state'] == 'unknown' and result['flag_count'] == 0
    assert result['missing_count'] == 4 and result['quality_notes']


def test_day_labels_do_not_claim_hour_precision_and_equivalent_offsets_match():
    payload = {**source(), 'period': {'startDate': '2026-01-01', 'endDate': '2026-01-02'}}
    result = assess_risk(payload, **CONTEXT)
    assert result['state'] == 'no_flags' and result['source_period_precision'] == 'calendar_day'
    payload['period']['startDate'] = '2025-12-31T16:00:00-08:00'
    payload['period']['endDate'] = PERIOD['end']
    assert assess_risk(payload, **CONTEXT)['source_period_precision'] == 'instant'


def test_live_optional_null_identity_marker_does_not_invalidate_valid_zero_counts():
    payload = {**source(), 'vesselIdsWithoutIdentity': None, 'period': {'startDate': '2026-01-01', 'endDate': '2026-01-02'}}
    result = assess_risk(payload, **CONTEXT)
    assert result['state'] == 'no_flags' and result['missing_count'] == 0
    assert not result['quality_notes']


def test_lifetime_counters_and_unrelated_fields_never_become_current_flags():
    payload = {'apparentFishing': {'historicalCounters': {'eventsInNoTakeMPAs': 99, 'eventsInRFMOWithoutKnownAuthorization': 99}}, 'vesselIdentity': {'iuuVesselList': {'totalTimesListed': 20}}, 'coverage': {'percentage': 0}, 'portVisits': {'events': 200}}
    assert assess_risk(payload, **CONTEXT)['flag_count'] == 0
    assert assess_risk(payload, **CONTEXT)['missing_count'] == 4


@pytest.mark.parametrize('since,until,positive', [('2025-12-31T00:00:00Z', '2026-01-01T12:00:00Z', True), ('2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z', False), ('2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z', False), ('invalid', '2026-01-03T00:00:00Z', False), ('2026-01-01', '2026-01-02', False)])
def test_listing_intervals_require_a_real_overlap_not_a_current_listing_assumption(since, until, positive):
    payload = source()
    payload['vesselIdentity']['iuuVesselList']['valuesInThePeriod'] = [{'from': since, 'to': until}]
    result = assess_risk(payload, **CONTEXT)
    assert (result['state'] == 'flagged') is positive
    assert result['indicators'][3]['count'] is None
    assert result['state'] == ('flagged' if positive else 'unknown')


def test_zero_counters_with_malformed_event_or_listing_records_are_not_clean():
    for field in ['eventsInNoTakeMpas', 'eventsInRfmoWithoutKnownAuthorization']:
        payload = source()
        payload['apparentFishing'][field] = [None, {'id': 'not-a-documented-ID-array'}]
        result = assess_risk(payload, **CONTEXT)
        assert result['state'] == 'unknown' and result['missing_count'] == 1
    payload = source()
    payload['vesselIdentity']['iuuVesselList']['valuesInThePeriod'] = 'malformed'
    assert assess_risk(payload, **CONTEXT)['state'] == 'unknown'


@pytest.mark.parametrize('raw', [b'{"x":NaN}', b'{"x":Infinity}', b'{"x":-Infinity}', b'{"x":1e400}', b'{"count":1,"count":0}'])
def test_ambiguous_or_non_finite_json_is_rejected_at_transport(raw):
    with pytest.raises(ValueError):
        decode_response(raw)


@pytest.mark.parametrize('status', [401, 403, 429, 502, 503])
def test_provider_failures_preserve_identity_but_never_become_clean_or_cached(status):
    screening._cache.clear()
    screening._inflight.clear()
    screening._semaphore = asyncio.Semaphore(4)
    with TestClient(create_app(seed_fixtures=False, load_forecast=False)) as client:
        with patch('backend.services.historical.gfw_request', AsyncMock(side_effect=[{'selfReportedInfo': [{'id': 'boat-one'}]}, HTTPException(status, 'Source unavailable')])):
            full = client.post('/historical/vessel', json={'mode': 'gfw', 'vessel_id': 'boat-one', **PERIOD})
        with patch('backend.services.risk_screening.gfw_request', AsyncMock(side_effect=HTTPException(status, 'Source unavailable'))):
            risk = client.post('/historical/risks', json={'vessel_ids': ['boat-one'], **PERIOD})
    assert full.status_code == risk.status_code == 200
    assert full.json()['risk']['state'] == 'unknown' and full.json()['risk']['missing_count'] == 4
    assert full.json()['summary']['documentation'] == 'ais_identity_only'
    assert full.json()['authorization']['status'] == 'unknown'
    assert risk.json()['results'][0]['error_status'] == status
    assert risk.json()['results'][0]['state'] == 'unknown'
    assert not screening._cache


@pytest.mark.parametrize('counts', [(0,0,0,0), (1,0,0,0), (0,1,0,0), (0,0,1,0), (0,0,0,1), (1,None,0,0), (None,None,None,None), (True,0,0,0)])
def test_full_report_and_screening_use_identical_decisions_and_never_authorize(counts):
    screening._cache.clear()
    screening._inflight.clear()
    screening._semaphore = asyncio.Semaphore(4)
    payload = source(counts)
    with TestClient(create_app(seed_fixtures=False, load_forecast=False)) as client:
        with patch('backend.services.historical.gfw_request', AsyncMock(side_effect=[{}, payload])):
            full = client.post('/historical/vessel', json={'vessel_id': 'boat-one', **PERIOD}).json()
        with patch('backend.services.risk_screening.gfw_request', AsyncMock(return_value=payload)):
            risk = client.post('/historical/risks', json={'vessel_ids': ['boat-one'], **PERIOD}).json()['results'][0]
    assert {k: full['risk'][k] for k in ['state','flag_count','missing_count']} == {k: risk[k] for k in ['state','flag_count','missing_count']}
    assert [{**i, 'event_ids': []} for i in full['indicators']] == risk['indicators']
    assert full['authorization']['status'] == 'unknown'


def test_partial_flagged_cache_expires_in_one_minute_and_known_cache_in_fifteen():
    key = ('boat-one', PERIOD['start'], PERIOD['end'])
    for counts, ttl in [((1,None,0,0),60), ((1,0,0,0),900), ((0,0,0,0),900), ((None,None,None,None),60)]:
        screening._cache[key] = (100, assess_risk(source(counts)))
        with patch.object(screening.time, 'monotonic', return_value=100+ttl-1):
            assert screening.cached_risk(key)['cached']
        with patch.object(screening.time, 'monotonic', return_value=100+ttl):
            assert screening.cached_risk(key) is None
    screening._cache.clear()


def test_unstarted_legacy_batch_entries_do_not_invent_rate_limit_errors():
    screening._cache.clear()
    screening._inflight.clear()
    screening._semaphore = asyncio.Semaphore(4)
    async def run():
        query = screening.RiskScreenRequest(vessel_ids=[f'boat-{i}' for i in range(16)], **PERIOD)
        with patch.object(screening, 'gfw_request', AsyncMock(side_effect=HTTPException(401, 'Token rejected'))):
            return await screening.screen_risks(query)
    result = asyncio.run(run())
    attempted = [r for r in result['results'] if not r.get('not_checked')]
    unstarted = [r for r in result['results'] if r.get('not_checked')]
    assert 1 <= len(attempted) <= 4 and len(unstarted) >= 12
    assert all(r['error_status'] == 401 for r in attempted)
    assert all(r['error_status'] is None and r['state'] == 'unknown' for r in unstarted)


@pytest.mark.parametrize('raw', [b'{"gap":{"aisOff":[]},"x":NaN}', b'{"gap":{"aisOff":[]},"x":1e400}', b'{"gap":{"aisOff":["one"],"aisOff":[]}}'])
def test_bad_source_json_yields_incomplete_full_report_instead_of_a_serialization_crash(raw):
    def handler(request):
        if '/vessels/boat-one' in request.url.path:
            return httpx.Response(200, json={'selfReportedInfo': [{'id': 'boat-one'}]})
        return httpx.Response(200, content=raw)
    client_factory = httpx.AsyncClient
    with TestClient(create_app(seed_fixtures=False, load_forecast=False)) as client:
        with patch('backend.services.historical.get_gfw_token', return_value='private-test-token'), patch('backend.services.historical.httpx.AsyncClient', side_effect=lambda **kwargs: client_factory(transport=httpx.MockTransport(handler), **kwargs)):
            response = client.post('/historical/vessel', json={'vessel_id': 'boat-one', **PERIOD})
    assert response.status_code == 200
    assert response.json()['risk']['state'] == 'unknown'
    assert response.json()['risk']['missing_count'] == 4
    assert response.json()['warnings']
    assert response.json()['authorization']['status'] == 'unknown'
