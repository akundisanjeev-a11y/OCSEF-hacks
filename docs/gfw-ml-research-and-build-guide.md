# GFW capability audit and ML extension guide

**Implementation update:** worldwide training now selects a two-level seasonal
correction tree, compared with calibration, a seasonal blend and the last-week
baseline. It reduced MAE by 6.78% on the reserved July 2025 test. Follow
[`../training/activity_forecast/README.md`](../training/activity_forecast/README.md)
for the current dataset and training entry point. The regional gradient-boosting
discussion below is retained as prior research, not the current implementation.

Research date: 2026-11-14. Scope: four high-school teammates, roughly 12 working
hours. This is a research recommendation, not approval to replace an existing
implementation. No API token was used or endpoint availability tested for your
account. Product findings are from the public sources linked below.

## 1. Findings and limits of novelty

Global Fishing Watch already provides public tools/data for vessel identity and
registry information, apparent fishing, encounters, loitering, port visits, AIS
gaps, satellite vessel detections, selected authorization/risk insights, area
reports, environmental layers, and custom uploaded data. It also publishes an
MCP/CLI connector for AI assistants. Generic dashboards, vessel chatbots, AIS-gap
detectors and protected-area overlap alerts have substantial existing overlap.

Relevant existing products include the public Map, Marine Manager and Vessel
Viewer. The Insights API includes apparent fishing in no-take MPAs, events in
RFMO areas without known authorization, AIS coverage/gaps and IUU-list evidence.
Longline night-setting insights already address a particular seabird-bycatch
mitigation behavior. None of these is a universal legality determination.

I did not find a documented public API that returns the particular regional,
forward-looking, uncertainty-evaluated activity forecasts proposed here. That is
a bounded finding about reviewed documentation, not proof of absence from all
GFW research, internal projects or partner products.

Fishing forecasts are not globally novel: the NGA/NSIN forecasting challenge
already evaluated daily and weekly forecasts against GFW activity. An original
team implementation and useful local workflow are achievable; a first-ever
invention claim is unsupported.

## 2. Important current access changes

The November 3, 2026 notice says vessel-track file downloads are paused and
4Wings requests grouped by MMSI or VESSEL_ID with spatial-aggregation=false
return 404. It says other endpoints and spatially aggregated reports are
unaffected. Do not design the MVP around downloading raw individual tracks.

Use a small aggregate report first to verify current behavior with your own
server-side token. Keep keys out of the frontend, Git and shared examples. Pin
the dataset version and retain successful responses and query metadata. GFW's
October 2026 pipeline upgrade changed historical estimates/classifications.
The service is intended for noncommercial use and requires attribution; check
the particular data's metadata as well as API terms. Execute reports sequentially
and cache them; report concurrency is a separate constraint from request limits.

## 3. Options considered

| Feature | Own ML | Added input/dependency | Assessment |
| --- | --- | --- | --- |
| Forecast area-level activity and quantify forecast uncertainty | Regression trained on historical cell/day measurements | Bounded daily activity export | Recommended first prototype if data access succeeds |
| Local permit-document extraction and reconciliation | Pretrained document/NLP model; human-confirmed fields | Actual local documents with effective dates and scope | Useful alternate direction; new local evidence is essential |
| Learn reviewer-specific investigation priorities | Ranking/classification trained on actual review outcomes | A credible labeled review history | Potential later feature; currently missing labels |
| Context-adjusted historical change detection | Conditional expectation model plus residual ranking | Historical activity, optionally environmental context | Feasible alternative, but substantial overlap with existing maritime analytics |
| Proposed-closure activity redistribution | Spatial/causal behavior model | Comparable interventions, longer histories and assumptions | Too ambitious for a defensible 12-hour build |
| Habitat damage prediction | Supervised impact model | Independent habitat-condition/damage outcomes | Unsupported by vessel activity alone |

