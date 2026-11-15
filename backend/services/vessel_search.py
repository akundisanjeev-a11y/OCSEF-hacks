"""Search public GFW identity records; never fall back to the demo registry."""
from pydantic import BaseModel, ConfigDict, Field
from fastapi import HTTPException
from backend.services.historical import IDENTITY, gfw_request


class VesselSearch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    query: str = Field(min_length=3, max_length=100)
    since: str | None = Field(default=None, max_length=2000)


async def search_vessels(query: VesselSearch):
    params = {"datasets[0]": IDENTITY, "query": query.query, "limit": 20}
    if query.since:
        params["since"] = query.since
    try:
        response = await gfw_request("vessels/search", params=params)
    except HTTPException as error:
        if error.status_code == 403:
            raise HTTPException(403, "GFW denied vessel identity access. The backend token needs permission for the Vessels API and public-global-vessel-identity dataset. Activity-map access alone is insufficient. Verify the dataset ID and contact apis@globalfishingwatch.org to request access; do not send your token.") from error
        raise
    results, seen = [], set()
    for entry in response.get("entries", []):
        if not isinstance(entry, dict):
            continue
        rows = entry.get("selfReportedInfo") or entry.get("registryInfo") or []
        if isinstance(rows, dict):
            rows = [rows]
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            vessel_id = row.get("id") or entry.get("id")
            if not isinstance(vessel_id, str) or not vessel_id or vessel_id in seen:
                continue
            seen.add(vessel_id)
            results.append({"vessel_id": vessel_id, "name": row.get("shipname") or "Name unavailable",
                            "mmsi": row.get("ssvid"), "imo": row.get("imo"), "flag": row.get("flag"),
                            "vessel_type": row.get("shiptype") or row.get("geartype") or "Unknown"})
    return {"results": results, "since": response.get("since"), "source": "Global Fishing Watch Vessels API"}
