import { describe, expect, it } from "vitest";
import { lengthScale, shipKind } from "./vesselSymbols";

describe("vessel symbols and reported size", () => {
  it("separates fishing, cargo, carriers, tankers and passenger vessels", () => {
    expect(shipKind("FISHING")).toBe("fishing");
    expect(shipKind("trawlers")).toBe("fishing");
    expect(shipKind("possible_cargo_carrier")).toBe("carrier");
    expect(shipKind("CONTAINER")).toBe("cargo");
    expect(shipKind("OIL_TANKER")).toBe("tanker");
    expect(shipKind("ferry")).toBe("passenger");
    expect(shipKind("tug")).toBe("tug");
  });
  it("does not mistake non-fishing or missing data for a fishing vessel", () => {
    expect(shipKind("OTHER_NON_FISHING")).toBe("other");
    expect(shipKind(undefined)).toBe("unknown");
    expect(shipKind("mixed")).toBe("mixed");
  });
  it("uses a fixed fallback for missing size and a bounded relative scale for lengths", () => {
    expect(lengthScale(null)).toBe(1);
    expect(lengthScale(NaN)).toBe(1);
    expect(lengthScale(-10)).toBe(1);
    expect(lengthScale(100)).toBeGreaterThan(lengthScale(10));
    expect(lengthScale(10000)).toBeLessThanOrEqual(1.5);
  });
});
