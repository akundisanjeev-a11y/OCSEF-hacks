# GhostFleet backend starter

**Current ML direction: worldwide activity forecasting.** A two-level seasonal
correction tree adjusts the last-week baseline using annual activity patterns and
recent changes. Validation selects the method before the reserved test is read.
See [`training/activity_forecast/README.md`](training/activity_forecast/README.md)
for the prepared dataset and the one-command training instructions. The image
detector and AIS fixtures below are retained as earlier experiments; they are
not required for the forecasting model.

For a team of four high school students with roughly **12 working hours**.
This repository implements the detection and AIS-association part. The other
backend member owns authorization/permit decisions and case storage. Two frontend
members can build against the API examples immediately.

## Start now (Windows PowerShell)

Run from this repository root. Dependencies were installed into `.venv` during setup.

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000/docs** for interactive API testing.
Try `GET /health` and `GET /demo/matches` first. They work without model weights.
This command starts the backend only; frontend developers start their own dev server.
Stop with Ctrl+C. Restart after adding or replacing model weights.

Optional configuration: copy `.env.example` to `.env` and edit it. Existing shell
environment variables take precedence. Default CORS origins are localhost and
127.0.0.1 on port 5173; change `FRONTEND_ORIGINS` if the website uses another origin.

## What is ready and what remains

Ready: shared validated models, image-upload route, model-loading wrapper,
conservative AIS matcher, four fictional scenarios, API/matcher tests, training
entry point, and OpenAPI handoff in `docs/openapi.json`.

Still needed: a trained single-class `ship` or `vessel` detection checkpoint.
There is no trained model or real AIS feed bundled. Valid uploads return 503 until
`weights/best.pt` loads successfully. No fake detections are substituted.
Generic COCO checkpoints are rejected as inference weights.

SAR crop uploads lack acquisition time/georeferencing, so they return boxes and
scores with `identity_status: insufficient_data` and no MMSI. The fictional
matching demo is a separate path. No authorization decisions are implemented.

## Ownership and 12-hour schedule

| Time | You: detection + AIS | Backend teammate | Two frontend teammates |
| --- | --- | --- | --- |
| 0–1 h | Run starter; agree on schema | Review Observation schema; define case wrapper | Start upload screen and case dashboard |
| 1–4 h | Obtain/prepare HRSID; start a small GPU fine-tune; exercise matcher fixtures | Permit fixtures and case routes | Build screens against examples/OpenAPI |
| 4–7 h | Put validated weights in place; test actual SAR uploads | Call matcher; add authorization explanations | Connect uploads and case list/detail |
| 7–10 h | Integrate; check ambiguous/missing evidence paths | Verify case upsert and unknown states | Verify overlays and error states |
| 10–12 h | Freeze checkpoint, examples and settings; rehearse together | Freeze fictional permits | Polish demo and labels |

Do not spend the whole event searching for live feeds or building raw satellite
processing. Use a training GPU if available; the installed local PyTorch build is
CPU-only for dependable laptop inference. Training time depends on the hardware.

## Modules you own

| File | Purpose |
| --- | --- |
| `backend/schemas.py` | Shared request/response types; agree on changes with teammates |
| `backend/ml/detector.py` | Load local checkpoint once; return original-raster xyxy boxes |
| `backend/services/ais_matching.py` | Reusable scene matcher, no HTTP dependency |
| `backend/main.py` | App startup, upload validation, endpoints and CORS |
| `backend/config.py` | `.env` and demo gates |
| `fixtures/synthetic/scenes.json` | Fictional inputs and expected identity outcomes |
| `training/train.py` | Optional YOLO11n fine-tuning entry point |

## API handoff

| Route | Request | Response |
| --- | --- | --- |
| `GET /health` | none | Server status and separate `detector_ready` flag |
| `POST /detections` | Multipart `image` containing PNG/JPEG | `{ image_width, image_height, observations }` |
| `POST /matches` | One scene: observations, AIS points, coverage | `{ observations }` with matching evidence |
| `GET /demo/matches` | none | Four computed, explicitly fictional scenarios |

Frontend upload example:

```typescript
const form = new FormData();
form.append("image", file);
const response = await fetch("http://127.0.0.1:8000/detections", {
  method: "POST", body: form,
});
const result = await response.json();
if (!response.ok) throw new Error(result.detail ?? "Detection failed");
```

Let the browser set the multipart Content-Type boundary. Boxes are
`[x_min, y_min, x_max, y_max]` in returned original-raster dimensions. Use those
dimensions for the overlay viewBox. Prefer PNG demo crops without EXIF orientation.
An empty result is `observations: []`. Confidence is a model score, not a proven
probability of a correct detection or identity.

