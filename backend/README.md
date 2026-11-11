# Notice Helper backend

Choose a language and upload one notice. The API returns a headline, sender (if stated), summary, deadlines with source quotes and optional calendar dates, checklist, translations of the summary, checklist and instructions, and any unclear details. The backend sends the notice to Google's Gemini Developer API. Use fictional or redacted notices for practice because Google may use free-tier content to improve its products. [Gemini pricing and data use](https://ai.google.dev/gemini-api/docs/pricing)

## Run locally on Windows

From the repository root, run these PowerShell commands. The first two are one-time setup.

```powershell
py -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python -m uvicorn backend.main:app --reload
```

The server reads `backend/.env` on each upload. On a fresh clone, copy `backend/.env.example` to `backend/.env`, then set `GEMINI_API_KEY` locally. Create the key in a Google AI Studio project on the Free tier with billing disabled. This backend uses Gemini 3.5 Flash-Lite. Git ignores the local file. The frontend sends only the document and target language. [Google AI Studio API keys](https://aistudio.google.com/api-keys)

Open [the local API page](http://127.0.0.1:8000/docs), expand **POST /api/notices/analyze**, and click **Try it out**. Choose a file, enter a language such as Spanish, and click **Execute**. Supported files are PDF (including scans), PNG, JPEG, and UTF-8 TXT up to 5 MiB. Text files can contain up to 40,000 characters.

## Connect the frontend

Send `file` and `target_language` as multipart form fields. The browser sets the content type and boundary. Local frontend origins on ports 3000, 5173, and 5500 are allowed.

```js
const form = new FormData();
form.append("file", fileInput.files[0]);
form.append("target_language", "Spanish");
const response = await fetch("http://127.0.0.1:8000/api/notices/analyze", {
  method: "POST",
  body: form,
});
const result = await response.json();
if (!response.ok) throw new Error(JSON.stringify(result.detail));
```

See the [frontend handoff](../api/frontend-handoff.md) and [sample JSON](../api/sample-response.json) for the response fields, date handling, language selection, and demo setup.
