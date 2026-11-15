import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.services import risk_screening as service

ZERO = {"apparentFishing": {"periodSelectedCounters": {"eventsInNoTakeMPAs": 0, "eventsInRFMOWithoutKnownAuthorization": 0}},
        "gap": {"aisOff": []}, "vesselIdentity": {"iuuVesselList": {"totalTimesListedInThePeriod": 0}}}


class ClassificationTests(unittest.TestCase):
    def test_missing_is_not_clean_and_flags_are_not_authorization(self):
        self.assertEqual(service.classify({})["state"], "unknown")
        self.assertEqual(service.classify(ZERO)["state"], "no_flags")
        self.assertEqual(service.classify({"gap": {"aisOff": ["event-1"]}})["state"], "flagged")
        self.assertEqual(service.classify({**ZERO, "vesselIdsWithoutIdentity": ["id-1"]})["state"], "unknown")

    def test_request_bounds(self):
        client = TestClient(create_app(seed_fixtures=False))
        for ids in [[], ["bad/id"], [f"v-{i}" for i in range(17)]]:
            response = client.post("/historical/risks", json={"vessel_ids": ids, "start": "2026-01-01T00:00:00Z", "end": "2026-01-02T00:00:00Z"})
            self.assertEqual(response.status_code, 422)


class ScreeningTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        service._cache.clear()
        service._semaphore = asyncio.Semaphore(4)

    def query(self, ids):
        return service.RiskScreenRequest(vessel_ids=ids, start="2026-01-01T00:00:00Z", end="2026-01-02T00:00:00Z")

    async def test_only_insights_cached_and_bounded_concurrency(self):
        active, maximum = 0, 0
        async def upstream(path, **kwargs):
            nonlocal active, maximum
            self.assertEqual(path, "insights/vessels")
            self.assertNotIn("COVERAGE", kwargs["body"]["includes"])
            active += 1; maximum = max(maximum, active)
            await asyncio.sleep(.01)
            active -= 1
            return ZERO
        ids = [f"v-{i}" for i in range(12)]
        mock = AsyncMock(side_effect=upstream)
        with patch.object(service, "gfw_request", mock):
            result = await service.screen_risks(self.query(ids))
            repeated = await service.screen_risks(self.query(ids))
        self.assertEqual(len(result["results"]), 12)
        self.assertLessEqual(maximum, 4)
        self.assertGreater(maximum, 1)
        self.assertEqual(mock.await_count, 12)
        self.assertTrue(all(row["cached"] for row in repeated["results"]))

    async def test_access_failure_halts_remainder_and_does_not_mark_clean(self):
        mock = AsyncMock(side_effect=HTTPException(429, "Rate limit"))
        with patch.object(service, "gfw_request", mock):
            result = await service.screen_risks(self.query([f"v-{i}" for i in range(16)]))
        self.assertLessEqual(mock.await_count, 4)
        self.assertTrue(all(row["state"] == "unknown" for row in result["results"]))
        self.assertEqual(len(service._cache), 0)

    async def test_duplicate_ids_only_checked_once(self):
        mock = AsyncMock(return_value=ZERO)
        with patch.object(service, "gfw_request", mock):
            result = await service.screen_risks(self.query(["v-1", "v-1"]))
        self.assertEqual(len(result["results"]), 1)
        self.assertEqual(mock.await_count, 1)
