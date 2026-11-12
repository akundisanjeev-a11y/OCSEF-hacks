# Plainly: integration handoff (frontend)

This explains how to put the frontend (`frontend/` on the `joshua` branch) together with the backend (`backend/` and `api/` on the `Siddu-folder` branch) in `main`, run both on the presenter's laptop, and check that they work together.

The frontend is plain HTML, CSS and JavaScript. It has no build step and no npm packages. It already follows the backend contract in `api/frontend-handoff.md`, so integration should need **one config change and no code changes**.

## What goes into `main`

```
main/
  README.md
  .gitignore         from Siddu-folder (keeps backend/.env and .venv out of git)
  api/               from Siddu-folder: frontend-handoff.md, sample-response.json, sample-notice.txt
  backend/           from Siddu-folder: main.py, requirements.txt, .env.example, README.md
  frontend/          from joshua: index.html, read.html, letters.html, css/, js/
```

Leave out `frontend-ideas/` if it ever shows up. It held early design mockups and isn't part of the app.

```powershell
git checkout main
git pull
git merge origin/Siddu-folder
git merge origin/joshua
git push
```

The two branches don't touch the same files, so these merges shouldn't conflict. If `README.md` conflicts, keep either version and add a link to `frontend/README.md` and `backend/README.md`.

## Run it on the presenter's laptop

Use two terminals, both started from the repository root.

**Terminal 1: backend.** The first two commands are one-time setup. Put the Gemini key in `backend/.env` (copy `backend/.env.example`). See `backend/README.md` for the full steps.

```powershell
py -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python -m uvicorn backend.main:app --reload
```

**Terminal 2: frontend.**

```powershell
python -m http.server 5500 --directory frontend
```

**Switch the frontend to the live backend.** In `frontend/js/config.js`, change one line:

```js
USE_MOCK: false,
```

`API_BASE` is already `http://127.0.0.1:8000`. Open http://localhost:5500 and hard-refresh (Ctrl+Shift+R) so the browser picks up the new config.

> Open the site through the server on port 5500, not by double-clicking `index.html`. A page opened from disk has the origin `null`, which the backend's CORS settings block, so every upload would fail with "Can't reach Plainly".

With `USE_MOCK: true` (the default), the whole site works with no backend and no key. Uploads show a built-in sample result labeled "Demo mode". Teammates without a key can build and present the UI this way.

## How the frontend talks to the backend

Everything network-related is in **`frontend/js/api.js`**. No other file calls `fetch`.

| Frontend action | Request |
|---|---|
| Upload a file or photo | `POST /api/notices/analyze` with multipart `file` and `target_language` |
| Paste text | Same request. The text is sent as `file` = `notice.txt` (`text/plain;charset=utf-8`) |
| Translate into a third language | Same request again, with the same file and the new language. Only sent after the user clicks **Translate** |
| "Try a sample" | No request. Uses `frontend/js/mock-data.js`. If the user asks for a language the sample doesn't include, the sample's text is sent to the backend |

`target_language` is the English name of the language ("Spanish", "Simplified Chinese"). The list offered is in `frontend/js/config.js` (`LANGUAGES`), and there's an "Other" option where users can type any language.

These are checked in the browser **before** sending, so they never reach the backend or use quota:

- File type: `.pdf`, `.png`, `.jpg`, `.jpeg`, `.txt`. `.heic`/`.heif` get their own message.
- Size: 5 MiB.
- Pasted text: at least 40 characters and at most 40,000.

### What the frontend relies on in the response

`api/frontend-handoff.md` and `api/sample-response.json` are the source of truth. The frontend checks that `title` and `summary` are strings and that `deadlines`, `checklist`, `translated_checklist` and `uncertainties` are arrays. Anything else is treated as a server error.

| Field | Used for |
|---|---|
| `title`, `sender` | Headline on "What is this?". The sender line is hidden when `sender` is `null` |
| `summary`, `translated_summary` | Body of "What is this?". The "Show in" toggle switches between them |
| `deadlines[].date` | Sorting, "in N days", and all-day calendar files. Only used when it isn't `null` |
| `deadlines[].when`, `action`, `source_quote` | Always shown as written. `null`-date deadlines go under "Other deadlines" |
| `checklist`, `translated_checklist` | "What do I do?". Checkbox state is stored by position. If the two lists aren't the same length, the checklist stays in English |
| `translated_instructions` | "Your language" step, shown with `white-space: pre-line` and `dir="auto"` (Arabic and Urdu are forced to `rtl`) |
| `uncertainties` | "Double-check these details" box. Hidden when the list is empty |

