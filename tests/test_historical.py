import asyncio
import io
import json
import unittest
import zipfile
import httpx
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.services.historical import AreaQuery, DATASETS, _cache, cells_from_rows, decode_response, gfw_request, summarize_evidence


class HistoricalTests(unittest.TestCase):
    def test_repeat_records_do_not_invent_unique_boats_or_average_lengths(self):
        query = AreaQuery(west=-5, east=3, south=1, north=7)
        cells = cells_from_rows([
            {"lat": 4, "lon": -1, "hours": 1, "vesselIDs": 3, "vessel_type": "cargo"},
            {"lat": 4, "lon": -1, "hours": 2, "vesselIDs": 4, "vessel_type": "fishing"},
        ], query)
        self.assertEqual(len(cells), 1)
        self.assertEqual(cells[0]["value"], 3)
        self.assertEqual(cells[0]["vessel_count_lower_bound"], 4)
        self.assertEqual(cells[0]["vessel_type"], "mixed")
        self.assertIsNone(cells[0]["mean_length_m"])

    def test_missing_count_and_length_remain_unknown(self):
        cells = cells_from_rows([{"lat": 4, "lon": -1, "hours": .5}], AreaQuery(west=-5, east=3, south=1, north=7))
        self.assertIsNone(cells[0]["vessel_count_lower_bound"])
        summary, _ = summarize_evidence({"selfReportedInfo": [{"shipname": "Test", "lengthM": 38}]}, {})
        self.assertEqual(summary["length_m"], 38)
        self.assertIsNone(summarize_evidence({}, {})[0]["length_m"])

    def test_cell_mean_lengths_deduplicate_identities_and_require_complete_inputs(self):
        query = AreaQuery(west=-5, east=3, south=1, north=7)
        rows = [{"lat": 4, "lon": -1, "hours": .5, "vesselId": "v-1", "lengthM": 20},
                {"lat": 4, "lon": -1, "hours": .5, "vesselId": "v-1", "lengthM": 20},
                {"lat": 4, "lon": -1, "hours": .5, "vesselId": "v-2", "lengthM": 100}]
        self.assertEqual(cells_from_rows(rows, query)[0]["mean_length_m"], 60)
        rows.append({"lat": 4, "lon": -1, "hours": .5})
        self.assertIsNone(cells_from_rows(rows, query)[0]["mean_length_m"])

    def setUp(self):
        self.client = TestClient(create_app(seed_fixtures=False))
        self.query = {"mode": "synthetic", "west": -5, "east": 3, "south": 1, "north": 7,
                      "hours_ago": 100, "window_hours": 24, "layer": "presence"}
        _cache.clear()

    def scan(self, **changes):
        return self.client.post("/historical/area", json={**self.query, **changes})

    def test_sample_window_cells_and_area_vessels(self):
        response = self.scan()
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["start"].endswith("Z"))
        self.assertTrue(data["end"].endswith("Z"))
        self.assertEqual(data["mode"], "synthetic")
        self.assertEqual(len(data["cells"]), 32)
        self.assertEqual(len(data["vessels"]), 2)
        self.assertNotIn("vessel_id", data["cells"][0])
        start = datetime.fromisoformat(data["start"])
        end = datetime.fromisoformat(data["end"])
        self.assertEqual((end - start).total_seconds(), 24 * 3600)
        self.assertGreaterEqual((datetime.now(timezone.utc) - end).total_seconds(), 100 * 3600)

    def test_selection_filters_and_empty_coverage(self):
        data = self.scan(west=30, east=32).json()
        self.assertEqual(data["cells"], [])
        self.assertEqual(data["vessels"], [])

    def test_sar_has_older_cutoff_and_no_invented_identity(self):
        self.assertEqual(self.scan(layer="sar").status_code, 422)
        result = self.scan(layer="sar", hours_ago=124).json()
        self.assertEqual(result["vessels"], [])
        self.assertEqual(result["cells"][0]["value"], 1)

    def test_rejects_bad_areas_and_recent_windows(self):
        for changes in [{"hours_ago": 1}, {"window_hours": 0}, {"west": 4}, {"east": 80},
                        {"north": 86}, {"layer": "invalid"}, {"west": 179, "east": -179}]:
            self.assertEqual(self.scan(**changes).status_code, 422)

    def test_live_without_token_does_not_substitute_sample(self):
        with patch.dict("os.environ", {}, clear=True):
            response = self.scan(mode="gfw")
        self.assertEqual(response.status_code, 503)
        self.assertIn("GFW_API_TOKEN", response.json()["detail"])
        self.assertNotIn("cells", response.json())

    def test_reports_use_separate_spatial_and_vessel_aggregation(self):
        dataset = DATASETS["presence"]
        upstream = AsyncMock(side_effect=[
            {"entries": [{dataset: [{"lat": 4, "lon": -1, "hours": .5, "date": "2026-01-01"}]}]},
            {"entries": [{dataset: [{"vesselId": "gfw-1", "shipName": "Test", "hours": .5}, {"vesselId": "gfw-1", "hours": .25}]}]},
        ])
        with patch("backend.services.historical.gfw_request", upstream):
            response = self.scan(mode="gfw")
            cached = self.scan(mode="gfw")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(cached.json(), response.json())
        self.assertEqual(upstream.await_count, 2)
        self.assertEqual(upstream.call_args_list[0].kwargs["params"]["spatial-aggregation"], "false")
        self.assertEqual(upstream.call_args_list[0].kwargs["params"]["group-by"], "FLAG")
        self.assertEqual(upstream.call_args_list[1].kwargs["params"]["group-by"], "VESSEL_ID")
        self.assertIsInstance(upstream.call_args_list[0].kwargs["body"]["geojson"], dict)
        self.assertEqual(upstream.call_args_list[0].kwargs["body"]["geojson"]["type"], "FeatureCollection")
        self.assertEqual(response.json()["vessels"][0]["hours"], .75)
        self.assertNotIn("lat", response.json()["vessels"][0])

    def test_partial_or_malformed_reports_are_not_empty_success(self):
        for result in [{"entries": [], "nextOffset": 5}, {"entries": [{"unknown": []}]},
                       {"entries": [{"lat": "NaN", "lon": 0, "hours": 1}]}]:
            with patch("backend.services.historical.gfw_request", AsyncMock(return_value=result)):
                self.assertEqual(self.scan(mode="gfw").status_code, 502)

    def test_gfw_failures_remain_errors(self):
        with patch("backend.services.historical.gfw_request", AsyncMock(side_effect=HTTPException(429, "GFW limit reached"))):
            self.assertEqual(self.scan(mode="gfw").status_code, 429)

    def test_json_and_zip_reports(self):
        payload = {"entries": []}
        raw = json.dumps(payload).encode()
        self.assertEqual(decode_response(raw), payload)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as file:
            file.writestr("report.json", raw)
            file.writestr("caveats.txt", "Test caveat")
        self.assertEqual(decode_response(archive.getvalue()), payload)
        with self.assertRaises(ValueError):
            decode_response(b"[]")

    def test_sample_enrichment_keeps_authorization_separate(self):
        result = self.client.post("/historical/vessel", json={"mode": "synthetic", "vessel_id": "demo-fishing-1"}).json()
        self.assertEqual(result["authorization"]["status"], "unknown")
        self.assertEqual(result["summary"]["documentation"], "public_registry_record_found")
        self.assertEqual(result["indicators"][0]["count"], 1)

    def test_partial_enrichment_preserves_identity_when_insights_fail(self):
        upstream = AsyncMock(side_effect=[{"selfReportedInfo": [{"shipname": "Test", "ssvid": "123456789"}]}, HTTPException(403, "dataset denied")])
        with patch("backend.services.historical.gfw_request", upstream):
            response = self.client.post("/historical/vessel", json={"mode": "gfw", "vessel_id": "gfw-test"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["summary"]["documentation"], "ais_identity_only")
        self.assertTrue(response.json()["warnings"])
        self.assertTrue(all(i["count"] is None for i in response.json()["indicators"]))

    def test_missing_indicators_not_zero_and_historical_counts_not_current(self):
        summary, indicators = summarize_evidence({}, {"apparentFishing": {"historicalCounters": {"eventsInNoTakeMPAs": 20}}})
        self.assertEqual(summary["documentation"], "no_identity_record")
        self.assertIsNone(indicators[0]["count"])

    def test_unsafe_id_is_rejected(self):
        response = self.client.post("/historical/vessel", json={"vessel_id": "../../secrets"})
        self.assertEqual(response.status_code, 422)

    def test_client_sends_private_token_only_to_fixed_gateway(self):
        def handler(request):
            self.assertEqual(request.url.host, "gateway.api.globalfishingwatch.org")
            self.assertEqual(request.headers["authorization"], "Bearer private-test-token")
            return httpx.Response(200, json={"entries": []})
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with patch.dict("os.environ", {"GFW_API_TOKEN": "private-test-token"}):
            with patch("backend.services.historical.httpx.AsyncClient", return_value=client):
                self.assertEqual(asyncio.run(gfw_request("vessels/search")), {"entries": []})

    def test_client_redacts_upstream_error_body(self):
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(401, text="private-test-token")))
        with patch.dict("os.environ", {"GFW_API_TOKEN": "private-test-token"}):
            with patch("backend.services.historical.httpx.AsyncClient", return_value=client):
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(gfw_request("vessels/search"))
        self.assertEqual(error.exception.status_code, 401)
        self.assertNotIn("private-test-token", error.exception.detail)

    def test_upstream_validation_errors_are_visible_and_redacted(self):
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(422, json={
            "messages": [{"detail": "Format of date-range not valid; token=private-test-token"}],
            "metadata": {"authorization": "private-test-token"},
        })))
        with patch.dict("os.environ", {"GFW_API_TOKEN": "private-test-token"}):
            with patch("backend.services.historical.httpx.AsyncClient", return_value=client):
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(gfw_request("4wings/report"))
        self.assertIn("upstream HTTP 422", error.exception.detail)
        self.assertIn("date-range not valid", error.exception.detail)
        self.assertNotIn("private-test-token", error.exception.detail)

    def test_resolved_dataset_version_is_accepted(self):
        from backend.services.historical import report_rows
        rows = [{"lat": 4, "lon": -1, "hours": .5}]
        self.assertEqual(report_rows({"entries": [{"public-global-presence:v5.0": rows}]}, "public-global-presence:latest"), rows)

    def test_post_created_response_is_success(self):
        payload = {"gaps": {"aisOff": []}}
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(201, json=payload)))
        with patch.dict("os.environ", {"GFW_API_TOKEN": "private-test-token"}):
            with patch("backend.services.historical.httpx.AsyncClient", return_value=client):
                self.assertEqual(asyncio.run(gfw_request("insights/vessels", body={"vessels": []})), payload)


if __name__ == "__main__":
    unittest.main()
