# Geographic precheck data

`watermask.json.gz` packages public-domain Natural Earth land, lakes/reservoirs
and river/lake centerlines at 1:10 million cartographic scale. Source URLs, pinned
repository commit and SHA-256 hashes of original downloads are stored in the file.
Rebuild it with `python training/prepare_watermask.py` after installing backend
dependencies. The generated archive is approximately 3.6 MB and should travel with
the application. No geographic data is fetched during individual area queries.

The precheck estimates spherical area using equal-area coordinates. Coastlines
are conservatively eroded by .03 degrees, lake boundaries expanded by .03 degrees,
and river centerlines buffered by .015 degrees. These are uncertainty buffers,
not measured waterway widths. Returned land coverage is a conservative estimate,
not a precise survey, navigability map or contemporary water-level measurement.

If the estimated land fraction is strictly greater than 75%, the backend skips
GFW report requests and returns `skipped: true` with an explanation. Lakes and
buffered rivers are excluded from dry-land area. Selections narrower than .1 degree
in either dimension are considered uncertain and allowed, so this global dataset
does not block local river/pond investigation. Missing masks also allow queries
with a warning. The UI has an explicit override for unmapped or small waterways.

Not every pond, canal or seasonal water body is mapped at this scale. The precheck
cannot guarantee complete coverage of every vessel-capable water body.

Sources:

- https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-land/
- https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/
- https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-rivers-lake-centerlines/
