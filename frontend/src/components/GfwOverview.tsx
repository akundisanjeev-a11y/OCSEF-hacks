import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHistoricalArea, fetchHistoricalVessel, screenHistoricalRisks, type VesselRisk, type ActivityCell, type Area, type HistoricalAreaResult, type HistoricalEvidence, type HistoricalQuery, type HistoricalVessel } from "../api/historical";
import { CaseMap } from "./CaseMap";
import { formatTime } from "../format";

export function GfwOverview() {
  const [area, setArea] = useState<Area | null>(null);
  const [layer, setLayer] = useState<HistoricalQuery["layer"]>("presence");
  const [hoursAgo, setHoursAgo] = useState(100);
  const [windowHours, setWindowHours] = useState(24);
  const [result, setResult] = useState<HistoricalAreaResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<HistoricalVessel | null>(null);
  const [evidence, setEvidence] = useState<HistoricalEvidence | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [cell, setCell] = useState<ActivityCell | null>(null);
  const [retry, setRetry] = useState(0);
  const [allowLand, setAllowLand] = useState(false);
  const [risks, setRisks] = useState<Record<string, VesselRisk>>({});
  const [screening, setScreening] = useState(false);
  const [screenError, setScreenError] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [page, setPage] = useState(0);
  const screenAbort = useRef<AbortController | null>(null);
  const screenVersion = useRef(0);
  const detailVersion = useRef(0);
  const ignoreCaseSelect = useCallback(() => {}, []);

  useEffect(() => {
    let active = true;
    detailVersion.current++;
    screenVersion.current++;
    screenAbort.current?.abort(); setScreening(false); setRisks({}); setScreenError(""); setRiskFilter("all"); setPage(0);
    setResult(null); setEvidence(null); setSelected(null); setCell(null); setError(""); setDetailError(""); setDetailLoading(false);
    if (!area) { setLoading(false); return; }
    setLoading(true);
    fetchHistoricalArea({ ...area, mode: "gfw", layer, hours_ago: hoursAgo, window_hours: windowHours, ...(allowLand ? { allow_land: true } : {}) })
      .then((data) => { if (active) setResult(data); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [area, layer, hoursAgo, windowHours, retry, allowLand]);

  useEffect(() => () => { detailVersion.current++; screenVersion.current++; screenAbort.current?.abort(); }, []);

  async function screenAll() {
    if (!result || screening) return;
    const version = ++screenVersion.current;
    const controller = new AbortController(); screenAbort.current = controller;
    setScreening(true); setScreenError(""); setRiskFilter("flagged"); setPage(0);
    const pending = result.vessels.filter((vessel) => !risks[vessel.vessel_id] || risks[vessel.vessel_id].error);
    try {
      for (let offset = 0; offset < pending.length; offset += 16) {
        if (controller.signal.aborted || screenVersion.current !== version) break;
        const batch = await screenHistoricalRisks(pending.slice(offset, offset + 16).map((vessel) => vessel.vessel_id), result.start, result.end, controller.signal);
        if (controller.signal.aborted || screenVersion.current !== version) break;
        setRisks((previous) => ({ ...previous, ...Object.fromEntries(batch.results.map((risk) => [risk.vessel_id, risk])) }));
        const providerError = batch.results.find((risk) => [401, 403, 429, 503].includes(risk.error_status ?? 0));
        if (providerError) { setScreenError(providerError.error ?? "Provider limit reached. Screening paused."); break; }
      }
    } catch (e) { if (!controller.signal.aborted && screenVersion.current === version) setScreenError(e instanceof Error ? e.message : String(e)); }
    finally { if (screenVersion.current === version) setScreening(false); }
  }

  const riskLabel = (risk?: VesselRisk) => !risk ? "Not checked" : risk.error ? "Check failed" : risk.state === "flagged" ? `Flagged (${risk.flag_count})` : risk.state === "no_flags" ? "No reported flags" : "Incomplete / unknown";
  const ordered = [...(result?.vessels ?? [])].filter((vessel) => riskFilter === "all" || (riskFilter === "unchecked" ? !risks[vessel.vessel_id] : risks[vessel.vessel_id]?.state === riskFilter))
    .sort((a, b) => (risks[b.vessel_id]?.flag_count ?? 0) - (risks[a.vessel_id]?.flag_count ?? 0));
  const pageCount = Math.max(1, Math.ceil(ordered.length / 50));
  const visible = ordered.slice(Math.min(page, pageCount - 1) * 50, (Math.min(page, pageCount - 1) + 1) * 50);

  async function inspect(vessel: HistoricalVessel) {
    const version = ++detailVersion.current;
    setSelected(vessel); setEvidence(null); setDetailError(""); setDetailLoading(true);
    try {
      const data = await fetchHistoricalVessel(vessel.vessel_id, { mode: "gfw", hours_ago: hoursAgo, window_hours: windowHours, ...(result ? { start: result.start, end: result.end } : {}) });
      if (detailVersion.current === version) setEvidence(data);
    } catch (e) { if (detailVersion.current === version) setDetailError(e instanceof Error ? e.message : String(e)); }
    finally { if (detailVersion.current === version) setDetailLoading(false); }
  }

  return <div className="dash gfw-overview">
    <aside className="panel filters"><div className="panel-head"><h2>GFW historical query</h2></div><div className="filter-body">
      <p className="muted">Selecting an area queries real GFW data. No fictional vessels are substituted.</p>
      <label className="filter"><span>Activity layer</span><select value={layer} onChange={(e) => { const next = e.target.value as HistoricalQuery["layer"]; setLayer(next); if (next === "sar") setHoursAgo((previous) => Math.max(124, previous)); }}><option value="presence">AIS vessel presence</option><option value="fishing">Apparent fishing</option><option value="sar">Unmatched SAR detections</option></select></label>
      <label className="filter"><span>Window ends (hours ago)</span><input type="number" min={layer === "sar" ? 124 : 100} max={8760} value={hoursAgo} onChange={(e) => setHoursAgo(Number(e.target.value))} /></label>
      <label className="filter"><span>Window duration</span><select value={windowHours} onChange={(e) => setWindowHours(Number(e.target.value))}><option value={1}>1 hour</option><option value={24}>24 hours</option><option value={168}>7 days</option></select></label>
      <p className="muted">Historical, not live. AIS uses a window ending at least 100 hours ago; SAR at least 124 hours ago.</p>
      <label className="filter"><span><input type="checkbox" checked={allowLand} onChange={(e) => setAllowLand(e.target.checked)} /> Override land estimate (small/unmapped waterways)</span></label>
      <button type="button" onClick={() => setArea({ west: -5, south: 1, east: 3, north: 7 })}>Query Gulf of Guinea area</button>
      <button type="button" disabled={!area || loading} onClick={() => setRetry((previous) => previous + 1)}>Refresh selected area</button>
      <details><summary>Area coordinates</summary>{(["west", "south", "east", "north"] as const).map((key) => <label className="filter" key={key}><span>{key}</span><input type="number" step="0.1" value={area?.[key] ?? ""} onChange={(e) => setArea((previous) => ({ ...(previous ?? { west: -5, south: 1, east: 3, north: 7 }), [key]: Number(e.target.value) }))} /></label>)}</details>
    </div></aside>

    <section className="panel map-panel"><CaseMap groups={[]} selectedId={null} onSelect={ignoreCaseSelect} area={area} onAreaChange={setArea} activityCells={result?.cells ?? []} onActivitySelect={setCell} /></section>

    <aside className="panel case-panel" aria-live="polite"><div className="panel-head"><h2>{selected?.name ?? "Vessel evidence"}</h2></div>
      {!selected && <p className="empty">Select a vessel from the area list to retrieve identity, public authorization records and risk indicators.</p>}
      {cell && <div className="block"><h3>Selected activity cell</h3><p>{Number(cell.lat).toFixed(2)}, {Number(cell.lon).toFixed(2)} · {cell.value} {layer === "sar" ? "detections" : "hours"}</p><p>{cell.date}</p><small>Area vessels are not assigned to this individual cell.</small></div>}
      {detailLoading && <p className="empty">Retrieving vessel evidence…</p>}
      {detailError && <p className="notice error" role="alert">{detailError}</p>}
      {evidence && <><div className="block"><h3>{evidence.summary.name}</h3><p>MMSI: {evidence.summary.mmsi ?? "Unavailable"}<br />IMO: {evidence.summary.imo ?? "Unavailable"}<br />Type: {evidence.summary.vessel_type}<br />Flag: {evidence.summary.flag ?? "Unavailable"}</p><p>Documentation: {evidence.summary.documentation.replaceAll("_", " ")}</p><p>Public authorization records: {evidence.summary.public_authorization_records.length}</p><p><strong>Authorization: {evidence.authorization.status}</strong></p><p>{evidence.authorization.explanation}</p></div>
        <div className="block"><h3>Review indicators</h3>{evidence.indicators.map((indicator) => <p key={indicator.code}>{indicator.label}: <strong>{indicator.count === null ? "Unavailable" : indicator.count}</strong></p>)}{evidence.warnings.map((warning) => <p key={warning}>{warning}</p>)}<p className="muted">Missing or zero indicators do not establish authorization or low risk.</p></div>
        <details className="raw"><summary>Original identity and authorization evidence</summary><pre>{JSON.stringify(evidence.identity, null, 2)}</pre></details><details className="raw"><summary>Original risk evidence</summary><pre>{JSON.stringify(evidence.insights, null, 2)}</pre></details><p className="stat-note">{evidence.sources.join("; ")}</p></>}
    </aside>

    <section className="panel stats"><div className="panel-head"><h2>Selected area · historical evidence</h2></div><div className="stat-row"><div className="stat"><strong>{result ? result.cells.length : "—"}</strong><span>Activity cells</span></div><div className="stat"><strong>{result ? result.vessels.length : "—"}</strong><span>Area-associated vessels</span></div></div><p className="stat-note">Dots are 0.1° activity cells, not exact boat locations. Vessel IDs come from a separate report for the entire selected area.</p>{result && <p className="stat-note">{formatTime(result.start)} → {formatTime(result.end)} · {result.dataset}</p>}
      {result?.land_check && <p className="stat-note">{result.land_check.land_fraction !== null ? `Conservative land estimate: ${(result.land_check.land_fraction * 100).toFixed(1)}%. ` : ""}{result.skipped ? "Skipped before GFW queries: over 75% land. Choose a water-focused area or override the estimate. " : ""}{result.land_check.note}</p>}
    </section>

    <section className="panel list-panel" aria-live="polite"><div className="panel-head"><h2>Vessels associated with selected area</h2></div>
      {loading && <p className="empty">Querying GFW activity and vessel reports. This can take a while; reports run sequentially.</p>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {!!result?.vessels.length && <div className="risk-toolbar">
        <button type="button" className="primary" disabled={screening} onClick={() => void screenAll()}>{screening ? "Screening risks…" : "Screen vessel risks"}</button>
        {screening && <button type="button" onClick={() => screenAbort.current?.abort()}>Stop screening</button>}
        <span role="status">Checked {Object.keys(risks).length} / {result.vessels.length} · {Object.values(risks).filter((risk) => risk.state === "flagged").length} flagged · {Object.values(risks).filter((risk) => risk.state === "unknown").length} incomplete</span>
        <label>Show <select value={riskFilter} onChange={(e) => { setRiskFilter(e.target.value); setPage(0); }}><option value="all">All vessels</option><option value="flagged">Flagged</option><option value="no_flags">No reported flags</option><option value="unknown">Incomplete / failed</option><option value="unchecked">Not checked</option></select></label>
        <small>Checks only GFW risk indicators, four vessels at a time. Full identity reports load only when requested. No reported flags does not mean safe or authorized. Stop prevents further batches; an in-flight batch may finish.</small>
      </div>}
      {screenError && <p className="notice error" role="alert">{screenError}</p>}
      {!area && <p className="empty">Click Select area on the globe and draw a small rectangle. That selection now triggers a GFW query.</p>}
      {result && result.vessels.length === 0 && <p className="empty">{result.skipped ? "Area skipped because it exceeds the land threshold. No GFW reports were requested." : layer === "sar" ? "Unmatched SAR activity has no established vessel IDs." : "No vessel IDs returned for this area and window. This does not prove no boats were present."}</p>}
      {!!result?.vessels.length && <><div className="table-scroll"><table className="case-table"><thead><tr><th>Vessel</th><th>MMSI</th><th>Type</th><th>Activity hours</th><th>Risk screening</th><th>Evidence</th></tr></thead><tbody>{visible.map((vessel) => <tr key={vessel.vessel_id} className={selected?.vessel_id === vessel.vessel_id ? "selected" : undefined}><td>{vessel.name}</td><td>{vessel.mmsi ?? "Unavailable"}</td><td>{vessel.vessel_type}</td><td>{vessel.hours.toFixed(2)}</td><td><strong>{riskLabel(risks[vessel.vessel_id])}</strong>{risks[vessel.vessel_id]?.indicators.filter((indicator) => indicator.count !== null && indicator.count > 0).map((indicator) => <div className="small" key={indicator.code}>{indicator.label}: {indicator.count}</div>)}{risks[vessel.vessel_id]?.error && <div className="small">{risks[vessel.vessel_id].error}</div>}</td><td><button type="button" onClick={() => void inspect(vessel)}>Inspect vessel</button></td></tr>)}</tbody></table></div><div className="risk-toolbar"><button disabled={page <= 0} onClick={() => setPage((previous) => previous - 1)}>Previous</button><span>{ordered.length} matching vessels · page {Math.min(page, pageCount - 1) + 1} / {pageCount}</span><button disabled={page >= pageCount - 1} onClick={() => setPage((previous) => previous + 1)}>Next</button></div></>}
    </section>
  </div>;
}
