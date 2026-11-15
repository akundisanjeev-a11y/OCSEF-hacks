# Rolling historical backtest and one-degree experiment

Completed November 15, 2026. This is a development experiment, not a replacement
for the deployed model or a new independent test. No checkpoint, API route,
frontend, priority engine, ecosystem archive or Git branch was changed.

## Answer

Rolling historical validation is possible and has now been run. It exposes
whether a candidate improves repeatedly, rather than only on one date. It does
not itself improve predictions.

The existing model predicts **seven-day apparent-fishing hours**, not a
24-hour total. This experiment retains that target and the existing seasonal
correction decision-tree design. It fits historical copies of the model using
only labels available before each forecast issue. Loading the final model,
which learned from later dates, to forecast earlier training dates would leak
information.

The one-degree, depth-four candidate achieved the lowest worldwide cell MAE.
However, the five-degree, depth-four candidate won on more dates, had lower
error for the worldwide total, and had better overlap with observed hotspots.
Neither resolution establishes reliable local improvement in the Galápagos.
There is no evidence here for a large, universal gain from finer cells.

## Data and timing

- Source: cached GFW `public-global-fishing-effort:v5.0` daily reports, originally
  exported at 0.1-degree resolution. No new API credentials or downloads were needed.
- Current history: January–June 2025. Annual comparison history: January–July 2024.
- Twelve weekly issue dates: April 5 through June 21, 2025.
- Each issue predicts the following seven days: April 6–12 through June 22–28.
  These target weeks do not overlap.
- Assumed publishing delay: three days. For issue day I, current observations end
  at I minus three days. Training targets must also have finished their publishing
  delay strictly before I. Training expands as time advances.
- Both grid resolutions use the same two feature definitions, correction target,
  absolute-error criterion, minimum leaf size 500 and random seed 42. Depths two
  and four were declared before running this experiment.
- One-degree cells are aggregated from the same source records as five-degree
  cells. Raw archive hashes were checked against collection manifests; reaggregation
  conserves the original five-degree daily totals. The one-degree dataset is a
  different representation, not an independent source or fresh holdout.

## Fair comparison

Every method is evaluated on identical five-degree footprints for each issue.
Twenty-five one-degree forecasts are summed into their parent five-degree cell
before comparing MAE and RMSE. Otherwise, making cells smaller could appear to
improve error just because each cell contains fewer hours.

The common footprint includes five-degree cells with positive activity in the
previous 28 observed days. Entirely quiet coarse areas are excluded from these
headline metrics. Within an included coarse cell, all 25 one-degree subcells
contribute, including quiet ones. A subcell without enough active history uses
the explicit repeat-last-week fallback. Quiet does not establish that no vessels
were present or that AIS coverage was complete.

The Galápagos example is the aligned rectangle west=-95, south=-5, east=-85,
north=5. It covers four coarse cells, not an official reserve boundary or a
precise assessment of protected waters.

## Worldwide results

MAE and RMSE below are pooled across cell-week examples on the common footprint.
Hours are summed across vessels; these are regression errors, not percentages
of correctly detected ships.

| Training grid | Depth cap | MAE, hours | RMSE, hours | MAE reduction versus baseline | Weeks beating baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| Repeat last observed week | — | 811.87 | 8,526.22 | — | — |
| 5 degrees | 2 | 713.60 | 6,719.96 | 12.10% | 8/12 |
| 5 degrees | 4 | 678.75 | 6,114.61 | 16.40% | 11/12 |
| 1 degree | 2 | 691.08 | 5,918.52 | 14.88% | 8/12 |
| 1 degree | 4 | 671.19 | 5,647.36 | 17.33% | 9/12 |

At depth four, one-degree training lowers common-footprint MAE by only about
1.1% relative to five-degree training. It is useful evidence, but not a dramatic
improvement. The 17.33% figure compares with persistence on these development
folds; it is not a new version of the earlier July independent-test result.

## Regional totals, direction and spatial overlap

Directional accuracy compares the sign of predicted versus observed change
relative to the last observed week's total: decrease, flat or increase.
The spatial score is mean recall of the cells with the largest positive
increases, up to the top 10% of the common footprint. Precision and Jaccard
overlap are also recorded in the machine-readable output. Folds with no observed
increase have undefined recall and are omitted from that mean.

| Training grid / depth | Direction correct | Mean hotspot recall | Mean absolute error of worldwide total, hours |
| --- | ---: | ---: | ---: |
| Baseline | Predicts flat by definition | Predicts no increases | 383,624.24 |
| 5 degrees / 2 | 54.9% | 35.3% | 294,618.48 |
| 5 degrees / 4 | 53.1% | 31.0% | 266,072.23 |
| 1 degree / 2 | 55.0% | 20.3% | 385,011.09 |
| 1 degree / 4 | 58.7% | 22.5% | 358,936.53 |

