import type { FeatureCollection, Polygon } from "geojson";
import type { Position } from "./api/types";
import zonesJson from "@fixtures/samples/fishing_zones.illustrative.json";

// The fishing zones drawn on the map, loaded from fixtures/samples/. They are hand-drawn placeholders,
// not official boundaries. Replace the fixture when real shapes exist.
export const zonesGeoJson = zonesJson as unknown as FeatureCollection<Polygon, { name: string }>;

// How close a point is to the nearest zone: its name, the distance in km, and whether the point is inside it.
export interface ZoneProximity {
  zone: string;
  km: number;
  inside: boolean;
}

// Each zone reduced to its name and outline ring (a list of [longitude, latitude] corners) for the distance maths.
const zones = zonesGeoJson.features.map((f) => ({
  name: f.properties.name,
  ring: f.geometry.coordinates[0] as [number, number][],
}));

// Just the zone names, used to build the per-zone rows of the coastal impact report.
export const zoneNames = zones.map((z) => z.name);

// Finds how far a point is from one zone's outline, and whether the point lies inside the zone.
// It treats the area as flat, with the point at the origin, then measures the shortest distance to each edge
// and uses a ray-crossing test to decide "inside". Accurate enough at these distances.
function distanceKm(p: Position, ring: [number, number][]): { km: number; inside: boolean } {
  // Flat-earth approximation centred on the point; accurate enough at these distances.
  // One degree of longitude gets shorter further from the equator, so scale it by cos(latitude).
  const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180);
  // Kilometres per degree of latitude, which stays roughly constant.
  const ky = 110.57;
  // Convert every corner to kilometres east and north of the point.
  const pts = ring.map(([lon, lat]) => [(lon - p.lon) * kx, (lat - p.lat) * ky]);
  // min: closest distance found so far. inside: flips each time a ray from the point crosses an edge.
  let min = Infinity;
  // Flips each time a ray from the point crosses an edge; true at the end means the point is inside.
  let inside = false;
  // Walk each edge of the outline (corner i to corner i + 1).
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    // The edge's east-west length in km.
    const dx = bx - ax;
    // The edge's north-south length in km.
    const dy = by - ay;
    // Closest spot on this edge to the origin, clamped so it stays between the two corners.
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy));
    // Ray-crossing test: does this edge cross the horizontal line through the point, to its right?
    if (ay > 0 !== by > 0 && ax + ((0 - ay) / (by - ay)) * dx > 0) inside = !inside;
  }
  // A point inside a zone is 0 km from it.
  return { km: inside ? 0 : min, inside };
}

// Finds the closest zone to a point and how far away it is. Returns null when the vessel has no position.
export function nearestZone(p: Position | null): ZoneProximity | null {
  if (!p) return null;
  // The closest zone found so far.
  let best: ZoneProximity | null = null;
  // Check every zone and keep the closest one.
  for (const z of zones) {
    const d = distanceKm(p, z.ring);
    if (!best || d.km < best.km) best = { zone: z.name, ...d };
  }
  return best;
}

// Turns a proximity result into a sentence such as "Inside Illustrative zone East" or "12.4 km from ...".
export function formatProximity(z: ZoneProximity | null): string {
  if (!z) return "Not available";
  if (z.inside) return `Inside ${z.zone}`;
  // A distance under 50 metres would read "0.0 km", so say it is on the edge instead.
  return z.km < 0.05 ? `On the edge of ${z.zone}` : `${z.km.toFixed(1)} km from ${z.zone}`;
}
