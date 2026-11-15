from copy import deepcopy

import pytest

from backend.services.priority_score import score_features,policy,category_for


def extraction():
    inputs={
        'local_events':{'representative_event_points_inside_by_code':{'fishing_in_no_take_mpa':0,'no_known_rfmo_authorization':0,'ais_gap':0}},
        'vessel_context':{'associated_vessel_ids_with_positive_indicator':{'iuu_listing':0,'fishing_in_no_take_mpa':0,'no_known_rfmo_authorization':0,'ais_gap':0}},
        'sar_all':{'total':10},'sar_matched':{'total':10},'sar_unmatched':{'total':0},
        'presence':{'total':0,'selection_area_km2':1000,'selection_duration_hours':168},
        'fishing':{'total':0,'selection_area_km2':1000,'selection_duration_hours':168},
        'forecast':{'predicted_week_hours':10,'repeat_last_week_hours':10}}
    return {'scoring_inputs':inputs,'components':{key:{'status':'complete','eligible_for_scoring':True,
        'temporal_alignment':'exact_requested_interval'} for key in inputs},
        'area':{'west':0,'south':0,'east':5,'north':5},'start':'2025-11-05T00:00:00Z',
        'end_exclusive':'2025-11-12T00:00:00Z','filters':{},'selection_key':'test','excluded_components':{}}


def test_known_zero_indicators_with_observed_sar_can_be_minimal():
    result=score_features(extraction())
    assert result['priority_score']==0 and result['priority_category']=='Minimal'
    assert result['coverage_percent']==100 and result['status']=='complete'
    assert sum(policy()['weights'].values())==100


@pytest.mark.parametrize('value,category',[(0,'Minimal'),(19.99,'Minimal'),(20,'Low'),(39.99,'Low'),(40,'Medium'),(60,'High'),(80,'Critical'),(100,'Critical')])
def test_category_boundaries(value,category):
    assert category_for(value)==category


def test_missing_data_has_a_range_and_no_reassuring_badge():
    data=extraction();data['scoring_inputs'].pop('vessel_context')
    result=score_features(data)
    assert result['priority_score']==0 and result['priority_category'] is None
    assert result['score_range']==[0,25] and result['coverage_percent']==75
    data['scoring_inputs']={}
    result=score_features(data)
    assert result['priority_score'] is None and result['priority_category'] is None
    assert result['status']=='unavailable'


@pytest.mark.parametrize('source,key',[('local_events','fishing_in_no_take_mpa'),('vessel_context','iuu_listing')])
def test_strong_review_evidence_has_explicit_high_floor(source,key):
    data=extraction()
    dictionary='representative_event_points_inside_by_code' if source=='local_events' else 'associated_vessel_ids_with_positive_indicator'
    data['scoring_inputs'][source][dictionary][key]=1
    result=score_features(data)
    assert result['priority_category']=='High' and result['priority_score']==60
    assert sum(item['contribution_points'] or 0 for item in result['factors'])+sum(item['points'] for item in result['adjustments'])==60
    assert result['review_triggers']


def test_habitat_reference_never_contributes_and_overlapping_categories_not_added():
    data=extraction()
    data['scoring_inputs']['local_events']['representative_event_points_inside_by_code']={
        'fishing_in_no_take_mpa':1,'no_known_rfmo_authorization':50,'ais_gap':50}
    first=score_features(data)
    data['scoring_inputs']['habitats']={'area':1e12}
    data['components']['habitats']={'status':'reference_only','eligible_for_scoring':False}
    second=score_features(data)
    assert first['priority_score']==second['priority_score']
    assert next(item for item in second['factors'] if item['code']=='local_review')['contribution_points']==35


def test_inconsistent_sar_and_nan_never_become_zero_evidence():
    data=extraction();data['scoring_inputs']['sar_matched']['total']=7
    data['scoring_inputs']['forecast']['predicted_week_hours']=float('nan')
    result=score_features(data)
    assert result['coverage_percent']==70
    assert result['priority_category'] is None
    assert not next(item for item in result['factors'] if item['code']=='sar_unmatched')['available']


def test_partial_component_cannot_be_used_even_if_left_in_input_map():
    data=deepcopy(extraction());data['components']['local_events']['status']='partial'
    data['scoring_inputs']['local_events']['representative_event_points_inside_by_code']['fishing_in_no_take_mpa']=1
    result=score_features(data)
    assert result['priority_category'] is None and not result['review_triggers']


def test_static_marine_reference_survives_api_summary_without_changing_score():
    data = extraction()
    before = score_features(data)
    data['components']['habitats'] = {'status':'reference_only','eligible_for_scoring':False,'layers':[
        {'source':{'dataset':'coral_reefs','reference_year':2018},'status':'complete','reference_only':{'polygon_source_records_intersecting':2,'point_source_records_inside':1,'mapped_polygon_area_km2':12.5},'geometry':'must not be returned'}]}
    after = score_features(data)
    assert after['priority_score'] == before['priority_score']
    assert after['coverage_percent'] == before['coverage_percent']
    layer = after['components']['habitats']['layers'][0]
    assert layer['reference_year'] == 2018 and layer['name'] == 'Coral reefs'
    assert layer['reference_only']['mapped_polygon_area_km2'] == 12.5
    assert layer['eligible_for_scoring'] is False and 'geometry' not in layer
