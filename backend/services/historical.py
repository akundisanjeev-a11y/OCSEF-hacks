"""Historical area reports and vessel enrichment; never fabricate vessel positions."""

import asyncio
import io
import json
import math
import re
import time
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel, Field, model_validator
from backend.services.land_coverage import estimate_land
from backend.services.gfw_credentials import get_gfw_token
from backend.services.risk_evidence import assess_risk

DATASETS = {"presence": "public-global-presence:latest", "fishing": "public-global-fishing-effort:latest", "sar": "public-global-sar-presence:latest"}
IDENTITY = "public-global-vessel-identity:latest"
_report_lock = asyncio.Lock()
_cache: dict[str, tuple[float, dict]] = {}


class AreaQuery(BaseModel):
    mode: Literal["synthetic", "gfw"] = "gfw"
    west: float = Field(ge=-180, le=180)
    south: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    north: float = Field(ge=-90, le=90)
    hours_ago: int = Field(default=100, ge=100, le=24 * 365)
    window_hours: int = Field(default=24, ge=1, le=168)
    layer: Literal["presence", "fishing", "sar"] = "presence"
    allow_land: bool = False
    flag: list[Annotated[str, Field(pattern=r'^[A-Z]{3}$')]] = Field(default_factory=list, max_length=10)
    geartype: list[Annotated[str, Field(pattern=r'^[a-z][a-z0-9_]{0,45}$')]] = Field(default_factory=list, max_length=10)
    vessel_id: str | None = Field(default=None, min_length=1, max_length=200, pattern=r'^[A-Za-z0-9_-]+$')
    vessel_type: str | None = Field(default=None, pattern=r'^[a-z][a-z0-9_]{0,45}$')
    shiptype: str | None = Field(default=None, pattern=r'^[a-z][a-z0-9_]{0,45}$')
    speed: Literal['<2','2-4','4-6','6-10','10-15','15-25','>25'] | None = None
    distance_from_port_km: Literal[0,1,2,3,4,5] | None = None
    sar_matched: Literal['false','true','all'] = 'false'
    neural_vessel_type: Literal['all','likely_fishing','likely_non_fishing','unknown'] = 'all'

    @model_validator(mode="after")
    def valid_area(self):
        if self.west >= self.east or self.south >= self.north:
            raise ValueError("Use an increasing bounding box; split selections crossing the date line")
        if self.layer == "sar" and self.hours_ago < 124:
            raise ValueError("SAR requires a window ending at least 124 hours ago")
        if self.layer != 'presence' and (self.vessel_type is not None or self.speed is not None):
            raise ValueError('vessel_type/speed filters apply only to AIS presence')
        if self.shiptype is not None and self.layer != 'sar':
            raise ValueError('shiptype applies only to matched SAR')
        if self.layer == 'presence' and self.geartype:
            raise ValueError('geartype applies to fishing activity or matched SAR')
        if self.layer != 'fishing' and self.distance_from_port_km is not None:
            raise ValueError('distance_from_port_km applies only to fishing activity')
        if self.layer != 'sar' and (self.sar_matched != 'false' or self.neural_vessel_type != 'all'):
            raise ValueError('SAR filters require the SAR layer')
        if self.neural_vessel_type != 'all':
            raise ValueError('GFW currently rejects documented neural score thresholds: this field is stored as text. Use SAR AIS-match filtering; no score filter was applied.')
        if self.layer == 'sar' and self.sar_matched == 'false' and (self.flag or self.geartype or self.vessel_id or self.shiptype):
            raise ValueError('Identity filters require matched SAR; unmatched detections have no established AIS identity')
        if self.mode == 'synthetic' and any((self.flag,self.geartype,self.vessel_id,self.vessel_type,self.shiptype,self.speed,
                self.distance_from_port_km is not None,self.sar_matched != 'false',self.neural_vessel_type != 'all')):
            raise ValueError('These provider filters are available in GFW mode only')
        return self


def activity_filter(query):
    clauses = []
    for field in ('flag','geartype'):
        values = getattr(query,field)
        if values:
            clauses.append(field + " in (" + ', '.join("'"+value+"'" for value in values) + ')')
    for field in ('vessel_id','vessel_type','shiptype','speed'):
        value = getattr(query,field)
        if value is not None:
            clauses.append(f"{field} = '{value}'")
    if query.distance_from_port_km is not None:
        clauses.append(f'distance_from_port_km = {query.distance_from_port_km}')
    if query.layer == 'sar':
        if query.sar_matched != 'all':
            clauses.append(f"matched='{query.sar_matched}'")
    return ' AND '.join(clauses)


