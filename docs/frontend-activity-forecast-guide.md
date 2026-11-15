# Frontend handoff: fishing activity forecast

The backend is implemented. Your job is to add the map interaction and forecast
panel to the website. You do not need to train a model, load Python files, upload
images, calculate ML features, or obtain an API key for these forecast routes.

## 1. What this feature does

For a location selected on the map, our ML predicts the following week's
**GFW-reported apparent fishing vessel-hours** in its containing 5-degree grid
cell. It uses recent activity and prior-year seasonal patterns.

One hundred vessels fishing for one hour each would contribute 100 vessel-hours.
This number is not a vessel count, a probability, or an authorization decision.

**This version is a historical demo.** The loaded observations end on
**July 31, 2025**. The simulated issue date is August 3 and the forecast covers
**August 4-10, 2025**. Read these dates from the API; never substitute today's date
or label the results live. The assumed publishing lag is three days.

## 2. Build this first

Keep the existing world map and add a **Fishing activity forecast** panel:

```text
World map                           Fishing activity forecast
                                    Historical demo
Click a location                    Forecast: Aug 4-10, 2025
[highlight the returned grid cell]   Data through: Jul 31, 2025
                                    Expected activity: 34,723 vessel-hours
                                    Last observed week: 30,004 vessel-hours
                                    Expected change: +15.7%
                                    [How was this estimated?]
                                    Powered by Global Fishing Watch
```

Those numbers are from a real saved-model response at latitude 27.5, longitude
122.5. They are an example, not defaults to show for every location.

1. On page load, call `GET /api/activity-forecast/info` for availability and dates.
2. Let the user click a point, then click **Get forecast**. Send its coordinates.
3. Show a loading state while the POST request runs.
4. If `status` is `scored`, draw the returned cell and show the forecast card.
5. If `status` is `insufficient_data`, show the empty state described below.

The API predicts one complete **5-degree by 5-degree cell** per request. Draw the
cell using the returned `bounds`; do not depict the clicked point as a detected
ship. These are broad areas, and their physical size varies with latitude.

If the website already uses a drawn rectangle, let the user pick a point within
it for this first version, then highlight the returned model cell separately.
Do not claim that one point's result describes the entire arbitrary rectangle.
Batch rectangle forecasts and a worldwide forecast heatmap are not implemented.

## 3. Backend URL and startup

For development on the same computer, the base URL is:

```text
http://127.0.0.1:8000
```

The ML/backend teammate starts the server from the project root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Interactive API documentation: <http://127.0.0.1:8000/docs>.
This command starts only the backend; start the existing frontend separately.

If the frontend runs on another computer, `127.0.0.1` points to that computer,
not the backend teammate's computer. Obtain the running backend's reachable URL
from the teammate hosting it. A deployed HTTPS website needs a reachable HTTPS
backend. Do not hardcode a private API key into frontend code.

For a Vite frontend, add this public setting to the frontend's own `.env.local`
and restart its dev server:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
```

The server allows `http://localhost:5173` and `http://127.0.0.1:5173` by default.
If the frontend uses another origin, the backend owner must add that exact origin
to the comma-separated `FRONTEND_ORIGINS` setting and restart the backend.
Do not replace existing token/environment settings when adding configuration.

## 4. API contract

### Read model information

```http
GET /api/activity-forecast/info
```

A successful response has `status: "ready"`, `data_mode: "historical_demo"`, model
version/checksum, source dataset, `grid_degrees`, the four dates below, and
`evaluation` if saved model evaluation metadata is available.

Use `GET /health` and its **`forecast_ready`** field for a quick readiness check.
`detector_ready` belongs to the earlier image experiment and can be false while
forecasting works. `/health` being reachable alone does not prove model readiness.
The old detector is disabled by default (`detector_enabled: false`); it does not
need to be enabled or trained to use the activity forecast.

### Request one cell's forecast

```http
POST /api/activity-forecast
Content-Type: application/json
```

```json
{
  "latitude": 27.5,
  "longitude": 122.5
}
```

Send finite JSON numbers: latitude -90 to 90, longitude -180 to 180. Do not send
strings, map screenshots, a polygon, a date, or extra fields. The backend selects
the current loaded historical period and maps coordinates to the model grid.
Most map SDKs expose coordinates as `lat`/`lng`; rename them to `latitude` and
`longitude` in this request. GeoJSON coordinates use longitude first.

### Success: HTTP 200, `status: "scored"`

The complete real response is in [activity_forecast_scored.json](examples/activity_forecast_scored.json).
The fields the screen needs are:

