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

// The backend sends codes like "potential_violation"; these maps turn each one into the text people see.

// Text for the permit decision.
export const authorizationLabel: Record<AuthorizationStatus, string> = {
  authorized: "Authorized",
  potential_violation: "Potential violation",
  unknown: "Unknown",
};

// Text for the AIS match result.
export const identityLabel: Record<IdentityStatus, string> = {
  matched: "Matched",
  ambiguous: "Ambiguous",
  unmatched: "Unmatched",
  insufficient_data: "Insufficient data",
};

// Text for where a record came from. "synthetic" is shown as "Fictional" so demo data is never mistaken for real.
export const dataModeLabel: Record<DataMode, string> = {
  synthetic: "Fictional",
  published_historical: "Published historical",
  model_upload: "Model upload",
};

// Text for how urgently a case needs human review.
export const reviewLabel: Record<ReviewLevel, string> = {
  high: "High",
  review: "Review",
  routine: "Routine",
};

// Text for how serious an alert is.
export const severityLabel: Record<AlertSeverity, string> = {
  high: "High",
  review: "Review",
  info: "Info",
};

// Text for the tentative vessel type.
export const vesselTypeLabel: Record<VesselType, string> = {
  possible_fishing_vessel: "Possible fishing vessel",
  possible_cargo_carrier: "Possible cargo carrier",
  unknown: "Unknown",
};

// Text for the vessel's apparent activity.
export const activityLabel: Record<Activity, string> = {
  confirmed_fishing: "Confirmed fishing",
  possible_fishing: "Possible fishing",
  unknown: "Unknown",
};

// Turns an ISO timestamp into a short UTC string such as "2026-01-01 10:00 UTC". Missing times read "Not available".
export function formatTime(iso: string | null): string {
  if (!iso) return "Not available";
  // Parse the text into a date.
  const d = new Date(iso);
  // If the text is not a valid date, show it as it was sent rather than "Invalid Date".
  if (Number.isNaN(d.getTime())) return iso;
  // Drop the seconds and milliseconds, and replace the trailing "Z" with " UTC".
  return d.toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, " UTC");
}

// Turns coordinates into a readable string such as "5.4120° N, 0.1020° W".
export function formatPosition(p: Position | null): string {
  if (!p) return "Not available";
  // Latitude is N or S and longitude is E or W; the number itself is always shown as positive.
  const lat = `${Math.abs(p.lat).toFixed(4)}° ${p.lat >= 0 ? "N" : "S"}`;
  // Longitude written as degrees East or West.
  const lon = `${Math.abs(p.lon).toFixed(4)}° ${p.lon >= 0 ? "E" : "W"}`;
  return `${lat}, ${lon}`;
}

// The simpler three-way grouping used for map colours and counts: blue, orange and grey vessels.
export type Registration = "registered" | "unregistered" | "unresolved";

// Legacy internal color keys describe AIS matching, not legal registration.
// "Registered" here means the radar detection matched an AIS track.
// "Unregistered" means AIS coverage was adequate but nothing matched; ambiguous or missing data stays "unresolved".
export const registration = (s: IdentityStatus): Registration =>
  s === "matched" ? "registered" : s === "unmatched" ? "unregistered" : "unresolved";

// Text for the three registration groups.
export const registrationLabel: Record<Registration, string> = {
  registered: "AIS matched",
  unregistered: "No AIS match",
  unresolved: "Unresolved",
};
