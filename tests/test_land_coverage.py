import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.services.land_coverage import estimate_land


class LandCoverageTests(unittest.TestCase):
    def test_ocean_desert_and_inland_lake(self):
        self.assertTrue(estimate_land(10, 25, 11, 26)["skip"])
        self.assertFalse(estimate_land(-30, 30, -29, 31)["skip"])
        self.assertFalse(estimate_land(32, -2, 33, -1)["skip"])

    def test_small_areas_and_missing_mask_do_not_guess_water_is_land(self):
        self.assertEqual(estimate_land(0, 0, .01, .01)["status"], "uncertain")
        with patch("backend.services.land_coverage.load_mask", side_effect=OSError("missing")):
            self.assertFalse(estimate_land(10, 25, 11, 26)["skip"])

    def test_land_rejected_before_gfw_and_override_is_explicit(self):
        client = TestClient(create_app(seed_fixtures=False))
        query = {"mode": "gfw", "west": 10, "east": 11, "south": 25, "north": 26}
        upstream = AsyncMock(return_value=[])
        with patch("backend.services.historical.report", upstream):
            result = client.post("/historical/area", json=query)
            self.assertEqual(result.status_code, 200)
            self.assertTrue(result.json()["skipped"])
            self.assertEqual(upstream.await_count, 0)
            result = client.post("/historical/area", json={**query, "allow_land": True})
            self.assertFalse(result.json()["skipped"])
            self.assertEqual(upstream.await_count, 2)


if __name__ == "__main__":
    unittest.main()
