import { shipColors, shipDetails, shipKind, shipNames, shipPaths } from "../vesselSymbols";

export function ShipSymbol({ type }: { type?: string | null }) {
  const kind = shipKind(type);
  return <svg className={`ship-type-symbol ship-${kind}`} role="img" aria-label={shipNames[kind]} viewBox="0 0 34 34" width="34" height="34"><rect x=".5" y=".5" width="33" height="33" rx="8" fill="#0c213a" stroke={shipColors[kind]} strokeOpacity=".4" /><path d={shipPaths[kind]} fill={shipColors[kind]} />{shipDetails[kind] && <path d={shipDetails[kind]} fill="none" stroke="#092236" strokeWidth="1.4" strokeLinecap="round" />}{kind === "unknown" && <text x="17" y="23" textAnchor="middle" fill="#0c213a" fontSize="19" fontWeight="bold">?</text>}</svg>;
}
