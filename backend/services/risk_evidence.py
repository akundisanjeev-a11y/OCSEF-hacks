"""Deterministic, shared parsing of source risk evidence. Never decide legality."""
from datetime import date, datetime, timezone
import math
import re

CHECKS = (
    ('fishing_in_no_take_mpa', 'Apparent fishing in no-take protected areas'),
    ('no_known_rfmo_authorization', 'Apparent fishing with no known RFMO authorization'),
    ('ais_gap', 'AIS-off events reported by GFW'),
    ('iuu_listing', 'RFMO IUU-list records during selected period'),
)
NOTE = 'Risk indicators are leads for review, not findings of illegality or proof of authorization.'


def object_value(value):
    return value if isinstance(value, dict) else {}


def count_value(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if value < 0 or value > 2**53-1 or not math.isfinite(value) or int(value) != value:
        return None
    return int(value)


def instant(value):
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo is not None else None
    except (TypeError, ValueError, OverflowError):
        return None


def event_ids(value):
    if not isinstance(value, list):
        return [], False
    valid = [item for item in value if isinstance(item, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,200}', item)]
    return list(dict.fromkeys(valid)), len(valid) == len(value)


def assess_risk(insights, *, vessel_id=None, start=None, end=None):
    source = object_value(insights)
    global_notes = []
    if not isinstance(insights, dict):
        global_notes.append('The source risk response is not an object.')
    if vessel_id is not None and source.get('vesselId') is not None and source['vesselId'] != vessel_id:
        global_notes.append('The source response belongs to another vessel.')
    missing_identity = source.get('vesselIdsWithoutIdentity')
    if missing_identity:
        global_notes.append('The single-vessel source response reports unresolved identity; its risk evidence cannot be safely attributed.')
    if missing_identity is not None and not isinstance(missing_identity, list):
        global_notes.append('The source identity-availability field is malformed.')
    period = source.get('period')
    if period is not None and not isinstance(period, dict):
        global_notes.append('The source period is malformed.')
    precision = 'not_supplied'
    for key, expected in [('startDate', start), ('endDate', end)]:
        if expected is None or key not in object_value(period):
            continue
        value = period[key]
        requested = instant(expected)
        # GFW's live response returns day labels even for hour-specific requests.
        # Compare only the precision supplied, never invent hour-level verification.
        if isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            precision = 'calendar_day'
            try:
                matches = requested is not None and date.fromisoformat(value) == requested.date()
            except ValueError:
                matches = False
        else:
            if precision != 'calendar_day':
                precision = 'instant'
            matches = requested is not None and instant(value) == requested
        if not matches:
            global_notes.append('The source period does not match the requested observation dates.')

    indicators = []

    def build(code, label, section, key, events_key=None):
        notes = list(global_notes)
        section_obj = object_value(section)
        if section is not None and not isinstance(section, dict):
            notes.append('The source check has an invalid structure.')
        owner = section_obj.get('vesselId')
        if owner is not None and vessel_id is not None and owner != vessel_id:
            notes.append('The source check belongs to another vessel.')
        if events_key is not None and key is not None and 'periodSelectedCounters' in section_obj and not isinstance(section_obj['periodSelectedCounters'], dict):
            notes.append('The selected-period counters have an invalid structure.')
        unverified = bool(notes)
        container = object_value(section_obj.get('periodSelectedCounters')) if events_key is not None and key is not None else section_obj
        explicit = key is not None and key in container
        count = count_value(container.get(key)) if explicit else None
        ids, complete = event_ids(section_obj.get(events_key)) if events_key else ([], True)
        positive = count is not None and count > 0
        status = 'known' if count is not None else 'missing'
        basis = 'selected_period_counter' if explicit else 'event_ids' if events_key else 'selected_period_counter'
        if explicit and count is None:
            status = 'invalid'
            notes.append('The selected-period count is missing or is not a non-negative whole number.')
        if events_key and events_key in section_obj:
            if not complete:
                notes.append('The event list contains invalid records; invalid entries were not counted.')
                if count == 0:
                    count, status = None, 'invalid'
            elif len(section_obj[events_key]) > len(ids):
                notes.append('Duplicate source event IDs were counted only once.')
            positive = positive or bool(ids)
            if not explicit and complete:
                count = len(ids)
                status = 'known'
            elif not explicit:
                status = 'invalid'
            if explicit and count is not None and count < len(ids):
                count = None
                status = 'conflicting'
                notes.append('The source counter is smaller than its distinct event-ID list. No exact count is asserted.')
        if unverified:
            count, ids, positive, status = None, [], False, 'unverified'
        return {'code': code, 'label': label, 'count': count, 'event_ids': ids,
                'reported_positive': positive, 'status': status, 'count_basis': basis,
                'count_is_lower_bound': basis == 'event_ids' and count is not None and count > 0,
                'quality_notes': list(dict.fromkeys(notes))}

    fishing = source.get('apparentFishing')
    indicators.append(build(*CHECKS[0], fishing, 'eventsInNoTakeMPAs', 'eventsInNoTakeMpas'))
    indicators.append(build(*CHECKS[1], fishing, 'eventsInRFMOWithoutKnownAuthorization', 'eventsInRfmoWithoutKnownAuthorization'))
    gap = build(*CHECKS[2], source.get('gap', source.get('gaps')), None, 'aisOff')
    if 'gap' in source and 'gaps' in source:
        other = build(*CHECKS[2], source['gaps'], None, 'aisOff')
        if (gap['count'], set(gap['event_ids']), gap['status']) != (other['count'], set(other['event_ids']), other['status']):
            gap['count'], gap['status'] = None, 'conflicting'
            gap['reported_positive'] = gap['reported_positive'] or other['reported_positive']
            gap['event_ids'] = list(dict.fromkeys(gap['event_ids'] + other['event_ids']))
            gap['quality_notes'].append('The source supplied conflicting gap and gaps fields. No exact gap count is asserted.')
    indicators.append(gap)
    identity = object_value(source.get('vesselIdentity'))
    listing = build(*CHECKS[3], identity.get('iuuVesselList'), 'totalTimesListedInThePeriod')
    if vessel_id is not None and identity.get('vesselId') is not None and identity['vesselId'] != vessel_id:
        listing.update(count=None, event_ids=[], reported_positive=False, status='unverified')
        listing['quality_notes'].append('The source listing belongs to another vessel.')
    entries = object_value(identity.get('iuuVesselList')).get('valuesInThePeriod')
    if entries is not None and listing['status'] != 'unverified':
        if not isinstance(entries, list):
            listing['quality_notes'].append('Individual source listing records have an invalid structure.')
            if listing['count'] == 0:
                listing.update(count=None, status='invalid')
        elif instant(start) is not None and instant(end) is not None:
            matches = 0
            for entry in entries:
                entry = object_value(entry)
                since, until = instant(entry.get('from')), instant(entry.get('to'))
                if since is not None and until is not None and since < until and since < instant(end) and until > instant(start):
                    matches += 1
                else:
                    listing['quality_notes'].append('A source listing interval could not be verified against the report dates.')
                    if listing['count'] == 0:
                        listing.update(count=None, status='invalid')
            if matches and listing['count'] == 0:
                listing.update(count=None, reported_positive=True, status='conflicting')
                listing['quality_notes'].append('The zero listing counter contradicts a source listing interval overlapping the report. No exact count is asserted.')
            elif matches and listing['count'] is None:
                listing['reported_positive'] = True
                listing['quality_notes'].append('A source listing interval overlaps the report, but no usable total count was returned.')
    indicators.append(listing)
    flags = sum(item['reported_positive'] for item in indicators)
    missing = sum(item['count'] is None for item in indicators)
    return {'state': 'flagged' if flags else 'unknown' if missing else 'no_flags',
            'indicators': indicators, 'flag_count': flags, 'missing_count': missing,
            'quality_notes': list(dict.fromkeys(note for item in indicators for note in item['quality_notes'])),
            'source_period_precision': precision, 'note': NOTE}
