import torch
import torchvision.models
import torch.nn as nn
from torchvision import datasets, transforms
from torch.utils.data import TensorDataset, DataLoader
from ultralytics import YOLO
from pathlib import Path

    
def main():    
    model = YOLO("yolo11n.pt")

    model.train(
        data="training/hrsid.yaml",
        epochs=5,
        batch=4,
        imgsz=640,
        device="cpu",
        workers=0,
    )

if __name__ == "__main__":
    main()
