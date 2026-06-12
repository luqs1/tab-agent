// tab.agent bridge — content script (the relay).
//
// Runs in the page at document_start, so its message listener is registered
// before any page script runs — the page's handshake is guaranteed to be heard.
// It is the ONLY link between the page and the privileged service worker, and
// it is deliberately dumb: it forwards page requests to the worker and posts
// results back. It never hands chrome.* to the page.
//
// Trust boundary: only accept messages from THIS window at THIS origin. The
// page can ask the worker to fetch; it cannot reach any other extension API.

(() => {
  const REQ = "tabagent-bridge";
  const RES = "tabagent-bridge-ext";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return; // ignore other frames/windows
    if (event.origin !== location.origin) return; // same-origin only
    const m = event.data;
    if (!m || m.source !== REQ || m.kind !== "req" || typeof m.id !== "number") return;

    chrome.runtime.sendMessage({ op: m.op, args: m.args }, (resp) => {
      const err = chrome.runtime.lastError;
      const payload = err
        ? { source: RES, kind: "res", id: m.id, ok: false, error: err.message }
        : { source: RES, kind: "res", id: m.id, ...(resp || { ok: false, error: "no response" }) };
      window.postMessage(payload, location.origin);
    });
  });

  // Proactively announce presence so a page that's already listening can flip
  // its "bridge available" state without waiting for a handshake round-trip.
  const m = chrome.runtime.getManifest();
  window.postMessage({ source: RES, kind: "hello", name: m.name, version: m.version }, location.origin);
})();
