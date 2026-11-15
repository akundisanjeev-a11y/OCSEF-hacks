# Area priority: frontend integration and scoring policy

The backend calculates a **0-100 review priority** from the selected rectangle,
absolute UTC interval and fleet filters. This is a declared heuristic combining
GFW evidence and the existing trained forecast, not a new ML model or a
probability of illegality, overfishing or environmental damage.

The existing **Investigations** page now contains an **Area review
priority** panel. Select an area in Overview, open Investigations, and click
**Calculate priority**. It does not automatically spend API requests whenever
the map changes. Existing GFW, Investigations, vessel lookup and forecast routes
remain available.

## API contract

Browser requests use the existing `/api` Vite proxy. Direct backend routes omit
that prefix; `/api/priority/...` is also supported for compatibility.

1. `POST /priority/assessments` returns HTTP 202 and a job envelope.
2. Poll `GET /priority/assessments/{id}` about once per second.
3. `DELETE /priority/assessments/{id}` cancels queued/running work.
4. `GET /priority/policy` returns the versioned weights, categories and caveats.

Example request, using a full five-degree model cell and its historical forecast
period (end is exclusive):

```json
{
  "area": {"west": -95, "south": -5, "east": -90, "north": 0},
  "start": "2025-11-05T00:00:00Z",
  "end": "2025-11-12T00:00:00Z",
  "filters": {},
  "include_vessel_evidence": true
}
```

Use `result.bounds`, `result.start`, `result.end` and `result.applied_filters` from
the saved area report. The typed adapter is `frontend/src/api/priority.ts`.
It keeps fleet filters and explains that SAR display-view options are replaced
by explicit all/matched/unmatched comparisons. A client cannot submit scores,
weights, features or an arbitrary dataset for the server to trust.

Every job has `id`, `status`, `progress`, `request`, `created_at`, `result` and
`error`. Job statuses are queued/running/complete/failed/cancelled. A complete job
may have a **partial assessment** because one or more sources were unavailable.
`progress` contains `phase`, `completed` and nullable `total`.

The assessment contains:

| Field | Frontend use |
| --- | --- |
| `priority_score` | Number or null; supported lower-bound review points |
| `priority_category` | Minimal/Low/Medium/High/Critical or null when evidence is incomplete |
| `status` | complete, partial or unavailable |
| `score_range` | Lower/upper policy bounds if omitted factors range from zero to maximum; not a statistical confidence interval |
| `coverage_percent` | Percentage of policy weight evaluated; not AIS/satellite coverage or confidence |
| `factors` | Each factor's weight, availability, normalized value, contribution, sources and explanation |
| `adjustments`, `review_triggers` | Explicit High-priority escalation and its sourced review reason |
| `excluded_components` | Why a dataset did not contribute |
| `area`, `start`, `end_exclusive`, `filters`, `selection_key` | Scope/provenance; reject stale results after a selection/filter/date change |
| `policy_version`, `limitations` | Reproducibility and interpretation |

An unavailable number/category must not become zero or a green Minimal badge.
The supplied panel shows partial numbers as **At least ... / 100** and displays
**Assessment incomplete** when the category is null. Only a full assessment can
receive Minimal. Strong positive evidence may support at least High even when
other components are missing; the range and incomplete warning remain visible.

Jobs are in memory, expire 15 minutes after completion, and are lost on restart.
One assessment runs at a time, with at most four active/queued jobs and 32 retained
jobs. Duplicate requests/model versions reuse work within that window. Queue-full
requests return 429; expired IDs return 404. The frontend handles failure,
cancellation, polling and stale-result suppression. Large selections are accepted
but GFW size/time/access limits can leave components unavailable.

## Weights and normalization

| Factor | Weight | Normalized signal |
| --- | ---: | --- |
| Local representative review-event points | 35 | Maximum of no-take-MPA points capped at 1, RFMO points/3 capped at 1 times 0.75, or AIS gaps/5 capped at 1 times 0.2 |
| Area-associated fleet review context | 25 | Maximum of IUU-flagged IDs capped at 1, MPA-flagged IDs/5 times 0.5, RFMO-flagged IDs/5 times 0.35, or gap-flagged IDs/10 times 0.1; every term is capped |
| Unmatched SAR | 20 | Unmatched/all detections; all/matched/unmatched totals must be consistent. No SAR observations means the ratio is unavailable |
| Observed activity pressure | 10 | Maximum of log-scaled presence intensity times 0.5 and log-scaled fishing intensity. Reference densities: 1 and 0.1 vessel-hours per selection km²/day respectively |
| Forecast increase | 10 | Positive change versus the last observed week, capped at 100%, using a one-hour denominator floor |

Contributions are `weight × normalized signal`. The factor reference levels are
prototype policy choices, not learned thresholds or published scientific risk
standards. Duration and geodesic rectangle area normalize intensity; area includes
land. Presence/fishing pressure are not added as independent hours. Likewise,
SAR subsets and overlapping review categories are not added as unique incidents.

The score is the sum of available contributions, with an explicit floor of 60
when a matched local no-take-MPA representative event point or an associated
vessel's selected-period IUU-list review flag is present. This prioritizes human
review, not a legal finding. Missing weights widen the possible policy range;
they are not presented as observed zero. Without complete evidence, categories
are withheld unless the supported score already reaches High or Critical.

Complete-assessment bands: Minimal `[0,20)`, Low `[20,40)`, Medium `[40,60)`,
High `[60,80)`, Critical `[80,100]`.

## Date and geography rules

- The request interval is authoritative. Sources are never shifted silently.
- The forecast is used only when its exact seven-day target interval matches,
  the population is unfiltered, and whole five-degree cells cover the rectangle.
  Partial boundary cells and insufficient history exclude that factor.
- Current GFW observation dates commonly differ from the bundled 2025 forecast.
  The forecast is then excluded; other matching sources remain usable. To verify
  the historical forecast, deliberately use the interval in the example above.
- Vessel-wide flags concern the associated fleet; they do not establish where
  every underlying incident happened. Local event points are checked separately
  for vessel linkage, dates and location; full tracks/durations are not inferred.
- Hour-specific Insights periods need adequate source time precision. Missing,
  conflicting, partial or inaccessible evidence remains unavailable.
- Only coral and seagrass references are enabled. Their historical layers have
  no documented date validity matching the requested week and **never contribute
  to the current numerical score**, as instructed. No habitat damage is inferred.
- No reception/overpass coverage is established by a completed empty GFW report.
  These scores organize reported evidence, not everything occurring at sea.

## Fresh-clone setup

```powershell
python -m pip install -r backend/requirements.txt
python -m training.activity_forecast.setup_inference
python -m uvicorn backend.main:app --reload
```

In another terminal: `cd frontend`, `npm ci`, `npm run dev`.
The permanent depth-four checkpoint and matching four-day-lag compact inference
archive are included. No raw training exports or habitat GIS files are shipped.
For an existing old inference directory, preserve it and restore separately:

```powershell
python -m training.activity_forecast.setup_inference --destination datasets/activity_forecast/inference_v4
```

Set `ACTIVITY_FORECAST_DATA_DIR=datasets/activity_forecast/inference_v4` privately
in root `.env`, then restart. GFW credentials stay on the backend. No frontend
token is needed. Optional local habitat reference setup is described in the
[step-two guide](priority-engine-step2-extraction.md); scoring works without those
reference files because they are date-excluded.

Frontend source: `AreaPriority.tsx` and the typed `api/priority.ts`. The existing
backend OpenAPI schema at `/docs` includes the validated request/job/result DTOs.
