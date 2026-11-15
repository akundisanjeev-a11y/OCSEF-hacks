# Five-degree depth-four model: permanent checkpoint and evaluation

Completed November 15, 2026. The requested candidate was trained and saved once,
then validated on newly collected August 2025 observations and tested once on
newly collected September–October 2025 observations.

**Current decision: permanently use the depth-four checkpoint.** At the user's
later instruction, the two frozen checkpoints were compared on identical inputs
and dates. Depth four reduced test MAE by 4.07% versus the previous model and won
5/7 weeks; validation MAE was 1.70% lower and won 4/4 weeks. It is now saved as
`weights/activity_forecast/best_model.joblib` and `model.joblib`, with matching
metadata/rules and configured inference history. Previous files are archived.
See [the step-one audit](priority-engine-step1-audit.md#permanent-ml-checkpoint-update)
for the direct comparison and release details.

**Original baseline-gate decision, preserved for transparency:** the candidate
did not pass the release rule declared before collecting either holdout.
Its overall August validation MAE was worse than persistence. Its independent
test MAE was better by only 1.02%, with four wins out of seven weeks. This does
not establish the strong, consistent improvement suggested by the earlier
development backtest.

## Saved model

- File: `weights/activity_forecast/depth4_release/model.joblib`.
- Version: `world-seasonal-depth4-lag4-20261115T182002Z`.
- SHA256: `f81b6b381ca2af552be68bc2b2005ee076e3c8a201ad967f53ae9488bdb39d23`.
- DecisionTreeRegressor, five-degree cells, depth four, 16 fitted leaves,
  minimum leaf size 500, absolute-error criterion, seed 42.
- Same seasonal-change and recent-three-day-change features as the earlier
  seasonal model. The tree learns a correction to the last observed week's total.
- Training: 170,354 rows from the existing January–July 2025 history. Only labels
  available before August 1 were included; the last label availability date is
  July 31. Previously viewed July data is training/development data now.
- Frozen at `2026-11-15T18:20:02.958919+00:00`, before the new outcome archives were
  downloaded. No weights or hyperparameters were changed after either report.

This follow-up uses a **four-day publishing delay**, rather than the earlier
three-day assumption, because GFW describes activity availability as roughly
96 hours behind the present. See [GFW key concepts](https://api-doc.globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/key-concepts).
This is still an assumed historical delay, not a verified replay of publication
timestamps. The frozen model, expanded training history and lag differ from
the earlier expanding-window development exercise; the two reports are not a
controlled estimate of the effect of depth alone.

## Validation and independent test

Targets are seven-day apparent-fishing vessel-hours. The baseline repeats the
last seven observed days at each issue, using the same available information.
Metrics include five-degree cells with positive trailing 28-day reported activity,
matching the model's scorable-history rule. Quiet cells are not interpreted as
confirmed absence of vessels.

| Period | Examples | Cells | Model MAE | Baseline MAE | MAE reduction | Weekly wins |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| August validation | 4,131 | 1,107 | 1,061.09 h | 1,050.38 h | **-1.02%** | 3/4 |
| September–October test | 7,217 | 1,156 | 1,296.76 h | 1,310.16 h | **1.02%** | 4/7 |

| Period | Model RMSE | Baseline RMSE | Direction correct | Mean top-decile hotspot recall |
| --- | ---: | ---: | ---: | ---: |
| August validation | 12,532.92 h | 12,491.17 h | 58.2% | 36.8% |
| September–October test | 14,425.65 h | 14,840.35 h | 58.9% | 33.8% |

Directional correctness compares decrease/flat/increase relative to persistence.
Hotspot recall measures overlap with the strongest positive increases on the
five-degree grid; it is not precise vessel-location or ship-detection accuracy.
The baseline predicts no change, so its directional/hotspot scores are degenerate.

The test's mean absolute error for the summed worldwide total was **633,335.68
hours**, versus **584,292.58 hours** for persistence. Thus, the small cell-level
MAE improvement also does not establish a better prediction of the area's summed
total. No Galápagos-specific or arbitrary-rectangle improvement is established
by these worldwide numbers.

### Weekly test detail

| Issue date | Target dates | Model MAE | Baseline MAE | Lower error? |
| --- | --- | ---: | ---: | --- |
| 2025-09-06 | Sep 7–13 | 1,068.50 | 1,130.84 | Yes |
| 2025-09-13 | Sep 14–20 | 1,585.59 | 1,065.03 | No |
| 2025-09-20 | Sep 21–27 | 1,363.06 | 1,439.48 | Yes |
| 2025-09-27 | Sep 28–Oct 4 | 1,394.18 | 1,238.84 | No |
| 2025-10-04 | Oct 5–11 | 939.45 | 972.18 | Yes |
| 2025-10-11 | Oct 12–18 | 1,120.74 | 944.81 | No |
| 2025-10-18 | Oct 19–25 | 1,613.15 | 2,405.44 | Yes |

The forecast target weeks do not overlap. Validation targets end August 31;
test targets begin September 7. The last validation target would finish its
assumed four-day publication delay before the first test issue. Validation did
not trigger any refit, new feature, depth change or candidate selection.

## Original release rule and subsequent permanent replacement

Before downloading the holdouts, the protocol required lower aggregate MAE and
a strict majority of weekly wins in **both** validation and test. The candidate
passed the test condition but failed the validation condition. The release
command therefore retained the existing checkpoint, and no forecast environment
setting was changed at that stage.

The user subsequently requested permanent replacement if better than the previous
saved model. A separate paired comparison found:

| Period | Previous model MAE | Depth-four MAE | Reduction versus previous |
| --- | ---: | ---: | ---: |
| August validation | 1,079.43 h | 1,061.09 h | 1.70% |
| September-October test | 1,351.82 h | 1,296.76 h | 4.07% |

Both models received identical four-day-available inputs and targets; the older
weights had originally been trained with a three-day target gap. This later
checkpoint comparison uses already-viewed outcomes and is not a new independent
test or a causal estimate of depth alone. No retraining or tuning occurred.
Under the user's updated instruction, the depth-four checkpoint is now permanent.
The original failed baseline decision remains in `baseline_release_decision.json`;
`release_decision.json` records the newer policy without claiming the baseline
validation gate passed.

The previous checkpoint, SHA256
`a85e3e788c8d5d61d8a738a85e3ca4e274e62e027b11d39ec4c8c622e45cb424`,
is archived under
`weights/activity_forecast/archive/world-seasonal-depth4-lag4-20261115T182002Z/`.
No commit, push, branch switch, frontend edit or ecosystem processing was performed.

## Inspect the saved result

From the repository root, this returns the recorded candidate result without
evaluating or selecting again:

```powershell
& .\.venv\Scripts\python.exe -m training.activity_forecast.evaluate --output weights/activity_forecast/depth4_release
```

Evidence under `weights/activity_forecast/depth4_release/`:

- `selection_freeze.json`: settings, dates, source hashes, model hash and release rule.
- `rules.txt`: the learned decision-tree rules.
- `validation_evaluation.json` and `test_evaluation.json`: metrics, weekly detail,
  timestamps and source hashes.
- `validation_fold_metrics.csv` and `test_fold_metrics.csv`.
- `baseline_release_decision.json`: original failed baseline-gate decision.
- `paired_comparison.json`: direct comparison with the previous model.
- `release_decision.json`: later permanent-release decision under the user's instruction.

Data under `datasets/activity_forecast/releases/depth4/` includes separate
validation/test histories, earlier-year references, an evaluation identity
registry, and error CSVs for every scored cell/date. These large data files and
model weights are ignored by the current branch's Git rules.

Tests cover configurable depth, pre-issue label availability, freezing without
holdout files, source checksum changes, validation-before-test ordering, reuse of
recorded results, scoring without refitting, the existing evaluation entry point,
and protection of the existing checkpoint when the default release rule fails,
plus permanent replacement under the explicitly requested previous-model policy.
The complete current Python test suite passed: **93 tests**. A separate check
loaded the actual saved candidate and new history through the forecast API,
returned a scored response, and followed a four-step decision path. Its latest
available historical-demo forecast covers November 5–11, 2025; this is not a live
2026 forecast. A later check also verified the permanent model through default
local API settings and the latest-main forecast service.

## Interpretation

The result is a permanent, explainable depth-four checkpoint with modest and
inconsistent improvement on genuinely new development/test periods. A larger
tree alone did not reproduce the earlier development gains. Any further model
changes must treat August–October outcomes as already viewed; another independent
assessment would require a newly reserved period. These data are revised GFW
measurements, not archived as-published snapshots, and seven test weeks do not
establish a full annual seasonal cycle or guaranteed future performance.
