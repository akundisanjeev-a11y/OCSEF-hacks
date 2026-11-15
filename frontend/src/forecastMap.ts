import type { FeatureCollection, LineString, Polygon } from "geojson";
import type { Area } from "./api/historical";
import type { ScoredForecast } from "./api/forecast";

export type ForecastComparison = { cells: ScoredForecast[]; attempted: number; unavailable: number };
export type ActivityArrow = { from_id: string; to_id: string; from_hours: number; to_hours: number; difference: number };
export const center = (bounds: Area): [number, number] => [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
export function neighborPoints(bounds: Area): [number, number][] {
  const [lon, lat] = center(bounds), width = bounds.east - bounds.west, height = bounds.north - bounds.south;
  const points: [number, number][] = [];
  for (const y of [-1, 0, 1]) for (const x of [-1, 0, 1]) {
    const nextLon = lon + x * width, nextLat = lat + y * height;
    if ((x || y) && nextLon > -180 && nextLon < 180 && nextLat > -90 && nextLat < 90) points.push([nextLon, nextLat]);
  }
  return points;
}
export function sameForecastPeriod(a: ScoredForecast, b: ScoredForecast) {
  return a.model_version === b.model_version && a.source_dataset === b.source_dataset && a.observation_cutoff === b.observation_cutoff && a.target_start === b.target_start && a.target_end === b.target_end;
}
export function forecastFeatures(comparison: ForecastComparison | null) {
  const cells: FeatureCollection<Polygon> = { type: "FeatureCollection", features: [] };
  const arrows: FeatureCollection<LineString> = { type: "FeatureCollection", features: [] };
  const heads: FeatureCollection<Polygon> = { type: "FeatureCollection", features: [] };
  const forecasts = (comparison?.cells ?? []).filter(row => Number.isFinite(row.predicted_week_hours) && row.predicted_week_hours >= 0);
  for (const from of forecasts) {
    const { west, south, east, north } = from.bounds;
    cells.features.push({ type: "Feature", properties: { cell_id: from.cell_id, predicted_hours: from.predicted_week_hours }, geometry: { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] } });
    const a = center(from.bounds);
    const candidates = forecasts.filter(to => {
      const b = center(to.bounds);
      return to.cell_id !== from.cell_id && sameForecastPeriod(from, to) && to.predicted_week_hours > from.predicted_week_hours && Math.abs(b[0] - a[0]) <= east - west + 1e-6 && Math.abs(b[1] - a[1]) <= north - south + 1e-6;
    }).sort((x, y) => y.predicted_week_hours - x.predicted_week_hours || x.cell_id.localeCompare(y.cell_id));
    const to = candidates[0];
    if (!to) continue;
    const b = center(to.bounds), dx = b[0] - a[0], dy = b[1] - a[1];
    const tail: [number, number] = [a[0] + dx * .2, a[1] + dy * .2];
    const tip: [number, number] = [a[0] + dx * .8, a[1] + dy * .8];
    const properties: ActivityArrow = { from_id: from.cell_id, to_id: to.cell_id, from_hours: from.predicted_week_hours, to_hours: to.predicted_week_hours, difference: to.predicted_week_hours - from.predicted_week_hours };
    arrows.features.push({ type: "Feature", properties, geometry: { type: "LineString", coordinates: [tail, tip] } });
    heads.features.push({ type: "Feature", properties, geometry: { type: "Polygon", coordinates: [[tip, [tip[0] - dx * .15 - dy * .07, tip[1] - dy * .15 + dx * .07], [tip[0] - dx * .15 + dy * .07, tip[1] - dy * .15 - dx * .07], tip]] } });
  }
  return { cells, arrows, heads };
}
