/* Landing page: header/footer, translations, and the hero "official -> plain" specimen. */
(function () {
  const P = window.Plainly;
  const t = (k, v) => P.i18n.t(k, v);

  // The official wording stays in English on purpose: it's what the real letter says.
  const SPEC = {
    school: {
      head: "Riverside Unified School District, Student Health Services",
      official: "Pursuant to state law, all students entering the 7th grade must present documentation of a Tdap booster immunization, which must be received by the school health office ",
      hl: "no later than Friday, December 5, 2026."
    },
    benefits: {
      head: "Harbor County Department of Social Services",
      official: "To continue receiving benefits, you must complete the enclosed Recertification Form RC-2 and provide verification of household income. All required documents ",
      hl: "must be received by November 30, 2026."
    },
    form: {
      head: "Bayview Community Scholarship, Application Instructions",
      official: "Applicants shall ensure that one (1) letter of recommendation from a current instructor is ",
      hl: "appended to the application prior to final submission."
    }
  };
  let current = "school";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function showSpec(key, animate) {
    current = key;
    const s = SPEC[key];
    document.querySelectorAll("[data-spec]").forEach(b => b.setAttribute("aria-selected", b.dataset.spec === key));
    document.getElementById("spec-head").textContent = s.head;
    const off = document.getElementById("spec-official");
    off.innerHTML = "";
    off.append(document.createTextNode(s.official));
    const mark = document.createElement("mark"); mark.className = "spec-hl"; mark.textContent = s.hl;
    off.append(mark);
    document.getElementById("spec-plain-text").textContent = t("spec." + key + ".plain");
    const fig = document.querySelector(".specimen");
    fig.classList.remove("is-playing", "is-shown");
    if (animate && !reduce) { void fig.offsetWidth; fig.classList.add("is-playing"); }
    else fig.classList.add("is-shown");
  }

  document.querySelector(".spec-tabs").addEventListener("click", e => {
    const b = e.target.closest("[data-spec]"); if (b) showSpec(b.dataset.spec, true);
  });
  document.querySelector(".spec-tabs").addEventListener("keydown", e => {
    if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
    const keys = Object.keys(SPEC), i = keys.indexOf(current);
    const next = keys[(i + (e.key === "ArrowRight" ? 1 : keys.length - 1)) % keys.length];
    showSpec(next, true); document.querySelector(`[data-spec="${next}"]`).focus();
  });

  function boot() {
    P.ui.renderChrome("home");
    P.i18n.apply();
    // keep the upload icon inside the hero button
    const up = document.getElementById("hero-upload");
    if (!up.querySelector("svg")) up.insertAdjacentHTML("afterbegin", P.ui.ICONS.upload);
    showSpec(current, false);
  }
  window.addEventListener("plainly:lang", boot);
  boot();
  // one orchestrated moment on first load
  if (!reduce) setTimeout(() => showSpec("school", true), 250);
})();
