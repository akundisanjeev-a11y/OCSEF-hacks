# Forecast error audit and fixes

This is an audit of the evaluated predictions and identified pipeline/model
weaknesses. It does not establish every real-world cause of error in AIS-derived
data. No labels were changed and no large errors were removed. Neither the baseline
formula nor the primary error metric was changed to obtain a win.

## Every evaluated error, including the failures

- Original validation and previously viewed test: 49,130 rows in
  `datasets/activity_forecast/audit/all_prediction_errors.csv`.
- Original grouped tables: `errors_by_cell.csv`, `errors_by_issue_date.csv` and
  `largest_100_errors.csv` in the same audit directory.
- Improved validation: all 19,119 predictions and grouped tables in
  `datasets/activity_forecast/audit/improved_validation/`.
- Reserved July test: all 20,487 predictions and grouped tables in
  `datasets/activity_forecast/audit/fresh_test/`.

Each row records actual reported hours, predicted hours, signed error, absolute
error, squared error, baseline error and the extra error relative to baseline.
These are evaluation errors; training fit errors are not presented as evidence
of forecasting skill.

## Findings and plausible remedies

| Finding | Evidence | Change | Status |
| --- | --- | --- | --- |
| A universal 0.9636 multiplier cannot anticipate changing local conditions | Old test MAE 472.10 vs baseline 471.45 | Learned conditional corrections using local seasonal and recent patterns | Implemented |
| A raw three-level tree produces only eight fixed hour values worldwide | Original rules and error spread across very different activity levels | Predict a fractional correction to a continuously varying local baseline | Implemented |
| Annual seasonal context was entirely absent | Original dataset only Jan-Jun 2025 | Downloaded Jan-Jul 2024, same version/grid; use corresponding calendar dates from the previous year | Implemented |
| Recent inputs were smoothed over a week/month | Original three inputs lacked a short-window signal | Add three-day vs seven-day change as a past-only tree input | Implemented |
| A few failures dominate aggregate errors | Worst 1% caused about 92% of old squared error | Report all errors, RMSE, per-cell and per-date results; keep outliers in evaluation | Implemented; large errors remain possible |
| The original test was repeatedly inspected | Conversation and saved experiments | Freeze the model/choice before a reserved July test; record model hash and evaluation registry | Implemented |
| Fitting and model selection need different roles | Training and validation must remain separate | Fit parameters using training labels; select on validation; refit on all labels available before July; evaluate the frozen choice once | Implemented |
| Missing annual data or tiny denominators can create unsafe seasonal estimates | General data-quality failure mode | Fall back to the unchanged last-week estimate when annual history is missing/zero; cap annual growth scaling at a predeclared 5 | Implemented; fallback is disclosed |
| Source/version and date alignment could cause false apparent changes | General data risk; not established as the cause of observed spikes | Same v5 source/grid; raw report hashes, explicit dates, complete daily tables, source checks | Implemented checks; upstream errors cannot be ruled out |
| Five-degree cells are geographically coarse | Current aggregation scheme | Retain the same grid for a fair comparison; document broad-screening limits | Remains a limitation; finer-grid retraining is future work |
| AIS reception, weather, management changes and biological effects are not ground truth here | No independent measurements supplied | Do not infer causes, coverage quality, damage or illegality from prediction errors | Remains a limitation |
| Forecasts are historical and use an assumed publication lag | Downloaded retrospective measurements and three-day lag assumption | Explicit observation, simulated issue and target dates in outputs | Disclosed; not a real-time availability backtest |
| Forecasts after July need an August prior-year reference | The latest observation cutoff is Jul 31, with targets Aug 4-10 | Downloaded Aug 2024 to a separate inference-only directory; source checks and fallback remain active | Implemented; frozen training/test sources unchanged |

## Selected, explainable model

1. Start with the last observed week's hours: the unchanged baseline.
2. Obtain the same target calendar dates in the previous year, using only data
   from well before the current forecast cutoff.
3. Adjust the annual reference for the difference in recent monthly activity.
4. A two-level decision tree (at most four leaves) learns a fractional correction
   from seasonal expected change and the recent three-day trend.
5. Multiply the learned correction by a local activity scale and add it to the
   baseline. Clamp negative hour forecasts to zero.

The tree's splits and leaf corrections are learned. The previous-year reference
is known historical data, not a future observation. Calendar-year alignment can
shift weekdays and has leap-year limitations; it is not a perfect seasonal model.

## Unchanged comparison and measured results

| Evaluation | Model MAE | Baseline MAE | MAE reduction |
| --- | ---: | ---: | ---: |
| Original validation, Apr 27-May 15, 2025 | 936.18 | 1,169.86 | 19.97% |
| Reserved issue dates, Jul 5-Jul 24, 2025 | 418.26 | 448.68 | 6.78% |

On the reserved test, RMSE was 1,821.99 model vs 2,140.83 baseline. About 55.4%
of evaluated cells had lower mean absolute error. Improvement is not uniform.

The primary metric remains MAE in summed reported vessel-hours on every eligible
cell/date. These are not classification accuracy percentages. The July baseline
is different from the old May-June baseline because the evaluation dates differ.
Never compare a new model's July MAE with the old model's May-June MAE as if they
were measured on the same rows.

## Evaluation protocol

- Models were compared on the original chronological validation split only.
- Seasonal correction tree was selected before July outcomes were inspected.
- The selected family was refitted using Jan-Jun labels available before Jul 4.
- July issue dates Jul 5-24 and target windows Jul 6-31 were fixed before evaluation.
- The test used the identical baseline, target, source version, grid, eligibility
  policy and rows for both predictions. No seasonally missing row was discarded
  to improve the model score; the seasonal feature falls back instead.
- Model hash and frozen choices are in `selection_freeze.json`.
- Repeated evaluations return the recorded result. If a different model is later
  evaluated on the same outcomes, the registry labels the period as previously
  viewed. July is no longer fresh for future tuning.

This is one out-of-time retrospective test of model-generated GFW observations.
Weekly outcomes overlap, the dates cover a limited season, and no statistical
guarantee of future improvement is claimed. Unseen later periods, longer history
and independent checks of data-quality events are still needed.
