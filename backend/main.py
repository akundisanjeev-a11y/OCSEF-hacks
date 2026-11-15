"""Run with: python -m uvicorn backend.main:app --reload."""

import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from backend.schemas import Case, CaseListResponse, DataMode
from backend.services.cases import CaseService
from backend.services.investigation import build_case
from backend.services.permit_evidence import load_investigation_inputs, load_permits
from backend.services.vessel_lookup import VesselCheckRequest, VesselCheckResponse, check_vessel, load_lookup_registry
from backend.services.historical import AreaQuery, VesselEnrichment, query_area, enrich_vessel
from backend.services.risk_screening import RiskScreenRequest, screen_risks
from backend.forecast_api import router as forecast_router

FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "synthetic" / "static_cases.json"


class DemoRunResponse(BaseModel):
    case_ids: list[str]


def load_demo_cases(store: CaseService) -> list[str]:
    static_cases = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["cases"]
    cases = [Case.model_validate(payload) for payload in static_cases]
    registry = load_permits()
    cases.extend(build_case(evidence, registry) for evidence in load_investigation_inputs().cases)
    for case in cases:
        store.upsert(case)
    return sorted(case.observation.observation_id for case in cases)


def create_app(*, seed_fixtures: bool = True, load_forecast: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app):
        app.state.forecaster = None
        app.state.forecast_error = None
        if load_forecast:
            root = Path(__file__).resolve().parents[1]
            try:
                def load_model():
                    # Forecast dependencies are optional to the GFW query app.
                    # A missing ML package must not crash module import and leave
                    # the reload supervisor holding an unresponsive port.
                    from backend.services.activity_forecast import ActivityForecaster
                    return ActivityForecaster(
                        Path(os.getenv('ACTIVITY_FORECAST_MODEL_PATH', root/'weights/activity_forecast/best_model.joblib')),
                        Path(os.getenv('ACTIVITY_FORECAST_DATA_DIR', root/'datasets/activity_forecast/processed')),
                    )
                app.state.forecaster = await run_in_threadpool(load_model)
            except Exception:
                logging.getLogger(__name__).exception('Activity forecast unavailable')
                app.state.forecast_error = 'Install backend/requirements.txt in the project virtual environment, run python -m training.activity_forecast.setup_inference, then restart FastAPI.'
        yield
        app.state.forecaster = None

    app = FastAPI(title="GhostFleet", lifespan=lifespan)
    app.include_router(forecast_router)
    # Compatibility for callers using the earlier direct-backend URL.
    app.include_router(forecast_router, prefix='/api', include_in_schema=False)
    store = CaseService()
    if seed_fixtures:
        load_demo_cases(store)
    app.state.case_service = store

    @app.get("/health")
    def health():
        # Process readiness only; this does not assert upstream GFW access.
        return {"status": "ok"}

    @app.get('/forecast/health')
    def forecast_health():
        return {'forecast_ready': getattr(app.state, 'forecaster', None) is not None,
                'forecast_message': getattr(app.state, 'forecast_error', None)}

    @app.post("/historical/area")
    async def historical_area(query: AreaQuery):
        return await query_area(query)

    @app.post("/historical/vessel")
    async def historical_vessel(query: VesselEnrichment):
        return await enrich_vessel(query)

    @app.post("/historical/risks")
    async def historical_risks(query: RiskScreenRequest):
        return await screen_risks(query)

    @app.post("/vessels/check", response_model=VesselCheckResponse)
    def vessel_check(request: VesselCheckRequest) -> VesselCheckResponse:
        try:
            registry = load_lookup_registry(request.registry_mode)
        except (OSError, ValueError):
            raise HTTPException(status_code=503, detail="The selected registry could not be loaded. Check the server registry configuration.")
        return check_vessel(request, registry)

    @app.post("/demo/run", response_model=DemoRunResponse)
    def run_demo() -> DemoRunResponse:
        return DemoRunResponse(case_ids=load_demo_cases(store))

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
