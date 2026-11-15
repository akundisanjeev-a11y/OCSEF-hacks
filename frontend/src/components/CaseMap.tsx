import { useEffect, useRef, useState } from "react";
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

// The rectangle the user drags on the globe, as latitude/longitude edges in degrees.
export interface Area {
  west: number;
  south: number;
  east: number;
  north: number;
}

// All the cases found at one exact coordinate, so they can be drawn as a single marker with a count.
export interface Located {
  key: string;
  lat: number;
  lon: number;
  cases: Case[];
}

// What the map needs from the page: the vessel groups to draw, the selected case, how to select one,
// the current area, and how to change or clear it.
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

// The two map views: a 3D globe, or a flat Mercator map ("2D").
type View = "globe" | "mercator";

// Where the map starts and returns to: the Gulf of Guinea off Ghana, zoomed out enough to see the globe.
const HOME = { center: [-1, 4] as [number, number], zoom: 2.1 };

// The look of the map: a globe projection with an atmosphere, satellite imagery from Esri,
// place-name labels on top, and a dark fallback background if tiles are slow or offline.
const STYLE: StyleSpecification = {
  version: 8,
  // Draw the world as a sphere instead of a flat sheet.
  projection: { type: "globe" },
  // Space and glow around the globe; the glow fades out as you zoom in.
  sky: {
    "sky-color": "#04070d",
    "horizon-color": "#1d4f9c",
    "fog-color": "#04070d",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 5, 0.6, 7, 0],
  },
  // Where the picture tiles come from.
  sources: {
    "local-land": { type: "geojson", data: landOutlineUrl, attribution: "Outline: Natural Earth (public domain)" },
    // Satellite imagery.
    imagery: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    // Country, city and sea names drawn over the imagery.
    places: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 18,
    },
  },
  // Stacking order, bottom to top: background, imagery (dimmed so markers stand out), then labels.
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#0b254b" } },
    { id: "local-land-fill", type: "fill", source: "local-land", paint: { "fill-color": "#294a78" } },
    { id: "local-land-outline", type: "line", source: "local-land", paint: { "line-color": "#3f6291", "line-width": .7 } },
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

// Picks the colour category for a marker that holds several vessels: the most notable one wins,
// so an unregistered ship is never hidden behind a registered one.
function stackRegistration(cases: Case[]): Registration {
  return cases.reduce<Registration>((top, c) => {
    const r = registration(c.observation.identity_status);
    return rank[r] > rank[top] ? r : top;
  }, "registered");
}

