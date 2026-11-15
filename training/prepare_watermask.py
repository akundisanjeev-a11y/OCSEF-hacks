"""Download pinned public-domain Natural Earth geography and package a local mask."""
import gzip
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

from shapely.geometry import mapping, shape

COMMIT = "ca96624a56bd078437bca8184e78163e5039ad19"
DEST = Path(__file__).resolve().parents[1] / "backend" / "geodata" / "watermask.json.gz"


def main():
    result = {"source": "Natural Earth 1:10 million; public domain", "commit": COMMIT, "sources": {}}
    for name, filename in [("land", "ne_10m_land"), ("lakes", "ne_10m_lakes"), ("rivers", "ne_10m_rivers_lake_centerlines")]:
        url = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{COMMIT}/geojson/{filename}.geojson"
        with urlopen(url, timeout=60) as response:
            raw = response.read(60_000_000)
        data = json.loads(raw)
        result["sources"][name] = {"url": url, "sha256": hashlib.sha256(raw).hexdigest()}
        result[name] = [mapping(shape(feature["geometry"]).simplify(.005, preserve_topology=True)) for feature in data["features"] if feature.get("geometry")]
        print(name, len(result[name]), "features")
    DEST.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(DEST, "wt", encoding="utf-8") as file:
        json.dump(result, file, separators=(",", ":"))
    print("Packaged", DEST.stat().st_size, "bytes at", DEST)


if __name__ == "__main__":
    main()
