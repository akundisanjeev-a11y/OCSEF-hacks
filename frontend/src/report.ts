import type { AuthorizationStatus, Case, IdentityStatus, ReviewLevel } from "./api/types";
import {
  activityLabel,
  authorizationLabel,
  dataModeLabel,
  formatPosition,
  formatTime,
  identityLabel,
  reviewLabel,
  vesselTypeLabel,
} from "./format";
import { priorityRank } from "./useCases";
import { formatProximity, nearestZone, zoneNames } from "./zones";

// A vessel counts as "nearby" a fishing zone when it is inside the zone or within this many kilometres of it.
export const NEAR_KM = 25;

// The warning printed on every report: these are leads for a human to check, not accusations.
export const DISCLAIMER =
  "These are investigation leads for human review, not findings of illegal activity. Vessel presence alone does not establish fishing, and an unmatched AIS observation is not proof of illegal fishing. Fishing zones are illustrative placeholders.";

// Turns a code like "missing_permit_evidence" into plain words: "missing permit evidence".
export const humanize = (code: string) => code.replace(/_/g, " ");

// Counts for one fishing zone in the report: vessels inside it, vessels nearby, and how many of those
// were unmatched or high priority.
export interface ZoneSummary {
  zone: string;
  inside: number;
  near: number;
  unmatched: number;
  highPriority: number;
}

// Everything the Coastal impact page shows, worked out from the list of cases in one pass.
export interface ImpactSummary {
  total: number;
  // How many cases fall in each AIS match, permit-decision and review-priority group.
  identity: Record<IdentityStatus, number>;
  authorization: Record<AuthorizationStatus, number>;
  review: Record<ReviewLevel | "none", number>;
  // Per-zone counts, plus vessels farther than NEAR_KM from every zone and vessels with no position.
  zones: ZoneSummary[];
  outsideZones: number;
  unlocated: number;
  // Which kinds of missing evidence come up most often, with how many cases each affects.
  missingEvidence: { code: string; count: number }[];
  // The cases a person should look at, most urgent first.
  queue: Case[];
}

// Counts and groups the cases for the Coastal impact report. This is plain counting over data the backend
// already returned: no scores or decisions are made here.
export function summarize(cases: Case[]): ImpactSummary {
  // Start with every counter at zero, and one row per fishing zone.
  const s: ImpactSummary = {
    total: cases.length,
    identity: { matched: 0, ambiguous: 0, unmatched: 0, insufficient_data: 0 },
    authorization: { authorized: 0, potential_violation: 0, unknown: 0 },
    review: { high: 0, review: 0, routine: 0, none: 0 },
    zones: zoneNames.map((zone) => ({ zone, inside: 0, near: 0, unmatched: 0, highPriority: 0 })),
    outsideZones: 0,
    unlocated: 0,
    missingEvidence: [],
    queue: [],
  };
  // Tally of each missing-evidence reason code seen across all cases.
  const codes = new Map<string, number>();

  // Visit every case once and add it to each counter it belongs to.
  for (const c of cases) {
    const o = c.observation;
    s.identity[o.identity_status]++;
    s.authorization[c.authorization.status]++;
    s.review[c.review_priority?.level ?? "none"]++;

    // Reason codes that start with "missing_" or "unresolved_" mean evidence the backend lacked.
    for (const code of c.authorization.reason_codes) {
      if (/^(missing|unresolved)_/.test(code)) codes.set(code, (codes.get(code) ?? 0) + 1);
    }

    // Find the closest fishing zone. No position means it cannot be placed; beyond NEAR_KM counts as "outside".
    // Otherwise add it to that zone's row as inside or nearby.
    const z = nearestZone(o.position);
    if (!z) s.unlocated++;
    else if (z.km > NEAR_KM) s.outsideZones++;
    else {
      const row = s.zones.find((r) => r.zone === z.zone)!;
      if (z.inside) row.inside++;
      else row.near++;
      if (o.identity_status === "unmatched") row.unmatched++;
      if (c.review_priority?.level === "high") row.highPriority++;
    }
  }

  // Turn the tally into a list, most common missing evidence first.
  s.missingEvidence = [...codes].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
  // The review queue: everything not routine, ordered by urgency, then by detection score within the same urgency.
  s.queue = cases
    .filter((c) => c.review_priority && c.review_priority.level !== "routine")
    .sort((a, b) => priorityRank(a) - priorityRank(b) || b.observation.detection_confidence - a.observation.detection_confidence);
  return s;
}

