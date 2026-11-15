import { useMemo, useState } from "react";
import type { Api } from "../api/client";
import type { DataMode } from "../api/types";
import { authorizationLabel, dataModeLabel, formatTime, identityLabel, reviewLabel } from "../format";
import { DISCLAIMER, NEAR_KM, download, humanize, impactReport, summarize } from "../report";
import { useCases } from "../useCases";
import { formatProximity, nearestZone } from "../zones";
import { StatusLabel } from "./StatusLabel";

function Bars({ rows, total }: { rows: { label: string; count: number; tone?: string }[]; total: number }) {
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span className={`bar-fill ${r.tone ?? ""}`} style={{ width: total ? `${(r.count / total) * 100}%` : 0 }} />
          </span>
          <span className="bar-count">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function CoastalImpact({ api, onOpenCase }: { api: Api; onOpenCase: (id: string) => void }) {
  const [dataMode, setDataMode] = useState<DataMode | "all">("all");
  const { list } = useCases(api, dataMode);
  const cases = list.state === "ok" ? list.data : [];
  const s = useMemo(() => summarize(cases), [cases]);
  const sourceLabel = dataMode === "all" ? "All sources" : dataModeLabel[dataMode];

  return (
    <div className="report">
      <div className="report-head">
        <div>
          <h1>Coastal impact report</h1>
          <p className="muted">
            {sourceLabel} · generated {formatTime(new Date().toISOString())}
          </p>
        </div>
        <div className="head-actions no-print">
          <label className="inline-field">
            <span>Data source</span>
            <select value={dataMode} onChange={(e) => setDataMode(e.target.value as DataMode | "all")}>
              <option value="all">All sources</option>
              {(Object.keys(dataModeLabel) as DataMode[]).map((m) => (
                <option key={m} value={m}>
                  {dataModeLabel[m]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => window.print()} disabled={s.total === 0}>
            Print or save as PDF
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => download("ghostfleet-coastal-impact-report.md", impactReport(s, sourceLabel))}
            disabled={s.total === 0}
          >
            Download report
          </button>
        </div>
      </div>

      <p className="report-disclaimer">{DISCLAIMER}</p>

      {list.state === "loading" && <p className="empty">Loading cases…</p>}
      {list.state === "error" && (
        <div className="notice error">
          <strong>Could not load cases.</strong> {list.message}
        </div>
      )}
      {list.state === "ok" && s.total === 0 && <p className="empty">No cases yet for this data source.</p>}

      {s.total > 0 && (
        <>
          <section className="panel report-stats">
            <div className="stat">
              <strong>{s.total}</strong>
              <span>Radar detections</span>
            </div>
            <div className="stat">
              <strong>{s.identity.matched}</strong>
              <span>AIS matched</span>
            </div>
            <div className="stat">
              <strong>{s.identity.unmatched}</strong>
              <span>Unmatched AIS</span>
            </div>
            <div className="stat status-potential_violation">
              <strong>{s.authorization.potential_violation}</strong>
              <span>Potential violations</span>
            </div>
            <div className="stat">
              <strong>{s.review.high}</strong>
              <span>High priority</span>
            </div>
          </section>

          <div className="report-grid">
            <section className="panel">
              <div className="panel-head">
                <h2>AIS match status</h2>
              </div>
              <Bars
                total={s.total}
                rows={(["matched", "unmatched", "ambiguous", "insufficient_data"] as const).map((k) => ({
                  label: identityLabel[k],
                  count: s.identity[k],
                }))}
              />
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Authorization</h2>
              </div>
              <Bars
                total={s.total}
                rows={(["authorized", "potential_violation", "unknown"] as const).map((k) => ({
                  label: authorizationLabel[k],
                  count: s.authorization[k],
                  tone: `fill-${k}`,
                }))}
              />
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Review priority</h2>
              </div>
              <Bars
                total={s.total}
                rows={[
                  ...(["high", "review", "routine"] as const).map((k) => ({ label: reviewLabel[k], count: s.review[k] })),
                  { label: "Not set", count: s.review.none },
                ]}
              />
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Missing evidence</h2>
              </div>
              {s.missingEvidence.length ? (
                <Bars total={s.total} rows={s.missingEvidence.map((e) => ({ label: humanize(e.code), count: e.count }))} />
              ) : (
                <p className="empty">No case reports missing evidence.</p>
              )}
            </section>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Activity by fishing zone</h2>
              <span className="muted">Illustrative zones · inside or within {NEAR_KM} km</span>
            </div>
            <table className="case-table">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Inside</th>
                  <th>Nearby</th>
                  <th>Unmatched AIS</th>
                  <th>High priority</th>
                </tr>
              </thead>
              <tbody>
                {s.zones.map((z) => (
                  <tr key={z.zone}>
                    <td>{z.zone}</td>
                    <td>{z.inside}</td>
                    <td>{z.near}</td>
                    <td>{z.unmatched}</td>
                    <td>{z.highPriority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="stat-note muted">
              {s.outsideZones} farther than {NEAR_KM} km from any zone. {s.unlocated} without coordinates.
            </p>
          </section>

          <section className="panel review-panel">
            <div className="panel-head">
              <h2>Cases for review</h2>
              <span className="muted">Highest priority first</span>
            </div>
            {s.queue.length === 0 ? (
              <p className="empty">No cases are flagged for review.</p>
            ) : (
              <table className="case-table wrap review-table">
                <thead>
                  <tr>
                    <th>Priority</th>
                    <th>Case</th>
                    <th>Authorization</th>
                    <th>AIS match</th>
                    <th>Fishing zone</th>
                    <th>Why it was flagged</th>
                  </tr>
                </thead>
                <tbody>
                  {s.queue.map((c) => {
                    const o = c.observation;
                    return (
                      <tr key={o.observation_id} onClick={() => onOpenCase(o.observation_id)} tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && onOpenCase(o.observation_id)}>
                        <td>
                          <span className={`priority priority-${c.review_priority!.level}`}>
                            {reviewLabel[c.review_priority!.level]}
                          </span>
                        </td>
                        <td className="mono">{o.observation_id}</td>
                        <td>
                          <StatusLabel status={c.authorization.status} />
                        </td>
                        <td>{identityLabel[o.identity_status]}</td>
                        <td>{formatProximity(nearestZone(o.position))}</td>
                        <td className="why">{c.review_priority!.explanation}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
