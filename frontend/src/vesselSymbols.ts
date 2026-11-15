export type ShipKind = "fishing" | "cargo" | "carrier" | "tanker" | "passenger" | "tug" | "other" | "mixed" | "unknown";
export const shipColors: Record<ShipKind, string> = { fishing: "#34dec2", cargo: "#69adff", carrier: "#bba0ff", tanker: "#f3b764", passenger: "#f08bb6", tug: "#e4db83", other: "#c1cbd3", mixed: "#f1f4f7", unknown: "#9baeba" };
export const shipNames: Record<ShipKind, string> = { fishing: "Fishing", cargo: "Cargo", carrier: "Carrier", tanker: "Tanker", passenger: "Passenger", tug: "Tug/service", other: "Other", mixed: "Mixed types", unknown: "Type unknown" };
export function shipKind(value?: string | null): ShipKind {
  const type = (value ?? "").toLowerCase();
  if (type === "mixed") return "mixed";
  if (/tanker/.test(type)) return "tanker";
  if (/carrier|reefer/.test(type)) return "carrier";
  if (/cargo|container|merchant/.test(type)) return "cargo";
  if (/passenger|ferry|cruise/.test(type)) return "passenger";
  if (/tug|supply|service/.test(type)) return "tug";
  if (/non.?fishing/.test(type)) return "other";
  if (/fishing|trawl|seine|longlin|gillnet|dredg|pot_and_trap|pole_and_line|squid/.test(type)) return "fishing";
  if (/other|pleasure|sail|research/.test(type)) return "other";
  return "unknown";
}

export function lengthScale(length?: number | null): number {
  // Relative visual scale, never meters-to-map-pixels or a class-based estimate.
  return length && Number.isFinite(length) && length > 0 ? Math.max(.7, Math.min(1.5, .55 + Math.sqrt(length) / 18)) : 1;
}

export const shipPaths: Record<ShipKind, string> = {
  fishing: "M5 23H29L24 30H10ZM15 21V6L27 18H17V21ZM12 9H24V11H12Z",
  cargo: "M3 23H31L26 30H8ZM6 12H13V21H6ZM15 12H22V21H15ZM24 16H29V21H24Z",
  carrier: "M3 23H31L26 30H8ZM6 11H23V21H6ZM25 16H29V21H25ZM10 15H19V17H10Z",
  tanker: "M3 23H31L26 30H8ZM7 12H12V21H7ZM14 12H19V21H14ZM21 12H26V21H21Z",
  passenger: "M3 23H31L26 30H8ZM6 17H28V21H6ZM9 12H25V15H9ZM12 7H22V10H12Z",
  tug: "M4 23H30L25 30H9ZM11 14H23V21H11ZM14 8H20V12H14Z",
  other: "M4 23H30L25 30H9ZM11 13H23V21H11Z",
  mixed: "M4 12H14V22H4ZM20 12H30V22H20ZM4 25H14V30H4ZM20 25H30V30H20Z",
  unknown: "M17 5L29 17L17 29L5 17ZM15 12H19V20H15ZM15 23H19V26H15Z",
};

export function makeMapSymbol(id: string): ImageData | null {
  const cluster = /^fleet-cluster-(\d+)$/.exec(id);
  const cell = /^fleet-cell-([a-z]+)-(unknown|lower\d+)$/.exec(id);
  if (!cluster && !cell) return null;
  const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 80;
  const ctx = canvas.getContext("2d"); if (!ctx) return null;
  ctx.fillStyle = "#0a2135"; ctx.strokeStyle = "#7897ae"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(40, 40, 34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (cluster) {
    ctx.fillStyle = "#eef7ff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "bold 26px sans-serif"; ctx.fillText(cluster[1], 40, 38);
    ctx.font = "12px sans-serif"; ctx.fillText("cells", 40, 59);
  } else if (cell) {
    const kind = cell[1] in shipColors ? cell[1] as ShipKind : "unknown";
    ctx.save(); ctx.translate(15, 3); ctx.scale(1.45, 1.45); ctx.fillStyle = shipColors[kind]; ctx.fill(new Path2D(shipPaths[kind])); ctx.restore();
    ctx.fillStyle = "#eef7ff"; ctx.font = "bold 21px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(cell[2] === "unknown" ? "?" : "≥" + cell[2].slice(5), 40, 67);
  }
  return ctx.getImageData(0, 0, 80, 80);
}
