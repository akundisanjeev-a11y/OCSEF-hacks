"""Identity lookup against an explicitly sourced, server-configured registry.

This is a scoped evidence check, not a search of a worldwide government database.
"""

import os
import re
from pathlib import Path
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from backend.schemas import Authorization
from backend.services.permit_evidence import Permit, RuleEvidence


class VesselCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    registry_mode: Literal["synthetic", "documented"] = "documented"
    identifier_type: Literal["mmsi", "imo", "registration_id"]
    identifier: str = Field(min_length=1, max_length=100)
    activity: Literal["fishing", "transit", "cargo_transport"] | None = None
    captured_at: AwareDatetime | None = None
    zone_id: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def validate_identifier(self):
        if self.identifier_type == "mmsi" and not re.fullmatch(r"[0-9]{9}", self.identifier):
            raise ValueError("MMSI must contain exactly nine digits")
        if self.identifier_type == "imo":
            value = re.sub(r"^IMO\s*", "", self.identifier, flags=re.IGNORECASE)
            if not re.fullmatch(r"[0-9]{7}", value):
                raise ValueError("IMO must contain seven digits, optionally prefixed by IMO")
            if sum(int(value[i]) * (7 - i) for i in range(6)) % 10 != int(value[-1]):
                raise ValueError("IMO checksum is invalid")
            self.identifier = value
        return self


class VesselRecord(BaseModel):
    record_id: str
    name: str
    mmsi: str | None = None
    imo: str | None = None
    registration_id: str | None = None
    vessel_type: str | None = None
    sources: list[str] = Field(min_length=1)
    permits: list[Permit] = Field(default_factory=list)


class LookupRegistry(BaseModel):
    data_mode: Literal["synthetic", "documented"]
    description: str
    sources: list[str] = Field(min_length=1)
    retrieved_at: AwareDatetime
    records: list[VesselRecord]
    rules: list[RuleEvidence] = Field(default_factory=list)


class VesselCheckResponse(BaseModel):
    registry_mode: Literal["synthetic", "documented"]
    documentation_status: Literal["documented", "not_found", "registry_unavailable", "ambiguous"]
    explanation: str
    registry_description: str | None = None
    registry_retrieved_at: AwareDatetime | None = None
    vessel: VesselRecord | None = None
    authorization: Authorization
    assumptions: list[str]
    sources: list[str]


def load_lookup_registry(mode: str) -> LookupRegistry | None:
    if mode == "synthetic":
        path = Path(__file__).resolve().parents[2] / "fixtures" / "synthetic" / "vessel_registry.json"
    else:
        configured = os.environ.get("GHOSTFLEET_VESSEL_REGISTRY")
        if not configured:
            return None
        path = Path(configured)
    registry = LookupRegistry.model_validate_json(path.read_text(encoding="utf-8"))
    if registry.data_mode != mode:
        raise ValueError("Registry data mode does not match requested mode")
    return registry


def check_vessel(request: VesselCheckRequest, registry: LookupRegistry | None) -> VesselCheckResponse:
    sources = list(registry.sources) if registry else []
    assumptions = [
        "The supplied identifier has not been independently linked to a satellite detection.",
        "Activity, zone and capture time are user-entered claims; any authorization result is conditional on their accuracy.",
        "Registry coverage and currency are limited to the displayed sources and retrieval date.",
    ]
    unknown = Authorization(status="unknown", reason_codes=[], explanation="", sources=sources)
    response = VesselCheckResponse(
        registry_mode=request.registry_mode, documentation_status="registry_unavailable",
        explanation="No sourced registry is configured. A real-world documentation or authorization determination is unavailable.",
        registry_description=registry.description if registry else None,
        registry_retrieved_at=registry.retrieved_at if registry else None,
        authorization=unknown, assumptions=assumptions, sources=sources,
    )

    def unresolved(code: str, explanation: str) -> VesselCheckResponse:
        response.authorization = Authorization(status="unknown", reason_codes=[code], explanation=explanation, sources=list(dict.fromkeys(sources)))
        response.sources = response.authorization.sources
        return response

    if registry is None:
        return unresolved("registry_unavailable", response.explanation)
    matches = [r for r in registry.records if getattr(r, request.identifier_type) == request.identifier]
    if not matches:
        response.documentation_status = "not_found"
        response.explanation = "No matching record was found in this registry. This does not mean the vessel is undocumented worldwide or unauthorized."
        return unresolved("identity_not_found", response.explanation)
    if len(matches) > 1:
        response.documentation_status = "ambiguous"
        response.explanation = "Multiple records share this identifier. Resolve identity before checking authorization."
        return unresolved("ambiguous_identity", response.explanation)
    vessel = matches[0]
    response.vessel = vessel
    response.documentation_status = "documented"
    response.explanation = "A vessel record is documented in the selected registry. Documentation alone does not establish permission for an activity."
    sources.extend(vessel.sources)
    missing = [name for name in ("activity", "captured_at", "zone_id") if not getattr(request, name)]
    if missing:
        return unresolved("missing_context", "To check authorization, supply: " + ", ".join(missing) + ".")
    rules = [r for r in registry.rules if r.zone_id == request.zone_id and r.activity == request.activity
             and r.valid_from <= request.captured_at < r.valid_until]
    sources.extend(s for r in rules for s in r.sources)
    if not rules:
        return unresolved("missing_applicable_rule_evidence", "No sourced rule covers the entered activity, zone and time. Authorization is unknown.")
    prohibited = [r for r in rules if r.condition == "activity_prohibited"]
    if prohibited:
        rule = prohibited[0]
        response.authorization = Authorization(status="potential_violation", reason_codes=["activity_prohibited"],
            explanation=f"Based on the entered activity, zone and time, {rule.rule_id} prohibits {request.activity} in {request.zone_id}. This is a documented conflict requiring review, not a final enforcement finding.",
            sources=list(dict.fromkeys(sources)))
    else:
        permits = [p for p in vessel.permits if p.zone_id == request.zone_id and p.activity == request.activity
                   and p.valid_from <= request.captured_at < p.valid_until]
        if not permits:
            return unresolved("missing_applicable_permit_evidence", "No supplied permit covers the entered activity, zone and time. The registry may be incomplete; authorization is unknown.")
        sources.extend(s for p in permits for s in p.sources)
        response.authorization = Authorization(status="authorized", reason_codes=["permit_covers_activity_place_time"],
            explanation=f"Based on the entered activity, zone and time, {', '.join(p.permit_id for p in permits)} covers {request.activity} in {request.zone_id} at {request.captured_at.isoformat()}.",
            sources=list(dict.fromkeys(sources)))
    response.sources = response.authorization.sources
    return response
