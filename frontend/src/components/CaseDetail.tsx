import type { ReactNode } from "react";
import type { Case } from "../api/types";
import {
  activityLabel,
  dataModeLabel,
  formatPosition,
  formatTime,
  identityLabel,
  reviewLabel,
  severityLabel,
  vesselTypeLabel,
} from "../format";
import { caseReport, download } from "../report";
import { formatProximity, nearestZone } from "../zones";
import { StatusLabel } from "./StatusLabel";

// One "label: value" line inside a details section, e.g. "Captured: 2026-01-01 10:00 UTC".
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// A bullet list of where a piece of evidence came from, or "None" when there are no sources.
function SourceList({ sources }: { sources: string[] }) {
  if (sources.length === 0) return <span className="muted">None</span>;
  return (
    <ul className="plain-list">
      {sources.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  );
}

// What the case panel receives: the case to show, whether to use the wide two-column layout
// (Investigations page), and optional buttons: close (Overview side panel) and open-investigation.
interface Props {
  data: Case;
  wide?: boolean;
  onClose?: () => void;
  onOpenInvestigation?: () => void;
}

// The full evidence for one case, used in the Overview side panel and on the Investigations page.
// It shows everything the backend decided: permit decision, review priority, alerts, vessel
// assessment, the radar observation and the AIS identity match.
export function CaseDetail({ data, wide, onClose, onOpenInvestigation }: Props) {
  // Shortcuts to the main parts of the case used throughout the layout below.
  const o = data.observation;
  // The permit decision and the reasons behind it.
  const a = data.authorization;
  // The tentative vessel-type and activity assessment (may be missing).
  const v = data.vessel_assessment;
  // How the AIS track was matched to the radar detection (may be missing).
  const m = o.match_evidence;

  return (
    <div className={wide ? "detail detail-wide" : "detail"}>
      {/* Header: the record type (fictional, real or uploaded), the case ID and an optional close button. */}
      <header className="detail-head">
        <div>
          <div className="eyebrow">{dataModeLabel[o.data_mode]} record</div>
          <h2 className="mono">{o.observation_id}</h2>
        </div>
        {onClose && (
          <button type="button" className="close" onClick={onClose} aria-label="Close case">
            ×
          </button>
        )}
      </header>

      {/* Coloured banner repeating the permit decision so it is the first thing seen. */}
      <div className={`banner banner-${a.status}`}>
        <StatusLabel status={a.status} />
      </div>

      {/* Action buttons: jump to the Investigations page (when offered) and download this case as a report. */}
      <div className="detail-actions">
        {onOpenInvestigation && (
          <button type="button" onClick={onOpenInvestigation}>
            Open investigation
          </button>
        )}
        <button type="button" onClick={() => download(`ghostfleet-case-${o.observation_id}.md`, caseReport(data))}>
          Export report
        </button>
      </div>

      {/* All the detail sections; in the wide layout they flow into two columns. */}
      <div className="detail-sections">
        {/* Authorization: the permit decision in words, the reason codes behind it and the evidence used. */}
        <section className="block">
          <h3>Authorization</h3>
          <p className="explanation">{a.explanation}</p>
          <dl>
            {/* Short machine codes explaining why the decision was made. */}
            <Row label="Reason codes">
              {a.reason_codes.length ? (
                <ul className="plain-list mono">
                  {a.reason_codes.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : (
                <span className="muted">None</span>
              )}
            </Row>
            <Row label="Evidence">
              <SourceList sources={a.sources} />
            </Row>
          </dl>
        </section>

        {/* Review priority: how urgently a person should look at this case, and why. */}
        <section className="block">
          <h3>Review priority</h3>
          {data.review_priority ? (
            <dl>
              <Row label="Level">{reviewLabel[data.review_priority.level]}</Row>
              <Row label="Reason">{data.review_priority.explanation}</Row>
            </dl>
          ) : (
            <p className="muted">Not set</p>
          )}
        </section>

        {/* Alerts: flags the backend raised (for example a possible permit conflict), shown only if there are any.
            Each is coloured by severity. */}
        {data.alerts.length > 0 && (
          <section className="block">
            <h3>Alerts</h3>
            <ul className="alert-list">
              {data.alerts.map((al) => (
                <li key={al.code} className={`alert alert-${al.severity}`}>
                  {/* Severity and the alert's code. */}
                  <div className="alert-head">
                    <span className="alert-severity">{severityLabel[al.severity]}</span>
                    <span className="mono muted">{al.code}</span>
                  </div>
                  {/* The alert text and where its evidence came from. */}
                  <p>{al.message}</p>
                  {al.sources.length > 0 && <div className="muted small">{al.sources.join("; ")}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Vessel assessment: the backend's tentative guess at vessel type and activity (only when it has one). */}
        {v && (
          <section className="block">
            <h3>Vessel assessment</h3>
            <p className="explanation">{v.explanation}</p>
            <dl>
              <Row label="Vessel type">{vesselTypeLabel[v.vessel_type]}</Row>
              <Row label="Activity">{activityLabel[v.activity]}</Row>
              {/* The named zone the vessel was in, if the backend could work it out. */}
              <Row label="Zone">
                {v.zone_id ? <span className="mono">{v.zone_id}</span> : <span className="muted">Not resolved</span>}
              </Row>
              <Row label="Evidence">
                <SourceList sources={v.sources} />
              </Row>
            </dl>
          </section>
        )}

        {/* Observation: the radar detection itself: where it came from, when and where it was seen, and the model's score. */}
        <section className="block">
          <h3>Observation</h3>
          <dl>
            <Row label="Source">{dataModeLabel[o.data_mode]}</Row>
            <Row label="Scene">
              <span className="mono">{o.scene_id}</span>
            </Row>
            <Row label="Captured">{formatTime(o.captured_at)}</Row>
            <Row label="Location">{formatPosition(o.position)}</Row>
            {/* Distance to the nearest fishing zone, computed in the browser from the placeholder zones. */}
            <Row label="Fishing zone">
              {formatProximity(nearestZone(o.position))}
              <div className="muted small">Illustrative zone, not an official boundary</div>
            </Row>
            <Row label="Detection score">{o.detection_confidence.toFixed(2)}</Row>
            {/* Pixel box around the ship in the radar image, when there is one. */}
            <Row label="Box (px)">
              {o.bbox_px ? <span className="mono">[{o.bbox_px.join(", ")}]</span> : "—"}
            </Row>
            <Row label="Sources">
              <SourceList sources={o.sources} />
            </Row>
          </dl>
        </section>

        {/* AIS identity: whether the detection matched a tracking signal, the vessel's ID numbers
            (MMSI and IMO) and, when a match exists, how closely it lined up. */}
        <section className="block">
          <h3>AIS identity</h3>
          <dl>
            <Row label="Match status">{identityLabel[o.identity_status]}</Row>
            <Row label="MMSI">
              <span className="mono">{o.mmsi ?? "—"}</span>
            </Row>
            <Row label="IMO">
              <span className="mono">{o.imo ?? "—"}</span>
            </Row>
            {/* Match evidence: distance between the radar position and the AIS track, the time gap and the method used. */}
            {m && (
              <>
                <Row label="Distance">{m.candidate_distance_m} m</Row>
                <Row label="AIS time gap">{m.time_gap_seconds} s</Row>
                <Row label="Method">{m.matching_method}</Row>
              </>
            )}
          </dl>
        </section>
      </div>

      {/* Collapsible dump of the exact data the backend sent, so a teammate can check the page against the API. */}
      <details className="raw">
        <summary>Raw response</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}
