# Priority engine - step 1 of 4: current-main source audit

Completed November 15, 2026. **Step 1 is complete.** This document inventories the
existing features and identifies the joins and limitations that step 2 must
handle. No priority score, weights, new area endpoint or habitat spatial index
has been implemented in this step.

## Revision and scope

Fetched `origin/main` and audited commit
`84392c58d157fcfe76d4dfa3bf1914762ffe9b77` (Investigations layout update).
The checkout remains `akki-folder` at `1f90094`; no checkout, merge, commit or push
was performed. A separate read-only source copy was made under the ignored
`datasets/priority_engine/main_snapshot_84392c5/` directory.

The full tree contains 144 tracked files: 24 backend, 65 frontend, 17 training,
14 tests, 7 documentation, 9 fixture, 3 model/rules, 2 dataset files and 3 root
files. The machine-readable [inventory](priority-engine-step1-inventory.json)
records every tracked path, Git blob ID and size, plus habitat archive checksums,
schemas, CRS and geometry-header bounds. Presentation files were traced for
data ownership and selection handling; the detailed scientific inputs are the
services, schemas, inference code and source datasets below.

Source links below refer to this pinned main revision, not the older working
branch. Main already has teammates' GFW, Investigations and forecast integrations;
the older `akki-folder` backend does not contain those same services. Later work
must preserve and integrate the current main implementation rather than replace
it with the older backend.

## Permanent ML checkpoint update

The user's separate model instruction was completed before proceeding with the
priority audit. The depth-four checkpoint is now permanently saved locally at:

```text
weights/activity_forecast/best_model.joblib
weights/activity_forecast/model.joblib
```

Both have SHA256
`f81b6b381ca2af552be68bc2b2005ee076e3c8a201ad967f53ae9488bdb39d23`.
Rules and matching evaluation metadata were saved. The previous checkpoint and
reports are archived under
`weights/activity_forecast/archive/world-seasonal-depth4-lag4-20261115T182002Z/`.
Private local forecast paths in root `.env` reference the replacement and its
four-day-lag inference history. The GFW credential file was not modified.

| Same inputs and dates | Previous model MAE | Permanent depth-four MAE | Reduction versus previous | Weeks better than previous |
| --- | ---: | ---: | ---: | ---: |
| August validation | 1,079.43 h | 1,061.09 h | 1.70% | 4/4 |
| September-October test | 1,351.82 h | 1,296.76 h | 4.07% | 5/7 |

Both checkpoints received identical four-day-available inputs and targets.
The previous weights were originally trained with a three-day target gap.
This is a post-hoc operational comparison of frozen checkpoints on already
viewed outcomes, not a new independent test or proof that depth alone caused
the gain. Against the untrained persistence baseline, the replacement remains
1.02% worse in August and 1.02% better in the test period. The original failed
baseline release decision is preserved; the newer permanent-release decision
explicitly records the user's instruction to prefer the better saved model.

**Remote main still contains the old checkpoint.** The permanent update is local
until the requested later commit/PR workflow. See
[the model evaluation record](depth4-unseen-evaluation.md) and
`weights/activity_forecast/depth4_release/paired_comparison.json`.

## Existing entry points

| Endpoint on main | Implemented purpose | Rectangle-specific today? |
| --- | --- | --- |
| `POST /historical/area` | One selected GFW activity layer, gridded totals and area-associated vessels | Yes, report geometry and returned-coordinate checks |
| `POST /historical/vessel` | Identity, public authorization records, selected-period Insights | Vessel and time; no rectangle constraint on the Insights events |
| `POST /historical/risks` | Four risk indicators for up to 16 vessel IDs | Vessel/time only |
| `POST /historical/risks/stream` | Same checks streamed for up to 5,000 IDs per request | Vessel/time only; not all IDs inherently belong to a verified area |
| `POST /historical/risk-events` | Retrieve at most three specified event IDs per call and inspect representative points | Optional rectangle membership check on the reported point |
| `POST /historical/vessels/search` | Identity discovery and pagination | No; search is not proof of area presence |
| `POST /vessels/check` | Sourced configured-registry identity/permit/rule check | Conditional on entered zone/activity/time; not the selected map rectangle |
| `POST /activity-forecast` | One coordinate's five-degree fishing-activity forecast | Full containing grid cell, not clipped to the rectangle |
| `GET /activity-forecast/info` | Model version, hash, grid, time window, evaluation | Model-wide metadata |
| `/cases`, `/demo/run` | Earlier case and synthetic investigation workflow | Does not establish real selected-area evidence |

