# Risk screening: Investigations workflow and performance

Select an area in Overview, choose **Investigate selected boats**, and run
**Screen vessel risks** in Investigations. Screening is not offered in Overview.
All boats in the selected area are included; the list is paginated for rendering,
but screening processes the complete selection rather than just the visible page.

## What is actually checked

One GFW Insights request is made per uncached boat for the exact selected dates.
It requests only `FISHING`, `GAP`, and `VESSEL-IDENTITY-IUU-VESSEL-LIST`.
It does not download a full identity report or separately fetch each event.

| Check | GFW field used | Interpretation |
| --- | --- | --- |
| Possible fishing in no-take protected areas | `apparentFishing.periodSelectedCounters.eventsInNoTakeMPAs`; distinct valid `eventsInNoTakeMpas` IDs if that counter is absent | Positive evidence is a review lead, not a violation finding. |
| Possible fishing without a known regional permit | `apparentFishing.periodSelectedCounters.eventsInRFMOWithoutKnownAuthorization`; distinct valid `eventsInRfmoWithoutKnownAuthorization` IDs if that counter is absent | Missing public permits are not proof that permission does not exist. |
| Radio-signal gaps | Distinct valid IDs in `gap.aisOff` or `gaps.aisOff` | Qualifying offshore gaps, not all missing signals or proof of intentional disabling. |
| Illegal-fishing list records | `vesselIdentity.iuuVesselList.totalTimesListedInThePeriod` | Counts records relevant to the selected period, not a finding made by GhostFleet. |

A positive known count or attributable positive source record produces **flagged**.
Contradictory records stay reviewable with an unavailable exact count; they do
not become invented totals. **No reported flags** requires all four counts to be
known and zero. Missing, invalid, conflicting and unverified counts remain
unavailable. A nonempty GFW `vesselIdsWithoutIdentity` response makes the status
unknown and prevents attribution; its observed optional `null` value does not
invalidate otherwise valid evidence. Failed requests are
shown separately, and boats not started after a provider pause remain unchecked.
These rules do not determine legal authorization or measure ecological damage.
There is no labeled evaluation dataset establishing a detection accuracy or
false-negative rate; transport tests establish equivalent outputs, not real-world
truth. Boolean, negative, fractional, numeric-string, unsafe-size and non-finite
counts are treated as unavailable. Both full reports and screening use
`backend/services/risk_evidence.py`. See the [extensive classifier audit](risk-classification-audit.md).

Event-ID arrays are de-duplicated and validated. A count derived from supplied
positive event IDs is shown as **at least** that number, not an asserted complete
total. Explicit invalid/null counters do not turn into zero because an event
array is empty. Counters smaller than their distinct event lists, conflicting
gap aliases, and zero counters with malformed supporting records cannot be clean.
Supplied owner IDs and period labels are checked against the request. GFW's live
period labels have calendar-day precision, which cannot independently verify
hour-level cutoffs; source event timestamps are needed for finer claims.

## Options considered and changes implemented

| Option | Decision |
| --- | --- |
| Reuse upstream HTTP connections | Implemented with one app-lifetime HTTP client, persistent connections and a four-request global semaphore. Avoids creating a new TLS connection/client for every boat. |
| Fill the next worker slot immediately | Implemented with a rolling four-worker queue. A slow boat no longer blocks the next sixteen-boat batch. |
| Display results as they finish | Implemented through `POST /historical/risks/stream` using newline-delimited JSON. One browser request handles up to 5,000 boats, with heartbeats while waiting. Larger selections continue in bounded chunks. |
| Reuse exact boat/date results | Implemented: complete known results live for 15 minutes; unknown and partially complete flagged results live for one minute, with a 5,000-entry bound. Failed calls are not cached. Simultaneous identical calls share one in-flight request. |
| Send only screening data to the browser | Implemented. Counts are kept; event-ID arrays are omitted from screening responses. Full reports still retrieve the original evidence on demand. |
| Avoid reloading an opened full report | Implemented for the same boat and exact dates within the browser session. |
| Increase concurrency aggressively | Not implemented. Keeping four upstream checks avoids increasing provider pressure. A future increase should be measured against provider latency and rate-limit errors. |
| Put multiple boats into one Insights request | Not assumed safe: the documented response contains shared summaries rather than a guaranteed result map keyed by every requested boat. Combining boats without explicit attribution could assign one boat's flags to another. |
| Drop checks, skip cargo boats, shorten the period, or label missing results clean | Not implemented; each would change the meaning or coverage of screening. |

The older `/historical/risks` endpoint remains compatible with 16-boat clients.
The new stream returns start, result, heartbeat, and completion records. The
browser checks vessel IDs and completion counts and rejects interrupted or
incomplete streams instead of silently treating them as finished.

## Stop, resume and navigation

Screening belongs to the shared workspace and continues while changing tabs.
Stop cancels the stream and prevents additional boats from being scheduled;
up to four requests already sent may finish and warm the server cache. Completed
results are retained. Resume/retry skips completed known results and checks only
unchecked, failed or incomplete boats. Changing/clearing the area cancels the old
run and prevents its late results from entering the new selection.

GFW access/rate/configuration errors pause scheduling immediately. Three consecutive
upstream availability failures also pause it. This does not create fabricated
results for the remaining boats. Full reports are independent of screening, so
users can inspect a completed result while other boats are still checked.

## Small live comparison

Measured on the same 12 boat IDs and exact date range during development:

| Measurement | Observed time |
| --- | --- |
| Previous batch implementation, local cache cold | 2.90 seconds |
| New streaming implementation, local cache cold | 2.44 seconds |
| First streamed result | 0.79 seconds |
| Repeated run, all 12 results cached | 0.05 seconds |

All 12 statuses and all four indicator counts matched the baseline. This is one
small live comparison, not a controlled benchmark; upstream cache/network
conditions can differ. It does not guarantee a 16% improvement for every area.
Large cold selections still require one Insights request per boat and can take
minutes. Streaming improves responsiveness as well as scheduling efficiency.

Validation covers bounded concurrency, slow-neighbor scheduling, request sharing,
exact-period cache isolation, provider pauses, compact response equivalence,
stream parsing, incomplete connections, navigation, Stop/resume and stale results.

References: [GFW Insights](https://globalfishingwatch.org/our-apis/documentation/docs/v3/insights)
and [Insights request/response contract](https://globalfishingwatch.org/our-apis/documentation/docs/v3/insights/insights-vessels).
