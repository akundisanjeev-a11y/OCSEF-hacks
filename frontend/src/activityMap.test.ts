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

test("large-area heatmap and zoomed squares preserve all 40000 activity cells", () => {
  const cells = Array.from({ length: 40000 }, (_, i) => cell(String(i), i % 100 + .5, { lat: -19 + Math.floor(i / 800), lon: -49 + (i % 800) * .09 }));
  const result = activityFeatures(cells);
  expect(result.points.features).toHaveLength(cells.length);
  expect(result.squares.features).toHaveLength(cells.length);
  expect(new Set(result.points.features.map(feature => feature.properties?.id)).size).toBe(cells.length);
  expect(result.points.features.reduce((sum, feature) => sum + Number(feature.properties?.value), 0)).toBe(cells.reduce((sum, item) => sum + item.value, 0));
  for (const feature of result.points.features) {
    expect(feature.properties?.intensity).toBeGreaterThan(0);
    expect(feature.properties?.intensity).toBeLessThanOrEqual(1);
  }
});
