import json

from PIL import Image
import pytest

from training.prepare_hrsid import prepare


def make_data(tmp_path):
    images = tmp_path / "raw"
    images.mkdir()
    for i in range(5):
        Image.new("RGB", (100, 100)).save(images / f"{i}.png")
    paths = []
    for name, ids in [("train", [0, 1, 2, 3]), ("test", [4])]:
        document = {
            "categories": [{"id": 1, "name": "ship"}],
            "images": [{"id": i, "file_name": f"{i}.png", "width": 100, "height": 100} for i in ids],
            "annotations": [{"image_id": i, "category_id": 1, "bbox": [10, 20, 30, 40]} for i in ids],
        }
        path = tmp_path / f"{name}.json"
        path.write_text(json.dumps(document))
        paths.append(path)
    return images, *paths


def test_conversion_and_preserved_test_split(tmp_path):
    args = make_data(tmp_path)
    result = prepare(*args, tmp_path / "output", tmp_path / "data.yaml")
    assert result["splits"]["test"] == ["4.png"]
    split_names = [set(names) for names in result["splits"].values()]
    assert not split_names[0] & split_names[1]
    assert (tmp_path / "output/labels/test/4.txt").read_text().strip() == "0 0.25000000 0.40000000 0.30000000 0.40000000"
    assert list((tmp_path / "output/previews/train").glob("*.png"))
    with pytest.raises(ValueError, match="not empty"):
        prepare(*args, tmp_path / "output", tmp_path / "other.yaml")


def test_scene_groups_stay_together(tmp_path):
    args = make_data(tmp_path)
    groups = {"0.png": "A", "1.png": "A", "2.png": "B", "3.png": "B", "4.png": "C"}
    result = prepare(*args, tmp_path / "output", tmp_path / "data.yaml", scene_map=groups)
    assert {groups[name] for name in result["splits"]["train"]}.isdisjoint(
        {groups[name] for name in result["splits"]["val"]})


def test_scene_overlap_with_test_is_rejected(tmp_path):
    args = make_data(tmp_path)
    groups = {f"{i}.png": ("A" if i in [0, 4] else "B") for i in range(5)}
    with pytest.raises(ValueError, match="overlap"):
        prepare(*args, tmp_path / "output", tmp_path / "data.yaml", scene_map=groups)


def test_invalid_box_is_rejected_before_output(tmp_path):
    images, train, test = make_data(tmp_path)
    data = json.loads(train.read_text())
    data["annotations"][0]["bbox"] = [95, 20, 30, 40]
    train.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="out-of-bounds"):
        prepare(images, train, test, tmp_path / "output", tmp_path / "data.yaml")
    assert not (tmp_path / "output").exists()