// Formats a list as Markdown bullet points, or a single "None" bullet when the list is empty.
const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- None");

// Builds the downloadable Markdown report for one case, from the same data shown in the case panel.
export function caseReport(c: Case): string {
  // Shortcuts to the parts of the case used in the report text below.
  const o = c.observation;
  // The permit decision.
  const a = c.authorization;
  // The vessel assessment (may be missing).
  const v = c.vessel_assessment;
  // The AIS match evidence (may be missing).
  const m = o.match_evidence;
  return `# GhostFleet case report: ${o.observation_id}

Record type: ${dataModeLabel[o.data_mode]}
Generated: ${formatTime(new Date().toISOString())}

> ${DISCLAIMER}

## Authorization: ${authorizationLabel[a.status]}

${a.explanation}

Reason codes:
${list(a.reason_codes)}

Evidence:
${list(a.sources)}

## Review priority: ${c.review_priority ? reviewLabel[c.review_priority.level] : "Not set"}

${c.review_priority?.explanation ?? ""}

## Alerts

${list(c.alerts.map((al) => `[${al.severity}] ${al.code}: ${al.message}`))}

## Radar observation

- Scene: ${o.scene_id}
- Captured: ${formatTime(o.captured_at)}
- Location: ${formatPosition(o.position)}
- Detection score: ${o.detection_confidence.toFixed(2)}
- Fishing zone (illustrative): ${formatProximity(nearestZone(o.position))}
- Sources: ${o.sources.join("; ") || "None"}

## AIS identity

- Match status: ${identityLabel[o.identity_status]}
- MMSI: ${o.mmsi ?? "None"}
- IMO: ${o.imo ?? "None"}
${m ? `- Distance to matched track: ${m.candidate_distance_m} m\n- AIS time gap: ${m.time_gap_seconds} s\n- Method: ${m.matching_method}` : "- Match evidence: None"}

## Vessel assessment

${
  v
    ? `- Vessel type: ${vesselTypeLabel[v.vessel_type]}\n- Activity: ${activityLabel[v.activity]}\n- Zone: ${v.zone_id ?? "Not resolved"}\n\n${v.explanation}`
    : "Not available."
}
`;
}

// Builds the downloadable Markdown version of the whole Coastal impact page from its summary.
export function impactReport(s: ImpactSummary, sourceLabel: string): string {
  return `# GhostFleet coastal impact report

Data source: ${sourceLabel}
Generated: ${formatTime(new Date().toISOString())}

> ${DISCLAIMER}

## Detections

- Total radar detections: ${s.total}
- AIS matched: ${s.identity.matched}
- Unmatched (adequate AIS coverage, no matching track): ${s.identity.unmatched}
- Ambiguous identity: ${s.identity.ambiguous}
- Insufficient data: ${s.identity.insufficient_data}

## Authorization

- Authorized: ${s.authorization.authorized}
- Potential violation: ${s.authorization.potential_violation}
- Unknown: ${s.authorization.unknown}

## Review priority

- High: ${s.review.high}
- Review: ${s.review.review}
- Routine: ${s.review.routine}
- Not set: ${s.review.none}

## Activity by illustrative fishing zone (inside or within ${NEAR_KM} km)

${s.zones.map((z) => `- ${z.zone}: ${z.inside} inside, ${z.near} nearby, ${z.unmatched} unmatched, ${z.highPriority} high priority`).join("\n")}
- Farther than ${NEAR_KM} km from any zone: ${s.outsideZones}
- No coordinates: ${s.unlocated}

## Missing evidence

${list(s.missingEvidence.map((e) => `${humanize(e.code)}: ${e.count} case${e.count === 1 ? "" : "s"}`))}

## Cases for review, highest priority first

${list(
  s.queue.map(
    (c) =>
      `${c.observation.observation_id} (${reviewLabel[c.review_priority!.level]}, AIS ${identityLabel[c.observation.identity_status].toLowerCase()}, ${formatProximity(nearestZone(c.observation.position))}): ${c.review_priority!.explanation}`,
  ),
)}
`;
}

// Saves text to the user's computer as a file. It makes a temporary link to the text, clicks it to start
// the browser's download, then frees the link.
export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  // A hidden link that is clicked to start the download.
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
