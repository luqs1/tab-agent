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
