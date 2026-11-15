import { useCallback, useEffect, useRef, useState } from "react";
import { checkBackendConnection, fetchHistoricalArea, fetchHistoricalVessel, type ActivityCell, type Area, type HistoricalAreaResult, type HistoricalEvidence, type HistoricalQuery, type HistoricalVessel } from "../api/historical";
import { CaseMap } from "./CaseMap";
import { formatTime } from "../format";
import { ShipSymbol } from "./ShipSymbol";
import { ForecastPanel } from "./ForecastPanel";
import { ForecastEvidence } from "./ForecastEvidence";
import type { ForecastResult } from "../api/forecast";
import type { ForecastComparison, ActivityArrow } from "../forecastMap";
import { ActivityFilterControls } from "./ActivityFilterControls";
import type { ActivityFilters } from "../api/historical";
import { Info } from "./Info";
import { useHistoricalWorkspace } from "../HistoricalWorkspace";
import { VesselEvidence } from "./VesselEvidence";
import { LoadingStatus, Skeleton } from "./Loading";
import { activityUnits } from "../activityMap";
import { shipKind, shipNames } from "../vesselSymbols";

export function GfwOverview({ onInvestigations }: { onInvestigations?: () => void } = {}) {
  const workspace = useHistoricalWorkspace();
  const publishResult = workspace?.setResult;
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [noticeTarget, setNoticeTarget] = useState<HTMLDivElement | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [forecastBounds, setForecastBounds] = useState<Area | null>(null);
  const [forecastResult, setForecastResult] = useState<ForecastResult | null>(null);
  const [forecastComparison, setForecastComparison] = useState<ForecastComparison | null>(null);
  const [forecastArrow, setForecastArrow] = useState<ActivityArrow | null>(null);
  const [evidenceView, setEvidenceView] = useState<"vessel" | "forecast" | "activity">("vessel");
  const evidenceViewRef = useRef(evidenceView);
  evidenceViewRef.current = evidenceView;
  const [layer, setLayer] = useState<HistoricalQuery["layer"]>("presence");
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [hoursAgo, setHoursAgo] = useState(100);
  const [windowHours, setWindowHours] = useState(24);
  const [result, setResult] = useState<HistoricalAreaResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryPhase, setQueryPhase] = useState<"connection" | "reports">("connection");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<HistoricalVessel | null>(null);
  const [evidence, setEvidence] = useState<HistoricalEvidence | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [cell, setCell] = useState<ActivityCell | null>(null);
  const [retry, setRetry] = useState(0);
  const [allowLand, setAllowLand] = useState(false);
  const [page, setPage] = useState(0);
  const detailVersion = useRef(0);
  const ignoreCaseSelect = useCallback(() => {}, []);
  useEffect(() => { publishResult?.(result); }, [result, publishResult]);
  const handleSelecting = useCallback((active: boolean) => {
    if (active && !selected) setRightOpen(false);
  }, [selected]);

  const showForecastReasoning = useCallback(() => { setEvidenceView("forecast"); setRightOpen(true); setLeftOpen(false); }, []);
  const handleForecast = useCallback((data: ForecastResult | null) => {
    setForecastResult(data); setForecastArrow(null);
    if (data) { setEvidenceView("forecast"); setRightOpen(true); setLeftOpen(false); }
    else if (evidenceViewRef.current === "forecast") { setEvidenceView("vessel"); setRightOpen(false); }
  }, []);
  const handleForecastArrow = useCallback((arrow: ActivityArrow) => { setForecastArrow(arrow); setEvidenceView("forecast"); setRightOpen(true); setLeftOpen(false); }, []);

  useEffect(() => {
    let active = true;
    detailVersion.current++;
    setPage(0);
    setResult(null); setEvidence(null); setSelected(null); setCell(null); setError(""); setDetailError(""); setDetailLoading(false); setRightOpen(false);
    if (!area) { setLoading(false); return; }
    setLoading(true);
    setQueryPhase("connection");
    checkBackendConnection().then(() => {
      if (!active) return null;
      setQueryPhase("reports");
      return fetchHistoricalArea({ ...area, ...filters, mode: "gfw", layer, hours_ago: hoursAgo, window_hours: windowHours, ...(allowLand ? { allow_land: true } : {}) });
    })
      .then((data) => { if (active && data) setResult(data); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [area, layer, hoursAgo, windowHours, retry, allowLand, filters]);

  useEffect(() => () => { detailVersion.current++; }, []);

  const ordered = result?.vessels ?? [];
  const pageCount = Math.max(1, Math.ceil(ordered.length / 50));
  const visible = ordered.slice(Math.min(page, pageCount - 1) * 50, (Math.min(page, pageCount - 1) + 1) * 50);

  async function inspect(vessel: HistoricalVessel) {
    const version = ++detailVersion.current;
    setEvidenceView("vessel"); setSelected(vessel); setEvidence(null); setDetailError(""); setDetailLoading(true); setRightOpen(true); setLeftOpen(false);
    try {
      const data = await fetchHistoricalVessel(vessel.vessel_id, { mode: "gfw", hours_ago: hoursAgo, window_hours: windowHours, ...(result ? { start: result.start, end: result.end } : {}) });
      if (detailVersion.current === version) {
        setEvidence(data);
        setRightOpen(true); setLeftOpen(false);
        workspace?.saveReport(data);
        if (data.summary.length_m) setResult((previous) => previous ? { ...previous, vessels: previous.vessels.map((row) => row.vessel_id === vessel.vessel_id ? { ...row, length_m: data.summary.length_m } : row) } : previous);
      }
    } catch (e) { if (detailVersion.current === version) setDetailError(e instanceof Error ? e.message : String(e)); }
    finally { if (detailVersion.current === version) setDetailLoading(false); }
  }

  return <div className={`dash gfw-overview ${leftOpen ? "left-open" : "left-closed"} ${rightOpen ? "right-open" : "right-closed"}`}>
    <div className="workspace-notices" ref={setNoticeTarget} />
    {loading && <div className="area-query-loading"><LoadingStatus label={queryPhase === "connection" ? "Connecting to the backend…" : "Loading selected-area activity and vessels…"} detail={queryPhase === "reports" ? "GFW reports run sequentially. You can keep using the globe or choose a different area." : "Checking the connection before requesting GFW data."} /><div className="loading-track" aria-hidden="true" /></div>}
    <div className="globe-stage">
    <div className="drawer-slot left-slot"><button type="button" className="drawer-bookmark left-bookmark" aria-expanded={leftOpen} aria-controls="forecast-drawer" onClick={() => { setLeftOpen(value => !value); if (!leftOpen) setRightOpen(false); }}>{leftOpen ? "‹ Forecast" : "› Forecast"}</button>
    <aside id="forecast-drawer" className="panel side-drawer" inert={!leftOpen}><ForecastPanel area={area} onBoundsChange={setForecastBounds} onForecastChange={handleForecast} onComparisonChange={setForecastComparison} onShowReasoning={showForecastReasoning} /></aside></div>

    <section className="panel map-panel"><CaseMap groups={[]} selectedId={null} onSelect={ignoreCaseSelect} area={area} onAreaChange={setArea} activityCells={result?.cells ?? []} activityLayer={layer} onActivitySelect={value => { setEvidenceView("activity"); setCell(value); setRightOpen(true); setLeftOpen(false); }} forecastBounds={forecastBounds} forecastComparison={forecastComparison} onForecastArrowSelect={handleForecastArrow} selectedForecastArrow={forecastArrow} onSelectingChange={handleSelecting} noticeTarget={noticeTarget} /></section>

    <div className="drawer-slot right-slot"><button type="button" className="drawer-bookmark right-bookmark" aria-expanded={rightOpen} aria-controls="evidence-drawer" onClick={() => { setRightOpen(value => !value); if (!rightOpen) setLeftOpen(false); }}>{rightOpen ? "Evidence ›" : "Evidence ‹"}</button>
    <aside id="evidence-drawer" className="panel case-panel side-drawer" aria-live="polite" aria-busy={evidenceView === "vessel" && detailLoading} inert={!rightOpen}><div className="panel-head"><h2>{evidenceView === "forecast" ? "Forecast reasoning" : evidenceView === "activity" ? "Activity square" : selected?.name ?? "Vessel evidence"}</h2>{(selected || forecastResult || cell) && <button type="button" onClick={() => { if (evidenceView === "vessel") { detailVersion.current++; setSelected(null); setEvidence(null); setDetailLoading(false); setDetailError(""); } setRightOpen(false); }}>Close report</button>}</div>
      {(forecastResult || selected || cell) && <div className="evidence-view-tabs" role="group" aria-label="Evidence type">{forecastResult && <button type="button" aria-pressed={evidenceView === "forecast"} onClick={() => setEvidenceView("forecast")}>Forecast</button>}{selected && <button type="button" aria-pressed={evidenceView === "vessel"} onClick={() => setEvidenceView("vessel")}>Boat report</button>}{cell && <button type="button" aria-pressed={evidenceView === "activity"} onClick={() => setEvidenceView("activity")}>Activity square</button>}</div>}
      {evidenceView === "forecast" && forecastResult && <ForecastEvidence forecast={forecastResult} comparison={forecastComparison} arrow={forecastArrow} />}
      {evidenceView === "vessel" && !selected && !cell && <p className="empty">Choose a boat from the list below to see its identity, available permits and reasons it may need review.</p>}
      {evidenceView === "activity" && cell && <div className="block"><h3>Selected activity square</h3><p><strong>{Number(cell.value).toLocaleString(undefined, { maximumFractionDigits: 2 })} {activityUnits[layer]}</strong></p><p>Near {Number(cell.lat).toFixed(2)}°, {Number(cell.lon).toFixed(2)}°</p>{result && <p>{formatTime(result.start)} → {formatTime(result.end)}</p>}<p>Boats reported: {cell.vessel_count_lower_bound != null ? `at least ${cell.vessel_count_lower_bound}` : "count not available"}.</p><Info label="What this square means"><p>This is an approximate area where activity was recorded, not a single boat. One boat seen for two hours and two boats seen for one hour each can both contribute two boat-hours. The boat list below covers your entire selection; it does not tell us which boats used this square.</p></Info></div>}
      {evidenceView === "vessel" && detailLoading && <><LoadingStatus label="Retrieving vessel evidence…" detail="Loading identity, authorization records and risk insights." /><Skeleton /></>}
      {evidenceView === "vessel" && detailError && <p className="notice error" role="alert">{detailError}</p>}
      {evidenceView === "vessel" && evidence && <VesselEvidence report={evidence} />}
    </aside></div>
    </div>

    <section className="panel stats"><div className="panel-head"><h2>Your selected area · past activity</h2></div><div className="stat-row"><div className="stat"><strong>{result ? result.cells.length : "—"}</strong><Info label="Activity squares"><p>Activity squares (also called activity cells) are small map areas, not exact boat locations. They combine activity during your chosen time. One square can contain several boats, or the same boat at different times.</p></Info></div><div className="stat"><strong>{result ? result.vessels.length : "—"}</strong><Info label="Boats in this area"><p>Area-associated vessels means boat identities reported somewhere in your selected area during your chosen time. The list does not locate each boat inside an individual activity square. Radar sightings without a known identity are not listed as identified boats.</p></Info></div></div>{result && <p className="stat-note">{formatTime(result.start)} → {formatTime(result.end)} · {result.dataset}</p>}
      {result?.land_check && <p className="stat-note">{result.land_check.land_fraction !== null ? `Conservative land estimate: ${(result.land_check.land_fraction * 100).toFixed(1)}%. ` : ""}{result.skipped ? "Skipped before GFW queries: over 75% land. Choose a water-focused area or override the estimate. " : ""}{result.land_check.note}</p>}
    </section>

    <section className="panel list-panel" aria-live="polite" aria-busy={loading}><div className="panel-head"><h2>Boats in your selected area</h2>{loading && <span className="loading-spinner" aria-hidden="true" />}</div>
      {loading && <Skeleton variant="table" label="Loading area-associated vessels" />}
      {error && <div className="notice error" role="alert">{error}</div>}
      {!!result?.vessels.length && <div className="overview-investigation-link"><div><strong>Ready to review {result.vessels.length} boats</strong><p>Open Investigations to screen the whole area for warning signs and review full reports.</p></div><button type="button" className="primary" onClick={onInvestigations}>Investigate selected boats</button></div>}
      {!area && <p className="empty">Click Select area on the globe and draw a small rectangle. That selection now triggers a GFW query.</p>}
      {result && result.vessels.length === 0 && <p className="empty">{result.skipped ? "Area skipped because it exceeds the land threshold. No GFW reports were requested." : layer === "sar" ? "SAR cells are not assigned vessel IDs by this area view. Unmatched detections have no established identity." : "No vessel IDs returned for this area and window. This does not prove no boats were present."}</p>}
      {!!result?.vessels.length && <><div className="table-scroll"><table className="case-table"><thead><tr><th>Vessel</th><th>MMSI</th><th>Type</th><th>Reported length</th><th>Time seen (hours)</th><th>Evidence</th></tr></thead><tbody>{visible.map((vessel) => <tr key={vessel.vessel_id} className={selected?.vessel_id === vessel.vessel_id ? "selected" : undefined}><td>{vessel.name}</td><td>{vessel.mmsi ?? "Unavailable"}</td><td><ShipSymbol type={vessel.vessel_type} /> {shipNames[shipKind(vessel.vessel_type)]}</td><td>{vessel.length_m ? `${vessel.length_m.toFixed(1)} m` : "Unknown"}</td><td>{vessel.hours.toFixed(2)}</td><td><button type="button" onClick={() => void inspect(vessel)}>Inspect vessel</button></td></tr>)}</tbody></table></div><div className="risk-toolbar"><button disabled={page <= 0} onClick={() => setPage((previous) => previous - 1)}>Previous</button><span>{ordered.length} matching vessels · page {Math.min(page, pageCount - 1) + 1} / {pageCount}</span><button disabled={page >= pageCount - 1} onClick={() => setPage((previous) => previous + 1)}>Next</button></div></>}
    </section>
    <aside id="area-controls" className="panel area-controls"><div className="panel-head"><h2>Area controls</h2></div><div className="filter-body">
      <Info label="Getting started"><p>Choose Select area, then draw a box over the water. Green areas show where boats were active during your chosen time. Zoom in to explore smaller activity squares, then open a boat's report from the list below.</p><p>These are past observations, not live tracking. Boat-radio data is at least 100 hours old; satellite radar data is at least 124 hours old.</p></Info>
      <button type="button" onClick={() => { setLeftOpen(true); setRightOpen(false); document.querySelector(".globe-stage")?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }}>Open ML fishing forecast</button>
      <ActivityFilterControls key={layer} layer={layer} onApply={setFilters} />
      <label className="filter"><span>Activity layer</span><select value={layer} onChange={(e) => { const next = e.target.value as HistoricalQuery["layer"]; setLayer(next); setFilters({}); if (next === "sar") setHoursAgo((previous) => Math.max(124, previous)); }}><option value="presence">All boat activity</option><option value="fishing">Possible fishing activity</option><option value="sar">Satellite radar sightings</option></select></label>
      <Info label="Where the data comes from"><p>AIS is a radio system boats use to broadcast their identity and location. GFW uses those signals to estimate boat activity and possible fishing. SAR is satellite radar, which can spot objects on the water even without a boat's radio signal. A radar sighting does not always identify the boat.</p></Info>
      <Info label="Boat symbols"><div className="ship-symbol-key">{["fishing", "cargo", "carrier", "tanker", "passenger", "tug", "unknown"].map(type => <span key={type}><ShipSymbol type={type} />{shipNames[shipKind(type)]}</span>)}</div><p>Symbols in the boat list show the reported type. Gray means the type was not supplied. Type and color do not tell us whether a boat is allowed to fish.</p></Info>
      <label className="filter"><span>Window ends (hours ago)</span><input type="number" min={layer === "sar" ? 124 : 100} max={8760} value={hoursAgo} onChange={(e) => setHoursAgo(Number(e.target.value))} /></label>
      <label className="filter"><span>Window duration</span><select value={windowHours} onChange={(e) => setWindowHours(Number(e.target.value))}><option value={1}>1 hour</option><option value={24}>24 hours</option><option value={168}>7 days</option></select></label>
      <label className="filter"><span><input type="checkbox" checked={allowLand} onChange={(e) => setAllowLand(e.target.checked)} /> Override land estimate (small/unmapped waterways)</span></label>
      <button type="button" disabled={!area || loading} onClick={() => setRetry((previous) => previous + 1)}>Refresh selected area</button>
      <details><summary>Area coordinates</summary>{(["west", "south", "east", "north"] as const).map((key) => <label className="filter" key={key}><span>{key}</span><input type="number" step="0.1" value={area?.[key] ?? ""} onChange={(e) => setArea((previous) => ({ ...(previous ?? { west: -5, south: 1, east: 3, north: 7 }), [key]: Number(e.target.value) }))} /></label>)}</details>
    </div></aside>
  </div>;
}
