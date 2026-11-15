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

// The "evidence trail" strip at the top of the Investigations page. It walks through one case in the
// order the system worked it out: radar detection, then AIS match, then vessel and area, then the
// permit decision, then review priority. It only displays data the backend already returned.
export function CaseTrace({ data }: { data: Case }) {
  // Shortcuts to the parts of the case used below: the radar observation, the vessel assessment
  // (may be missing) and the AIS match evidence (may be missing).
  const o = data.observation;
  // The vessel assessment (may be missing).
  const v = data.vessel_assessment;
  // The AIS match evidence (may be missing).
  const m = o.match_evidence;

  // The five steps. Each has a title, one headline value and a few supporting lines;
  // `tone` (Authorization only) colours the headline by the permit decision.
  const steps = [
    // Step 1: what the radar saw, how sure the model was, when and where.
    {
      title: "Radar detection",
      value: `Score ${o.detection_confidence.toFixed(2)}`,
      lines: [formatTime(o.captured_at), formatPosition(o.position)],
    },
    // Step 2: whether the detection matched an AIS tracking signal, and if so which vessel
    // (MMSI is the ship's radio ID) and how closely the signal lined up.
    {
      title: "AIS match",
      value: identityLabel[o.identity_status],
      lines: [
        o.mmsi ? `MMSI ${o.mmsi}` : "No MMSI assigned",
        m ? `${m.candidate_distance_m} m, ${m.time_gap_seconds} s gap` : "No match evidence",
      ],
    },
    // Step 3: what kind of vessel and activity the evidence suggests, and where it is relative to fishing zones.
    {
      title: "Vessel and area",
      value: v ? activityLabel[v.activity] + " activity" : "Not assessed",
      lines: [v ? vesselTypeLabel[v.vessel_type] : "No vessel assessment", formatProximity(nearestZone(o.position))],
    },
    // Step 4: the permit decision, with up to two of the reasons behind it in plain words.
    {
      title: "Authorization",
      value: authorizationLabel[data.authorization.status],
      tone: data.authorization.status,
      lines: data.authorization.reason_codes.slice(0, 2).map(humanize),
    },
    // Step 5: how urgently a person should look at this case.
    {
      title: "Review priority",
      value: data.review_priority ? reviewLabel[data.review_priority.level] : "Not set",
      lines: [],
    },
  ];

  return (
    // A numbered list, one box per step, laid out left to right.
    <ol className="trace" aria-label="Evidence trail">
      {steps.map((s, i) => (
        <li key={s.title} className="trace-step">
          {/* Step number and name. */}
          <div className="trace-title">
            {i + 1}. {s.title}
          </div>
          {/* Headline value; coloured by status only for the Authorization step. */}
          <div className={s.tone ? `trace-value status-${s.tone}` : "trace-value"}>{s.value}</div>
          {/* Supporting detail lines under the headline. */}
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
