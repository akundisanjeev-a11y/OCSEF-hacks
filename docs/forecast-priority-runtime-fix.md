# Forecast and marine-priority runtime repair

November 15, 2026, starting at merged commit 85ca707.

## Reproduced failures

- The API process was healthy but the model was unavailable. Loading the saved
  model directly failed with `Forecast history publishing lag differs from the
  checkpoint`: the new depth-four model expects lag four, while this machine's
  older processed history retained lag three.
- The original reload server later stopped responding while files changed. The
  user restarted it in the existing terminal with reload directories restricted
  to backend and training, preserving their private GFW environment.
- The area-priority service could complete real requests, but the local marine
  index and original WCMC ZIPs were absent. The user confirmed only their teammate
  has those sources. The model's historical dates also differed from current
  GFW query dates; this is a valid scoring exclusion, not a zero forecast.
- The assessment response stripped marine reference measurements, so even an
  installed index's counts and years could not reach the frontend. Job caching
  also omitted index revision, hiding newly installed sources until expiry.
- Overview's relative date control could not reach the model's older historical
  week. Absolute UTC dates are now supported, with a Use model dates option that
  reads the actual model target week and its exclusive end. Publishing lag and
  the seven-day window limit still apply; source dates are never shifted silently.

## Repairs

Default forecast startup now restores the bundled release to a cache identified
by its archive SHA-256. Pulling a newer model/history release selects its own
cache rather than using old training history. Existing processed data is not
changed. Explicit custom data settings remain authoritative and fail with
actionable instructions if incompatible. The example environment leaves the
override blank; the setup CLI defaults to the same release cache.

The priority health endpoint separately reports forecast and habitat readiness.
Prepared historical habitat counts and years survive assessment serialization
and appear in a Marine habitat reference disclosure. No geometry is returned and
static layers remain excluded from the numerical score. Missing files, invalid
indexes and forecast-date mismatches are explicit. Installing/replacing the
index changes the cache key. Preparation supports an external ZIP folder and
rejects missing sources before creating an empty index.

## Live verification

After restart, the website's localhost:5173 API proxy returned forecast-ready and
a scored prediction at 27.5 latitude, 122.5 longitude:
386,414.9500615278 apparent fishing vessel-hours for November 5–11, 2025. The model
version was world-seasonal-depth4-lag4-20261115T182002Z, with observations through
October 31, 2025. These are historical model outputs, not current ship counts.

A normal priority job with vessel evidence enabled completed for a small real
GFW rectangle and November 8–9, 2026 dates. It returned a partial supported score
of 0, 70% factor-weight coverage and no reassuring category. The forecast was
excluded for mismatched dates; marine data was explicitly missing. This does
not establish low risk or habitat absence.

An aligned live area query for November 5–12, 2025 (exclusive end) at 120–125E,
25–30N returned 1,695 activity cells and 6,092 vessel IDs. An assessment for the
same complete model square included the forecast-change factor as available,
contributing 0.291325 points. Vessel evidence was explicitly disabled for this
larger validation to avoid thousands of full identity requests; missing factors
remained unknown and the result was partial, not a complete risk verdict.

Marine data installation itself remains pending the teammate's files. The
missing-data path was verified live; prepared-reference rendering and clipping
were tested using synthetic test fixtures, not claimed as real observations.
See priority-engine-step2-extraction.md for exact transfer/setup instructions.

For large fleets, users may explicitly turn off detailed vessel/event checks for
a quicker map-source/forecast assessment. It remains labeled partial, and skipped
warning checks stay unknown. Full checks remain enabled by default.

Final verification: 415 backend tests plus 10 subtests, 65 frontend tests, and
the production build passed. Existing dependency deprecation and bundle-size
warnings remain. No browser visual/performance inspection was performed here.
