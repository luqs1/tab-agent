// tab.agent bridge — service worker.
//
// The privileged half. A content script relays the page's requests here; this
// worker performs the actual privileged work and hands results back. Two powers:
//
//   1. fetch  — a CORS-free fetch from the extension's own context (it holds the
//      host_permissions, so the page's CORS rules don't apply). Enables a real
//      git clone, raw fetches of no-CORS hosts, etc.
//   2. browser control — open/inspect/drive OTHER tabs via chrome.tabs +
//      chrome.scripting. Turns tab.agent into a real automation harness: open a
//      page, read its rendered content, click/fill, run an expression, scrape.
//
// We never expose chrome.* to the page — only the narrow op results below.
// Binary bodies cross the chrome.runtime boundary as base64 (that channel is
// JSON-serialized, so ArrayBuffers wouldn't survive).

const ALLOWED_OPS = new Set([
  "hello",
  "fetch",
  // browser control
  "tabs.list",
  "tabs.open",
  "tabs.close",
  "tabs.activate",
  "tabs.navigate",
  "page.read",
  "page.eval",
  "page.click",
  "page.fill",
  "page.waitFor",
  "page.screenshot",
]);

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

// ---- browser control -------------------------------------------------------

const slim = (t) => ({ tabId: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId });

// Resolve once a tab has finished (re)loading, so injected scripts run against a
// settled DOM. Resolves immediately if already complete.
function waitForComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpd);
      clearTimeout(timer);
      fn(v);
    };
    const onUpd = (id, info) => {
      if (id === tabId && info.status === "complete") finish(resolve);
    };
    const timer = setTimeout(() => finish(reject, new Error("tab load timed out")), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((t) => {
      if (t && t.status === "complete") finish(resolve);
    });
  });
}

// Run a function in a target tab and return its (JSON-safe) result. `world`
// "MAIN" reaches the page's own globals (needed for eval); the default ISOLATED
// world is enough for plain DOM work and is safer.
async function inject(tabId, func, args = [], world) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args, ...(world ? { world } : {}) });
  return res ? res.result : undefined;
}

// --- injected functions (serialized into the page; must be self-contained) ---

function _read() {
  const links = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const text = (a.innerText || a.textContent || "").trim().replace(/\s+/g, " ");
    if (text || a.href) links.push({ text: text.slice(0, 120), href: a.href });
    if (links.length >= 200) break;
  }
  return {
    url: location.href,
    title: document.title,
    text: (document.body ? document.body.innerText : "").trim(),
    links,
  };
}

function _eval(expr) {
  // Runs in MAIN world so `expr` can see the page's own globals. Subject to the
  // page's CSP — if eval is forbidden there, this throws and the agent is told.
  let value;
  try {
    value = (0, eval)(expr);
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
  try {
    return { value: JSON.stringify(value) ?? String(value) };
  } catch {
    return { value: String(value) };
  }
}

function _click(selector) {
  const el = document.querySelector(selector);
  if (!el) return { found: false };
  el.scrollIntoView({ block: "center" });
  el.click();
  return { found: true };
}

function _fill(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return { found: false };
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { found: true };
}

async function _waitFor(selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (document.querySelector(selector)) return { found: true };
    if (Date.now() > deadline) return { found: false };
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function handleBrowserOp(op, args) {
  switch (op) {
    case "tabs.list": {
      const tabs = await chrome.tabs.query({});
      return { tabs: tabs.map(slim) };
    }
    case "tabs.open": {
      const tab = await chrome.tabs.create({ url: args.url, active: args.active !== false });
      if (args.wait !== false) await waitForComplete(tab.id).catch(() => {});
      const fresh = await chrome.tabs.get(tab.id);
      return slim(fresh);
    }
    case "tabs.close":
      await chrome.tabs.remove(args.tabId);
      return { closed: true };
    case "tabs.activate": {
      const tab = await chrome.tabs.update(args.tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      return slim(tab);
    }
    case "tabs.navigate": {
      await chrome.tabs.update(args.tabId, { url: args.url });
      if (args.wait !== false) await waitForComplete(args.tabId).catch(() => {});
      const fresh = await chrome.tabs.get(args.tabId);
      return slim(fresh);
    }
    case "page.read":
      return await inject(args.tabId, _read);
    case "page.eval":
      return await inject(args.tabId, _eval, [String(args.expr)], "MAIN");
    case "page.click":
      return await inject(args.tabId, _click, [String(args.selector)]);
    case "page.fill":
      return await inject(args.tabId, _fill, [String(args.selector), String(args.value ?? "")]);
    case "page.waitFor":
      return await inject(args.tabId, _waitFor, [String(args.selector), Number(args.timeoutMs) || 5000]);
    case "page.screenshot": {
      if (args.tabId != null) {
        const tab = await chrome.tabs.update(args.tabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      }
      const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
      return { bodyB64: dataUrl.slice(dataUrl.indexOf(",") + 1), mime: "image/png" };
    }
  }
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
      if (msg.op === "fetch") {
        sendResponse({ ok: true, result: await doFetch(msg.args || {}) });
        return;
      }
      sendResponse({ ok: true, result: await handleBrowserOp(msg.op, msg.args || {}) });
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true; // keep the channel open for the async sendResponse
});
