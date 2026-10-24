// @ts-check
/*
 * Inline guard for <head> (built to dist/guard.min.js, ~1 KB). Plain JS so tests can evaluate it as is.
 *
 *   <script data-trapp-guard data-url="https://maintenance.trapp.build/<org>/<app>" data-timeout="15000">…</script>
 *
 * 1. Buffers early `error`/`unhandledrejection` events in window.__trapp.buffer for the SDK.
 * 2. Treats a failed <script>/<link> or a chunk-load error as "the app will not come up".
 * 3. If TrappProvider has not called window.__trapp.ready() within data-timeout and such a
 *    failure happened, redirects to data-url?reason=error&from=<path>. Never twice in 5 minutes,
 *    never on a ?trapp_retry=1 visit. The URL is baked in, so this works even when Trapp.build is down.
 */
(function () {
  var script = document.currentScript;
  var url = script && script.getAttribute("data-url");
  var timeout = Number(script && script.getAttribute("data-timeout")) || 15000;
  var trapp = (window.__trapp = window.__trapp || {});
  var buffer = (trapp.buffer = trapp.buffer || []);
  var failed = false;
  var ready = false;
  var CHUNK = /ChunkLoadError|Loading (?:CSS )?chunk|dynamically imported module|Importing a module script failed/;

  trapp.ready = function () {
    ready = true;
  };

  /** @param {Record<string, unknown>} entry */
  function push(entry) {
    if (buffer.length < 50) buffer.push(/** @type {never} */ (entry));
  }

  window.addEventListener(
    "error",
    function (event) {
      var target = /** @type {HTMLElement | null} */ (event.target);
      var tag = target && target.tagName;
      if (tag === "SCRIPT" || tag === "LINK") {
        failed = true;
        push({ type: "resource", url: /** @type {HTMLScriptElement} */ (target).src || /** @type {HTMLLinkElement} */ (target).href, ts: Date.now() });
        return;
      }
      if (tag) return; // other elements (img, video) failing to load are not a crash
      var error = event.error;
      var message = String((error && error.message) || event.message || "");
      if (CHUNK.test(message)) failed = true;
      push({ type: "error", message: message, stack: error && error.stack, filename: event.filename, lineno: event.lineno, colno: event.colno, ts: Date.now() });
    },
    true,
  );

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    var message = String((reason && reason.message) || reason || "");
    if (CHUNK.test(message)) failed = true;
    push({ type: "rejection", message: message, stack: reason && reason.stack, ts: Date.now() });
  });

  if (!url || url.indexOf("https://") !== 0 || /[?&]trapp_retry=1(?:&|$)/.test(location.search)) return;
  var target = url;

  setTimeout(function () {
    if (ready || !failed) return;
    try {
      var last = Number(sessionStorage.getItem("trapp_crash"));
      if (last && Date.now() - last < 300000) return;
      sessionStorage.setItem("trapp_crash", String(Date.now()));
    } catch (_) {
      /* storage unavailable: redirect anyway */
    }
    location.replace(target + (target.indexOf("?") < 0 ? "?" : "&") + "reason=error&from=" + encodeURIComponent(location.origin + location.pathname));
  }, timeout);
})();
