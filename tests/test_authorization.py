import unittest
from datetime import timedelta

from backend.services.authorization import evaluate_authorization
from backend.services.investigation import build_case
from backend.services.permit_evidence import ImageryContext, load_investigation_inputs, load_permits
from backend.main import create_app
from fastapi.testclient import TestClient


class AuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.registry = load_permits()
        self.inputs = load_investigation_inputs().cases

    def test_expected_outcomes_and_sources(self):
        for item in self.inputs:
            with self.subTest(case=item.observation.observation_id):
                result = evaluate_authorization(item, self.registry)
                self.assertEqual(result.status, item.expected_status)
                self.assertTrue(result.sources)
                self.assertTrue(result.explanation)

    def test_missing_inputs_prevent_authorization(self):
        for change, reason in [
            ("identity", "unresolved_identity"), ("activity", "missing_activity_evidence"),
            ("position", "missing_position"), ("time", "missing_capture_time"),
            ("zone", "unresolved_zone_membership"), ("rules", "missing_applicable_rule_evidence"),
        ]:
            item = self.inputs[0].model_copy(deep=True)
            if change == "identity": item.observation.identity_status = "ambiguous"
            if change == "activity": item.activity.status = "unverified"
            if change == "position": item.observation.position = None
            if change == "time": item.observation.captured_at = None
            if change == "zone": item.zone.membership = "unknown"
            if change == "rules": item.rules = []
            result = evaluate_authorization(item, self.registry)
            self.assertEqual(result.status, "unknown")
            self.assertIn(reason, result.reason_codes)

    def test_permit_end_is_exclusive_and_missing_permit_is_unknown(self):
        item = self.inputs[0]
        permit = self.registry.by_mmsi[item.observation.mmsi][0]
        permit.valid_until = item.observation.captured_at
        result = evaluate_authorization(item, self.registry)
        self.assertEqual(result.status, "unknown")
        self.registry.by_mmsi.clear()
        self.assertIn("missing_permit_evidence", evaluate_authorization(item, self.registry).reason_codes)

    def test_wrong_zone_activity_or_stale_rule_not_applicable(self):
        for change in ("zone", "activity", "time"):
            item = self.inputs[0].model_copy(deep=True)
            rule = item.rules[0]
            if change == "zone": rule.zone_id = "ELSEWHERE"
            if change == "activity": rule.activity = "transit"
            if change == "time": rule.valid_until = item.observation.captured_at - timedelta(seconds=1)
            self.assertIn("missing_applicable_rule_evidence", evaluate_authorization(item, self.registry).reason_codes)

    def test_conflict_alert_is_high_priority(self):
        case = build_case(self.inputs[1], self.registry)
        self.assertEqual(case.review_priority.level, "high")
        self.assertIn("DEMO-RULE-B", case.authorization.explanation)
        self.assertTrue(any(a.code == "potential_authorization_conflict" for a in case.alerts))

    def test_cargo_hint_and_area_do_not_confirm_fishing(self):
        case = build_case(self.inputs[3], self.registry)
        self.assertEqual(case.vessel_assessment.vessel_type, "possible_cargo_carrier")
        self.assertEqual(case.vessel_assessment.activity, "unknown")
        self.assertEqual(case.authorization.status, "unknown")
        self.assertTrue(any(a.code == "possible_cargo_carrier" for a in case.alerts))

    def test_imagery_fishing_hint_remains_unverified(self):
        item = self.inputs[3].model_copy(deep=True)
        item.imagery_context = ImageryContext(
            observed_at=item.observation.captured_at, fishing_activity_hint=True,
            area_use="fishing_area", imagery_sources=["fictional imagery fishing-pattern annotation"],
            area_sources=["fictional area overlay"],
        )
        case = build_case(item, self.registry)
        self.assertEqual(case.vessel_assessment.activity, "possible_fishing")
        self.assertEqual(case.authorization.status, "unknown")
        self.assertEqual(case.review_priority.level, "review")
        self.assertTrue(any(a.code == "possible_fishing" for a in case.alerts))

    def test_area_alone_and_boxes_never_classify_vessel(self):
        item = self.inputs[3].model_copy(deep=True)
        item.imagery_context.vessel_type_hint = "unknown"
        case = build_case(item, self.registry)
        self.assertEqual(case.vessel_assessment.vessel_type, "unknown")
        self.assertEqual(case.vessel_assessment.activity, "unknown")

    def test_api_exposes_decision_assessment_and_alerts(self):
        client = TestClient(create_app())
        payload = client.get("/cases/documented-conflict-0").json()
        self.assertEqual(payload["authorization"]["status"], "potential_violation")
        self.assertEqual(payload["review_priority"]["level"], "high")
        self.assertTrue(payload["alerts"])
        self.assertEqual(len(client.get("/cases?data_mode=synthetic").json()["cases"]), 6)


if __name__ == "__main__":
    unittest.main()