These are engineering assessments, not model-performance measurements. Combining
model output with a route optimizer is a possible later workflow; route
optimization itself must not be mislabeled as trained ML.

## 4. Recommended product

Question: "Which supported areas are expected to have more reported apparent
fishing activity during a specified future week, and how reliable are those
forecasts?"

Use a regional grid with an observed-history layer, a forecast layer, an interval
display, and a historical replay mode that reveals the subsequently observed
activity. Show comparison with a simple baseline. Optional user-defined areas
or a separately sourced habitat overlay can focus review, but do not change an
activity forecast into ecological damage or illegality prediction.

Predict one target: the sum of GFW-reported apparent fishing vessel-hours in a
cell over the target week. This is a prediction of the upstream modeled product,
not independently confirmed fishing, fish biomass, unique vessel counts, or
unauthorized-vessel activity. Credit GFW's upstream ML separately from yours.

## 5. Data-access gate: complete before model work

1. Use your existing GFW account/token on the backend; do not paste it into chat.
2. Request one small region and a short historical period using the documented
   4Wings Report API, DAILY temporal resolution and gridded output.
3. Start with apparent fishing activity, pinning an accessible explicit version.
   The v5 documentation uses public-global-fishing-effort:v5.0; API naming may
   retain "effort" while the UI calls it activity.
4. Confirm response format, coordinates, hours, dates, empty-result semantics and
   access permissions. Reports may be packaged exports; parse the actual response
   rather than assuming a particular JSON shape from one example.
5. Confirm that the candidate region has enough nonconstant recorded activity.
6. Only then collect a bounded longer history, in sequential cached chunks.

Timebox the gate to the first hour. If data access fails, finish a clearly labeled
cached/historical prototype only when a legitimately obtained dataset is available.
Do not substitute synthetic numbers and call them live GFW results.

## 6. Dataset and availability contract

Prefer roughly 6-12 months for a regional forecasting experiment if feasible.
One full year exposes an annual cycle but does not guarantee seasonal skill.
With only 60-90 days, restrict claims to a short-history prototype.

Start with about 10-25 fixed analysis cells; choose cell size after inspecting the
region. One-degree cells are broad screening areas, not precise patrol targets.
Fetch an appropriate source grid and aggregate into stable, nonoverlapping cells.
Keep geometry and partial-boundary treatment consistent across all dates.

Each row should preserve:

```text
cell_id, cell_bounds, observation_date_utc
apparent_fishing_hours
report_status, source_dataset, source_version
query_window, retrieved_at, raw_response_reference
```

An absent/failed request is missing data. A completed export with no reported
activity can support a zero observation under its documented semantics, but does
not establish good reception or an absence of boats. Exclude missing target days;
do not train on invented zero targets. Never sum cell-level unique-vessel counts
and call the result a regional unique-vessel count.

Record last_complete_observation_date and forecast_issued_at separately. Publishing
latency means the most recent available observation is not necessarily today.

For illustration only: if the issue date is January 10 and complete observations
stop January 7, a forecast for January 11-17 predicts days 4-10 after the last
observed day. Train and backtest that horizon, not an easier January 8 prediction
presented as a forecast issued January 10. Measure the actual gap; do not assume
the example latency applies to all datasets or dates.

A historical replay using today-downloaded historical data is retrospective
validation under an assumed availability lag. It is not a verified real-time
backtest: historical source estimates can be revised and their original publication
state is generally not captured. State this limitation.

## 7. Features and target

Use a shared model across the supported cells, with a documented cell encoding.
Do not silently apply it to cells outside the training region.

Initial features, all available at the observation cutoff:

- Latest recorded daily activity and lags of 1, 7 and 14 days.
- Prior 7-, 14- and 28-day means and variability.
- Recent-week change relative to the preceding week.
- Cell identifier or documented spatial encoding.
- Calendar information for the issue/target period.
- Missingness/history indicators used for explicit exclusion or model inputs.