These are different objectives: lower cell error does not guarantee better
regional totals or hotspot placement. Baseline direction/spatial scores are
degenerate because persistence predicts no change; do not use them to claim
strong directional skill. Hotspot overlap on this common grid does not validate
precise one-degree locations, vessel trajectories or individual vessel detection.

## Galápagos example results

| Training grid | Depth cap | MAE, hours | RMSE, hours | MAE reduction versus baseline | Weeks beating baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| Repeat last observed week | — | 92.70 | 122.78 | — | — |
| 5 degrees | 2 | 94.97 | 129.05 | -2.45% | 6/12 |
| 5 degrees | 4 | 92.13 | 125.27 | 0.61% | 7/12 |
| 1 degree | 2 | 94.50 | 128.09 | -1.95% | 7/12 |
| 1 degree | 4 | 93.62 | 126.12 | -0.99% | 7/12 |

Even the slight MAE improvement from five-degree depth four comes with worse
RMSE and worse error for the regional total: 209.57 hours versus the baseline's
154.47 hours. The one-degree depth-four regional-total error is 229.82 hours.
Therefore, do not claim a demonstrated local improvement around the Galápagos.
Four coarse cells also provide very limited spatial evaluation power.

## Files and commands

Run the experiment from the repository root using the existing virtual environment:

```powershell
& .\.venv\Scripts\python.exe -m training.activity_forecast.rolling_backtest
```

Summarize and verify recorded predictions without fitting again:

```powershell
& .\.venv\Scripts\python.exe -m training.activity_forecast.rolling_backtest --summarize-only
```

Outputs under `datasets/activity_forecast/rolling_backtest/` are ignored by Git:

- `summary.json`: pooled MAE/RMSE, fold wins, direction, regional totals and spatial scores.
- `fold_metrics.csv`: all 12 dates, two regions, two grids and two depths (96 rows).
- `daily_2025_1deg.npz` and `daily_2024_1deg.npz`, plus manifest-fingerprint JSON:
  separately prepared one-degree histories.
- `errors_DATE_GRIDdeg_depthDEPTH.csv.gz`: original recorded predictions for cells
  actually scored by that fold's tree.
- `cell_comparisons/native_*.csv.gz`: every native grid cell, including baseline
  fallback cells, with bounds, observations, predictions, errors, `ml_scored` and
  `in_common_footprint`. Zero/fallback entries must not be described as ML detections.
- `cell_comparisons/common_*.csv.gz`: every five-degree comparison cell with errors
  and inclusion flags. Reconstructing these from recorded predictions was checked
  against every fold's reported MAE and RMSE without refitting.

Targeted tests cover grid aggregation, agreement with existing feature creation,
label-availability purging, resistance to future-data changes, metric definitions
and correct pooled RMSE: **six tests passed**.

## What to do next

1. Keep the deployed model unchanged. Treat depth-four five-degree training as a
   promising candidate; compare it with the finer candidate using the actual
   website objective, including local and hotspot errors, before choosing.
2. Freeze the candidate and protocol, then evaluate once on genuinely uninspected
   later dates. The earlier validation/test dates and this report are development
   evidence now; repeated tuning on them cannot establish independent performance.
3. To assess both warm and cold seasons, extend the time coverage. April–June
   issues alone do not span a full seasonal cycle. Repeating overlapping weeks
   or adding more spatial rows would not resolve that limitation.
4. For a true 24-hour forecast, train a separate one-day target with a matching
   one-day persistence/weekly-seasonal baseline and the same availability rules.
   Daily observations already support that experiment. Dividing a weekly output
   by seven does not validate daily forecasting.

These are revised historical GFW measurements, not archived snapshots of exactly
what was published on each issue date. The assumed three-day publication lag is
not a verified availability guarantee. The exercise limits direct temporal
leakage but cannot eliminate revision/availability uncertainty. Apparent fishing
hours do not establish illegal activity, authorization or ecosystem damage.

Reference: [GFW data caveats](https://api-doc.globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats).

Git context: the previous main-branch audit examined `a99d8e9`. During this task
the checkout was `akki-folder` at `1f90094`; it was not switched. The saved model
in the local `main` ref retains SHA256
`a85e3e788c8d5d61d8a738a85e3ca4e274e62e027b11d39ec4c8c622e45cb424`.
The experiment does not load that final checkpoint to make earlier forecasts.
