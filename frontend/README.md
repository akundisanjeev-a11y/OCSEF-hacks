# GhostFleet frontend

React + TypeScript (Vite) with a MapLibre map. Four screens:

- **Overview**: map of cases near Ghana's coast with filters (data source, capture date, AIS match, authorization, review priority, fishing-zone proximity, detection score, drawn area), a case panel and the case list.
- **Detection lab**: upload a PNG or JPEG radar image, draw the boxes from `POST /detections`, filter by score, compare against an optional YOLO label file, and show the model's evaluation numbers.
- **Investigations**: priority-ranked queue, a five-step evidence trail per case, full case detail and case report export.
- **Coastal impact**: summary report of detections, AIS matching, authorization, review priority, missing evidence and activity by fishing zone, with download and print.

## Run it

Start the FastAPI backend first (from the repo root, on a branch that has `backend/`):

```
python -m uvicorn backend.main:app --reload
```

Then, in a second terminal:

```
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

The dev server forwards every `/api/...` request to FastAPI at `http://localhost:8000`, so the backend needs no CORS setup. To use a different backend URL, copy `.env.example` to `.env.local` and change `BACKEND_URL`.

Use the **Backend** menu in the top right to switch to **Sample data**. The app then reads `fixtures/samples/*.json` and needs no backend.

## Placeholder data the team should replace

All of these live in `fixtures/samples/`:

| File | What it is | Who replaces it |
| --- | --- | --- |
| `cases.synthetic.json` | 22 fictional cases for sample mode. The first 6 are a saved copy of the backend's seeded cases. | Not needed once the backend serves enough cases |
| `fishing_zones.illustrative.json` | Three hand-drawn zones used for the map layer and the proximity filter. Not official boundaries. | Backend 2, if real or agreed zone shapes become available |
| `model_metrics.json` | Precision, recall and mAP@0.5 shown in the Detection lab. All null until measured. | Backend 1, after evaluating on the held-out split |
| `detections.upload.json` | One example `POST /detections` response for sample mode. | Backend 1 |

## Keeping in sync with the backend

`src/api/types.ts` mirrors `backend/schemas.py`. When a Pydantic model changes, update the matching TypeScript type and the sample cases.
