"""Run with: python -m uvicorn backend.main:app --reload."""

import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
import httpx
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from backend.schemas import Case, CaseListResponse, DataMode
from backend.services.cases import CaseService
from backend.services.investigation import build_case
from backend.services.permit_evidence import load_investigation_inputs, load_permits
from backend.services.vessel_lookup import VesselCheckRequest, VesselCheckResponse, check_vessel, load_lookup_registry
from backend.services.historical import AreaQuery, VesselEnrichment, query_area, enrich_vessel
from backend.services.risk_screening import RiskScreenRequest, RiskStreamRequest, screen_risks, iter_risks
from backend.forecast_api import router as forecast_router
from backend.services.vessel_search import VesselSearch, search_vessels
from backend.services.risk_events import RiskEventRequest, load_risk_events
from backend.priority_api import router as priority_router,PriorityJobs
from backend.services.habitat_features import HabitatIndex

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
    root=Path(__file__).resolve().parents[1]
    load_dotenv(root/'.env',override=False)
    def configured_path(name,default):
        value=Path(os.getenv(name,str(default)))
        return value if value.is_absolute() else root/value
    @asynccontextmanager
    async def lifespan(app):
        app.state.forecaster = None
        app.state.forecast_error = None
        if load_forecast:
            try:
                def load_model():
                    # Forecast dependencies are optional to the GFW query app.
                    # A missing ML package must not crash module import and leave
                    # the reload supervisor holding an unresponsive port.
                    from backend.services.activity_forecast import ActivityForecaster
                    from training.activity_forecast.setup_inference import setup_bundled
                    # Local processed/ may belong to an older checkpoint or a
                    # teammate's training run. Default to the matching release
                    # bundle in a content-addressed cache without overwriting it.
                    history = (configured_path('ACTIVITY_FORECAST_DATA_DIR',root/'datasets/activity_forecast/processed')
                               if os.getenv('ACTIVITY_FORECAST_DATA_DIR', '').strip() else setup_bundled())
                    return ActivityForecaster(
                        configured_path('ACTIVITY_FORECAST_MODEL_PATH',root/'weights/activity_forecast/best_model.joblib'),
                        history,
                    )
                app.state.forecaster = await run_in_threadpool(load_model)
            except Exception:
                logging.getLogger(__name__).exception('Activity forecast unavailable')
                app.state.forecast_error = ('Install backend/requirements.txt in the project virtual environment and restart FastAPI. '
                    'The bundled history is restored automatically. If ACTIVITY_FORECAST_DATA_DIR is set, it must match the saved checkpoint; '
                    'unset that override to use the bundled release. Custom history is never overwritten.')
        async with httpx.AsyncClient(timeout=110, follow_redirects=False,
                                     limits=httpx.Limits(max_connections=8, max_keepalive_connections=4, keepalive_expiry=60)) as client:
            app.state.gfw_client = client
            app.state.priority_jobs=PriorityJobs(app.state.forecaster,
                HabitatIndex(configured_path('PRIORITY_HABITAT_INDEX',root/'datasets/priority_engine/habitats/habitats.sqlite')),client)
            try:
                yield
            finally:
                await app.state.priority_jobs.close()
                app.state.priority_jobs=None
                app.state.forecaster = None
                app.state.gfw_client = None

    app = FastAPI(title="GhostFleet", lifespan=lifespan)
    app.include_router(forecast_router)
    # Compatibility for callers using the earlier direct-backend URL.
    app.include_router(forecast_router, prefix='/api', include_in_schema=False)
    app.include_router(priority_router)
    app.include_router(priority_router,prefix='/api',include_in_schema=False)
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

    @app.post("/historical/vessels/search")
    async def historical_vessel_search(query: VesselSearch):
        return await search_vessels(query)

    @app.post("/historical/risks")
    async def historical_risks(query: RiskScreenRequest, request: Request):
        return await screen_risks(query, getattr(request.app.state, "gfw_client", None))

    @app.post("/historical/risk-events")
    async def historical_risk_events(query: RiskEventRequest, request: Request):
        return await load_risk_events(query, getattr(request.app.state, "gfw_client", None))

    @app.post("/historical/risks/stream")
    async def historical_risks_stream(query: RiskStreamRequest, request: Request):
        async def rows():
            async for event in iter_risks(query, getattr(request.app.state, "gfw_client", None)):
                if await request.is_disconnected():
                    break
                yield json.dumps(event, allow_nan=False) + "\n"
        return StreamingResponse(rows(), media_type="application/x-ndjson",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

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
