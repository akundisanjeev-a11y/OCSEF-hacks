import type {
  Activity,
  AlertSeverity,
  AuthorizationStatus,
  DataMode,
  IdentityStatus,
  Position,
  ReviewLevel,
  VesselType,
} from "./api/types";

export const authorizationLabel: Record<AuthorizationStatus, string> = {
  authorized: "Authorized",
  potential_violation: "Potential violation",
  unknown: "Unknown",
};

export const identityLabel: Record<IdentityStatus, string> = {
  matched: "Matched",
  ambiguous: "Ambiguous",
  unmatched: "Unmatched",
  insufficient_data: "Insufficient data",
};

export const dataModeLabel: Record<DataMode, string> = {
  synthetic: "Fictional",
  published_historical: "Published historical",
  model_upload: "Model upload",
};

export const reviewLabel: Record<ReviewLevel, string> = {
  high: "High",
  review: "Review",
  routine: "Routine",
};

export const severityLabel: Record<AlertSeverity, string> = {
  high: "High",
  review: "Review",
  info: "Info",
};

export const vesselTypeLabel: Record<VesselType, string> = {
  possible_fishing_vessel: "Possible fishing vessel",
  possible_cargo_carrier: "Possible cargo carrier",
  unknown: "Unknown",
};

export const activityLabel: Record<Activity, string> = {
  confirmed_fishing: "Confirmed fishing",
  possible_fishing: "Possible fishing",
  unknown: "Unknown",
};

export function formatTime(iso: string | null): string {
  if (!iso) return "Not available";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, " UTC");
}

export function formatPosition(p: Position | null): string {
  if (!p) return "Not available";
  const lat = `${Math.abs(p.lat).toFixed(4)}° ${p.lat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(p.lon).toFixed(4)}° ${p.lon >= 0 ? "E" : "W"}`;
  return `${lat}, ${lon}`;
}

export type Registration = "registered" | "unregistered" | "unresolved";

// Legacy internal color keys describe AIS matching, not legal registration.
export const registration = (s: IdentityStatus): Registration =>
  s === "matched" ? "registered" : s === "unmatched" ? "unregistered" : "unresolved";

export const registrationLabel: Record<Registration, string> = {
  registered: "AIS matched",
  unregistered: "No AIS match",
  unresolved: "Unresolved",
};
