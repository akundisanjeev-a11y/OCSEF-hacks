import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import type { Case } from "../api/types";
import { registration, registrationLabel, type Registration } from "../format";
import { zonesGeoJson } from "../zones";

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
    { id: "background", type: "background", paint: { "background-color": "#0a1830" } },
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

// The globe component: draws the map, the vessel markers, the fishing zones and the selected area,
// and lets the user drag a box to choose an area.
export function CaseMap({ groups, selectedId, onSelect, area, onAreaChange }: Props) {
  // Handles to things React does not own: the map's HTML container, the map itself, and the marker objects.
  const containerRef = useRef<HTMLDivElement>(null);
  // Holds the MapLibre map so effects and handlers can reach it without re-rendering.
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Holds the vessel markers currently on the map, so they can be removed and redrawn when the data changes.
  const markersRef = useRef<maplibregl.Marker[]>([]);
  // True once the map has finished loading and its layers exist.
  const [ready, setReady] = useState(false);
  // Globe (3D) or flat (2D) view.
  const [view, setView] = useState<View>("globe");
  // True while the user is in "draw a box" mode.
  const [selecting, setSelecting] = useState(false);
  // The rectangle currently being dragged, in screen pixels, so it can be drawn as feedback.
  const [dragBox, setDragBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Runs once: creates the map, adds the zoom and scale controls, and adds the fishing-zone and
  // selected-area layers once the map has loaded. Cleans the map up when the page is left.
  useEffect(() => {
    // Create the map inside our container, using the style and starting view above.
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: STYLE,
      center: HOME.center,
      zoom: HOME.zoom,
      attributionControl: { compact: true },
    });
    // Zoom buttons (top left) and a distance scale bar (bottom right).
    map.addControl(new maplibregl.NavigationControl({ showZoom: true, visualizePitch: false }), "top-left");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 140 }), "bottom-right");
    // Layers can only be added after the map has loaded.
    map.on("load", () => {
      // Teal outlines and tint for the illustrative fishing zones.
      map.addSource("zones", { type: "geojson", data: zonesGeoJson });
      map.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#2fd3c0", "fill-opacity": 0.1 } });
      map.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#2fd3c0", "line-width": 1.2 } });
      // Blue dashed rectangle for the area the user selected (starts empty).
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
    // Cleanup: remove the map so it does not leak when the user switches tabs.
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switches between the globe and flat map when the 3D / 2D toggle changes.
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
      // The triangle shape of the marker.
      el.innerHTML = '<svg viewBox="0 0 20 18" aria-hidden="true"><path d="M10 1 19 17H1Z"/></svg>';
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
    // Stop the map from panning or rotating so the drag draws a box, and show a crosshair cursor.
    map.dragPan.disable();
    map.dragRotate.disable();
    canvas.style.cursor = "crosshair";
    // Where the drag began, in pixels (null when no drag is in progress).
    let start: maplibregl.Point | null = null;

    // Converts a mouse event to a pixel position relative to the map.
    const point = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return new maplibregl.Point(e.clientX - r.left, e.clientY - r.top);
    };
    // Mouse pressed: remember the start corner and begin listening for movement and release.
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      start = point(e);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up, { once: true });
    };
    // Mouse moved: update the on-screen rectangle (handles dragging in any direction).
    const move = (e: MouseEvent) => {
      if (!start) return;
      // Where the mouse is now, in pixels on the map.
      const p = point(e);
      setDragBox({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
    };
    // Mouse released: turn the dragged rectangle into a latitude/longitude area.
    const up = (e: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      setDragBox(null);
      // Where the mouse was released, in pixels on the map.
      const end = point(e);
      // Ignore tiny drags (accidental clicks).
      if (start && Math.abs(end.x - start.x) > 4 && Math.abs(end.y - start.y) > 4) {
        // unproject converts a screen pixel on the globe to a real longitude/latitude.
        const a = map.unproject(start);
        // The opposite corner of the box, as longitude and latitude.
        const b = map.unproject(end);
        // Skip the result if a corner was off the globe (space), where there are no valid coordinates.
        if ([a.lng, a.lat, b.lng, b.lat].every(Number.isFinite)) {
          onAreaChange({
            west: Math.min(a.lng, b.lng),
            east: Math.max(a.lng, b.lng),
            south: Math.min(a.lat, b.lat),
            north: Math.max(a.lat, b.lat),
          });
        }
      }
      // One box per click of "Select area": leave draw mode.
      start = null;
      setSelecting(false);
    };

    canvas.addEventListener("mousedown", down);
    // Cleanup when draw mode ends: remove listeners and give the map its normal dragging back.
    return () => {
      canvas.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      canvas.style.cursor = "";
      map.dragPan.enable();
      map.dragRotate.enable();
    };
  }, [selecting, onAreaChange]);

  // Clears the selected area and flies the map back to the starting view.
  function clearArea() {
    onAreaChange(null);
    mapRef.current?.flyTo({ ...HOME, duration: 900 });
  }

  return (
    <div className="map-wrap">
      {/* The element MapLibre draws the globe into. */}
      <div ref={containerRef} className="map" />
      {/* Live rectangle shown while the user is dragging. */}
      {dragBox && (
        <div className="drag-box" style={{ left: dragBox.x, top: dragBox.y, width: dragBox.w, height: dragBox.h }} />
      )}

      {/* Instruction shown until the user picks an area. */}
      {!area && !selecting && (
        <div className="map-prompt">
          <strong>No area selected</strong>
          <span>Turn the globe to a region, click Select area, then drag a box to load the vessels inside it.</span>
        </div>
      )}
      {/* Reminder shown in draw mode before the drag begins. */}
      {selecting && !dragBox && <div className="map-prompt">Drag a box over the area you want to inspect.</div>}

      {/* Buttons in the top-right corner of the map. */}
      <div className="map-tools">
        {/* 3D globe / 2D flat map switch. */}
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
          className={selecting ? "is-on" : "primary"}
          onClick={() => setSelecting((s) => !s)}
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

      {/* Key explaining the marker colours, the count badge and the fishing-zone outline. */}
      <div className="map-legend">
        {/* Blue: the radar detection matched an AIS signal. */}
        <span>
          <i className="legend-mark marker-registered" />
          Registered (AIS matched)
        </span>
        {/* Orange: AIS coverage was adequate and no signal matched. */}
        <span>
          <i className="legend-mark marker-unregistered" />
          Unregistered (no AIS match)
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
      </div>
    </div>
  );
}