Do not add present-day realized weather to a historical forecast unless it was
available at the simulated issue date. Archived weather forecasts would be needed
for a faithful future-weather feature; leave weather out of the first build.

The label is the subsequently reported activity total in the target week. This
provides supervised regression targets without legal/illegal labels. Require
adequate feature history and complete target windows.

## 8. Baselines and model

Implement two baselines first:

1. Repeat the most recently observed seven-day activity total.
2. Use an average of recent complete weekly totals per cell.

First trained model: scikit-learn HistGradientBoostingRegressor. It is a practical
CPU-oriented tabular regression choice for lagged activity features, not a proven
winner on your data. It can estimate quantiles directly. No GPU, YOLO or custom
PyTorch DataLoader is required.

Start with three quantile models for 0.1, 0.5 and 0.9. The median is the point
forecast; the outer quantiles form a nominal central 80% interval. Choose modest
tree sizes and training iterations on chronological validation data. Disable an
automatic random validation split, or supply an explicitly chronological validation
mechanism supported by the installed version. Save all feature order and settings.

Quantile estimates may cross and may be inaccurate. Define a tested crossing
policy, keep activity nonnegative, and evaluate the exact postprocessing used by
the API. Suppress an invalid interval rather than showing a contradictory band.
Do not describe the nominal interval as calibrated until held-out coverage has
actually been measured. Time dependence can weaken coverage and generalization.

Do not add an anomaly model merely to increase the number of algorithms. If a
later feature needs historical unusualness, evaluate it as a separate target.

## 9. Honest evaluation

Split by calendar/forecast issue dates, keeping all cells for a date together.
Use earlier dates for training, later validation, and a final untouched test
period. Avoid random row splits and fit preprocessing using training data only.

Weekly labels overlap. Purge boundary examples so no training label uses outcomes
that would be unavailable at the first validation forecast issue. Apply the same
rule to validation-based selection before the test period. The purge depends on
the target horizon and availability lag; a generic seven-row gap is insufficient
when many cells share a date.

Compare on the same valid cell/date examples:

- Mean absolute error in reported vessel-hours.
- Per-cell errors, to expose performance hidden by pooled averages.
- Pinball loss for each predicted quantile.
- Empirical interval coverage and average interval width, by time/cell where feasible.
- Actual target activity in the top K forecast-selected cells versus the baseline's
  selections, using the same K and candidate region. Call this activity capture,
  not illegal-fishing detection accuracy or optimal patrol effectiveness.

Show missing/excluded rows and performance on quiet as well as busy cells.
Do not use percentage error as the main metric when zero observations occur.
If the trained model does not improve on a baseline, keep the baseline operational
and report the ML experiment honestly. Forecasting skill does not prove patrol
utility, ecological benefit or improved enforcement outcomes.

## 10. Suggested modules and commands

These are proposed files/commands, not existing implemented modules:

```text
training/activity_forecast/
  requirements.txt
  collect.py
  features.py
  baseline.py
  train.py
  evaluate.py
  inference.py
  model_card.md
  tests/
```

Dependencies: pandas, numpy, scikit-learn, requests or an already tested GFW
client, and joblib for trusted local bundles. Record the installed environment.
Only load serialized bundles you created or verified from a trusted source.

Suggested future CLI responsibilities:

```text
collect.py --config region.json
features.py --config region.json
train.py --config region.json
evaluate.py --config region.json
```

The configuration should fix geometry, grid, source version, date range, availability
lag, target horizon and split dates. Keep the token outside that config.

Inference should accept supported cell IDs and a declared issue/cutoff date,
then return computed outputs and explicit unscorable cases. An example contract
with no fabricated forecasts:

```json
{
  "cell_id": "supported-cell-id",
  "status": "insufficient_data",
  "last_complete_observation_date": null,
  "forecast_issued_at": null,
  "target_start": null,
  "target_end": null,
  "predicted_apparent_fishing_hours": null,
  "lower_quantile_hours": null,
  "upper_quantile_hours": null,
  "nominal_interval_coverage": 0.8,
  "held_out_interval_coverage": null,
  "baseline_prediction_hours": null,
  "source_dataset_version": null,
  "model_version": null,
  "reason_codes": ["missing_complete_history"]
}
```

