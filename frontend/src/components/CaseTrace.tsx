import type { Case } from "../api/types";
import {
  activityLabel,
  authorizationLabel,
  formatPosition,
  formatTime,
  identityLabel,
  reviewLabel,
  vesselTypeLabel,
} from "../format";
import { humanize } from "../report";
import { formatProximity, nearestZone } from "../zones";

export function CaseTrace({ data }: { data: Case }) {
  const o = data.observation;
  const v = data.vessel_assessment;
  const m = o.match_evidence;

  const steps = [
    {
      title: "Radar detection",
      value: `Score ${o.detection_confidence.toFixed(2)}`,
      lines: [formatTime(o.captured_at), formatPosition(o.position)],
    },
    {
      title: "AIS match",
      value: identityLabel[o.identity_status],
      lines: [
        o.mmsi ? `MMSI ${o.mmsi}` : "No MMSI assigned",
        m ? `${m.candidate_distance_m} m, ${m.time_gap_seconds} s gap` : "No match evidence",
      ],
    },
    {
      title: "Vessel and area",
      value: v ? activityLabel[v.activity] + " activity" : "Not assessed",
      lines: [v ? vesselTypeLabel[v.vessel_type] : "No vessel assessment", formatProximity(nearestZone(o.position))],
    },
    {
      title: "Authorization",
      value: authorizationLabel[data.authorization.status],
      tone: data.authorization.status,
      lines: data.authorization.reason_codes.slice(0, 2).map(humanize),
    },
    {
      title: "Review priority",
      value: data.review_priority ? reviewLabel[data.review_priority.level] : "Not set",
      lines: [],
    },
  ];

  return (
    <ol className="trace" aria-label="Evidence trail">
      {steps.map((s, i) => (
        <li key={s.title} className="trace-step">
          <div className="trace-title">
            {i + 1}. {s.title}
          </div>
          <div className={s.tone ? `trace-value status-${s.tone}` : "trace-value"}>{s.value}</div>
          {s.lines.map((l) => (
            <div key={l} className="muted small">
              {l}
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}
