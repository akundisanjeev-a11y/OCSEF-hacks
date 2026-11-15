# OCSEF-hacks

## Historical globe

Overview now includes an **ML fishing-activity forecast** in the left sliding
drawer. Filters and area controls open from the collapsible **Filters** button
at the top right. Select an area or enter forecast coordinates manually.
The purple model-cell overlay and its displayed historical dates are separate
from the GFW observation window. This predicts apparent fishing vessel-hours,
not ship counts or illegality. See [forecast usage](docs/frontend-activity-forecast-guide.md).
Gold arrows compare neighboring squares and point toward higher predicted
activity; they do not predict boat movement. Selecting an arrow opens its values
and model explanation in the right Evidence drawer.

Overview queries GFW when an area is selected, displays activity cells and
area-associated vessels, and retrieves vessel identity/risk evidence. The
forecast and vessel evidence live in sliding drawers with bookmark toggles. Opening a vessel
report expands evidence and hides the forecast drawer. Selecting an area closes
Filters and hides empty evidence. There is no application area-size cap;
coordinates must remain valid and date-line crossings need separate rectangles.
Information labels explain activity cells, area-associated vessels and symbols.

**Investigations** uses Overview's selected boats and is the only screen for bulk risk screening. Choose **Investigate selected boats** in Overview, then **Screen vessel risks** in Investigations. Results arrive individually through a rolling four-worker stream and remain available when switching tabs. See [screening checks, performance and limits](docs/risk-screening.md).
The navigation is **Overview**, **Investigations**, then **Check vessel ID**.
The Coastal impact tab, duplicate historical tab and fictional-data selectors are removed. Reports are retained
in browser memory for this session; reloading clears them.
No image detector is required.
The default GFW window ends 100 hours ago; SAR uses at least 124 hours.
Configure `GFW_API_TOKEN` privately on FastAPI to use GFW. See
[historical globe setup and data limits](backend/HISTORICAL_GLOBE.md).
Colored areas represent recorded activity, not exact boat positions. National authorization
still requires applicable permit/rule evidence.

### Activity heatmap and boat symbols

The default blue ocean map shows a teal activity heatmap for the queried area.
Brighter green means more reported activity, not higher risk. Colors are scaled
within the returned area so quiet activity remains visible beside busy routes.
As the user zooms in, the heatmap fades into clickable approximate 0.1° activity
squares. The legend and information labels explain what the colors and units mean.
Boat types have distinct icons in the list and reports; unreported types stay unknown.