| Field | Display/use |
| --- | --- |
| `predicted_week_hours` | Expected apparent fishing vessel-hours over the target week |
| `repeat_last_week_hours` | Last observed seven-day total: the comparison baseline |
| `bounds` | `south`, `north`, `west`, `east` of the predicted model cell |
| `cell_id` | Stable model cell key, useful for avoiding duplicate map polygons |
| `data_mode` | Keep the historical-demo badge visible |
| `observation_cutoff` | Latest observation date; label "Data through" |
| `simulated_issue_date` | Historical forecast issue date, after the assumed data lag |
| `target_start`, `target_end` | Inclusive dates the forecast describes |
| `selected_explanation` | Plain explanation for an expandable details section |
| `seasonal_reference_available` | Whether usable prior-year reference data was available |
| `data_quality_notes` | Show any fallback/data notes without treating them as a crash |
| `source_dataset`, `model_version` | Optional source/model details |

The response also includes a seasonal estimate and the learned tree's decision
path. These can stay in advanced details. The seasonal estimate is an input to
the model; it is not the final forecast or a confidence bound.

### Empty area: HTTP 200, `status: "insufficient_data"`

```json
{
  "data_mode": "historical_demo",
  "observation_cutoff": "2025-07-31",
  "simulated_issue_date": "2025-08-03",
  "target_start": "2025-08-04",
  "target_end": "2025-08-10",
  "bounds": {"south": 85, "north": 90, "west": 0, "east": 5},
  "status": "insufficient_data",
  "cell_id": "lat35_lon36",
  "reason": "invalid_or_no_reported_activity_history"
}
```

There is no `predicted_week_hours` in this response. Clear the previous location's
forecast and show:

> Not enough usable reported activity history for this area. Try another location.

Keep the selected cell outline if helpful. Do not turn missing history into zero
activity or a safe/authorized status. Other possible `reason` values are
`no_downloaded_history` and `need_28_complete_days`.

### HTTP errors

| Status | Meaning | Frontend behavior |
| --- | --- | --- |
| 422 | Invalid/missing coordinates or extra request fields | Check request fields; show a helpful validation error |
| 503 | Model/data could not load at server startup | "Forecast service unavailable. Please try again later." |
| 500 | Inference failed unexpectedly | Show a retry action; let the backend owner inspect server logs |
| Network/CORS failure | Server unreachable, wrong URL or origin mismatch | Show connection feedback and a retry action |

For 500/503, the JSON structure is `{"detail":{"code":"...","message":"..."}}`.
For 422, `detail` is a validation-error array. Never assume `detail` is always text.

## 5. Copyable TypeScript API adapter

Put the API calls in your existing frontend service layer, for example
`src/services/activityForecast.ts`. This example uses Vite's public environment
variable; adapt only that line if the project uses another framework.

```typescript
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000")
  .replace(/\/+$/, "");

export type Bounds = { south: number; north: number; west: number; east: number };

type Period = {
  data_mode: "historical_demo";
  observation_cutoff: string;
  simulated_issue_date: string;
  target_start: string;
  target_end: string;
};

export type ScoredForecast = Period & {
  status: "scored";
  cell_id: string;
  bounds: Bounds;
  predicted_week_hours: number;
  repeat_last_week_hours: number;
  selected_explanation: string;
  seasonal_reference_available: boolean;
  data_quality_notes: string[];
  source_dataset: string;
  model_version: string;
};

export type ForecastResponse = ScoredForecast | (Period & {
  status: "insufficient_data";
  cell_id: string;
  bounds: Bounds;
  reason: string;
});

export type ForecastInfo = Period & {
  status: "ready";
  model_version: string;
  source_dataset: string;
  grid_degrees: number;
  minimum_history_days: number;
  evaluation: null | {
    mae_hours: number;
    baseline_mae_hours: number;
    mae_reduction_percent: number | null;
    issue_start: string;
    issue_end: string;
  };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.detail?.message
      ?? (response.status === 422 ? "Please select valid map coordinates."
                                 : `Forecast request failed (${response.status}).`);
    throw new Error(message);
  }
  return payload as T;
}

export function getForecastInfo(signal?: AbortSignal) {
  return request<ForecastInfo>("/api/activity-forecast/info", { signal });
}

export function getActivityForecast(latitude: number, longitude: number,
                                    signal?: AbortSignal) {
  return request<ForecastResponse>("/api/activity-forecast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude, longitude }),
    signal,
  });
}
```

The TypeScript types cover the fields used by the UI; the backend returns
additional documented fields. All dates are `YYYY-MM-DD` calendar dates; display
them without a local-time-zone shift (for example, format in UTC).

Use an `AbortController` to cancel an older request when a new location is
selected. Check its signal before applying results or clearing loading state,
so a slow older response cannot overwrite the newest selection. Catch errors
and show connection feedback; silently ignore intentional request cancellation.
Only the latest selection's result should be visible. Clear stale results when
the location changes or a request fails.

