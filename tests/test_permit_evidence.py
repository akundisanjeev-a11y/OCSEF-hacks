import unittest

from pydantic import ValidationError

from backend.services.permit_evidence import (
    ActivityEvidence, Permit, SourcedIMO, ZoneEvidence,
    load_investigation_inputs, load_permits,
)


class PermitEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.registry = load_permits()
        self.fixtures = load_investigation_inputs()

    def test_four_scenarios_have_expected_results(self):
        self.assertEqual([c.expected_status for c in self.fixtures.cases],
                         ["authorized", "potential_violation", "unknown", "unknown"])
        ids = [c.observation.observation_id for c in self.fixtures.cases]
        self.assertEqual(len(ids), len(set(ids)))

    def test_mmsi_permit_covers_valid_fixture(self):
        case = self.fixtures.cases[0]
        permit, = self.registry.lookup(mmsi=case.observation.mmsi)
        self.assertEqual(permit.zone_id, case.zone.zone_id)
        self.assertEqual(permit.activity, case.activity.activity)
        self.assertLessEqual(permit.valid_from, case.observation.captured_at)
        self.assertLess(case.observation.captured_at, permit.valid_until)

    def test_sourced_imo_lookup_and_explicit_conflict(self):
        case = self.fixtures.cases[1]
        permit, = self.registry.lookup(mmsi=case.observation.mmsi, sourced_imo=case.sourced_imo)
        self.assertEqual(permit.permit_id, "DEMO-PERMIT-002")
        self.assertNotEqual(permit.activity, case.activity.activity)
        self.assertEqual(case.rules[0].condition, "activity_prohibited")
        self.assertEqual(case.rules[0].zone_id, case.zone.zone_id)

    def test_missing_entry_is_incomplete_evidence(self):
        self.assertFalse(self.registry.complete)
        self.assertEqual(self.registry.lookup(mmsi="000000003"), [])
        self.assertEqual(self.fixtures.cases[-1].expected_status, "unknown")

    def test_rejects_unsupported_evidence_and_invalid_dates(self):
        with self.assertRaises(ValidationError):
            SourcedIMO(imo="DEMO-IMO-002", sources=[])
        with self.assertRaises(ValidationError):
            ActivityEvidence(activity="fishing", status="confirmed", observed_at=None, sources=[])
        with self.assertRaises(ValidationError):
            ZoneEvidence(zone_id="DEMO-OFFSHORE-A", membership="inside", sources=[])
        payload = self.registry.lookup(mmsi="000000001")[0].model_dump()
        payload["valid_until"] = payload["valid_from"]
        with self.assertRaises(ValidationError):
            Permit.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
