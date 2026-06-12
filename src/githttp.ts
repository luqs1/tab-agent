// An isomorphic-git `http` plugin backed by an injectable fetch function.
//
// isomorphic-git normally needs a CORS proxy to reach github.com from a browser
// (github's git smart-HTTP endpoints send no CORS headers). Here the injected
// fetch does the request from a context that ISN'T subject to CORS — the
// companion extension's service worker in the browser, or plain Node fetch in
// tests. Same adapter, two backends; the git protocol code is identical and
// fully testable in Node without a browser.
//
// Pure module: no imports, no globals. The caller passes the fetch function.

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Uint8Array },
) => Promise<{ url: string; status: number; statusText: string; headers: Record<string, string>; body: Uint8Array }>;

// isomorphic-git's GitHttpRequest/GitHttpResponse shapes (the parts we use).
type GitHttpRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: AsyncIterableIterator<Uint8Array> | Iterable<Uint8Array>;
};

async function collect(body: GitHttpRequest["body"]): Promise<Uint8Array | undefined> {
  if (!body) return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  if (chunks.length === 1) return chunks[0];
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Build an isomorphic-git `http` plugin from a CORS-free fetch function. */
export function makeGitHttp(doFetch: FetchLike) {
  return {
    async request({ url, method = "GET", headers = {}, body }: GitHttpRequest) {
      const reqBody = await collect(body);
      const resp = await doFetch(url, { method, headers, body: reqBody });
      return {
        url: resp.url || url,
        method,
        statusCode: resp.status,
        statusMessage: resp.statusText,
        headers: resp.headers,
        // isomorphic-git consumes body as an async iterable of Uint8Array.
        body: (async function* () {
          yield resp.body;
        })(),
      };
    },
  };
}
