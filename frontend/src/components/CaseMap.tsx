import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import "../mapWorker";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import type { Case } from "../api/types";
import { registration, registrationLabel, type Registration } from "../format";
import { zonesGeoJson } from "../zones";
import type { ActivityCell, HistoricalQuery } from "../api/historical";
import landOutlineUrl from "../assets/land-outline.geojson?url";
import { applyBasemap, isImageryError, type Basemap } from "../mapBasemap";
import { makeMapSymbol, shipColors, shipKind, shipPaths } from "../vesselSymbols";
import { validSelection, SELECTION_LIMIT_MESSAGE } from "../selection";
import { Info } from "./Info";
import { LoadingStatus } from "./Loading";
import { activityFeatures, activityLayerNames, activityUnits } from "../activityMap";
import { forecastFeatures, type ForecastComparison, type ActivityArrow } from "../forecastMap";

export interface Area {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface Located {
  key: string;
  lat: number;
  lon: number;
  cases: Case[];
}

interface Props {
  groups: Located[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  area: Area | null;
  onAreaChange: (area: Area | null) => void;
  activityCells?: ActivityCell[];
  onActivitySelect?: (cell: ActivityCell) => void;
  forecastBounds?: Area | null;
  onSelectingChange?: (active: boolean) => void;
  noticeTarget?: HTMLElement | null;
  activityLayer?: HistoricalQuery["layer"];
  forecastComparison?: ForecastComparison | null;
  onForecastArrowSelect?: (arrow: ActivityArrow) => void;
  selectedForecastArrow?: ActivityArrow | null;
}

type View = "globe" | "mercator";

const HOME = { center: [-1, 4] as [number, number], zoom: 2.1 };

const STYLE: StyleSpecification = {
  version: 8,
  projection: { type: "globe" },
  sky: {
    "sky-color": "#070b12",
    "horizon-color": "#23405f",
    "fog-color": "#070b12",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    // A thin limb around the globe, not a glow.
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.35, 5, 0.2, 7, 0],
  },
  sources: {
    "local-land": { type: "geojson", data: landOutlineUrl, attribution: "Outline: Natural Earth (public domain)" },
    imagery: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    places: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 18,
    },
  },
  layers: [
    // Chart-style basemap: dark water, slightly lighter land, a fine coastline.
    { id: "background", type: "background", paint: { "background-color": "#0d1b2d" } },
    { id: "local-land-fill", type: "fill", source: "local-land", paint: { "fill-color": "#1e2c40" } },
    { id: "local-land-outline", type: "line", source: "local-land", paint: { "line-color": "#3b4d66", "line-width": .7 } },
    {
      id: "imagery",
      type: "raster",
      source: "imagery",
      layout: { visibility: "none" },
      paint: { "raster-brightness-max": 0.6, "raster-saturation": -0.3, "raster-contrast": 0.1 },
    },
    { id: "places", type: "raster", source: "places", layout: { visibility: "none" }, paint: { "raster-opacity": 0.9 } },
  ],
};

// Order used to colour a stacked marker by its most notable vessel.
const rank: Record<Registration, number> = { unregistered: 2, unresolved: 1, registered: 0 };

function stackRegistration(cases: Case[]): Registration {
  return cases.reduce<Registration>((top, c) => {
    const r = registration(c.observation.identity_status);
    return rank[r] > rank[top] ? r : top;
  }, "registered");
}

const areaGeoJson = (a: Area | null): FeatureCollection => ({
  type: "FeatureCollection",
  features: a
    ? [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [a.west, a.south],
                [a.east, a.south],
                [a.east, a.north],
                [a.west, a.north],
                [a.west, a.south],
              ],
            ],
          },
        },
      ]
    : [],
});

