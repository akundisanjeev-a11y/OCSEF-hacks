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

    def test_invalid_counts_cannot_become_no_flags_or_positive_flags(self):
        for value in (False, True, float("inf"), float("nan"), -1):
            result = service.classify({"apparentFishing": {"periodSelectedCounters": {"eventsInNoTakeMPAs": value}}})
            self.assertEqual(result["state"], "unknown")
            self.assertIsNone(result["indicators"][0]["count"])


class ScreeningTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        service._cache.clear()
        service._inflight.clear()
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

    async def test_stream_replaces_finished_boat_without_waiting_for_slow_neighbor(self):
        slow = asyncio.Event()
        fifth_started = asyncio.Event()
        async def upstream(path, **kwargs):
            vessel_id = kwargs["body"]["vessels"][0]["vesselId"]
            if vessel_id == "v-0":
                await slow.wait()
            if vessel_id == "v-4":
                fifth_started.set()
            return ZERO
        async def consume():
            return [event async for event in service.iter_risks(self.query([f"v-{i}" for i in range(6)]))]
        with patch.object(service, "gfw_request", AsyncMock(side_effect=upstream)):
            task = asyncio.create_task(consume())
            try:
                await asyncio.wait_for(fifth_started.wait(), 1)
                self.assertFalse(task.done())
            finally:
                slow.set()
            events = await task
        self.assertEqual(len([event for event in events if event["type"] == "result"]), 6)
        self.assertEqual(events[-1]["type"], "complete")

    async def test_identical_simultaneous_runs_share_requests_and_keep_periods_separate(self):
        async def upstream(path, **kwargs):
            await asyncio.sleep(.01)
            return ZERO
        mock = AsyncMock(side_effect=upstream)
        with patch.object(service, "gfw_request", mock):
            await asyncio.gather(service.screen_risks(self.query(["v-1"])), service.screen_risks(self.query(["v-1"])))
            self.assertEqual(mock.await_count, 1)
            query = self.query(["v-1"])
            query.end = query.end.replace(hour=1)
            await service.screen_risks(query)
        self.assertEqual(mock.await_count, 2)

    async def test_stream_does_not_label_unstarted_boats_after_provider_halt(self):
        mock = AsyncMock(side_effect=HTTPException(403, "No permission"))
        query = service.RiskStreamRequest(vessel_ids=[f"v-{i}" for i in range(50)], start="2026-01-01T00:00:00Z", end="2026-01-02T00:00:00Z")
        with patch.object(service, "gfw_request", mock):
            events = [event async for event in service.iter_risks(query)]
        results = [event["result"] for event in events if event["type"] == "result"]
        self.assertLessEqual(mock.await_count, 4)
        self.assertTrue(all(row["state"] == "unknown" and row.get("error") for row in results))
        self.assertTrue(events[-1]["paused"])
        self.assertEqual(events[-1]["remaining"], 50 - len(results))

    async def test_compact_screening_keeps_counts_but_full_classifier_keeps_evidence_ids(self):
        insights = {"gap": {"aisOff": ["event-1", "event-2"]}}
        with patch.object(service, "gfw_request", AsyncMock(return_value=insights)):
            result = (await service.screen_risks(self.query(["v-1"])))["results"][0]
        self.assertEqual(result["state"], "flagged")
        self.assertEqual(next(row for row in result["indicators"] if row["code"] == "ais_gap")["count"], 2)
        self.assertTrue(all(not row["event_ids"] for row in result["indicators"]))
        self.assertEqual(next(row for row in service.classify(insights)["indicators"] if row["code"] == "ais_gap")["event_ids"], ["event-1", "event-2"])

    async def test_stream_endpoint_and_connection_pool(self):
        client_seen = []
        async def upstream(path, **kwargs):
            client_seen.append(kwargs.get("client"))
            return ZERO
        with patch.object(service, "gfw_request", AsyncMock(side_effect=upstream)):
            with TestClient(create_app(seed_fixtures=False, load_forecast=False)) as client:
                response = client.post("/historical/risks/stream", json=self.query(["v-1", "v-2"]).model_dump(mode="json"))
        import json
        rows = [json.loads(line) for line in response.text.splitlines()]
        self.assertEqual(response.status_code, 200)
        self.assertEqual(rows[0]["type"], "start")
        self.assertEqual(rows[-1]["checked"], 2)
        self.assertIsNotNone(client_seen[0])
        self.assertIs(client_seen[0], client_seen[1])

    async def test_cancelled_stream_does_not_schedule_remaining_boats(self):
        release = asyncio.Event()
        first = asyncio.Event()
        calls = []
        async def upstream(path, **kwargs):
            vessel_id = kwargs["body"]["vessels"][0]["vesselId"]
            calls.append(vessel_id)
            first.set()
            await release.wait()
            return ZERO
        query = service.RiskStreamRequest(vessel_ids=[f"v-{i}" for i in range(50)], start="2026-01-01T00:00:00Z", end="2026-01-02T00:00:00Z")
        async def consume():
            return [event async for event in service.iter_risks(query)]
        with patch.object(service, "gfw_request", AsyncMock(side_effect=upstream)):
            task = asyncio.create_task(consume())
            await first.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            release.set()
            await asyncio.gather(*list(service._inflight.values()))
        self.assertLessEqual(len(calls), 4)
