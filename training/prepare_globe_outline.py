"""Generate a small, locally served fallback basemap from our pinned geography."""
import gzip
import json
from pathlib import Path

from shapely.geometry import mapping, shape

ROOT = Path(__file__).resolve().parents[1]
with gzip.open(ROOT / "backend/geodata/watermask.json.gz", "rt", encoding="utf-8") as file:
    mask = json.load(file)
features = [{"type": "Feature", "properties": {}, "geometry": mapping(shape(item).simplify(.06, preserve_topology=True))} for item in mask["land"]]
destination = ROOT / "frontend/src/assets/land-outline.geojson"
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")), encoding="utf-8")
print("Packaged local outline:", destination.stat().st_size, "bytes")
