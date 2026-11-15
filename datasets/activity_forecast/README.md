# Historical forecast inference data

`inference_history.zip` contains only the four prepared daily-history blocks and
their source metadata needed by the saved best model. File hashes are recorded
inside the archive. No credentials, raw API responses, or training targets are
included. Keep raw exports and large training artifacts local.

After cloning, run from the repository root:

```powershell
python -m training.activity_forecast.setup_inference
```

This restores the current release into `inference_cache/<archive-sha256>/`.
FastAPI also restores that versioned bundle automatically when
`ACTIVITY_FORECAST_DATA_DIR` is unset or blank. Existing `processed/` training
history is preserved, so pulling a new checkpoint cannot leave the server using
an older release's publishing lag. An explicit custom history override is still
honored and must match the checkpoint.
Then start `python -m uvicorn backend.main:app --reload --reload-dir backend --reload-dir training`.

This is a historical demonstration: observations through October 31, 2025, with
forecasts for November 5-11, 2025, using the permanent depth-four model and a
four-day publication-lag assumption. It predicts reported apparent fishing hours,
not activity of every vessel type, current activity or illegality.

Source: `public-global-fishing-effort:v5.0`, worldwide, aggregated into five-degree
cells. Inference history: Jan-Jun 2025 plus a July-October continuation; annual reference:
Jan-Jul 2024 plus August-November 2024 for inference. Dates/availability assumptions and
limits are retained in metadata and the ML README.

[Powered by Global Fishing Watch](https://globalfishingwatch.org).
Retain attribution and observe the applicable GFW data/API terms.
