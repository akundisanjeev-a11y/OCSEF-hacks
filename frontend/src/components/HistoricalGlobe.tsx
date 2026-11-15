import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import type * as GeoJSON from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import "../mapWorker";
import { request } from "../api/client";
import { lengthScale, makeMapSymbol, shipKind } from "../vesselSymbols";
import type { ActivityCell } from "../api/historical";


type Area = { west: number; south: number; east: number; north: number };
type Query = Area & { mode: "synthetic" | "gfw"; layer: "presence" | "fishing" | "sar"; hours_ago: number; window_hours: number };
type Cell = ActivityCell;
type Vessel = { vessel_id: string; name: string; mmsi: string | null; vessel_type: string; hours: number };
type AreaResult = { cells: Cell[]; vessels: Vessel[]; mode: Query["mode"]; layer: Query["layer"]; start: string; end: string; notes: string[]; dataset: string };
type Enrichment = { mode: Query["mode"]; vessel_id: string; start: string; end: string; identity: Record<string, unknown>; insights: Record<string, unknown>; authorization: { status: string; explanation: string }; sources: string[]; warnings: string[];
  summary: { name: string; mmsi: string | null; imo: string | null; flag: string | null; vessel_type: string; documentation: string; public_authorization_records: unknown[]; identity_note: string };
  indicators: { code: string; label: string; count: number | null; event_ids: string[] }[] };
