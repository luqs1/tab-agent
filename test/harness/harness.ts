// E2E harness: loads the REAL bridge + git http modules and exposes a tiny API
// for Playwright to drive. Served from localhost so the extension's content
// script injects. Nothing app-specific here — this isolates the bridge+git
// proof.
import { bridgeInfo, bridgeFetch } from "../../src/bridge";
import { makeGitHttp, type FetchLike } from "../../src/githttp";
import git from "isomorphic-git";
import LightningFS from "@isomorphic-git/lightning-fs";
import { Buffer } from "buffer";

// isomorphic-git needs a global Buffer in the browser; bundlers don't polyfill it.
(globalThis as any).Buffer = (globalThis as any).Buffer || Buffer;

const bridgeFetchLike: FetchLike = (url, init) => bridgeFetch(url, init);

(window as any).__h = {
  // Is the extension present?
  info: () => bridgeInfo(1500),

  // A plain browser fetch — expected to FAIL on a no-CORS host (github.com),
  // proving the contrast the extension exists to solve.
  directFetch: async (url: string) => {
    try {
      const r = await fetch(url);
      return { ok: true, status: r.status, bytes: (await r.arrayBuffer()).byteLength };
    } catch (e) {
      return { ok: false, error: String((e as Error).message || e) };
    }
  },

  // The same request through the extension — expected to SUCCEED.
  bridgeFetch: async (url: string) => {
    try {
      const r = await bridgeFetch(url);
      return { ok: true, status: r.status, bytes: r.body.byteLength };
    } catch (e) {
      return { ok: false, error: String((e as Error).message || e) };
    }
  },

  // The headline: a real git clone over the protocol, through the extension.
  clone: async (url: string) => {
    try {
      const fs = new LightningFS("clone-" + Math.floor(performance.now()));
      const dir = "/repo";
      const t0 = performance.now();
      await git.clone({ fs, http: makeGitHttp(bridgeFetchLike), dir, url, singleBranch: true });
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const log = await git.log({ fs, dir });
      const files: string[] = await (fs as any).promises.readdir(dir);
      return {
        ok: true,
        secs,
        commits: log.length,
        head: log[0].oid,
        headMsg: log[0].commit.message.trim().split("\n")[0],
        author: log[0].commit.author.name,
        files: files.filter((f) => f !== ".git"),
      };
    } catch (e) {
      return { ok: false, error: String((e as Error).message || e) };
    }
  },
};

// Signal readiness for the driver.
(window as any).__ready = true;