class VesselEnrichment(BaseModel):
    mode: Literal["synthetic", "gfw"] = "gfw"
    vessel_id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_-]+$")
    hours_ago: int = Field(default=100, ge=100, le=24 * 365)
    window_hours: int = Field(default=24, ge=1, le=168)
    start: AwareDatetime | None = None
    end: AwareDatetime | None = None

    @model_validator(mode="after")
    def validate_explicit_period(self):
        if (self.start is None) != (self.end is None):
            raise ValueError("Supply both start and end, or neither")
        if self.start is not None and not 0 < (self.end - self.start).total_seconds() <= 168 * 3600:
            raise ValueError("Period must be positive and no longer than seven days")
        return self


def period(hours_ago: int, window_hours: int):
    end = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(hours=hours_ago)
    # GFW validates the request format more narrowly than generic ISO 8601:
    # use a UTC Z suffix rather than Python's default +00:00 offset.
    def utc_string(value):
        return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return utc_string(end - timedelta(hours=window_hours)), utc_string(end)


def strict_json_float(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError('Non-finite source number')
    return number


def strict_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate source JSON field')
        result[key] = value
    return result


def reject_json_constant(value):
    raise ValueError('Invalid source JSON number')


def decode_response(content: bytes) -> dict:
    if len(content) > 20_000_000:
        raise ValueError("Report too large; choose a smaller area")
    if content.startswith(b"PK"):
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            files = [f for f in archive.infolist() if f.filename.endswith(".json") and "caveat" not in f.filename.lower()]
            if len(files) != 1 or files[0].file_size > 20_000_000:
                raise ValueError("Unsupported report archive")
            content = archive.read(files[0])
    result = json.loads(content, parse_float=strict_json_float, parse_constant=reject_json_constant, object_pairs_hook=strict_json_object)
    if not isinstance(result, dict):
        raise ValueError("Unexpected GFW response shape")
    return result


@asynccontextmanager
async def gfw_client_scope(client=None):
    if client is not None:
        yield client
    else:
        async with httpx.AsyncClient(timeout=110, follow_redirects=False) as owned:
            yield owned


async def gfw_request(path: str, *, params=None, body=None, client=None) -> dict:
    token = get_gfw_token()
    if not token:
        raise HTTPException(503, "Set GFW_API_TOKEN in the backend environment or .env to enable GFW historical data. Fictional mode is available separately.")
    try:
        async with gfw_client_scope(client) as client:
            async with client.stream("POST" if body is not None else "GET", "https://gateway.api.globalfishingwatch.org/v3/" + path,
                                     params=params, json=body, headers={"Authorization": f"Bearer {token}"}) as response:
                if not 200 <= response.status_code < 300:
                    status = response.status_code
                    message = {401: "GFW token rejected", 403: "GFW dataset access denied", 429: "GFW rate or report concurrency limit reached; retry later", 524: "GFW report timed out; select a smaller area or retry later"}.get(status, "GFW request failed")
                    # Read only bounded, human-readable validation details. Never
                    # forward request metadata, headers, or the raw upstream body.
                    error_body, size = [], 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > 16_000:
                            break
                        error_body.append(chunk)
                    details = []
                    try:
                        payload = json.loads(b"".join(error_body))
                        if isinstance(payload, dict):
                            for entry in payload.get("messages", [])[:3]:
                                if isinstance(entry, dict):
                                    value = entry.get("detail", entry.get("title"))
                                    if isinstance(value, str):
                                        details.append(value)
                            if not details:
                                value = payload.get("message")
                                if isinstance(value, str):
                                    details.append(value)
                                elif isinstance(value, list):
                                    details.extend(v for v in value[:3] if isinstance(v, str))
                    except (ValueError, TypeError):
                        pass
                    safe = " ".join(details).replace(token, "[redacted]")
                    safe = re.sub(r"(?i)bearer\s+\S+|eyJ[A-Za-z0-9_.-]{20,}", "[redacted]", safe)
                    safe = re.sub(r"(?i)(token|api[_-]?key|authorization)\s*[=:]\s*[^\s,;]+", r"\1=[redacted]", safe)
                    safe = " ".join(safe.split())[:600]
                    detail = f"{message} (upstream HTTP {status})"
                    if safe:
                        detail += f": {safe}"
                    raise HTTPException(status if status in (401, 403, 429) else 502, detail)
                chunks, length = [], 0
                async for chunk in response.aiter_bytes():
                    length += len(chunk)
                    if length > 20_000_000:
                        raise HTTPException(502, "GFW report too large; select a smaller area")
                    chunks.append(chunk)
                return decode_response(b"".join(chunks))
    except httpx.HTTPError:
        raise HTTPException(502, "GFW is unavailable or timed out. No fictional data was substituted.")
    except (ValueError, zipfile.BadZipFile):
        raise HTTPException(502, "Unsupported GFW response. No fictional data was substituted.")


def report_rows(payload: dict, dataset: str) -> list[dict]:
    entries = payload.get("entries")
    if not isinstance(entries, list):
        raise HTTPException(502, "GFW report has no entries list")
    rows = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise HTTPException(502, "Unsupported GFW report entry")
        nested = entry.get(dataset)
        known_dataset = dataset in entry
        if nested is None:
            # :latest queries return rows under the resolved version, e.g. :v5.0.
            matching_keys = [key for key in entry if key.split(":", 1)[0] == dataset.split(":", 1)[0]]
            if len(matching_keys) == 1:
                nested = entry[matching_keys[0]]
                known_dataset = True
        # GFW returns a resolved dataset key with null for a completed empty report.
        if known_dataset and nested is None:
            continue
        if isinstance(nested, list):
            rows.extend(nested)
        elif any(key in entry for key in ("lat", "vesselId", "vessel_id", "hours", "detections")):
            rows.append(entry)
        else:
            raise HTTPException(502, "Unrecognized GFW report structure; entry fields: " + ", ".join(str(key)[:80] for key in list(entry)[:8]))
    if any(not isinstance(row, dict) for row in rows):
        raise HTTPException(502, "Unsupported GFW report rows")
    return rows


async def report(query: AreaQuery, start: str, end: str, *, vessels: bool = False, dataset: str | None = None, client=None) -> list[dict]:
    dataset = dataset or DATASETS[query.layer]
    # The UI shows totals for the entire window, not hourly playback. Aggregate
    # upstream to avoid transferring repeated hourly cell and vessel records.
    params = {"datasets[0]": dataset, "format": "JSON", "temporal-resolution": "ENTIRE",
              "date-range": f"{start},{end}", "spatial-aggregation": "true" if vessels else "false"}
    if vessels:
        params["group-by"] = "VESSEL_ID"
    elif query.layer != "sar":
        # Presence currently rejects GEARTYPE and VESSEL_TYPE despite the
        # documentation examples; FLAG is supported for its gridded report.
        params.update({"spatial-resolution": "LOW", "group-by": "FLAG" if query.layer == "presence" else "GEARTYPE"})
    else:
        params.update({"spatial-resolution": "LOW"})
    filters = activity_filter(query)
    if filters:
        params['filters[0]'] = filters
    ring = [[query.west, query.south], [query.east, query.south], [query.east, query.north], [query.west, query.north], [query.west, query.south]]
    geojson = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [ring]}}]}
    # GFW permits only one report concurrently for a user/token.
    async with _report_lock:
        data = await gfw_request("4wings/report", params=params, body={"geojson": geojson}, **({"client":client} if client is not None else {}))
    if data.get("nextOffset") or data.get("since"):
        raise HTTPException(502, "GFW returned a partial report. Narrow the area instead of treating it as complete.")
    return report_rows(data, dataset)


