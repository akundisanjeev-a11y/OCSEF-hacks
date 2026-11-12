/* Plainly API layer. THE ONLY FILE THAT TALKS TO THE BACKEND.
   Contract: api/frontend-handoff.md on the Siddu-folder branch.
     POST {API_BASE}/api/notices/analyze  (multipart: file, target_language)  ->  Notice
   The UI only calls:
     Plainly.api.analyze({ file, language })       -> Promise<Notice>
     Plainly.api.sample(key, language)              -> Promise<Notice>  (built-in samples)
     Plainly.api.textToFile(text)                   -> File  (pasted text -> notice.txt)
   Errors are thrown as PlainlyError { code, status, detail }. */
(function () {
  const CFG = window.PLAINLY_CONFIG;
  const Plainly = (window.Plainly = window.Plainly || {});

  class PlainlyError extends Error {
    constructor(code, detail, status) { super(detail || code); this.code = code; this.detail = detail || ""; this.status = status || 0; }
  }

  const STATUS_CODES = { 413: "TOO_LARGE", 415: "UNSUPPORTED_FILE", 422: "UNPROCESSABLE", 429: "QUOTA", 502: "SERVICE", 503: "NOT_CONFIGURED", 504: "TIMEOUT" };
  const OK_EXT = /\.(pdf|png|jpe?g|txt)$/i;

  function textToFile(text) {
    return new File([text], "notice.txt", { type: "text/plain;charset=utf-8" });
  }

  async function validate(file) {
    if (/\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)) throw new PlainlyError("HEIC");
    if (!OK_EXT.test(file.name)) throw new PlainlyError("UNSUPPORTED_FILE");
    if (file.size > CFG.MAX_FILE_BYTES) throw new PlainlyError("TOO_LARGE");
    if (file.size === 0) throw new PlainlyError("EMPTY_TEXT");
    if (/\.txt$/i.test(file.name)) {
      const text = (await file.text()).trim();
      if (text.length < 40) throw new PlainlyError("EMPTY_TEXT");
      if (text.length > CFG.MAX_TEXT_CHARS) throw new PlainlyError("TEXT_TOO_LONG");
    }
  }

  function detailText(body) {
    if (!body || body.detail == null) return "";
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map(d => d.msg || JSON.stringify(d)).join(" ");
    return JSON.stringify(body.detail);
  }

  function checkShape(n) {
    const ok = n && typeof n.title === "string" && typeof n.summary === "string"
      && Array.isArray(n.deadlines) && Array.isArray(n.checklist)
      && Array.isArray(n.translated_checklist) && Array.isArray(n.uncertainties);
    if (!ok) throw new PlainlyError("SERVER", "The response didn't match the expected format.");
    return n;
  }

  async function post(file, language) {
    const form = new FormData();
    form.append("file", file);
    form.append("target_language", language);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CFG.REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(CFG.API_BASE + "/api/notices/analyze", { method: "POST", body: form, signal: ctrl.signal });
    } catch (e) {
      throw new PlainlyError(e.name === "AbortError" ? "TIMEOUT" : "NETWORK");
    } finally { clearTimeout(timer); }
    let body = null;
    try { body = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok) throw new PlainlyError(STATUS_CODES[res.status] || "SERVER", detailText(body), res.status);
    return checkShape(body);
  }

  /* ---------- mock ---------- */
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const clone = o => JSON.parse(JSON.stringify(o));
  // Dev helper: read.html?mockError=QUOTA previews an error screen.
  const forcedError = new URLSearchParams(location.search).get("mockError");
  const samples = () => window.PLAINLY_MOCK.samples;

  async function mockAnalyze(sampleKey, language) {
    await wait(1400);
    if (forcedError) throw new PlainlyError(forcedError, "Example detail from the server.");
    const s = samples()[sampleKey];
    const n = s.results[language];
    if (!n) throw new PlainlyError("MOCK_LANGUAGE");
    return clone(n);
  }
  async function guessSample(file) {
    let text = "";
    try { if (/\.txt$/i.test(file.name)) text = await file.text(); } catch (e) { /* ignore */ }
    if (/food|benefit|recertif/i.test(text)) return "benefits";
    if (/art night|permission slip/i.test(text)) return "artnight";
    return "school";
  }

  Plainly.PlainlyError = PlainlyError;
  Plainly.api = {
    isMock: CFG.USE_MOCK,
    textToFile,

    /** Analyze an uploaded (or pasted) file in the chosen language. */
    async analyze({ file, language }) {
      await validate(file);
      if (!CFG.USE_MOCK) return post(file, language);
      // Mock mode: show a sample result so the UI can be built without a backend.
      const key = await guessSample(file);
      const lang = samples()[key].results[language] ? language : "Spanish";
      const n = await mockAnalyze(key, lang);
      n._demo = true;
      n._lang = lang; // the language this mock is actually in
      return n;
    },

    /** Built-in sample. Uses the stored response when we have it; otherwise asks the real backend. */
    async sample(key, language) {
      const s = samples()[key];
      if (s.results[language] || CFG.USE_MOCK) return mockAnalyze(key, language);
      return post(textToFile(s.text), language);
    },

    sampleHas(key, language) { return !!samples()[key].results[language]; },
    sampleFile(key) { const s = samples()[key]; return new File([s.text], s.fileName, { type: "text/plain" }); }
  };
})();
