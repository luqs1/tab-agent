// End-to-end: launch Chromium WITH the unpacked extension, load the harness
// from localhost (so the extension's content script injects), and prove the
// whole chain — page ↔ content script ↔ service worker ↔ privileged fetch —
// including a real git clone that a plain page cannot do.
//
// Run: bun test/e2e.ts
import { chromium, type BrowserContext } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dir, "..");
const EXT = path.join(ROOT, "extension");
const HARNESS = path.join(ROOT, "test", "harness");
const NOCORS_URL = "https://github.com/octocat/Hello-World.git/info/refs?service=git-upload-pack";
const CLONE_URL = "https://github.com/octocat/Hello-World";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
}

// Minimal static server for the harness dir.
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript" };
const server = createServer((req, res) => {
  const rel = (req.url || "/").split("?")[0];
  const file = path.join(HARNESS, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(HARNESS) || !existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as any).port;
const base = `http://localhost:${port}/`;

const userDataDir = path.join(os.tmpdir(), "ta-ext-e2e-" + Date.now());
let ctx: BrowserContext | null = null;
try {
  const headless = process.env.HEADED ? false : true;
  ctx = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  const page = await ctx.newPage();
  page.on("console", (m) => console.log("   [page]", m.type(), m.text()));
  page.on("pageerror", (e) => console.log("   [pageerror]", e.message));
  await page.goto(base, { waitUntil: "load" });
  try {
    await page.waitForFunction("window.__ready === true", null, { timeout: 10_000 });
    check("harness module loaded", true);
  } catch {
    check("harness module loaded", false, "window.__ready never set — see [pageerror] above");
  }

  // Confirm the extension's service worker registered (it may be dormant until
  // the first message wakes it, so check after the harness/handshake).
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 5_000 }).catch(() => null as any);
  check("extension service worker registered", !!sw, sw ? new URL(sw.url()).protocol : "none");

  // 1. Page detects the bridge (content script handshake → SW).
  const info = await page.evaluate("window.__h.info()");
  check("page detects the extension bridge", !!info && (info as any).name === "tab.agent bridge",
    info ? `v${(info as any).version}` : "no info");

  // 2. The contrast: a plain fetch of a no-CORS host fails…
  const direct = await page.evaluate(`window.__h.directFetch(${JSON.stringify(NOCORS_URL)})`);
  check("plain page fetch of github.com is blocked (CORS)", (direct as any).ok === false,
    (direct as any).error || `unexpectedly got ${(direct as any).status}`);

  // …but the same request through the extension succeeds.
  const bridged = await page.evaluate(`window.__h.bridgeFetch(${JSON.stringify(NOCORS_URL)})`);
  check("same request via the extension succeeds", (bridged as any).ok === true && (bridged as any).status === 200,
    (bridged as any).ok ? `${(bridged as any).bytes} bytes` : (bridged as any).error);

  // 3. The headline: a real git clone over the protocol, through the bridge.
  const clone: any = await page.evaluate(`window.__h.clone(${JSON.stringify(CLONE_URL)})`, null);
  check("real git clone via the extension", clone.ok === true && clone.commits >= 1 && /^[0-9a-f]{40}$/.test(clone.head || ""),
    clone.ok ? `${clone.commits} commits, HEAD ${String(clone.head).slice(0, 8)} "${clone.headMsg}", files: ${clone.files.join(", ")}` : clone.error);

  console.log("");
  console.log(failures === 0 ? "🎉 ALL E2E CHECKS PASSED" : `💥 ${failures} CHECK(S) FAILED`);
} finally {
  if (ctx) await ctx.close();
  server.close();
}
process.exit(failures === 0 ? 0 : 1);