def numeric(value) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def cells_from_rows(rows, query):
    cells = {}
    for index, row in enumerate(rows):
        lat, lon = numeric(row.get("lat")), numeric(row.get("lon"))
        if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise HTTPException(502, "Activity report contains missing or invalid coordinates")
        if not (query.west <= lon <= query.east and query.south <= lat <= query.north):
            continue
        value = numeric(row.get("detections" if query.layer == "sar" else "hours"))
        if value is None or value < 0:
            raise HTTPException(502, "Activity report contains an invalid activity value")
        key = (lat, lon)
        cell = cells.setdefault(key, {"id": f"cell-{index}", "lat": lat, "lon": lon, "value": 0,
            "date": str(row.get("date", "")), "vessel_type": "unknown", "vessel_count_lower_bound": None,
            "mean_length_m": None, "source_rows": 0, "_types": set(), "_lengths": {}, "_all_lengths": True})
        cell["value"] += value
        cell["source_rows"] += 1
        vessel_type = row.get("vessel_type", row.get("geartype"))
        if vessel_type and str(vessel_type).lower() not in ("unknown", "other"):
            cell["_types"].add(str(vessel_type))
        count = numeric(row.get("vesselIDs"))
        if count is not None and count >= 0 and count.is_integer():
            # Across hours/flags the same vessel may recur. Summing would invent
            # a unique-vessel count; the maximum is only a lower bound.
            cell["vessel_count_lower_bound"] = max(cell["vessel_count_lower_bound"] or 0, int(count))
        identity = row.get("vesselId", row.get("vessel_id"))
        length = numeric(row.get("lengthM", row.get("length_m")))
        if identity and length is not None and length > 0 and (count is None or count <= 1):
            cell["_lengths"][identity] = length
        else:
            cell["_all_lengths"] = False
    for cell in cells.values():
        types = cell.pop("_types")
        cell["vessel_type"] = next(iter(types)) if len(types) == 1 else "mixed" if types else "unknown"
        lengths = cell.pop("_lengths")
        all_lengths = cell.pop("_all_lengths")
        if all_lengths and lengths:
            cell["mean_length_m"] = sum(lengths.values()) / len(lengths)
    return list(cells.values())


