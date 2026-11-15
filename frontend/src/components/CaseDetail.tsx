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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

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

interface Props {
  data: Case;
  wide?: boolean;
  onClose?: () => void;
  onOpenInvestigation?: () => void;
}

export function CaseDetail({ data, wide, onClose, onOpenInvestigation }: Props) {
  const o = data.observation;
  const a = data.authorization;
  const v = data.vessel_assessment;
  const m = o.match_evidence;

  return (
    <div className={wide ? "detail detail-wide" : "detail"}>
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

      <div className={`banner banner-${a.status}`}>
        <StatusLabel status={a.status} />
      </div>

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

      <div className="detail-sections">
        <section className="block">
          <h3>Authorization</h3>
          <p className="explanation">{a.explanation}</p>
          <dl>
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

        {data.alerts.length > 0 && (
          <section className="block">
            <h3>Alerts</h3>
            <ul className="alert-list">
              {data.alerts.map((al) => (
                <li key={al.code} className={`alert alert-${al.severity}`}>
                  <div className="alert-head">
                    <span className="alert-severity">{severityLabel[al.severity]}</span>
                    <span className="mono muted">{al.code}</span>
                  </div>
                  <p>{al.message}</p>
                  {al.sources.length > 0 && <div className="muted small">{al.sources.join("; ")}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {v && (
          <section className="block">
            <h3>Vessel assessment</h3>
            <p className="explanation">{v.explanation}</p>
            <dl>
              <Row label="Vessel type">{vesselTypeLabel[v.vessel_type]}</Row>
              <Row label="Activity">{activityLabel[v.activity]}</Row>
              <Row label="Zone">
                {v.zone_id ? <span className="mono">{v.zone_id}</span> : <span className="muted">Not resolved</span>}
              </Row>
              <Row label="Evidence">
                <SourceList sources={v.sources} />
              </Row>
            </dl>
          </section>
        )}

        <section className="block">
          <h3>Observation</h3>
          <dl>
            <Row label="Source">{dataModeLabel[o.data_mode]}</Row>
            <Row label="Scene">
              <span className="mono">{o.scene_id}</span>
            </Row>
            <Row label="Captured">{formatTime(o.captured_at)}</Row>
            <Row label="Location">{formatPosition(o.position)}</Row>
            <Row label="Fishing zone">
              {formatProximity(nearestZone(o.position))}
              <div className="muted small">Illustrative zone, not an official boundary</div>
            </Row>
            <Row label="Detection score">{o.detection_confidence.toFixed(2)}</Row>
            <Row label="Box (px)">
              {o.bbox_px ? <span className="mono">[{o.bbox_px.join(", ")}]</span> : "—"}
            </Row>
            <Row label="Sources">
              <SourceList sources={o.sources} />
            </Row>
          </dl>
        </section>

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

      <details className="raw">
        <summary>Raw response</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}
