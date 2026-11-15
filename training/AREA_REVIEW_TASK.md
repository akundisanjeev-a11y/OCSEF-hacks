# Teammate task: unusual-area review model

## Goal and ownership

Build an explainable model that ranks historical ocean areas by how unusual their
observed activity is compared with earlier activity. The app will use this to
help a human choose where to investigate. This replaces our planned imagery
detector as the team's own ML contribution.

Work on a separate branch and primarily inside `training/area_review/`. Do not
edit `frontend/`, `backend/main.py`, or the globe API adapter without coordinating
with the app owner. The app owner will wire up the finished inference interface.

This model does not identify vessels, establish deliberate AIS shutdown, predict
illegal fishing, or determine authorization. Those are separate evidence tasks.
GFW's apparent-fishing inference is upstream ML and must be credited as such.

## Step 1 — collect a bounded dataset

Choose one small region with usable GFW AIS presence and apparent fishing data.
Collect approximately 60–90 days, subject to quota and data availability, in
sequential time chunks. Check dataset permissions before downloading at scale.
GFW allows one report concurrently per user; cache completed reports and resume
downloads. Use your own server-side token; never commit it or request a teammate's.

Use 4Wings reports at DAILY temporal resolution and consistent spatial resolution.
Group presence by the supported vessel-class grouping where available. Aggregate
the returned activity cells into a fixed 1-degree analysis grid. Preserve raw
responses privately alongside source dataset/version, query geometry, time window,
retrieval time, report status and units. Use UTC dates and stable area IDs.

Each example is one analysis cell and UTC day. Begin with these features:

| Feature | Definition |
| --- | --- |
| presence_hours | Sum of reported AIS presence hours in the cell/day |
| apparent_fishing_hours | Sum of reported apparent fishing hours in the cell/day |
| cargo_presence_share | Cargo presence hours / total presence hours, when available |
| carrier_presence_share | Carrier presence hours / total presence hours, when available |
| apparent_fishing_share | Apparent fishing hours / presence hours, if comparable and denominator positive |
| history deviations | Differences from that cell's prior-period baseline, using past data only |

Do not sum per-cell/per-class unique-vessel counts and call the result a unique
area vessel count: the same vessel can appear in multiple groups or cells. Do not
include speed, track turns or vessel-level AIS gaps unless an actual source of
those features is separately obtained and agreed with the app owner.

A failed/missing report is missing, not zero activity. A successful empty report
means no reported activity, not proof of reception coverage or no boats. Record
data availability separately; do not invent an AIS coverage metric from it.
Exclude insufficient-history/unsupported rows from scoring and report why.

## Step 2 — baseline first, then ML

Implement a simple baseline-change ranking using prior cell medians and robust
spread. Then train an Isolation Forest on the same valid feature set. Apply any
imputation, normalization and feature engineering using training-period data only.
Save feature order, units, dataset versions, model configuration and random seed.

Use chronological splits: earliest approximately 60% for training, next 20% for
validation, latest 20% for final evaluation. No random row split across dates.
Choose thresholds on validation data only. With limited seasonal history, clearly
state that holidays, seasonality, weather or coverage changes can look unusual.

Compute an unusualness score and, if useful, a percentile against a saved reference
distribution. Neither is a probability of illegal activity. Explain results with
actual feature deviations, not fabricated causal explanations or a claim that
baseline deviation is a formal feature attribution for Isolation Forest.

## Step 3 — evaluate whether it helps

- Compare ML ranking with the simple baseline on exactly the same held-out dates.
- Have reviewers inspect a fixed top-K list from each ranking without seeing the
  method name. Define 'worth investigating' before review; record agreement and
  reviewer reasons. If no independent labels/reviewers exist, state that limitation.
- Report ranked-list relevance only if actual human labels were obtained. Do not
  claim precision/recall for illegal fishing from unlabeled anomaly data.
- Test missing data, constant activity and synthetic injected spikes separately.
  These are robustness checks, not real-world accuracy evidence.
- Report rows/areas excluded due to missing data or insufficient history, runtime,
  model size and major false-positive patterns. Retain the baseline if ML adds no
  demonstrable benefit.

## Step 4 — deliver an inference contract

Provide a Python function `rank_areas(rows, model_bundle)` accepting validated
feature rows and returning results in a documented JSON-compatible format:

```json
{
  "area_id": "region-a:cell-12",
  "bounds": {"west": -30, "south": 30, "east": -29, "north": 31},
  "period_start": "2026-01-01T00:00:00Z",
  "period_end": "2026-01-02T00:00:00Z",
  "status": "scored",
  "unusualness_percentile": 97.0,
  "baseline_changes": [
    {"feature": "apparent_fishing_hours", "observed": 12.0, "baseline": 3.0, "unit": "hours"}
  ],
  "model_version": "area-review-v1",
  "data_quality_notes": [],
  "interpretation": "Unusual historical activity for review; not an illegality determination."
}
```

Numbers and coordinates above illustrate the contract only; they are not real
model outputs or a recommended investigation location. For unscorable rows return
`status: "insufficient_data"`, a null percentile and a specific reason.
Model training must end before the date being scored; reject data from before or
within the training period in a held-out demo. Define the exact percentile
direction and saved reference distribution so higher always means more unusual.

Deliver these files under `training/area_review/`:

- `README.md`: setup, exact collection/train/evaluate commands, feature contract.
- `requirements.txt`: isolated training dependencies and tested Python version.
- `collect.py`: bounded, resumable GFW download with provenance and secret handling.
- `features.py`, `train.py`, `evaluate.py`, `inference.py`.
- `tests/`: temporal leakage, feature order, missingness and deterministic inference.
- `model_card.md`: data origin, train/test periods, baseline comparison, limitations.
- Small sanitized example inputs/results with real and synthetic examples labeled.
- Trusted model bundle and metadata, with hashes and loading instructions. Large
  data/model artifacts should be shared through an agreed artifact location, not
  committed blindly. Never load a pickle/joblib bundle from an untrusted source.

## Demo and acceptance criteria

The app owner will add a **Find unusual areas** action and an unusualness layer.
Clicking a ranked area will show its measured baseline changes, date window and
data-quality notes, followed by the existing vessel/evidence investigation flow.

Done means reproducible collection/training, an honest held-out evaluation, a
baseline comparison, explicit unscorable cases, a working inference function, and
at least one vetted historical example. Do not commit unrelated app changes or
replace the authorization decision with an anomaly score.

References:

- https://globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/report
- https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats
- https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html