These layers do **not** show individual boat positions. GFW report documentation
limits grouping by vessel ID to spatially aggregated reports, which do not give
each boat a map position. A one-icon-per-boat location view needs an additional
position feed containing vessel ID, latitude, longitude and observation time.
Never place boats randomly inside a selected area or put every listed boat at an
activity-square center. See the [GFW report contract](https://globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/report).

## Your trained ML forecast

The forecast source, saved best model, evaluation metadata and a compact
historical inference-data bundle are included on `main`. After installing
`backend/requirements.txt`, run:

```powershell
python -m training.activity_forecast.setup_inference
python -m uvicorn backend.main:app --reload
```

Backend routes: `POST /activity-forecast`, `GET /activity-forecast/info`, and
`GET /forecast/health`. The frontend's existing Vite `/api` proxy maps browser
requests such as `/api/activity-forecast` onto those routes. The earlier direct
backend `/api/activity-forecast` URL remains an alias.

This ML component predicts **apparent fishing hours**, even though the website
monitors many vessel types. Its bundled historical observations end July 31,
2025; it is not a live forecast or an authorization classifier.
See the [frontend handoff](docs/frontend-activity-forecast-guide.md) and
[ML guide](training/activity_forecast/README.md).

## Local experiment files

The floating-litter experiment is archived outside this repository; it is not
part of the ship-monitoring workflow. Raw datasets, training runs and other model
artifacts stay local. Only the saved best forecast, its metadata/rules and the
compact historical inference bundle described above are included in Git.

## Vessel ID lookup

Open **Check vessel ID** to search GFW by MMSI, IMO, call sign or vessel name.
`POST /historical/vessels/search` proxies the GFW Vessels search with pagination;
choose a match to retrieve identity and risk evidence through
`POST /historical/vessel`. Multiple historical identities are shown separately.
Lookup uses Overview's period when available, otherwise a 24-hour window ending
100 hours ago. Opened reports also appear in Investigations.

The token must have Vessels API / `public-global-vessel-identity` access; a token
that supports activity maps may still receive 403 for identity searches. The UI
shows the provider error and never substitutes fictional results. Public registry
records alone do not establish permission to fish. The older `/vessels/check`
scoped registry endpoint remains available for direct API clients.
For a persistent 403, GFW's authentication guide says to verify the dataset ID
and request dataset access. Contact `apis@globalfishingwatch.org` with the endpoint,
dataset ID, and error message, without including your token. The documentation
does not describe a self-service permissions toggle. A fresh token alone does
not establish dataset access.
Search follows the [GFW Vessels API example](https://globalfishingwatch.org/our-apis/documentation/docs/examples/vessels/vessels-example1).

## Run GhostFleet

Prerequisites: Python and Node.js with npm. A clean Windows installation was
verified with Python 3.15, Node 24.22.1 and npm 11.19.1. Run backend commands
from the repository root, using the same virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m training.activity_forecast.setup_inference
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Before starting FastAPI, configure `GFW_API_TOKEN` privately in your terminal
environment or an ignored root/backend `.env` file (`GFW_API_TOKEN=your_token`).
Do not put the token in the frontend. The saved forecast needs no API token;
real activity queries and vessel lookups require suitable GFW access.

In a second terminal, from the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open the
URL printed by Vite (usually `http://localhost:5173`). Select an area on Overview,
choose **Investigate selected boats**, then screen risks and open reports in
Investigations. The main website uses GFW APIs and does not require image inference.

Check `http://127.0.0.1:8000/health` for process readiness and
`http://127.0.0.1:8000/forecast/health` for model readiness. Neither verifies
GFW credentials. Check `http://localhost:5173/api/health` to verify the frontend
proxy. Restart each server from its own terminal after changing its environment.

For the complete automated checks:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
cd frontend
npm test
npm run build
```

## GhostFleet — Backend 2

Create a local environment and start the case API from the repository root:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r backend/requirements.txt
.venv\Scripts\python -m uvicorn backend.main:app --reload
```

Open http://127.0.0.1:8000/docs to try the routes:

- `GET /health` returns `{"status": "ok"}` when the API is running. This checks
  the backend process, not GFW credentials or upstream availability.

- `GET /cases?data_mode=synthetic` lists six fictional cases.
- `GET /cases/synthetic-01-0` returns one case.
- `GET /cases/missing` returns HTTP 404.
- `GET /cases?data_mode=model_upload` returns `{"cases": []}`.

Cases wrap an `observation` and an `authorization` object. The process-local
`CaseService.upsert(case)` replaces by `observation_id`; it never creates duplicates
for the same ID. Each app instance has its own store, cleared on restart and seeded
with `fixtures/synthetic/static_cases.json`. Run a single server process for this demo.
No matcher is implemented yet. The two original fixtures remain
`unknown`: the first lacks activity/permit/rule evidence; the second also
lacks identity, position and time. These are fictional examples, not real vessels.

Run checks with:

```powershell
.venv\Scripts\python -m pytest -q
```

Backend 2 step 2 is available in `backend/services/permit_evidence.py`, with
fictional permits, sourced activity/zone evidence and four expected-result
scenarios. See `fixtures/synthetic/README.md` for the evidence contract.
Step 3 evaluates those inputs with `backend/services/authorization.py` and builds
cases with `backend/services/investigation.py`. Case responses now include
`vessel_assessment`, `alerts` and `review_priority`, separately from authorization.
Alerts are returned as API data for frontend display; no email or SMS is sent.

Try these details in `/docs`:

- `/cases/permit-valid-0`: authorized fishing under DEMO-PERMIT-001.
- `/cases/documented-conflict-0`: potential violation of an explicit fictional
  fishing prohibition, with a high-priority review alert.
- `/cases/ambiguous-identity-0`: possible fishing from fictional imagery hints;
  authorization remains unknown.
- `/cases/missing-evidence-0`: possible cargo carrier in a fictional shipping lane;
  activity and authorization remain unknown.

An incomplete permit register never makes a missing entry a violation. Missing
identity, confirmed activity, location, time, applicable rules or permit evidence
produces an unknown decision. Sources and reasons accompany every decision.
Explicit activity prohibitions take precedence over a supplied permit; otherwise
authorization requires a permit covering the confirmed activity, zone and time.

Vessel-type assessments use sourced imagery hints, not detection confidence.
Area use adds context but cannot establish fishing or vessel type. The included
annotations are fictional; real satellite image classification and geospatial
area membership must be supplied by Backend 1 or a separate analysis component.

`POST /demo/run` rebuilds the fictional fixture cases and returns their observation IDs. Repeated runs replace the same six records. Connecting an external matcher is a separate backend feature.
