# Plainly frontend

Plain HTML, CSS and JavaScript. No build step and nothing to install.

**Putting the frontend and backend together in `main`?** Start with [HANDOFF.md](HANDOFF.md).

## Run it

```
cd frontend
python -m http.server 5500
```

Open http://localhost:5500. Port 5500 is one of the origins the backend allows (CORS).

| Page | File |
|---|---|
| Landing | `index.html` |
| Reader (choose language, upload, then the 4 questions) | `read.html` |
| My letters (saved on this device) | `letters.html` |

## Connect to the backend

The API contract is owned by the backend: see `api/frontend-handoff.md` and `api/sample-response.json` on the `Siddu-folder` branch.

1. Start the backend on the same laptop (see `backend/README.md` on `Siddu-folder`). It runs on `http://127.0.0.1:8000`.
2. In `js/config.js`, set `USE_MOCK: false`. Change `API_BASE` only if the backend runs somewhere else.
3. Hard-refresh the page (Ctrl+Shift+R).

All network code is in **`js/api.js`**. It sends `POST /api/notices/analyze` as multipart form data with `file` and `target_language`, and turns HTTP errors into the error screens.

With `USE_MOCK: true`, nobody needs a backend or Gemini key. Uploads show a built-in sample result, labeled as a demo.

## How the frontend uses the response

| Backend field | Where it shows up |
|---|---|
| `title`, `sender` | "What is this?" headline and sender line (hidden when `sender` is null) |
| `summary` / `translated_summary` | "What is this?" body. A "Show in" toggle switches English and the chosen language |
| `deadlines[].date` | Sorting, "in N days", calendar files (all-day). Only when not null |
| `deadlines[].when` | Always shown as written ("The letter says: by May 8") |
| `deadlines[].source_quote` | Shown under each deadline |
| `checklist` / `translated_checklist` | "What do I do?" Checkbox state is saved by position, so it survives language switches |
| `translated_instructions` | "Your language" step, rendered with `white-space: pre-line` and `dir="auto"` |
| `uncertainties` | "Double-check these details" box |

Language is chosen **before** upload. A third language re-sends the file only after the user clicks **Translate**, and each result is cached per language, so switching back is free. The file stays in memory only; after a page reload, a new language needs a re-upload.

## Built-in samples

`js/mock-data.js` has three samples in the backend's exact shape:
- `artnight`: the backend team's `sample-response.json`, unchanged (Spanish)
- `school`: a vaccine notice (Spanish, Vietnamese, Simplified Chinese, Tagalog, Arabic)
- `benefits`: a food benefits renewal with two `uncertainties` (Spanish, Vietnamese, Simplified Chinese)

With the backend connected, translating a sample into a language it doesn't include sends the sample's text to the backend.

Dev helpers:
- `read.html?sample=artnight` runs a sample straight away.
- `read.html?mockError=QUOTA` previews an error screen (mock mode). Codes: `TOO_LARGE`, `UNSUPPORTED_FILE`, `UNPROCESSABLE`, `QUOTA`, `SERVICE`, `NOT_CONFIGURED`, `TIMEOUT`, `NETWORK`, `HEIC`.

## Integration test (from the backend team)

Paste: "The field trip is May 10. Return the signed slip by May 3." and choose Spanish. Expect May 3 as the only deadline, with the exact sentence under it, and Spanish instructions that make clear the slip can still be returned on May 3.

## Where things live

```
frontend/
  index.html  read.html  letters.html
  css/plainly.css     shared tokens and components
  css/home.css  css/read.css  css/letters.css
  js/config.js        API_BASE, USE_MOCK, language list
  js/api.js           all network calls
  js/mock-data.js     built-in samples (backend response shape)
  js/i18n.js          interface text, English + Spanish
  js/home-strings.js  landing page text
  js/store.js         saved letters (localStorage)
  js/ui.js            header/footer, icons, dates, calendar files
  js/read.js  js/home.js  js/letters.js   page logic
```
