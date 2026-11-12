/* Reader flow: choose language + add letter -> analyzing -> What is this? -> When? -> What do I do? -> Your language -> done
   Data comes from Plainly.api (backend Notice shape, see api/frontend-handoff.md). */
(function () {
  const P = window.Plainly, CFG = window.PLAINLY_CONFIG;
  const { ICONS, esc } = P.ui;
  const t = (k, v) => P.i18n.t(k, v);
  const app = document.getElementById("app");
  const STEPS = ["what", "when", "do", "lang"];
  const EN = "English";
  const files = {};           // record id -> File, kept in memory only

  const state = {
    view: "start", step: 0,
    language: P.prefs.language || "",   // target_language chosen before upload
    otherOpen: false, pasteOpen: false,
    pending: null,                      // input waiting for a language choice
    langError: false,
    error: null, lastInput: null,
    record: null, preview: null,
    viewLang: null,                     // language shown on steps 1-3
    trLang: null,                       // language shown on step 4
    translating: {},                    // language -> "loading" | PlainlyError
    startedAt: 0
  };

  /* ---------- data helpers ---------- */
  const R = () => state.record;
  const base = () => P.store.base(R());
  const cached = () => [...new Set([EN, R().primary, ...Object.keys(R().results)])];
  const isEn = lang => !lang || lang === EN;
  function summary(lang) { return isEn(lang) ? base().summary : R().results[lang].translated_summary; }
  function checklist(lang) {
    if (isEn(lang)) return base().checklist;
    const tr = R().results[lang].translated_checklist;
    return tr.length === base().checklist.length ? tr : base().checklist; // item-for-item match keeps checkboxes
  }
  function instructions(lang) { return isEn(lang) ? base().checklist.join("\n") : R().results[lang].translated_instructions; }
  function save(patch) { state.record = P.store.update(R().id, patch) || R(); }
  function fileFor(rec) { return files[rec.id] || (rec.sample ? P.api.sampleFile(rec.sample) : null); }
  const dirAttr = lang => (P.ui.langInfo(lang).rtl ? 'dir="rtl"' : 'dir="auto"');

  /* ---------- start ---------- */
  function langPicker() {
    const known = CFG.LANGUAGES.some(l => l.name === state.language);
    const chips = CFG.LANGUAGES.map(l => `<button class="lang-chip" data-pick="${esc(l.name)}" aria-pressed="${state.language === l.name}">
        <span class="lang-native" lang="${l.speech.slice(0, 2)}">${esc(l.native)}</span>${l.native !== l.name ? `<span class="lang-en">${esc(l.name === EN ? t("start.noTranslation") : l.name)}</span>` : `<span class="lang-en">${esc(l.name === EN ? t("start.noTranslation") : "")}</span>`}</button>`).join("");
    const other = state.otherOpen || (state.language && !known);
    return `
      <section class="start-section ${state.langError ? "has-error" : ""}" id="lang-section" aria-labelledby="lang-h">
        <h2 id="lang-h" class="start-h"><span class="start-n">1</span>${esc(t("start.langTitle"))}</h2>
        <p class="start-sub">${esc(t("start.langSub"))}</p>
        ${state.langError ? `<p class="field-error" role="alert">${ICONS.alert}<span>${esc(t("start.langRequired"))}</span></p>` : ""}
        <div class="lang-chips" role="group" aria-labelledby="lang-h">${chips}
          <button class="lang-chip" id="other-toggle" aria-pressed="${other}"><span class="lang-native">${esc(t("start.other"))}</span><span class="lang-en">${esc(t("start.otherSub"))}</span></button>
        </div>
        <div class="other-row" ${other ? "" : "hidden"}>
          <label for="other-lang">${esc(t("start.otherLabel"))}</label>
          <div><input id="other-lang" maxlength="64" value="${known ? "" : esc(state.language)}" placeholder="${esc(t("start.otherPlaceholder"))}"><button class="btn btn-secondary" id="other-go">${esc(t("start.otherUse"))}</button></div>
        </div>
      </section>`;
  }

  function viewStart() {
    return `
    <section class="start">
      <div class="container start-grid">
        <div class="start-main">
          <h1 class="display start-title">${esc(t("start.title"))}</h1>
          <p class="lede">${esc(t("start.lede"))}</p>
          ${langPicker()}
          <section class="start-section" aria-labelledby="file-h">
            <h2 id="file-h" class="start-h"><span class="start-n">2</span>${esc(t("start.fileTitle"))}</h2>
            <label class="drop" id="drop">
              <input type="file" id="file-input" accept="${CFG.ACCEPT}" class="sr-only">
              <span class="drop-icon">${ICONS.upload}</span>
              <strong>${esc(t("start.drop"))}</strong>
              <span>${esc(t("start.dropHint"))}</span>
            </label>
            <div class="alt-row">
              <label class="btn btn-secondary"><input type="file" id="camera-input" accept="image/jpeg,image/png" capture="environment" class="sr-only">${ICONS.camera}${esc(t("start.camera"))}</label>
              <button class="btn btn-secondary" id="paste-toggle" aria-expanded="${state.pasteOpen}">${ICONS.text}${esc(t("start.paste"))}</button>
            </div>
            <div class="paste" ${state.pasteOpen ? "" : "hidden"}>
              <label for="paste-text" class="paste-label">${esc(t("start.pasteLabel"))}</label>
              <textarea id="paste-text" rows="7" maxlength="${CFG.MAX_TEXT_CHARS}" placeholder="${esc(t("start.pastePlaceholder"))}"></textarea>
              <button class="btn btn-primary" id="paste-go">${esc(t("start.pasteGo"))}</button>
            </div>
            <div class="samples">
              <span>${esc(t("start.samples"))}</span>
              <button class="sample" data-sample="school">${ICONS.doc}${esc(t("sample.school"))}</button>
              <button class="sample" data-sample="benefits">${ICONS.doc}${esc(t("sample.benefits"))}</button>
              <button class="sample" data-sample="artnight">${ICONS.doc}${esc(t("sample.artnight"))}</button>
            </div>
          </section>
        </div>
        <aside class="tips" aria-labelledby="tips-h">
          <h2 id="tips-h">${esc(t("tips.title"))}</h2>
          <ul>
            <li><span class="tip-art tip-flat" aria-hidden="true"></span><div><b>${esc(t("tips.1.t"))}</b>${esc(t("tips.1.b"))}</div></li>
            <li><span class="tip-art tip-light" aria-hidden="true"></span><div><b>${esc(t("tips.2.t"))}</b>${esc(t("tips.2.b"))}</div></li>
            <li><span class="tip-art tip-pages" aria-hidden="true"></span><div><b>${esc(t("tips.3.t"))}</b>${esc(t("tips.3.b"))}</div></li>
          </ul>
          <p class="privacy-line">${ICONS.lock}<span>${esc(t("tips.privacy"))}</span></p>
        </aside>
      </div>
    </section>`;
  }

  /* ---------- analyzing (one request, so a spinner, not fake progress) ---------- */
  function viewReading() {
    const secs = Math.round((Date.now() - state.startedAt) / 1000);
    return `
    <section class="reading container" aria-busy="true">
      <div class="scan-paper ${state.preview ? "has-preview" : ""}" aria-hidden="true" ${state.preview ? `style="background-image:url('${state.preview}')"` : ""}>
        ${state.preview ? "" : '<i></i><i></i><i></i><i class="short"></i><i></i><i></i><i class="short"></i>'}
        <span class="scan-bar"></span>
      </div>
      <div class="reading-copy">
        <div class="spinner" aria-hidden="true"></div>
        <h1 class="display reading-title" tabindex="-1">${esc(t("read.title"))}</h1>
        <p class="lede">${esc(t("read.lede", { lang: state.lastInput ? P.ui.langInfo(state.lastInput.language).native : "" }))}</p>
        <p class="reading-meta" aria-live="polite">${secs >= 8 ? esc(t("read.slow")) : ""}</p>
      </div>
    </section>`;
  }

  /* ---------- error ---------- */
  const RETRYABLE = ["NETWORK", "TIMEOUT", "SERVICE", "SERVER", "QUOTA"];
  function viewError() {
    const e = state.error;
    const key = t("err." + e.code + ".title") === "err." + e.code + ".title" ? "SERVER" : e.code;
    const retry = state.lastInput && RETRYABLE.includes(key);
    return `
    <section class="error-view container">
      <div class="error-icon">${ICONS.alert}</div>
      <h1 class="display" tabindex="-1">${esc(t("err." + key + ".title"))}</h1>
      <p class="lede">${esc(t("err." + key + ".body"))}</p>
      ${e.detail ? `<p class="error-detail"><b>${esc(t("err.serverSaid"))}</b> <span lang="en">${esc(e.detail)}</span></p>` : ""}
      <div class="error-actions">
        ${retry ? `<button class="btn btn-primary btn-lg" id="retry">${esc(t("err.retry"))}</button>` : ""}
        <button class="btn ${retry ? "btn-secondary" : "btn-primary"} btn-lg" id="restart">${esc(t("err.another"))}</button>
        <button class="btn btn-ghost" data-sample="school">${esc(t("err.sample"))}</button>
      </div>
      <p class="error-code">${esc(t("err.code"))} ${esc(e.code)}${e.status ? " (HTTP " + e.status + ")" : ""}</p>
    </section>`;
  }

  /* ---------- steps ---------- */
  function stepBar() {
    return `<nav class="steps" aria-label="${esc(t("steps.label"))}"><ol class="container">` + STEPS.map((s, i) => {
      const cls = i === state.step ? "is-current" : i < state.step ? "is-past" : "";
      return `<li><button class="step-btn ${cls}" data-go="${i}" ${i === state.step ? 'aria-current="step"' : ""}>
        <span class="step-num">${i < state.step ? ICONS.check : i + 1}</span><span class="step-name">${esc(t("step." + s))}</span></button></li>`;
    }).join("") + "</ol></nav>";
  }

  function viewToggle() {
    const langs = cached();
    if (langs.length < 2) return "";
    return `<div class="view-toggle" role="group" aria-label="${esc(t("toggle.label"))}"><span>${esc(t("toggle.label"))}</span>` +
      langs.map(l => `<button data-view-lang="${esc(l)}" aria-pressed="${state.viewLang === l}">${esc(P.ui.langInfo(l).native)}</button>`).join("") + "</div>";
  }

  function stepWhat() {
    const n = base(), lang = state.viewLang;
    const dCount = n.deadlines.length, cCount = n.checklist.length;
    // No translated title from the backend: use the translated summary's first sentence as the headline.
    let head;
    if (isEn(lang)) head = `<h1 class="answer display" tabindex="-1">${esc(n.title)}</h1><p class="summary-text">${esc(n.summary)}</p>`;
    else {
      const s = summary(lang), m = s.match(/^(.{12,160}?(?:[.!?؟](?=\s)|。))\s*([\s\S]+)$/); // "7.º" isn't a sentence end
      head = `<h1 class="answer ${m ? "" : "answer-long"} display" tabindex="-1" ${dirAttr(lang)}>${esc(m ? m[1] : s)}</h1>
        ${m ? `<p class="summary-text" ${dirAttr(lang)}>${esc(m[2])}</p>` : ""}
        <p class="in-english"><span>${esc(t("what.inEnglish"))}</span> <span lang="en">${esc(n.title)}</span></p>`;
    }
    return `
      <p class="q-label">${esc(t("step.what"))}</p>
      ${head}
      ${n._demo ? `<p class="demo-note">${ICONS.info}<span>${esc(t("what.demo"))}</span></p>` : ""}
      <div class="meta-row">
        ${n.sender ? `<span class="meta">${ICONS.doc}<span><small>${esc(t("what.from"))}</small>${esc(n.sender)}</span></span>` : ""}
        <span class="meta-counts">
          <span class="pill ${dCount ? "pill-soon" : "pill-muted"}">${ICONS.calendar}${esc(t(dCount === 1 ? "what.deadlinesOne" : "what.deadlines", { n: dCount }))}</span>
          <span class="pill">${ICONS.check}${esc(t(cCount === 1 ? "what.tasksOne" : "what.tasks", { n: cCount }))}</span>
        </span>
      </div>
      ${n.uncertainties.length ? `
        <section class="unsure-box" aria-labelledby="unsure-h">
          <h2 id="unsure-h">${ICONS.alert}<span>${esc(t("what.unsure"))}</span></h2>
          <ul lang="en">${n.uncertainties.map(u => `<li>${esc(u)}</li>`).join("")}</ul>
          ${!isEn(lang) ? `<p class="small-note">${esc(t("what.unsureEnglish"))}</p>` : ""}
        </section>` : ""}
      ${fileFor(R()) ? `<button class="btn btn-secondary" data-open-original>${ICONS.doc}${esc(t("what.original"))}</button>` : ""}`;
  }

  function deadlineRow(d) {
    const n = d.date ? P.ui.daysUntil(d.date) : null;
    const pill = d.date
      ? (n < 0 ? `<span class="pill pill-muted">${esc(t("date.passed"))}</span>` : `<span class="pill ${n <= 7 ? "pill-urgent" : n <= 21 ? "pill-soon" : ""}">${esc(P.ui.relative(d.date))}</span>`)
      : `<span class="pill pill-muted">${esc(t("when.noExact"))}</span>`;
    return `<li class="date-row">
      ${P.ui.calTile(d.date, d.date && n >= 0 && n <= 7 ? "is-urgent" : "")}
      <div class="date-body">
        <div class="date-top"><h3 lang="en">${esc(d.action)}</h3>${pill}</div>
        <p class="date-when"><span>${esc(t("when.says"))}</span> <b lang="en">${esc(d.when)}</b>${d.date ? `<span class="date-full">${esc(P.ui.fmtDate(d.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</span>` : ""}</p>
        <blockquote class="quote official" lang="en">“${esc(d.source_quote)}”</blockquote>
        ${d.date && n >= 0 ? `<div class="date-actions"><button class="btn btn-ghost btn-sm" data-ics="${d._i}">${ICONS.calendar}${esc(t("when.addOne"))}</button></div>` : ""}
      </div></li>`;
  }

  function stepWhen() {
    const n = base();
    const dated = P.ui.datedDeadlines(n);
    const undated = n.deadlines.map((d, i) => ({ ...d, _i: i })).filter(d => !d.date);
    const next = P.ui.nextDeadline(n);
    let head;
    if (next) head = `<h1 class="answer display" tabindex="-1">${esc(t("when.next", { date: P.ui.fmtDate(next.date) }))}</h1>
        <p class="summary-text"><span lang="en">${esc(next.action)}</span>. ${esc(P.ui.relative(next.date))}.</p>`;
    else if (dated.length) head = `<h1 class="answer display" tabindex="-1">${esc(t("when.allPassed"))}</h1>`;
    else if (undated.length) head = `<h1 class="answer display" tabindex="-1">${esc(t("when.noDates"))}</h1><p class="summary-text">${esc(t("when.noDatesSub"))}</p>`;
    else head = `<h1 class="answer display" tabindex="-1">${esc(t("when.none"))}</h1><p class="summary-text">${esc(t("when.noneSub"))}</p>`;
    const upcomingCount = dated.filter(d => P.ui.daysUntil(d.date) >= 0).length;
    return `
      <p class="q-label">${esc(t("step.when"))}</p>
      ${head}
      ${!isEn(state.viewLang) && n.deadlines.length ? `<p class="lang-note">${ICONS.globe}<span>${esc(t("when.englishNote"))}</span></p>` : ""}
      ${dated.length ? `<ul class="dates">${dated.map(deadlineRow).join("")}</ul>` : ""}
      ${undated.length ? `<h2 class="block-h group-h">${esc(t("when.other"))}</h2><ul class="dates">${undated.map(deadlineRow).join("")}</ul>` : ""}
      ${upcomingCount > 1 ? `<button class="btn btn-primary" data-ics="all">${ICONS.calendar}${esc(t("when.addAll", { n: upcomingCount }))}</button>` : ""}`;
  }

  function stepDo() {
    const lang = state.viewLang, items = checklist(lang), en = base().checklist, done = R().done || [];
    const k = done.filter(i => i < items.length).length, n = items.length;
    const translated = !isEn(lang) && items !== en;
    if (!n) return `<p class="q-label">${esc(t("step.do"))}</p><h1 class="answer display" tabindex="-1">${esc(t("do.none"))}</h1><p class="summary-text">${esc(t("do.noneSub"))}</p>`;
    return `
      <p class="q-label">${esc(t("step.do"))}</p>
      <h1 class="answer display" tabindex="-1">${esc(t(n === 1 ? "do.answerOne" : "do.answer", { n }))}</h1>
      <div class="progress-row"><div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${k}" aria-label="${esc(t("do.progress", { k, n }))}"><span style="width:${(k / n) * 100}%"></span></div>
        <span>${esc(k === n ? t("do.allDone") : t("do.progress", { k, n }))}</span></div>
      <ol class="tasks">${items.map((text, i) => {
        const isDone = done.includes(i);
        return `<li class="task ${isDone ? "is-done" : ""}">
          <label class="task-label">
            <input type="checkbox" data-task="${i}" ${isDone ? "checked" : ""}>
            <span class="task-box" aria-hidden="true">${ICONS.check}</span>
            <span class="task-text"><span class="task-title" ${translated ? dirAttr(lang) : 'lang="en"'}>${esc(text)}</span>
            ${translated ? `<span class="task-details" lang="en">${esc(en[i])}</span>` : ""}</span>
          </label></li>`;
      }).join("")}</ol>`;
  }

  function stepLang() {
    const rec = R(), cur = state.trLang, have = cached();
    const tabs = have.map(l => `<button class="lang-tab" data-tr="${esc(l)}" aria-pressed="${cur === l}">${esc(P.ui.langInfo(l).native)}${P.ui.langInfo(l).native !== l ? `<small>${esc(l)}</small>` : ""}</button>`).join("");
    const options = CFG.LANGUAGES.filter(l => !have.includes(l.name)).map(l => `<option value="${esc(l.name)}">${esc(l.native)}${l.native !== l.name ? " (" + esc(l.name) + ")" : ""}</option>`).join("");
    const canTranslate = !!fileFor(rec);
    const loading = Object.keys(state.translating).find(l => state.translating[l] === "loading");
    const failed = Object.keys(state.translating).find(l => state.translating[l] && state.translating[l] !== "loading");
    let panel;
    if (loading && cur === loading) panel = `<div class="tr-skeleton" aria-label="${esc(t("lang.loading"))}"><i></i><i></i><i class="short"></i><i></i><i class="short"></i></div>`;
    else panel = `
      <div class="tr-toolbar no-print">
        <button class="btn btn-secondary btn-sm" id="listen">${ICONS.speaker}<span>${esc(t("lang.listen"))}</span></button>
        <button class="btn btn-secondary btn-sm" id="copy-tr">${ICONS.copy}${esc(t("lang.copy"))}</button>
        <button class="btn btn-secondary btn-sm" onclick="window.print()">${ICONS.print}${esc(t("lang.print"))}</button>
      </div>
      <article class="tr-doc" id="tr-doc" ${dirAttr(cur)}>
        <p class="tr-summary">${esc(summary(cur))}</p>
        <div class="tr-instructions">${esc(instructions(cur))}</div>
      </article>
      ${isEn(cur) ? "" : `<p class="tr-note">${esc(t("lang.note"))}</p>`}`;
    return `
      <p class="q-label">${esc(t("step.lang"))}</p>
      <h1 class="answer display" tabindex="-1">${esc(t("lang.answer"))}</h1>
      <div class="lang-tabs" role="group" aria-label="${esc(t("lang.label"))}">${tabs}</div>
      <div class="tr-panel" aria-live="polite">${panel}</div>
      <section class="translate-more no-print" aria-labelledby="more-h">
        <h2 id="more-h" class="block-h">${esc(t("lang.moreTitle"))}</h2>
        ${canTranslate ? `
          <p class="small-note">${esc(t("lang.moreSub"))}</p>
          <div class="translate-row">
            <label class="sr-only" for="more-lang">${esc(t("lang.label"))}</label>
            <select id="more-lang"><option value="">${esc(t("lang.choose"))}</option>${options}<option value="__other">${esc(t("start.other"))}</option></select>
            <input id="more-other" maxlength="64" placeholder="${esc(t("start.otherPlaceholder"))}" hidden>
            <button class="btn btn-primary" id="translate-go" ${loading ? "disabled" : ""}>${ICONS.globe}${esc(loading ? t("lang.translating") : t("lang.translate"))}</button>
          </div>
          ${failed ? `<p class="field-error" role="alert">${ICONS.alert}<span>${esc(t("lang.failed", { lang: P.ui.langInfo(failed).native }))} ${esc(errorLine(state.translating[failed]))}</span></p>` : ""}`
        : `<p class="small-note">${esc(t("lang.needFile"))}</p>`}
      </section>`;
  }
  function errorLine(e) { return e.detail || t("err." + e.code + ".body"); }

  function glance() {
    const rec = R(), n = base(), next = P.ui.nextDeadline(n), done = rec.done || [];
    const total = n.checklist.length, k = done.filter(i => i < total).length;
    return `
      <aside class="glance" aria-label="${esc(t("glance.label"))}">
        <h2 class="glance-h">${esc(t("glance.title"))}</h2>
        ${next ? `<div class="glance-next">${P.ui.calTile(next.date, P.ui.daysUntil(next.date) <= 7 ? "is-urgent" : "")}<div><small>${esc(t("glance.next"))}</small><b lang="en">${esc(next.action)}</b><span>${esc(P.ui.relative(next.date))}</span></div></div>`
          : `<div class="glance-next"><div><small>${esc(t("glance.next"))}</small><b>${esc(t("glance.noDate"))}</b></div></div>`}
        <div class="glance-progress"><small>${esc(t("glance.checklist"))}</small>
          <div class="meter"><span style="width:${total ? (k / total) * 100 : 0}%"></span></div>
          <span>${esc(t("do.progress", { k, n: total }))}</span></div>
        <div class="glance-from"><small>${esc(t("glance.language"))}</small>${esc(P.ui.langInfo(rec.primary).native)}</div>
        ${n.sender ? `<div class="glance-from"><small>${esc(t("what.from"))}</small>${esc(n.sender)}</div>` : ""}
        <div class="glance-actions">
          ${fileFor(rec) ? `<button class="btn btn-secondary btn-sm" data-open-original>${ICONS.doc}${esc(t("what.original"))}</button>` : ""}
          <a class="btn btn-ghost btn-sm" href="read.html">${ICONS.upload}${esc(t("glance.another"))}</a>
        </div>
        <p class="glance-saved">${ICONS.check}<span>${esc(t("glance.saved"))}</span></p>
      </aside>`;
  }

  function viewStep() {
    const body = [stepWhat, stepWhen, stepDo, stepLang][state.step]();
    const isLast = state.step === STEPS.length - 1;
    return `
      <div class="flow">
        ${stepBar()}
        <div class="container flow-grid">
          <section class="flow-main step-${STEPS[state.step]}">${state.step < 3 ? viewToggle() : ""}${body}</section>
          ${glance()}
        </div>
        <div class="flow-nav">
          <div class="container flow-nav-inner">
            <button class="btn btn-secondary btn-lg" id="back" ${state.step === 0 ? "hidden" : ""}>${esc(t("nav.back"))}</button>
            <span class="flow-count">${esc(t("steps.count", { i: state.step + 1, n: STEPS.length }))}</span>
            <button class="btn btn-primary btn-lg" id="next">${esc(isLast ? t("nav.finish") : t("nav.next", { name: t("step." + STEPS[state.step + 1]) }))}</button>
          </div>
        </div>
      </div>`;
  }

  function viewDone() {
    const n = base(), next = P.ui.nextDeadline(n);
    return `
      <section class="done container">
        <div class="done-mark">${ICONS.check}</div>
        <h1 class="display" tabindex="-1">${esc(t("done.title"))}</h1>
        <p class="lede">${esc(t("done.lede"))}</p>
        ${next ? `<div class="done-next">${P.ui.calTile(next.date)}<div><small>${esc(t("done.remember"))}</small><b lang="en">${esc(next.action)}</b><span>${esc(P.ui.fmtDate(next.date))}, ${esc(P.ui.relative(next.date).toLowerCase())}</span></div>
          <button class="btn btn-secondary btn-sm" data-ics="all">${ICONS.calendar}${esc(t("done.addCal"))}</button></div>` : ""}
        <div class="done-actions">
          <a class="btn btn-primary btn-lg" href="letters.html">${esc(t("done.letters"))}</a>
          <a class="btn btn-secondary btn-lg" href="read.html">${esc(t("done.another"))}</a>
          <button class="btn btn-ghost" data-go="0">${esc(t("done.review"))}</button>
        </div>
      </section>`;
  }

  /* ---------- original file ---------- */
  let originalUrl = null;
  async function openOriginal() {
    const file = fileFor(R()), dlg = document.getElementById("original");
    if (!file) return;
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = URL.createObjectURL(file);
    let body;
    if (/\.txt$/i.test(file.name)) body = `<pre class="original-text official">${esc(await file.text())}</pre>`;
    else if (/\.pdf$/i.test(file.name)) body = `<iframe class="original-pdf" src="${originalUrl}" title="${esc(file.name)}"></iframe>`;
    else body = `<img class="original-img" src="${originalUrl}" alt="${esc(t("original.alt"))}">`;
    dlg.innerHTML = `
      <div class="sheet-head"><h2>${esc(t("original.title"))}</h2><button class="icon-btn" id="close-original" aria-label="${esc(t("original.close"))}">${ICONS.close}</button></div>
      <div class="sheet-body"><p class="small-note">${esc(file.name)}</p>${body}</div>`;
    dlg.showModal();
    document.getElementById("close-original").onclick = () => dlg.close();
  }
  document.getElementById("original").addEventListener("click", e => { if (e.target.id === "original") e.target.close(); });

  /* ---------- render ---------- */
  function render(focus) {
    const views = { start: viewStart, reading: viewReading, error: viewError, step: viewStep, done: viewDone };
    app.innerHTML = views[state.view]();
    document.body.dataset.view = state.view;
    document.title = state.view === "step" ? `${t("step." + STEPS[state.step])} · Plainly` : "Plainly";
    if (focus) { const h = app.querySelector("h1[tabindex]"); if (h) h.focus({ preventScroll: true }); window.scrollTo(0, 0); }
    if (state.view === "start") bindStart();
  }

  function go(step) {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    state.view = "step"; state.step = step;
    syncUrl(); render(true);
  }
  function syncUrl() {
    const q = new URLSearchParams();
    if (state.record && state.view !== "start") q.set("id", state.record.id);
    if (state.view === "step") q.set("step", state.step + 1);
    history.replaceState(null, "", "read.html" + (q.toString() ? "?" + q : ""));
  }

  function openRecord(rec, step) {
    state.record = rec;
    state.viewLang = rec.primary;
    state.trLang = rec.primary;
    state.translating = {};
    go(step || 0);
  }

  /* input: { file } or { sample }  (language is added here) */
  let tick;
  async function run(input) {
    if (!state.language) {
      state.pending = input; state.langError = true;
      if (state.view !== "start") state.view = "start";
      render(); document.getElementById("lang-section").scrollIntoView({ block: "center" });
      const first = app.querySelector("[data-pick]"); if (first) first.focus();
      return;
    }
    let language = state.language;
    if (input.sample && P.api.isMock && !P.api.sampleHas(input.sample, language)) {
      P.ui.toast(t("toast.sampleLang", { lang: language })); language = "Spanish";
    }
    input = { ...input, language };
    state.lastInput = input; state.pending = null; state.langError = false;
    if (state.preview) { URL.revokeObjectURL(state.preview); state.preview = null; }
    if (input.file && /\.(png|jpe?g)$/i.test(input.file.name)) state.preview = URL.createObjectURL(input.file);
    state.startedAt = Date.now(); state.view = "reading"; render(true);
    clearInterval(tick); tick = setInterval(() => { if (state.view === "reading") { const m = app.querySelector(".reading-meta"); const s = (Date.now() - state.startedAt) / 1000; if (m && s >= 8 && !m.textContent) m.textContent = t("read.slow"); } }, 1000);
    try {
      const notice = input.sample ? await P.api.sample(input.sample, language) : await P.api.analyze({ file: input.file, language });
      if (notice._lang && notice._lang !== language) { P.ui.toast(t("toast.sampleLang", { lang: language })); language = notice._lang; }
      const rec = P.store.add({ notice, language, fileName: input.file ? input.file.name : P.api.sampleFile(input.sample).name, sample: input.sample });
      if (input.file) files[rec.id] = input.file;
      P.ui.renderChrome("read");
      openRecord(rec, 0);
    } catch (e) {
      state.error = e instanceof P.PlainlyError ? e : new P.PlainlyError("SERVER", String(e && e.message || ""));
      state.view = "error"; render(true);
    } finally { clearInterval(tick); }
  }

  async function translateTo(language) {
    language = (language || "").trim();
    if (!language) return;
    const rec = R();
    const existing = Object.keys(rec.results).find(l => l.toLowerCase() === language.toLowerCase());
    if (existing || language.toLowerCase() === "english") { state.trLang = existing || EN; return render(); }
    state.translating = { [language]: "loading" }; state.trLang = language; render();
    try {
      const notice = rec.sample ? await P.api.sample(rec.sample, language) : await P.api.analyze({ file: fileFor(rec), language });
      const results = { ...R().results, [language]: notice };
      save({ results });
      state.translating = {};
      if (notice.translated_checklist.length !== base().checklist.length) P.ui.toast(t("toast.listMismatch"));
    } catch (e) {
      state.translating = { [language]: e instanceof P.PlainlyError ? e : new P.PlainlyError("SERVER") };
      state.trLang = R().primary;
    }
    if (state.view === "step" && state.step === 3) render();
  }

  function setLanguage(name) {
    state.language = name; P.prefs.language = name; state.langError = false;
    if (state.pending) return run(state.pending);
    render();
  }

  function bindStart() {
    const drop = document.getElementById("drop");
    const pick = f => f && run({ file: f });
    document.getElementById("file-input").onchange = e => pick(e.target.files[0]);
    document.getElementById("camera-input").onchange = e => pick(e.target.files[0]);
    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("is-over"); }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("is-over"); }));
    drop.addEventListener("drop", e => pick(e.dataTransfer.files[0]));
    const other = document.getElementById("other-lang");
    if (other) other.addEventListener("keydown", e => { if (e.key === "Enter" && other.value.trim()) setLanguage(other.value.trim()); });
  }

  /* ---------- events ---------- */
  app.addEventListener("click", e => {
    const el = e.target.closest("button, [data-go]");
    if (!el) return;
    if (el.dataset.pick) return setLanguage(el.dataset.pick);
    if (el.id === "other-toggle") { state.otherOpen = true; render(); document.getElementById("other-lang").focus(); return; }
    if (el.id === "other-go") { const v = document.getElementById("other-lang").value.trim(); if (v) setLanguage(v); return; }
    if (el.dataset.sample) return run({ sample: el.dataset.sample });
    if (el.id === "paste-toggle") { state.pasteOpen = !state.pasteOpen; render(); if (state.pasteOpen) document.getElementById("paste-text").focus(); return; }
    if (el.id === "paste-go") return run({ file: P.api.textToFile(document.getElementById("paste-text").value) });
    if (el.id === "retry") return run(state.lastInput);
    if (el.id === "restart") { state.view = "start"; state.record = null; syncUrl(); return render(true); }
    if (el.dataset.go !== undefined && state.record) return go(+el.dataset.go);
    if (el.id === "next") { if (state.step === STEPS.length - 1) { state.view = "done"; syncUrl(); return render(true); } return go(state.step + 1); }
    if (el.id === "back") return go(state.step - 1);
    if (el.dataset.viewLang) { state.viewLang = el.dataset.viewLang; return render(); }
    if (el.hasAttribute("data-open-original")) return openOriginal();
    if (el.dataset.ics) {
      const n = base(), all = P.ui.datedDeadlines(n).filter(d => P.ui.daysUntil(d.date) >= 0);
      const list = el.dataset.ics === "all" ? all : all.filter(d => d._i === +el.dataset.ics);
      P.ui.downloadIcs(list, n, R().id, "plainly-deadlines");
      return P.ui.toast(t("toast.calendar"));
    }
    if (el.dataset.tr) { if (window.speechSynthesis) speechSynthesis.cancel(); state.trLang = el.dataset.tr; return render(); }
    if (el.id === "translate-go") {
      const sel = document.getElementById("more-lang").value;
      return translateTo(sel === "__other" ? document.getElementById("more-other").value : sel);
    }
    if (el.id === "listen") {
      if (!("speechSynthesis" in window)) return P.ui.toast(t("toast.noSpeech"));
      if (speechSynthesis.speaking) { speechSynthesis.cancel(); el.querySelector("span").textContent = t("lang.listen"); return; }
      const u = new SpeechSynthesisUtterance(document.getElementById("tr-doc").innerText);
      const code = P.ui.langInfo(state.trLang).speech; if (code) u.lang = code;
      u.rate = 0.92;
      u.onend = () => { const b = document.getElementById("listen"); if (b) b.querySelector("span").textContent = t("lang.listen"); };
      speechSynthesis.speak(u); el.querySelector("span").textContent = t("lang.stop");
      return;
    }
    if (el.id === "copy-tr") {
      const text = document.getElementById("tr-doc").innerText;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => P.ui.toast(t("toast.copied")), () => P.ui.toast(t("toast.copyFail")));
    }
  });
  app.addEventListener("change", e => {
    if (e.target.id === "more-lang") { const o = document.getElementById("more-other"); o.hidden = e.target.value !== "__other"; if (!o.hidden) o.focus(); return; }
    if (e.target.dataset.task === undefined) return;
    const i = +e.target.dataset.task, done = new Set(R().done || []);
    e.target.checked ? done.add(i) : done.delete(i);
    save({ done: [...done] });
    render();
    const box = app.querySelector(`[data-task="${i}"]`); if (box) box.focus();
    if (e.target.checked && base().checklist.every((_, j) => done.has(j))) P.ui.toast(t("toast.allDone"));
  });
  document.addEventListener("keydown", e => {
    if (state.view !== "step" || e.target.matches("input, textarea, select") || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight" && state.step < 3) go(state.step + 1);
    if (e.key === "ArrowLeft" && state.step > 0) go(state.step - 1);
  });
  window.addEventListener("plainly:lang", () => { P.ui.renderChrome("read"); render(); });

  /* ---------- boot ---------- */
  P.ui.renderChrome("read");
  const q = new URLSearchParams(location.search);
  const rec = q.get("id") && P.store.get(q.get("id"));
  if (rec) openRecord(rec, Math.min(Math.max((+q.get("step") || 1) - 1, 0), 3));
  else if (q.get("sample") && window.PLAINLY_MOCK.samples[q.get("sample")]) {
    if (!state.language) state.language = "Spanish"; // footer/landing sample links skip the picker
    run({ sample: q.get("sample") });
  } else render();
})();
