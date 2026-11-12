/* Interface text (the app's own words). Letter content comes from the backend.
   Add a language by copying the `es` block. */
(function () {
  const Plainly = (window.Plainly = window.Plainly || {});

  const STR = {
    en: {
      "nav.skip": "Skip to content", "nav.label": "Main", "nav.how": "How it works", "nav.letters": "My letters", "nav.uiLang": "Site language",
      "nav.back": "Back", "nav.finish": "Finish", "nav.next": "Next: {name}",
      "cta.upload": "Upload a letter",
      "footer.about": "Plainly turns confusing official letters into plain answers, dates and a checklist, in your language.",
      "footer.use": "Use Plainly", "footer.sampleSchool": "Try a school notice", "footer.sampleBenefits": "Try a benefits letter", "footer.sampleArt": "Try a short school flyer",
      "footer.help": "Help", "footer.faq": "Questions", "footer.privacy": "Privacy",
      "footer.disclaimer": "Plainly explains letters. It isn't legal advice. Always check important dates with whoever sent the letter.",

      "date.noDate": "No date", "date.passed": "Date passed", "date.today": "Today", "date.tomorrow": "Tomorrow", "date.inDays": "In {n} days",

      "start.title": "What letter do you need help with?",
      "start.lede": "Pick your language, then add the letter. You'll get what it means, the deadlines and a checklist.",
      "start.langTitle": "Choose your language",
      "start.langSub": "We'll translate the explanation into this language.",
      "start.langRequired": "Choose a language first. Your letter will start right after.",
      "start.noTranslation": "No translation",
      "start.other": "Other", "start.otherSub": "Type a language",
      "start.otherLabel": "Which language?", "start.otherPlaceholder": "For example: Somali", "start.otherUse": "Use this language",
      "start.fileTitle": "Add your letter",
      "start.drop": "Choose a file or drag it here", "start.dropHint": "PDF, JPG, PNG or a text file, up to 5 MB",
      "start.camera": "Take a photo", "start.paste": "Paste the text",
      "start.pasteLabel": "Paste the words from the letter or email", "start.pastePlaceholder": "Dear Parent/Guardian…", "start.pasteGo": "Explain this text",
      "start.samples": "No letter handy? Try one:",
      "sample.school": "School vaccine notice", "sample.benefits": "Food benefits renewal", "sample.artnight": "Art night flyer",
      "tips.title": "For the best result",
      "tips.1.t": "Lay it flat", "tips.1.b": "Put the letter on a table and fit the whole page in the photo.",
      "tips.2.t": "Find good light", "tips.2.b": "Avoid shadows and glare across the words.",
      "tips.3.t": "Every page counts", "tips.3.b": "Dates often hide on page 2. Upload a PDF to include all pages.",
      "tips.privacy": "Letters are read by Google's Gemini AI. While Plainly is being tested, use letters with private details covered or removed.",

      "read.title": "Analyzing your notice…", "read.lede": "Reading it and translating into {lang}.",
      "read.slow": "Photos and PDFs can take up to a minute. Keep this page open.",

      "err.HEIC.title": "iPhone HEIC photos aren't supported yet", "err.HEIC.body": "Save the photo as JPG or PNG, or take a new one with the Take a photo button.",
      "err.UNSUPPORTED_FILE.title": "That file type won't work", "err.UNSUPPORTED_FILE.body": "Upload a PDF, a JPG or PNG photo, or a text file.",
      "err.TOO_LARGE.title": "That file is too big", "err.TOO_LARGE.body": "Choose a file under 5 MB, or paste a shorter piece of text.",
      "err.TEXT_TOO_LONG.title": "That's too much text", "err.TEXT_TOO_LONG.body": "Paste 40,000 characters or fewer. Try just the pages with instructions.",
      "err.EMPTY_TEXT.title": "There isn't enough to explain", "err.EMPTY_TEXT.body": "Paste the whole letter, not just a line or two.",
      "err.UNPROCESSABLE.title": "We couldn't read this letter", "err.UNPROCESSABLE.body": "Try a clearer photo, a shorter letter, or a different file.",
      "err.QUOTA.title": "Plainly is busy right now", "err.QUOTA.body": "We've hit today's limit for reading letters. Try again later.",
      "err.SERVICE.title": "The reading service didn't respond", "err.SERVICE.body": "This is on our side. Try again in a moment.",
      "err.NOT_CONFIGURED.title": "Plainly isn't set up correctly", "err.NOT_CONFIGURED.body": "This needs to be fixed by the Plainly team. You don't need to do anything.",
      "err.TIMEOUT.title": "This is taking too long", "err.TIMEOUT.body": "Try a shorter letter, or fewer pages.",
      "err.NETWORK.title": "Can't reach Plainly", "err.NETWORK.body": "Check your internet connection. If you're running Plainly yourself, make sure the backend is started.",
      "err.SERVER.title": "Something went wrong", "err.SERVER.body": "Your letter wasn't saved. Try again in a moment.",
      "err.MOCK_LANGUAGE.title": "Demo data doesn't have this language", "err.MOCK_LANGUAGE.body": "Connect the backend to translate into any language.",
      "err.serverSaid": "Details:", "err.retry": "Try again", "err.another": "Upload a different letter", "err.sample": "Use a sample letter instead", "err.code": "Error code:",

      "steps.label": "Steps", "steps.count": "Step {i} of {n}",
      "step.what": "What is this?", "step.when": "When?", "step.do": "What do I do?", "step.lang": "Your language",
      "toggle.label": "Show in",

      "what.inEnglish": "In English:", "what.demo": "Demo mode: this is a sample result. Real letters are read once the backend is connected.",
      "what.from": "From",
      "what.deadlines": "{n} deadlines", "what.deadlinesOne": "1 deadline", "what.tasks": "{n} things to do", "what.tasksOne": "1 thing to do",
      "what.unsure": "Double-check these details", "what.unsureEnglish": "These notes are in English.",
      "what.original": "See your original letter",

      "when.next": "Your next deadline is {date}.", "when.allPassed": "All the dates in this letter have passed.",
      "when.noDates": "This letter has deadlines, but no exact dates.", "when.noDatesSub": "Read each one carefully. Some are counted from when you got the letter.",
      "when.none": "No action deadline found.", "when.noneSub": "This letter doesn't ask you to do anything by a certain date.",
      "when.englishNote": "Deadlines are in English, with the letter's own wording.",
      "when.other": "Other deadlines", "when.noExact": "No exact date", "when.says": "The letter says:",
      "when.addOne": "Add to calendar", "when.addAll": "Add all {n} dates to my calendar",

      "do.none": "Nothing to do.", "do.noneSub": "This letter is just for your information.",
      "do.answer": "{n} things to do.", "do.answerOne": "One thing to do.", "do.progress": "{k} of {n} done", "do.allDone": "All done. Nice work.",

      "lang.answer": "Read it in your language.", "lang.label": "Languages", "lang.loading": "Translating",
      "lang.listen": "Listen", "lang.stop": "Stop", "lang.copy": "Copy", "lang.print": "Print",
      "lang.note": "Translated by AI. If something seems wrong, check the original letter or ask the sender.",
      "lang.moreTitle": "Need another language?", "lang.moreSub": "We'll read the letter again in that language. This takes a moment.",
      "lang.choose": "Choose a language", "lang.translate": "Translate", "lang.translating": "Translating…",
      "lang.failed": "Couldn't translate into {lang}.", "lang.needFile": "To add another language, upload the letter again. Plainly doesn't keep your file after you leave the page.",

      "glance.label": "This letter at a glance", "glance.title": "At a glance", "glance.next": "Next deadline", "glance.noDate": "No exact date",
      "glance.checklist": "Checklist", "glance.language": "Your language",
      "glance.another": "Read another letter", "glance.saved": "Saved to My letters on this device",

      "done.title": "You're all set.", "done.lede": "This letter is saved in My letters on this device, with your checklist, so you can come back to it.",
      "done.remember": "Next thing to remember", "done.addCal": "Add to calendar",
      "done.letters": "Go to My letters", "done.another": "Read another letter", "done.review": "Go back to the answers",

      "original.title": "Your original letter", "original.close": "Close", "original.alt": "Photo of the original letter",

      "toast.calendar": "Calendar file downloaded. Open it to add the dates.", "toast.noSpeech": "Read aloud isn't supported in this browser.",
      "toast.copied": "Copied", "toast.copyFail": "Couldn't copy. Select the text and copy it instead.", "toast.allDone": "Every task is done.",
      "toast.sampleLang": "The demo doesn't include {lang}, so it's shown in Spanish.",
      "toast.listMismatch": "This translation's checklist didn't line up with the English one, so the checklist stays in English.",

      "letters.title": "My letters", "letters.lede": "Every letter you've read with Plainly on this device, with what's due next.",
      "letters.upcoming": "Coming up", "letters.all": "All letters",
      "letters.empty.title": "No letters yet", "letters.empty.body": "When you read a letter with Plainly, it's saved here with its deadlines and checklist.",
      "letters.empty.cta": "Read your first letter",
      "letters.saved": "Added {date}", "letters.open": "Open", "letters.delete": "Delete",
      "letters.confirm": "Delete this letter and its checklist?", "letters.confirmYes": "Delete", "letters.cancel": "Keep it",
      "letters.allDone": "All done", "letters.tasks": "{k} of {n} tasks done", "letters.deleted": "Letter deleted",
      "letters.noDates": "No exact dates", "letters.local": "Letters are saved on this device only. Clearing your browser data removes them.",
      "letters.filter.active": "To do", "letters.filter.done": "Finished", "letters.filter.all": "All",
      "letters.none": "Nothing here.", "letters.sample": "Use a sample letter"
    },

    es: {
      "nav.skip": "Ir al contenido", "nav.label": "Principal", "nav.how": "Cómo funciona", "nav.letters": "Mis cartas", "nav.uiLang": "Idioma del sitio",
      "nav.back": "Atrás", "nav.finish": "Terminar", "nav.next": "Siguiente: {name}",
      "cta.upload": "Subir una carta",
      "footer.about": "Plainly convierte cartas oficiales confusas en respuestas simples, fechas y una lista de tareas, en su idioma.",
      "footer.use": "Usar Plainly", "footer.sampleSchool": "Probar un aviso escolar", "footer.sampleBenefits": "Probar una carta de beneficios", "footer.sampleArt": "Probar un aviso corto",
      "footer.help": "Ayuda", "footer.faq": "Preguntas", "footer.privacy": "Privacidad",
      "footer.disclaimer": "Plainly explica cartas. No es asesoría legal. Confirme siempre las fechas importantes con quien envió la carta.",

      "date.noDate": "Sin fecha", "date.passed": "Ya pasó", "date.today": "Hoy", "date.tomorrow": "Mañana", "date.inDays": "En {n} días",

      "start.title": "¿Con qué carta necesita ayuda?",
      "start.lede": "Elija su idioma y luego agregue la carta. Recibirá qué significa, las fechas límite y una lista de tareas.",
      "start.langTitle": "Elija su idioma",
      "start.langSub": "Traduciremos la explicación a este idioma.",
      "start.langRequired": "Primero elija un idioma. Su carta empezará justo después.",
      "start.noTranslation": "Sin traducción",
      "start.other": "Otro", "start.otherSub": "Escriba un idioma",
      "start.otherLabel": "¿Qué idioma?", "start.otherPlaceholder": "Por ejemplo: Somali", "start.otherUse": "Usar este idioma",
      "start.fileTitle": "Agregue su carta",
      "start.drop": "Elija un archivo o arrástrelo aquí", "start.dropHint": "PDF, JPG, PNG o un archivo de texto, hasta 5 MB",
      "start.camera": "Tomar una foto", "start.paste": "Pegar el texto",
      "start.pasteLabel": "Pegue las palabras de la carta o del correo", "start.pastePlaceholder": "Estimado padre/tutor…", "start.pasteGo": "Explicar este texto",
      "start.samples": "¿No tiene una carta a la mano? Pruebe una:",
      "sample.school": "Aviso escolar de vacunas", "sample.benefits": "Renovación de beneficios de comida", "sample.artnight": "Aviso de noche de arte",
      "tips.title": "Para un mejor resultado",
      "tips.1.t": "Póngala plana", "tips.1.b": "Ponga la carta en una mesa y que se vea toda la página en la foto.",
      "tips.2.t": "Busque buena luz", "tips.2.b": "Evite sombras y reflejos sobre las palabras.",
      "tips.3.t": "Todas las páginas cuentan", "tips.3.b": "Las fechas a veces están en la página 2. Suba un PDF para incluir todas.",
      "tips.privacy": "Las cartas las lee la IA Gemini de Google. Mientras Plainly está en prueba, use cartas con los datos privados tapados o borrados.",

      "read.title": "Analizando su aviso…", "read.lede": "Leyéndolo y traduciéndolo al {lang}.",
      "read.slow": "Las fotos y los PDF pueden tardar hasta un minuto. No cierre esta página.",

      "err.HEIC.title": "Las fotos HEIC del iPhone todavía no funcionan", "err.HEIC.body": "Guarde la foto como JPG o PNG, o tome una nueva con el botón Tomar una foto.",
      "err.UNSUPPORTED_FILE.title": "Ese tipo de archivo no funciona", "err.UNSUPPORTED_FILE.body": "Suba un PDF, una foto JPG o PNG, o un archivo de texto.",
      "err.TOO_LARGE.title": "Ese archivo es muy grande", "err.TOO_LARGE.body": "Elija un archivo de menos de 5 MB o pegue un texto más corto.",
      "err.TEXT_TOO_LONG.title": "Es demasiado texto", "err.TEXT_TOO_LONG.body": "Pegue 40,000 caracteres o menos. Pruebe solo con las páginas de instrucciones.",
      "err.EMPTY_TEXT.title": "No hay suficiente para explicar", "err.EMPTY_TEXT.body": "Pegue la carta completa, no solo una o dos líneas.",
      "err.UNPROCESSABLE.title": "No pudimos leer esta carta", "err.UNPROCESSABLE.body": "Pruebe con una foto más clara, una carta más corta u otro archivo.",
      "err.QUOTA.title": "Plainly está ocupado ahora", "err.QUOTA.body": "Llegamos al límite de hoy para leer cartas. Inténtelo más tarde.",
      "err.SERVICE.title": "El servicio de lectura no respondió", "err.SERVICE.body": "Es un problema de nuestro lado. Inténtelo de nuevo en un momento.",
      "err.NOT_CONFIGURED.title": "Plainly no está bien configurado", "err.NOT_CONFIGURED.body": "El equipo de Plainly tiene que arreglarlo. Usted no tiene que hacer nada.",
      "err.TIMEOUT.title": "Está tardando demasiado", "err.TIMEOUT.body": "Pruebe con una carta más corta o con menos páginas.",
      "err.NETWORK.title": "No se puede conectar con Plainly", "err.NETWORK.body": "Revise su conexión a internet. Si usted ejecuta Plainly, asegúrese de que el servidor esté encendido.",
      "err.SERVER.title": "Algo salió mal", "err.SERVER.body": "Su carta no se guardó. Inténtelo de nuevo en un momento.",
      "err.MOCK_LANGUAGE.title": "Los datos de prueba no tienen este idioma", "err.MOCK_LANGUAGE.body": "Conecte el servidor para traducir a cualquier idioma.",
      "err.serverSaid": "Detalles:", "err.retry": "Intentar de nuevo", "err.another": "Subir otra carta", "err.sample": "Usar una carta de ejemplo", "err.code": "Código de error:",

      "steps.label": "Pasos", "steps.count": "Paso {i} de {n}",
      "step.what": "¿Qué es esto?", "step.when": "¿Cuándo?", "step.do": "¿Qué hago?", "step.lang": "Su idioma",
      "toggle.label": "Mostrar en",

      "what.inEnglish": "En inglés:", "what.demo": "Modo de demostración: este es un resultado de ejemplo. Las cartas reales se leen cuando el servidor esté conectado.",
      "what.from": "De",
      "what.deadlines": "{n} fechas límite", "what.deadlinesOne": "1 fecha límite", "what.tasks": "{n} cosas que hacer", "what.tasksOne": "1 cosa que hacer",
      "what.unsure": "Revise estos detalles", "what.unsureEnglish": "Estas notas están en inglés.",
      "what.original": "Ver su carta original",

      "when.next": "Su próxima fecha límite es el {date}.", "when.allPassed": "Todas las fechas de esta carta ya pasaron.",
      "when.noDates": "Esta carta tiene fechas límite, pero sin fechas exactas.", "when.noDatesSub": "Lea cada una con cuidado. Algunas se cuentan desde que recibió la carta.",
      "when.none": "No se encontró ninguna fecha límite.", "when.noneSub": "Esta carta no le pide hacer nada antes de una fecha.",
      "when.englishNote": "Las fechas límite están en inglés, con las palabras de la carta.",
      "when.other": "Otras fechas límite", "when.noExact": "Sin fecha exacta", "when.says": "La carta dice:",
      "when.addOne": "Agregar al calendario", "when.addAll": "Agregar las {n} fechas a mi calendario",

      "do.none": "Nada que hacer.", "do.noneSub": "Esta carta es solo informativa.",
      "do.answer": "{n} cosas que hacer.", "do.answerOne": "Una cosa que hacer.", "do.progress": "{k} de {n} hechas", "do.allDone": "Todo listo. ¡Bien hecho!",

      "lang.answer": "Léalo en su idioma.", "lang.label": "Idiomas", "lang.loading": "Traduciendo",
      "lang.listen": "Escuchar", "lang.stop": "Detener", "lang.copy": "Copiar", "lang.print": "Imprimir",
      "lang.note": "Traducido por IA. Si algo parece incorrecto, revise la carta original o pregunte a quien la envió.",
      "lang.moreTitle": "¿Necesita otro idioma?", "lang.moreSub": "Leeremos la carta otra vez en ese idioma. Tarda un momento.",
      "lang.choose": "Elija un idioma", "lang.translate": "Traducir", "lang.translating": "Traduciendo…",
      "lang.failed": "No se pudo traducir al {lang}.", "lang.needFile": "Para agregar otro idioma, suba la carta otra vez. Plainly no guarda su archivo cuando sale de la página.",

      "glance.label": "Esta carta de un vistazo", "glance.title": "De un vistazo", "glance.next": "Próxima fecha límite", "glance.noDate": "Sin fecha exacta",
      "glance.checklist": "Lista de tareas", "glance.language": "Su idioma",
      "glance.another": "Leer otra carta", "glance.saved": "Guardada en Mis cartas en este dispositivo",

      "done.title": "Todo listo.", "done.lede": "Esta carta está guardada en Mis cartas en este dispositivo, con su lista de tareas, para que vuelva cuando quiera.",
      "done.remember": "Lo próximo que debe recordar", "done.addCal": "Agregar al calendario",
      "done.letters": "Ir a Mis cartas", "done.another": "Leer otra carta", "done.review": "Volver a las respuestas",

      "original.title": "Su carta original", "original.close": "Cerrar", "original.alt": "Foto de la carta original",

      "toast.calendar": "Archivo de calendario descargado. Ábralo para agregar las fechas.", "toast.noSpeech": "Este navegador no puede leer en voz alta.",
      "toast.copied": "Copiado", "toast.copyFail": "No se pudo copiar. Seleccione el texto y cópielo.", "toast.allDone": "Todas las tareas están hechas.",
      "toast.sampleLang": "La demostración no incluye {lang}, así que se muestra en español.",
      "toast.listMismatch": "La lista de esta traducción no coincide con la de inglés, así que la lista se queda en inglés.",

      "letters.title": "Mis cartas", "letters.lede": "Todas las cartas que ha leído con Plainly en este dispositivo, con lo próximo que vence.",
      "letters.upcoming": "Próximamente", "letters.all": "Todas las cartas",
      "letters.empty.title": "Todavía no hay cartas", "letters.empty.body": "Cuando lea una carta con Plainly, se guardará aquí con sus fechas límite y su lista de tareas.",
      "letters.empty.cta": "Leer su primera carta",
      "letters.saved": "Agregada el {date}", "letters.open": "Abrir", "letters.delete": "Borrar",
      "letters.confirm": "¿Borrar esta carta y su lista de tareas?", "letters.confirmYes": "Borrar", "letters.cancel": "Conservarla",
      "letters.allDone": "Todo hecho", "letters.tasks": "{k} de {n} tareas hechas", "letters.deleted": "Carta borrada",
      "letters.noDates": "Sin fechas exactas", "letters.local": "Las cartas se guardan solo en este dispositivo. Si borra los datos del navegador, se borran.",
      "letters.filter.active": "Pendientes", "letters.filter.done": "Terminadas", "letters.filter.all": "Todas",
      "letters.none": "No hay nada aquí.", "letters.sample": "Usar una carta de ejemplo"
    }
  };

  // Landing-page strings live in home-strings.js.
  function dict(lang) { const H = window.PLAINLY_HOME_STRINGS || {}; return Object.assign({}, STR.en, H.en, STR[lang] || {}, H[lang] || {}); }

  let lang = "en";
  try { lang = localStorage.getItem("plainly.lang") || ((navigator.language || "").startsWith("es") ? "es" : "en"); } catch (e) { /* storage blocked */ }
  if (!STR[lang]) lang = "en";

  function t(key, vars) {
    let s = dict(lang)[key];
    if (s === undefined) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return s;
  }
  function apply(root) {
    (root || document).querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    (root || document).querySelectorAll("[data-i18n-aria]").forEach(el => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
    document.documentElement.lang = lang;
  }

  Plainly.i18n = {
    get lang() { return lang; },
    t, apply,
    setLang(l) {
      lang = STR[l] ? l : "en";
      try { localStorage.setItem("plainly.lang", lang); } catch (e) { /* ignore */ }
      apply();
      window.dispatchEvent(new CustomEvent("plainly:lang", { detail: lang }));
    }
  };
  document.documentElement.lang = lang;
})();
