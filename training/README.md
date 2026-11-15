# Prepare HRSID and start training

Run commands from the repository root. No HRSID download was found during setup;
you must first download and extract the images and COCO annotations from the
[official repository](https://github.com/chaozhong2010/HRSID).

1. Put extracted data under `datasets/raw/`. Find the image folder and separate
   training/trainval and test JSONs. To list JSON paths:

   ```powershell
   Get-ChildItem datasets/raw -Recurse -Filter *.json | Select-Object FullName
   ```

2. Run the converter. **The three input paths below are examples: replace them
   with the actual extracted paths.** The image folder must be the folder relative
   to which the annotation JSON's `file_name` values resolve.

   ```powershell
   .\.venv\Scripts\python.exe training/prepare_hrsid.py --images "datasets/raw/HRSID/JPEGImages" --train-json "datasets/raw/HRSID/annotations/train2017.json" --test-json "datasets/raw/HRSID/annotations/test2017.json"
   ```

   This creates `datasets/hrsid/images/{train,val,test}`, matching `labels/`
   directories, `datasets/hrsid/split_manifest.json`, red-box previews, and
   `training/hrsid.yaml` with your absolute dataset path. Do not copy the example
   YAML afterward: the converter already generates it.

   The converter keeps the supplied test set intact and takes 20% of training
   image groups for validation, with a fixed seed. Without scene provenance, these
   are image-level groups, which may not eliminate original-scene leakage. If you
   have a JSON mapping every image filename to its original scene ID, append
   `--scene-map "path/to/scenes.json"`. It keeps groups together and rejects scene
   overlap with the supplied test set. Do not infer scene IDs without evidence.

   To protect prepared data, it refuses a nonempty output directory or existing
   YAML. For a fresh conversion use `--output datasets/hrsid_v2 --yaml training/hrsid_v2.yaml`.

3. Open `datasets/hrsid/previews/train` and `datasets/hrsid/previews/val` in File
   Explorer. Red boxes should surround ships. Stop and fix mismatched boxes,
   incorrect images, or annotation errors before training. The previews show a
   small sample; inspect more source images if anything looks suspicious.

4. Run a short CPU pipeline check on 5% of training images:

   ```powershell
   .\.venv\Scripts\python.exe training/train.py --data training/hrsid.yaml --epochs 3 --fraction 0.05 --batch 4 --device cpu
   ```

   An epoch is one pass through the selected training images. This checks that
   data loading and training work; it does not establish useful accuracy. The
   initial YOLO11n checkpoint downloads on the first run. CPU runs can be slow.

5. For the longer run, use a CUDA-enabled training environment if available:

   ```powershell
   # Requires a GPU-enabled PyTorch installation; this project's local build is CPU-only.
   .\.venv\Scripts\python.exe training/train.py --data training/hrsid.yaml --epochs 20 --fraction 1 --batch 8 --device 0
   ```

   On this CPU setup, use `--device cpu --batch 4` instead, with no guarantee it
   will finish within the event. Twenty epochs is a starting budget, not an
   accuracy guarantee. If using a hosted notebook, install dependencies there,
   upload the data/scripts and regenerate the dataset YAML for that machine.

6. Read the actual output folder printed by training. Separate runs may be named
   `ship`, `ship2`, etc. Inspect validation predictions and metrics before selecting
   a checkpoint. Choose inference settings on validation data, not the test set.
   Evaluate the selected checkpoint once on the held-out test split, replacing
   the example run path below:

   ```powershell
   .\.venv\Scripts\yolo.exe detect val model=runs/ship2/weights/best.pt data=training/hrsid.yaml split=test device=cpu
   ```

7. Copy the selected trained checkpoint, then restart the API:

   ```powershell
   Copy-Item -LiteralPath "runs/ship2/weights/best.pt" -Destination "weights/best.pt"
   ```

   Record precision, recall, mAP, split method and model path. Test the actual
   deployment radar source separately; HRSID evaluation does not establish
   performance on differently processed satellite imagery.

Format references: [YOLO labels](https://docs.ultralytics.com/datasets/detect/)
and [training options](https://docs.ultralytics.com/modes/train/).