Upload errors: 400 invalid image, 413 size/pixel limit, 415 unsupported decoded
format, 422 missing/malformed fields, 503 unavailable/failed inference.
Each upload gets fresh IDs. Built-in synthetic IDs are stable across reruns.

## Backend 2 integration

Use one FastAPI app. Create your own APIRouter for `/cases`, `/cases/{id}` and
`/demo/run`, then register it inside `create_app()` in `backend/main.py`.

Call the matcher directly:

```python
from backend.schemas import MatchRequest
from backend.services.ais_matching import match_scene

request = MatchRequest.model_validate(scene_payload)
observations = match_scene(request)
for observation in observations:
    # Your service: assess authorization and upsert by observation_id.
    # Preserve observation and match_evidence in the resulting case.
    pass
```

For app-configured thresholds, pass the app's Settings instance as the second
argument. The fixture file's `request` object is a complete MatchRequest.
`GET /demo/matches` computes identity results only; it does not store cases or
implement the teammate-owned `POST /demo/run`.

Matched MMSI does not mean authorized. Unmatched does not prove illegal activity.
Authorization should remain unknown when identity, activity, permits, location,
time or applicable rules are unresolved. Keep review priority separate.

## Matcher assumptions

Default illustrative gates: 500 meters and 300 seconds per supporting AIS point.
Uses nearby records bracketing capture time (or an exact-time record), linear
lat/lon interpolation, then Haversine distance. No extrapolation. Intended for a
small-area fictional demo; date-line tracks and crossing coverage bounds are unsupported.
No vessel-motion plausibility or calibrated uncertainty model is included.

The caller must supply evidence-backed AIS coverage; the boolean is an assertion,
not something this service can independently verify. Only mark it true for a
complete fictional fixture or a justified real export. The full spatial search
radius must fit the coverage bounds. Missing/stale/conflicting tracks conservatively
yield insufficient_data rather than a definitive identity or unmatched claim.

One unique candidate with no competition is matched. Multiple candidates or a
shared vessel produce ambiguous. Adequate search with no candidate produces
unmatched. Missing metadata/coverage produces insufficient_data. Competing
associations are intentionally not forced into a nearest-neighbor answer.
Model confidence and matching evidence stay separate. IMO remains null because
there is no sourced registry cross-reference.

## Add your trained detector

For the conversion script and copyable preparation commands, follow
[`training/README.md`](training/README.md). It generates the split folders, label
previews and actual dataset YAML automatically.

1. Get images and annotations from the [official HRSID project](https://github.com/chaozhong2010/HRSID).
2. Prepare YOLO boxes: `0 x_center y_center width height`, normalized to [0,1].
   Convert COCO `[x,y,w,h]` to `[(x+w/2)/W, (y+h/2)/H, w/W, h/H]`.
   Keep a held-out test split; group crops by original scene where provenance allows.
3. Inspect converted labels visually. Use one class, `ship`. Put paired files in
   `images/{train,val,test}` and `labels/{train,val,test}`.
4. Copy `training/hrsid.example.yaml` to `training/hrsid.yaml`; set its dataset path.
5. On the training machine, run a short pipeline check first, then a longer run:

```powershell
.\.venv\Scripts\python.exe training/train.py --data training/hrsid.yaml --epochs 3 --fraction 0.05 --device cpu
# On a CUDA-enabled training environment, use --device 0 instead.
# Increase the epoch budget after checking labels and example predictions.
```

Training intentionally downloads the generic YOLO11n starting checkpoint on its
first run. Only the resulting fine-tuned single-class checkpoint belongs in
`weights/best.pt`. Evaluate actual held-out precision, recall and mAP; report the
split used and do not invent accuracy claims. Start the API again after copying
the checkpoint. Full raw-SAR calibration/geolocation is outside this starter.

## Verify

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
.\.venv\Scripts\python.exe -m pip check
```

Tests exercise real matching logic and API behavior. Upload success tests inject
a clearly marked stub detector; they do not validate trained-model accuracy.
Before presenting, upload an actual held-out SAR crop using your trained weights
and confirm overlay alignment, empty detections and failure messages in the UI.

Regenerate the checked-in OpenAPI and fictional response examples after changing
schemas or routes:

```powershell
.\.venv\Scripts\python.exe scripts/export_contracts.py
```

## Reinstall on another Windows machine

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

`requirements-lock.txt` records the packages installed on this Windows/Python 3.13
CPU setup; other platforms may need different PyTorch wheels. For GPU training,
follow the [official PyTorch installer](https://pytorch.org/get-started/locally/)
before installing Ultralytics. Package usage follows the
[Ultralytics quickstart](https://docs.ultralytics.com/quickstart/) and
[FastAPI lifespan pattern](https://fastapi.tiangolo.com/advanced/events/).