### Errors

| Backend response | Screen the user sees |
|---|---|
| 413 | "That file is too big" |
| 415 | "That file type won't work" |
| 422 | "We couldn't read this letter" |
| 429 | "Plainly is busy right now" (with Try again) |
| 502 | "The reading service didn't respond" |
| 503 | "Plainly isn't set up correctly". The user is never asked for a key |
| 504, or no answer within 120 s | "This is taking too long" |
| Network failure or CORS block | "Can't reach Plainly" |
| Anything else | "Something went wrong" |

Every error screen also shows the backend's `detail` text under **Details**. List-style `detail` values are joined into one line. To preview any error screen without a backend, open `read.html?mockError=QUOTA` (or another code from the list in `frontend/README.md`).

## Check that it works

Do these in order on the presenter's laptop with `USE_MOCK: false`.

1. Open http://localhost:5500. The landing page loads, and the header has **Upload a letter**.
2. Click **Upload a letter**, choose **Español**, click **Paste the text**, and paste: `The field trip is May 10. Return the signed slip by May 3.` Click **Explain this text**.
3. On **When?**, May 3 should be the only deadline, with the exact sentence quoted under it. Because the letter gives no year, `date` should be `null`: no countdown, under "Other deadlines".
4. On **Your language**, the Spanish instructions should make clear the slip can still be returned **on** May 3 ("a más tardar el 3 de mayo").
5. On **What do I do?**, tick a box, switch **Show in** between English and Español, and check that the box stays ticked.
6. On **Your language**, pick another language and click **Translate**. This uses one more request. Switch back to Español; that switch shouldn't send anything (check the backend terminal).
7. Upload a real PDF or JPG of a fictional letter. The "Analyzing your notice…" screen should show, then the results.
8. Stop the backend and upload again. You should see "Can't reach Plainly". Start it again before the demo.

## What's saved where

| What | Where | Notes |
|---|---|---|
| Results and checkbox state | Browser `localStorage`, key `plainly.letters.v2` | Shown on "My letters". Only on that device. No backend storage |
| Chosen translation language | `localStorage`, key `plainly.targetLang` | Pre-selected next time |
| Site language (English/Español) | `localStorage`, key `plainly.lang` | The interface only, not the letter |
| The uploaded file | Memory only | Gone after a page reload. A reloaded letter can't be translated into a new language until it's uploaded again; the page says so |

## Known limits

- **Site language:** the interface text is in English and Spanish only (`frontend/js/i18n.js`). Letter content can be in any language the backend supports.
- **English-only parts:** deadlines and `uncertainties` stay in English, because the backend returns them in English. The page says so when another language is selected.
- **Read aloud:** "Listen" uses the browser's built-in speech. Whether a language has a voice depends on the laptop. Test the demo language beforehand.
- **HEIC photos:** they aren't converted. The phone camera button asks for JPEG/PNG, and HEIC files get a "save as JPG" message.
- **Testing so far:** the frontend has been tested against the sample responses and against a local fake of this exact contract. It has **not** yet run against the live Gemini backend. Steps 2–7 above are that test.

## If something changes later

| Change | Update |
|---|---|
| Backend moves to another port or a hosted URL | `API_BASE` in `frontend/js/config.js`, and add the frontend's exact origin to CORS in `backend/main.py` |
| Frontend served on a port other than 3000, 5173 or 5500 | CORS in `backend/main.py` |
| New field in the response | Map it in `frontend/js/read.js`. No change is needed for fields the frontend can ignore |
| Offer another language in the picker | Add it to `LANGUAGES` in `frontend/js/config.js` |
| Change any wording on the site | `frontend/js/i18n.js` (reader and My letters) or `frontend/js/home-strings.js` (landing page) |

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every upload shows "Can't reach Plainly" | Backend not running, page opened from disk instead of port 5500, or `API_BASE` is wrong |
| Uploads always show "Demo mode" | `USE_MOCK` is still `true`, or the browser cached the old `config.js`. Hard-refresh |
| "Plainly isn't set up correctly" (503) | `GEMINI_API_KEY` missing or invalid in `backend/.env` |
| "Plainly is busy right now" (429) | Gemini free-tier quota reached. Use the built-in samples for the rest of the demo |
| Page looks unstyled or old after an update | Browser cache. Hard-refresh with Ctrl+Shift+R |

More detail about the frontend's files is in `frontend/README.md`.
