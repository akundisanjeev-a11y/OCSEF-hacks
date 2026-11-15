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

export const NEAR_KM = 25;

export const DISCLAIMER =
  "These are investigation leads for human review, not findings of illegal activity. Vessel presence alone does not establish fishing, and an unmatched AIS observation is not proof of illegal fishing. Fishing zones are illustrative placeholders.";

export const humanize = (code: string) => code.replace(/_/g, " ");

export interface ZoneSummary {
  zone: string;
  inside: number;
  near: number;
  unmatched: number;
  highPriority: number;
}

export interface ImpactSummary {
  total: number;
  identity: Record<IdentityStatus, number>;
  authorization: Record<AuthorizationStatus, number>;
  review: Record<ReviewLevel | "none", number>;
  zones: ZoneSummary[];
  outsideZones: number;
  unlocated: number;
  missingEvidence: { code: string; count: number }[];
  queue: Case[];
}

export function summarize(cases: Case[]): ImpactSummary {
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
  const codes = new Map<string, number>();

  for (const c of cases) {
    const o = c.observation;
    s.identity[o.identity_status]++;
    s.authorization[c.authorization.status]++;
    s.review[c.review_priority?.level ?? "none"]++;

    for (const code of c.authorization.reason_codes) {
      if (/^(missing|unresolved)_/.test(code)) codes.set(code, (codes.get(code) ?? 0) + 1);
    }

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

  s.missingEvidence = [...codes].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
  s.queue = cases
    .filter((c) => c.review_priority && c.review_priority.level !== "routine")
    .sort((a, b) => priorityRank(a) - priorityRank(b) || b.observation.detection_confidence - a.observation.detection_confidence);
  return s;
}

const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- None");

export function caseReport(c: Case): string {
  const o = c.observation;
  const a = c.authorization;
  const v = c.vessel_assessment;
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

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
