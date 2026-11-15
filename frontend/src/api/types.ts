// Mirrors backend/schemas.py. Keep field names identical to the Pydantic models.

// Where a record came from: a model run on an uploaded image, fictional demo data, or published real data.
export type DataMode = "model_upload" | "synthetic" | "published_historical";
// Result of matching a radar detection to AIS tracking signals. Only "matched" counts as registered in the UI.
export type IdentityStatus = "matched" | "ambiguous" | "unmatched" | "insufficient_data";
// The permit decision for a vessel.
export type AuthorizationStatus = "authorized" | "potential_violation" | "unknown";
// How urgently a human should look at a case.
export type ReviewLevel = "routine" | "review" | "high";
// How serious an alert is.
export type AlertSeverity = "info" | "review" | "high";
// The backend's tentative guess at what kind of vessel it is.
export type VesselType = "possible_cargo_carrier" | "possible_fishing_vessel" | "unknown";
// What the vessel appears to be doing.
export type Activity = "confirmed_fishing" | "possible_fishing" | "unknown";

// A point on Earth in decimal degrees. Mirrors `Position` in backend/schemas.py.
export interface Position {
  lat: number;
  lon: number;
}

// Details of how an AIS track was matched to a detection. Mirrors `MatchEvidence`.
export interface MatchEvidence {
  candidate_distance_m: number;
  time_gap_seconds: number;
  matching_method: string;
}

// One ship seen by radar, plus its AIS identity. Mirrors `Observation`.
export interface Observation {
  observation_id: string;
  scene_id: string;
  data_mode: DataMode;
  // UTC capture time and map position; null when the image has no metadata.
  captured_at: string | null;
  position: Position | null;
  // Box around the ship in image pixels: [x_min, y_min, x_max, y_max]. Null when there is no image box.
  bbox_px: [number, number, number, number] | null;
  // The detector's score from 0 to 1, kept separate from how certain the AIS match is.
  detection_confidence: number;
  // Result of the AIS match, with the vessel's ID numbers when a match supports them.
  identity_status: IdentityStatus;
  mmsi: string | null;
  imo: string | null;
  match_evidence: MatchEvidence | null;
  // Where the detection and identity evidence came from.
  sources: string[];
}

// The permit decision and why it was made. Mirrors `Authorization`.
export interface Authorization {
  status: AuthorizationStatus;
  reason_codes: string[];
  explanation: string;
  sources: string[];
}

// A tentative read on vessel type and activity. Mirrors `VesselAssessment`.
export interface VesselAssessment {
  vessel_type: VesselType;
  activity: Activity;
  zone_id: string | null;
  explanation: string;
  sources: string[];
}

// A flag the backend raises on a case, such as a possible permit conflict. Mirrors `Alert`.
export interface Alert {
  code: string;
  severity: AlertSeverity;
  message: string;
  sources: string[];
}

// The review urgency and the reason for it. Mirrors `ReviewPriority`.
export interface ReviewPriority {
  level: ReviewLevel;
  explanation: string;
}

// A full investigation case: the observation plus every decision made about it. Mirrors `Case`.
export interface Case {
  observation: Observation;
  authorization: Authorization;
  vessel_assessment: VesselAssessment | null;
  alerts: Alert[];
  review_priority: ReviewPriority | null;
}

// Response of GET /cases. Mirrors `CaseListResponse`.
export interface CasesResponse {
  cases: Case[];
}

// Response of POST /demo/run: the ids of the cases it created or updated.
export interface DemoRunResponse {
  case_ids: string[];
}

// Response of POST /detections: the image size (so boxes can be drawn at the right scale) and the detected ships.
export interface DetectionsResponse {
  image_width: number;
  image_height: number;
  observations: Observation[];
}
