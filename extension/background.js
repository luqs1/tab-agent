// tab.agent bridge — service worker.
//
// The privileged half. A content script relays the page's requests here; this
// worker performs the actual fetch. Because the request originates from the
// extension (which holds host_permissions for the listed hosts), it is NOT
// subject to the page's CORS restrictions — that is the whole point. We fetch
// the bytes and hand them back; we never expose chrome.* to the page.
//
// Binary bodies cross the chrome.runtime boundary as base64 (that channel is
// JSON-serialized, so ArrayBuffers wouldn't survive).

const ALLOWED_OPS = new Set(["hello", "fetch"]);

function b64FromBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function bytesFromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function doFetch(args) {
  const { url, method = "GET", headers = {}, bodyB64 } = args;
  const init = { method, headers, redirect: "follow" };
  if (bodyB64 != null) init.body = bytesFromB64(bodyB64);
  const resp = await fetch(url, init);
  const buf = new Uint8Array(await resp.arrayBuffer());
  const respHeaders = {};
  resp.headers.forEach((v, k) => (respHeaders[k] = v));
  return {
    status: resp.status,
    statusText: resp.statusText,
    headers: respHeaders,
    url: resp.url,
    bodyB64: b64FromBytes(buf),
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object" || !ALLOWED_OPS.has(msg.op)) return; // not ours
  (async () => {
    try {
      if (msg.op === "hello") {
        const m = chrome.runtime.getManifest();
        sendResponse({ ok: true, result: { name: m.name, version: m.version, hosts: m.host_permissions } });
        return;
      }
      sendResponse({ ok: true, result: await doFetch(msg.args || {}) });
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true; // keep the channel open for the async sendResponse
});
