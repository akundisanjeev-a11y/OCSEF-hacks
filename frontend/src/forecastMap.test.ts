import { expect, test } from "vitest";
import { forecastFeatures, neighborPoints, type ForecastComparison } from "./forecastMap";
import type { ScoredForecast } from "./api/forecast";

function forecast(id: string, west: number, hours: number): ScoredForecast {
  return { status: "scored", data_mode: "historical_demo", observation_cutoff: "2025-07-31", simulated_issue_date: "2025-08-03", target_start: "2025-08-04", target_end: "2025-08-10", cell_id: id, bounds: { west, east: west + 5, south: 25, north: 30 }, predicted_week_hours: hours, repeat_last_week_hours: 10, model_version: "one-model", source_dataset: "one-source", selected_explanation: "Saved model explanation", interpretation: "Activity, not travel", data_quality_notes: [], seasonal_reference_available: true, decision_path: [] };
}
test("comparison arrows lead only toward strictly higher adjacent predictions", () => {
  const comparison: ForecastComparison = { cells: [forecast("low", 115, 10), forecast("high", 120, 100), forecast("medium", 125, 50)], attempted: 3, unavailable: 0 };
  const data = forecastFeatures(comparison);
  expect(data.arrows.features).toHaveLength(2);
  expect(data.heads.features).toHaveLength(2);
  expect(data.arrows.features.every(feature => feature.properties?.to_id === "high" && feature.properties?.difference > 0)).toBe(true);
});
test("equal predictions, mismatched periods and missing neighbors do not invent arrows", () => {
  const a = forecast("a", 115, 10), b = forecast("b", 120, 10);
  expect(forecastFeatures({ cells: [a, b], attempted: 2, unavailable: 0 }).arrows.features).toHaveLength(0);
  expect(forecastFeatures({ cells: [a, { ...b, predicted_week_hours: 100, target_start: "2026-08-04" }], attempted: 2, unavailable: 0 }).arrows.features).toHaveLength(0);
  expect(forecastFeatures({ cells: [a], attempted: 9, unavailable: 8 }).arrows.features).toHaveLength(0);
  expect(forecastFeatures(null).cells.features).toHaveLength(0);
});
test("neighbor queries remain inside valid world coordinates at poles and date line", () => {
  expect(neighborPoints({ west: 120, east: 125, south: 25, north: 30 })).toHaveLength(8);
  const points = neighborPoints({ west: 175, east: 180, south: 85, north: 90 });
  expect(points).toHaveLength(3);
  expect(points.every(([lon, lat]) => lon > -180 && lon < 180 && lat > -90 && lat < 90)).toBe(true);
});
