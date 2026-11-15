import { shipColors, shipKind, shipNames, shipPaths } from "../vesselSymbols";

export function ShipSymbol({ type }: { type?: string | null }) {
  const kind = shipKind(type);
  return <svg className="ship-type-symbol" role="img" aria-label={shipNames[kind]} viewBox="0 0 34 34" width="24" height="24"><path d={shipPaths[kind]} fill={shipColors[kind]} /></svg>;
}