The forecast routes also have `/api/...` compatibility aliases. `/health` on main
reports process readiness; `/forecast/health` reports forecast loading status.

Source: [main routes](https://github.com/akundisanjeev-a11y/OCSEF-hacks/blob/84392c58d157fcfe76d4dfa3bf1914762ffe9b77/backend/main.py).

## GFW observation inputs

`backend/services/historical.py` defines `AreaQuery`, `report`, `query_area` and
`cells_from_rows`. The app currently fetches **one layer at a time**. The priority
engine cannot assume that selecting presence also loaded fishing and SAR.

| Layer | Dataset queried | Quantity returned | Useful future area features | Important limits |
| --- | --- | --- | --- | --- |
| AIS presence | `public-global-presence:latest` | `hours`, aggregated by flag into 0.1-degree cells | Presence-hours, density after a valid area calculation, spatial distribution, unique area-associated IDs and vessel-type mix | Includes various vessel types; hours are not unique boats or fishing hours |
| Apparent fishing | `public-global-fishing-effort:latest` | `hours`, grouped by gear type before cell aggregation | Apparent-fishing hours, distribution, per-area-associated-vessel hours, observed pressure context | Does not determine authorization, overfishing or damage |
| SAR presence | `public-global-sar-presence:latest` | `detections` on the returned grid | Detection totals and matched/unmatched context from separately specified queries | Default is unmatched; detections need not be unique ships; no identified-vessel list from this layer |

Supported request filters are `flag`, `geartype`, `vessel_id`, `vessel_type`,
`shiptype`, `speed`, `distance_from_port_km` and `sar_matched`, with layer-specific
validation. `neural_vessel_type` is present in the schema/UI but non-default
values are deliberately rejected because the provider rejected its documented
numeric filter. It is **not an available applied numeric ML feature**.

Returned cells contain `id`, `lat`, `lon`, `value`, `date`, `vessel_type`,
`vessel_count_lower_bound`, `mean_length_m` and `source_rows`. Length/type/count
may be unavailable. Vessel IDs are associated with the whole selected rectangle
and period, not linked to individual cells. `vessel_count_lower_bound` is a
maximum across contributing source rows, not a unique vessel count that can be
summed across cells. IDs, names and flags are provenance/join/filter context;
they should not become arbitrary numeric risk inputs.

Requests aggregate the complete selected time window upstream using `ENTIRE`;
the frontend heatmap does not supply a daily time series for the forecast.
`latest` resolves dynamically, whereas the model was trained on pinned `v5.0`.
The engine must retain the resolved source version and check comparability.

Source: [historical service](https://github.com/akundisanjeev-a11y/OCSEF-hacks/blob/84392c58d157fcfe76d4dfa3bf1914762ffe9b77/backend/services/historical.py).

## Risk evidence and authorization

`summarize_evidence` currently exposes exactly these four numeric checks:

| Code | GFW source | Scope and usable meaning |
| --- | --- | --- |
| `fishing_in_no_take_mpa` | `apparentFishing.periodSelectedCounters.eventsInNoTakeMPAs`, fallback event-ID list | Selected-period vessel-wide lead; local attribution needs event evidence |
| `no_known_rfmo_authorization` | `eventsInRFMOWithoutKnownAuthorization`, fallback event-ID list | Missing-known-authorization lead, not a proven illegal vessel |
| `ais_gap` | `gap.aisOff` or `gaps.aisOff` | Reported gap events; not proof of deliberate concealment |
| `iuu_listing` | `vesselIdentity.iuuVesselList.totalTimesListedInThePeriod` | Listing context for the associated vessel and period, not proof of an illegal act in the rectangle |

Screening classifies `flagged`, `no_flags` or `unknown`. `flag_count` is the number
of positive indicator categories, not the number of distinct incidents.
Unknown, unscreened, failed, missing and zero are distinct states. A vessel may
be flagged while other checks remain missing. The four-worker stream preserves
partial progress and pauses on provider access/rate failures.

The compact screening response **removes event IDs**. Full vessel enrichment
must be requested to obtain available IDs before fetching event detail. Event
detail checks vessel linkage, source ID and temporal overlap. It returns
`position`, `reported_point_in_selected_area`, `duration_hours`,
`start_distance_from_port_km`, protected-area IDs and RFMO codes. Its position
is representative, not a full track: neither the whole event duration nor all
its activity can be assigned to that point or to an intersecting habitat.
Only three IDs are accepted per event request, so exhaustive extraction needs
bounded batches and explicit completeness reporting. IUU listing counts do not
have spatial event IDs in this integration.

Live GFW enrichment deliberately returns authorization `unknown`. The separate
authorization service needs matched identity, confirmed activity, sourced rules,
zone membership, date and permit evidence; its bundled investigation inputs are
synthetic. The new engine must use **review indicators**, not invent an
`illegal_ship_count`. Known vessel-wide leads can be displayed as associated
context, while locally attributed incident evidence must remain separate.

Sources: [screening](https://github.com/akundisanjeev-a11y/OCSEF-hacks/blob/84392c58d157fcfe76d4dfa3bf1914762ffe9b77/backend/services/risk_screening.py),
[event evidence](https://github.com/akundisanjeev-a11y/OCSEF-hacks/blob/84392c58d157fcfe76d4dfa3bf1914762ffe9b77/backend/services/risk_events.py),
[authorization](https://github.com/akundisanjeev-a11y/OCSEF-hacks/blob/84392c58d157fcfe76d4dfa3bf1914762ffe9b77/backend/services/authorization.py).

## ML inputs and outputs available for integration

The model is a **seasonal correction DecisionTreeRegressor, not a RandomForest**.
The permanent local model has depth four and 16 leaves; audited remote main
still has the older depth-two checkpoint. Both are schema-version-two bundles.

| Available output/context | Meaning for the later feature adapter |
| --- | --- |
| `predicted_week_hours`, `repeat_last_week_hours` | Seven-day fishing-hours estimate and its persistence reference |
| Their difference / relative difference | Predicted activity change; relative difference is undefined when baseline is zero |
| `seasonal_estimate_hours`, `seasonal_reference_available` | Prior-year scaled reference and its availability |
| `cell_id`, `bounds` | Five-degree support footprint; deduplicate by cell ID |
| Observation cutoff, simulated issue, target start/end | Required temporal joins; not today's observations automatically |
| `status`, `data_quality_notes` | Scorable/insufficient status and reference limitations |
| Decision path, leaf correction, correction scale | Explainable numerical reasoning, not authorization or confidence probabilities |
| Main's `reasoning_evidence` | Past week/previous week/recent three days/month means, reference dates, used signals and predicted change |
| Version, hash, source dataset and evaluation | Model provenance; global error does not quantify uncertainty in each chosen rectangle |

The point endpoint has no bbox, date, flag, gear or vessel-type parameters.
`ForecastPanel` requests the selected rectangle's centre cell and up to eight
neighbours; it **does not enumerate every intersecting cell in a large area**.
Those neighbours are comparison context and can extend outside the rectangle.
The map arrows indicate higher predicted activity, not vessel movement.

The permanent local history ends October 31, 2025; its latest forecast is
November 5-11, 2025. The default GFW observation period is relative to today.
Those periods must not be silently combined into one contemporary score.
Step 2 needs either aligned historical inputs or a past-only history adapter
for the selected forecast issue, using the existing weights without retraining.
Otherwise the ML component must explicitly be temporally unavailable.

A partial five-degree cell is another material limitation: its entire forecast
cannot be assigned to a small rectangle. Full-cell containment supports a strict
in-area total. Area prorating would be an explicitly approximate estimate under
a uniform-within-cell assumption, not an exact local prediction. The later
adapter must disclose partial-cell coverage and preserve unavailable components
rather than report invented zero fishing activity. The fishing forecast does
not forecast cargo/passenger vessel activity or user-filtered subpopulations.

Source: [main forecast service](https://github.com/akundisanjeev-a11y/OCSEF-hacks/blob/84392c58d157fcfe76d4dfa3bf1914762ffe9b77/backend/services/activity_forecast.py).

Not currently supplied by these services: complete vessel tracks/positions,
global EEZ or MPA boundary geometries, complete national permit coverage,
bathymetry, a distance-to-shore raster, habitat condition, measured damage,
catch/stock depletion, or calibrated per-area forecast confidence. Event MPA/RFMO
IDs and habitat occurrences are not substitutes for those missing measurements.
The forecast has no spatial-coordinate, coastline or bathymetry feature.

## Downloaded ecosystem sources

All four local archives contain WGS84 geographic-coordinate shapefiles and an
included general UNEP-WCMC data licence. No ecosystem API key is needed to read
these local files. They are historical reference distributions, not live habitat
condition or measured damage. Being described as global does not establish
complete coverage everywhere.

| Archive | Point-like layer: type / DBF records | Polygon-layer DBF records | Relevant attributes |
| --- | --- | ---: | --- |
| `WCMC001_ColdCorals2017_v5_1.zip` | MultiPoint / 15,432 | 37 | Taxonomy, source metadata, verification, dates, depth range, reported/mapped area |
| `WCMC008_CoralReefs2018_v4_1.zip` | Point / 925 | 17,504 | Taxonomy, source metadata, verification, survey dates, reported/mapped area |
| `WCMC013-014_SeagrassPtPy2021_v7_1.zip` | Point / 17,668 | 293,147 | Dataset ID, taxonomy, verification, event dates, habitat fields, area |
| `WCMC027_Saltmarsh_v6_1.zip` | MultiPointZ / 477 | 2,469 | Source metadata, verification, survey dates, taxonomy and area |

Counts above are header-level DBF record counts; deleted records, null shapes,
geometry validity, duplication and survey completeness are **not yet validated**.
Multipoint feature counts are not individual observation counts. The coral
point layer and cold-coral polygon layer have regional extents, even though
other layers extend much more broadly. An empty intersection cannot establish
that an ecosystem is absent.

The archives expand to approximately 2.7 GB in total. Step 2 should build a
persistent spatial index, not unzip or parse every world polygon per request.
Shapely is installed locally; pyproj and common shapefile readers are currently
absent. Installing/preparing those inputs belongs to step 2.

For later extraction, intersect polygon geometries with the selected rectangle,
union overlapping footprints before measuring area, and compute area with a
geodesic/equal-area method rather than treating degree-squared as square km.
Source-provided whole-feature area is not its clipped area. Keep point occurrence
evidence separate: a point has no habitat area, and an arbitrary buffer cannot
be described as a measured habitat boundary. Preserve source/year/verification
and do not treat polygon fragmentation as ecological importance.

Only archive directories, headers, schemas, CRS and licence text were inspected;
habitat files were not extracted. Their bundled licences restrict redistribution
and require attribution. Keep raw ZIP/GIS data out of the repository and preserve
the supplied licence and citation information for the eventual implementation.
No claim that these are the latest available releases has been verified.

## Required rectangle and time guarantees identified by the audit

1. Freeze one validated WGS84 rectangle, filters, data mode and absolute UTC
   period for a scoring run. Date-line crossings currently need two rectangles.
   Do not repeatedly derive relative periods while long requests cross an hour.
2. Query all required observation layers deliberately. Preserve units and
   filters; SAR matched/unmatched comparisons need distinct comparable requests.
   Include source/version/resolution and completion status with every component.
3. Use only vessel IDs returned for that area/time as associated-vessel context.
   Join events by vessel, event ID and time, then check spatial evidence. Keep
   outside, unavailable and representative-point-only evidence distinct.
4. Enumerate and deduplicate model cells against the rectangle. Resolve partial
   cells and temporal alignment explicitly; do not sum the UI's nine-cell preview
   as though it covered the entire chosen area.
5. Clip habitat polygons and test point membership against the same rectangle.
   Report mapped habitat overlap and occurrence evidence, not proven ecosystem
   damage. Preserve data vintage and spatial-data quality.
6. Keep failed/partial/skipped/unknown distinct from zero. A provider failure or
   missing forecast must not produce a reassuring Minimal score. Later scoring
   must retain coverage and component explanations separately from the number.
7. Large selections have no width/height application cap, but provider timeouts,
   a 20 MB response limit, serial report calls and per-request screening/event
   bounds still apply. Use bounded collection with completeness/progress rather
   than silently sampling boats or dropping parts of a rectangle.

Current observation windows end at least 100 hours ago for AIS and 124 hours for
SAR, and last 1-168 hours. Including all three layers requires a common supported
period or clearly separate periods. Five-degree forecasts have a seven-day
horizon. Totals from different durations cannot be directly treated as comparable
intensities. Normalization and weights are deferred to step 3.

## Existing UI/state and deployment findings

- `CoastalImpact` already shows selected-area observations, risk coverage and a
  warning that vessel-wide events may have occurred elsewhere. It has no habitat
  join and no numerical area-priority engine. Preserve that distinction.
- The coarse land/water mask is not a habitat or vulnerability layer. Its default
  over-75%-land skip can affect coastal saltmarsh selections. Habitat extraction
  must remain separate from traffic-query skipping, and skipped traffic must
  stay unavailable rather than be interpreted as zero pressure.
- Legacy `ReviewPriority` uses routine/review/high for individual synthetic cases.
  It is a separate concept from the requested Minimal/Low/Medium/High/Critical
  area categorization and should not be overwritten.
- `HistoricalWorkspace.areaKey` currently keys by dates, dataset and vessel IDs,
  omitting bbox and filters. Reusing vessel/time risk checks can be valid, but a
  new spatial aggregation cache must include bbox, filters, mode, versions and
  model issue. Never reuse habitat/event clipping for a changed rectangle.
- Main's README still mentions an old 40-by-30-degree cap; the actual frontend
  `validSelection` and backend validators no longer impose that cap. Code is the
  authority for this audit.
- The main backend reads forecast paths from process environment variables but
  does not itself load root `.env` as the older working-branch config does.
  During integration, either load the forecast environment explicitly or start
  Uvicorn with the appropriate env file. The actual main forecast service was
  checked and can load the newly saved model with the matching data directory.
- The tracked inference archive on remote main still belongs to the old model's
  data/lag. Before pushing the permanent replacement, package matching compact
  inference data and validate restoration in a clean directory. Do not publish
  new four-day weights with only the old three-day inference metadata.
- Current branch ignore rules differ from main. A broad `git add .` would risk
  including the habitat ZIPs or unrelated remnants. Later staging must be scoped;
  include only intended model artifacts/compact history, code, tests and guides.

## Four-step sequence and Git handoff

1. **Complete:** audit latest main, verify existing feature semantics, inventory
   ecosystem inputs and identify rectangle/time limitations (this document).
2. **Next:** implement feature extraction/adapters and habitat preparation/indexing;
   verify selected-area and selected-period joins and completeness.
3. Define and implement explainable weighted review priority and the five requested
   categories. Keep uncertainty and provenance visible; this is not a newly
   trained illegality or environmental-damage classifier.
4. Integrate the area endpoint and frontend handoff, validate real/synthetic and
   boundary/missing-data cases, and finish model/data packaging. Then commit and
   push `akki-folder`, open a PR **from `akki-folder` into `main`**, and merge after
   checks so main contains the combined work.

Before implementation/integration, reconcile `akki-folder` with the then-current
main without discarding teammates' files or uncommitted local work. Preserve
ignored model/data artifacts separately before branch operations: an ordinary
untracked-file stash does not capture ignored weights. No merge or push is part
of this completed audit step.

Validation for the separate permanent-model change: 93 current-branch Python
tests passed, default local API settings load the replacement, and the audited
main forecast service returns the replacement's reasoning evidence. This does
not claim that the not-yet-implemented priority engine has passed integration tests.
