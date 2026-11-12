/* Plainly frontend config.
   Presenter laptop: run the backend (see backend/README.md on the Siddu-folder branch),
   then set USE_MOCK to false. API contract: api/frontend-handoff.md on that branch. */
window.PLAINLY_CONFIG = {
  API_BASE: "http://127.0.0.1:8000",
  USE_MOCK: true,                 // true = use built-in sample responses, no backend or key needed
  REQUEST_TIMEOUT_MS: 120000,     // backend's Gemini timeout is 90s; leave headroom
  MAX_FILE_BYTES: 5 * 1024 * 1024, // backend limit: 5 MiB
  MAX_TEXT_CHARS: 40000,          // backend limit for text
  ACCEPT: ".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain",

  /* Languages offered before upload. `name` is sent to the backend as target_language.
     There's no fixed list on the backend; "Other" lets people type any language. */
  LANGUAGES: [
    { name: "Spanish", native: "Español", speech: "es-US" },
    { name: "Vietnamese", native: "Tiếng Việt", speech: "vi-VN" },
    { name: "Simplified Chinese", native: "简体中文", speech: "zh-CN" },
    { name: "Tagalog", native: "Tagalog", speech: "fil-PH" },
    { name: "Arabic", native: "العربية", speech: "ar-SA", rtl: true },
    { name: "Korean", native: "한국어", speech: "ko-KR" },
    { name: "Russian", native: "Русский", speech: "ru-RU" },
    { name: "Portuguese", native: "Português", speech: "pt-BR" },
    { name: "Haitian Creole", native: "Kreyòl ayisyen", speech: "ht" },
    { name: "Urdu", native: "اردو", speech: "ur-PK", rtl: true },
    { name: "English", native: "English", speech: "en-US" }
  ]
};
