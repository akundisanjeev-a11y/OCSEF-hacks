# Notice Helper: frontend handoff

Use [sample-response.json](sample-response.json) to build the results screen. It's a live Spanish response to this [fictional school notice](sample-notice.txt). It includes one exact deadline, one without a year, and one relative deadline. Import the JSON locally and pass it to the same component that will receive the API result. No server or key is needed to use the fixture. The field names and types are the contract; the AI's wording can vary.

## Send one upload

POST `/api/notices/analyze`. The local base URL is `http://127.0.0.1:8000`. Send multipart form data with two required fields: `file` (one file) and `target_language` (one nonblank language name, up to 64 characters). Let the browser set the Content-Type header. Do not send JSON, base64, or an API key.

```js
const form = new FormData();
form.append("file", file);
form.append("target_language", "Spanish");
const response = await fetch(`${apiBase}/api/notices/analyze`, {
  method: "POST",
  body: form,
});
```

- Accept JPEG (.jpg/.jpeg), PNG, PDF (including scans and multi-page files), and UTF-8 TXT. Each file may be up to 5 MiB (5,242,880 bytes); text also has a 40,000-character limit. There is no separate page limit enforced by the app. A phone photo must be in a supported format: convert HEIC/HEIF to JPEG or PNG; renaming the extension will fail validation.
- For pasted text, set `file` to `new File([pastedText], "notice.txt", { type: "text/plain;charset=utf-8" })` and use the same request. There is no raw-text field.
- One request returns one complete response. There is no job ID, polling, progress percentage, or streaming. Show “Analyzing your notice…” and disable double submits. One short text upload took 1.6 seconds locally; there is no typical latency measurement for photos or PDFs. The provider request timeout is configured at 90 seconds; that is not a total browser deadline.

## Render a successful response (HTTP 200)

| Field | What to render |
| --- | --- |
| `title`, `sender` | One short English headline and the name of the sender as written. If the notice doesn't identify a sender, `sender` is `null`; hide the sender line. |
| `summary` | One plain-English string. |
| `deadlines` | Each object has `action` (English), `when` (original timing phrase), `source_quote` (original passage), and `date` (a YYYY-MM-DD string or `null`). Only deadlines for actions belong here. |
| `checklist` | Array of English strings. Keep checkbox state in the UI. No task IDs or per-task due dates. |
| `translated_summary`, `translated_checklist` | The summary string and checklist array in the selected language. The translated checklist has one item per English item, in the same order. The UI can toggle languages without losing checkbox state. |
| `translated_instructions` | One plain-text string of actionable instructions. It may have line breaks. Render as text with `white-space: pre-line`; do not parse it as Markdown or split it to create checklist items. It is not a full translation of the letter. |
| `uncertainties` | Array of English strings describing unclear information. Show as “Double-check these details” when nonempty. No per-item confidence score. |

All listed fields are present on success. Lists can be empty: show “No action deadline found” for an empty deadline list. There is no contacts field, full source text, page number, bounding box, or character offset. A deadline card can show its quote. You can preview the uploaded file next to the results, but the API cannot locate a passage visually or align paragraphs.

**The “When?” screen:** Always show `when`, including any cutoff time or time zone. When `date` is present, it represents a calendar day, not a timestamp: sort the ISO strings, count calendar days, and use a date-only (all-day) calendar entry with the original wording in the description. Avoid displaying `new Date("YYYY-MM-DD")` in local time; in some time zones it shows the previous day. For `null`, display the wording as-is, group it under “Other deadlines,” and omit countdown and calendar buttons. Never fill in the current year. Relative dates, ambiguous numeric dates, and exclusive cutoffs such as “before May 3, 2027” should use this fallback.

Ask for the language **before** the first upload. Switching between English and the already-returned translation is local. For a new language, it's OK to resubmit the file after an explicit “Translate” click; don't submit on every dropdown change. Keep results for this file in memory by language so switching back costs no quota, and clear that cache when the file changes. Each new analysis uses quota; there is no translation-only endpoint.

Send language names such as “Spanish”, “Vietnamese”, “Simplified Chinese”, “Arabic”, or “Urdu”; there is no enforced list or code mapping. Spanish has been tested end to end. For Arabic or Urdu, set the translation block's direction to RTL (or use `dir="auto"`). Only the three `translated_*` fields are in the selected language; localize UI labels separately.

## Handle failure

Check `response.ok` before treating JSON as a notice. App errors generally return a string, e.g. `{"detail":"The uploaded file is empty."}`. Missing or invalid form fields can yield `{"detail":[...]}` with validation objects containing `loc` and `msg`. There is no custom machine-readable error code. Handle a network failure or an unexpected non-JSON error separately.

| HTTP status | What the frontend should tell the user |
| --- | --- |
| 413 | The upload is too large. Choose a smaller file or shorten pasted text. |
| 415 | Choose PDF, PNG, JPEG, or UTF-8 TXT. |
| 422 | Check the file and language. Depending on the detail: supply the missing field, export a valid file, or retry with a clearer or shorter notice. |
| 429 | The service has reached its quota. Try again later. |
| 502 | The AI service could not complete the analysis. Try again later. |
| 503 | The service is not configured correctly. Ask the project team; never ask the reader for an API key. |
| 504 | Analysis timed out. Try a shorter notice. |

There is no dedicated “blurry” or “not a letter” error. An unclear passage may appear in `uncertainties` on a successful response. An incomplete or unprocessable analysis can yield 422. Do not promise a warning for every unusable document.

## Run and share safely

**Demo plan:** Run the frontend and backend together on the presenter's laptop. Point the frontend at `http://127.0.0.1:8000`; only the presenter needs a configured backend key, and live analysis needs internet access. Anyone else developing against the fixture needs no key. A teammate testing live on a separate laptop needs a local backend and their own key. No shared deployment URL is configured here. Keep the API base configurable if the integrator hosts it later.

See the [backend setup instructions](../backend/README.md). Interactive API docs are at `http://127.0.0.1:8000/docs` while the server is running. CORS allows HTTP origins on localhost and 127.0.0.1 on ports 3000, 5173, and 5500. If the team deploys later, allow the hosted frontend's exact origin on the backend.

No login, database, saved results, or share links. The backend processes the uploaded file for the request and has no application-level storage for notices or results; uploads may be temporarily buffered by the server. With results held only in frontend memory, a refresh clears them. Keep the Gemini key on the backend. The upload and response go through Google's Gemini service: [Google's unpaid-service terms](https://aistudio.google.com/docs/terms#unpaid-services) allow use of submitted data for product improvement and human review. Use fictional or redacted documents. Do not promise immediate deletion by Google.