export function CaseMap({ groups, selectedId, onSelect, area, onAreaChange, activityCells, onActivitySelect, forecastBounds, onSelectingChange, noticeTarget, activityLayer = "presence", forecastComparison, onForecastArrowSelect, selectedForecastArrow }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const activityClick = useRef(onActivitySelect);
  activityClick.current = onActivitySelect;
  const forecastClick = useRef(onForecastArrowSelect);
  forecastClick.current = onForecastArrowSelect;
  const [ready, setReady] = useState(false);
  const [tilesLoading, setTilesLoading] = useState(false);
  const [mapError, setMapError] = useState("");
  const [basemap, setBasemap] = useState<Basemap>("outline");
  const [mapZoom, setMapZoom] = useState(HOME.zoom);
  const [basemapWarning, setBasemapWarning] = useState("");
  const [view, setView] = useState<View>("globe");
  const [selecting, setSelecting] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [dragBox, setDragBox] = useState<{ x: number; y: number; w: number; h: number; invalid: boolean } | null>(null);
  useEffect(() => { onSelectingChange?.(selecting); }, [selecting, onSelectingChange]);

  // Legend auto-hide: after LEGEND_IDLE_MS without activity on the map it slides down to its title strip.
  // The strip can be dragged (or clicked) to bring it back up, or dragged down to hide it sooner.
  const LEGEND_IDLE_MS = 6000;
  const LEGEND_PEEK = 18; // how far the strip stays above the hidden position, so its 30px title shows
  const [legendHidden, setLegendHidden] = useState(false);
  const [legendOffset, setLegendOffset] = useState<number | null>(null); // live position while dragging
  const legendRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const suppressLegendClick = useRef(false);

  // Restart the idle countdown on any pointer, wheel or key activity over the map, while the legend is showing.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || legendHidden) return;
    let timer = window.setTimeout(() => setLegendHidden(true), LEGEND_IDLE_MS);
    const activity = () => { window.clearTimeout(timer); timer = window.setTimeout(() => setLegendHidden(true), LEGEND_IDLE_MS); };
    const events = ["pointermove", "pointerdown", "wheel", "keydown", "touchstart"] as const;
    events.forEach(name => viewport.addEventListener(name, activity, { passive: true }));
    return () => { window.clearTimeout(timer); events.forEach(name => viewport.removeEventListener(name, activity)); };
  }, [legendHidden]);

  // Dragging the legend's title strip moves it with the pointer; on release it settles open or hidden.
  function startLegendDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !legendRef.current) return;
    const max = legendRef.current.offsetHeight - LEGEND_PEEK;
    const startY = event.clientY, startOffset = legendHidden ? max : 0;
    let moved = false;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const dy = moveEvent.clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      if (moved) setLegendOffset(Math.max(0, Math.min(max, startOffset + dy)));
    };
    const stop = (upEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", stop); handle.removeEventListener("pointercancel", stop);
      setLegendOffset(null);
      if (moved) { suppressLegendClick.current = true; setLegendHidden(startOffset + upEvent.clientY - startY > max / 2); }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }
  // A click (or Enter/Space) on the strip toggles the legend; a drag that just ended is not treated as a click.
  function toggleLegend() {
    if (suppressLegendClick.current) { suppressLegendClick.current = false; return; }
    setLegendHidden(hidden => !hidden);
  }

  useEffect(() => {
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
      container: containerRef.current!,
      style: STYLE,
      center: HOME.center,
      zoom: HOME.zoom,
      attributionControl: { compact: true },
      });
    } catch (error) {
      setMapError(error instanceof Error ? error.message : "Globe initialization failed");
      return;
    }
    map.on("error", (event) => {
      const message = event.error?.message ?? "A map resource could not load";
      if (isImageryError("sourceId" in event ? event.sourceId : undefined, message)) {
        applyBasemap(map, "outline");
        setBasemap("outline");
        setBasemapWarning("Satellite imagery is unavailable. Using the local outline map; area queries and vessel screening remain available.");
      } else {
        setMapError(message);
      }
    });
    map.on("dataloading", () => setTilesLoading(true));
    map.on("idle", () => setTilesLoading(false));
    map.on("zoomend", () => setMapZoom(map.getZoom()));
    map.on("styleimagemissing", (event) => {
      const image = makeMapSymbol(event.id);
      if (image && !map.hasImage(event.id)) map.addImage(event.id, image, { pixelRatio: 2 });
    });
    map.addControl(new maplibregl.NavigationControl({ showZoom: true, visualizePitch: false }), "top-left");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 140 }), "bottom-right");
    map.on("load", () => {
      if (activityCells === undefined) {
      map.addSource("zones", { type: "geojson", data: zonesGeoJson });
      map.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#2fd3c0", "fill-opacity": 0.1 } });
      map.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#2fd3c0", "line-width": 1.2 } });
      }
      map.addSource("historical-activity", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("activity-squares", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "activity-heat", type: "heatmap", source: "historical-activity", maxzoom: 8, paint: {
        "heatmap-weight": ["get", "intensity"],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, .8, 7, 1.5],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 8, 4, 20, 7, 30],
        "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(10,45,72,0)", .15, "#16475c", .35, "#176d79", .6, "#22a99a", .8, "#39d9ad", 1, "#92ffbf"],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 5, .9, 7, 0],
      } });
      map.addLayer({ id: "activity-squares-fill", type: "fill", source: "activity-squares", minzoom: 5, paint: {
        "fill-color": ["interpolate", ["linear"], ["get", "intensity"], 0, "#18516a", .3, "#197b83", .65, "#2fcaa4", 1, "#9affc4"],
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 7, .75, 11, .9],
      } });
      map.addLayer({ id: "activity-squares-outline", type: "line", source: "activity-squares", minzoom: 6, paint: { "line-color": "#0d4567", "line-width": .7, "line-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0, 8, .8] } });
      map.on("click", "activity-squares-fill", (event) => {
        if (map.getZoom() < 6) return;
        const cell = event.features?.[0]?.properties;
        if (cell) activityClick.current?.(cell as ActivityCell);
      });
      map.on("click", "activity-heat", (event) => {
        if (map.getZoom() >= 6) return;
        const feature = event.features?.[0];
        if (feature?.geometry.type === "Point") map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom: 7 });
      });
      map.addSource("area", { type: "geojson", data: areaGeoJson(null) });
      map.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#4c8dff", "fill-opacity": 0.1 } });
      map.addLayer({
        id: "area-line",
        type: "line",
        source: "area",
        paint: { "line-color": "#8fbaff", "line-width": 1.8, "line-dasharray": [3, 2] },
      });
      map.addSource("forecast-cell", { type: "geojson", data: areaGeoJson(null) });
      map.addLayer({ id: "forecast-fill", type: "fill", source: "forecast-cell", paint: { "fill-color": "#b78bff", "fill-opacity": .13 } });
      map.addLayer({ id: "forecast-outline", type: "line", source: "forecast-cell", paint: { "line-color": "#c29aff", "line-width": 3, "line-dasharray": [2, 2] } });
      map.addSource("forecast-neighbors", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("forecast-arrows", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("forecast-arrowheads", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("forecast-target", { type: "geojson", data: areaGeoJson(null) });
      map.addLayer({ id: "forecast-neighbors-fill", type: "fill", source: "forecast-neighbors", paint: { "fill-color": "#9d79e5", "fill-opacity": .06 } });
      map.addLayer({ id: "forecast-neighbors-line", type: "line", source: "forecast-neighbors", paint: { "line-color": "#ad8de3", "line-width": 1, "line-opacity": .65 } });
      // Forecast arrows: thick red lines with a dark edge so they stand out on any background.
      map.addLayer({ id: "forecast-arrow-shadow", type: "line", source: "forecast-arrows", paint: { "line-color": "#0b1320", "line-width": 9 } });
      map.addLayer({ id: "forecast-arrow-line", type: "line", source: "forecast-arrows", paint: { "line-color": "#e5484d", "line-width": 5 } });
      map.addLayer({ id: "forecast-arrow-head", type: "fill", source: "forecast-arrowheads", paint: { "fill-color": "#e5484d", "fill-outline-color": "#8f1d22" } });
      map.addLayer({ id: "forecast-target-outline", type: "line", source: "forecast-target", paint: { "line-color": "#e5484d", "line-width": 3 } });
      map.addLayer({ id: "forecast-arrow-hit", type: "line", source: "forecast-arrows", paint: { "line-color": "#e5484d", "line-opacity": .01, "line-width": 18 } });
      map.on("click", "forecast-arrow-hit", event => { const properties = event.features?.[0]?.properties; if (properties) forecastClick.current?.(properties as ActivityArrow); });
      map.on("click", "forecast-arrow-head", event => { const properties = event.features?.[0]?.properties; if (properties) forecastClick.current?.(properties as ActivityArrow); });
      setReady(true);
    });
    mapRef.current = map;
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(containerRef.current!);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (ready && mapRef.current) applyBasemap(mapRef.current, basemap);
  }, [ready, basemap]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    void (map.getSource("forecast-cell") as GeoJSONSource).setData(areaGeoJson(forecastBounds ?? null));
    if (forecastBounds && !selecting) map.fitBounds([[forecastBounds.west, forecastBounds.south], [forecastBounds.east, forecastBounds.north]], { padding: 70, maxZoom: 6, duration: 700 });
  }, [ready, forecastBounds]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current, data = forecastFeatures(forecastComparison ?? null);
    void (map.getSource("forecast-neighbors") as GeoJSONSource).setData(data.cells);
    void (map.getSource("forecast-arrows") as GeoJSONSource).setData(data.arrows);
    void (map.getSource("forecast-arrowheads") as GeoJSONSource).setData(data.heads);
    const cells = forecastComparison?.cells ?? [];
    if (cells.length > 1 && !selecting) map.fitBounds([[Math.min(...cells.map(cell => cell.bounds.west)), Math.min(...cells.map(cell => cell.bounds.south))], [Math.max(...cells.map(cell => cell.bounds.east)), Math.max(...cells.map(cell => cell.bounds.north))]], { padding: 70, maxZoom: 6, duration: 700 });
  }, [ready, forecastComparison]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const target = forecastComparison?.cells.find(cell => cell.cell_id === selectedForecastArrow?.to_id);
    void (mapRef.current.getSource("forecast-target") as GeoJSONSource).setData(areaGeoJson(target?.bounds ?? null));
  }, [ready, forecastComparison, selectedForecastArrow]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const data = activityFeatures(activityCells ?? []);
    void (mapRef.current.getSource("historical-activity") as GeoJSONSource).setData(data.points);
    void (mapRef.current.getSource("activity-squares") as GeoJSONSource).setData(data.squares);
  }, [ready, activityCells]);

  useEffect(() => {
    if (ready) mapRef.current!.setProjection({ type: view });
  }, [ready, view]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current!;
    (map.getSource("area") as GeoJSONSource).setData(areaGeoJson(area));
    if (area) {
      map.fitBounds(
        [
          [area.west, area.south],
          [area.east, area.north],
        ],
        { padding: 90, maxZoom: 9, duration: 900 },
      );
    }
  }, [ready, area]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = groups.map((g) => {
      const selected = g.cases.find((c) => c.observation.observation_id === selectedId);
      const el = document.createElement("button");
      el.type = "button";
      el.className = `marker marker-${stackRegistration(g.cases)}${selected ? " is-selected" : ""}`;
      el.setAttribute(
        "aria-label",
        g.cases.length > 1 ? `${g.cases.length} vessels at this location` : `Vessel ${g.cases[0].observation.observation_id}`,
      );
      const kinds = [...new Set(g.cases.map((c) => shipKind(c.vessel_assessment?.vessel_type)))];
      const kind = kinds.length === 1 ? kinds[0] : "mixed";
      el.innerHTML = `<svg viewBox="0 0 34 34" aria-hidden="true"><path d="${shipPaths[kind]}" style="fill:${shipColors[kind]}"/></svg>`;
      if (g.cases.length > 1) {
        const count = document.createElement("span");
        count.className = "marker-count";
        count.textContent = String(g.cases.length);
        el.appendChild(count);
      }
      if (selected) {
        const r = registration(selected.observation.identity_status);
        const tag = document.createElement("span");
        tag.className = "marker-tag";
        const id = document.createElement("strong");
        id.textContent = selected.observation.observation_id;
        const st = document.createElement("span");
        st.className = `marker-${r}`;
        st.textContent = registrationLabel[r];
        tag.append(id, st);
        el.appendChild(tag);
      }
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        // Clicking a stacked marker again steps to the next vessel at that spot.
        const next = selected ? g.cases[(g.cases.indexOf(selected) + 1) % g.cases.length] : g.cases[0];
        onSelect(next.observation.observation_id);
      });
      return new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([g.lon, g.lat]).addTo(map);
    });
  }, [groups, selectedId, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selecting) return;
    const canvas = map.getCanvasContainer();
    const scrollZoomWasEnabled = map.scrollZoom.isEnabled();
    map.scrollZoom.disable();
    map.dragPan.disable();
    map.dragRotate.disable();
    canvas.style.cursor = "crosshair";
    let start: maplibregl.Point | null = null;

    const point = (e: MouseEvent) => {
      // The inner canvas wrapper can have zero layout height because MapLibre
      // absolutely positions its canvas. Clamp to the actual map viewport.
      const r = map.getContainer().getBoundingClientRect();
      return new maplibregl.Point(Math.max(0, Math.min(r.width, e.clientX - r.left)), Math.max(0, Math.min(r.height, e.clientY - r.top)));
    };
    const bounds = (a: maplibregl.Point, b: maplibregl.Point): Area => {
      const from = map.unproject(a), to = map.unproject(b);
      return { west: Math.min(from.lng, to.lng), east: Math.max(from.lng, to.lng), south: Math.min(from.lat, to.lat), north: Math.max(from.lat, to.lat) };
    };
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      setSelectionError("");
      start = point(e);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up, { once: true });
    };
    const move = (e: MouseEvent) => {
      if (!start) return;
      const p = point(e);
      setDragBox({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y), invalid: !validSelection(bounds(start, p)) });
    };
    const up = (e: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      setDragBox(null);
      const end = point(e);
      if (start && Math.abs(end.x - start.x) > 4 && Math.abs(end.y - start.y) > 4) {
        const selectedBounds = bounds(start, end);
        if (validSelection(selectedBounds)) onAreaChange(selectedBounds);
        else setSelectionError(SELECTION_LIMIT_MESSAGE);
      }
      start = null;
      setSelecting(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setSelecting(false); setDragBox(null); } };

    canvas.addEventListener("mousedown", down);
    window.addEventListener("keydown", escape);
    return () => {
      canvas.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", escape);
      setDragBox(null);
      canvas.style.cursor = "";
      if (scrollZoomWasEnabled) map.scrollZoom.enable();
      map.dragPan.enable();
      map.dragRotate.enable();
    };
  }, [selecting, onAreaChange]);

  function clearArea() {
    onAreaChange(null);
    mapRef.current?.flyTo({ ...HOME, duration: 900 });
  }

  const notices = <div className="map-notices" aria-live="polite">
        {selectionError && <div className="notice error" role="alert">{selectionError} <button type="button" onClick={() => setSelectionError("")}>Dismiss</button></div>}
        {mapError && <div className="notice error" role="alert">Map issue: {mapError}. GFW authentication is separate.</div>}
        {basemapWarning && !mapError && <div className="notice" role="status">{basemapWarning}</div>}
      </div>;
  return (
    <>
      {noticeTarget ? createPortal(notices, noticeTarget) : notices}
    <div className="map-wrap" aria-busy={!mapError && (!ready || tilesLoading)}>
      {/* Toolbar above the map: selection tools on the left, view settings on the right. */}
      <div className="map-toolbar">
        <div className="map-toolbar-group">
          <button
            type="button"
            disabled={!ready}
            className={selecting ? "is-on" : "primary"}
            onClick={() => { setSelectionError(""); setSelecting((s) => !s); }}
            aria-pressed={selecting}
          >
            <svg className="tool-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M1 3.5V1h2.5M8.5 1H11v2.5M11 8.5V11H8.5M3.5 11H1V8.5" /></svg>
            {selecting ? "Cancel selection" : area ? "Select new area" : "Select area"}
          </button>
          {area && (
            <button type="button" onClick={clearArea}>
              Clear area
            </button>
          )}
          {selecting && <span className="selection-hint" role="status">{dragBox?.invalid ? "Select a valid map rectangle" : "Drag to select an area · Esc to cancel"}</span>}
          {ready && tilesLoading && !mapError && !selecting && <span className="map-tile-loading" role="status"><span className="loading-spinner" aria-hidden="true" />Updating map layers…</span>}
        </div>
        <div className="map-toolbar-group">
          <div className="segmented" role="group" aria-label="Map view">
            <button type="button" className={view === "globe" ? "is-on" : undefined} onClick={() => setView("globe")} aria-pressed={view === "globe"}>
              3D
            </button>
            <button type="button" className={view === "mercator" ? "is-on" : undefined} onClick={() => setView("mercator")} aria-pressed={view === "mercator"}>
              2D
            </button>
          </div>
          <label className="basemap-choice"><span className="sr-only">Basemap</span><select aria-label="Basemap" value={basemap} onChange={(event) => { setBasemap(event.target.value as Basemap); setBasemapWarning(""); }}><option value="outline">Simple ocean map</option><option value="imagery">Satellite photos</option></select></label>
        </div>
      </div>

      {/* The map itself, with its overlays positioned inside. */}
      <div className="map-viewport" ref={viewportRef}>
      <div ref={containerRef} className="map" />
      {!ready && !mapError && <div className="map-loading-shell"><LoadingStatus label="Loading the globe…" detail="Preparing the map and geographic layers." /></div>}
      {dragBox && (
        <div className={`drag-box${dragBox.invalid ? " too-large" : ""}`} style={{ left: dragBox.x, top: dragBox.y, width: dragBox.w, height: dragBox.h }} />
      )}

      {activityCells !== undefined ? !selecting && <div ref={legendRef} className={`activity-legend${legendHidden ? " is-hidden" : ""}`} style={legendOffset !== null ? { transform: `translateY(${legendOffset}px)`, transition: "none" } : undefined}>
        {/* Title strip: drag it up or down, or click it, to show or hide the legend. */}
        <button type="button" className="legend-handle" aria-expanded={!legendHidden} aria-label={legendHidden ? "Show map legend" : "Hide map legend"} title="Drag or click to show or hide" onPointerDown={startLegendDrag} onClick={toggleLegend}><span className="legend-grip" aria-hidden="true" /><strong>{activityLayerNames[activityLayer]}</strong></button>
        <div className="heat-scale" aria-hidden="true" /><div className="heat-scale-labels"><span>Less activity</span><span>More activity</span></div>
        <span className="activity-legend-hint">{activityCells.length ? mapZoom < 6 ? "Zoom in to explore activity squares" : "Click a colored square for details" : "Select an area to load activity"}</span>
        {forecastComparison && <div className="forecast-map-key"><strong>Purple: historical forecast squares</strong><span>Red arrows → higher predicted activity</span><span>Not boat travel directions</span><small>{forecastComparison.cells[0]?.target_start} through {forecastComparison.cells[0]?.target_end}</small></div>}
        <Info label="Reading this map"><p>Brighter green means more {activityUnits[activityLayer]} in the selected time period. Colors compare activity within your selected area; they do not show danger or illegal behavior. Dark or empty areas can mean missing data.</p><p>Zooming in reveals small activity squares, each about 11 km north to south. Squares show approximate areas around reported grid points, not individual boat locations. Several boats can use the same square. The boat list covers the whole area you selected.</p><p>To show each boat in its correct place, we need separate position records with a boat ID, coordinates and observation time. The current GFW area reports do not provide that combination.</p><a href="https://globalfishingwatch.org" target="_blank" rel="noreferrer">Data from Global Fishing Watch</a></Info>
      </div> : <div className="map-legend">
        <span>
          <i className="legend-mark marker-registered" />
          AIS matched
        </span>
        <span>
          <i className="legend-mark marker-unregistered" />
          No AIS match
        </span>
        <span>
          <i className="legend-mark marker-unresolved" />
          Unresolved
        </span>
        <span>
          <i className="legend-count">2</i>
          Same spot
        </span>
        <span>
          <i className="legend-zone" />
          Illustrative fishing zone
        </span>
      </div>}
      </div>
    </div>
    </>
  );
}
