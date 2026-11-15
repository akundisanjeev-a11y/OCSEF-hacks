"""Frontend-facing activity forecast endpoints."""

import logging

from fastapi import APIRouter, HTTPException, Request

from backend.forecast_schemas import ForecastInfo, ForecastRequest, ForecastResponse


router = APIRouter(prefix="/api/activity-forecast", tags=["Activity forecast"])
logger = logging.getLogger(__name__)


def get_forecaster(request):
    service = getattr(request.app.state, "forecaster", None)
    if service is None:
        raise HTTPException(503, detail={
            "code": "forecast_unavailable",
            "message": "Forecast model or history is unavailable. Contact the backend teammate.",
        })
    return service


@router.get("/info", response_model=ForecastInfo)
def forecast_info(request: Request):
    return get_forecaster(request).info()


@router.post("", response_model=ForecastResponse)
def forecast(body: ForecastRequest, request: Request):
    service = get_forecaster(request)
    try:
        return service.predict(body.latitude, body.longitude)
    except Exception:
        logger.exception("Activity forecast failed")
        raise HTTPException(500, detail={
            "code": "forecast_failed",
            "message": "The forecast could not be calculated. Try again or contact the backend teammate.",
        }) from None
