# Priority engine - step 2: date-matched extraction

Step 2 implements the feature collector and prepares **two** marine reference
datasets: warm-water coral reefs (2018) and seagrass (2021). Their point and polygon
layers can be indexed locally when the audited files are available. They are not
included in Git, so another teammate's index is not installed by pulling main.
Cold-water coral and saltmarsh are excluded
from the collector and preparation defaults. Original downloads are preserved.

The earlier command failed while repairing a very large saltmarsh geometry
(`GEOSException: bad allocation`). It did not undo the saved code or completed
coral/seagrass indexes. The reduced preparation command reuses those completed
indexes and does not retry saltmarsh:

```powershell
& .\.venv\Scripts\python.exe -m training.prepare_habitats
```

On a machine without the source ZIPs, obtain either the completed
`habitats.sqlite` from your teammate and copy it to
`datasets/priority_engine/habitats/habitats.sqlite`, or obtain these audited ZIPs:

- `WCMC008_CoralReefs2018_v4_1.zip`
- `WCMC013-014_SeagrassPtPy2021_v7_1.zip`

Keep both ZIPs in a local folder and run:

```powershell
.\.venv\Scripts\python.exe -m training.prepare_habitats --source-dir "C:\path\to\marine-zips"
```

Checksums must match the audited inventory. Missing ZIPs produce an actionable
error before creating an empty database. A custom prepared index may instead be
configured with `PRIORITY_HABITAT_INDEX` on the backend. No raw GIS files need to
be committed or redistributed through the website. Check `/priority/health` for
readiness, then calculate a new assessment to load the installed reference.

Core implementation:

- `backend/priority_schemas.py`: validated rectangle, explicit UTC dates and filters.
- `backend/services/priority_features.py`: GFW observations, associated-vessel
  evidence, event joins and saved-model extraction. The current-main risk parser
  is reused; existing application routes are preserved.
- `backend/services/habitat_features.py`: indexed, clipped reference lookups for
  only coral reefs and seagrass. Polygons are unioned before geodesic area is
  measured; points do not become habitat area.
- `training/prepare_habitats.py`: checksum-verified local preparation and SQLite RTree.
- `scripts/extract_priority_features.py`: backend-only extraction command.

## Date policy

The request supplies a single absolute `[start,end)` period. Only matching,
complete components enter `scoring_inputs`. Observations are never shifted to
another date merely to obtain a result. Forecasts must match the exact seven-day
target period, the selected population and complete model-cell coverage.
Partial five-degree cells are not assigned a whole-cell prediction or prorated.

**Per the user's instruction, the historical habitat layers remain reference-only
and are excluded from numerical scoring.** Their source years are displayed;
neither has documented validity covering the forecast interval. A failed or
unavailable source is not a zero, a clean vessel or a Minimal priority.

Vessel-wide flags describe the associated fleet and are labeled separately from
locally matched representative event points. Event IDs, vessel linkage, dates and
point membership are checked. Representative points do not establish complete
tracks, local event duration or illegality. Provider failures pause vessel work
and retain explicit incomplete coverage.

SAR all/matched/unmatched are overlapping views; later scoring must not add them
together as three independent detection totals. Likewise, fishing hours overlap
with presence hours. Units and observation coverage limitations remain explicit.

## Verified locally

The real GFW historical check for November 5-11, 2025, in the selected rectangle
west=-95, south=-5, east=-90, north=0 returned 334.61 apparent-fishing hours,
a matching saved-model forecast of 347.45 hours, and 11 SAR detections (9 matched,
2 unmatched). This is pipeline verification, not a new accuracy evaluation.
The result is saved in `datasets/priority_engine/aligned_live_example.json`.

That check deliberately skipped full vessel enrichment for its 359 associated
IDs. A separate one-vessel source join was verified and labeled diagnostic/partial;
it is not presented as completed area-wide screening. Automated tests cover
positive event batching, spatial/date rejection, missing data and provider pauses.

A separate vessel-ID-filtered provider request returned HTTP 404 with an upstream
infrastructure-unavailable message. The collector reported unavailable components
and did not silently remove the filter. Larger reference queries also have an
explicit memory budget and are deferred rather than sampled or falsely completed.

## Current status

Update: steps 3 and 4 are now integrated. See the
[current frontend/API guide](frontend-priority-engine-guide.md). The extraction
details and verification below record the completed step-two state.

No priority weights or score are calculated yet: `priority_score` and
`priority_category` are null. Website integration is step 4, so this backend-only
step does not change the visible website. Step 3 will consume `scoring_inputs`
to calculate the weighted review priority and five requested categories.

No commit, push or branch merge has been performed. After the remaining steps,
the agreed workflow remains `akki-folder` -> pull request into `main` -> merge.
