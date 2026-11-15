import { describe, expect, it, vi } from "vitest";
import { applyBasemap, isImageryError } from "./mapBasemap";

describe("basemap failure recovery", () => {
  it("recognizes Esri imagery errors without treating activity-data errors as imagery failures", () => {
    expect(isImageryError(undefined, "AJAXError: Failed to fetch https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/6/29/27")).toBe(true);
    expect(isImageryError("places", "Failed to fetch")).toBe(true);
    expect(isImageryError("historical-activity", "Invalid GeoJSON")).toBe(false);
  });

  it("hides only remote basemaps while retaining activity and selection layers", () => {
    const map = { getLayer: vi.fn().mockReturnValue({}), setLayoutProperty: vi.fn() };
    applyBasemap(map, "outline");
    expect(map.setLayoutProperty.mock.calls).toEqual([["imagery", "visibility", "none"], ["places", "visibility", "none"]]);
    expect(map.getLayer).not.toHaveBeenCalledWith("historical-activity");
    expect(map.getLayer).not.toHaveBeenCalledWith("area-line");
  });

  it("can restore imagery without resetting the map", () => {
    const map = { getLayer: vi.fn().mockReturnValue({}), setLayoutProperty: vi.fn() };
    applyBasemap(map, "imagery");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("imagery", "visibility", "visible");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("places", "visibility", "visible");
  });
});
