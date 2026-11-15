# Spatial and accuracy audit — November 15, 2026

Inspected GitHub main `4a25dbf5046327932e0cdf481a8086281ddb0dd8` and the actual saved
checkpoint from that commit. The working branch is `akki-folder`; it was not
switched or overwritten. Habitat archives were not extracted or changed, and
priority-engine work has not started.

Checkpoint SHA-256: `a85e3e788c8d5d61d8a738a85e3ca4e274e62e027b11d39ec4c8c622e45cb424`.
No model, labels, training filters or inference weights were changed by this audit.
Detailed measurements are in the local, ignored file
`datasets/activity_forecast/audit/spatial_assessment.json`.

## 1. Zero coordinates and rounded grid values

Scanned all 6,348,674 raw development rows from the six Jan-Jun 2025 archives:

| Check | Rows |
| --- | ---: |
| Nonfinite or out-of-range latitude/longitude | 0 |
| Nonfinite or negative hours | 0 |
| Latitude exactly zero | 3,423 |
| Latitude zero with positive reported activity | 3,423 |
| Longitude exactly zero | 8,835 |
| Integer latitude | 654,160 |
| Both coordinates integers | 67,107 |
| Coordinates on the 0.1-degree lattice | 6,348,674 |

These are gridded activity records, not individual raw GPS fixes. Zero latitude
is the equator, and zero longitude is the prime meridian. Rounded coordinates
are expected in a regular grid. None of these properties by itself proves an
invalid location, grid-centroid contamination or spoofing. Removing them would
discard valid areas, including equatorial fishing. Format/range checks cannot
rule out upstream AIS spoofing or classification errors.

The dense prepared table contains 469,152 cell-days, including 345,422 zero-hour
rows and no repeated cell-days. Completed source exports were densified to a
world grid; zero means no reported activity, not confirmed absence of vessels
or adequate coverage. The existing preparation stops on incomplete exports.
Training includes 27,850 zero future-week targets among 143,588 eligible rows.
Removing these targets would bias training toward positive activity. All-zero
28-day histories are already excluded from training/scoring as insufficient data.

Action: retain valid zero/rounded coordinates and zero outcomes. Spoofing checks
would require original vessel positions, timestamps and corroborating sources;
the aggregated cell/day table cannot establish impossible individual-vessel motion.

## 2. Spatial features and the straight-edged teal layer

The checkpoint is a depth-two DecisionTreeRegressor with four leaves, not a
RandomForestRegressor. Its inputs are:

- seasonal_change_fraction;
- recent_three_day_change_fraction.

Inspection of the fitted tree shows its actual splits use only the seasonal
change input. Latitude, longitude, FAO zone, EEZ, bathymetry, shore distance and
port distance are not tree inputs. Location selects a history series; it is not
passed numerically into the fitted tree. Thus direct FAO-boundary leakage through
those absent model features is unsupported. Spatial leakage/data-quality issues
cannot be ruled out merely by this feature inspection.

On main, `frontend/src/activityMap.ts` renders observed GFW cells, and CaseMap
styles these with a teal/green heatmap and squares. Only observations from the
selected rectangle are requested. The forecast is rendered separately as purple
five-degree polygons in `frontend/src/forecastMap.ts` and CaseMap. These are
explicitly bounded rectangles, not a continuous spatial prediction surface.
Straight boundaries can therefore result from selection clipping, cell geometry
or map styling without being learned model seams.

No screenshot was attached to this request. The exact reported teal seam cannot
be diagnosed visually from the text alone. If it is a selected-area edge or
observed-data cell boundary, retraining the forecast will not remove it. The
provider's coordinate convention should also be verified before changing any
cell-centre/edge rendering offsets.

## 3. Actual accuracy weaknesses

The saved July evaluation contains 20,487 predictions across 1,100 cells:

| Metric | Result |
| --- | ---: |
| Model MAE | 418.26 vessel-hours |
| Repeat-last-week baseline MAE | 448.68 vessel-hours |
| Average error reduction | 6.78% |
| Cells with lower model MAE | 609 (55.4%) |
| Cells with higher model MAE | 423 (38.5%) |
| Tied cells | 68 |
| Zero-outcome weeks with a positive forecast | 2,399 of 4,292 zero-outcome weeks |
| Fraction of squared error from the worst 1% of predictions | 87.0% |

Positive forecasts in zero-outcome weeks need a magnitude audit; this is
regression, so these are not classification false-positive rates. Large local
errors remain despite improved global MAE. The five cells with the largest
extra average error relative to baseline are lat21_lon57, lat23_lon46,
lat25_lon38, lat12_lon26 and lat11_lon55. The JSON report records their errors.

This checkpoint predicts the sum across vessels in an entire five-degree cell.
Near the equator that spans roughly 550 km per side. It cannot locate an
individual ship, determine which coastline within a cell was used, or establish
activity inside an intersecting habitat/EEZ. It must not be interpreted as a
fine-resolution density map. Its current demo forecasts August 4-10, 2025 from
observations through July 31, 2025; it is not a current forecast.

## 4. Shore distance, bathymetry and EEZ features

These are plausible additional predictors, not verified fixes. EEZ distance is
a jurisdictional/geographic measure, not a direct measure of ecological
productivity. Fishing also occurs offshore and on the high seas; forcing every
prediction toward shallow coastal water could introduce a new systematic bias.

For a controlled future experiment, summarize the geography of each complete
cell: water fraction, depth distribution/continental-shelf fraction, distributions
of shore/port distance, and EEZ overlap. A single depth sampled at the grid centre
would misrepresent mixed coastal cells. Use a version-pinned terrain source and
the same feature definitions at training and inference.

Fit any added-feature candidate on training data and select it using chronological
validation. Evaluate once on a genuinely unseen later period, retaining the same
baseline and reporting per-cell, coastal/offshore and large-error results. July
has already been viewed and must not be used to claim a new independent win.
Do not multiply existing predictions by hand-picked coastal weights and present
that as a trained or validated improvement.

## Recommended order

1. Identify the specific visual layer and selected location/date from the reported
   screenshot; separate rendering issues from prediction errors.
2. Keep the model labeled as a historical whole-cell forecast. Make its resolution,
   input cutoff and uncertainty limits visible in any downstream priority score.
3. Inspect the high-error cells and zero-outcome forecast magnitudes against the
   original exports before selecting new predictors or a finer training grid.
4. If finer spatial predictions are required, rebuild a finer-resolution training
   dataset and validate a new candidate. A smoother drawing of a five-degree
   forecast would not create new spatial information.
5. Treat depth/shore predictors as an experiment, not an accuracy guarantee.

References: [GFW gridded-data documentation](https://zenodo.org/records/14982712),
[GFW interpretation caveats](https://api-doc.globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats),
[GFW cell/EEZ caveat](https://globalfishingwatch.org/faqs/fishing-effort-that-crosses-an-eez-was-fishing-activity-inside-the-eez/),
[GEBCO bathymetry](https://www.gebco.net/data-products/gridded-bathymetry-data),
[IOTC high-seas fisheries context](https://iotc.org/sites/default/files/documents/2017/08/EMARIS05a_-_IOTC_CMMs_manual_A_Understanding_IOTC_LD.pdf).
