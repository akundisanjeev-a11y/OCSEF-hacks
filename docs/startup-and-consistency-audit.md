# Startup and evidence consistency audit

Completed November 15, 2026, starting from merged main commit
`a99d8e9` (pull request #17). Fixes are on
`fix/startup-and-evidence-consistency`; they have not been pushed or merged.

## 1. Clean startup

A `git archive HEAD` export was unpacked into a new temporary directory without
the working copy's virtual environment, node_modules, processed model data or
private environment files. Verification used Python 3.15, Node 24.22.1 and npm
11.19.1 on Windows.

- Created a fresh virtual environment and installed backend/requirements.txt.
- `pip check` found no broken requirements.
- Restored the included inference archive with setup_inference; no model training
  or GFW credential was needed.
- Installed frontend dependencies with npm ci and built the application.
- Started isolated FastAPI and Vite instances on ports 8011 and 5179. Process
  health, model readiness and forecast info worked through Vite's proxy.
- A model request for 27.5 latitude, 122.5 longitude returned a scored historical
  forecast of 34,722.984290720226 vessel-hours, matching the saved-model regression.
- Stopped both isolated servers. Existing servers were left running, and their
  default localhost:5173 proxy also passed process/model readiness checks.

Corrected README and frontend/backend setup guides: removed instructions for
deleted screens, removed example buttons and the old area cap, documented the
required inference-data restoration, and added explicit virtual-environment
commands and complete pytest instructions. Added backend/requirements-dev.txt
so test dependencies can be installed explicitly.

## 2. IDs, observation periods and stale responses

Fixed the following gaps:

- Full report responses are rejected before saving if the vessel ID, data mode
  or requested observation dates do not match. Equivalent timezone formats are
  accepted as the same instant.
- The screening client validates the stream's opening dates and total before
  accepting vessel results. Wrong-period or unenveloped results are rejected.
- Workspace selection identity now includes geographic bounds, mode and layer,
  in addition to dates, dataset and IDs. A different rectangle invalidates old
  screening even if its dates and boat IDs happen to be identical.
- Changing the selection clears the active report while retaining explicitly
  opened reports in session history with their original dates.
- Changing the observation period during an ID lookup invalidates a pending
  report, so it cannot be saved under a newly selected period.

Regression tests also verify that an older area request finishing last cannot
replace the latest result, and that full reports and screening send the same ID
and normalized UTC dates to GFW.

A live GFW area query returned 455 vessels. For one sampled vessel, the full
report and screening matched on vessel ID and all four indicator counts, with
no full-report warnings. The report period was
2026-11-10T14:00:00.000Z to 2026-11-11T14:00:00.000Z. A separate live stream check
verified the opening period, returned vessel ID and completion counts.

## Validation and limits

After copying the changes into the isolated checkout, the complete backend suite
passed: **117 tests plus 10 subtests**. The working frontend passed **55 tests**
and its production build. Existing dependency deprecation notices and Vite's
large-bundle warning remain; they did not fail these checks.

The live comparison is a sample, not a claim that every vessel or upstream record
has been audited. No browser visual/performance check was performed in this pass.
These steps do not constitute the later full risk-classification, model-quality,
load, security or failure-recovery audits. GFW observation dates remain separate
from the model's historical August 4–10, 2025 forecast period.
