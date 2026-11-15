# OCSEF-hacks

## Historical globe

Overview now includes an **ML fishing-activity forecast** panel. Select an area
and follow **Open ML fishing forecast**, or try its verified historical example.
The purple model-cell overlay and its displayed historical dates are separate
from the GFW observation window. This predicts apparent fishing vessel-hours,
not ship counts or illegality. See [forecast usage](docs/frontend-activity-forecast-guide.md).

The default screen uses Josh's Overview globe and case dashboard from `joshua`.
Overview now queries GFW directly when an area is selected, displays activity
cells and area-associated vessels, and retrieves vessel identity/risk evidence.
Its data selector keeps fictional cases as a separate option. The **GFW historical**
tab remains an advanced explorer. **Check vessel ID** retains manual lookup.
Investigations/Coastal Impact still use the demo-seeded case API.
No image detector is required.
The default GFW window ends 100 hours ago; SAR uses at least 124 hours.
Choose fictional mode for a walkthrough or configure `GFW_API_TOKEN` privately
on FastAPI to use GFW. See [historical globe setup and data limits](backend/HISTORICAL_GLOBE.md).
Dots represent activity cells, not exact boat positions. National authorization
still requires applicable permit/rule evidence.

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

Open **Check vessel ID** in the frontend to enter an MMSI, IMO or registration ID.
The API route is `POST /vessels/check`. Optional activity, zone and time fields
allow conditional authorization checks. Fictional tests are built in; real checks
require a sourced server registry. See [setup and result meanings](backend/VESSEL_LOOKUP.md).

## Run GhostFleet

From the repository root, install the backend dependencies and start the API.

```sh
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --reload
```

In a second terminal, run `cd frontend`, `npm ci`, then `npm run dev`. Open the URL printed by Vite. Select **Live API** to browse case evidence and **Run fictional demo** to regenerate the six fictional cases. The Detection Lab includes fixed examples under **Sample data**. Live image inference requires a backend that implements `POST /detections`.

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
.venv\Scripts\python -m unittest discover -s tests -v
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
