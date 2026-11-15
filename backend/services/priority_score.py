"""Explainable review-priority policy, not a trained illegality classifier."""
import math

POLICY_VERSION='review-priority-v1'
WEIGHTS={'local_review':35,'fleet_review':25,'sar_unmatched':20,'activity_pressure':10,'forecast_change':10}
LABELS={'local_review':'Review-event points in the rectangle','fleet_review':'Area-associated fleet review context',
        'sar_unmatched':'SAR detections without an AIS match','activity_pressure':'Reported activity intensity',
        'forecast_change':'Predicted fishing-activity increase'}
CATEGORIES=[('Minimal',0,20),('Low',20,40),('Medium',40,60),('High',60,80),('Critical',80,101)]


def policy():
    return {'version':POLICY_VERSION,'weights':WEIGHTS,'categories':[
        {'name':name,'minimum':low,'maximum_exclusive':high if high<101 else None} for name,low,high in CATEGORIES],
        'meaning':'Heuristic priority for human review; not a probability of illegality, damage or overfishing.',
        'missing_data':'Missing factors are omitted. The score is a supported lower bound, with an uncertainty range; incomplete data cannot produce a Minimal badge.',
        'escalation':'A matched no-take-MPA representative event point or a selected-period IUU-list flag for an associated vessel sets a minimum High review priority (60).',
        'habitats':'Historical coral and seagrass maps are reference-only and excluded unless date-matched; current maps have no qualifying validity interval.'}


def number(value):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0:
        raise ValueError('Missing or invalid nonnegative measurement')
    return float(value)


def count(value):
    value=number(value)
    if not value.is_integer():
        raise ValueError('A count must be a whole number')
    return value


def category_for(score):
    return next(name for name,low,high in CATEGORIES if low<=score<high)


