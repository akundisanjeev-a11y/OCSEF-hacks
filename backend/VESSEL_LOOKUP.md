# Vessel ID checks

Use **Check vessel ID** in the frontend, or `POST /vessels/check` in FastAPI `/docs`.
This workflow runs independently of detector training. It does not identify a boat
from imagery, verify a transmitted ID, or search a global vessel registry.

The form accepts an MMSI (nine digits), IMO (seven digits with a valid checksum,
optionally prefixed by `IMO`), or a registration/boat ID (exact match). Leading
zeros are preserved. Vessel names are not unique identifiers and are not searched.

An ID alone checks whether the selected registry documents the vessel. To evaluate
authorization, also enter an activity, registry zone ID and timezone-aware capture
time. Permission is conditional on these entered claims; zone membership is not
computed from satellite imagery or coordinates. Vessel type from a record is
displayed separately and does not establish observed fishing activity.

## Try it now

Start FastAPI and the frontend using the repository README commands. Open the new
**Check vessel ID** tab and use **Valid permit**, **Rule conflict**, or **ID not
found**, then **Check vessel**. These buttons explicitly select fictional mode.

| Registry | MMSI | Activity | Zone | Capture time | Expected |
| --- | --- | --- | --- | --- | --- |
| Fictional | 000000001 | fishing | DEMO-OFFSHORE-A | 2026-01-01T10:00:00Z | Documented; authorized |
| Fictional | 000000001 | fishing | DEMO-OFFSHORE-B | 2026-01-01T10:00:00Z | Documented; potential violation |
| Fictional | 000000002 | fishing | DEMO-OFFSHORE-A | 2026-01-01T10:00:00Z | Documented cargo carrier; authorization unknown |
| Fictional | 000000099 | fishing | DEMO-OFFSHORE-A | 2026-01-01T10:00:00Z | Not found; authorization unknown |

## Supply real records

Real lookup starts with no registry configured. It returns `registry_unavailable`,
never fictional results for a real ID. An actual sourced record set is required
before the app can make useful real-world checks.

1. Copy `backend/vessel-registry.template.json` to a private path such as
   `data/vessel-registry.json`. This directory is Git-ignored.
2. Replace the description, sources and retrieval date with the actual registry
   coverage and provenance. Populate `records` and `rules` with documented inputs.
   Use `fixtures/synthetic/vessel_registry.json` as a structural example only;
   do not relabel fictional inputs as real evidence.
3. Set the path in the FastAPI terminal before starting the server:

```powershell
$env:GHOSTFLEET_VESSEL_REGISTRY = 'C:\path\to\data\vessel-registry.json'
.venv\Scripts\python -m uvicorn backend.main:app --reload
```

Each vessel record contains a unique `record_id`, `name`, sourced MMSI/IMO and/or
registration ID, optional `vessel_type`, `sources`, and `permits`. Each permit
contains `permit_id`, `valid_from`, `valid_until`, `zone_id`, `activity`, `sources`.
Rules contain `rule_id`, `zone_id`, `activity`, `valid_from`, `valid_until`,
`condition` (`permit_required` or `activity_prohibited`) and `sources`.
Validity intervals include the start and exclude the end.

The configured file is read and validated per request. An invalid/unreadable file
returns HTTP 503. Requests cannot supply their own permit or rule records. Keep
registry maintenance restricted to trusted operators; file contents are trusted
evidence, and source authenticity is not automatically verified. Only place
records you are permitted to display in this registry: matching records and their
sources are returned to the frontend. No credentials belong in source strings.

## Meaning of the result

- `documented`: one matching record in the selected dataset, not global identity
  verification or an assertion that the ID belongs to a particular detected boat.
- `not_found`: no match in that dataset; authorization stays unknown.
- `ambiguous`: multiple matching records; authorization stays unknown.
- `registry_unavailable`: no sourced registry configured.
- `authorized`: supplied permit and rule evidence covers the entered context.
- `potential_violation`: a sourced rule explicitly prohibits the entered activity
  at that zone/time, even if a supplied permit would otherwise cover it.
- `unknown`: missing context, rules, or applicable permit evidence.

There is no automatic unauthorized label for a missing/expired permit because
the register may be incomplete. Results include explanations, source references,
registry retrieval date and assumptions. Checks are read-only and are not saved
as satellite cases or sent as notifications.
