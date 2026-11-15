import asyncio
from datetime import datetime,timedelta,timezone

import pytest
from pydantic import ValidationError

from backend.priority_schemas import PriorityFeatureRequest
from backend.services.priority_features import collect_area_features,forecast_component,vessel_components,utc

START=datetime(2025,11,5,tzinfo=timezone.utc)
END=START+timedelta(days=7)
NOW=datetime(2026,11,15,tzinfo=timezone.utc)


def request(**changes):
    return PriorityFeatureRequest(**{'area':{'west':0,'south':0,'east':5,'north':5},
        'start':START,'end':END,**changes})


class Forecaster:
    def __init__(self):
        self.calls=[]

    def info(self):
        return {'target_start':'2025-11-05','target_end':'2025-11-11',
            'model_version':'frozen','model_sha256':'test-hash','grid_degrees':5}

    def predict(self,lat,lon):
        self.calls.append((lat,lon))
        return {'status':'scored','cell_id':f'lat{int((lat+90)//5):02d}_lon{int((lon+180)//5):02d}',
            'bounds':{'west':lon-2.5,'east':lon+2.5,'south':lat-2.5,'north':lat+2.5},
            'target_start':'2025-11-05','target_end':'2025-11-11','model_version':'frozen',
            'predicted_week_hours':20.,'repeat_last_week_hours':10.}


class Provider:
    def __init__(self):
        self.observation_calls=[];self.vessel_calls=[];self.event_calls=[]
        self.mismatch=None;self.event_count=1;self.event_position={'lat':1.,'lon':1.}
        self.bad_event_dates=False;self.fail_layer=None;self.empty=False

    async def observations(self,req,layer,matched):
        from fastapi import HTTPException
        self.observation_calls.append((layer,matched,req.start,req.end))
        if layer==self.fail_layer:
            raise HTTPException(502,'Provider unavailable')
        return {'dataset':f'fixture-{layer}:v5.0','start':utc(req.start),
            'end':utc(req.end+timedelta(days=1)) if layer==self.mismatch else utc(req.end),
            'cells':[] if self.empty else [{'id':'c1','lat':1.,'lon':1.,'value':5.}],
            'vessels':[] if layer=='sar' or self.empty else [{'vesselId':'v1','hours':5.}]}

    async def vessel(self,req,vessel_id):
        self.vessel_calls.append(vessel_id)
        return {'start':utc(req.start),'end':utc(req.end),'summary':{'name':'sourced'},
            'authorization':{'status':'unknown'},'warnings':[],
            'insights':{'vesselId':vessel_id,'period':{'startDate':utc(req.start),'endDate':utc(req.end)},'apparentFishing':{'periodSelectedCounters':{
                'eventsInNoTakeMPAs':self.event_count,'eventsInRFMOWithoutKnownAuthorization':0},
                'eventsInNoTakeMpas':[f'e{i}' for i in range(self.event_count)]},
                'gap':{'aisOff':[]},'vesselIdentity':{'iuuVesselList':{'totalTimesListedInThePeriod':0}}}}

    async def events(self,req,vessel_id,code,ids):
        self.event_calls.append(ids)
        return {'events':[{'id':identifier,'status':'matched','position':self.event_position,
            'reported_point_in_selected_area':True,
            'start':utc(req.start-timedelta(days=30)) if self.bad_event_dates else utc(req.start),
            'end':utc(req.start-timedelta(days=29)) if self.bad_event_dates else utc(req.end)} for identifier in ids]}


class Habitats:
    def query(self,area,start,end):
        return {'status':'reference_only','eligible_for_scoring':False,'features':None,
            'reason':'static_not_date_matched','layers':[{'reference_year':2017}]}


def collect(req=None,provider=None,forecaster=None):
    return asyncio.run(collect_area_features(req or request(),provider=provider or Provider(),
        forecaster=forecaster or Forecaster(),habitats=Habitats(),now=NOW))


def test_only_aligned_complete_inputs_are_exposed_and_static_habitats_are_excluded():
    result=collect()
    assert set(result['scoring_inputs'])=={'presence','fishing','sar_all','sar_matched','sar_unmatched','forecast','vessel_context','local_events'}
    assert result['components']['habitats']['status']=='reference_only'
    assert 'habitats' not in result['scoring_inputs']
    assert result['components']['vessel_context']['input_role']=='area_associated_vessel_review_context_not_local_incident_counts'
    assert result['priority_score'] is None and result['priority_category'] is None


def test_mismatched_forecast_is_excluded_without_moving_dates_or_predicting():
    forecaster=Forecaster()
    result=collect(request(start=START-timedelta(days=1),end=END-timedelta(days=1)),forecaster=forecaster)
    assert 'forecast' not in result['scoring_inputs']
    assert result['components']['forecast']['reason']=='forecast_dates_do_not_match_selection'
    assert not forecaster.calls
    assert result['components']['fishing']['start']==utc(START-timedelta(days=1))


def test_mismatched_provider_period_is_not_accepted():
    provider=Provider();provider.mismatch='fishing'
    result=collect(provider=provider)
    assert 'fishing' not in result['scoring_inputs']
    assert 'local_events' not in result['scoring_inputs']  # Identified cohort is incomplete.


def test_exact_absolute_period_reused_and_vessel_ids_deduplicated_across_layers():
    provider=Provider()
    result=collect(provider=provider)
    assert len(provider.observation_calls)==5
    assert {(start,end) for _,_,start,end in provider.observation_calls}=={(START,END)}
    assert provider.vessel_calls==['v1']
    assert result['scoring_inputs']['local_events']['unique_representative_events_inside']==1