type ScreenPoint = { x: number; y: number };
const ghana: Area = { west: -5, south: 1, east: 3, north: 7 };
const initial: Query = { ...ghana, mode: "synthetic", layer: "presence", hours_ago: 100, window_hours: 24 };
const jsonPost = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const emptyGeoJSON = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });
const dateLabel = (value: string) => new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export function HistoricalGlobe() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [query, setQuery] = useState<Query>(initial);
  const [result, setResult] = useState<AreaResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [rectangle, setRectangle] = useState<{ start: ScreenPoint; end: ScreenPoint } | null>(null);
  const startPoint = useRef<ScreenPoint | null>(null);
  const [cell, setCell] = useState<Cell | null>(null);
  const [detail, setDetail] = useState<Enrichment | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const generation = useRef(0);
  const detailGeneration = useRef(0);

  useEffect(() => {
    if (!container.current) return;
    let instance: maplibregl.Map;
    try {
      instance = new maplibregl.Map({ container: container.current, style: "https://demotiles.maplibre.org/style.json",
        center: [-12, 10], zoom: 1.4, attributionControl: { compact: true }, renderWorldCopies: false });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown rendering error";
      setMapError(`Globe initialization failed: ${reason}. This is separate from GFW authentication. Area coordinate queries remain available.`);
      return;
    }
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl(), "top-right");
    instance.boxZoom.disable();
    instance.on("styleimagemissing", (event) => {
      const image = makeMapSymbol(event.id);
      if (image && !instance.hasImage(event.id)) instance.addImage(event.id, image, { pixelRatio: 2 });
    });
    instance.on("load", () => {
      instance.setProjection({ type: "globe" });
      instance.addSource("activity", { type: "geojson", data: emptyGeoJSON(), cluster: true, clusterRadius: 44, clusterMaxZoom: 9 });
      instance.addSource("selection", { type: "geojson", data: emptyGeoJSON() });
      instance.addLayer({ id: "selection-fill", type: "fill", source: "selection", paint: { "fill-color": "#24d7c3", "fill-opacity": .1 } });
      instance.addLayer({ id: "selection-edge", type: "line", source: "selection", paint: { "line-color": "#24d7c3", "line-width": 2 } });
      instance.addLayer({ id: "activity-dots", type: "symbol", source: "activity", layout: {
        "icon-image": ["case", ["has", "point_count"], ["concat", "fleet-cluster-", ["to-string", ["get", "point_count"]]], ["get", "symbol_id"]],
        "icon-size": ["coalesce", ["get", "symbol_scale"], 1], "icon-allow-overlap": true,
      } });
      instance.on("click", "activity-dots", (event) => {
        const feature = event.features?.[0];
        if (feature?.properties.cluster_id !== undefined && feature.geometry.type === "Point") {
          const center = feature.geometry.coordinates as [number, number];
          void (instance.getSource("activity") as GeoJSONSource).getClusterExpansionZoom(Number(feature.properties.cluster_id)).then((zoom) => instance.easeTo({ center, zoom }));
          return;
        }
        const properties = event.features?.[0]?.properties;
        if (properties) setCell(properties as Cell);
      });
      instance.on("mouseenter", "activity-dots", () => { instance.getCanvas().style.cursor = "pointer"; });
      instance.on("mouseleave", "activity-dots", () => { instance.getCanvas().style.cursor = ""; });
      setReady(true);
    });
    instance.on("error", (event) => setMapError(`Globe resource error: ${event.error?.message ?? "a map resource could not load"}. This is separate from GFW authentication.`));
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: (result?.cells ?? []).map((point) => ({ type: "Feature", properties: { ...point,
      symbol_id: `fleet-cell-${shipKind(point.vessel_type)}-${point.vessel_count_lower_bound != null ? "lower" + point.vessel_count_lower_bound : "unknown"}`,
      symbol_scale: lengthScale(point.mean_length_m),
    }, geometry: { type: "Point", coordinates: [point.lon, point.lat] } })) };
    (map.current.getSource("activity") as GeoJSONSource).setData(data);
  }, [ready, result]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const { west: w, east: e, north: n, south: s } = query;
    (map.current.getSource("selection") as GeoJSONSource).setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }] });
    if (selecting) map.current.dragPan.disable(); else map.current.dragPan.enable();
  }, [ready, query, selecting]);

  function update(values: Partial<Query>) {
    generation.current++; detailGeneration.current++;
    setLoading(false); setDetailLoading(false);
    setQuery((previous) => ({ ...previous, ...values }));
    setResult(null); setCell(null); setDetail(null); setSelectedId(null); setError(""); setDetailError("");
  }

  async function scan(next = query) {
    const current = ++generation.current;
    detailGeneration.current++;
    setQuery(next); setLoading(true); setResult(null); setDetail(null); setCell(null); setSelectedId(null); setError(""); setDetailError(""); setDetailLoading(false);
    try {
      const data = await request<AreaResult>("/historical/area", jsonPost(next));
      if (generation.current === current) setResult(data);
    } catch (e) { if (generation.current === current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (generation.current === current) setLoading(false); }
  }

  async function inspect(vessel: Vessel) {
    const current = ++detailGeneration.current;
    setSelectedId(vessel.vessel_id); setDetail(null); setDetailError(""); setDetailLoading(true);
    try {
      const value = await request<Enrichment>("/historical/vessel", jsonPost({ mode: query.mode, vessel_id: vessel.vessel_id, hours_ago: query.hours_ago, window_hours: query.window_hours }));
      if (detailGeneration.current === current) setDetail(value);
    } catch (e) { if (detailGeneration.current === current) setDetailError(e instanceof Error ? e.message : String(e)); }
    finally { if (detailGeneration.current === current) setDetailLoading(false); }
  }

  function screenPoint(event: React.PointerEvent): ScreenPoint {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function finishSelection(event: React.PointerEvent) {
    const start = startPoint.current;
    if (!start || !map.current) return;
    startPoint.current = null; setRectangle(null); setSelecting(false);
    const end = screenPoint(event);
    if (Math.abs(start.x - end.x) < 8 || Math.abs(start.y - end.y) < 8) return;
    const a = map.current.unproject([start.x, start.y]);
    const b = map.current.unproject([end.x, end.y]);
    const area = { west: Math.min(a.lng, b.lng), east: Math.max(a.lng, b.lng), south: Math.min(a.lat, b.lat), north: Math.max(a.lat, b.lat) };
    if (!Object.values(area).every(Number.isFinite) || area.east - area.west > 40 || area.north - area.south > 30 || area.south < -85 || area.north > 85) {
      setError("Zoom in and select a smaller area on the globe surface (maximum 40° × 30°). Date-line crossings must be split."); return;
    }
    void scan({ ...query, ...area });
  }

  return <div className="historical-workspace">
    <div className="globe-heading"><div><span className="globe-kicker">GHOSTFLEET / OCEAN INTELLIGENCE</span><h1>Explore the ocean. Follow the evidence.</h1><p>Historical activity, vessel identities and sourced risk indicators.</p></div><span className="historical-badge">HISTORICAL · NOT LIVE</span></div>
    <div className="globe-controls">
      <label>Data source<select value={query.mode} disabled={loading} onChange={(e) => update({ mode: e.target.value as Query["mode"] })}><option value="synthetic">Fictional walkthrough</option><option value="gfw">Global Fishing Watch</option></select></label>
      <label>Activity layer<select value={query.layer} disabled={loading} onChange={(e) => update({ layer: e.target.value as Query["layer"], hours_ago: e.target.value === "sar" ? Math.max(124, query.hours_ago) : query.hours_ago })}><option value="presence">AIS vessel presence</option><option value="fishing">Apparent fishing</option><option value="sar">SAR unmatched to AIS</option></select></label>
      <label>Window ends (hours ago)<input type="number" min={query.layer === "sar" ? 124 : 100} max={8760} value={query.hours_ago} onChange={(e) => update({ hours_ago: Number(e.target.value) })} /></label>
      <label>Window duration<select value={query.window_hours} onChange={(e) => update({ window_hours: Number(e.target.value) })}><option value={1}>1 hour</option><option value={24}>24 hours</option><option value={168}>7 days</option></select></label>
      <button type="button" className="primary" disabled={loading} onClick={() => void scan()}>{loading ? "Scanning area…" : "Scan selected area"}</button>
    </div>
    <div className={`globe-notice ${query.mode === "synthetic" ? "fictional" : ""}`} role="status">{query.mode === "synthetic" ? "FICTIONAL WALKTHROUGH — example activity off Ghana; no real vessel identities or authorization claims." : "GFW HISTORICAL DATA — dots are activity cells, not exact boats. Results depend on dataset coverage and availability."}</div>
    <div className="globe-layout">
      <section className="globe-panel">
        <div className="globe-map-toolbar"><button type="button" aria-pressed={selecting} onClick={() => setSelecting(!selecting)}>{selecting ? "Drag a rectangle now" : "Select area by dragging"}</button><button type="button" onClick={() => { update(ghana); map.current?.flyTo({ center: [-1, 4], zoom: 4 }); }}>Gulf of Guinea</button><button type="button" onClick={() => map.current?.flyTo({ center: [-12, 10], zoom: 1.4 })}>Globe view</button></div>
        <div className={`globe-map-wrap ${selecting ? "is-selecting" : ""}`} onPointerDownCapture={(event) => {
          if (!selecting) return;
          event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
          startPoint.current = screenPoint(event); setRectangle({ start: startPoint.current, end: startPoint.current });
        }} onPointerMove={(event) => { if (startPoint.current) setRectangle({ start: startPoint.current, end: screenPoint(event) }); }} onPointerUp={finishSelection}
          onPointerCancel={() => { startPoint.current = null; setRectangle(null); setSelecting(false); }}>
          <div ref={container} className="globe-map" aria-label="Historical ocean activity globe" />
          {rectangle && <div className="selection-box" style={{ left: Math.min(rectangle.start.x, rectangle.end.x), top: Math.min(rectangle.start.y, rectangle.end.y), width: Math.abs(rectangle.start.x - rectangle.end.x), height: Math.abs(rectangle.start.y - rectangle.end.y) }} />}
          {!ready && !mapError && <div className="map-loading">Loading globe…</div>}
        </div>
        {mapError && <p className="globe-notice">{mapError}</p>}
        <div className="globe-legend"><span>● Fishing / other activity</span><span>● Cargo</span><span>● Carrier</span><small>Cell locations at 0.1° resolution. Color denotes reported class, not authorization.</small></div>
        <details className="area-coordinates"><summary>Area coordinates / keyboard selection</summary><div>{(["west", "south", "east", "north"] as const).map((key) => <label key={key}>{key}<input type="number" step="0.1" value={query[key]} onChange={(e) => update({ [key]: Number(e.target.value) })} /></label>)}</div></details>
        <div className="globe-attribution">Basemap © MapLibre demo / contributors · <a href="https://globalfishingwatch.org" target="_blank" rel="noreferrer">Powered by Global Fishing Watch</a> (GFW mode only)</div>
      </section>
      <aside className="globe-sidebar" aria-live="polite">
        {error && <div className="notice error" role="alert">{error}</div>}
        <div className="globe-sidebar-head"><span className="globe-kicker">AREA INVESTIGATION</span><h2>{loading ? "Retrieving historical reports…" : result ? `${result.vessels.length} vessels · ${result.cells.length} activity cells` : "Select an area to investigate"}</h2>
          {result ? <p>{dateLabel(result.start)} → {dateLabel(result.end)}<br /><small>{result.dataset}</small></p> : <p>Rotate and zoom the globe, then drag an area or scan the Gulf of Guinea preset.</p>}</div>
        {result && result.cells.length === 0 && <p className="empty">No activity returned for this area and window. This is not proof that no vessels were present.</p>}
        {cell && <div className="block"><h3>Selected activity cell</h3><p>{Number(cell.lat).toFixed(2)}°, {Number(cell.lon).toFixed(2)}° · {cell.value} {query.layer === "sar" ? "detections" : "hours"}</p><p>{cell.date} · {cell.vessel_type}</p><small>The vessel list refers to the full selected area, not this individual dot.</small></div>}
        {result?.vessels.map((vessel) => <button type="button" key={vessel.vessel_id} className={`globe-vessel ${selectedId === vessel.vessel_id ? "active" : ""}`} onClick={() => void inspect(vessel)}><strong>{vessel.name}</strong><span>{vessel.vessel_type} · MMSI {vessel.mmsi ?? "not supplied"}</span><small>{vessel.hours.toFixed(2)} activity hours · view evidence →</small></button>)}
        {result?.layer === "sar" && <p className="block">These are unmatched detection cells. No vessel IDs are inferred or fabricated.</p>}
        {detailLoading && <p className="block">Loading identity, public records and risk evidence…</p>}
        {detailError && <p className="notice error" role="alert">{detailError}</p>}
        {detail && <div className="block"><span className="globe-kicker">VESSEL EVIDENCE</span><h3>{detail.summary.name}</h3><p>{detail.summary.vessel_type} · flag {detail.summary.flag ?? "not supplied"}</p><p>MMSI {detail.summary.mmsi ?? "not supplied"} · IMO {detail.summary.imo ?? "not supplied"}</p><p>Documentation: {detail.summary.documentation.replaceAll("_", " ")}</p><p>{detail.summary.public_authorization_records.length} public authorization records returned. These need scope/date review.</p><p className="authorization-unknown">Authorization: {detail.authorization.status}</p><p>{detail.authorization.explanation}</p>
          <h3>Review indicators · selected period</h3><ul className="globe-indicators">{detail.indicators.map((indicator) => <li key={indicator.code} className={indicator.count && indicator.count > 0 ? "flagged" : ""}><span>{indicator.label}</span><strong>{indicator.count === null ? "Unavailable" : indicator.count}</strong></li>)}</ul><p className="small">Indicators support review; absent or zero indicators do not establish authorization or low risk. {detail.summary.identity_note}</p>
          {detail.warnings.map((warning) => <p key={warning} className="authorization-unknown">{warning}</p>)}
          <details><summary>Raw risk evidence and event references</summary><pre>{JSON.stringify(detail.insights, null, 2)}</pre></details><details><summary>Identity and public authorization records</summary><pre>{JSON.stringify(detail.identity, null, 2)}</pre></details><p className="small">Sources: {detail.sources.join("; ")}</p></div>}
        {result && <div className="block small">{result.notes.map((note) => <p key={note}>{note}</p>)}</div>}
      </aside>
    </div>
  </div>;
}
