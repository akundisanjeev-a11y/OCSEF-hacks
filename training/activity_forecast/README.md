# Worldwide, explainable activity forecast

The selected model is a **two-level seasonal correction tree**, with at most four
leaves. It starts with the last observed week's activity and learns adjustments
using annual patterns and short-term changes. GFW supplies the upstream apparent
fishing estimates. This model does not detect ships or establish authorization.

## Run it

Run from the project root. The improved model is trained already.
The user-designated best prototype checkpoint is `weights/activity_forecast/best_model.joblib`;
`best_model_metadata.json` preserves its checksum, selection record and test results.
Normal training writes `model.joblib` and leaves this saved best copy in place.

```powershell
# Display the recorded reserved-test result:
.\.venv\Scripts\python.exe -m training.activity_forecast.test_model
# Train/select/refit from development data; no automatic test evaluation:
.\.venv\Scripts\python.exe training/activity_forecast/train.py
# Explicit test evaluation, or return the saved result for an unchanged model:
.\.venv\Scripts\python.exe training/activity_forecast/evaluate.py
```

Training detects the annual history and uses the seasonal version by default.
`--legacy` runs the earlier calibration/raw-tree experiment. Depth/leaf CLI flags
apply to that legacy mode; the seasonal tree is fixed at depth two for clarity.

## Measured results

| Period | Model MAE | Unchanged baseline MAE | Reduction |
| --- | ---: | ---: | ---: |
| Validation: Apr 27-May 15, 2025 | 936.18 | 1169.86 | 19.97% |
| Reserved issue dates: Jul 5-24, 2025 | 418.26 | 448.68 | 6.78% |

July RMSE: 1821.99 model vs 2140.83 baseline. These are errors in summed reported
vessel-hours, not accuracy percentages. Compare model and baseline on the SAME
rows. The old May-June test baseline was 471.45 because its dates differ.

July was reserved before this model was selected, then evaluated once. It is now
viewed data and must not guide new tuning presented as an independent test.
Outcomes overlap across weekly forecasts; one period is not proof of long-term
skill, significance, or improvement in every area. About 55.4% of evaluated July
cells had lower mean absolute error.

## The simple explanation

1. Baseline: sum of the latest seven observed days.
2. Seasonal estimate: the same target calendar dates in the previous year.
3. Scale that seasonal estimate by the current/prior-year 28-day activity ratio.
4. A small tree learns the correction based on seasonal expected change and the
   latest three-day change relative to the last week.
5. Forecast = max(0, baseline + learned fractional correction * local activity scale).

The scale is max(last-week hours, monthly-average hours * 7, 1 hour). The annual
growth ratio is capped at a predeclared five. Missing/zero annual averages fall
back to the baseline feature, without dropping the evaluation row. Calendar-year
matching shifts weekdays and has leap-year limitations. No causal explanation,
calibrated uncertainty interval, ecological damage or illegality is inferred.

## Worldwide data and files

- Development: worldwide Jan-Jun 2025, source `public-global-fishing-effort:v5.0`.
- Annual reference: worldwide Jan-Jul 2024, same source version and grid.
- Inference-only reference: Aug 2024, for the next forecast after July 31.
- Reserved evaluation: worldwide Jul 2025; issues Jul 5-24, targets Jul 6-31.
- Native 0.1-degree pixels are aggregated into 5-degree cells, without a country filter.
- Gaps between historical blocks are never filled with made-up zeros.

Main development files are under `datasets/activity_forecast/processed/`.
Annual daily data is under `processed/seasonal_history/`; July daily data under
`processed/fresh_test/`. The extra August reference is in
`processed/inference_reference/`; it does not alter frozen training/test inputs.
Raw successful reports, hashes and source metadata are
retained. Neither token values nor authorization headers are saved in metadata.

A zero means no activity reported in a completed export, not proof of no vessels
or adequate AIS reception. Missing/failed reports stop preparation. Cells without
usable recent history return insufficient_data. Hours can exceed 24 per cell/day
because they sum across vessels; unique-vessel counts are never summed.

This is a historical-data demonstration, not a live 2026 forecast. Five-degree
cells are broad screening areas, not precise vessel positions or habitat borders.

## Model artifacts and all errors

`weights/activity_forecast/` contains:

