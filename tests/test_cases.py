import unittest

from fastapi.testclient import TestClient

from backend.main import create_app


class CaseTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = TestClient(self.app)
        self.store = self.app.state.case_service

    def test_upsert_replaces_without_duplicates(self):
        case = self.store.get("synthetic-01-0")
        case.authorization.explanation = "Updated evidence pending."
        self.store.upsert(case)
        self.store.upsert(case)
        self.assertEqual(len(self.store.list()), 6)
        self.assertEqual(self.store.get("synthetic-01-0").authorization.explanation, "Updated evidence pending.")

    def test_store_protects_against_accidental_mutation(self):
        case = self.store.get("synthetic-01-0")
        case.observation.sources.clear()
        self.assertTrue(self.store.get("synthetic-01-0").observation.sources)

    def test_list_and_filter(self):
        response = self.client.get("/cases?data_mode=synthetic")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["cases"]), 6)
        self.assertEqual(self.client.get("/cases?data_mode=model_upload").json(), {"cases": []})
        self.assertEqual(self.client.get("/cases?data_mode=invalid").status_code, 422)

    def test_detail_and_missing(self):
        response = self.client.get("/cases/synthetic-02-0")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["observation"]["position"])
        self.assertEqual(self.client.get("/cases/missing").status_code, 404)

    def test_empty_store(self):
        client = TestClient(create_app(seed_fixtures=False))
        self.assertEqual(client.get("/cases").json(), {"cases": []})


if __name__ == "__main__":
    unittest.main()
