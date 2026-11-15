import type { Area } from "./api/historical";

export const SELECTION_LIMIT_MESSAGE = "Area too large. Select no more than 40° longitude by 30° latitude, within 85° south/north. Split selections crossing the date line.";
export function validSelection(area: Area) {
  return Object.values(area).every(Number.isFinite) && area.west >= -180 && area.east <= 180 && area.south >= -85 && area.north <= 85 && area.west < area.east && area.south < area.north && area.east - area.west <= 40 && area.north - area.south <= 30;
}
