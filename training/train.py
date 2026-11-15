"""Run from the repository root, preferably on an available training GPU."""

import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, help="Path to prepared HRSID dataset YAML")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--device", default="cpu", help="cpu or a CUDA index such as 0")
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--fraction", type=float, default=1.0, help="Training fraction for a short pipeline check")
    args = parser.parse_args()
    if not Path(args.data).is_file():
        parser.error("Dataset YAML does not exist. Prepare labeled data first.")
    if args.epochs < 1 or args.batch < 1 or not 0 < args.fraction <= 1:
        parser.error("Epochs/batch must be positive; fraction must be in (0, 1]")
    from ultralytics import YOLO

    model = YOLO("yolo11n.pt")
    model.train(data=str(Path(args.data).resolve()), epochs=args.epochs,
                imgsz=640, batch=args.batch, device=args.device,
                workers=0, seed=42, fraction=args.fraction, project="runs", name="ship")
    print("Copy the selected runs/ship*/weights/best.pt to weights/best.pt, then restart the API.")


if __name__ == "__main__":
    main()
