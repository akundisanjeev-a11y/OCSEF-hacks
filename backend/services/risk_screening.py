"""Insights-only screening: no full identity report requests."""
import asyncio
import time
from datetime import timezone

from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel, Field, model_validator

from backend.services.historical import IDENTITY, gfw_request, summarize_evidence

_semaphore = asyncio.Semaphore(4)
_cache = {}


class RiskScreenRequest(BaseModel):
    vessel_ids: list[str] = Field(min_length=1, max_length=16)
    start: AwareDatetime
    end: AwareDatetime

    @model_validator(mode="after")
    def validate_input(self):
        import re
        if any(not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", value) for value in self.vessel_ids):
            raise ValueError("Invalid vessel ID")
        if not 0 < (self.end - self.start).total_seconds() <= 168 * 3600:
            raise ValueError("Screening period must be positive and no longer than seven days")
        self.vessel_ids = list(dict.fromkeys(self.vessel_ids))
        return self


def classify(insights):
    _, indicators = summarize_evidence({}, insights)
    known = [i for i in indicators if isinstance(i["count"], (int, float)) and i["count"] >= 0]
    flags = [i for i in known if i["count"] > 0]
    state = "flagged" if flags else "no_flags" if len(known) == len(indicators) else "unknown"
    if insights.get("vesselIdsWithoutIdentity"):
        state = "unknown"
    return {"state": state, "indicators": indicators, "flag_count": len(flags),
            "missing_count": len(indicators) - len(known),
            "note": "Risk indicators are leads for review, not findings of illegality or proof of authorization."}


async def screen_risks(query: RiskScreenRequest):
    start = query.start.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    end = query.end.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    halted = asyncio.Event()
    async def one(vessel_id):
        key = (vessel_id, start, end)
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < 900:
            return {**cached[1], "cached": True}
        async with _semaphore:
            if halted.is_set():
                return {"vessel_id": vessel_id, "state": "unknown", "indicators": [], "flag_count": 0, "missing_count": 4,
                        "error": "Screening paused after an upstream access or rate-limit error", "error_status": 429, "cached": False}
            try:
                insights = await gfw_request("insights/vessels", body={
                    "vessels": [{"datasetId": IDENTITY, "vesselId": vessel_id}], "startDate": start, "endDate": end,
                    "includes": ["FISHING", "GAP", "VESSEL-IDENTITY-IUU-VESSEL-LIST"],
                })
                result = {"vessel_id": vessel_id, **classify(insights), "cached": False}
                if len(_cache) >= 5000:
                    _cache.pop(next(iter(_cache)))
                _cache[key] = (time.monotonic(), result)
                return result
            except HTTPException as error:
                if error.status_code in (401, 403, 429, 503):
                    halted.set()
                return {"vessel_id": vessel_id, "state": "unknown", "indicators": [], "flag_count": 0,
                        "missing_count": 4, "error": str(error.detail), "error_status": error.status_code, "cached": False}
    results = await asyncio.gather(*(one(vessel_id) for vessel_id in query.vessel_ids))
    return {"results": results, "start": start, "end": end}
