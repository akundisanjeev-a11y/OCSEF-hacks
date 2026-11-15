import type { Map } from "maplibre-gl";

export type Basemap = "imagery" | "outline";

export function isImageryError(sourceId: unknown, message: string): boolean {
  return sourceId === "imagery" || sourceId === "places" || message.includes("server.arcgisonline.com");
}

export function applyBasemap(map: Pick<Map, "getLayer" | "setLayoutProperty">, mode: Basemap) {
  // Hide only remote backgrounds. Never reset the style: that would discard
  // the selected area, activity layers, markers and their event handlers.
  for (const id of ["imagery", "places"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", mode === "imagery" ? "visible" : "none");
  }
}
