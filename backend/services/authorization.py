"""Evidence-based authorization for the fictional investigation workflow."""

from backend.schemas import Authorization
from backend.services.permit_evidence import InvestigationInput, PermitRegistry


def evaluate_authorization(evidence: InvestigationInput, registry: PermitRegistry) -> Authorization:
    observation = evidence.observation
    sources = list(dict.fromkeys(
        observation.sources + evidence.activity.sources + evidence.zone.sources + registry.sources
        + (evidence.sourced_imo.sources if evidence.sourced_imo else [])
        + [source for rule in evidence.rules for source in rule.sources]
    ))
    missing = []
    if observation.identity_status != "matched" or not (observation.mmsi or evidence.sourced_imo):
        missing.append("unresolved_identity")
    if evidence.activity.status != "confirmed" or not evidence.activity.activity:
        missing.append("missing_activity_evidence")
    if observation.position is None:
        missing.append("missing_position")
    if observation.captured_at is None or observation.captured_at.utcoffset() is None:
        missing.append("missing_capture_time")
    if evidence.zone.membership != "inside":
        missing.append("unresolved_zone_membership")

    # Never attribute a permit to an ambiguous identity.
    permits = registry.lookup(mmsi=observation.mmsi, sourced_imo=evidence.sourced_imo) if "unresolved_identity" not in missing else []
    if not permits:
        missing.append("missing_permit_evidence")
    sources = list(dict.fromkeys(sources + [s for p in permits for s in p.sources]))
    timestamp = observation.captured_at
    rules = [r for r in evidence.rules
             if timestamp is not None and timestamp.utcoffset() is not None
             and r.zone_id == evidence.zone.zone_id
             and r.activity == evidence.activity.activity
             and r.valid_from <= timestamp < r.valid_until]
    if not rules:
        missing.append("missing_applicable_rule_evidence")
    if missing:
        return Authorization(status="unknown", reason_codes=missing,
                             explanation="Authorization unresolved: " + "; ".join(code.replace("_", " ") for code in missing) + ".",
                             sources=sources)

    prohibitions = [r for r in rules if r.condition == "activity_prohibited"]
    if prohibitions:
        rule = prohibitions[0]
        return Authorization(status="potential_violation", reason_codes=["activity_prohibited"],
                             explanation=f"Confirmed {evidence.activity.activity} in {rule.zone_id} at {timestamp.isoformat()} conflicts with {rule.rule_id}, which prohibits that activity. Human review is required.",
                             sources=sources)

    covering = [p for p in permits if p.zone_id == evidence.zone.zone_id
                and p.activity == evidence.activity.activity and p.valid_from <= timestamp < p.valid_until]
    if covering:
        permit = covering[0]
        return Authorization(status="authorized", reason_codes=["permit_covers_activity_place_time"],
                             explanation=f"{permit.permit_id} covers confirmed {permit.activity} in {permit.zone_id} at {timestamp.isoformat()}; validity is {permit.valid_from.isoformat()} to {permit.valid_until.isoformat()} (end exclusive).",
                             sources=sources)

    # An expired or out-of-scope permit in a partial register does not prove that
    # another applicable permit does not exist.
    return Authorization(status="unknown", reason_codes=["missing_applicable_permit_evidence"],
                         explanation="The supplied permits do not cover the activity, zone and capture time. Applicable permit evidence is missing; this does not establish a violation.",
                         sources=sources)
