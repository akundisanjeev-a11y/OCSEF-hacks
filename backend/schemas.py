"""Shared API contracts for detection and investigation."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

DataMode = Literal["model_upload", "synthetic", "published_historical"]


class Position(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class MatchEvidence(BaseModel):
    candidate_distance_m: float = Field(ge=0)
    time_gap_seconds: float = Field(ge=0)
    matching_method: str


class Observation(BaseModel):
    observation_id: str = Field(min_length=1)
    scene_id: str
    data_mode: DataMode
    captured_at: datetime | None = None
    position: Position | None = None
    bbox_px: tuple[float, float, float, float] | None = None
    detection_confidence: float = Field(ge=0, le=1)
    identity_status: Literal["matched", "ambiguous", "unmatched", "insufficient_data"]
    mmsi: str | None = None
    imo: str | None = None
    match_evidence: MatchEvidence | None = None
    sources: list[str] = Field(default_factory=list)


class Authorization(BaseModel):
    status: Literal["unknown", "authorized", "potential_violation"]
    reason_codes: list[str]
    explanation: str
    sources: list[str] = Field(default_factory=list)


class VesselAssessment(BaseModel):
    vessel_type: Literal["possible_cargo_carrier", "possible_fishing_vessel", "unknown"] = "unknown"
    activity: Literal["confirmed_fishing", "possible_fishing", "unknown"] = "unknown"
    zone_id: str | None = None
    explanation: str
    sources: list[str] = Field(default_factory=list)


class Alert(BaseModel):
    code: str
    severity: Literal["info", "review", "high"]
    message: str
    sources: list[str] = Field(default_factory=list)


class ReviewPriority(BaseModel):
    level: Literal["routine", "review", "high"]
    explanation: str


class Case(BaseModel):
    observation: Observation
    authorization: Authorization
    vessel_assessment: VesselAssessment | None = None
    alerts: list[Alert] = Field(default_factory=list)
    review_priority: ReviewPriority | None = None


class CaseListResponse(BaseModel):
    cases: list[Case]
