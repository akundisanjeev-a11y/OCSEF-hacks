# Large-area selections

The application no longer caps selection width or height. Both map components
and the backend accept increasing rectangles anywhere within -180..180 longitude
and -90..90 latitude. Date-line crossings still need separate rectangles.
The existing optional land check and upstream response-size safeguards remain.

GFW reports now use `temporal-resolution=ENTIRE`: totals across exactly the
requested window, with unchanged 0.1-degree spatial resolution. This reduces
repeated hourly rows without sampling away boats or activity. Boat identities
remain associated with the whole area, not assigned to individual heatmap cells.

## Checks on November 15, 2026

Live backend requests using the configured private token, 24-hour windows ending
100 hours before the request:

| Region | Layer | Activity cells | Vessel IDs | Time |
| --- | --- | ---: | ---: | ---: |
| 50W..30E, 20S..40N | AIS presence | 46,447 | 15,732 | 18.32 s |
| 80E..165E, 5S..60N | Apparent fishing | 8,572 | 19,722 | 10.79 s |

The real Atlantic response passed through the frontend heatmap feature generator:
46,447 points and zoomed squares, preserving all 302,202 activity hours. Feature
generation took approximately 85 ms in local Node; this is not a browser GPU or
frame-rate benchmark. Sixteen sampled vessel risk checks completed without API
errors, and two full reports matched the area report's exact dates. These are
sample checks, not a screening of every returned vessel or proof of accuracy.

The East Asian selection's center and eight neighbors produced nine actual model
forecasts and seven comparison arrows. The forecasts retain their historical
demo period, August 4–10, 2025. They do not forecast every square in the selected
rectangle. The Atlantic selection's center returned insufficient history, which
is displayed honestly rather than replaced with an invented prediction.

Regression coverage includes whole-world input acceptance, a large mouse drag,
40,000 heatmap cells, 6,000 unique vessel records, preserved activity totals,
and model-square coverage after a large selection. Backend: 116 passing tests
plus 10 subtests. Frontend: 47 passing tests; production build passes.

No application size cap does not guarantee that an arbitrary worldwide report
will complete: GFW still enforces concurrency, access and timeout limits, and
the client still protects against oversized responses. Partial or failed reports
are errors, never silently shown as a complete empty result. Worldwide live
report completion and browser rendering/frame rate have not been verified here.
