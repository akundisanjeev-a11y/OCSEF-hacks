import { useMemo, useState } from "react";
import type { Api } from "../api/client";
import type { DataMode } from "../api/types";
import { authorizationLabel, dataModeLabel, formatTime, identityLabel, reviewLabel } from "../format";
import { DISCLAIMER, NEAR_KM, download, humanize, impactReport, summarize } from "../report";
import { useCases } from "../useCases";
import { formatProximity, nearestZone } from "../zones";
import { StatusLabel } from "./StatusLabel";

// A simple horizontal bar chart: one row per category with a label, a bar and a count.
// Each bar's width is that row's share of `total`, so bars in the same chart are comparable.
function Bars({ rows, total }: { rows: { label: string; count: number; tone?: string }[]; total: number }) {
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="bar-label">{r.label}</span>
          {/* Grey track with a coloured fill inside; the fill width is count / total as a percentage (0 if nothing to show). */}
          <span className="bar-track">
            <span className={`bar-fill ${r.tone ?? ""}`} style={{ width: total ? `${(r.count / total) * 100}%` : 0 }} />
          </span>
          <span className="bar-count">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

// The Coastal impact page: a printable summary report of all the cases (detections, AIS matching,
// permit decisions, review priority, missing evidence and activity near fishing zones).
// onOpenCase is called when a row in the review table is clicked, to open that case elsewhere.
export function CoastalImpact({ api, onOpenCase }: { api: Api; onOpenCase: (id: string) => void }) {
  // Which kind of records to include: all, fictional, published historical or model uploads.
  const [dataMode, setDataMode] = useState<DataMode | "all">("all");
  // Load the cases for that choice from the backend.
  const { list } = useCases(api, dataMode);
  // The loaded cases, or an empty list while loading or after an error.
  const cases = list.state === "ok" ? list.data : [];
  // The report's totals and groupings, recomputed only when the cases change.
  const s = useMemo(() => summarize(cases), [cases]);
  // Readable name of the chosen data source, used in the heading and the downloaded report.
  const sourceLabel = dataMode === "all" ? "All sources" : dataModeLabel[dataMode];

  return (
    <div className="report">
      {/* Report header: title, data source and time, plus the data-source menu and the print/download buttons.
          The buttons are hidden when the report is printed. */}
      <div className="report-head">
        <div>
          <h1>Coastal impact report</h1>
          <p className="muted">
            {sourceLabel} · generated {formatTime(new Date().toISOString())}
          </p>
        </div>
        <div className="head-actions no-print">
          {/* Choose which data source the report covers. */}
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
          {/* Opens the browser's print dialog, where "Save as PDF" makes a PDF of the report. */}
          <button type="button" onClick={() => window.print()} disabled={s.total === 0}>
            Print or save as PDF
          </button>
          {/* Downloads the same report as a text (Markdown) file. */}
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

      {/* Standing reminder that the report lists leads for human review, not findings of illegal activity. */}
      <p className="report-disclaimer">{DISCLAIMER}</p>

      {/* Loading, error and empty messages for the report. */}
      {list.state === "loading" && <p className="empty">Loading cases…</p>}
      {list.state === "error" && (
        <div className="notice error">
          <strong>Could not load cases.</strong> {list.message}
        </div>
      )}
      {list.state === "ok" && s.total === 0 && <p className="empty">No cases yet for this data source.</p>}

      {/* The report body, shown only when there is at least one case. */}
      {s.total > 0 && (
        <>
          {/* Headline numbers across the top. */}
          <section className="panel report-stats">
            <div className="stat">
              <strong>{s.total}</strong>
              <span>Radar detections</span>
            </div>
            {/* Detections that matched an AIS tracking signal. */}
            <div className="stat">
              <strong>{s.identity.matched}</strong>
              <span>AIS matched</span>
            </div>
            {/* Detections with no AIS match despite adequate coverage. */}
            <div className="stat">
              <strong>{s.identity.unmatched}</strong>
              <span>Unmatched AIS</span>
            </div>
            {/* Cases where the backend found a documented conflict with a rule. */}
            <div className="stat status-potential_violation">
              <strong>{s.authorization.potential_violation}</strong>
              <span>Potential violations</span>
            </div>
            {/* Cases flagged High for human review. */}
            <div className="stat">
              <strong>{s.review.high}</strong>
              <span>High priority</span>
            </div>
          </section>

          {/* Four bar charts in a two-by-two grid. */}
          <div className="report-grid">
            {/* How the detections break down by AIS match result. */}
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

            {/* How the cases break down by permit decision; each bar is coloured to match its status. */}
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

            {/* How the cases break down by review urgency, including cases with no priority set. */}
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

            {/* Which pieces of evidence are most often missing (for example permit or activity evidence). */}
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

          {/* Activity by fishing zone: how many detections are inside or near each placeholder zone. */}
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
                {/* One row per fishing zone. */}
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
            {/* Cases not counted in any zone row: too far away, or with no coordinates at all. */}
            <p className="stat-note muted">
              {s.outsideZones} farther than {NEAR_KM} km from any zone. {s.unlocated} without coordinates.
            </p>
          </section>

          {/* Cases for review: every case flagged above routine, highest priority first. */}
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
                      // Clicking a row (or pressing Enter on it) opens that case in the Investigations page.
                      <tr key={o.observation_id} onClick={() => onOpenCase(o.observation_id)} tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && onOpenCase(o.observation_id)}>
                        {/* Review priority level. */}
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
                        {/* The backend's plain-language reason this case needs a human look. */}
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
