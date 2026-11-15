from dataclasses import dataclass
import os
from pathlib import Path

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    model_path: Path = ROOT / "weights" / "best.pt"
    enable_ship_detector: bool = False
    forecast_model_path: Path = ROOT / "weights/activity_forecast/best_model.joblib"
    forecast_processed_dir: Path = ROOT / "datasets/activity_forecast/processed"
    detection_confidence: float = 0.25
    inference_device: str = "cpu"
    max_upload_bytes: int = 10 * 1024 * 1024
    max_image_pixels: int = 20_000_000
    frontend_origins: tuple[str, ...] = (
        "http://localhost:5173", "http://127.0.0.1:5173"
    )
    max_ais_point_gap_seconds: float = 300
    max_match_distance_meters: float = 500

    def __post_init__(self):
        if not 0 < self.detection_confidence <= 1:
            raise ValueError("DETECTION_CONFIDENCE must be in (0, 1]")
        for value in (self.max_upload_bytes, self.max_image_pixels,
                      self.max_ais_point_gap_seconds, self.max_match_distance_meters):
            if not 0 < value < float("inf"):
                raise ValueError("Limits and matching gates must be positive and finite")


def load_settings() -> Settings:
    load_dotenv(ROOT / ".env", override=False)
    enable_ship_detector = os.getenv("ENABLE_SHIP_DETECTOR", "false").strip().lower()
    if enable_ship_detector not in {"true", "false", "1", "0"}:
        raise ValueError("ENABLE_SHIP_DETECTOR must be true, false, 1 or 0")
    model_path = Path(os.getenv("MODEL_PATH", "weights/best.pt"))
    if not model_path.is_absolute():
        model_path = ROOT / model_path
    forecast_model_path = Path(os.getenv("ACTIVITY_FORECAST_MODEL_PATH", "weights/activity_forecast/best_model.joblib"))
    forecast_processed_dir = Path(os.getenv("ACTIVITY_FORECAST_DATA_DIR", "datasets/activity_forecast/processed"))
    if not forecast_model_path.is_absolute():
        forecast_model_path = ROOT / forecast_model_path
    if not forecast_processed_dir.is_absolute():
        forecast_processed_dir = ROOT / forecast_processed_dir
    return Settings(
        model_path=model_path,
        enable_ship_detector=enable_ship_detector in {"true", "1"},
        forecast_model_path=forecast_model_path,
        forecast_processed_dir=forecast_processed_dir,
        detection_confidence=float(os.getenv("DETECTION_CONFIDENCE", "0.25")),
        inference_device=os.getenv("INFERENCE_DEVICE", "cpu"),
        max_upload_bytes=int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024,
        max_image_pixels=int(os.getenv("MAX_IMAGE_PIXELS", "20000000")),
        frontend_origins=tuple(origin.strip() for origin in os.getenv(
            "FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",") if origin.strip()),
        max_ais_point_gap_seconds=float(os.getenv("MAX_AIS_POINT_GAP_SECONDS", "300")),
        max_match_distance_meters=float(os.getenv("MAX_MATCH_DISTANCE_METERS", "500")),
    )
