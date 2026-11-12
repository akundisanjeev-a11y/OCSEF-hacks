/* Saved letters ("My letters"), kept in this browser only. The backend stores nothing.
   Record: { id, savedAt, fileName, sample|null, primary: "Spanish", results: { [language]: Notice }, done: [checklistIndex] }
   The uploaded file itself is never saved (only kept in memory for this visit). */
(function () {
  const Plainly = (window.Plainly = window.Plainly || {});
  const KEY = "plainly.letters.v2";

  function readAll() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function writeAll(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  const uid = () => "L" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  Plainly.store = {
    list: readAll,
    get(id) { return readAll().find(r => r.id === id) || null; },
    add({ notice, language, fileName, sample }) {
      const rec = { id: uid(), savedAt: new Date().toISOString(), fileName: fileName || "", sample: sample || null, primary: language, results: { [language]: notice }, done: [] };
      const list = readAll(); list.unshift(rec); writeAll(list);
      return rec;
    },
    update(id, patch) {
      const list = readAll(); const i = list.findIndex(r => r.id === id);
      if (i < 0) return null;
      list[i] = { ...list[i], ...patch }; writeAll(list);
      return list[i];
    },
    remove(id) { writeAll(readAll().filter(r => r.id !== id)); },
    count() { return readAll().length; },
    base(rec) { return rec.results[rec.primary]; }
  };

  // Preferred translation language, remembered between visits.
  Plainly.prefs = {
    get language() { try { return localStorage.getItem("plainly.targetLang") || ""; } catch (e) { return ""; } },
    set language(v) { try { localStorage.setItem("plainly.targetLang", v); } catch (e) { /* ignore */ } }
  };
})();
