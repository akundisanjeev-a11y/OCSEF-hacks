from dataclasses import dataclass
from pathlib import Path
from threading import Lock

from PIL import Image


@dataclass(frozen=True)
class PixelDetection:
    bbox_px: tuple[float, float, float, float]
    confidence: float


class ShipDetector:
    def __init__(self, weights_path: Path, confidence: float, device: str):
        if not weights_path.is_file():
            raise FileNotFoundError("Place trained ship weights at MODEL_PATH, then restart")
        # Lazy import keeps the API and matcher usable before ML is configured.
        from ultralytics import YOLO

        self.model = YOLO(str(weights_path), task="detect")
        if self.model.task != "detect":
            raise ValueError("The checkpoint must use the detection task")
        names = list(self.model.names.values())
        if len(names) != 1 or names[0].lower() not in {"ship", "vessel"}:
            raise ValueError("Use a single-class ship/vessel checkpoint, not generic COCO weights")
        self.confidence = confidence
        self.device = device
        self.lock = Lock()

    def detect(self, image: Image.Image) -> list[PixelDetection]:
        with self.lock:
            result = self.model.predict(
                source=image, conf=self.confidence, imgsz=640,
                device=self.device, verbose=False,
            )[0]
        if result.boxes is None:
            return []
        detections = []
        width, height = image.size
        for box, score in zip(result.boxes.xyxy.cpu().tolist(),
                              result.boxes.conf.cpu().tolist()):
            x1, y1, x2, y2 = box
            clipped = (max(0., min(x1, width)), max(0., min(y1, height)),
                       max(0., min(x2, width)), max(0., min(y2, height)))
            if clipped[2] > clipped[0] and clipped[3] > clipped[1]:
                detections.append(PixelDetection(clipped, float(score)))
        return detections
