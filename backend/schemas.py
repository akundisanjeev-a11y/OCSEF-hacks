"""Shared contract. Authorization decisions belong to the other backend owner."""

from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


DataMode = Literal["model_upload", "synthetic", "published_historical"]
IdentityStatus = Literal["matched", "ambiguous", "unmatched", "insufficient_data"]
MMSI = Annotated[str, Field(pattern=r"^[0-9]{9}$")]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Position(ContractModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class Candidate(ContractModel):
    mmsi: MMSI
    estimated_position: Position
    distance_m: float = Field(ge=0)
    max_supporting_time_gap_s: float = Field(ge=0)
    supporting_timestamps: list[AwareDatetime]


class MatchEvidence(ContractModel):
    method: str = "bracketed_linear_interpolation_haversine"
    reason_codes: list[str]
    candidates: list[Candidate] = Field(default_factory=list)
    distance_gate_m: float
    time_gate_s: float
    coverage_source: str | None = None


class Observation(ContractModel):
    observation_id: str = Field(min_length=1)
    scene_id: str = Field(min_length=1)
    data_mode: DataMode
    captured_at: AwareDatetime | None = None
    position: Position | None = None
    bbox_px: tuple[float, float, float, float] | None = None
    detection_confidence: float | None = Field(default=None, ge=0, le=1)
    identity_status: IdentityStatus = "insufficient_data"
    mmsi: MMSI | None = None
    imo: str | None = None
    match_evidence: MatchEvidence | None = None
    sources: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_observation(self):
        if self.bbox_px is not None:
            x1, y1, x2, y2 = self.bbox_px
            if x1 < 0 or y1 < 0 or x2 <= x1 or y2 <= y1:
                raise ValueError("bbox_px must contain positive-area xyxy pixel coordinates")
        if (self.identity_status == "matched") != (self.mmsi is not None):
            raise ValueError("Only a matched observation may have an MMSI, and it must have one")
        return self


class DetectionResponse(ContractModel):
    image_width: int
    image_height: int
    observations: list[Observation]


class AISPoint(ContractModel):
    mmsi: MMSI
    timestamp: AwareDatetime
    position: Position


class Bounds(ContractModel):
    south: float = Field(ge=-90, le=90)
    north: float = Field(ge=-90, le=90)
    west: float = Field(ge=-180, le=180)
    east: float = Field(ge=-180, le=180)

    @model_validator(mode="after")
    def validate_bounds(self):
        if self.south >= self.north or self.west >= self.east:
            raise ValueError("Bounds must be ordered; date-line crossing is unsupported")
        return self

    def contains(self, position: Position) -> bool:
        return (self.south <= position.lat <= self.north
                and self.west <= position.lon <= self.east)


class AISCoverage(ContractModel):
    source: str = Field(min_length=1)
    data_mode: DataMode
    start: AwareDatetime
    end: AwareDatetime
    bounds: Bounds
    adequate_for_search: bool = False

    @model_validator(mode="after")
    def validate_time_range(self):
        if self.start >= self.end:
            raise ValueError("Coverage start must precede end")
        return self


class MatchRequest(ContractModel):
    observations: list[Observation] = Field(min_length=1, max_length=500)
    ais_points: list[AISPoint] = Field(default_factory=list, max_length=10000)
    coverage: AISCoverage | None = None

    @model_validator(mode="after")
    def validate_scene(self):
        if len({o.observation_id for o in self.observations}) != len(self.observations):
            raise ValueError("Observation IDs must be unique")
        if len({o.scene_id for o in self.observations}) != 1:
            raise ValueError("Match one scene per request")
        times = {o.captured_at for o in self.observations if o.captured_at is not None}
        if len(times) > 1:
            raise ValueError("Observations must share a capture time within one scene")
        modes = {o.data_mode for o in self.observations}
        if len(modes) != 1 or (self.coverage and self.coverage.data_mode not in modes):
            raise ValueError("Observation and coverage data modes must agree")
        return self


class MatchResponse(ContractModel):
    observations: list[Observation]
