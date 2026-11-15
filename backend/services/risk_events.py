"""Load a few source events on demand, never inventing locations or intent."""
import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import quote

from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from backend.services.historical import gfw_request, numeric

_cache = {}
_limit = asyncio.Semaphore(2)
DATASETS = {"ais_gap": "public-global-gaps-events:latest", "fishing_in_no_take_mpa": "public-global-fishing-events:latest", "no_known_rfmo_authorization": "public-global-fishing-events:latest"}


class EvidenceArea(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    west: float = Field(ge=-180, le=180)
    east: float = Field(ge=-180, le=180)
    south: float = Field(ge=-90, le=90)
    north: float = Field(ge=-90, le=90)

    @model_validator(mode="after")
    def ordered(self):
        if self.west >= self.east or self.south >= self.north:
            raise ValueError("Use an increasing area rectangle")
        return self


class RiskEventRequest(BaseModel):
    vessel_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,200}$")
    code: Literal["ais_gap", "fishing_in_no_take_mpa", "no_known_rfmo_authorization"]
    event_ids: list[str] = Field(min_length=1, max_length=3)
    start: AwareDatetime
    end: AwareDatetime
    area: EvidenceArea | None = None

    @model_validator(mode="after")
    def valid(self):
        import re
        if any(not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", value) for value in self.event_ids):
            raise ValueError("Invalid event ID")
        if not 0 < (self.end-self.start).total_seconds() <= 168*3600:
            raise ValueError("Use the report's period, at most seven days")
        self.event_ids = list(dict.fromkeys(self.event_ids))
        return self


def date_value(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo is not None else None
    except (TypeError, ValueError):
        return None


def summarize_event(event, event_id, query):
    start, end = date_value(event.get("start")), date_value(event.get("end"))
    vessel = event.get("vessel")
    linked = isinstance(vessel, dict) and vessel.get("id") == query.vessel_id
    if event.get("id") != event_id or not linked or start is None or end is None or end < start or end <= query.start or start >= query.end:
        return {"id": event_id, "status": "unverified", "message": "This source record could not be matched to the boat and report dates. It was not used to explain the flag."}
    position = event.get("position") if isinstance(event.get("position"), dict) else {}
    lat = None if isinstance(position.get("lat"), bool) else numeric(position.get("lat"))
    lon = None if isinstance(position.get("lon"), bool) else numeric(position.get("lon"))
    valid_position = lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180
    within = None
    if valid_position and query.area is not None:
        within = query.area.west <= lon <= query.area.east and query.area.south <= lat <= query.area.north
    distances = event.get("distances") if isinstance(event.get("distances"), dict) else {}
    distance = distances.get("startDistanceFromPortKm")
    distance = None if isinstance(distance, bool) else numeric(distance)
    regions = event.get("regions") if isinstance(event.get("regions"), dict) else {}
    def codes(key):
        values = regions.get(key)
        return [str(value)[:100] for value in values[:30] if isinstance(value, (str, int))] if isinstance(values, list) else []
    return {"id": event_id, "status": "matched", "type": event.get("type"), "start": start.isoformat(), "end": end.isoformat(),
            "duration_hours": (end-start).total_seconds()/3600,
            "position": {"lat": lat, "lon": lon} if valid_position else None,
            "reported_point_in_selected_area": within,
            "start_distance_from_port_km": distance if distance is not None and distance >= 0 else None,
            "protected_area_ids": codes("mpaNoTake"), "regional_fisheries_codes": codes("rfmo"),
            "scope_note": "This is a representative event point, not the complete track. Its location does not establish the location of every part of the event or explain the boat's intent."}


async def load_risk_events(query: RiskEventRequest, client=None):
    dataset = DATASETS[query.code]
    async def one(event_id):
        key = (dataset, event_id)
        cached = _cache.get(key)
        try:
            if cached and time.monotonic()-cached[0] < 900:
                event = cached[1]
            else:
                async with _limit:
                    event = await gfw_request("events/"+quote(event_id, safe=""), params={"dataset": dataset}, **({"client": client} if client is not None else {}))
                if len(json.dumps(event)) <= 100_000:
                    if len(_cache) >= 256:
                        _cache.pop(next(iter(_cache)))
                    _cache[key] = (time.monotonic(), event)
            return summarize_event(event, event_id, query)
        except HTTPException as error:
            return {"id": event_id, "status": "unavailable", "message": str(error.detail)}
    return {"events": await asyncio.gather(*(one(event_id) for event_id in query.event_ids)),
            "dataset": dataset, "source": "Global Fishing Watch Events API"}