// Turns the selected area into a GeoJSON rectangle that the map can draw (empty when there is no area).
const areaGeoJson = (a: Area | null): FeatureCollection => ({
  type: "FeatureCollection",
  features: a
    ? [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            // Four corners, repeating the first point to close the shape.
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
  // Holds the MapLibre map so effects and handlers can reach it without re-rendering.
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Holds the vessel markers currently on the map, so they can be removed and redrawn when the data changes.
  const markersRef = useRef<maplibregl.Marker[]>([]);
  // Always holds the latest "activity cell clicked" callback, so the map's click handler never goes stale.
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
  // Globe (3D) or flat (2D) view.
  const [view, setView] = useState<View>("globe");
  // True while the user is in "draw a box" mode.
  const [selecting, setSelecting] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [dragBox, setDragBox] = useState<{ x: number; y: number; w: number; h: number; invalid: boolean } | null>(null);
  useEffect(() => { onSelectingChange?.(selecting); }, [selecting, onSelectingChange]);

  // Runs once: creates the map, adds the zoom and scale controls, and adds the fishing-zone and
  // selected-area layers once the map has loaded. Cleans the map up when the page is left.
  useEffect(() => {
    // Create the map inside our container, using the style and starting view above.
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
    // Zoom buttons (top left) and a distance scale bar (bottom right).
    map.addControl(new maplibregl.NavigationControl({ showZoom: true, visualizePitch: false }), "top-left");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 140 }), "bottom-right");
    // Layers can only be added after the map has loaded.
    map.on("load", () => {
      // Teal outlines and tint for the illustrative fishing zones (only on the fictional-cases map).
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
      map.addLayer({ id: "forecast-arrow-shadow", type: "line", source: "forecast-arrows", paint: { "line-color": "#0b203b", "line-width": 7 } });
      map.addLayer({ id: "forecast-arrow-line", type: "line", source: "forecast-arrows", paint: { "line-color": "#ffda87", "line-width": 3 } });
      map.addLayer({ id: "forecast-arrow-head", type: "fill", source: "forecast-arrowheads", paint: { "fill-color": "#ffda87", "fill-outline-color": "#bd9444" } });
      map.addLayer({ id: "forecast-target-outline", type: "line", source: "forecast-target", paint: { "line-color": "#ffda87", "line-width": 3 } });
      map.addLayer({ id: "forecast-arrow-hit", type: "line", source: "forecast-arrows", paint: { "line-color": "#ffda87", "line-opacity": .01, "line-width": 16 } });
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

  // Switches between the globe and flat map when the 3D / 2D toggle changes.
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

  // Keeps the drawn rectangle in sync with the selected area, and zooms the map to fit it.
  useEffect(() => {
    if (!ready) return;
    // The map object, which is known to exist once it has finished loading.
    const map = mapRef.current!;
    // Update the dashed rectangle (or remove it when the area is cleared).
    (map.getSource("area") as GeoJSONSource).setData(areaGeoJson(area));
    // Fly in so the chosen area fills the view.
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

  // Redraws the vessel markers whenever the vessels or the selected case change.
  // Old markers are removed first, then one new marker is made per group of vessels.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = groups.map((g) => {
      // The selected vessel in this group, if it is one of them.
      const selected = g.cases.find((c) => c.observation.observation_id === selectedId);
      // The marker is a real button so it can be focused and clicked; its colour class shows registered / unregistered / unresolved.
      const el = document.createElement("button");
      el.type = "button";
      el.className = `marker marker-${stackRegistration(g.cases)}${selected ? " is-selected" : ""}`;
      // Screen-reader description of what this marker is.
      el.setAttribute(
        "aria-label",
        g.cases.length > 1 ? `${g.cases.length} vessels at this location` : `Vessel ${g.cases[0].observation.observation_id}`,
      );
      // The marker's ship symbol: one shape per reported vessel type, or "mixed" when the vessels here differ.
      const kinds = [...new Set(g.cases.map((c) => shipKind(c.vessel_assessment?.vessel_type)))];
      const kind = kinds.length === 1 ? kinds[0] : "mixed";
      el.innerHTML = `<svg viewBox="0 0 34 34" aria-hidden="true"><path d="${shipPaths[kind]}" style="fill:${shipColors[kind]}"/></svg>`;
      // A small number badge when several vessels share this exact spot.
      if (g.cases.length > 1) {
        const count = document.createElement("span");
        count.className = "marker-count";
        count.textContent = String(g.cases.length);
        el.appendChild(count);
      }
      // A label beside the selected marker showing its case ID and registered / unregistered status.
      if (selected) {
        const r = registration(selected.observation.identity_status);
        // Small label shown beside the selected vessel's marker.
        const tag = document.createElement("span");
        tag.className = "marker-tag";
        // Bold case id inside the label.
        const id = document.createElement("strong");
        id.textContent = selected.observation.observation_id;
        // The registered / unregistered / unresolved word, coloured by its class.
        const st = document.createElement("span");
        st.className = `marker-${r}`;
        st.textContent = registrationLabel[r];
        tag.append(id, st);
        el.appendChild(tag);
      }
      // Clicking selects this vessel's case.
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        // Clicking a stacked marker again steps to the next vessel at that spot.
        const next = selected ? g.cases[(g.cases.indexOf(selected) + 1) % g.cases.length] : g.cases[0];
        onSelect(next.observation.observation_id);
      });
      // Place the marker on the map at the group's coordinates.
      return new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([g.lon, g.lat]).addTo(map);
    });
  }, [groups, selectedId, onSelect]);

  // Draw-a-box mode. While "Select area" is on, normal dragging is switched off and a mouse drag
  // draws a rectangle instead. On release, the two screen corners are converted to latitude/longitude
  // and reported to the page as the chosen area. Everything is undone when the mode ends.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selecting) return;
    // The map's drawing area, where the mouse events for the drag are listened for.
    const canvas = map.getCanvasContainer();
    const scrollZoomWasEnabled = map.scrollZoom.isEnabled();
    map.scrollZoom.disable();
    map.dragPan.disable();
    map.dragRotate.disable();
    canvas.style.cursor = "crosshair";
    // Where the drag began, in pixels (null when no drag is in progress).
    let start: maplibregl.Point | null = null;

    // Converts a mouse event to a pixel position relative to the map.
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
    // Mouse pressed: remember the start corner and begin listening for movement and release.
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      setSelectionError("");
      start = point(e);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up, { once: true });
    };
    // Mouse moved: update the on-screen rectangle (handles dragging in any direction).
    const move = (e: MouseEvent) => {
      if (!start) return;
      // Where the mouse is now, in pixels on the map.
      const p = point(e);
      setDragBox({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y), invalid: !validSelection(bounds(start, p)) });
    };
    // Mouse released: turn the dragged rectangle into a latitude/longitude area.
    const up = (e: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      setDragBox(null);
      // Where the mouse was released, in pixels on the map.
      const end = point(e);
      // Ignore tiny drags (accidental clicks).
      if (start && Math.abs(end.x - start.x) > 4 && Math.abs(end.y - start.y) > 4) {
        const selectedBounds = bounds(start, end);
        if (validSelection(selectedBounds)) onAreaChange(selectedBounds);
        else setSelectionError(SELECTION_LIMIT_MESSAGE);
      }
      // One box per click of "Select area": leave draw mode.
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

  // Clears the selected area and flies the map back to the starting view.
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
      <div ref={containerRef} className="map" />
      {!ready && !mapError && <div className="map-loading-shell"><div className="skeleton skeleton-globe" aria-hidden="true" /><LoadingStatus label="Loading the globe…" detail="Preparing the map and geographic layers." /></div>}
      {ready && tilesLoading && !mapError && <div className="map-tile-loading"><LoadingStatus label="Updating map layers…" /></div>}
      {dragBox && (
        <div className={`drag-box${dragBox.invalid ? " too-large" : ""}`} style={{ left: dragBox.x, top: dragBox.y, width: dragBox.w, height: dragBox.h }} />
      )}


      {/* Buttons in the top-right corner of the map. */}
      <div className="map-tools">
        <label className="basemap-choice"><span className="sr-only">Basemap</span><select aria-label="Basemap" value={basemap} onChange={(event) => { setBasemap(event.target.value as Basemap); setBasemapWarning(""); }}><option value="outline">Simple ocean map</option><option value="imagery">Satellite photos</option></select></label>
        <div className="segmented" role="group" aria-label="Map view">
          <button type="button" className={view === "globe" ? "is-on" : undefined} onClick={() => setView("globe")} aria-pressed={view === "globe"}>
            3D
          </button>
          <button type="button" className={view === "mercator" ? "is-on" : undefined} onClick={() => setView("mercator")} aria-pressed={view === "mercator"}>
            2D
          </button>
        </div>
        {/* Turns draw-a-box mode on or off; the label changes with the situation. */}
        <button
          type="button"
          disabled={!ready}
          className={selecting ? "is-on" : "primary"}
          onClick={() => { setSelectionError(""); setSelecting((s) => !s); }}
          aria-pressed={selecting}
        >
          {selecting ? "Cancel selection" : area ? "Select new area" : "Select area"}
        </button>
        {/* Removes the selected area (only shown when one exists). */}
        {area && (
          <button type="button" onClick={clearArea}>
            Clear area
          </button>
        )}
      </div>
      {selecting && <div className="selection-hint" role="status">{dragBox?.invalid ? "Too large — narrow your selection" : "Drag to select · maximum 40° × 30° · Esc to cancel"}</div>}

      {activityCells !== undefined ? !selecting && <div className="activity-legend">
        <strong>{activityLayerNames[activityLayer]}</strong><div className="heat-scale" aria-hidden="true" /><div className="heat-scale-labels"><span>Less activity</span><span>More activity</span></div>
        <span className="activity-legend-hint">{activityCells.length ? mapZoom < 6 ? "Zoom in to explore activity squares" : "Click a colored square for details" : "Select an area to load activity"}</span>
        {forecastComparison && <div className="forecast-map-key"><strong>Purple: historical forecast squares</strong><span>Gold arrows → higher predicted activity</span><span>Not boat travel directions</span><small>{forecastComparison.cells[0]?.target_start} through {forecastComparison.cells[0]?.target_end}</small></div>}
        <Info label="Reading this map"><p>Brighter green means more {activityUnits[activityLayer]} in the selected time period. Colors compare activity within your selected area; they do not show danger or illegal behavior. Dark or empty areas can mean missing data.</p><p>Zooming in reveals small activity squares, each about 11 km north to south. Squares show approximate areas around reported grid points, not individual boat locations. Several boats can use the same square. The boat list covers the whole area you selected.</p><p>To show each boat in its correct place, we need separate position records with a boat ID, coordinates and observation time. The current GFW area reports do not provide that combination.</p><a href="https://globalfishingwatch.org" target="_blank" rel="noreferrer">Data from Global Fishing Watch</a></Info>
      </div> : <div className="map-legend">
        <span>
          <i className="legend-mark marker-registered" />
          AIS matched
        </span>
        {/* Orange: AIS coverage was adequate and no signal matched. */}
        <span>
          <i className="legend-mark marker-unregistered" />
          No AIS match
        </span>
        {/* Grey: ambiguous match or missing data. */}
        <span>
          <i className="legend-mark marker-unresolved" />
          Unresolved
        </span>
        {/* The number badge appears when vessels share the same coordinates. */}
        <span>
          <i className="legend-count">2</i>
          Same spot
        </span>
        {/* The teal outlines are hand-drawn placeholders, not official boundaries. */}
        <span>
          <i className="legend-zone" />
          Illustrative fishing zone
        </span>
      </div>}
    </div>
    </>
  );
}
