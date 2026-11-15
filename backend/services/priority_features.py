"""Selected-area feature extraction. No priority weights, labels or score here."""
import asyncio
from datetime import datetime,timedelta,timezone
import hashlib
import json
import math
import sqlite3

import httpx
from fastapi import HTTPException
from shapely.geometry import box
from shapely.errors import GEOSException

from backend.priority_schemas import PriorityFeatureRequest
from backend.services.habitat_features import geodesic_area_km2
from backend.services.historical import (
    AreaQuery, DATASETS, VesselEnrichment, cells_from_rows, enrich_vessel, report,
)
from backend.services.risk_events import RiskEventRequest, DATASETS as EVENT_DATASETS, load_risk_events
from backend.services.risk_screening import classify

VERSION='v5.0'
LOCAL_CODES=('fishing_in_no_take_mpa','no_known_rfmo_authorization','ais_gap')


def utc(value):
    return value.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')


def unavailable(reason,**extra):
    return {'status':'unavailable','eligible_for_scoring':False,'reason':reason,'features':None,**extra}


def finite_number(value):
    return isinstance(value,(float,int)) and not isinstance(value,bool) and math.isfinite(value)


def source_number(value):
    if isinstance(value,bool):
        return None
    try:
        result=float(value)
        return result if math.isfinite(result) else None
    except (TypeError,ValueError):
        return None


def source_date(value):
    try:
        result=datetime.fromisoformat(str(value).replace('Z','+00:00'))
        return result.astimezone(timezone.utc) if result.tzinfo is not None else None
    except (TypeError,ValueError):
        return None


def layer_query(request,layer,matched='all'):
    # Pass the complete selected scope. AreaQuery rejects incompatible filters;
    # silently omitting one would change the population being scored.
    return AreaQuery(**request.area.model_dump(),layer=layer,hours_ago=124,
                     **request.filters.active(),sar_matched=matched if layer=='sar' else 'false')


class GFWFeatureProvider:
    def __init__(self,client):
        self.client=client

    async def observations(self,request,layer,matched='all'):
        query=layer_query(request,layer,matched)
        dataset=DATASETS[layer].split(':')[0]+':'+VERSION
        start,end=utc(request.start),utc(request.end)
        rows=await report(query,start,end,dataset=dataset,client=self.client)
        for row in rows:
            if source_number(row.get('lat')) is None or source_number(row.get('lon')) is None:
                raise ValueError('Invalid observation coordinates')
            if source_number(row.get('detections' if layer=='sar' else 'hours')) is None:
                raise ValueError('Invalid observation value')
        cells=cells_from_rows(rows,query)
        vessels=[] if layer=='sar' else await report(query,start,end,vessels=True,dataset=dataset,client=self.client)
        return {'cells':cells,'vessels':vessels,'dataset':dataset,'source_rows':len(rows),'start':start,'end':end}

    async def vessel(self,request,vessel_id):
        return await enrich_vessel(VesselEnrichment(vessel_id=vessel_id,start=request.start,end=request.end),
            client=self.client,identity_dataset='public-global-vessel-identity:'+VERSION)

    async def events(self,request,vessel_id,code,ids):
        query=RiskEventRequest(vessel_id=vessel_id,code=code,event_ids=ids,start=request.start,
            end=request.end,area=request.area.model_dump())
        dataset=EVENT_DATASETS[code].split(':')[0]+':'+VERSION
        return await load_risk_events(query,client=self.client,dataset=dataset)