def sample_area(query, start, end):
    # Fixed fictional activity off Ghana; do not scatter fake boats into real mode.
    rows = [{"lat": 3.2 + (i // 8) * .24, "lon": -3.5 + (i % 8) * .42,
             "hours": round(.15 + (i % 5) * .13, 2), "detections": 1,
             "date": end, "vessel_type": ["fishing", "cargo", "carrier"][i % 3]} for i in range(32)]
    cells = cells_from_rows(rows, query)
    vessels = [] if not cells or query.layer == "sar" else [
        {"vessel_id": "demo-fishing-1", "name": "Fictional fishing vessel", "mmsi": "000000001", "vessel_type": "fishing", "hours": 4.5},
        {"vessel_id": "demo-cargo-2", "name": "Fictional cargo vessel", "mmsi": "000000002", "vessel_type": "cargo", "hours": 1.25},
    ]
    return {"cells": cells, "vessels": vessels}


async def query_area(query: AreaQuery):
    start, end = period(query.hours_ago, query.window_hours)
    applied_filters=query.model_dump(include={'flag','geartype','vessel_id','vessel_type','shiptype','speed','distance_from_port_km','sar_matched','neural_vessel_type'})
    land_check = await asyncio.to_thread(estimate_land, query.west, query.south, query.east, query.north) if query.mode == "gfw" else None
    if land_check and land_check["skip"] and not query.allow_land:
        return {"mode": query.mode, "layer": query.layer, "start": start, "end": end, "dataset": DATASETS[query.layer],
                "cells": [], "vessels": [], "cell_resolution_degrees": .1, "land_check": land_check,
                "bounds": {key: getattr(query, key) for key in ("west", "south", "east", "north")},"applied_filters":applied_filters,
                "skipped": True, "notes": ["Skipped before calling GFW: conservative land coverage exceeds 75%. Select a water-focused area or explicitly override the estimate."]}
    if query.mode == "synthetic":
        data = sample_area(query, start, end)
    else:
        key = query.model_dump_json() + end
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < 900:
            return cached[1]
        cells = cells_from_rows(await report(query, start, end), query)
        rows = [] if query.layer == "sar" else await report(query, start, end, vessels=True)
        vessels = {}
        for row in rows:
            vessel_id = row.get("vesselId", row.get("vessel_id"))
            if not vessel_id:
                raise HTTPException(502, "Vessel report is missing vessel IDs")
            vessel = vessels.setdefault(vessel_id, {"vessel_id": vessel_id, "name": row.get("shipName", row.get("shipname", vessel_id)),
                "mmsi": row.get("mmsi"), "vessel_type": row.get("vesselType", row.get("vessel_type", "unknown")), "hours": 0,
                "length_m": None})
            length = numeric(row.get("lengthM", row.get("length_m")))
            if length is not None and length > 0:
                vessel["length_m"] = length
            vessel["hours"] += numeric(row.get("hours")) or 0
        data = {"cells": cells, "vessels": list(vessels.values())}
    result = {**data, "mode": query.mode, "layer": query.layer, "start": start, "end": end, "land_check": land_check, "skipped": False,
              "bounds": {key: getattr(query, key) for key in ("west", "south", "east", "north")},"applied_filters":applied_filters,
              "dataset": DATASETS[query.layer], "cell_resolution_degrees": .1,
              "notes": ["Dots represent 0.1° activity cells, not exact boat positions.",
                        "Vessels are associated with the selected area and period, not assigned to individual cells.",
                        "Unmatched SAR detections have no established vessel identity; unmatched does not establish illegality."]}
    if query.mode == "gfw":
        if len(_cache) >= 32:
            _cache.pop(next(iter(_cache)))
        _cache[key] = (time.monotonic(), result)
    return result


async def enrich_vessel(request: VesselEnrichment, client=None, identity_dataset: str | None = None):
    identity_dataset = identity_dataset or IDENTITY
    start, end = period(request.hours_ago, request.window_hours)
    if request.start is not None:
        start = request.start.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        end = request.end.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    warnings = []
    if request.mode == "synthetic":
        if request.vessel_id not in ("demo-fishing-1", "demo-cargo-2"):
            raise HTTPException(404, "Fictional vessel not found")
        fishing = request.vessel_id == "demo-fishing-1"
        identity = {"selfReportedInfo": [{"id": request.vessel_id, "shipname": "Fictional fishing vessel" if fishing else "Fictional cargo vessel",
            "ssvid": "000000001" if fishing else "000000002", "shiptype": "fishing" if fishing else "cargo", "flag": "DEMO"}],
            "registryInfo": [{"source": "fictional registry"}], "registryPublicAuthorizations": []}
        insights = {"apparentFishing": {"periodSelectedCounters": {"eventsInNoTakeMPAs": 1 if fishing else 0}}, "gaps": {"aisOff": ["fictional-gap"] if fishing else []}}
    else:
        identity = await gfw_request("vessels/" + quote(request.vessel_id, safe=""), params={"dataset": identity_dataset, "registries-info-data": "ALL"}, **({"client":client} if client is not None else {}))
        try:
            insights = await gfw_request("insights/vessels", body={"vessels": [{"datasetId": identity_dataset, "vesselId": request.vessel_id}],
                "startDate": start, "endDate": end, "includes": ["FISHING", "GAP", "COVERAGE", "VESSEL-IDENTITY-IUU-VESSEL-LIST"]}, **({"client":client} if client is not None else {}))
        except HTTPException as error:
            insights = {}
            warnings.append(f"Identity was retrieved, but risk insights are unavailable: {error.detail}")
    risk = assess_risk(insights, vessel_id=request.vessel_id, start=start, end=end)
    summary, _ = summarize_evidence(identity, {})
    indicators = risk['indicators']
    warnings.extend(risk['quality_notes'])
    return {"mode": request.mode, "vessel_id": request.vessel_id, "start": start, "end": end,
            "identity": identity, "insights": insights,
            "summary": summary, "indicators": indicators, "risk": risk, "warnings": warnings,
            "authorization": {"status": "unknown", "explanation": "GFW public records and risk indicators are evidence for review. National permit coverage and the specific activity must be verified before determining authorization."},
            "sources": ["Global Fishing Watch Vessels API", "Global Fishing Watch Insights API"] if request.mode == "gfw" else ["Fictional demonstration records"]}


def summarize_evidence(identity: dict, insights: dict):
    reported = identity.get("selfReportedInfo", [])
    if isinstance(reported, dict):
        reported = [reported]
    reported = [row for row in reported if isinstance(row, dict)] if isinstance(reported, list) else []
    records = identity.get("registryInfo") or []
    records = [row for row in records if isinstance(row, dict)] if isinstance(records, list) else []
    first = reported[0] if reported else (records[0] if records else {})
    authorizations = identity.get("registryPublicAuthorizations", identity.get("registryAuthorizations", []))
    authorizations = authorizations if isinstance(authorizations, list) else []
    summary = {"name": first.get("shipname", "Not supplied"), "mmsi": first.get("ssvid"),
               "imo": first.get("imo"), "flag": first.get("flag"), "vessel_type": first.get("shiptype", first.get("geartype", "Not supplied")),
               "length_m": next((numeric(record.get("lengthM")) for record in [first, *records] if numeric(record.get("lengthM")) is not None and numeric(record.get("lengthM")) > 0), None),
               "documentation": "public_registry_record_found" if records else "ais_identity_only" if reported else "no_identity_record",
               "public_authorization_records": authorizations,
               "identity_note": "AIS identity is self-reported. Registry identity periods and authorization scopes must be checked against the activity date."}
    return summary, assess_risk(insights)['indicators']
