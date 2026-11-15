"""Insights-only screening: no full identity report requests."""
import asyncio
from collections import deque
import time
from datetime import timezone

from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel, Field, model_validator

from backend.services.historical import IDENTITY, gfw_request
from backend.services.risk_evidence import assess_risk

_semaphore = asyncio.Semaphore(4)
_cache = {}
_inflight = {}
INCLUDES = ["FISHING", "GAP", "VESSEL-IDENTITY-IUU-VESSEL-LIST"]


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


class RiskStreamRequest(RiskScreenRequest):
    vessel_ids: list[str] = Field(min_length=1, max_length=5000)


def classify(insights, *, vessel_id=None, start=None, end=None):
    return assess_risk(insights, vessel_id=vessel_id, start=start, end=end)


def risk_period(query):
    start = query.start.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    end = query.end.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return start, end


def cached_risk(key):
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < (60 if cached[1]["state"] == "unknown" or cached[1]["missing_count"] > 0 else 900):
        return {**cached[1], "cached": True}
    return None


def failed_risk(vessel_id, error, status):
    return {"vessel_id": vessel_id, "state": "unknown", "indicators": [], "flag_count": 0,
            "missing_count": 4, "error": error, "error_status": status, "cached": False}


async def fetch_one(vessel_id, start, end, client):
    async with _semaphore:
        try:
            insights = await gfw_request("insights/vessels", body={
                "vessels": [{"datasetId": IDENTITY, "vesselId": vessel_id}], "startDate": start, "endDate": end,
                "includes": INCLUDES,
            }, **({"client": client} if client is not None else {}))
            result = {"vessel_id": vessel_id, **classify(insights, vessel_id=vessel_id, start=start, end=end), "cached": False}
            # Screening needs counts, not potentially huge event-ID arrays.
            # The on-demand full report still retrieves the original evidence.
            result["indicators"] = [{**row, "event_ids": []} for row in result["indicators"]]
            if len(_cache) >= 5000:
                _cache.pop(next(iter(_cache)))
            _cache[(vessel_id, start, end)] = (time.monotonic(), result)
            return result
        except HTTPException as error:
            return failed_risk(vessel_id, str(error.detail), error.status_code)


async def screen_one(vessel_id, start, end, client=None):
    key = (vessel_id, start, end)
    cached = cached_risk(key)
    if cached:
        return cached
    task = _inflight.get(key)
    if task is None:
        task = asyncio.create_task(fetch_one(vessel_id, start, end, client))
        _inflight[key] = task
        task.add_done_callback(lambda _: _inflight.pop(key, None))
    # Shared in-flight work may finish and populate the cache after Stop. Only
    # four requests are scheduled at a time; no further boats start afterwards.
    return await asyncio.shield(task)


async def iter_risks(query: RiskScreenRequest, client=None):
    start, end = risk_period(query)
    remaining = deque(query.vessel_ids)
    running = set()
    completed, consecutive_failures = 0, 0
    paused = False
    began = time.monotonic()
    yield {"type": "start", "total": len(query.vessel_ids), "start": start, "end": end}
    try:
        while remaining or running:
            while remaining and len(running) < 4 and not paused:
                vessel_id = remaining.popleft()
                running.add(asyncio.create_task(screen_one(vessel_id, start, end, client)))
            if not running:
                break
            done, running = await asyncio.wait(running, timeout=10, return_when=asyncio.FIRST_COMPLETED)
            if not done:
                yield {"type": "heartbeat"}
            for task in done:
                result = task.result()
                completed += 1
                consecutive_failures = consecutive_failures + 1 if result.get("error_status") == 502 else 0
                if result.get("error_status") in (401, 403, 429, 503) or consecutive_failures >= 3:
                    paused = True
                yield {"type": "result", "result": result}
        yield {"type": "complete", "checked": completed, "total": len(query.vessel_ids), "paused": paused,
               "remaining": len(remaining), "elapsed_ms": round((time.monotonic() - began) * 1000)}
    finally:
        for task in running:
            task.cancel()
        await asyncio.gather(*running, return_exceptions=True)


async def screen_risks(query: RiskScreenRequest, client=None):
    results = {}
    async for event in iter_risks(query, client):
        if event["type"] == "result":
            result = event["result"]
            results[result["vessel_id"]] = result
    start, end = risk_period(query)
    return {"results": [results.get(vessel_id) or {**failed_risk(vessel_id, "Screening paused before this vessel was checked", None), "not_checked": True}
                        for vessel_id in query.vessel_ids], "start": start, "end": end}
