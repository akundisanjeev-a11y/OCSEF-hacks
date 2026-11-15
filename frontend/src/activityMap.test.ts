import { expect, test } from "vitest";
import { activityFeatures } from "./activityMap";
import type { ActivityCell } from "./api/historical";

const cell = (id: string, value: number, changes: Partial<ActivityCell> = {}): ActivityCell => ({ id, value, lat: 4, lon: 1, date: "2026-01-01", vessel_type: "unknown", ...changes });

test("activity intensity preserves reported values without inventing individual boats", () => {
  const result = activityFeatures([cell("quiet", .5, { vessel_count_lower_bound: 20 }), cell("busy", 1000)]);
  expect(result.points.features).toHaveLength(2);
  expect(result.squares.features).toHaveLength(2);
  expect(result.points.features[0].properties?.value).toBe(.5);
  expect(result.points.features[0].properties?.intensity).toBeGreaterThan(0);
  expect(result.points.features[1].properties?.intensity).toBe(1);
  expect(result.points.features[0].properties).not.toHaveProperty("vessel_id");
  expect(result.maximum).toBe(1000);
});

test("empty, invalid and zero activity does not create hotspots; edge squares stay in world bounds", () => {
  expect(activityFeatures([cell("zero", 0), cell("bad", NaN), cell("outside", 1, { lat: 100 })]).points.features).toHaveLength(0);
  const result = activityFeatures([cell("edge", 1, { lat: 90, lon: 180 })]);
  for (const [lon, lat] of result.squares.features[0].geometry.coordinates[0]) {
    expect(lon).toBeLessThanOrEqual(180);
    expect(lat).toBeLessThanOrEqual(90);
  }
});
