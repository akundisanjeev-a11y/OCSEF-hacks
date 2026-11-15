"""Convert COCO ship boxes, split train/validation, and render label previews."""

import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import random
import shutil

from PIL import Image, ImageDraw


def prepare(images_root, train_json, test_json, output, yaml_path, val_fraction=0.2, scene_map=None):
    images_root = Path(images_root).resolve()
    output = Path(output).resolve()
    yaml_path = Path(yaml_path).resolve()
    if not 0 < val_fraction < 1:
        raise ValueError("Validation fraction must be between 0 and 1")
    if output.exists() and any(output.iterdir()):
        raise ValueError("Output folder is not empty; use a new output folder")
    if yaml_path.exists():
        raise ValueError("YAML already exists; choose a new --yaml path")
    documents = [json.loads(Path(p).read_text(encoding="utf-8-sig")) for p in (train_json, test_json)]
    records = []
    seen = set()
    for document in documents:
        categories = document["categories"]
        if len(categories) != 1 or categories[0]["name"].lower() not in {"ship", "vessel"}:
            raise ValueError("Expected one COCO category named ship or vessel")
        category_id = categories[0]["id"]
        annotations = defaultdict(list)
        image_ids = {image["id"] for image in document["images"]}
        if len(image_ids) != len(document["images"]):
            raise ValueError("Duplicate image IDs within a COCO document")
        for annotation in document["annotations"]:
            if annotation["image_id"] not in image_ids or annotation["category_id"] != category_id:
                raise ValueError("Annotation references an unknown image or category")
            annotations[annotation["image_id"]].append(annotation)
        current = []
        for image in document["images"]:
            relative = image["file_name"]
            source = (images_root / relative).resolve()
            if not source.is_relative_to(images_root) or not source.is_file():
                raise ValueError(f"Image missing or outside image root: {relative}")
            name = source.name
            # YOLO uses the image stem for label filenames.
            if source.stem.casefold() in seen:
                raise ValueError(f"Duplicate image stem across splits: {name}")
            seen.add(source.stem.casefold())
            width, height = image["width"], image["height"]
            with Image.open(source) as actual:
                if actual.size != (width, height):
                    raise ValueError(f"Annotation dimensions disagree with image: {name}")
                actual.verify()
            lines = []
            boxes = []
            for annotation in annotations[image["id"]]:
                x, y, w, h = annotation["bbox"]
                if not all(math.isfinite(v) for v in (x, y, w, h)):
                    raise ValueError(f"Nonfinite box in {name}")
                if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > width or y + h > height:
                    raise ValueError(f"Invalid/out-of-bounds box in {name}: {annotation['bbox']}")
                lines.append(f"0 {(x+w/2)/width:.8f} {(y+h/2)/height:.8f} {w/width:.8f} {h/height:.8f}")
                boxes.append((x, y, x+w, y+h))
            if scene_map is not None:
                group = scene_map.get(relative)
                if not isinstance(group, str) or not group:
                    raise ValueError(f"Scene map lacks a valid scene ID for {relative}")
            else:
                group = relative
            current.append(dict(source=source, name=name, group=group, labels=lines, boxes=boxes))
        records.append(current)
    training, test = records
    if not test:
        raise ValueError("The held-out test JSON is empty")
    groups = sorted({record["group"] for record in training})
    if len(groups) < 2:
        raise ValueError("Need at least two training images/scene groups to split train and validation")
    if scene_map is not None and set(groups) & {record["group"] for record in test}:
        raise ValueError("Original scenes overlap the supplied train and test sets")
    random.Random(42).shuffle(groups)
    count = min(len(groups)-1, max(1, round(len(groups)*val_fraction)))
    validation_groups = set(groups[:count])
    splits = {
        "train": [r for r in training if r["group"] not in validation_groups],
        "val": [r for r in training if r["group"] in validation_groups],
        "test": test,
    }
    manifest = {"seed": 42, "grouping": "scene" if scene_map is not None else "image_only",
                "splits": {key: [r["name"] for r in rows] for key, rows in splits.items()}}
    for split, rows in splits.items():
        image_dir = output / "images" / split
        label_dir = output / "labels" / split
        image_dir.mkdir(parents=True, exist_ok=True)
        label_dir.mkdir(parents=True, exist_ok=True)
        for row in rows:
            shutil.copy2(row["source"], image_dir / row["name"])
            (label_dir / f"{Path(row['name']).stem}.txt").write_text(
                "\n".join(row["labels"]) + ("\n" if row["labels"] else ""), encoding="utf-8")
        if split != "test":
            preview_dir = output / "previews" / split
            preview_dir.mkdir(parents=True, exist_ok=True)
            for row in rows[:6]:
                with Image.open(row["source"]) as source:
                    preview = source.convert("RGB")
                draw = ImageDraw.Draw(preview)
                for box in row["boxes"]:
                    draw.rectangle(box, outline="red", width=2)
                preview.save(preview_dir / f"{Path(row['name']).stem}.png")
                preview.close()
    output.mkdir(parents=True, exist_ok=True)
    (output / "split_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    yaml_path.parent.mkdir(parents=True, exist_ok=True)
    yaml_path.write_text(
        f"path: {json.dumps(output.as_posix())}\ntrain: images/train\nval: images/val\n"
        "test: images/test\nnames:\n  0: ship\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", required=True, help="Folder relative to which COCO file_name paths resolve")
    parser.add_argument("--train-json", required=True, help="Supplied training/trainval COCO annotations")
    parser.add_argument("--test-json", required=True, help="Separate held-out COCO test annotations")
    parser.add_argument("--output", default="datasets/hrsid")
    parser.add_argument("--yaml", default="training/hrsid.yaml")
    parser.add_argument("--val-fraction", type=float, default=0.2)
    parser.add_argument("--scene-map", help="Optional JSON mapping every image file_name to its original scene ID")
    args = parser.parse_args()
    try:
        scene_map = json.loads(Path(args.scene_map).read_text(encoding="utf-8-sig")) if args.scene_map else None
        result = prepare(args.images, args.train_json, args.test_json, args.output,
                         args.yaml, args.val_fraction, scene_map)
    except (ValueError, KeyError, OSError) as exc:
        parser.exit(1, f"Preparation failed: {exc}\n")
    print("Prepared image counts:", {key: len(value) for key, value in result["splits"].items()})
    print("Dataset YAML:", Path(args.yaml).resolve())
    print("Inspect red-box previews under", Path(args.output).resolve() / "previews")
    if scene_map is None:
        print("LIMITATION: image-level split only; original-scene leakage has not been ruled out.")


if __name__ == "__main__":
    main()
