# Frontend handoff: trained fishing-activity forecast

The backend route, trained best model and required historical inference data
are included on main. Your teammate only needs to build the frontend.
The website monitors multiple vessel types; this particular model forecasts
**GFW-reported apparent fishing vessel-hours**, not all-vessel activity or legality.

## 1. Start after cloning

From the repository root, using your project's Python environment:

```powershell
python -m pip install -r backend/requirements.txt
python -m training.activity_forecast.setup_inference
python -m uvicorn backend.main:app --reload
```

The setup command extracts the included 4.2 MB inference archive into datasets.
It needs no GFW token and will not overwrite different existing local history.
Then run the existing frontend from a second terminal with `npm run dev`.
Vite's existing /api proxy targets localhost:8000. For another backend host, set
`BACKEND_URL` in the frontend's local server environment and restart Vite.
Do not place GFW secrets in browser code.

Open http://127.0.0.1:8000/docs for the implemented API contract.
`GET /health` checks the server process.
`GET /forecast/health` reports `forecast_ready` and `forecast_message`.
Neither checks access to upstream live GFW.

## 2. Map and panel

1. Load model information and dates from the info endpoint.
2. Let the user click a map location and press **Get fishing forecast**.
3. Send the point's latitude and longitude as JSON numbers.
4. Draw the returned model cell and display expected hours, baseline hours and dates.
5. Provide a **How was this estimated?** section using `selected_explanation`.

The model predicts one complete 5-degree by 5-degree cell per request. An
arbitrary rectangle does not receive its own precise prediction. If the existing
UI uses rectangles, select a point within the rectangle and draw the returned
cell separately, clearly labeled. Batch rectangle forecasts are not implemented.

Keep a **Historical demo** badge visible. Current loaded observations end
**July 31, 2025**, the simulated issue is August 3, and the forecast covers
**August 4-10, 2025**. Read these dates from responses; never replace them with today.
Do not represent current GFW vessel positions as observations from this period.

## 3. Requests

The canonical backend routes are:

- `GET /activity-forecast/info`
- `POST /activity-forecast`
- `GET /forecast/health`

In the existing frontend, call them through the /api proxy:

```typescript
export async function getForecastInfo(signal?: AbortSignal) {
  const response = await fetch("/api/activity-forecast/info", { signal });
  if (!response.ok) throw new Error("Forecast information is unavailable.");
  return response.json();
}

export async function getFishingForecast(
  latitude: number, longitude: number, signal?: AbortSignal
) {
  const response = await fetch("/api/activity-forecast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude, longitude }),
    signal,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.detail?.message
      ?? "Forecast unavailable; check the backend connection or coordinates.");
  }
  return payload;
}
```

The backend also retains /api/activity-forecast and its /info route as direct
aliases for older callers. In the frontend, use the relative URLs above so the
existing Vite proxy works without new CORS configuration.

Request example:

```json
{ "latitude": 27.5, "longitude": 122.5 }
```

Latitude must be -90 to 90; longitude -180 to 180. Do not send strings, date
overrides, imagery, polygons or extra fields. No image upload is needed.

## 4. Render responses

For HTTP 200, check `status`:

| Status | Behavior |
| --- | --- |
| scored | Display predicted_week_hours and repeat_last_week_hours; draw bounds |
| insufficient_data | Clear the old forecast and show an empty state; do not substitute zero |

The scored response provides:

- `cell_id`, `bounds`: south, north, west, east of the model cell.
- `predicted_week_hours`: final forecast.
- `repeat_last_week_hours`: last observed seven-day total (the baseline).
- `observation_cutoff`, `simulated_issue_date`, `target_start`, `target_end`.
- `selected_explanation`, `data_quality_notes`, `seasonal_reference_available`.
- Source/model details and the exact tree decision path for optional advanced details.

Calculate expected percentage change only when the baseline is positive:
`100 * (predicted_week_hours - repeat_last_week_hours) / repeat_last_week_hours`.
Otherwise show no percentage comparison. A scored zero prediction is valid;
check status rather than whether the number is truthy.

For the example point, the saved model returns approximately **34,723 hours**
versus **30,004 baseline hours**, an increase of about **15.7%**. Use the API's
actual values, not those example values for other locations.

Vessel-hours sum across vessels. They are not counts of ships, probability of
illegal activity or proof of fishing. River/land areas can have insufficient data.

Render a GeoJSON rectangle using coordinates in longitude/latitude order:
[west,south], [east,south], [east,north], [west,north], [west,south].
Draw the returned cell, not an exact ship location. Five-degree cells are broad
areas whose physical sizes vary with latitude.

## 5. Loading, failures and interpretation

- Cancel older requests with AbortController; only the latest selection can update the panel.
- Clear stale numbers when the selected location changes or a request fails.
- HTTP 422 means invalid input. HTTP 503 means the forecast service did not load.
- HTTP 500 means inference failed. Show a retry action for server/network errors.
- For insufficient data, say: **Not enough usable activity history. Try another location.**
- Display calendar dates without browser time-zone shifts.
- Show any data_quality_notes; missing annual reference is disclosed as a fallback.
- Never invent confidence intervals, daily predictions from a weekly total, or high/low legality labels.
- No credentials, imagery downloads or GFW API calls are needed for this historical forecast.

The info response includes saved evaluation metadata when available:
model MAE **418.26 hours** versus baseline MAE **448.68 hours** on the reserved
July 2025 test, or **6.78% lower average absolute error**. This is not 93.22%
accuracy, a per-location confidence score or a guarantee of future performance.
If evaluation is null, hide this performance text.

## 6. Integration checks

1. Confirm /forecast/health reports forecast_ready: true.
2. Query 27.5, 122.5: show the example forecast and cell bounds 25-30 latitude, 120-125 longitude.
3. Query 89, 0: show insufficient data and clear the previous forecast number.
4. Select locations quickly: only the latest request changes the display.
5. Stop the backend: show connection feedback, never a fabricated prediction.
6. Keep GFW observation/risk layers separate, with their own dates and evidence.
7. Include **Powered by Global Fishing Watch** linking to https://globalfishingwatch.org.

Real fixtures: [info](examples/activity_forecast_info.json),
[scored](examples/activity_forecast_scored.json),
[insufficient](examples/activity_forecast_insufficient.json).
If using fixtures for UI development, label fixture mode explicitly.

[ML source guide](../training/activity_forecast/README.md) ·
[Data bundle](../datasets/activity_forecast/README.md) ·
[Routes](../backend/forecast_api.py) · [Schemas](../backend/forecast_schemas.py)

Full raw exports and training targets remain local and ignored by Git. The
bundled files support inference; retraining needs the original development
collection/preparation steps. Litter and radar ship detection are not part of this feature.
