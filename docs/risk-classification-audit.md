# Extensive risk-classification audit

Completed November 15, 2026. These changes extend the startup/consistency audit
on `fix/startup-and-evidence-consistency`. See Git history for integration into main.

## What is being classified

GhostFleet screens source evidence for four review leads: apparent fishing in
no-take areas, apparent fishing without a matching known RFMO authorization,
qualifying AIS-off events, and RFMO IUU-list records in the requested period.
This is deterministic source-data interpretation, not an ML guilt score.

The shared parser is `backend/services/risk_evidence.py`. Both the compact
screening result and on-demand full report use it. Screening keeps the same
three Insights includes and four-worker concurrency; this audit adds no upstream
request to each screening check.

| Result | Meaning |
| --- | --- |
| Flagged | At least one attributable positive source count or record needs review. Other checks may still be incomplete. |
| No reported flags | All four requested checks supplied usable zero counts. This is not a safety, registration or authorization decision. |
| Unknown | No attributable positive evidence was established and at least one check is missing, invalid, conflicting or unverified. |
| Failed / not checked | A transport/access failure or a check that never started. Neither is a clean result. |

`flag_count` counts warning types, not events, violations or a confidence score.
`missing_count` counts unavailable check totals and may overlap with flagged
status. Source-quality notes explain why exact counts cannot be asserted.
Full GFW reports continue to return authorization **unknown**, including when
all risk counts are zero or public registry information exists.

## Findings and changes

| Gap found | Correction |
| --- | --- |
| Full reports and screening normalized counts differently | One parser supplies both, including a full-report risk summary. |
| Fractions, numeric strings, booleans and unsafe-sized numbers could be misinterpreted | Only finite nonnegative whole-number counts within JavaScript's safe integer range are accepted. |
| Duplicate event IDs inflated counts | Count distinct valid IDs; preserve source data separately. |
| Invalid event-list entries could create flags or clean-looking totals | Invalid entries are never counted; unusable lists cannot clear a check. Valid positive IDs remain reviewable without an exact total. |
| Zero counters could override positive event IDs | Preserve the positive review lead, mark the exact count conflicting/unavailable and show the source issue. |
| A null/invalid counter could fall back to an empty list and become zero | Explicit unusable counters stay unavailable. Absence of the counter is distinguished from invalidity. |
| Conflicting gap/gaps aliases could silently choose an empty field | Reconcile both; inconsistent totals remain unavailable and valid positive evidence is retained. |
| Owner/period metadata was not checked inside Insights evidence | Reject attribution for explicitly different vessel IDs or mismatched supplied dates. |
| Unresolved-identity responses could retain misleading counts | Mark their evidence unverified; no asserted flags or clearance for the requested boat. |
| GFW uses a null optional identity marker on valid responses | Accept null as no reported unresolved IDs; live replay verifies compatibility. |
| Listing intervals and counters could contradict each other | Validate supplied intervals against the report; preserve overlapping positive records without inventing an exact count or current listing. |
| Event-ID fallback counts looked like complete totals | Label positive counts based on supplied IDs as a lower bound: "at least". |
| Flagged boats with incomplete checks could not be retried | Resume includes them; cache lifetime is one minute rather than fifteen. |
| Legacy batch placeholders invented rate-limit errors for unstarted boats | Mark them not checked, without claiming an upstream HTTP status. The stream continues to leave unstarted boats unchecked. |
| Nonstandard numbers or duplicate JSON keys could reach parsing/serialization | Reject those responses at the transport boundary; preserve identity with unavailable risk evidence if Insights fails. |
| An unrelated or malformed event could appear to explain a flag | Require matching event ID, vessel, event type, positive duration and overlapping report dates. |

No event detail is taken as proof of the boat's intent, route, local violation or
the location of every part of its activity. Source event detail remains optional
and limited to three records requested on demand.

## Test coverage

The new classifier audit has **220 parameterized test cases**, covering:

- All 81 positive/zero/missing combinations across four checks, with independently
  specified expected states, counts and missing-information totals.
- Invalid counts, malformed roots and nested objects, source immutability,
  duplicate/invalid IDs, counter/list contradictions and alias conflicts.
- Missing/foreign identities, foreign section owners, wrong periods, equivalent
  time zones, day-only source labels and source null-field compatibility.
- Historical counters and unrelated coverage/port fields never becoming current
  flags; listing overlaps, boundary times and unverifiable dates.
- Provider HTTP 401, 403, 429, 502 and 503; identity preservation, unavailable
  risk results and failure-cache exclusion.
- Actual route-level equality of compact screening and full-report decisions,
  exact dates, counts, warning types, missing checks and unknown authorization.
- Cache boundaries for complete versus partially complete results; unstarted
  legacy entries; invalid JSON never becoming a serialization crash or clearance.

Source-event tests also cover wrong types, zero-duration records and invalid root
shapes. Frontend regressions check consistent integer-count handling, reviewable
contradictions without invented totals, lower-bound wording and retry of flagged
boats with missing checks.

Final verification: **341 backend tests plus 10 subtests**, **57 frontend tests**,
and the production build passed. Existing dependency deprecation notices and
Vite's bundle-size warning remain. No browser visual or frame-rate audit was
performed as part of this classifier review.

## Live validation

A seven-day apparent-fishing query in 120–125E, 25–30N returned **6,349 vessel
identities**. Thirty-two IDs were sampled evenly across the returned list. All
32 screening calls and full reports completed; all returned no reported flags.
Replaying their captured source inputs through the new parser preserved all 32
statuses and every indicator count. Eight sampled IDs were then checked again
through fresh live endpoints; all full-report decisions and indicators matched
screening, and authorization remained unknown.

The source returned calendar-day period labels even though the request specified
UTC hours. They are compared at their actual precision, with this limitation
available in the report. Exact event times require event-level evidence.

The live sample contained **no positive examples**. It does not validate recall,
precision, false-positive/negative rates, or detection accuracy. Positive and
adversarial cases above are synthetic contract tests, clearly separate from the
live sample. No independent labeled incident corpus was available in this audit.

## Interpretation limits and primary references

The source's fishing estimate and geographic boundary match can be wrong. RFMO
authorization coverage is limited and does not supply national licensing
clearance. Offshore-gap coverage is not a census of all missing AIS signals, and
an IUU-list count is not automatically a current listing or a local incident.
These constraints are reflected in the explanations rather than converted into
claims of illegality or overfishing.

- [GFW Insights request and response contract](https://globalfishingwatch.org/our-apis/documentation/docs/v3/insights/insights-vessels)
- [GFW data caveats](https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats)
- [Fishing insight example](https://globalfishingwatch.org/our-apis/documentation/docs/examples/insights/insights-example1)
- [AIS-off insight example](https://globalfishingwatch.org/our-apis/documentation/docs/examples/insights/insights-example2)
- [IUU-list insight example](https://globalfishingwatch.org/our-apis/documentation/docs/examples/insights/insights-example3)
