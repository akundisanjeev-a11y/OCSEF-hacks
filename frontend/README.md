# GhostFleet frontend

React + TypeScript (Vite). Two screens:

- **Investigation**: case list and case detail, backed by `GET /cases`, `GET /cases/{observation_id}` and `POST /demo/run`.
- **Detection lab**: upload a PNG or JPEG radar image and draw the boxes from `POST /detections`.

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

## Keeping in sync with the backend

`src/api/types.ts` mirrors `backend/schemas.py`. When a Pydantic model changes, update the matching TypeScript type. `fixtures/samples/cases.synthetic.json` is a saved copy of `GET /cases?data_mode=synthetic`; refresh it the same way when the schema changes.