## 6. Draw the cell and calculate the change

Convert the returned bounds to a GeoJSON polygon for the existing map library:

```typescript
export function cellPolygon(b: Bounds) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "Polygon" as const,
      coordinates: [[
        [b.west, b.south], [b.east, b.south],
        [b.east, b.north], [b.west, b.north], [b.west, b.south],
      ]],
    },
  };
}

// Only after narrowing response.status === "scored":
export function percentChange(result: ScoredForecast): number | null {
  return result.repeat_last_week_hours > 0
    ? 100 * (result.predicted_week_hours - result.repeat_last_week_hours)
          / result.repeat_last_week_hours
    : null;
}
```

Use a single outline and a lightly filled cell. If your SDK uses coordinate
tuples, adapt the polygon's numeric arrays to its existing types. Reuse the
website's map library; no new map provider is required.

Format hours with `Intl.NumberFormat` to round for display; retain raw numbers in
state. Display percentages to one decimal place. If percent change is null, show
"No percentage comparison available". A zero prediction can be legitimate when
`status` is `scored`; check the status, not whether the numeric result is truthy.

Label an increase "Expected activity increase", not "Higher illegal activity".
Never color an area safe/dangerous from this forecast alone. No calibrated
confidence score or uncertainty interval is returned, and a weekly total cannot
be divided into seven invented daily predictions for a chart.

## 7. Combine with the existing GFW website

- Keep the teammate's GFW observations/vessel/authorization features working as
  their own layers. This forecast API adds a separate ML panel and cell overlay.
- GFW observed activity and our forecast must have separate labels and dates.
  Current vessel positions must not be portrayed as observations from this
  historical forecast period.
- The map's satellite basemap is just navigation context. No radar image,
  screenshot, YOLO inference, vessel ID or GFW token is required by these routes.
- Keep GFW credentials server-side in the teammate's existing integration.
  The forecast API reads already prepared local data and makes no GFW requests.
- Include **Powered by Global Fishing Watch** linking to
  <https://globalfishingwatch.org> and preserve existing map-provider attribution.

Optional model-quality text can use `/info`'s saved evaluation:

> On the July 2025 historical test, our model's average absolute error was 6.78%
> lower than repeating the last observed week.

That is an overall historical test result, not 93.22% accuracy, confidence in the
selected location, a current forecast guarantee, or a per-cell error interval.
If `evaluation` is null, hide this model-quality text instead of inventing values.

## 8. Before handing the frontend back

1. `/info` loads and the historical dates stay visible.
2. Click latitude 27.5, longitude 122.5: show approximately **34,723 vessel-hours**
   and the cell spanning 25-30 latitude, 120-125 longitude.
3. Click latitude 89, longitude 0: show insufficient data and remove the previous
   forecast number. This is a real empty-area response from the loaded dataset.
4. Change locations quickly: only the latest response updates the card/map.
5. Stop the backend: show connection feedback, not a zero or fabricated result.
6. Verify browser CORS with the actual frontend origin and test on a small screen.
7. Check all labels: historical forecast, correct target dates, vessel-hours,
   and no unsupported authorization/confidence claims.

Real response fixtures for UI development are in [examples](examples/):
[ready/info](examples/activity_forecast_info.json),
[scored](examples/activity_forecast_scored.json), and
[insufficient](examples/activity_forecast_insufficient.json).
If using fixtures while the server is offline, label that mode explicitly; do not
silently substitute a fixture for a failed live API call.

## Reference for the teammate running the backend

The frontend only needs the running API URL. The server needs these local files,
which are ignored by Git and do not appear automatically in another clone:

```text
weights/activity_forecast/best_model.joblib
weights/activity_forecast/best_model_metadata.json
datasets/activity_forecast/processed/
  metadata.json
  daily_world.csv
  seasonal_history/{metadata.json,daily_world.csv}
  fresh_test/{metadata.json,daily_world.csv}
  inference_reference/{metadata.json,daily_world.csv}
```

Use the project's locked training-compatible dependencies. The saved data and
model must be available on the backend host; do not put them in the browser's
public directory. Only load a trusted team-created joblib checkpoint.
The default API loads this exact saved best model, not the earlier YOLO weights.
Model/data load once at server startup; restart after changing them.
`ACTIVITY_FORECAST_MODEL_PATH` and `ACTIVITY_FORECAST_DATA_DIR` can override their
default paths on the backend. The last two history blocks are optional in code,
but include them to reproduce the documented July-31 cutoff and August seasonal
reference; missing annual reference is disclosed in the response.

Implementation: [routes](../backend/forecast_api.py),
[schemas](../backend/forecast_schemas.py),
[service](../backend/services/activity_forecast.py),
[OpenAPI contract](openapi.json),
[ML details](../training/activity_forecast/README.md).
