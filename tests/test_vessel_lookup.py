import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.services.vessel_lookup import load_lookup_registry


class VesselLookupTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app(seed_fixtures=False))
        self.input = {
            "registry_mode": "synthetic", "identifier_type": "mmsi", "identifier": "000000001",
            "activity": "fishing", "captured_at": "2026-01-01T10:00:00Z", "zone_id": "DEMO-OFFSHORE-A",
        }

    def check(self, **changes):
        return self.client.post("/vessels/check", json={**self.input, **changes})

    def test_authorized_with_sources_and_scope(self):
        response = self.check()
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["documentation_status"], "documented")
        self.assertEqual(result["authorization"]["status"], "authorized")
        self.assertEqual(result["registry_mode"], "synthetic")
        self.assertIn("DEMO-PERMIT-001", result["authorization"]["explanation"])
        self.assertTrue(result["assumptions"])
        self.assertTrue(result["sources"])

    def test_documentation_does_not_imply_authorization(self):
        result = self.check(activity=None, captured_at=None, zone_id=None).json()
        self.assertEqual(result["documentation_status"], "documented")
        self.assertEqual(result["authorization"]["status"], "unknown")

    def test_specific_prohibition_is_a_conflict(self):
        result = self.check(zone_id="DEMO-OFFSHORE-B").json()
        self.assertEqual(result["authorization"]["status"], "potential_violation")
        self.assertIn("DEMO-RULE-B", result["authorization"]["explanation"])

    def test_absent_identity_or_permit_is_not_unauthorized(self):
        result = self.check(identifier="000000099").json()
        self.assertEqual(result["documentation_status"], "not_found")
        self.assertEqual(result["authorization"]["status"], "unknown")
        result = self.check(identifier="000000002").json()
        self.assertEqual(result["documentation_status"], "documented")
        self.assertEqual(result["authorization"]["status"], "unknown")

    def test_registration_id_and_valid_imo(self):
        result = self.check(identifier_type="registration_id", identifier="DEMO-BOAT-001").json()
        self.assertEqual(result["documentation_status"], "documented")
        # Valid checksum is format validation only, never proof of documentation.
        response = self.check(identifier_type="imo", identifier="IMO 9074729")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["documentation_status"], "not_found")

    def test_rejects_bad_ids_naive_time_and_client_supplied_permits(self):
        for changes in [
            {"identifier": "123"}, {"identifier_type": "imo", "identifier": "9074720"},
            {"identifier": ""}, {"captured_at": "2026-01-01T10:00:00"},
            {"permits": [{"permit_id": "forged"}]}, {"registry_mode": "invalid"},
        ]:
            with self.subTest(changes=changes):
                self.assertEqual(self.check(**changes).status_code, 422)

    def test_missing_real_registry_does_not_fall_back_to_fictional(self):
        with patch.dict("os.environ", {}, clear=True):
            result = self.check(registry_mode="documented").json()
        self.assertEqual(result["documentation_status"], "registry_unavailable")
        self.assertIsNone(result["vessel"])
        self.assertEqual(result["authorization"]["status"], "unknown")

    def test_configured_registry_and_ambiguous_identity(self):
        registry = load_lookup_registry("synthetic").model_dump(mode="json")
        registry["data_mode"] = "documented"
        # Test-only mocked sourced registry; no real-world claim about this ID.
        with patch.dict("os.environ", {"GHOSTFLEET_VESSEL_REGISTRY": "test-registry.json"}):
            with patch("backend.services.vessel_lookup.Path.read_text", return_value=json.dumps(registry)):
                result = self.check(registry_mode="documented").json()
                self.assertEqual(result["authorization"]["status"], "authorized")
            registry["records"].append(registry["records"][0])
            with patch("backend.services.vessel_lookup.Path.read_text", return_value=json.dumps(registry)):
                result = self.check(registry_mode="documented").json()
                self.assertEqual(result["documentation_status"], "ambiguous")
                self.assertEqual(result["authorization"]["status"], "unknown")

    def test_unreadable_or_mislabeled_registry_is_unavailable(self):
        with patch.dict("os.environ", {"GHOSTFLEET_VESSEL_REGISTRY": "test-registry.json"}):
            with patch("backend.services.vessel_lookup.Path.read_text", side_effect=OSError("private path")):
                response = self.check(registry_mode="documented")
                self.assertEqual(response.status_code, 503)
                self.assertNotIn("private path", response.text)
            data = load_lookup_registry("synthetic").model_dump_json()
            with patch("backend.services.vessel_lookup.Path.read_text", return_value=data):
                self.assertEqual(self.check(registry_mode="documented").status_code, 503)

    def test_checks_do_not_mutate_case_list(self):
        self.check()
        self.assertEqual(self.client.get("/cases").json(), {"cases": []})

    def test_half_open_validity_and_unknown_rules(self):
        result = self.check(captured_at="2027-01-01T00:00:00Z").json()
        self.assertEqual(result["authorization"]["status"], "unknown")
        result = self.check(zone_id="UNKNOWN-ZONE").json()
        self.assertIn("missing_applicable_rule_evidence", result["authorization"]["reason_codes"])


if __name__ == "__main__":
    unittest.main()
