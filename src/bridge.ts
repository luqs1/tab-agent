// Talks to the optional tab.agent companion extension (see extension/).
//
// The app stays a pure web page that works with NO extension installed — this
// module just feature-detects one and, if present, routes privileged
// (CORS-free) fetches through it. The extension's content script relays to its
// service worker, which holds the host permissions; the page never touches
// chrome.* and never learns the extension id. Absence is a resolved `null`,
// never an error.

const REQ = "tabagent-bridge";
const RES = "tabagent-bridge-ext";

export type BridgeInfo = { name: string; version: string; hosts: string[] };
export type BridgeResponse = {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Uint8Array;
};

let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let sawHello = false;

if (typeof window !== "undefined") {
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = (e as MessageEvent).data;
    if (!m || m.source !== RES) return;
    if (m.kind === "hello") {
      sawHello = true;
      return;
    }
    if (m.kind === "res" && typeof m.id === "number") {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error || "bridge error"));
    }
  });
}

function call(op: string, args: unknown, timeoutMs: number): Promise<any> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    window.postMessage({ source: REQ, kind: "req", id, op, args }, location.origin);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("bridge timeout"));
      }
    }, timeoutMs);
  });
}

/** The connected bridge's info, or null if no extension is present. */
export async function bridgeInfo(timeoutMs = 600): Promise<BridgeInfo | null> {
  if (typeof window === "undefined") return null;
  // A proactive "hello" already proves presence — but still round-trip to be
  // sure the worker is alive and to fetch its current host list.
  try {
    return (await call("hello", undefined, timeoutMs)) as BridgeInfo;
  } catch {
    return sawHello ? { name: "tab.agent bridge", version: "?", hosts: [] } : null;
  }
}

export async function bridgeAvailable(): Promise<boolean> {
  return (await bridgeInfo()) !== null;
}

/** Best-effort sync check: true once the extension's content script has said
 *  hello (it does so at document_start). For gating UI/tool exposure cheaply. */
export const bridgePresent = (): boolean => sawHello;

const b64 = {
  enc(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(s: string): Uint8Array {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

/** A privileged, CORS-free fetch via the extension. Binary-safe. */
export async function bridgeFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: Uint8Array } = {},
  timeoutMs = 60000,
): Promise<BridgeResponse> {
  const r = await call(
    "fetch",
    {
      url,
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      bodyB64: init.body ? b64.enc(init.body) : undefined,
    },
    timeoutMs,
  );
  return { url: r.url, status: r.status, statusText: r.statusText, headers: r.headers, body: b64.dec(r.bodyB64) };
}

// ---- browser control -------------------------------------------------------
// Drives real browser tabs through the extension (chrome.tabs + chrome.scripting
// live in the service worker). Each call is a no-op-shaped Promise reject if no
// extension is present, so callers should gate on bridgePresent() first.

export type TabInfo = { tabId: number; url?: string; title?: string; active?: boolean; windowId?: number };
export type PageContent = { url: string; title: string; text: string; links: { text: string; href: string }[] };

export const tabsList = (): Promise<{ tabs: TabInfo[] }> => call("tabs.list", {}, 8000);

export const tabOpen = (url: string, opts: { active?: boolean; wait?: boolean } = {}): Promise<TabInfo> =>
  call("tabs.open", { url, ...opts }, 30000);

export const tabClose = (tabId: number): Promise<{ closed: boolean }> => call("tabs.close", { tabId }, 8000);

export const tabActivate = (tabId: number): Promise<TabInfo> => call("tabs.activate", { tabId }, 8000);

export const tabNavigate = (tabId: number, url: string, wait = true): Promise<TabInfo> =>
  call("tabs.navigate", { tabId, url, wait }, 30000);

export const pageRead = (tabId: number): Promise<PageContent> => call("page.read", { tabId }, 15000);

export const pageEval = (tabId: number, expr: string): Promise<{ value?: string; error?: string }> =>
  call("page.eval", { tabId, expr }, 15000);

export const pageClick = (tabId: number, selector: string): Promise<{ found: boolean }> =>
  call("page.click", { tabId, selector }, 10000);

export const pageFill = (tabId: number, selector: string, value: string): Promise<{ found: boolean }> =>
  call("page.fill", { tabId, selector, value }, 10000);

export const pageWaitFor = (tabId: number, selector: string, timeoutMs = 5000): Promise<{ found: boolean }> =>
  call("page.waitFor", { tabId, selector, timeoutMs }, timeoutMs + 5000);

/** Screenshot of a tab as PNG bytes (the tab is briefly activated to capture). */
export async function pageScreenshot(tabId: number): Promise<Uint8Array> {
  const r = await call("page.screenshot", { tabId }, 15000);
  return b64.dec(r.bodyB64);
}
