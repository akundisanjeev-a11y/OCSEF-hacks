"""Keep imagery/context assessment separate from permit authorization."""

from backend.schemas import Alert, Case, ReviewPriority, VesselAssessment
from backend.services.authorization import evaluate_authorization
from backend.services.permit_evidence import InvestigationInput, PermitRegistry


def build_case(evidence: InvestigationInput, registry: PermitRegistry) -> Case:
    authorization = evaluate_authorization(evidence, registry)
    context = evidence.imagery_context
    assessment = VesselAssessment(
        activity="confirmed_fishing" if evidence.activity.status == "confirmed" and evidence.activity.activity == "fishing" else "unknown",
        zone_id=evidence.zone.zone_id if evidence.zone.membership == "inside" else None,
        explanation="No vessel-type classification is available. Detection boxes and confidence alone do not identify vessel type.",
        sources=list(evidence.activity.sources),
    )
    alerts = []
    if context:
        assessment.sources = list(dict.fromkeys(assessment.sources + context.imagery_sources + context.area_sources))
        if context.vessel_type_hint != "unknown":
            assessment.vessel_type = "possible_cargo_carrier" if context.vessel_type_hint == "cargo_carrier" else "possible_fishing_vessel"
            assessment.explanation = "Sourced imagery suggests a " + context.vessel_type_hint.replace("_", " ") + "; this is a tentative vessel-type assessment, not confirmed activity."
            alerts.append(Alert(code=assessment.vessel_type, severity="info", message=assessment.explanation, sources=context.imagery_sources))
        if context.fishing_activity_hint and assessment.activity != "confirmed_fishing":
            assessment.activity = "possible_fishing"
            alerts.append(Alert(code="possible_fishing", severity="review",
                                message="Imagery contains a sourced fishing-activity hint. Activity remains unverified and requires review.", sources=context.imagery_sources))
        if context.area_use != "unknown":
            alerts.append(Alert(code="area_context", severity="info",
                                message=f"Observation lies in a sourced {context.area_use.replace('_', ' ')}. Area use alone does not establish vessel type or fishing activity.", sources=context.area_sources))
    if authorization.status == "potential_violation":
        alerts.append(Alert(code="potential_authorization_conflict", severity="high", message=authorization.explanation, sources=authorization.sources))
    elif authorization.status == "unknown":
        alerts.append(Alert(code="authorization_unresolved", severity="review", message=authorization.explanation, sources=authorization.sources))
    level = "high" if any(a.severity == "high" for a in alerts) else "review" if any(a.severity == "review" for a in alerts) else "routine"
    priority = ReviewPriority(level=level, explanation="; ".join(a.message for a in alerts if a.severity in ("high", "review")) or "No conflict or unresolved-evidence alert; routine review.")
    return Case(observation=evidence.observation, authorization=authorization,
                vessel_assessment=assessment, alerts=alerts, review_priority=priority)
