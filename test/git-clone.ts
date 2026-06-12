// Integration test: prove the git smart-HTTP layer end to end against REAL
// github.com, with no CORS proxy — exactly the protocol the browser will run,
// only with Node's fetch standing in for the extension's privileged fetch.
//
// Network-dependent, so it lives outside the offline `bun test` glob.
// Run: bun test/git-clone.ts
import git from "isomorphic-git";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeGitHttp, type FetchLike } from "../src/githttp";

// A FetchLike over Node's fetch — the test-time stand-in for bridgeFetch.
const nodeFetch: FetchLike = async (url, init) => {
  const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
  const body = new Uint8Array(await r.arrayBuffer());
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  return { url: r.url, status: r.status, statusText: r.statusText, headers, body };
};

const REPO = "https://github.com/octocat/Hello-World";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-clone-test-"));

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

try {
  console.log(`Cloning ${REPO} → ${dir} via the git protocol (no CORS proxy)…`);
  const t0 = Date.now();
  await git.clone({
    fs,
    http: makeGitHttp(nodeFetch),
    dir,
    url: REPO,
    singleBranch: true,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // 1. Real git object store exists.
  assert(fs.existsSync(path.join(dir, ".git", "config")), ".git/config exists");
  // 2. Working tree checked out (Hello-World ships a README).
  assert(fs.existsSync(path.join(dir, "README")), "README checked out");
  // 3. Real commit history came over the wire.
  const log = await git.log({ fs, dir });
  assert(log.length >= 1, "git log has commits");
  const head = log[0];
  assert(/^[0-9a-f]{40}$/.test(head.oid), "HEAD oid is a real sha1");
  assert(head.commit.message.length > 0, "HEAD commit has a message");
  // 4. The packfile was actually received and unpacked (objects on disk).
  const branches = await git.listBranches({ fs, dir });
  assert(branches.length >= 1, "at least one branch ref");

  console.log(`\n✅ Real git clone over the protocol succeeded in ${secs}s`);
  console.log(`   commits on default branch: ${log.length}`);
  console.log(`   HEAD: ${head.oid.slice(0, 8)}  "${head.commit.message.trim().split("\n")[0]}"`);
  console.log(`   author: ${head.commit.author.name} <${head.commit.author.email}>`);
  console.log(`   branches: ${branches.join(", ")}`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
} catch (e) {
  console.error("\n❌ FAILED:", (e as Error).message);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}