def score_features(extraction):
    components=extraction['components']; inputs=extraction['scoring_inputs']
    factors=[]; strong_reasons=[]
    def source(key):
        component=components.get(key,{})
        if key not in inputs or component.get('eligible_for_scoring') is not True or component.get('status')!='complete':
            raise ValueError(component.get('reason') or f'{key} is unavailable or incomplete')
        if component.get('temporal_alignment')!='exact_requested_interval':
            raise ValueError(f'{key} is not date-matched')
        return inputs[key]
    for code,weight in WEIGHTS.items():
        used=[]
        try:
            if code=='local_review':
                values=source('local_events')['representative_event_points_inside_by_code']; used=['local_events']
                mpa,rfmo,gaps=[count(values[key]) for key in ('fishing_in_no_take_mpa','no_known_rfmo_authorization','ais_gap')]
                normalized=max(min(mpa,1),.75*min(rfmo/3,1),.2*min(gaps/5,1))
                reason=f'{int(mpa)} no-take-MPA, {int(rfmo)} regional-authorization and {int(gaps)} gap representative points. The strongest category is used to avoid adding overlapping incidents.'
                if mpa:
                    strong_reasons.append('Date/area-matched representative point for a source no-take-MPA review event; human investigation is warranted, not a finding of illegality.')
            elif code=='fleet_review':
                values=source('vessel_context')['associated_vessel_ids_with_positive_indicator']; used=['vessel_context']
                iuu,mpa,rfmo,gaps=[count(values[key]) for key in ('iuu_listing','fishing_in_no_take_mpa','no_known_rfmo_authorization','ais_gap')]
                normalized=max(min(iuu,1),.5*min(mpa/5,1),.35*min(rfmo/5,1),.1*min(gaps/10,1))
                reason=f'{int(iuu)} associated vessel IDs with listing records. Other vessel-wide flags receive lower importance and are not counted as local incidents.'
                if iuu:
                    strong_reasons.append('Selected-period IUU-list review evidence for a vessel associated with the rectangle; listing does not establish an illegal act here.')
            elif code=='sar_unmatched':
                total=count(source('sar_all')['total']); unmatched=count(source('sar_unmatched')['total']); used=['sar_all','sar_unmatched']
                if total==0 or unmatched>total:
                    raise ValueError('No reported SAR observations for a ratio, or inconsistent subset counts; coverage is unknown')
                if 'sar_matched' in inputs:
                    matched=count(source('sar_matched')['total'])
                    if not math.isclose(total,matched+unmatched,abs_tol=1e-6):
                        raise ValueError('SAR all/matched/unmatched totals disagree')
                normalized=unmatched/total
                reason=f'{int(unmatched)} of {int(total)} reported detections unmatched. These are not necessarily unique ships or illegal vessels; subsets are not added together.'
            elif code=='activity_pressure':
                presence=source('presence'); fishing=source('fishing'); used=['presence','fishing']
                def density(value):
                    area=number(value['selection_area_km2']); days=number(value['selection_duration_hours'])/24
                    if not area or not days:
                        raise ValueError('Area and duration must be positive')
                    return number(value['total'])/area/days
                p,f=density(presence),density(fishing)
                normalized=max(.5*min(math.log1p(p)/math.log(2),1),min(math.log1p(f)/math.log1p(.1),1))
                reason='Log-scaled hours per selection km² per day: presence reference 1, fishing reference 0.1. The maximum proxy is used rather than adding overlapping fishing/presence hours. Selection area includes land.'
            else:
                values=source('forecast'); used=['forecast']
                predicted,baseline=number(values['predicted_week_hours']),number(values['repeat_last_week_hours'])
                normalized=min(max((predicted-baseline)/max(baseline,1),0),1)
                reason='Positive change from the last observed week, capped at a 100% increase (one-hour denominator floor). Decreases contribute no increase signal; this is fishing activity only.'
            factors.append({'code':code,'label':LABELS[code],'weight':weight,'available':True,
                'normalized_value':round(normalized,6),'contribution_points':round(weight*normalized,6),
                'reason':reason,'sources':used})
        except (KeyError,ValueError,TypeError) as error:
            factors.append({'code':code,'label':LABELS[code],'weight':weight,'available':False,
                'normalized_value':None,'contribution_points':None,'reason':str(error),'sources':used})
    available=sum(factor['weight'] for factor in factors if factor['available'])
    raw=sum(factor['contribution_points'] for factor in factors if factor['available'])
    score=round(max(raw,60 if strong_reasons else 0),2) if available else None
    upper=min(100,max(raw+100-available,60 if strong_reasons else 0))
    complete=available==100
    # A partial assessment has no reassuring category. Strong observed evidence
    # can still support at least High, regardless of unobserved factors.
    category=category_for(score) if score is not None and (complete or score>=60) else None
    summaries={key:{field:value.get(field) for field in ('status','eligible_for_scoring','reason','detail','temporal_alignment','source_dataset','model_version','forecast_start','forecast_end_exclusive')}
               for key,value in components.items()}
    # Keep useful marine context in the API result without redistributing GIS
    # geometry or allowing static reference layers into the numerical score.
    if 'habitats' in summaries:
        summaries['habitats']['layers'] = [
            {'status': layer.get('status'), 'eligible_for_scoring': False,
             'reference_year': layer.get('source', {}).get('reference_year'),
             'name': 'Coral reefs' if layer.get('source', {}).get('dataset') == 'coral_reefs' or layer.get('source', {}).get('archive', '').startswith('WCMC008') else 'Seagrass' if layer.get('source', {}).get('dataset') == 'seagrass' or layer.get('source', {}).get('archive', '').startswith('WCMC013-014') else 'Marine reference layer',
             'reference_only': layer.get('reference_only'), 'reason': layer.get('reason')}
            for layer in components['habitats'].get('layers', [])]
    return {'policy_version':POLICY_VERSION,'status':'complete' if complete else 'partial' if available else 'unavailable',
        'priority_score':round(score,2) if score is not None else None,'priority_category':category,
        'score_kind':'minimum_supported_review_priority','score_range':[round(score or 0,2),round(upper,2)],
        'coverage_percent':available,'factors':factors,
        'adjustments':[{'points':round(max(0,(score or 0)-raw),6),'reason':reason} for reason in strong_reasons[:1]],
        'review_triggers':strong_reasons,'area':extraction['area'],'start':extraction['start'],
        'end_exclusive':extraction['end_exclusive'],'filters':extraction['filters'],
        'selection_key':extraction['selection_key'],'components':summaries,
        'excluded_components':extraction['excluded_components'],
        'limitations':['Prototype weights and reference levels are declared heuristics, not learned or calibrated probabilities.',
            'Missing data widens the score range and is not treated as observed zero. Coverage measures factor availability, not sensor reception or statistical confidence.',
            'Representative event points are not complete tracks. Vessel-wide flags may refer to events elsewhere.',
            'Historical habitat maps are excluded by the strict date policy. This score does not measure ecosystem damage.']}