The app owner can expose this through an area-forecast endpoint. A scored result
must include actual source/target dates, bounds and provenance. Missing forecasts
should not appear as zero activity on the map.

## 11. Four-person, 12-hour implementation plan

| Hours | You: ML | Other backend member | Frontend 1 | Frontend 2 |
| --- | --- | --- | --- | --- |
| 0-1 | Agree target, features and leakage rules | Verify aggregate report access | Agree request/response types | Sketch forecast/detail states |
| 1-3 | Build lags, targets and baselines | Cache bounded historical collection | Map cells and observed layer | Detail chart and date controls |
| 3-6 | Train small regression/quantile models | Serve validated cached observations | Forecast layer and selection | Interval display and missing-data UI |
| 6-8 | Compare against baselines on held-out dates | Expose inference contract | Integrate endpoint | Historical replay and baseline comparison |
| 8-10 | Check leakage, missingness, intervals and runtime | Verify provenance/error behavior | End-to-end integration | Sources and limitations |
| 10-12 | Freeze artifacts and model card | Freeze API/cache | Rehearse | Rehearse |

This is a target schedule, not a guarantee. Data retrieval and adequate history
are the gating risks. Simplify to a single target week and cached regional demo
before adding habitats, documents, patrol routing or environmental predictors.

## 12. Acceptance criteria and demo claims

- One legitimately obtained, versioned regional dataset.
- Reproducible baseline, model, features, and date-based evaluation.
- Model weights learned from historical input/target pairs.
- Forecast issued using only data permitted by its cutoff/availability assumption.
- Explicit data age, forecast window and historical-replay labeling.
- Measured model-vs-baseline performance; no invented improvement figures.
- Intervals evaluated, not presented as proof of reliable probability coverage.
- Unscorable cases, unseen cells and missing targets handled honestly.
- Frontend distinguishes observed, forecast and authorization information.
- GFW attribution and upstream-model limitations preserved.

Copy-ready positioning: "Our regional forecasting prototype builds on Global
Fishing Watch to estimate future reported apparent-fishing activity, display its
uncertainty, and show whether the model improves on simple historical baselines."

## Sources reviewed

- GFW API overview: https://globalfishingwatch.org/our-apis/
- Vessel API: https://api-doc.globalfishingwatch.org/our-apis/documentation/docs/v3/vessels
- Events API: https://globalfishingwatch.org/our-apis/documentation/docs/v3/events
- Insights API: https://api-doc.globalfishingwatch.org/our-apis/documentation/docs/v3/insights/insights-vessels
- Marine Manager: https://globalfishingwatch.org/marine-manager-portal/
- Marine Manager additions: https://globalfishingwatch.org/platform-update/marine-manager-new-analysis-and-environmental-features/
- Product update log: https://globalfishingwatch.org/platform-and-data-updates/
- Current track/report restriction: https://globalfishingwatch.org/platform-update/changes-to-vessel-track-downloads-and-vessel-level-api-4wings-reports/
- GFW's AI connector: https://github.com/GlobalFishingWatch/gfw-mcp-js
- Reports: https://api-doc.globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/report
- Dataset update: https://globalfishingwatch.org/platform-update/version-5-data-pipeline-release/
- Data caveats: https://api-doc.globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats
- Terms/rate limits: https://api-doc.globalfishingwatch.org/our-apis/documentation/docs/license-rate-limits
- Prior forecasting competition: https://www.nga.mil/news/Grand_fishing_forecast_challenge_winners_announced.html
- Regressor: https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.HistGradientBoostingRegressor.html
- Time-series features/evaluation: https://scikit-learn.org/stable/auto_examples/applications/plot_time_series_lagged_features.html