def test_representative_point_outside_selection_not_counted_despite_reported_flag():
    provider=Provider();provider.event_position={'lat':20.,'lon':20.}
    result=collect(provider=provider)
    assert result['scoring_inputs']['local_events']['unique_representative_events_inside']==0
    assert result['components']['local_events']['events'][0]['reported_point_in_selected_area'] is False


def test_event_dates_are_checked_and_missing_position_does_not_become_zero_risk():
    provider=Provider();provider.bad_event_dates=True
    result=collect(provider=provider)
    assert 'local_events' not in result['scoring_inputs']
    assert result['components']['local_events']['events'][0]['status']=='unverified'
    provider=Provider();provider.event_position=None
    result=collect(provider=provider)
    assert 'local_events' not in result['scoring_inputs']
    assert result['components']['local_events']['status']=='partial'


def test_all_event_ids_processed_in_batches_of_at_most_three():
    provider=Provider();provider.event_count=7
    result=collect(provider=provider)
    assert list(map(len,provider.event_calls))==[3,3,1]
    assert result['scoring_inputs']['local_events']['unique_representative_events_inside']==7


def test_missing_observations_are_not_reported_as_zero():
    provider=Provider();provider.fail_layer='presence'
    result=collect(provider=provider)
    assert result['components']['presence']['features'] is None
    assert 'presence' not in result['scoring_inputs']
    assert 'local_events' not in result['scoring_inputs']


def test_completed_empty_exports_can_have_zero_without_claiming_no_vessels_exist():
    provider=Provider();provider.empty=True
    result=collect(provider=provider)
    assert result['scoring_inputs']['presence']['total']==0
    assert result['scoring_inputs']['local_events']['unique_representative_events_inside']==0
    assert not provider.vessel_calls


def test_filtered_forecast_and_incompatible_sar_identity_scope_are_excluded():
    result=collect(request(filters={'flag':['USA']}))
    assert 'forecast' not in result['scoring_inputs']
    assert 'sar_unmatched' not in result['scoring_inputs']
    assert 'presence' in result['scoring_inputs']


def test_wrong_vessel_source_identity_cannot_supply_scoring_inputs():
    class WrongOwner(Provider):
        async def vessel(self,req,vessel_id):
            evidence=await super().vessel(req,vessel_id)
            evidence['insights']['vesselId']='another-vessel'
            return evidence
    result=collect(provider=WrongOwner())
    assert 'vessel_context' not in result['scoring_inputs']
    assert 'local_events' not in result['scoring_inputs']


def test_day_precision_is_insufficient_for_hour_specific_source_periods():
    class CalendarDates(Provider):
        async def vessel(self,req,vessel_id):
            evidence=await super().vessel(req,vessel_id)
            evidence['insights']['period']={'startDate':req.start.date().isoformat(),'endDate':req.end.date().isoformat()}
            return evidence
    assert 'vessel_context' in collect(provider=CalendarDates())['scoring_inputs']
    req=request(start=START+timedelta(hours=2),end=END)
    result=collect(req,provider=CalendarDates())
    assert 'vessel_context' not in result['scoring_inputs']
    assert 'local_events' not in result['scoring_inputs']


def test_provider_access_failure_pauses_remaining_vessels_and_does_not_mark_them_clear():
    from fastapi import HTTPException
    class Forbidden(Provider):
        async def vessel(self,req,vessel_id):
            self.vessel_calls.append(vessel_id)
            await asyncio.sleep(0)
            raise HTTPException(403,'Dataset access denied')
    provider=Forbidden()
    context,events=asyncio.run(vessel_components(request(),{f'v{i}' for i in range(20)},provider,True))
    assert len(provider.vessel_calls)<=4
    assert context['paused'] is True and len(context['unprocessed_vessel_ids'])>=16
    assert context['features'] is None and events['features'] is None


def test_forecast_enumerates_every_full_cell_and_never_prorates_partial_cells():
    forecaster=Forecaster()
    result=forecast_component(request(area={'west':0,'east':10,'south':0,'north':5}),forecaster)
    assert len(forecaster.calls)==2
    assert result['features']['predicted_week_hours']==40.
    forecaster=Forecaster()
    partial=forecast_component(request(area={'west':1,'east':9,'south':1,'north':4}),forecaster)
    assert partial['features'] is None and partial['eligible_for_scoring'] is False
    assert not forecaster.calls


def test_invalid_frozen_model_values_are_unavailable_not_numerical_inputs():
    class Invalid(Forecaster):
        def predict(self,lat,lon):
            value=super().predict(lat,lon)
            value['predicted_week_hours']=float('nan')
            return value
    result=forecast_component(request(),Invalid())
    assert result['features'] is None and result['eligible_for_scoring'] is False


def test_source_cache_identity_changes_with_area_dates_and_filters():
    first=collect()
    changed=collect(request(area={'west':0,'east':10,'south':0,'north':5}))
    dates=collect(request(start=START-timedelta(days=1),end=END-timedelta(days=1)))
    filters=collect(request(filters={'flag':['USA']}))
    assert len({result['selection_key'] for result in (first,changed,dates,filters)})==4


@pytest.mark.parametrize('changes',[
    {'start':'2025-11-05T00:00:00'}, {'end':START},
    {'end':END+timedelta(days=1)}, {'area':{'west':5,'east':0,'south':0,'north':5}},
    {'area':{'west':float('nan'),'east':5,'south':0,'north':5}}, {'filters':{'flag':['US']}}])
def test_invalid_periods_bounds_and_filters_rejected(changes):
    with pytest.raises(ValidationError):
        request(**changes)
