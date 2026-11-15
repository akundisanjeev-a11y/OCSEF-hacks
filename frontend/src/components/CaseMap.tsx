import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import "../mapWorker";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import type { Case } from "../api/types";
import { registration, registrationLabel, type Registration } from "../format";
import { zonesGeoJson } from "../zones";
import type { ActivityCell } from "../api/historical";
import landOutlineUrl from "../assets/land-outline.geojson?url";
import { applyBasemap, isImageryError, type Basemap } from "../mapBasemap";
import { lengthScale, makeMapSymbol, shipColors, shipKind, shipPaths } from "../vesselSymbols";

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
}

type View = "globe" | "mercator";

const HOME = { center: [-1, 4] as [number, number], zoom: 2.1 };

const STYLE: StyleSpecification = {
  version: 8,
  projection: { type: "globe" },
  sky: {
    "sky-color": "#04070d",
    "horizon-color": "#1d4f9c",
    "fog-color": "#04070d",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 5, 0.6, 7, 0],
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
    { id: "background", type: "background", paint: { "background-color": "#0a1830" } },
    { id: "local-land-fill", type: "fill", source: "local-land", paint: { "fill-color": "#243e50" } },
    { id: "local-land-outline", type: "line", source: "local-land", paint: { "line-color": "#557687", "line-width": .7 } },
    {
      id: "imagery",
      type: "raster",
      source: "imagery",
      paint: { "raster-brightness-max": 0.6, "raster-saturation": -0.3, "raster-contrast": 0.1 },
    },
    { id: "places", type: "raster", source: "places", paint: { "raster-opacity": 0.9 } },
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

export function CaseMap({ groups, selectedId, onSelect, area, onAreaChange, activityCells, onActivitySelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const activityClick = useRef(onActivitySelect);
  activityClick.current = onActivitySelect;
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [basemap, setBasemap] = useState<Basemap>("imagery");
  const [basemapWarning, setBasemapWarning] = useState("");
  const [view, setView] = useState<View>("globe");
  const [selecting, setSelecting] = useState(false);
  const [dragBox, setDragBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

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
      map.addSource("historical-activity", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 44, clusterMaxZoom: 9 });
      map.addLayer({ id: "historical-activity", type: "symbol", source: "historical-activity", layout: {
        "icon-image": ["case", ["has", "point_count"], ["concat", "fleet-cluster-", ["to-string", ["get", "point_count"]]], ["get", "symbol_id"]],
        "icon-size": ["coalesce", ["get", "symbol_scale"], 1], "icon-allow-overlap": true,
      } });
      map.on("click", "historical-activity", (event) => {
        const feature = event.features?.[0];
        const cell = feature?.properties;
        if (cell?.cluster_id !== undefined && feature?.geometry.type === "Point") {
          const center = feature.geometry.coordinates as [number, number];
          void (map.getSource("historical-activity") as GeoJSONSource).getClusterExpansionZoom(Number(cell.cluster_id)).then((zoom) => map.easeTo({ center, zoom }));
          return;
        }
        if (cell) activityClick.current?.(cell as ActivityCell);
      });
      map.addSource("area", { type: "geojson", data: areaGeoJson(null) });
      map.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#4c8dff", "fill-opacity": 0.1 } });
      map.addLayer({
        id: "area-line",
        type: "line",
        source: "area",
        paint: { "line-color": "#8fbaff", "line-width": 1.8, "line-dasharray": [3, 2] },
      });
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (ready && mapRef.current) applyBasemap(mapRef.current, basemap);
  }, [ready, basemap]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const source = mapRef.current.getSource("historical-activity") as GeoJSONSource;
    void source.setData({ type: "FeatureCollection", features: (activityCells ?? []).map((cell) => ({
      type: "Feature", properties: { ...cell,
        symbol_id: `fleet-cell-${shipKind(cell.vessel_type)}-${cell.vessel_count_lower_bound != null ? "lower" + cell.vessel_count_lower_bound : "unknown"}`,
        symbol_scale: lengthScale(cell.mean_length_m),
      }, geometry: { type: "Point", coordinates: [cell.lon, cell.lat] },
    })) });
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
    map.dragPan.disable();
    map.dragRotate.disable();
    canvas.style.cursor = "crosshair";
    let start: maplibregl.Point | null = null;

    const point = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return new maplibregl.Point(e.clientX - r.left, e.clientY - r.top);
    };
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      start = point(e);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up, { once: true });
    };
    const move = (e: MouseEvent) => {
      if (!start) return;
      const p = point(e);
      setDragBox({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
    };
    const up = (e: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      setDragBox(null);
      const end = point(e);
      if (start && Math.abs(end.x - start.x) > 4 && Math.abs(end.y - start.y) > 4) {
        const a = map.unproject(start);
        const b = map.unproject(end);
        if ([a.lng, a.lat, b.lng, b.lat].every(Number.isFinite)) {
          onAreaChange({
            west: Math.min(a.lng, b.lng),
            east: Math.max(a.lng, b.lng),
            south: Math.min(a.lat, b.lat),
            north: Math.max(a.lat, b.lat),
          });
        }
      }
      start = null;
      setSelecting(false);
    };

    canvas.addEventListener("mousedown", down);
    return () => {
      canvas.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      canvas.style.cursor = "";
      map.dragPan.enable();
      map.dragRotate.enable();
    };
  }, [selecting, onAreaChange]);

  function clearArea() {
    onAreaChange(null);
    mapRef.current?.flyTo({ ...HOME, duration: 900 });
  }

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      {mapError && <div className="map-status map-status-error" role="alert">Map issue: {mapError}. GFW authentication is separate.</div>}
      {basemapWarning && !mapError && <div className="map-status" role="status">{basemapWarning}</div>}
      {dragBox && (
        <div className="drag-box" style={{ left: dragBox.x, top: dragBox.y, width: dragBox.w, height: dragBox.h }} />
      )}

      {!area && !selecting && (
        <div className="map-prompt">
          <strong>No area selected</strong>
          <span>Turn the globe to a region, click Select area, then drag a box to load the vessels inside it.</span>
        </div>
      )}
      {selecting && !dragBox && <div className="map-prompt">Drag a box over the area you want to inspect.</div>}

      <div className="map-tools">
        <label className="basemap-choice"><span className="sr-only">Basemap</span><select aria-label="Basemap" value={basemap} onChange={(event) => { setBasemap(event.target.value as Basemap); setBasemapWarning(""); }}><option value="imagery">Satellite imagery</option><option value="outline">Local outline (no tile server)</option></select></label>
        <div className="segmented" role="group" aria-label="Map view">
          <button type="button" className={view === "globe" ? "is-on" : undefined} onClick={() => setView("globe")} aria-pressed={view === "globe"}>
            3D
          </button>
          <button type="button" className={view === "mercator" ? "is-on" : undefined} onClick={() => setView("mercator")} aria-pressed={view === "mercator"}>
            2D
          </button>
        </div>
        <button
          type="button"
          className={selecting ? "is-on" : "primary"}
          onClick={() => setSelecting((s) => !s)}
          aria-pressed={selecting}
        >
          {selecting ? "Cancel selection" : area ? "Select new area" : "Select area"}
        </button>
        {area && (
          <button type="button" onClick={clearArea}>
            Clear area
          </button>
        )}
      </div>

      {activityCells !== undefined ? <div className="map-legend"><span>Cluster numbers = activity cells · click to expand</span><span>Cell ≥N = reported vessel-count lower bound · ? = unavailable</span><span>Symbol = reported type; unknown/mixed where unresolved</span><span>Size uses reported length only when available; otherwise fixed. Not to map scale.</span><a href="https://globalfishingwatch.org" target="_blank" rel="noreferrer">Powered by Global Fishing Watch</a></div> : <div className="map-legend">
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
  );
}
