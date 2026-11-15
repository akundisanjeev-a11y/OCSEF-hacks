export type ShipKind = "fishing" | "cargo" | "carrier" | "tanker" | "passenger" | "tug" | "other" | "mixed" | "unknown";
export const shipColors: Record<ShipKind, string> = { fishing: "#34dec2", cargo: "#69adff", carrier: "#bba0ff", tanker: "#f3b764", passenger: "#f08bb6", tug: "#e4db83", other: "#c1cbd3", mixed: "#f1f4f7", unknown: "#9baeba" };
export const shipNames: Record<ShipKind, string> = { fishing: "Fishing boat", cargo: "Cargo ship", carrier: "Carrier / transport ship", tanker: "Tanker", passenger: "Passenger ship", tug: "Tug / service boat", other: "Other boat", mixed: "Several boat types", unknown: "Boat type not reported" };
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
  fishing: "M3 23H31L26 30H10ZM7 15H15V22H7ZM9 12H14V15H9ZM18 6H20V22H18ZM20 7L30 17L28 19L19 10Z",
  cargo: "M2 23H32L27 30H8ZM4 13H12V21H4ZM14 13H22V21H14ZM14 5H22V11H14ZM24 15H29V21H24ZM25 11H29V15H25Z",
  carrier: "M2 23H32L27 30H8ZM4 12H23V21H4ZM25 15H30V21H25ZM26 10H29V15H26Z",
  tanker: "M2 23H32L27 30H8ZM5 17A4 4 0 018 13H20A4 4 0 0123 17V21H5ZM25 14H30V21H25ZM26 10H29V14H26Z",
  passenger: "M2 23H32L27 30H8ZM5 17H29V21H5ZM8 11H26V15H8ZM12 6H23V9H12Z",
  tug: "M4 23H31L26 30H10ZM10 13H23V21H10ZM14 8H21V13H14ZM7 19H10V22H7Z",
  other: "M4 23H30L25 30H10ZM10 15H23V21H10ZM15 9H18V15H15Z",
  mixed: "M4 12H14V22H4ZM20 12H30V22H20ZM4 25H14V30H4ZM20 25H30V30H20Z",
  unknown: "M17 5L29 17L17 29L5 17ZM15 12H19V20H15ZM15 23H19V26H15Z",
};

export const shipDetails: Partial<Record<ShipKind, string>> = {
  fishing: "M9 18H12M23 14V22M27 18V22",
  cargo: "M8 15V19M18 15V19M18 7V9M26 18H28",
  carrier: "M8 15H19M8 18H19M27 17H28",
  tanker: "M10 15V19M16 15V19M27 17H28",
  passenger: "M9 19H11M15 19H17M21 19H23M12 13H14M19 13H21",
  tug: "M14 16H19M8 25H12",
  other: "M13 18H19",
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
