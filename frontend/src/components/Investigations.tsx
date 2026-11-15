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
  return <div className="real-investigations split">
    <section className="panel"><div className="panel-head"><h2>Investigation workspace</h2><button onClick={onOverview}>Change selected area</button></div>
      {!!result?.vessels.length && <section className="investigation-screening" aria-label="Screen selected boats">
        <div><span className="eyebrow">AREA RISK SCREENING</span><h2>Check {result.vessels.length} boats for warning signs</h2><p>See each result as it arrives. Open a full report only when you need more detail.</p></div>
        <div className="screening-actions"><button className="primary" disabled={screening || pending === 0} onClick={() => void startScreening()}>{screening ? "Screening risks…" : checked === 0 ? "Screen vessel risks" : pending ? "Resume / retry remaining checks" : "All boats checked"}</button>{screening && <button onClick={stopScreening}>Stop screening</button>}</div>
        <div className="screening-summary" role="status"><strong>{checked} / {result.vessels.length} checked</strong><span>{flagged} flagged · {incomplete} incomplete / failed · {result.vessels.length - checked} not checked</span></div>
        <p>Warning and missing-information counts can overlap. These are reasons to investigate boats, not findings that they acted illegally in this rectangle.</p>
        <progress className="screening-progress" aria-label="Vessel risk screening progress" value={checked} max={result.vessels.length} />
        {screening && <LoadingStatus label="Screening selected boats…" detail="Four checks run at a time. You can switch tabs; screening continues. Stop keeps completed results." />}
        {screenError && <div className="notice error" role="alert">{screenError}</div>}{screenMessage && !screening && <p className="small" role="status">{screenMessage}</p>}
        <Info label="What we check"><ul><li>Possible fishing where fishing is prohibited.</li><li>Possible fishing without a known regional permit.</li><li>Gaps in a boat's radio signals.</li><li>Records on illegal-fishing warning lists.</li></ul><p>These checks use GFW's risk summaries for the selected dates. Missing information stays unknown. No reported flags is not proof of safety or permission to fish. Recent results are reused for the exact same boat and dates. Screening continues across tabs, but choosing another area stops the old run. Checks already sent may finish after Stop.</p></Info>
      </section>}
      <Info label="Investigation evidence"><p>Shows the boats from your Overview selection. Risk screening runs here. Reports opened during this session are retained here, including ID lookups. Each report keeps its own dates. Session reports clear when you reload the page.</p></Info>
      {reports.length > 0 && <div className="block"><h3>Opened reports ({reports.length})</h3><div className="report-choices">{reports.map(report => <button key={`${report.vessel_id}-${report.start}-${report.end}`} onClick={() => { version.current++; setLoading(false); setError(""); workspace.selectReport(report); }}>{report.summary.name} · {report.start.slice(0, 10)}</button>)}</div></div>}
      {!result && <p className="empty">Select an area in Overview to load vessels for investigation, or search an ID in Check vessel ID.</p>}
      {result && <>
        <p className="stat-note">{result.start} to {result.end}</p>
        <div className="risk-toolbar"><label>Show vessels <select value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="all">All vessels</option><option value="flagged">Flagged for review</option><option value="no_flags">No reported flags</option><option value="unknown">Incomplete information</option><option value="unchecked">Not checked</option><option value="failed">Checks that failed</option></select></label><span>{vessels.length} matching vessels</span></div>
        <div className="investigation-vessels">{vessels.slice(currentPage * 50, (currentPage + 1) * 50).map(vessel => {
          const risk = risks[vessel.vessel_id];
          return <div className="investigation-row" key={vessel.vessel_id}>
            <ShipSymbol type={vessel.vessel_type} /><div className="investigation-boat"><strong>{vessel.name}</strong><br />{vessel.mmsi ?? vessel.vessel_id}<br /><small>{shipNames[shipKind(vessel.vessel_type)]}</small><br />
              <strong className={`risk-state-${risk?.state ?? "unchecked"}`}>{!risk ? "Not checked" : risk.error ? "Screening failed" : risk.state === "flagged" ? `Flagged (${risk.flag_count})` : risk.state === "no_flags" ? "No reported flags" : "Incomplete information"}</strong>
              {risk?.indicators.filter(hasRiskEvidence).map(indicator => <small className="risk-reason" key={indicator.code}>{warningNames[indicator.code] ?? indicator.label}: {indicator.count_is_lower_bound ? "at least " : ""}{indicator.count ?? "exact count unavailable"}</small>)}
              {risk && !risk.error && risk.indicators.some(indicator => indicatorNarrative(indicator).status === "flagged") && <details className="row-risk-explanation"><summary>Why does this need review?</summary>{risk.indicators.filter(indicator => indicatorNarrative(indicator).status === "flagged").map(indicator => <IndicatorExplanation key={indicator.code} indicator={indicator} />)}<p className="small">The counts cover the report dates and may refer to events outside your selected rectangle. Open the full report to inspect available source events.</p></details>}
              {!!risk?.missing_count && !risk.error && <small className="risk-reason">{risk.missing_count} checks have missing information</small>}
              {!!risk?.quality_notes?.length && <details><summary>Source data issues</summary>{risk.quality_notes.map(note => <p className="small" key={note}>{note}</p>)}</details>}
              {risk?.error && <small className="risk-reason">{risk.error}</small>}
            </div><button disabled={loading} onClick={() => void inspect(vessel.vessel_id)}>Full report</button>
          </div>;
        })}</div>
        {!vessels.length && <p className="empty">No vessel identities match this filter. Unmatched radar sightings cannot be identified here.</p>}
        <div className="risk-toolbar"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} / {lastPage + 1}</span><button disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></div>
      </>}

    </section>
    <section className="panel" aria-live="polite"><div className="panel-head"><h2>Vessel evidence</h2>{selectedReport && <button onClick={() => workspace.selectReport(null)}>Close report</button>}</div>
      {loading && <><LoadingStatus label="Loading GFW identity and risk insights…" /><Skeleton /></>}{error && <div className="notice error" role="alert">{error}</div>}
      {!loading && selectedReport && <VesselEvidence report={selectedReport} />}
      {!loading && !selectedReport && !error && <p className="empty">Choose a vessel or an opened report.</p>}
    </section>
  </div>;
}
