import type { FeatureCollection, Polygon } from "geojson";
import type { Position } from "./api/types";
import zonesJson from "@fixtures/samples/fishing_zones.illustrative.json";

// Illustrative placeholder zones, not official boundaries. Replace the fixture when real shapes exist.
export const zonesGeoJson = zonesJson as unknown as FeatureCollection<Polygon, { name: string }>;

export interface ZoneProximity {
  zone: string;
  km: number;
  inside: boolean;
}

const zones = zonesGeoJson.features.map((f) => ({
  name: f.properties.name,
  ring: f.geometry.coordinates[0] as [number, number][],
}));

export const zoneNames = zones.map((z) => z.name);

function distanceKm(p: Position, ring: [number, number][]): { km: number; inside: boolean } {
  // Flat-earth approximation centred on the point; accurate enough at these distances.
  const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110.57;
  const pts = ring.map(([lon, lat]) => [(lon - p.lon) * kx, (lat - p.lat) * ky]);
  let min = Infinity;
  let inside = false;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy));
    if (ay > 0 !== by > 0 && ax + ((0 - ay) / (by - ay)) * dx > 0) inside = !inside;
  }
  return { km: inside ? 0 : min, inside };
}

export function nearestZone(p: Position | null): ZoneProximity | null {
  if (!p) return null;
  let best: ZoneProximity | null = null;
  for (const z of zones) {
    const d = distanceKm(p, z.ring);
    if (!best || d.km < best.km) best = { zone: z.name, ...d };
  }
  return best;
}

export function formatProximity(z: ZoneProximity | null): string {
  if (!z) return "Not available";
  if (z.inside) return `Inside ${z.zone}`;
  return z.km < 0.05 ? `On the edge of ${z.zone}` : `${z.km.toFixed(1)} km from ${z.zone}`;
}