def observation_component(payload,request,layer,matched):
    if source_date(payload.get('start'))!=request.start or source_date(payload.get('end'))!=request.end:
        raise ValueError('Source observation dates do not match the selection')
    cells=payload['cells']
    for cell in cells:
        if not (finite_number(cell.get('value')) and cell['value']>=0
                and finite_number(cell.get('lat')) and finite_number(cell.get('lon'))
                and request.area.west<=cell['lon']<=request.area.east
                and request.area.south<=cell['lat']<=request.area.north):
            raise ValueError('Provider cell is invalid or outside the selection')
    vessels={}
    for row in payload['vessels']:
        identity=row.get('vesselId',row.get('vessel_id'))
        hours=source_number(row.get('hours'))
        if not isinstance(identity,str) or not identity or hours is None or hours<0:
            raise ValueError('Invalid area-associated vessel report')
        value=vessels.setdefault(identity,{'vessel_id':identity,'hours':0.,
            'name':row.get('shipName',row.get('shipname',identity)),
            'vessel_type':row.get('vesselType',row.get('vessel_type','unknown')),
            'mmsi':row.get('mmsi'),'length_m':row.get('lengthM',row.get('length_m'))})
        value['hours']+=hours
    total=sum(cell['value'] for cell in cells)
    area_km2=geodesic_area_km2(box(**{
        'minx':request.area.west,'miny':request.area.south,'maxx':request.area.east,'maxy':request.area.north}))
    features={'total':total,'units':'reported_detections' if layer=='sar' else 'apparent_fishing_vessel_hours' if layer=='fishing' else 'vessel_presence_hours',
        'active_cells':len(cells),'selection_area_km2':area_km2,
        'selection_duration_hours':(request.end-request.start).total_seconds()/3600,
        'quantity_per_km2':total/area_km2 if area_km2 else None,
        'unique_area_associated_vessel_ids':len(vessels) if layer!='sar' else None}
    return {'status':'complete','eligible_for_scoring':True,'temporal_alignment':'exact_requested_interval',
        'start':utc(request.start),'end':utc(request.end),'source_dataset':payload['dataset'],
        'spatial_scope':'GFW selection polygon; 0.1-degree reported activity cells, not vessel positions',
        'sar_matching':matched if layer=='sar' else None,'features':features,
        'cells':cells,'vessels':list(vessels.values()),
        'observation_coverage':'not_measured_by_this_report',
        'notes':['Vessel hours and detections are not unique ship counts or findings of illegality.',
                 'The source activity grid limits spatial precision within the selection.',
                 'A completed empty report is not proof of no ships, no SAR overpass or adequate AIS reception.']}


