"""Validated fictional inputs for the future authorization decision service.

Registry lookup only finds records; it does not determine authorization.
"""

import json
from pathlib import Path
from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field, model_validator

from backend.schemas import Observation

SYNTHETIC_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "synthetic"


class Permit(BaseModel):
    permit_id: str
    valid_from: AwareDatetime
    valid_until: AwareDatetime
    zone_id: str
    activity: str
    sources: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.valid_until <= self.valid_from:
            raise ValueError("Permit validity end must follow its start")
        return self


class SourcedIMO(BaseModel):
    imo: str
    sources: list[str] = Field(min_length=1)


class PermitRegistry(BaseModel):
    data_mode: Literal["synthetic"]
    description: str
    complete: bool
    sources: list[str] = Field(min_length=1)
    by_mmsi: dict[str, list[Permit]]
    by_imo: dict[str, list[Permit]]

    def lookup(self, *, mmsi: str | None = None, sourced_imo: SourcedIMO | None = None) -> list[Permit]:
        """Return candidates, including expired/out-of-scope permits, for evaluation.

        A missing entry in this incomplete registry is not evidence of a violation.
        IMO lookups require explicit identity provenance rather than a bare IMO.
        """
        candidates = list(self.by_mmsi.get(mmsi, [])) if mmsi else []
        if sourced_imo is not None:
            candidates.extend(self.by_imo.get(sourced_imo.imo, []))
        return [p.model_copy(deep=True) for p in {p.permit_id: p for p in candidates}.values()]


class ActivityEvidence(BaseModel):
    activity: str | None
    status: Literal["confirmed", "unverified"]
    observed_at: AwareDatetime | None
    sources: list[str]

    @model_validator(mode="after")
    def require_confirmed_evidence(self):
        if self.status == "confirmed" and not (self.activity and self.observed_at and self.sources):
            raise ValueError("Confirmed activity requires an activity, time and source")
        return self


class ZoneEvidence(BaseModel):
    zone_id: str | None
    membership: Literal["inside", "outside", "unknown"]
    sources: list[str]

    @model_validator(mode="after")
    def require_membership_evidence(self):
        if self.membership != "unknown" and not (self.zone_id and self.sources):
            raise ValueError("Known zone membership requires a zone and source")
        return self


class RuleEvidence(BaseModel):
    rule_id: str
    zone_id: str
    activity: str
    valid_from: AwareDatetime
    valid_until: AwareDatetime
    condition: Literal["permit_required", "activity_prohibited"]
    sources: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.valid_until <= self.valid_from:
            raise ValueError("Rule validity end must follow its start")
        return self


class ImageryContext(BaseModel):
    """Sourced hints from a classifier or analyst, never from box confidence alone."""

    observed_at: AwareDatetime
    vessel_type_hint: Literal["cargo_carrier", "fishing_vessel", "unknown"] = "unknown"
    fishing_activity_hint: bool = False
    area_use: Literal["fishing_area", "shipping_lane", "unknown"] = "unknown"
    imagery_sources: list[str] = Field(min_length=1)
    area_sources: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_area_source(self):
        if self.area_use != "unknown" and not self.area_sources:
            raise ValueError("Area context requires a source")
        return self


class InvestigationInput(BaseModel):
    observation: Observation
    sourced_imo: SourcedIMO | None = None
    activity: ActivityEvidence
    zone: ZoneEvidence
    rules: list[RuleEvidence]
    imagery_context: ImageryContext | None = None
    expected_status: Literal["unknown", "authorized", "potential_violation"]
    expected_explanation: str

    @model_validator(mode="after")
    def validate_evidence_links(self):
        if self.observation.data_mode != "synthetic":
            raise ValueError("Fictional investigation inputs must be synthetic")
        if self.sourced_imo and self.sourced_imo.imo != self.observation.imo:
            raise ValueError("Sourced IMO must match the observation IMO")
        if self.activity.status == "confirmed" and self.activity.observed_at != self.observation.captured_at:
            raise ValueError("Fixture activity must be confirmed at observation capture time")
        if self.zone.membership != "unknown" and self.observation.position is None:
            raise ValueError("Known zone membership requires an observation position")
        if self.imagery_context:
            if self.imagery_context.observed_at != self.observation.captured_at:
                raise ValueError("Imagery hints must refer to the observation capture time")
            if self.imagery_context.area_use != "unknown" and self.observation.position is None:
                raise ValueError("Area context requires an observation position")
        return self


class InvestigationFixtures(BaseModel):
    data_mode: Literal["synthetic"]
    description: str
    cases: list[InvestigationInput]


def load_permits(path: Path = SYNTHETIC_DIR / "permits.json") -> PermitRegistry:
    return PermitRegistry.model_validate(json.loads(path.read_text(encoding="utf-8")))


def load_investigation_inputs(path: Path = SYNTHETIC_DIR / "investigation_inputs.json") -> InvestigationFixtures:
    return InvestigationFixtures.model_validate(json.loads(path.read_text(encoding="utf-8")))
