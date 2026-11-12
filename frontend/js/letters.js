/* My letters: everything saved in this browser, sorted by what's due next. */
(function () {
  const P = window.Plainly;
  const { ICONS, esc } = P.ui;
  const t = (k, v) => P.i18n.t(k, v);
  const app = document.getElementById("app");
  let filter = "active", confirming = null;

  const base = rec => P.store.base(rec);
  const title = rec => base(rec).title;
  const sender = rec => base(rec).sender || "";

  function status(rec) {
    const n = base(rec).checklist.length, k = (rec.done || []).filter(i => i < n).length;
    return { n, k, next: P.ui.nextDeadline(base(rec)), finished: n > 0 && k === n };
  }

  function upcoming(list) {
    const rows = [];
    list.forEach(rec => {
      if (status(rec).finished) return;
      P.ui.datedDeadlines(base(rec)).forEach(d => { if (P.ui.daysUntil(d.date) >= 0) rows.push({ rec, d }); });
    });
    rows.sort((x, y) => x.d.date.localeCompare(y.d.date));
    return rows.slice(0, 5);
  }

  function card(rec) {
    const s = status(rec);
    const pct = s.n ? (s.k / s.n) * 100 : 0;
    const left = s.next ? P.ui.daysUntil(s.next.date) : null;
    const pill = s.finished ? `<span class="pill pill-done">${ICONS.check}${esc(t("letters.allDone"))}</span>`
      : s.next ? `<span class="pill ${left <= 7 ? "pill-urgent" : left <= 21 ? "pill-soon" : ""}">${esc(P.ui.relative(s.next.date))}</span>`
      : `<span class="pill pill-muted">${esc(t("letters.noDates"))}</span>`;
    const del = confirming === rec.id
      ? `<div class="confirm" role="group"><span>${esc(t("letters.confirm"))}</span>
          <button class="btn btn-sm btn-danger" data-del-yes="${rec.id}">${esc(t("letters.confirmYes"))}</button>
          <button class="btn btn-sm btn-secondary" data-del-no>${esc(t("letters.cancel"))}</button></div>`
      : `<button class="icon-btn" data-del="${rec.id}" aria-label="${esc(t("letters.delete"))}">${ICONS.trash}</button>`;
    return `
      <li class="letter ${s.finished ? "is-finished" : ""}">
        ${P.ui.calTile(s.next ? s.next.date : null, s.finished ? "is-optional" : "")}
        <div class="letter-body">
          <div class="letter-top">${pill}<span class="letter-saved">${esc(t("letters.saved", { date: P.ui.fmtDate(rec.savedAt.slice(0, 10), { month: "short", day: "numeric" }) }))}</span></div>
          <h3><a href="read.html?id=${encodeURIComponent(rec.id)}&step=1">${esc(title(rec))}</a></h3>
          <p class="letter-from">${esc(sender(rec))}${sender(rec) ? " " : ""}<span class="letter-lang">${ICONS.globe}${esc(P.ui.langInfo(rec.primary).native)}</span></p>
          ${s.next && !s.finished ? `<p class="letter-next"><b>${esc(P.ui.fmtDate(s.next.date, { weekday: "short", month: "short", day: "numeric" }))}</b> <span lang="en">${esc(s.next.action)}</span></p>` : ""}
          <div class="letter-progress"><div class="meter"><span style="width:${pct}%"></span></div><span>${esc(t("letters.tasks", { k: s.k, n: s.n }))}</span></div>
        </div>
        <div class="letter-actions">
          <a class="btn btn-secondary btn-sm" href="read.html?id=${encodeURIComponent(rec.id)}&step=3">${esc(t("letters.open"))}</a>
          ${del}
        </div>
      </li>`;
  }

  function render() {
    const all = P.store.list();
    if (!all.length) {
      app.innerHTML = `
        <section class="container letters-empty">
          <div class="empty-art" aria-hidden="true"><i></i><i></i><i></i></div>
          <h1 class="display">${esc(t("letters.empty.title"))}</h1>
          <p class="lede">${esc(t("letters.empty.body"))}</p>
          <div class="empty-actions">
            <a class="btn btn-primary btn-lg" href="read.html">${ICONS.upload}${esc(t("letters.empty.cta"))}</a>
            <a class="btn btn-secondary btn-lg" href="read.html?sample=school">${esc(t("letters.sample"))}</a>
          </div>
        </section>`;
      return;
    }
    const sorted = all.slice().sort((x, y) => {
      const a = status(x), b = status(y);
      if (a.finished !== b.finished) return a.finished ? 1 : -1;
      return ((a.next && a.next.date) || "9999").localeCompare((b.next && b.next.date) || "9999");
    });
    const shown = sorted.filter(r => filter === "all" || (filter === "done") === status(r).finished);
    const up = upcoming(all);
    const counts = { active: sorted.filter(r => !status(r).finished).length, done: sorted.filter(r => status(r).finished).length, all: sorted.length };

    app.innerHTML = `
      <section class="letters-head">
        <div class="container head-inner">
          <div><h1 class="display">${esc(t("letters.title"))}</h1><p class="lede">${esc(t("letters.lede"))}</p></div>
          <a class="btn btn-primary btn-lg" href="read.html">${ICONS.upload}${esc(t("cta.upload"))}</a>
        </div>
      </section>
      <div class="container letters-grid">
        <section aria-labelledby="all-h">
          <div class="list-head">
            <h2 id="all-h" class="sr-only">${esc(t("letters.all"))}</h2>
            <div class="filters" role="tablist">
              ${["active", "done", "all"].map(f => `<button role="tab" aria-selected="${filter === f}" data-filter="${f}">${esc(t("letters.filter." + f))}<span>${counts[f]}</span></button>`).join("")}
            </div>
          </div>
          ${shown.length ? `<ul class="letter-list">${shown.map(card).join("")}</ul>` : `<p class="none">${esc(t("letters.none"))}</p>`}
          <p class="local-note">${ICONS.lock}<span>${esc(t("letters.local"))}</span></p>
        </section>
        <aside class="upcoming" aria-labelledby="up-h">
          <h2 id="up-h">${esc(t("letters.upcoming"))}</h2>
          ${up.length ? `<ol class="up-list">${up.map(({ rec, d }) => `
            <li><a href="read.html?id=${encodeURIComponent(rec.id)}&step=2">
              <span class="up-date"><b>${esc(P.ui.fmtDate(d.date, { month: "short", day: "numeric" }))}</b><small>${esc(P.ui.relative(d.date))}</small></span>
              <span class="up-what"><span lang="en">${esc(d.action)}</span><small>${esc(sender(rec) || title(rec))}</small></span></a></li>`).join("")}</ol>`
          : `<p class="none">${esc(t("letters.noDates"))}</p>`}
        </aside>
      </div>`;
  }

  app.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.filter) { filter = b.dataset.filter; return render(); }
    if (b.dataset.del) { confirming = b.dataset.del; render(); const y = app.querySelector("[data-del-yes]"); if (y) y.focus(); return; }
    if (b.hasAttribute("data-del-no")) { const id = confirming; confirming = null; render(); const d = app.querySelector(`[data-del="${id}"]`); if (d) d.focus(); return; }
    if (b.dataset.delYes) { P.store.remove(b.dataset.delYes); confirming = null; P.ui.renderChrome("letters"); render(); P.ui.toast(t("letters.deleted")); }
  });
  window.addEventListener("plainly:lang", () => { P.ui.renderChrome("letters"); render(); });

  P.ui.renderChrome("letters");
  render();
})();
