// Mirrors backend/schemas.py. Keep field names identical to the Pydantic models.

export type DataMode = "model_upload" | "synthetic" | "published_historical";
export type IdentityStatus = "matched" | "ambiguous" | "unmatched" | "insufficient_data";
export type AuthorizationStatus = "authorized" | "potential_violation" | "unknown";
export type ReviewLevel = "routine" | "review" | "high";
export type AlertSeverity = "info" | "review" | "high";
export type VesselType = "possible_cargo_carrier" | "possible_fishing_vessel" | "unknown";
export type Activity = "confirmed_fishing" | "possible_fishing" | "unknown";

export interface Position {
  lat: number;
  lon: number;
}

export interface MatchEvidence {
  candidate_distance_m: number;
  time_gap_seconds: number;
  matching_method: string;
}

export interface Observation {
  observation_id: string;
  scene_id: string;
  data_mode: DataMode;
  captured_at: string | null;
  position: Position | null;
  bbox_px: [number, number, number, number] | null;
  detection_confidence: number;
  identity_status: IdentityStatus;
  mmsi: string | null;
  imo: string | null;
  match_evidence: MatchEvidence | null;
  sources: string[];
}

export interface Authorization {
  status: AuthorizationStatus;
  reason_codes: string[];
  explanation: string;
  sources: string[];
}

export interface VesselAssessment {
  vessel_type: VesselType;
  activity: Activity;
  zone_id: string | null;
  explanation: string;
  sources: string[];
}

export interface Alert {
  code: string;
  severity: AlertSeverity;
  message: string;
  sources: string[];
}

export interface ReviewPriority {
  level: ReviewLevel;
  explanation: string;
}

export interface Case {
  observation: Observation;
  authorization: Authorization;
  vessel_assessment: VesselAssessment | null;
  alerts: Alert[];
  review_priority: ReviewPriority | null;
}

export interface CasesResponse {
  cases: Case[];
}

export interface DemoRunResponse {
  case_ids: string[];
}

export interface DetectionsResponse {
  image_width: number;
  image_height: number;
  observations: Observation[];
}
