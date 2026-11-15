# Historical globe workflow

The default screen uses Josh's Overview globe and case dashboard, integrated from
`origin/joshua` commit `b5e3943`. Overview now defaults to GFW historical mode:
selecting an area queries `/historical/area`, plots activity cells on Josh's globe,
and lists associated vessels; selecting a vessel retrieves `/historical/vessel`.
The Overview data selector retains the offline fictional cases as an explicit
alternative. The **GFW historical** tab remains an advanced explorer, and manual
lookup is available in **Check vessel ID**. Investigations and Coastal Impact
still read the demo-seeded case store; GFW responses are not silently inserted.
The former Detection Lab is no longer in navigation; its existing source is
retained for compatibility. No imagery model or inference weights are required.

## Run locally

Use the existing Python virtual environment and npm installation:

```powershell
.venv\Scripts\python -m pip install -r backend/requirements.txt
$env:GFW_API_TOKEN = 'YOUR_PRIVATE_TOKEN'
.venv\Scripts\python -m uvicorn backend.main:app --reload
```

In a second terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Keep the token out of Git, frontend environment variables, browser storage and
screenshots. The backend reads it from the environment, not from a committed file.
Restart FastAPI after setting it. Each teammate should configure their own token.
The frontend uses the existing `/api` proxy. No token is sent to the frontend.

## User workflow

1. Choose **Fictional walkthrough** or **Global Fishing Watch** explicitly.
2. Choose AIS presence, apparent fishing, or unmatched SAR.
3. Default: a 24-hour window ending 100 hours ago, rounded down to the UTC hour.
   A 1-hour window is also available. SAR defaults to at least 124 hours ago
   because its published availability lags AIS.
4. Rotate/zoom the globe. Select **Select area by dragging**, then draw a rectangle.
   A drag submits a geographic bounding box. The coordinate fields provide a
   keyboard alternative; **Scan selected area** queries the current box.
5. Click activity cells for their values. Select a vessel in the area list to
   retrieve identity/public records and selected-period risk indicators.

Samples exist off Ghana only and are prominently marked fictional. No real-mode
error ever falls back to fictional data. Basemap loading requires internet and
WebGL; coordinate queries and the list still work without the map.

Josh's globe now has a bundled Natural Earth outline beneath Esri imagery. If
an Esri tile fails, it hides the remote imagery/labels and continues with the local
outline, without resetting activity/selection layers. The Basemap selector can
also select the local outline explicitly or retry imagery. This is a background
map fallback, never a switch from real GFW vessel data to fictional data. Rebuild
the outline from pinned local geography with `python training/prepare_globe_outline.py`.

## Data semantics

### Risk-only screening

Overview's **Screen vessel risks** button screens all area-associated vessels in
16-vessel client batches, with at most four concurrent Insights requests in one
backend process. It makes no Vessels identity requests. Results appear progressively
with Flagged, No reported flags, Incomplete/failed and Not checked filters; flagged
rows appear first. Lists paginate at 50 rows to keep large areas manageable.

Full reports are requested only using **Inspect vessel**, with the original area
time window preserved even if the clock passes into a new hour. Screening cache
entries last 15 minutes and are bounded to 5,000 vessel/period combinations.
Access/rate-limit errors pause subsequent screening; unknown/error states are never
treated as clean. Stop cancels subsequent batches, though an in-flight backend
batch may finish and cache its results. Changing area/window clears screen results.
These are GFW indicator flags, not a probability of illegal activity or permission.

### Land precheck

GFW area queries first estimate conservative dry-land coverage using bundled
Natural Earth geography. Above 75% land, no GFW reports are requested. Inland lakes
and buffered rivers are counted as water. Small selections and unavailable masks
are allowed rather than guessed to be land. An explicit override supports small
or unmapped waterways. See `backend/geodata/README.md` for resolution and caveats.

The screening API is `POST /historical/risks` with up to 16 `vessel_ids` and the
original area's timezone-aware `start` and `end`; maximum window is seven days.
Like existing endpoints, this demo assumes a trusted local environment. A public
deployment needs access controls and request quotas in front of provider access.

4Wings returns gridded activity. Dots represent 0.1-degree cells, not exact vessel
positions. A separate spatially aggregated report supplies vessel IDs for the
selected area and period. The list is associated with the full selected area,
not an arbitrary dot. No vessel coordinate is invented from the area's center.
SAR unmatched cells cannot be converted into identifiable vessels by this app.
No AIS tracks, current locations, or deliberate transponder shutdowns are inferred.

GFW public identity records and AIS self-reporting are distinguished. Public
authorization records are displayed with their original fields for scope/date
review. Authorization remains unknown until the relevant activity, location,
time, applicable rule and permit coverage are established. GFW risk insights do
not by themselves establish national permit validity or an enforcement finding.
Missing risk fields display Unavailable, never an invented zero or low-risk score.

## API and operational behavior

- `POST /historical/area`: `mode`, `west`, `south`, `east`, `north`, `hours_ago`,
  `window_hours`, `layer`. Maximum area is 40° by 30°; split date-line crossings.
- `POST /historical/vessel`: `mode`, `vessel_id`, `hours_ago`, `window_hours`.
- GFW calls use a fixed HTTPS gateway, bounded streaming response sizes, a timeout,
  JSON or a single bounded JSON ZIP report, and no token-bearing redirects.
- Reports run sequentially within one worker; use a single FastAPI worker for
  the demo. The GFW account has its own report-concurrency and request quotas.
- Area results are cached for 15 minutes, bounded to 32 areas. Restart clears cache.
- Partial/paginated reports are rejected instead of silently presented as complete.
- If risk insights fail after identity succeeds, identity remains visible with an
  explicit warning. A missing token or failed report is an actionable error.
- These historical responses are not automatically mixed into the synthetic case
  store. Persistent storage and a vetted historical replay are production follow-ups.

Live responses still need verification with a configured token and dataset access;
automated tests use documented response shapes and explicitly mocked upstreams.
The UI attributes Global Fishing Watch; review its noncommercial terms and source
attribution requirements before distribution.

## Useful ML follow-up: unusual-activity review

Train an Isolation Forest on historical region/day activity features (presence
hours, apparent fishing hours, vessel-class mix and coverage availability), using
only features actually supplied by the APIs. Compare a selected period with prior
periods and rank unusual areas for human review. Explain changes with measured
differences from baseline rather than presenting the score as a probability of
illegality. Gaps in coverage must remain missingness, not zero fishing activity.

Keep later dates out of training and evaluate on later held-out periods. Compare
against a simple baseline-change rule; inspect the top-ranked cases and report
reviewer relevance and coverage. No trained model or anomaly score is currently
implemented. GFW's apparent-fishing inference is upstream ML, not our own model.

Official references:

- https://globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/report
- https://globalfishingwatch.org/our-apis/documentation/docs/v3/vessels/get-one-vessel
- https://globalfishingwatch.org/our-apis/documentation/docs/v3/insights/insights-vessels
- https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats
