from ultralytics import YOLO


def main():
    # Replace with your actual trained checkpoint path.
    model = YOLO("runs/detect/train/weights/best.pt")

    metrics = model.val(
        data="testing/hrsid.yaml",
        split="test",
        imgsz=640,
        batch=4,
        device="cpu",
        workers=0,
        plots=True,
    )

    print("Precision:", metrics.box.mp)
    print("Recall:", metrics.box.mr)
    print("mAP@0.5:", metrics.box.map50)
    print("mAP@0.5:0.95:", metrics.box.map)


if __name__ == "__main__":
    main()