from contextlib import asynccontextmanager
from io import BytesIO
import json
import logging
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

from backend.config import ROOT, Settings, load_settings
from backend.forecast_api import router as forecast_router
from backend.ml.detector import ShipDetector
from backend.schemas import DetectionResponse, MatchRequest, MatchResponse, Observation
from backend.services.ais_matching import match_scene
from backend.services.activity_forecast import ActivityForecaster


logger = logging.getLogger(__name__)


def decode_image(payload: bytes, settings: Settings) -> Image.Image:
    try:
        with Image.open(BytesIO(payload)) as image:
            if image.format not in {"PNG", "JPEG"}:
                raise HTTPException(415, "Only decoded PNG and JPEG images are supported")
            if image.width * image.height > settings.max_image_pixels:
                raise HTTPException(413, "Image exceeds the decoded pixel limit")
            image.load()
            return image.convert("RGB")
    except HTTPException:
        raise
    except Image.DecompressionBombError:
        raise HTTPException(413, "Image exceeds the decoded pixel limit") from None
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, "Upload is not a valid PNG or JPEG image") from None


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.forecaster = None
        app.state.forecast_error = None
        try:
            app.state.forecaster = await run_in_threadpool(
                ActivityForecaster, settings.forecast_model_path, settings.forecast_processed_dir,
            )
        except Exception:
            logger.exception("Activity forecast unavailable")
            app.state.forecast_error = "Saved forecast model or history could not load. Check the server log and restart."
        app.state.detector = None
        app.state.detector_error = "Image-based ship detection is disabled; activity forecasting is a separate service."
        if settings.enable_ship_detector:
            app.state.detector_error = None
            try:
                app.state.detector = await run_in_threadpool(
                    ShipDetector, settings.model_path,
                    settings.detection_confidence, settings.inference_device,
                )
            except Exception as exc:
                logger.warning("Ship detector unavailable: %s", exc)
                app.state.detector_error = (
                    "Trained single-class ship weights are missing or could not load. "
                    "Check MODEL_PATH and the server log, then restart."
                )
        yield
        app.state.detector = None
        app.state.forecaster = None

    app = FastAPI(
        title="GhostFleet Activity Forecast & Detection", version="0.2.0",
        description=("Historical worldwide apparent-fishing activity forecasts. "
                     "Earlier detection/AIS routes remain available. Forecasts do not determine authorization."),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware, allow_origins=list(settings.frontend_origins),
        allow_credentials=False, allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(forecast_router)

    @app.get("/health", tags=["Status"])
    def health():
        return {
            "status": "ok", "detector_ready": app.state.detector is not None,
            "detector_message": app.state.detector_error,
            "matching_ready": True,
            "detector_enabled": settings.enable_ship_detector,
            "forecast_ready": app.state.forecaster is not None,
            "forecast_message": app.state.forecast_error,
        }

    @app.post("/detections", response_model=DetectionResponse, tags=["Detection"])
    async def detect(image: UploadFile = File(...)):
        try:
            chunks = []
            total = 0
            while chunk := await image.read(1024 * 1024):
                total += len(chunk)
                if total > settings.max_upload_bytes:
                    raise HTTPException(413, "Upload exceeds the configured size limit")
                chunks.append(chunk)
            decoded = await run_in_threadpool(decode_image, b"".join(chunks), settings)
            try:
                detector = app.state.detector
                if detector is None:
                    raise HTTPException(503, app.state.detector_error or "Detector unavailable")
                try:
                    boxes = await run_in_threadpool(detector.detect, decoded)
                except Exception:
                    logger.exception("Ship inference failed")
                    raise HTTPException(503, "Inference failed; inspect the server log") from None
                scene_id = f"upload-{uuid4().hex}"
                observations = [Observation(
                    observation_id=f"{scene_id}-{i}", scene_id=scene_id,
                    data_mode="model_upload", bbox_px=box.bbox_px,
                    detection_confidence=box.confidence,
                    sources=["uploaded radar image; configured ship checkpoint"],
                ) for i, box in enumerate(boxes)]
                return DetectionResponse(
                    image_width=decoded.width, image_height=decoded.height,
                    observations=observations,
                )
            finally:
                decoded.close()
        finally:
            await image.close()

    @app.post("/matches", response_model=MatchResponse, tags=["AIS matching"])
    def matches(request: MatchRequest):
        return MatchResponse(observations=match_scene(request, settings))

    @app.get("/demo/matches", tags=["Fictional examples"])
    def demo_matches():
        scenes = json.loads((ROOT / "fixtures/synthetic/scenes.json").read_text(encoding="utf-8"))
        return {"data_mode": "synthetic", "scenes": [
            {"scenario": scene["scenario"], "expected_status": scene["expected_status"],
             "observations": match_scene(MatchRequest.model_validate(scene["request"]), settings)}
            for scene in scenes
        ]}

    # Backend 2: register your APIRouter for /cases and /demo/run here.
    # Call match_scene() directly; no internal HTTP request is needed.
    return app


app = create_app()
