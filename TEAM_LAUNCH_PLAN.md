# GhostFleet: finish the historical globe MVP

## Agreed product

A historical globe with activity cells; draw an area to retrieve vessels associated
with that area/time and inspect identity, public authorizations and risk evidence.
The default window ends 100 hours ago. No image detector is required. Dots are
activity cells, not exact boat locations. SAR uses at least 124 hours ago and
unmatched SAR activity has no inferred vessel identity.

The globe and GFW adapters are local changes on `sanjeev`; they are not yet on
GitHub `main`. Existing automated checks passed, but live-token and visual checks
remain outstanding. Do not interpret mocked API tests as live verification.

## 1. Verify real GFW data — app/backend owner

1. Sign in and create your own token at https://globalfishingwatch.org/our-apis/tokens.
2. In the terminal that will start FastAPI, set `GFW_API_TOKEN` privately. A value
   set in a separate terminal does not automatically reach an existing server.
3. Start FastAPI from the repository root, then start the frontend separately:

```powershell
.venv\Scripts\python -m uvicorn backend.main:app --reload
```

```powershell
cd frontend
npm ci
npm run dev
```

4. Select Global Fishing Watch, AIS presence, a small area, and a 24-hour window
   ending 100 hours ago. Use a historical older window if recent coverage is empty.
5. Verify nonempty activity and an area vessel list; click a vessel and verify
   identity. Verify whether the token can access Insights separately.
6. Verify apparent-fishing and SAR layers independently. Record dataset IDs,
   request parameters, date windows and retrieved-at times; never save headers or tokens.
7. Test empty results, denied access and upstream failures. No silent sample fallback.

Done means actual provider responses were inspected, adapter fields were corrected
if necessary, and globe rotation, area dragging, cell clicks and vessel selection
were checked in a browser. Keep the source attribution visible.

## 2. Scope authorization — evidence owner, then backend owner

Choose one manageable region and a fixed historical period based on returned GFW
records, not a country preference. For an RFMO-focused demo, choose a high-seas
area covered by that RFMO, verify the applicable geography, and select a vessel
whose public authorization source/date/scope can be inspected. Do not assume a
particular area or time will contain a risk event.

Collect a small evidence packet:

- Vessel ID, MMSI/IMO as available and identity validity period.
- Original public authorization record, issuing authority, source URL, validity,
  authorized activity and geographic/species/gear scope where relevant.
- Applicable rule reference, effective dates and geographic boundaries.
- Activity/event dates, source IDs and confidence/limitations.

Use GFW Vessels public authorization records and Insights event references as
starting points. Verify underlying RFMO records on that RFMO's official website.
Concrete starting points are ICCAT's vessel records at
https://iccat.int/en/vesselsrecord.asp and the WCPFC Record of Fishing Vessels at
https://vessels.wcpfc.int/. Choose one RFMO/region after checking that the relevant
vessel records and historical dates are available; a current listing alone does
not establish authorization at a past observation time.
For protected-area examples, retrieve and verify the actual no-take designation
and effective boundary rather than assuming every MPA prohibits all fishing.
If selecting national waters instead, obtain that jurisdiction's relevant permits
and rules; RFMO evidence cannot substitute for national licensing.

Backend work still required: normalize vetted records into the permit/rule schema,
implement geographic membership, attach dated activity evidence and apply scope
checks. The current globe exposes records and indicators but keeps authorization
unknown. A missing record is not proof of unauthorized activity. Distinguish public
authorization coverage from a final legal/enforcement finding.

Done means one supported example of authorization coverage, one sourced conflict
if available, and an unknown-evidence example. If real conflict evidence cannot be
obtained, keep that scenario explicitly fictional instead of inventing it.

## 3. Make the demo repeatable — backend/frontend owners

- Save a small vetted historical replay with original response provenance,
  retrieval timestamps and dataset versions, subject to source terms.
- Add persistent investigation storage (SQLite is sufficient for this MVP).
- Expose replay mode explicitly; never imply cached/replayed records are live.
- Rehearse one region/time from area selection to vessel identity and evidence.
- Check empty areas, expired/out-of-scope evidence, missing Insights, ambiguous
  identities and failed API calls. Preserve unknowns in all of these paths.
- Verify normal and small-screen layouts and clear selection/loading states.
- Keep secrets out of commits, screenshots, fixture files and browser requests.

## Integration and main

1. Commit the reviewed globe/API work on a feature branch (or `sanjeev`) and push
   that branch so teammates can use it. Do not wait for optional ML to share it.
2. Open a pull request against current `main`, preserving teammates' changes.
3. Run backend tests and frontend build, inspect live examples and perform browser
   checks. Review the diff and confirm that secrets and generated dependencies
   are excluded.
4. Merge once the above MVP acceptance criteria pass. Configure deployment secrets
   separately; merging code does not configure GFW or deploy FastAPI/frontend.

An explorer-only release can merge before full authorization adjudication if the
UI consistently says unknown where evidence is incomplete and the PR explicitly
describes that scope. Optional ML does not have to block this release.

Do not force-push main. ML can arrive as a separate reviewed change.

## Parallel ML assignment

Send `training/AREA_REVIEW_TASK.md` to the ML teammate. It specifies a model that
works with the available API data, plus a clear interface and evaluation plan.

Official references:

- https://globalfishingwatch.org/our-apis/documentation/docs/authentication
- https://globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/report
- https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats
