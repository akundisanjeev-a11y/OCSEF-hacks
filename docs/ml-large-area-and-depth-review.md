# Large-area and tree-depth review

Reviewed main `a99d8e9` on November 15, 2026. No serving model or inference data
was changed. Priority-engine and ecosystem processing remain on hold.

## What the area update changes

The old selection width/height caps are removed in frontend selection validation
and the backend AreaQuery. Valid increasing rectangles are accepted within world
coordinate bounds. Date-line crossings still require separate rectangles. GFW
reports now use ENTIRE temporal aggregation, retaining the 0.1-degree spatial grid.
Provider timeouts, concurrency limits and the response-size safeguard remain.
An unlimited app selection does not guarantee a whole-world report can complete.

The forecast model itself did not change. ForecastPanel requests the selection
centre's five-degree model cell and, if available, at most eight neighbouring
cells. It does not forecast every square in a large selection. The comparison
arrows indicate higher predicted activity, not vessel travel. This distinction
matters even when the selected rectangle has no application size cap.

## Why the tree is shallow

The earlier requirement was an explainable, small hackathon model. The seasonal
trainer fixes max_depth=2 and min_samples_leaf=500. The fitted serving tree has
four leaves. It learns a correction to a continuously varying local baseline;
it does not issue only four fixed worldwide hour totals. Its two candidate
inputs are seasonal and recent-change fractions. Their limited information
cannot be remedied by increasing depth alone.

## Controlled development-validation experiment

Ran `python -m training.activity_forecast.compare_tree_depths` on the same
chronological training/validation split, the same two features, absolute-error
criterion, normalized correction target, local scale and minimum leaf size 500.
No saved checkpoint was replaced, and no July test outcome was read or scored.

| Depth cap | Fitted leaves | Validation MAE, vessel-hours | Reduction versus the same 1169.86-hour baseline |
| --- | ---: | ---: | ---: |
| 2 | 4 | 936.18 | 19.97% |
| 4 | 15 | 862.27 | 26.29% |
| 6 | 43 | 933.09 | 20.24% |

Depth four's validation MAE is 7.90% below depth two's. Depth six largely loses
that gain. This does not prove why the difference occurs or establish future
performance. These are development candidate results, not a new independent
test and not an upgrade to the deployed checkpoint's reported July performance.
The existing 6.78% July improvement remains the saved model's historical result.

## Fixing spatial resolution and local errors

1. Reaggregate the existing raw 0.1-degree exports into a separate one-degree
   dataset, preserving the current five-degree dataset/checkpoint. The preparer
   already accepts grid-degrees=1. No new imagery is required. Prepare annual
   history and future inference data at the identical new resolution as well.
2. Account for scale: a dense one-degree world table has 25 times as many cells
   as the five-degree table. Start with one degree before pursuing 0.1 degrees,
   which would be 2,500 times as many world cells and much more expensive to
   densify and train. Sparse/chunked processing may be needed.
3. Train and evaluate the one-degree target directly. Interpolating a five-degree
   forecast into smaller squares would create a visual surface without validated
   sub-cell information. Merely drawing a smoother heatmap does not solve this.
4. For full rectangle coverage, enumerate all intersecting model cells and add a
   batched inference route with explicit coverage, dates, cell bounds and missing
   history reporting. The centre-plus-neighbours view is not this route. For very
   large selections, use progressive batches or a cached precomputed layer.
5. Report full-cell forecasts and boundary overlap explicitly. Do not prorate
   hours into a tiny intersecting habitat/EEZ and call them measured or validated
   activity there. Fine-resolution observed data and fine-resolution forecasts
   are different evidence.
6. Check high-error cells, sparse/zero periods and annual-reference failures.
   Experiment with past-only weekly changes, seasonal/calendar signals, and
   defensible geography summaries. Consider shore distance, shelf fraction and
   depth distribution only as tested predictors, not manual coastal weights.
7. Compare moderately deeper trees and, if justified, regularized ensembles on
   chronological validation/walk-forward folds with label-availability gaps.
   Select the candidate before evaluating a genuinely unseen later period.

Keep MAE/RMSE and per-area results. Smaller grid cells have smaller hour totals,
so their raw MAE cannot be compared directly with a five-degree model's MAE.
Use the baseline on identical rows at each resolution, and compare aggregated
predictions over common geographic areas/time windows for a fair cross-grid check.

No model complexity or new feature set guarantees a large baseline improvement.
An ensemble is a candidate to test, not an automatic solution to insufficient
spatial information, upstream data errors or publishing-date mismatch.
