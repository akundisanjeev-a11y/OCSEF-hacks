# Historical forecast inference data

`inference_history.zip` contains only the four prepared daily-history blocks and
their source metadata needed by the saved best model. File hashes are recorded
inside the archive. No credentials, raw API responses, or training targets are
included. Keep raw exports and large training artifacts local.

After cloning, run from the repository root:

```powershell
python -m training.activity_forecast.setup_inference
```

This restores `processed/` without replacing different existing local data.
Then start `python -m uvicorn backend.main:app --reload`.

This is a historical demonstration: observations through July 31, 2025, with
forecasts for August 4-10, 2025. It predicts reported apparent fishing hours,
not activity of every vessel type, current activity or illegality.

Source: `public-global-fishing-effort:v5.0`, worldwide, aggregated into five-degree
cells. Development history: Jan-Jun 2025; July 2025 continuation; annual reference:
Jan-Jul 2024 plus August 2024 for inference. Dates/availability assumptions and
limits are retained in metadata and the ML README.

[Powered by Global Fishing Watch](https://globalfishingwatch.org).
Retain attribution and observe the applicable GFW data/API terms.
