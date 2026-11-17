/* SIMIA — boîte de consentement « cookies et ressources externes »
 *
 * Sert la landing (racine du site) et l'application (sous /app/). Le fichier est
 * volontairement autonome : aucun chemin, aucune dépendance, aucun autre fichier
 * à téléverser. Il injecte ses propres styles pour rester identique sur les deux
 * pages malgré leurs feuilles différentes.
 *
 * Ce que SIMIA stocke réellement : des conversations, des réglages et le choix
 * fait ici, dans le stockage local du navigateur. Rien de tout cela n'est un
 * cookie et rien n'est transmis. Seules les ressources chargées depuis un
 * service tiers (polices d'affichage, visionneuse 3D, API GitHub) demandent un
 * accord, et cet accord a un effet réel : sans lui, elles ne sont pas chargées.
 *
 * Les balises concernées portent data-consent-href ou data-consent-src au lieu
 * de href/src. Elles restent inertes tant que l'accord n'est pas donné.
 */

(function () {
  "use strict";

  if (window.__simiaCookiesLoaded) return;
  window.__simiaCookiesLoaded = true;

  var STORAGE_KEY = "simia-consent-v1";
  var APP_STORAGE_KEY = "simia.backup.v1";

  /* ------------------------------------------------------------------ */
  /* Langue                                                              */
  /* ------------------------------------------------------------------ */

  var TEXT = {
    fr: {
      eyebrow: "Confidentialité",
      title: "Cookies et ressources externes",
      intro: "SIMIA ne dépose aucun cookie publicitaire ni traceur, et n'envoie aucune conversation. Vos échanges restent sur cet appareil. Seules les ressources chargées depuis un service tiers demandent votre accord.",
      necessary: "Nécessaires",
      necessaryAlways: "Toujours actifs",
      necessaryText: "Stockage local des conversations, des réglages et du choix ci-dessous. Sans lui, SIMIA ne peut pas fonctionner.",
      external: "Ressources externes",
      externalText: "Polices d'affichage, visionneuse 3D, vérification des mises à jour et Pyodide (exécution de Python), chargés depuis un service tiers. Les refuser laisse JavaScript disponible et ne change rien à la conversation.",
      accept: "Tout accepter",
      refuse: "Tout refuser",
      customize: "Personnaliser",
      save: "Enregistrer mes choix",
      later: "Me le rappeler plus tard",
      changeNote: "Les ressources déjà chargées le restent jusqu'au prochain rechargement.",
      openLabel: "Choix des cookies"
    },
    en: {
      eyebrow: "Privacy",
      title: "Cookies and external resources",
      intro: "SIMIA sets no advertising or tracking cookie and sends no conversation anywhere. Your exchanges stay on this device. Only resources loaded from a third party require your consent.",
      necessary: "Required",
      necessaryAlways: "Always on",
      necessaryText: "Local storage for conversations, settings and the choice below. SIMIA cannot work without it.",
      external: "External resources",
      externalText: "Display fonts, 3D viewer, update check and Pyodide (running Python) loaded from a third party. Refusing them keeps JavaScript available and does not affect conversations.",
      accept: "Accept all",
      refuse: "Refuse all",
      customize: "Customise",
      save: "Save my choices",
      later: "Remind me later",
      changeNote: "Resources already loaded stay until the next reload.",
      openLabel: "Cookie choices"
    },
    es: {
      eyebrow: "Privacidad",
      title: "Cookies y recursos externos",
      intro: "SIMIA no instala cookies publicitarias ni de seguimiento y no envía ninguna conversación. Tus intercambios se quedan en este dispositivo. Solo los recursos cargados desde un tercero requieren tu consentimiento.",
      necessary: "Necesarios",
      necessaryAlways: "Siempre activos",
      necessaryText: "Almacenamiento local de las conversaciones, los ajustes y la elección de abajo. Sin él, SIMIA no puede funcionar.",
      external: "Recursos externos",
      externalText: "Fuentes de visualización, visor 3D, comprobación de versiones y Pyodide (ejecución de Python) cargados desde un tercero. Rechazarlos deja JavaScript disponible y no cambia nada en la conversación.",
      accept: "Aceptar todo",
      refuse: "Rechazar todo",
      customize: "Personalizar",
      save: "Guardar mis opciones",
      later: "Recordármelo más tarde",
      changeNote: "Los recursos ya cargados permanecen hasta la próxima recarga.",
      openLabel: "Opciones de cookies"
    },
    ja: {
      eyebrow: "プライバシー",
      title: "Cookie と外部リソース",
      intro: "SIMIA は広告 Cookie も追跡も使わず、会話をどこにも送信しません。やり取りはこの端末に残ります。第三者のサービスから読み込むリソースのみ、同意をお願いしています。",
      necessary: "必須",
      necessaryAlways: "常に有効",
      necessaryText: "会話、設定、下の選択肢をブラウザ内に保存します。これがないと SIMIA は動作しません。",
      external: "外部リソース",
      externalText: "表示フォント、3D ビューアー、更新確認、Pyodide（Python 実行）を第三者から読み込みます。拒否しても JavaScript は使え、会話の機能は変わりません。",
      accept: "すべて許可",
      refuse: "すべて拒否",
      customize: "カスタマイズ",
      save: "選択を保存",
      later: "後で通知",
      changeNote: "読み込み済みのリソースは再読み込みまで残ります。",
      openLabel: "Cookie の設定"
    }
  };

  function detectLanguage() {
    // L'application enregistre sa langue dans sa sauvegarde locale : c'est le
    // choix le plus fiable, l'utilisateur l'a fait explicitement.
    try {
      var backup = JSON.parse(localStorage.getItem(APP_STORAGE_KEY) || "null");
      var chosen = backup && backup.language;
      if (chosen && TEXT[chosen]) return chosen;
    } catch (error) { /* stockage indisponible ou sauvegarde illisible */ }

    var fromDocument = (document.documentElement.lang || "").slice(0, 2).toLowerCase();
    if (TEXT[fromDocument]) return fromDocument;

    var fromBrowser = (navigator.language || "fr").slice(0, 2).toLowerCase();
    return TEXT[fromBrowser] ? fromBrowser : "fr";
  }

  var LANG = detectLanguage();
  var T = TEXT[LANG];

  /* ------------------------------------------------------------------ */
  /* Choix enregistré                                                    */
  /* ------------------------------------------------------------------ */

  function readConsent() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var value = JSON.parse(raw);
      if (!value || typeof value.external !== "boolean") return null;
      return value;
    } catch (error) {
      return null;
    }
  }

  function writeConsent(external) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        external: external,
        at: new Date().toISOString(),
        version: 1
      }));
    } catch (error) { /* navigation privée : le choix ne survivra pas, tant pis */ }
  }

  /* ------------------------------------------------------------------ */
  /* Application effective du choix                                      */
  /* ------------------------------------------------------------------ */

  var current = false;
  var listeners = [];

  function activate() {
    // Feuilles de style et preconnections : poser href sur un <link> existant
    // suffit, le navigateur recharge immediatement la ressource.
    document.querySelectorAll("[data-consent-href]").forEach(function (element) {
      if (element.dataset.consentActive === "1") return;
      element.dataset.consentActive = "1";
      element.setAttribute("href", element.dataset.consentHref);
    });

    document.querySelectorAll("[data-consent-preconnect]").forEach(function (element) {
      if (element.dataset.consentActive === "1") return;
      element.dataset.consentActive = "1";
      element.setAttribute("rel", "preconnect");
      element.setAttribute("href", element.dataset.consentPreconnect);
      element.setAttribute("crossorigin", "anonymous");
    });

    // Scripts : un <script> deja analyse ne rejoue pas quand on lui pose un
    // src, il faut un nouvel element. Sans ca, la visionneuse 3D ne se
    // chargerait jamais apres un accord donne en cours de visite.
    document.querySelectorAll("[data-consent-src]").forEach(function (element) {
      if (element.dataset.consentActive === "1") return;
      element.dataset.consentActive = "1";

      var script = document.createElement("script");
      for (var index = 0; index < element.attributes.length; index++) {
        var attribute = element.attributes[index];
        if (attribute.name === "data-consent-src") {
          script.setAttribute("src", attribute.value);
          continue;
        }
        if (attribute.name.indexOf("data-") === 0) continue;
        script.setAttribute(attribute.name, attribute.value);
      }
      script.setAttribute("data-consent-injected", "1");
      element.parentNode.insertBefore(script, element.nextSibling);
    });
  }

  function deactivate() {
    document.querySelectorAll("[data-consent-active]").forEach(function (element) {
      element.removeAttribute("data-consent-active");
      if (element.dataset.consentHref) element.removeAttribute("href");
      // Une preconnection sans href ne fait rien : l'element reste en place.
      if (element.dataset.consentPreconnect) element.removeAttribute("href");
    });
    // Les scripts deja injectes ne peuvent pas etre "desinjectes" : on les
    // retire du document, ce qui suffit a couper leur effet pour la suite.
    document.querySelectorAll("script[data-consent-injected]").forEach(function (script) {
      script.remove();
    });
  }

  function apply(external) {
    current = external === true;
    if (current) activate(); else deactivate();
    listeners.forEach(function (listener) {
      try { listener(current); } catch (error) { /* un écouteur fautif ne bloque pas les autres */ }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Styles                                                              */
  /* ------------------------------------------------------------------ */

  var CSS = [
    ".simia-cookie{position:fixed;left:20px;bottom:20px;z-index:2147483000;width:min(420px,calc(100vw - 40px));",
    "background:var(--surface,#fffefa);color:var(--ink,#1d2522);border:1px solid var(--line,#e7e6df);",
    "border-radius:16px;box-shadow:0 18px 48px rgba(29,37,34,.16),0 2px 8px rgba(29,37,34,.06);",
    "font-family:Manrope,system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;line-height:1.55;",
    "padding:18px 18px 16px;display:none;box-sizing:border-box}",
    ".simia-cookie[data-open='1']{display:block;animation:simia-cookie-in .28s cubic-bezier(.2,.8,.3,1)}",
    "@keyframes simia-cookie-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",
    ".simia-cookie h2{margin:0 0 6px;font-size:15px;font-weight:800;letter-spacing:-.01em}",
    ".simia-cookie .simia-cookie-eyebrow{margin:0 0 4px;font-family:'DM Mono',ui-monospace,monospace;",
    "font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim,#8b938d)}",
    ".simia-cookie p{margin:0 0 12px;color:var(--muted,#6e7771)}",
    ".simia-cookie .simia-cookie-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}",
    ".simia-cookie button{font:inherit;cursor:pointer;border-radius:999px;padding:9px 16px;border:1px solid transparent;",
    "transition:background .16s ease,border-color .16s ease,transform .16s ease}",
    ".simia-cookie button:active{transform:scale(.98)}",
    ".simia-cookie button:focus-visible{outline:2px solid var(--ink,#1d2522);outline-offset:2px}",
    ".simia-cookie .simia-cookie-accept{background:var(--accent,#d8f451);color:var(--accent-ink,#263400);font-weight:700}",
    ".simia-cookie .simia-cookie-accept:hover{background:#cdea45}",
    ".simia-cookie .simia-cookie-refuse{background:transparent;color:var(--ink,#1d2522);border-color:var(--line,#e7e6df)}",
    ".simia-cookie .simia-cookie-refuse:hover{background:#f3f3ee}",
    ".simia-cookie .simia-cookie-link{background:none;border:none;padding:9px 2px;color:var(--muted,#6e7771);",
    "text-decoration:underline;text-underline-offset:3px;font-size:12px}",
    ".simia-cookie .simia-cookie-link:hover{color:var(--ink,#1d2522)}",
    ".simia-cookie .simia-cookie-later{display:block;margin:10px 0 0;background:none;border:none;padding:0;",
    "font-size:11px;color:var(--dim,#8b938d);text-decoration:underline;text-underline-offset:3px}",
    ".simia-cookie .simia-cookie-later:hover{color:var(--muted,#6e7771)}",
    ".simia-cookie-detail{display:none;margin:0 0 12px;border-top:1px solid var(--line,#e7e6df);padding-top:12px}",
    ".simia-cookie[data-detail='1'] .simia-cookie-detail{display:block}",
    ".simia-cookie[data-detail='1'] .simia-cookie-intro{display:none}",
    ".simia-cookie-row{display:flex;align-items:flex-start;gap:10px;margin-bottom:12px}",
    ".simia-cookie-row:last-child{margin-bottom:0}",
    ".simia-cookie-row strong{display:block;font-size:12.5px;font-weight:700}",
    ".simia-cookie-row small{display:block;color:var(--muted,#6e7771);font-size:11.5px;line-height:1.5}",
    ".simia-cookie-badge{flex:none;font-size:10px;letter-spacing:.04em;text-transform:uppercase;",
    "background:#eef2e8;color:#3f5b2a;border-radius:999px;padding:3px 9px;font-weight:700;white-space:nowrap}",
    // Les selecteurs sont volontairement plus specifiques que ceux des pages
    // (".simia-cookie button" passe apres ".simia-cookie-switch") : sans cela
    // l'interrupteur herite du rembourrage et de la largeur des boutons.
    ".simia-cookie .simia-cookie-switch{flex:0 0 auto;position:relative;width:38px;min-width:38px;max-width:38px;",
    "height:22px;border-radius:999px;border:1px solid var(--line,#e7e6df);background:#ecece6;cursor:pointer;",
    "transition:background .18s ease,border-color .18s ease;padding:0;margin:0;box-sizing:border-box}",
    ".simia-cookie .simia-cookie-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;",
    "border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.22);transition:transform .18s cubic-bezier(.2,.8,.3,1)}",
    ".simia-cookie .simia-cookie-switch[aria-pressed='true']{background:var(--accent,#d8f451);border-color:#c6e03f}",
    ".simia-cookie .simia-cookie-switch[aria-pressed='true']::after{transform:translateX(16px)}",
    ".simia-cookie .simia-cookie-switch:focus-visible{outline:2px solid var(--ink,#1d2522);outline-offset:2px}",
    ".simia-cookie .simia-cookie-note{margin:8px 0 0;font-size:11px;color:var(--dim,#8b938d)}",
    "@media (max-width:560px){.simia-cookie{left:0;right:0;bottom:0;width:100%;border-radius:16px 16px 0 0;",
    "padding:16px 16px 14px;box-shadow:0 -10px 34px rgba(29,37,34,.18)}",
    ".simia-cookie .simia-cookie-actions{gap:6px}",
    // Les trois boutons se partagent la largeur, mais l'interrupteur n'en fait
    // pas partie : il garde sa taille.
    ".simia-cookie .simia-cookie-actions button{padding:10px 14px;flex:1 1 auto}}",
    "@media (prefers-reduced-motion:reduce){.simia-cookie[data-open='1']{animation:none}",
    ".simia-cookie button,.simia-cookie .simia-cookie-switch,.simia-cookie .simia-cookie-switch::after{transition:none}}"
  ].join("");

  function injectStyles() {
    if (document.getElementById("simia-cookie-style")) return;
    var style = document.createElement("style");
    style.id = "simia-cookie-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /* Interface                                                           */
  /* ------------------------------------------------------------------ */

  var box = null;

  function build() {
    if (box) return box;

    box = document.createElement("section");
    box.className = "simia-cookie";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-labelledby", "simia-cookie-title");
    box.setAttribute("aria-describedby", "simia-cookie-intro");
    box.setAttribute("aria-label", T.openLabel);
    box.innerHTML = [
      '<p class="simia-cookie-eyebrow">', T.eyebrow, "</p>",
      '<h2 id="simia-cookie-title">', T.title, "</h2>",
      '<p class="simia-cookie-intro" id="simia-cookie-intro">', T.intro, "</p>",
      '<div class="simia-cookie-detail">',
      '<div class="simia-cookie-row"><div style="flex:1"><strong>', T.necessary, "</strong><small>",
      T.necessaryText, "</small></div><span class=\"simia-cookie-badge\">", T.necessaryAlways, "</span></div>",
      '<div class="simia-cookie-row"><div style="flex:1"><strong>', T.external, "</strong><small>",
      T.externalText, "</small></div>",
      '<button type="button" class="simia-cookie-switch" data-role="switch" aria-pressed="false" aria-label="',
      T.external, '"></button></div>',
      '<p class="simia-cookie-note" data-role="note" hidden>', T.changeNote, "</p>",
      "</div>",
      '<div class="simia-cookie-actions">',
      '<button type="button" class="simia-cookie-accept" data-role="accept">', T.accept, "</button>",
      '<button type="button" class="simia-cookie-refuse" data-role="refuse">', T.refuse, "</button>",
      '<button type="button" class="simia-cookie-link" data-role="customize">', T.customize, "</button>",
      '<button type="button" class="simia-cookie-link" data-role="save" hidden>', T.save, "</button>",
      "</div>",
      '<button type="button" class="simia-cookie-later" data-role="later">', T.later, "</button>"
    ].join("");

    document.body.appendChild(box);

    var toggle = box.querySelector('[data-role="switch"]');
    var save = box.querySelector('[data-role="save"]');
    var customize = box.querySelector('[data-role="customize"]');
    var note = box.querySelector('[data-role="note"]');

    function setToggle(value) {
      toggle.setAttribute("aria-pressed", value ? "true" : "false");
      note.hidden = !(current && !value);
    }

    function showDetail() {
      box.dataset.detail = "1";
      customize.hidden = true;
      save.hidden = false;
      setToggle(current);
      toggle.focus();
    }

    function decide(external) {
      writeConsent(external);
      apply(external);
      hide();
    }

    toggle.addEventListener("click", function () {
      var next = toggle.getAttribute("aria-pressed") !== "true";
      setToggle(next);
    });
    customize.addEventListener("click", showDetail);
    box.querySelector('[data-role="accept"]').addEventListener("click", function () { decide(true); });
    box.querySelector('[data-role="refuse"]').addEventListener("click", function () { decide(false); });
    save.addEventListener("click", function () { decide(toggle.getAttribute("aria-pressed") === "true"); });
    box.querySelector('[data-role="later"]').addEventListener("click", hide);

    box.addEventListener("keydown", function (event) {
      // Échap masque la boîte sans enregistrer de choix : elle reviendra à la
      // prochaine visite. Aucun consentement ne doit être déduit d'un rejet.
      if (event.key === "Escape") { event.stopPropagation(); hide(); }
    });

    return box;
  }

  var hideTimer = null;

  function show() {
    // Les styles ne sont injectés qu'à l'affichage : une page qui a déjà répondu
    // ne paie rien pour cette boîte.
    injectStyles();
    var element = build();
    window.clearTimeout(hideTimer);
    element.dataset.open = "1";
    element.dataset.detail = "0";
    element.querySelector('[data-role="customize"]').hidden = false;
    element.querySelector('[data-role="save"]').hidden = true;
    element.querySelector('[data-role="switch"]').setAttribute("aria-pressed", current ? "true" : "false");
    element.querySelector('[data-role="note"]').hidden = true;
    var first = element.querySelector('[data-role="accept"]');
    if (first) first.focus({ preventScroll: true });
  }

  function hide() {
    if (!box) return;
    box.dataset.open = "0";
  }

  /* ------------------------------------------------------------------ */
  /* Ouverture depuis les pages                                          */
  /* ------------------------------------------------------------------ */

  function wireTriggers() {
    var selector = "[data-simia-cookies-open],[data-zigmoon-cookies-open]";
    document.addEventListener("click", function (event) {
      var trigger = event.target.closest ? event.target.closest(selector) : null;
      if (!trigger) return;
      event.preventDefault();
      show();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */

  var stored = readConsent();
  apply(stored ? stored.external === true : false);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      wireTriggers();
      if (!stored) show();
    });
  } else {
    wireTriggers();
    if (!stored) show();
  }

  window.SimiaConsent = {
    external: function () { return current; },
    granted: function () { return stored !== null; },
    open: show,
    onChange: function (listener) {
      if (typeof listener === "function") listeners.push(listener);
    }
  };
})();
