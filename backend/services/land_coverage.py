"""Conservative land-area estimate; mapped inland waters are not land."""
import gzip
import json
import math
from functools import lru_cache
from pathlib import Path

from shapely import STRtree, make_valid
from shapely.geometry import box, shape
from shapely.ops import transform, unary_union

MASK = Path(__file__).resolve().parents[1] / "geodata" / "watermask.json.gz"


@lru_cache(maxsize=1)
def load_mask():
    with gzip.open(MASK, "rt", encoding="utf-8") as file:
        data = json.load(file)
    indexes = {}
    for name in ("land", "lakes", "rivers"):
        parts = []
        for item in data[name]:
            geometry = make_valid(shape(item))
            parts.extend(geometry.geoms if geometry.geom_type.startswith("Multi") else [geometry])
        indexes[name] = STRtree(parts)
    return indexes


def spherical_area(geometry):
    # Cylindrical equal-area coordinates on a unit sphere; ratio is unitless.
    return transform(lambda x, y, z=None: (math.radians(x), math.sin(math.radians(y))), geometry).area


def estimate_land(west, south, east, north):
    result = {"status": "estimated", "land_fraction": None, "skip": False,
              "source": "Natural Earth 1:10 million land, lakes/reservoirs and river centerlines",
              "note": "Conservative estimate with water buffers; small or unmapped ponds/waterways may be absent. Not a navigability assessment."}
    if east - west < .1 or north - south < .1:
        return {**result, "status": "uncertain", "note": "Selection is too small for this global mask; querying is allowed to avoid excluding narrow waterways or ponds."}
    try:
        indexes = load_mask()
        area = box(west, south, east, north)
        def nearby(name):
            tree = indexes[name]
            return [tree.geometries[i] for i in tree.query(area.buffer(.05), predicate="intersects")]
        land = unary_union(nearby("land"))
        # Erode coastline and expand inland water boundaries to avoid treating
        # cartographic shoreline uncertainty as definite dry land.
        land = land.buffer(-.03)
        lakes = unary_union(nearby("lakes")).buffer(.03)
        rivers = unary_union(nearby("rivers")).buffer(.015)
        dry = land.difference(lakes.union(rivers)).intersection(area)
        fraction = max(0, min(1, spherical_area(dry) / spherical_area(area)))
        return {**result, "land_fraction": round(fraction, 4), "skip": fraction > .75}
    except (OSError, ValueError, KeyError):
        return {**result, "status": "unavailable", "note": "Land mask is unavailable; query allowed rather than guessing that water is land."}
