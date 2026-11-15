import type { Area } from "./api/historical";

export const SELECTION_LIMIT_MESSAGE = "Select a valid rectangle on the map. Split selections crossing the date line.";
export function validSelection(area: Area) {
  return Object.values(area).every(Number.isFinite) && area.west >= -180 && area.east <= 180 && area.south >= -90 && area.north <= 90 && area.west < area.east && area.south < area.north;
}
