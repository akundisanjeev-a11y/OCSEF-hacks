# OCSEF-hacks

## GhostFleet — Backend 2

Create a local environment and start the case API from the repository root:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r backend/requirements.txt
.venv\Scripts\python -m uvicorn backend.main:app --reload
```

Open http://127.0.0.1:8000/docs to try the routes:

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

Next: step 4 connects `POST /demo/run` to Backend 1's matcher and upserts cases.
