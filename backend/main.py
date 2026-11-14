"""Run with: python -m uvicorn backend.main:app --reload."""

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException

from backend.schemas import Case, CaseListResponse, DataMode
from backend.services.cases import CaseService
from backend.services.investigation import build_case
from backend.services.permit_evidence import load_investigation_inputs, load_permits

FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "synthetic" / "static_cases.json"


def create_app(*, seed_fixtures: bool = True) -> FastAPI:
    app = FastAPI(title="GhostFleet")
    store = CaseService()
    if seed_fixtures:
        for payload in json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["cases"]:
            store.upsert(Case.model_validate(payload))
        registry = load_permits()
        for evidence in load_investigation_inputs().cases:
            store.upsert(build_case(evidence, registry))
    app.state.case_service = store

    @app.get("/cases", response_model=CaseListResponse)
    def list_cases(data_mode: DataMode | None = None) -> CaseListResponse:
        return CaseListResponse(cases=store.list(data_mode))

    @app.get("/cases/{observation_id}", response_model=Case)
    def get_case(observation_id: str) -> Case:
        case = store.get(observation_id)
        if case is None:
            raise HTTPException(status_code=404, detail="Case not found")
        return case

    return app


app = create_app()
