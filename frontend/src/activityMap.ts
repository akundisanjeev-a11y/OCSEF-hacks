import type { FeatureCollection, Point, Polygon } from "geojson";
import type { ActivityCell, HistoricalQuery } from "./api/historical";

export const activityLayerNames: Record<HistoricalQuery["layer"], string> = {
  presence: "Boat activity", fishing: "Possible fishing activity", sar: "Satellite radar sightings",
};
export const activityUnits: Record<HistoricalQuery["layer"], string> = {
  presence: "hours boats were seen", fishing: "hours of possible fishing", sar: "radar sightings",
};

export function activityFeatures(cells: ActivityCell[]) {
  const valid = cells.filter(cell => Number.isFinite(cell.lat) && Number.isFinite(cell.lon) && Math.abs(cell.lat) <= 90 && Math.abs(cell.lon) <= 180 && Number.isFinite(cell.value) && cell.value > 0);
  const maximum = valid.reduce((top, cell) => Math.max(top, cell.value), 0);
  const points: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
  const squares: FeatureCollection<Polygon> = { type: "FeatureCollection", features: [] };
  for (const cell of valid) {
    // Log scaling keeps busy shipping lanes from hiding all quieter activity.
    // Keep the original value for inspection; intensity is only for styling.
    const properties = { ...cell, intensity: Math.log1p(cell.value) / Math.log1p(maximum) };
    points.features.push({ type: "Feature", properties, geometry: { type: "Point", coordinates: [cell.lon, cell.lat] } });
    const west = Math.max(-180, cell.lon - .05), east = Math.min(180, cell.lon + .05);
    const south = Math.max(-90, cell.lat - .05), north = Math.min(90, cell.lat + .05);
    squares.features.push({ type: "Feature", properties, geometry: { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] } });
  }
  return { points, squares, maximum };
}
