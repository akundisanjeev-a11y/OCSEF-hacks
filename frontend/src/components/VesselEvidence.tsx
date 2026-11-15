import type { HistoricalEvidence } from "../api/historical";
import { Info } from "./Info";
import { ShipSymbol } from "./ShipSymbol";
import { shipKind, shipNames } from "../vesselSymbols";
import { warningNames } from "../vesselLanguage";
import { IndicatorExplanation, SourceEventDetails, ListingEvidence } from "./RiskExplanation";
import { indicatorNarrative } from "../evidenceNarrative";
import { useHistoricalWorkspace } from "../HistoricalWorkspace";
const documentationNames: Record<string, string> = { public_registry_record_found: "Public registration record found", ais_identity_only: "Identity reported by boat radio only", no_identity_record: "No identity record returned" };

// The vessel report: what the records say about one boat for one period, in the order an investigator reads it.
export function VesselEvidence({ report }: { report: HistoricalEvidence }) {
  const s = report.summary;
  const workspace = useHistoricalWorkspace();
  const selection = workspace?.result;
  const area = selection && Date.parse(selection.start) === Date.parse(report.start) && Date.parse(selection.end) === Date.parse(report.end) ? selection.bounds : undefined;
  const flagged = report.indicators.filter(row => indicatorNarrative(row).status === "flagged");
  const anyUnavailable = report.indicators.some(row => indicatorNarrative(row).status === "unavailable");
  const authorized = report.authorization.status === "authorized";
  return <div className="vessel-evidence report">
    {/* Who the report is about, and the period it covers. */}
    <header className="report-header">
      <ShipSymbol type={s.vessel_type} />
      <div className="report-heading"><h3>{s.name}</h3><span>{shipNames[shipKind(s.vessel_type)]}</span></div>
      <span className="report-dates mono">{report.start.slice(0, 10)} – {report.end.slice(0, 10)}</span>
    </header>

    {/* Permission to do a specific activity. Unknown is the default without permit evidence. */}
    <section className="report-section">
      <h4 className="section-label">Authorization</h4>
      <p className={`status-line ${authorized ? "state-clear" : "state-missing"}`}><strong>Authorization: {report.authorization.status}</strong></p>
      <p>{report.authorization.explanation}</p>
      <Info label="Identity and permits"><p>MMSI identifies a boat's radio. IMO is a permanent ship identification number when one has been assigned. A flag identifies the country where a boat is registered.</p><p>Authorization means permission to do a specific activity in a place and time. Unknown means we do not have enough permit evidence to decide. A public registration record identifies a boat; it does not by itself give permission to fish.</p></Info>
    </section>

    {/* Warning signs that were reported, each with what it does and does not establish. */}
    <section className="report-section">
      <h4 className="section-label">Findings · what needs a closer look</h4>
      {report.risk && <p className="status-line"><strong className={report.risk.state === "flagged" ? "state-review" : report.risk.state === "unknown" ? "state-missing" : "state-clear"}>Risk screening: {report.risk.state === "flagged" ? `${report.risk.flag_count} warning types for review` : report.risk.state === "unknown" ? "Incomplete information" : "No reported flags"}</strong>{report.risk.missing_count > 0 && <span className="status-note"> · {report.risk.missing_count} checks have incomplete information.</span>}</p>}
      {report.risk?.source_period_precision === "calendar_day" && <Info label="Source date precision"><p>The request uses the UTC times above. GFW labels its returned summary period by calendar day; those labels do not independently verify the exact hour of each source event. Inspect source event times before making a claim about a shorter interval.</p></Info>}
      <p>{flagged.length ? `${flagged.length} ${flagged.length === 1 ? "type of warning was" : "types of warning were"} reported. Each explanation below separates the source finding from what still needs verification.` : "No positive warning count was returned. Check missing information below before drawing conclusions."}</p>
      <p className="evidence-limit">These checks cover this boat's activity during the report dates, wherever it occurred. A flag is not automatically an incident inside your selected area.</p>
      {flagged.map(row => <div className="finding" key={row.code}><IndicatorExplanation indicator={row} />{row.code === "iuu_listing" ? <ListingEvidence report={report} /> : <SourceEventDetails report={report} indicator={row} area={area} />}</div>)}
      {report.warnings.map(warning => <p className="notice" key={warning}>{warning}</p>)}
      <Info label="What warning signs mean"><p>These are reasons to look more closely, not proof of wrongdoing. Radio gaps can also happen because of poor signal coverage. Missing permit records do not always mean a boat lacks permission. A count of zero or unavailable information does not prove that a boat is safe.</p><p>These checks do not measure the number of fish left in the sea and cannot prove overfishing.</p></Info>
    </section>

    {/* Every check and its result: amber for a warning, grey where no usable result came back. */}
    <section className="report-section">
      <h4 className="section-label">All check counts and missing information</h4>
      <table className="check-table"><tbody>{report.indicators.map(row => {
        const status = indicatorNarrative(row).status;
        return <tr key={row.code}><td>{warningNames[row.code] ?? row.label}</td><td className={`num ${status === "flagged" ? "state-review" : status === "unavailable" ? "state-missing" : "state-clear"}`}><strong>{row.count_is_lower_bound ? "at least " : ""}{row.count === null ? "Unavailable" : row.count}</strong></td></tr>;
      })}</tbody></table>
      {anyUnavailable && <p className="stat-note">Unavailable means no usable result was returned. It was not counted as a clean check.</p>}
    </section>

    {/* The boat's identifiers and record details, folded away until needed. */}
    <details className="report-section collapsible"><summary>Vessel identity</summary>
      <dl className="kv identity-details"><dt>Radio ID (MMSI) / ship ID (IMO)</dt><dd className="mono">{s.mmsi ?? "Unavailable"} / {s.imo ?? "Unavailable"}</dd><dt>Registered country</dt><dd>{s.flag ?? "Not reported"}</dd><dt>Boat type</dt><dd>{shipNames[shipKind(s.vessel_type)]}</dd><dt>Reported length</dt><dd>{s.length_m ? `${s.length_m.toFixed(1)} m` : "Not reported"}</dd><dt>Identity records</dt><dd>{documentationNames[s.documentation] ?? s.documentation.replaceAll("_", " ")}</dd><dt>Public permit records</dt><dd className="mono">{s.public_authorization_records.length}</dd></dl>
    </details>

    {/* The original records behind this report. */}
    <details className="report-section collapsible"><summary>Supporting evidence</summary>
      <details className="raw"><summary>Identity and authorization evidence</summary><pre>{JSON.stringify(report.identity, null, 2)}</pre></details>
      <details className="raw"><summary>Risk evidence</summary><pre>{JSON.stringify(report.insights, null, 2)}</pre></details>
    </details>

    <section className="report-section report-sources"><h4 className="section-label">Data sources</h4><p className="stat-note">{report.sources.join("; ")}</p></section>
  </div>;
}