def forecast_component(request,forecaster):
    if forecaster is None:
        return unavailable('forecast_not_loaded')
    info=forecaster.info()
    start=datetime.fromisoformat(info['target_start']).replace(tzinfo=timezone.utc)
    end=datetime.fromisoformat(info['target_end']).replace(tzinfo=timezone.utc)+timedelta(days=1)
    source={'model_version':info['model_version'],'model_sha256':info['model_sha256'],
            'forecast_start':utc(start),'forecast_end_exclusive':utc(end)}
    if request.start!=start or request.end!=end:
        return unavailable('forecast_dates_do_not_match_selection',temporal_alignment='mismatch',**source)
    if request.filters.active():
        return unavailable('forecast_does_not_model_filtered_subpopulations',**source)
    grid=info['grid_degrees']; area=request.area
    rows=range(max(0,math.floor((area.south+90)/grid)),min(180//grid,math.ceil((area.north+90)/grid)))
    columns=range(max(0,math.floor((area.west+180)/grid)),min(360//grid,math.ceil((area.east+180)/grid)))
    included=[]; partial=[]; missing=[]
    for row in rows:
        for column in columns:
            west,east=column*grid-180,(column+1)*grid-180
            south,north=row*grid-90,(row+1)*grid-90
            cell_id=f'lat{row:02d}_lon{column:02d}'
            if west<area.west or east>area.east or south<area.south or north>area.north:
                partial.append(cell_id)
                continue
            value=forecaster.predict((south+north)/2,(west+east)/2)
            valid_values=all(finite_number(value.get(key)) and value[key]>=0 for key in ('predicted_week_hours','repeat_last_week_hours'))
            expected_bounds={'west':west,'east':east,'south':south,'north':north}
            valid_cell=(value.get('cell_id')==cell_id and value.get('bounds')==expected_bounds
                and value.get('target_start')==info['target_start'] and value.get('target_end')==info['target_end']
                and value.get('model_version')==info['model_version'])
            if value.get('status')!='scored' or not valid_values or not valid_cell:
                missing.append({'cell_id':cell_id,'reason':value.get('reason','insufficient_data')})
            else:
                included.append(value)
    complete=bool(included) and not partial and not missing
    total=sum(cell['predicted_week_hours'] for cell in included)
    baseline=sum(cell['repeat_last_week_hours'] for cell in included)
    return {'status':'complete' if complete else 'partial' if included else 'unavailable',
        'eligible_for_scoring':complete,'temporal_alignment':'exact_requested_interval',
        **source,'grid_degrees':grid,'cells':included,'partial_boundary_cell_ids':partial,
        'unscorable_cells':missing,'reason':None if complete else 'incomplete_spatial_coverage_no_prorating',
        'features':{'predicted_week_hours':total,'repeat_last_week_hours':baseline,
            'prediction_change_hours':total-baseline,'prediction_change_fraction':(total-baseline)/baseline if baseline else None,
            'full_cells':len(included)} if complete else None,
        'note':'No full-cell prediction is assigned to a partial rectangle; unavailable cells are not zero activity.'}


async def vessel_components(request,vessel_ids,provider,cohort_complete,progress=None):
    if not request.include_vessel_evidence:
        return unavailable('vessel_evidence_not_requested'),unavailable('vessel_evidence_not_requested')
    records=[]; event_rows={}; failures=[]; cursor=iter(sorted(vessel_ids)); incomplete=not cohort_complete
    paused=False; consecutive_unavailable=0; context_incomplete=not cohort_complete
    async def worker():
        nonlocal incomplete,paused,consecutive_unavailable,context_incomplete
        for vessel_id in cursor:
            if paused:
                break
            if progress:
                progress('vessel evidence',min(len(records)+len(failures),len(vessel_ids)),len(vessel_ids))
            try:
                evidence=await provider.vessel(request,vessel_id)
                consecutive_unavailable=0
                if source_date(evidence.get('start'))!=request.start or source_date(evidence.get('end'))!=request.end:
                    raise ValueError('Vessel evidence dates do not match the selection')
                classification=classify(evidence.get('insights',{}),vessel_id=vessel_id,
                    start=request.start,end=request.end)
                if classification['missing_count']:
                    context_incomplete=True
                precision=classification.get('source_period_precision')
                midnight=lambda value:(value.hour,value.minute,value.second,value.microsecond)==(0,0,0,0)
                if precision not in ('instant','calendar_day') or (precision=='calendar_day' and not (midnight(request.start) and midnight(request.end))):
                    incomplete=True
                    context_incomplete=True
                records.append({'vessel_id':vessel_id,'summary':evidence.get('summary'),
                    'authorization':evidence.get('authorization'),'warnings':evidence.get('warnings',[]),
                    'source_identity':evidence.get('identity'),'source_insights':evidence.get('insights'),
                    **classification})
                indicators={item['code']:item for item in classification['indicators']}
                for code in LOCAL_CODES:
                    indicator=indicators.get(code,{})
                    ids=indicator.get('event_ids',[])
                    count=indicator.get('count')
                    if not isinstance(ids,list) or any(not isinstance(value,str) for value in ids):
                        incomplete=True
                        continue
                    ids=list(dict.fromkeys(ids))
                    if count is None or (count>0 and not ids) or (finite_number(count) and len(ids)!=count):
                        incomplete=True
                    for offset in range(0,len(ids),3):
                        response=await provider.events(request,vessel_id,code,ids[offset:offset+3])
                        returned=response.get('events',[])
                        if {row.get('id') for row in returned}!=set(ids[offset:offset+3]):
                            incomplete=True
                        for event in returned:
                            # The main service validates linkage/time. Recheck bounds
                            # here so untrusted precomputed within flags cannot leak.
                            event_start,event_end=source_date(event.get('start')),source_date(event.get('end'))
                            valid_period=event_start is not None and event_end is not None and event_start<event_end and event_end>request.start and event_start<request.end
                            event_id_valid=event.get('id') in ids[offset:offset+3]
                            position=event.get('position') or {}
                            x,y=position.get('lon'),position.get('lat')
                            has_position=finite_number(x) and finite_number(y) and -180<=x<=180 and -90<=y<=90
                            within=has_position and request.area.west<=x<=request.area.east and request.area.south<=y<=request.area.north
                            matched_source=event.get('status')=='matched' and valid_period and event_id_valid
                            if not matched_source or not has_position:
                                incomplete=True
                            key=(vessel_id,code,event.get('id'))
                            event_rows[key]={**event,'status':'matched' if matched_source else 'unverified','vessel_id':vessel_id,'code':code,
                                'reported_point_in_selected_area':bool(within) if has_position else None}
            except (HTTPException,ValueError,httpx.HTTPError) as error:
                incomplete=True
                context_incomplete=True
                failures.append({'vessel_id':vessel_id,'reason':str(error.detail) if isinstance(error,HTTPException) else type(error).__name__})
                if isinstance(error,HTTPException):
                    consecutive_unavailable=consecutive_unavailable+1 if error.status_code==502 else 0
                    if error.status_code in (401,403,429,503) or consecutive_unavailable>=3:
                        paused=True
    await asyncio.gather(*(worker() for _ in range(min(4,len(vessel_ids)))))
    context={'status':'partial' if context_incomplete else 'complete','eligible_for_scoring':not context_incomplete,
        'reason':None if not context_incomplete else 'Incomplete cohort, period verification or source evidence.',
        'spatial_scope':'Attributes of vessels associated with this rectangle; indicator events may have occurred elsewhere.',
        'input_role':'area_associated_vessel_review_context_not_local_incident_counts',
        'temporal_alignment':'exact_requested_interval',
        'features':{'area_associated_vessel_ids':len(vessel_ids),
            'associated_vessel_ids_with_positive_indicator':{code:sum(any(item['code']==code and item.get('reported_positive') is True for item in row['indicators']) for row in records)
                for code in (*LOCAL_CODES,'iuu_listing')}} if not context_incomplete else None,'vessels':records,
        'requested_vessels':len(vessel_ids),'failed_vessels':failures,'paused':paused,
        'unprocessed_vessel_ids':sorted(vessel_ids-{row['vessel_id'] for row in records}-{row['vessel_id'] for row in failures})}
    inside=[row for row in event_rows.values() if row.get('status')=='matched' and row['reported_point_in_selected_area'] is True]
    events={'status':'partial' if incomplete else 'complete','eligible_for_scoring':not incomplete,
        'temporal_alignment':'exact_requested_interval','start':utc(request.start),'end':utc(request.end),
        'features':{'representative_event_points_inside_by_code':{code:sum(row['code']==code for row in inside) for code in LOCAL_CODES},
            'unique_representative_events_inside':len({row['id'] for row in inside})} if not incomplete else None,
        'events':list(event_rows.values()),'failed_vessels':failures,
        'note':'Only source representative points are localized. Full event durations/tracks and intent are not inferred; overlapping indicator categories must not be added as unique incidents.'}
    return context,events


async def collect_area_features(request:PriorityFeatureRequest,*,forecaster=None,habitats=None,provider=None,now=None,progress=None):
    if provider is None:
        async with httpx.AsyncClient(timeout=110,follow_redirects=False,
            limits=httpx.Limits(max_connections=8,max_keepalive_connections=4)) as client:
            return await collect_area_features(request,forecaster=forecaster,habitats=habitats,
                provider=GFWFeatureProvider(client),now=now,progress=progress)
    now=now or datetime.now(timezone.utc)
    components={}; vessel_ids=set(); cohort_sources=[]
    for key,layer,matched in [('presence','presence','all'),('fishing','fishing','all'),
                             ('sar_all','sar','all'),('sar_matched','sar','true'),('sar_unmatched','sar','false')]:
        if progress: progress('observations: '+key,len(components),5)
        lag=124 if layer=='sar' else 100
        if request.end>now-timedelta(hours=lag):
            components[key]=unavailable('observations_not_published_for_selected_dates',temporal_alignment='unavailable')
            continue
        try:
            layer_query(request,layer,matched)
            payload=await provider.observations(request,layer,matched)
            components[key]=observation_component(payload,request,layer,matched)
            if layer!='sar':
                cohort_sources.append(key)
                vessel_ids.update(vessel['vessel_id'] for vessel in components[key]['vessels'])
        except (HTTPException,ValueError,httpx.HTTPError) as error:
            components[key]=unavailable('source_unavailable_or_incompatible_scope',
                detail=str(error.detail) if isinstance(error,HTTPException) else str(error) if isinstance(error,ValueError) else type(error).__name__)
    try:
        if progress: progress('matching forecast dates and cells')
        components['forecast']=await asyncio.to_thread(forecast_component,request,forecaster)
    except (ValueError,OSError) as error:
        components['forecast']=unavailable('forecast_failed',detail=type(error).__name__)
    if cohort_sources:
        cohort_complete=all(components[key]['status']=='complete' for key in ('presence','fishing'))
        components['vessel_context'],components['local_events']=await vessel_components(request,vessel_ids,provider,cohort_complete,progress)
    else:
        components['vessel_context']=unavailable('no_complete_identified_vessel_cohort')
        components['local_events']=unavailable('no_complete_identified_vessel_cohort')
    try:
        if progress: progress('checking habitat reference exclusions')
        components['habitats']=await asyncio.to_thread(habitats.query,request.area,request.start,request.end) if habitats else unavailable('habitat_index_not_configured')
    except (OSError,ValueError,sqlite3.Error,GEOSException) as error:
        components['habitats']=unavailable('habitat_reference_query_failed',detail=type(error).__name__)
    # These are inputs for step 3, not an already computed score. Static reference
    # layers never enter this map under the user's strict date-matching policy.
    eligible={key:value['features'] for key,value in components.items() if value.get('eligible_for_scoring') is True}
    identity={'request':request.model_dump(mode='json'),
              'model_sha256':components['forecast'].get('model_sha256'),
              'sources':{key:value.get('source_dataset') for key,value in components.items()},
              'habitat_sources':[layer.get('source') for layer in components['habitats'].get('layers',[])]}
    return {'schema_version':1,'phase':'feature_extraction_only','area':request.area.model_dump(),
        'start':utc(request.start),'end_exclusive':utc(request.end),'filters':request.filters.model_dump(),
        'selection_key':hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest(),
        'date_policy':'Only exact-interval, spatially scoped complete components are scoring inputs. Static habitat references are excluded.',
        'components':components,'scoring_inputs':eligible,
        'excluded_components':{key:value.get('reason',value.get('temporal_alignment','incomplete_source')) for key,value in components.items() if key not in eligible},
        'priority_score':None,'priority_category':None}
