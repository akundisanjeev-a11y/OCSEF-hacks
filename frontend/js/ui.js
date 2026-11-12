/* Shared UI: header/footer, icons, dates, toast, calendar files. Loaded on every page. */
(function () {
  const Plainly = (window.Plainly = window.Plainly || {});
  const t = (k, v) => Plainly.i18n.t(k, v);

  const ICONS = {
    logo: '<svg viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="10" fill="#0F5A4A"/><path d="M10 11h14M10 17h14" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/><path d="M10 23h9" stroke="#FFC94A" stroke-width="4.2" stroke-linecap="round"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 6h14M5 11h14M5 16h9"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z"/></svg>',
    web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" stroke-linecap="round"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3h10v6M7 17H4v-8h16v8h-3M7 14h10v7H7z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3l10 18H2z" stroke-linejoin="round"/><path d="M12 10v5M12 18v.5"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
  };

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- Dates ---------- */
  function parseDate(iso) { if (!iso) return null; const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
  function today() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function daysUntil(iso) { const d = parseDate(iso); return d ? Math.round((d - today()) / 864e5) : null; }
  function locale(lang) { return { en: "en-US", es: "es-US", vi: "vi-VN", zh: "zh-CN", tl: "fil-PH", ar: "ar" }[lang || Plainly.i18n.lang] || "en-US"; }
  function fmtDate(iso, opts, lang) {
    const d = parseDate(iso); if (!d) return "";
    // Default format adds the year when it isn't this year (e.g. "Monday, May 3, 2027").
    const o = opts || Object.assign({ weekday: "long", month: "long", day: "numeric" }, d.getFullYear() !== today().getFullYear() ? { year: "numeric" } : {});
    return d.toLocaleDateString(locale(lang), o);
  }
  function calTile(iso, cls) {
    if (!iso) return `<div class="cal is-unknown ${cls || ""}" aria-hidden="true"><div class="m">${esc(t("date.noDate"))}</div><div class="d">?</div></div>`;
    return `<div class="cal ${cls || ""}" aria-hidden="true"><div class="m">${esc(fmtDate(iso, { month: "short" }))}</div><div class="d">${parseDate(iso).getDate()}</div></div>`;
  }
  function relative(iso) {
    const n = daysUntil(iso);
    if (n === null) return "";
    if (n < 0) return t("date.passed");
    if (n === 0) return t("date.today");
    if (n === 1) return t("date.tomorrow");
    return t("date.inDays", { n });
  }
  /* Deadlines: `date` is a calendar day (YYYY-MM-DD) or null. Never build it with new Date("YYYY-MM-DD"),
     which is UTC midnight and can show the previous day. parseDate() above uses local parts. */
  function datedDeadlines(notice) {
    return notice.deadlines.map((d, i) => ({ ...d, _i: i })).filter(d => d.date).sort((a, b) => a.date.localeCompare(b.date));
  }
  function nextDeadline(notice) {
    return datedDeadlines(notice).find(d => daysUntil(d.date) >= 0) || null;
  }

  /* ---------- Calendar (.ics), all-day entries ---------- */
  const icsEsc = s => String(s).replace(/\\/g, "\\\\").replace(/[,;]/g, "\\$&").replace(/\n/g, "\\n");
  function icsFor(deadlines, notice, recId) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Plainly//EN"];
    deadlines.filter(d => d.date).forEach(d => {
      const day = d.date.replace(/-/g, "");
      const next = parseDate(d.date); next.setDate(next.getDate() + 1);
      const end = next.getFullYear() + String(next.getMonth() + 1).padStart(2, "0") + String(next.getDate()).padStart(2, "0");
      lines.push("BEGIN:VEVENT", `UID:${recId}-${d._i}@plainly`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${end}`,
        `SUMMARY:${icsEsc(d.action)}`,
        `DESCRIPTION:${icsEsc(`The letter says: "${d.when}"\n${d.source_quote}${notice.sender ? "\nFrom: " + notice.sender : ""}`)}`,
        "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM", "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }
  function downloadIcs(deadlines, notice, recId, name) {
    const blob = new Blob([icsFor(deadlines, notice, recId)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = (name || "plainly-dates") + ".ics";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg) {
    let el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  /* ---------- Header / footer ---------- */
  function renderChrome(page) {
    const count = Plainly.store.count();
    const header = document.getElementById("site-header");
    if (header) header.innerHTML = `
      <a class="skip" href="#main">${esc(t("nav.skip"))}</a>
      <div class="container">
        <a class="brand" href="index.html">${ICONS.logo}<span>Plainly</span></a>
        <nav class="nav" aria-label="${esc(t("nav.label"))}">
          <a class="hide-sm" href="index.html#how" ${page === "home" ? "" : ""}>${esc(t("nav.how"))}</a>
          <a href="letters.html" ${page === "letters" ? 'aria-current="page"' : ""}>${esc(t("nav.letters"))}${count ? `<span class="count">${count}</span>` : ""}</a>
        </nav>
        <label class="ui-lang">${ICONS.globe}<span class="sr-only">${esc(t("nav.uiLang"))}</span>
          <select id="ui-lang-select">
            <option value="en" ${Plainly.i18n.lang === "en" ? "selected" : ""}>English</option>
            <option value="es" ${Plainly.i18n.lang === "es" ? "selected" : ""}>Español</option>
          </select>
        </label>
        ${page === "read" ? "" : `<a class="btn btn-primary btn-sm header-cta" href="read.html">${ICONS.upload}${esc(t("cta.upload"))}</a>`}
      </div>`;
    const sel = document.getElementById("ui-lang-select");
    if (sel) sel.onchange = e => Plainly.i18n.setLang(e.target.value);

    const footer = document.getElementById("site-footer");
    if (footer) footer.innerHTML = `
      <div class="container">
        <div class="footer-grid">
          <div><a class="brand" href="index.html">${ICONS.logo}<span>Plainly</span></a><p>${esc(t("footer.about"))}</p></div>
          <div><h3>${esc(t("footer.use"))}</h3><ul>
            <li><a href="read.html">${esc(t("cta.upload"))}</a></li>
            <li><a href="read.html?sample=school">${esc(t("footer.sampleSchool"))}</a></li>
            <li><a href="read.html?sample=benefits">${esc(t("footer.sampleBenefits"))}</a></li>
            <li><a href="read.html?sample=artnight">${esc(t("footer.sampleArt"))}</a></li>
            <li><a href="letters.html">${esc(t("nav.letters"))}</a></li></ul></div>
          <div><h3>${esc(t("footer.help"))}</h3><ul>
            <li><a href="index.html#how">${esc(t("nav.how"))}</a></li>
            <li><a href="index.html#questions">${esc(t("footer.faq"))}</a></li>
            <li><a href="index.html#privacy">${esc(t("footer.privacy"))}</a></li></ul></div>
        </div>
        <div class="footer-note"><span>${esc(t("footer.disclaimer"))}</span><span>© 2026 Plainly</span></div>
      </div>`;
  }

  function langInfo(name) {
    return window.PLAINLY_CONFIG.LANGUAGES.find(l => l.name.toLowerCase() === String(name).toLowerCase()) || { name, native: name, speech: "" };
  }

  Plainly.ui = { ICONS, esc, parseDate, daysUntil, fmtDate, calTile, relative, nextDeadline, datedDeadlines, downloadIcs, toast, renderChrome, locale, langInfo };
})();
