import { useRef, useEffect, useState } from "react";
import { useHistoricalWorkspace } from "../HistoricalWorkspace";
import { fetchHistoricalVessel } from "../api/historical";
import { VesselEvidence } from "./VesselEvidence";
import { Info } from "./Info";
import { LoadingStatus, Skeleton } from "./Loading";
import { ShipSymbol } from "./ShipSymbol";
import { shipKind, shipNames } from "../vesselSymbols";
import { warningNames } from "../vesselLanguage";
import { IndicatorExplanation } from "./RiskExplanation";
import { hasRiskEvidence, indicatorNarrative } from "../evidenceNarrative";

import { AreaPriority } from './AreaPriority';

export function Investigations({ onOverview }: { onOverview: () => void }) {
  const workspace = useHistoricalWorkspace()!;
  const { result, risks, reports, selectedReport, screening, screenError, screenMessage, startScreening, stopScreening } = workspace;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const version = useRef(0);
  useEffect(() => { version.current++; setLoading(false); setError(""); setPage(0); }, [result]);
  useEffect(() => () => { version.current++; }, []);
  async function inspect(id: string) {
    if (!result) return;
    const saved = reports.find(report => report.vessel_id === id && report.start === result.start && report.end === result.end);
    if (saved) { version.current++; setLoading(false); setError(""); workspace.selectReport(saved); return; }
    const request = ++version.current;
    workspace.selectReport(null); setLoading(true); setError("");
    try {
      const report = await fetchHistoricalVessel(id, { mode: "gfw", hours_ago: 100, window_hours: 24, start: result.start, end: result.end });
      if (request === version.current) workspace.saveReport(report);
    } catch (e) { if (request === version.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (request === version.current) setLoading(false); }
  }
  const vessels = [...(result?.vessels ?? [])].filter(vessel => filter === "all" || (filter === "unchecked" ? !risks[vessel.vessel_id] : filter === "failed" ? !!risks[vessel.vessel_id]?.error : risks[vessel.vessel_id]?.state === filter && !risks[vessel.vessel_id]?.error)).sort((a, b) => (risks[b.vessel_id]?.flag_count ?? 0) - (risks[a.vessel_id]?.flag_count ?? 0));
  const checks = Object.values(risks);
  const checked = checks.length;
  const flagged = checks.filter(row => row.state === "flagged").length;
  const incomplete = checks.filter(row => row.state === "unknown" || row.error || row.missing_count > 0).length;
  const pending = (result?.vessels ?? []).filter(vessel => !risks[vessel.vessel_id] || risks[vessel.vessel_id].state === "unknown" || risks[vessel.vessel_id].missing_count > 0 || risks[vessel.vessel_id].error).length;
  const lastPage = Math.max(0, Math.ceil(vessels.length / 50) - 1);
  const currentPage = Math.min(page, lastPage);
  const percent = result?.vessels.length ? Math.round((100 * checked) / result.vessels.length) : 0;
  return <div className="real-investigations split">
    {result && <AreaPriority report={result} />}
    <section className="panel investigation-workspace">
      <div className="panel-head"><h1>Investigation workspace</h1>{result && <span className="head-context mono">{result.start.slice(0, 10)} – {result.end.slice(0, 10)}</span>}<button onClick={onOverview}>Change selected area</button></div>

      {/* Screening: what it does, how far it has got, and the controls, in one band. */}
      {!!result?.vessels.length && <section className="investigation-screening" aria-label="Screen selected boats">
        <div className="screening-intro">
          <span className="eyebrow">Area risk screening</span>
          <h2>Check {result.vessels.length} boats for warning signs</h2>
          <p>Results appear as each check finishes. Open a full report only when you need more detail.</p>
          <Info label="What we check"><ul><li>Possible fishing where fishing is prohibited.</li><li>Possible fishing without a known regional permit.</li><li>Gaps in a boat's radio signals.</li><li>Records on illegal-fishing warning lists.</li></ul><p>These checks use GFW's risk summaries for the selected dates. Missing information stays unknown. No reported flags is not proof of safety or permission to fish. Recent results are reused for the exact same boat and dates. Screening continues across tabs, but choosing another area stops the old run. Checks already sent may finish after Stop.</p><p>Warning and missing-information counts can overlap. These are reasons to investigate boats, not findings that they acted illegally in this rectangle.</p></Info>
        </div>
        <div className="screening-progress-panel">
          <div className="screening-summary" role="status"><strong>{checked} / {result.vessels.length} checked</strong><span className="screening-percent">{percent}%</span></div>
          <progress className="screening-progress" aria-label="Vessel risk screening progress" value={checked} max={result.vessels.length} />
          <div className="screening-counts">
            <div className={flagged ? "state-review" : undefined}><strong>{flagged}</strong><span>Flagged</span></div>
            <div className={incomplete ? "state-missing" : undefined}><strong>{incomplete}</strong><span>Incomplete / failed</span></div>
            <div><strong>{result.vessels.length - checked}</strong><span>Not checked</span></div>
          </div>
        </div>
        <div className="screening-actions"><button className="primary" disabled={screening || pending === 0} onClick={() => void startScreening()}>{screening ? "Screening risks…" : checked === 0 ? "Screen vessel risks" : pending ? "Resume / retry remaining checks" : "All boats checked"}</button>{screening && <button onClick={stopScreening}>Stop screening</button>}</div>
        {(screening || screenError || (screenMessage && !screening)) && <div className="screening-status">
          {screening && <LoadingStatus label="Screening selected boats…" detail="Four checks run at a time. You can switch tabs; screening continues. Stop keeps completed results." />}
          {screenError && <div className="notice error" role="alert">{screenError}</div>}{screenMessage && !screening && <p className="small" role="status">{screenMessage}</p>}
        </div>}
      </section>}

      {/* Reports opened this session, so an investigator can move between them. */}
      {reports.length > 0 && <div className="opened-reports"><h3>Opened reports ({reports.length})</h3><div className="report-choices">{reports.map(report => <button key={`${report.vessel_id}-${report.start}-${report.end}`} className={selectedReport === report ? "quiet is-current" : "quiet"} onClick={() => { version.current++; setLoading(false); setError(""); workspace.selectReport(report); }}>{report.summary.name} · {report.start.slice(0, 10)}</button>)}</div></div>}

      {!result && <div className="empty-state"><h3>No area selected</h3><p>Select an area in Overview to load its boats for investigation, or search one boat in Check vessel ID.</p><button type="button" onClick={onOverview}>Go to Overview</button></div>}

      {result && <>
        {/* Results: filter, then one row per boat with its screening result. */}
        <div className="results-toolbar"><label className="inline-label">Show vessels <select value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="all">All vessels</option><option value="flagged">Flagged for review</option><option value="no_flags">No reported flags</option><option value="unknown">Incomplete information</option><option value="unchecked">Not checked</option><option value="failed">Checks that failed</option></select></label><span className="muted">{vessels.length} matching vessels</span><Info label="About this workspace"><p>Shows the boats from your Overview selection. Risk screening runs here. Reports opened during this session are retained here, including ID lookups. Each report keeps its own dates. Session reports clear when you reload the page.</p></Info></div>
        {!!vessels.length && <div className="results-head" aria-hidden="true"><span /><span>Vessel</span><span>Screening result</span><span>Reported warning signs</span><span /></div>}
        <div className="investigation-vessels">{vessels.slice(currentPage * 50, (currentPage + 1) * 50).map(vessel => {
          const risk = risks[vessel.vessel_id];
          const shown = selectedReport?.vessel_id === vessel.vessel_id;
          return <div className={shown ? "investigation-row selected" : "investigation-row"} key={vessel.vessel_id}>
            <ShipSymbol type={vessel.vessel_type} />
            {/* Who the boat is: name, radio ID and type. */}
            <div className="investigation-boat"><strong>{vessel.name}</strong><small><span className="mono">{vessel.mmsi ?? vessel.vessel_id}</span> · {shipNames[shipKind(vessel.vessel_type)]}</small></div>
            {/* The screening result, with the reasoning behind a flag. */}
            <div className="investigation-risk">
              <strong className={`risk-state-${risk?.state ?? "unchecked"}${risk?.error ? " risk-state-error" : ""}`}>{!risk ? "Not checked" : risk.error ? "Screening failed" : risk.state === "flagged" ? `Flagged (${risk.flag_count})` : risk.state === "no_flags" ? "No reported flags" : "Incomplete information"}</strong>
              {risk && !risk.error && risk.indicators.some(indicator => indicatorNarrative(indicator).status === "flagged") && <details className="row-risk-explanation"><summary>Why does this need review?</summary>{risk.indicators.filter(indicator => indicatorNarrative(indicator).status === "flagged").map(indicator => <IndicatorExplanation key={indicator.code} indicator={indicator} />)}<p className="small">The counts cover the report dates and may refer to events outside your selected rectangle. Open the full report to inspect available source events.</p></details>}
            </div>
            {/* Which warning signs were counted, and what information was missing. */}
            <div className="investigation-signs">
              {risk?.indicators.filter(hasRiskEvidence).map(indicator => <small className="risk-reason" key={indicator.code}>{warningNames[indicator.code] ?? indicator.label}: {indicator.count_is_lower_bound ? "at least " : ""}{indicator.count ?? "exact count unavailable"}</small>)}
              {!!risk?.missing_count && !risk.error && <small className="risk-reason missing">{risk.missing_count} checks have missing information</small>}
              {!!risk?.quality_notes?.length && <details className="row-risk-explanation"><summary>Source data issues</summary>{risk.quality_notes.map(note => <p className="small" key={note}>{note}</p>)}</details>}
              {risk?.error && <small className="risk-reason">{risk.error}</small>}
            </div>
            <button className="quiet" disabled={loading} onClick={() => void inspect(vessel.vessel_id)}>Full report</button>
          </div>;
        })}</div>
        {!vessels.length && <p className="empty">No vessel identities match this filter. Unmatched radar sightings cannot be identified here.</p>}
        {lastPage > 0 && <div className="pager"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} / {lastPage + 1}</span><button disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></div>}
      </>}
    </section>

    {/* The report for the chosen boat. */}
    <section className="panel" aria-live="polite"><div className="panel-head"><h2>Vessel evidence</h2>{selectedReport && <button onClick={() => workspace.selectReport(null)}>Close report</button>}</div>
      {loading && <><LoadingStatus label="Loading GFW identity and risk insights…" /><Skeleton /></>}{error && <div className="block"><div className="notice error" role="alert">{error}</div></div>}
      {!loading && selectedReport && <VesselEvidence report={selectedReport} />}
      {!loading && !selectedReport && !error && <div className="empty-state"><h3>No report open</h3><p>Choose Full report on any boat to see its identity, authorization records and the reasons it may need review.</p><p>Reports you open stay listed under Opened reports for this session.</p></div>}
    </section>
  </div>;
}
