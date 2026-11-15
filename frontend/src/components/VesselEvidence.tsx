import type { HistoricalEvidence } from "../api/historical";
import { Info } from "./Info";
import { ShipSymbol } from "./ShipSymbol";
import { shipKind, shipNames } from "../vesselSymbols";
import { warningNames } from "../vesselLanguage";
import { IndicatorExplanation, SourceEventDetails, ListingEvidence } from "./RiskExplanation";
import { indicatorNarrative } from "../evidenceNarrative";
import { useHistoricalWorkspace } from "../HistoricalWorkspace";
const documentationNames: Record<string, string> = { public_registry_record_found: "Public registration record found", ais_identity_only: "Identity reported by boat radio only", no_identity_record: "No identity record returned" };

export function VesselEvidence({ report }: { report: HistoricalEvidence }) {
  const s = report.summary;
  const workspace = useHistoricalWorkspace();
  const selection = workspace?.result;
  const area = selection && Date.parse(selection.start) === Date.parse(report.start) && Date.parse(selection.end) === Date.parse(report.end) ? selection.bounds : undefined;
  const flagged = report.indicators.filter(row => indicatorNarrative(row).status === "flagged");
  return <div className="vessel-evidence">
    <div className="block"><div className="vessel-report-title"><ShipSymbol type={s.vessel_type} /><div><h3>{s.name}</h3><span>{shipNames[shipKind(s.vessel_type)]}</span></div></div>
      {/* The boat's ID numbers and record details, folded into one label so the decision below comes first. */}
      <Info label="Boat identity details"><dl className="identity-details"><dt>Report dates</dt><dd>{report.start.slice(0, 10)} to {report.end.slice(0, 10)}</dd><dt>Boat radio ID (MMSI) / ship ID (IMO)</dt><dd>{s.mmsi ?? "Unavailable"} / {s.imo ?? "Unavailable"}</dd><dt>Registered country / boat type</dt><dd>{s.flag ?? "Unavailable"} / {shipNames[shipKind(s.vessel_type)]}</dd><dt>Reported length</dt><dd>{s.length_m ? `${s.length_m.toFixed(1)} m` : "Not reported"}</dd><dt>Identity records</dt><dd>{documentationNames[s.documentation] ?? s.documentation.replaceAll("_", " ")}</dd><dt>Public permit records</dt><dd>{s.public_authorization_records.length}</dd></dl></Info>
      <p><strong>Authorization: {report.authorization.status}</strong></p><p>{report.authorization.explanation}</p>
      <Info label="Identity and permits"><p>MMSI identifies a boat's radio. IMO is a permanent ship identification number when one has been assigned. A flag identifies the country where a boat is registered.</p><p>Authorization means permission to do a specific activity in a place and time. Unknown means we do not have enough permit evidence to decide. A public registration record identifies a boat; it does not by itself give permission to fish.</p></Info>
    </div>
    <div className="block"><h3>What needs a closer look</h3><p>{flagged.length ? `${flagged.length} types of warning were reported. Each explanation below separates the source finding from what still needs verification.` : "No positive warning count was returned. Check missing information below before drawing conclusions."}</p>
      <p className="evidence-limit">These checks cover this boat's activity during the report dates, wherever it occurred. A flag is not automatically an incident inside your selected area.</p>
      {flagged.map(row => <div key={row.code}><IndicatorExplanation indicator={row} />{row.code === "iuu_listing" ? <ListingEvidence report={report} /> : <SourceEventDetails report={report} indicator={row} area={area} />}</div>)}
      <details className="remaining-checks"><summary>All check counts and missing information</summary>{report.indicators.map(row => <div key={row.code}><p>{warningNames[row.code] ?? row.label}: <strong>{row.count === null ? "Unavailable" : row.count}</strong></p>{indicatorNarrative(row).status === "unavailable" && <p>No usable result was returned. This was not counted as a clean check.</p>}</div>)}</details>
      {report.warnings.map(warning => <p key={warning}>{warning}</p>)}
      <Info label="What warning signs mean"><p>These are reasons to look more closely, not proof of wrongdoing. Radio gaps can also happen because of poor signal coverage. Missing permit records do not always mean a boat lacks permission. A count of zero or unavailable information does not prove that a boat is safe.</p><p>These checks do not measure the number of fish left in the sea and cannot prove overfishing.</p></Info>
    </div>
    <details className="raw"><summary>Identity and authorization evidence</summary><pre>{JSON.stringify(report.identity, null, 2)}</pre></details>
    <details className="raw"><summary>Risk evidence</summary><pre>{JSON.stringify(report.insights, null, 2)}</pre></details>
    <p className="stat-note">{report.sources.join("; ")}</p>
  </div>;
}
