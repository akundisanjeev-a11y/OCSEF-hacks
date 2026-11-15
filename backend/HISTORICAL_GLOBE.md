# Historical globe workflow

Overview uses GFW historical data: selecting an area queries `/historical/area`,
plots activity cells and lists associated vessels. Selecting a vessel retrieves
`/historical/vessel`. The top-right Filters button controls the observation
window and provider filters. Investigations shares those real area results and
runs risk screening for their exact dates; Check vessel ID searches GFW identity
records. The duplicate historical and Coastal impact tabs are removed. No demo
case store is used by these screens.
The former Detection Lab is no longer in navigation; its existing source is
retained for compatibility. No imagery model or inference weights are required.

## Run locally

Use the existing Python virtual environment and npm installation:

```powershell
.venv\Scripts\python -m pip install -r backend/requirements.txt
.venv\Scripts\python -m training.activity_forecast.setup_inference
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
screenshots. The backend checks environment variables first, then the repository
or backend .env. It supports GFW_API_TOKEN, GFW_TOKEN, GFW_API_KEY and
GLOBAL_FISHING_WATCH_API_KEY, plus an existing bare JWT file. It never rewrites
these files. Restart FastAPI after changing environment configuration.
The frontend uses the existing `/api` proxy. No token is sent to the frontend.

## User workflow

Filters includes **Exact historical dates (UTC)**. Supply both `start` and `end`
to `/historical/area` for an absolute interval of at most seven days, end
exclusive. These override the relative window and may select an older model
release's dates; current source publishing delays still apply. **Use model dates**
loads the actual saved forecast period rather than assuming the current year.
The returned exact dates continue into reports, screening and area priority.

### Observations and your saved ML forecast

Overview includes **GFW activity filters**: flag and vessel ID; fishing gear and
port distance; AIS presence vessel type and speed; SAR AIS-match state and matched
identity filters. They apply to both cell and area-associated-vessel reports.
Incompatible filters are rejected, and arbitrary filter expressions are not
accepted. Provider filters are separate from the saved model's historical inputs.

Live checks confirmed presence cargo/speed and fishing gear/port-distance filters.
Completed empty reports sometimes return a resolved dataset key with null; these
now become empty results instead of a parsing error. Empty does not mean no boats
or adequate AIS coverage.

GFW currently rejects its documented neural_vessel_type numeric comparisons
because its queried field is text. The UI discloses this limitation and does not
offer a working-looking neural score filter. Such requests return a clear
validation error; SAR AIS-match filtering remains available.

The **ML fishing-activity forecast** drawer uses the existing saved model.
Use the rectangle's centre or enter coordinates and press **Get
fishing forecast**. It scores that point's complete five-degree model
cell, not the exact rectangle, and shows forecast dates, source cutoff, expected
hours, last-week baseline and learned explanation. No new model is trained.

The bundled model data ends July 31, 2025, forecasting August 4-10, 2025. These
dates differ from the GFW observation window and remain visible. This model
predicts apparent fishing hours only, even when the GFW layer includes all vessel
types. Neither output is a determination of illegal activity. Use the ML setup
command in the repository README if /forecast/health reports unavailable.

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

### Symbols, numbers and size

Vessel lists now distinguish fishing, cargo, carrier, tanker, passenger, tug/service,
other, mixed and unknown types using reported classifications. Fictional case
markers use their supplied tentative classifications, not inferred legal status.
Map sprites are generated locally and do not depend on online font/glyph services.

Repeated hourly/flag rows at the same activity-cell location are combined. A cell
can display `≥N`, the maximum reported vessel count across its source rows, which
is a lower bound rather than a falsely summed unique-vessel count. Missing counts
display `?`. Spatial clusters display the number of activity cells and zoom apart
when clicked; they are explicitly not labeled as unique boats.

Map size no longer encodes activity hours. A bounded relative length scale is used
only when the input identifies every contributing vessel and supplies its reported
length; means deduplicate repeated vessel IDs. Otherwise a fixed symbol size is
used. Current standard GFW gridded reports generally do not supply those lengths,
so real map symbols will often use the fixed fallback. Reported vessel lengths
can appear in full reports and populate the area table after inspection. No
additional identity lookups are made merely to manufacture size metadata, and
vessels from the area list are never assigned to arbitrary activity-cell positions.

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
  `window_hours`, `layer`. No application area-size cap; coordinates must be valid
  and increasing (split date-line crossings). Reports request `ENTIRE` time-window
  totals at the same 0.1° spatial resolution to reduce repeated hourly rows.
  Provider timeouts, report size safeguards, and the optional 75% land check still
  apply. The forecast covers the selected center's model square and neighbors,
  not every model square throughout a large rectangle.
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