- `model.joblib`: trusted local fitted models and metadata.
- `rules.txt`: exact learned rules and arithmetic.
- `selection_freeze.json`: validation choice, dates and frozen model hash.
- `evaluation.json`: development selection results.
- `fresh_test_evaluation.json`: reserved-period result.
- `validation_predictions.csv`: all selected-model validation predictions.

The prior model is retained in `before_seasonal/`. Old `test_predictions.csv`
files are legacy artifacts, not the new July evaluation. Error tables are under
`datasets/activity_forecast/audit/`, including every original, improved-validation
and reserved-test prediction. See [the audit](../../docs/forecast-error-audit.md)
for the identified errors, remedies, results and unresolved limitations.

## Evaluation safeguards

Original training/validation dates are chronological and purged so outcomes are
available before the next split's issues. Annual data is prior-year data. No
future observations enter the short-term features. Model selection uses
validation only. The selected family is refitted on Jan-Jun labels known before
July 4; the first reserved issue is July 5. July target values are not used in
selection or refitting. The primary metric and baseline remain unchanged.

An evaluation registry records which model first viewed July. Repeating an
unchanged model returns the recorded result. Evaluating a different model on
those same targets is explicitly labeled as using previously viewed data.
Only load model bundles created by your team or from another trusted source.

## Inference anywhere with usable data

```powershell
.\.venv\Scripts\python.exe training/activity_forecast/predict.py --lat 27.5 --lon 122.5
```

Coordinates illustrate syntax only. The seasonal CLI combines the downloaded
2025 development and July history, so its latest observation cutoff is July 31.
Outputs include cell bounds, data age/dates, source version, baseline, seasonal
reference, exact tree path, correction and forecast. Missing annual reference is
disclosed. The frontend must preserve the dates and distinguish forecast from
observed activity. No frontend or teammate-owned API adapter was replaced.

Backend use retains the existing `predict_location(lat, lon, bundle, daily)`
interface. Pass the desired complete current history; annual reference is loaded
locally, or can be supplied to `predict_improved_location` explicitly.

The website can now call `POST /api/activity-forecast` and
`GET /api/activity-forecast/info` through the existing FastAPI server. It loads
the saved `best_model.joblib` and local data at startup. See the
[frontend handoff](../../docs/frontend-activity-forecast-guide.md) for the
implemented request/response contract, UI states and map integration.

## Reproduce downloads

Your existing local token is read from `.env` or `backend/.env`; never commit it.
The bare pasted JWT format is supported as well as `GFW_TOKEN=...`.

```powershell
.\.venv\Scripts\python.exe training/activity_forecast/collect.py
.\.venv\Scripts\python.exe training/activity_forecast/collect.py --start 2024-01-01 --end 2024-08-01 --manifest seasonal_history_manifest.json
.\.venv\Scripts\python.exe training/activity_forecast/prepare.py --manifest datasets/activity_forecast/seasonal_history_manifest.json --output datasets/activity_forecast/processed/seasonal_history --daily-only
.\.venv\Scripts\python.exe training/activity_forecast/collect.py --start 2025-07-01 --end 2025-08-01 --manifest fresh_test_manifest.json
.\.venv\Scripts\python.exe training/activity_forecast/prepare.py --manifest datasets/activity_forecast/fresh_test_manifest.json --output datasets/activity_forecast/processed/fresh_test --daily-only
.\.venv\Scripts\python.exe training/activity_forecast/collect.py --start 2024-08-01 --end 2024-09-01 --manifest inference_reference_manifest.json
.\.venv\Scripts\python.exe training/activity_forecast/prepare.py --manifest datasets/activity_forecast/inference_reference_manifest.json --output datasets/activity_forecast/processed/inference_reference --daily-only
```

Requests are sequential; complete archives are cached and checked for matching
world geometry, source version, dates and hash. Avoid other report collectors on
the same account concurrently. Changing source/grid requires preparation and
retraining; it invalidates earlier source comparisons.

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
```

Credit [Powered by Global Fishing Watch](https://globalfishingwatch.org).
Preserve the exports' source documentation and follow current source/API terms.
Official references: [reports](https://api-doc.globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/report),
[decision trees](https://scikit-learn.org/stable/modules/generated/sklearn.tree.DecisionTreeRegressor.html).
