// Clone a public git repo INTO the shared filesystem, over the real git
// protocol, via the companion extension (no CORS proxy, no backend).
//
// This is the payoff of the bridge: isomorphic-git's http goes through
// bridgeFetch (the extension's privileged fetch), and its fs is an adapter over
// Pyodide's Emscripten FS — so the checked-out working tree lands in /scratch
// or the user's shared folder, where python_exec and shell already operate.
//
// isomorphic-git + Buffer are CDN-loaded on first use (like WebLLM/Parakeet),
// so the shipped single file stays lean for everyone who never clones.
import { bridgeFetch, bridgeAvailable } from "./bridge";
import { makeGitHttp } from "./githttp";
import { getFS, syncMounts, userMount, ready } from "./pyenv";

const ISOGIT_URL = "https://esm.run/isomorphic-git@1.27.1";
const BUFFER_URL = "https://esm.run/buffer@6.0.3";

let isogit: any = null;
async function lib() {
  if (!isogit) {
    const { Buffer } = await import(/* @vite-ignore */ BUFFER_URL);
    (globalThis as any).Buffer = (globalThis as any).Buffer || Buffer; // isomorphic-git needs it
    isogit = (await import(/* @vite-ignore */ ISOGIT_URL)).default;
  }
  return isogit;
}

// An isomorphic-git `fs` over Pyodide's (synchronous) Emscripten FS.
function pyGitFs() {
  const FS = getFS();
  const toBytes = (d: any): Uint8Array =>
    typeof d === "string" ? new TextEncoder().encode(d) : new Uint8Array(d.buffer ?? d);
  const statShape = (p: string, follow: boolean) => {
    const s = follow ? FS.stat(p) : FS.lstat(p);
    const mtimeMs = (s.mtime instanceof Date ? s.mtime.getTime() : s.mtime) || Date.now();
    return {
      type: FS.isDir(s.mode) ? "dir" : FS.isLink(s.mode) ? "symlink" : "file",
      mode: s.mode,
      size: s.size,
      ino: s.ino ?? 0,
      mtimeMs,
      ctimeMs: mtimeMs,
      uid: 1,
      gid: 1,
      dev: 1,
      isFile: () => FS.isFile(s.mode),
      isDirectory: () => FS.isDir(s.mode),
      isSymbolicLink: () => FS.isLink(s.mode),
    };
  };
  const promises = {
    async readFile(p: string, opts?: any) {
      const enc = typeof opts === "string" ? opts : opts?.encoding;
      const bytes: Uint8Array = FS.readFile(p, { encoding: "binary" });
      return enc === "utf8" ? new TextDecoder().decode(bytes) : bytes;
    },
    async writeFile(p: string, data: any) {
      FS.writeFile(p, toBytes(data));
    },
    async unlink(p: string) {
      FS.unlink(p);
    },
    async readdir(p: string) {
      return FS.readdir(p).filter((n: string) => n !== "." && n !== "..");
    },
    async mkdir(p: string) {
      FS.mkdir(p);
    },
    async rmdir(p: string) {
      FS.rmdir(p);
    },
    async stat(p: string) {
      return statShape(p, true);
    },
    async lstat(p: string) {
      return statShape(p, false);
    },
    async readlink(p: string) {
      return FS.readlink(p);
    },
    async symlink(target: string, p: string) {
      FS.symlink(target, p);
    },
    async chmod(p: string, mode: number) {
      FS.chmod(p, mode);
    },
  };
  return { promises };
}

export type CloneResult = { dir: string; commits: number; head: string; headMsg: string; files: string[] };

/** "owner/repo" or a full github URL → a normalized https clone URL + repo name. */
function parseRepo(input: string): { url: string; name: string } {
  let s = input.trim().replace(/\.git$/, "");
  const short = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (short) return { url: `https://github.com/${short[1]}/${short[2]}`, name: short[2] };
  const u = new URL(s);
  const name = u.pathname.split("/").filter(Boolean).pop() || "repo";
  return { url: `https://${u.host}${u.pathname}`, name };
}

/** Clone a public repo into the shared folder (or /scratch). Requires the extension. */
export async function cloneRepo(input: string): Promise<CloneResult> {
  if (!(await bridgeAvailable())) {
    throw new Error(
      "Cloning with real git needs the tab.agent companion extension (it makes the network calls a web page can't). Without it, ask me to fetch the files over the GitHub API instead.",
    );
  }
  await ready;
  const git = await lib();
  const { url, name } = parseRepo(input);
  const mount = userMount();
  const base = mount ? mount.path : "/scratch";
  const dir = `${base}/${name}`;
  const FS = getFS();
  if (FS.analyzePath(dir).exists) throw new Error(`"${dir}" already exists — pick another spot or remove it first.`);
  FS.mkdirTree(dir);

  await git.clone({ fs: pyGitFs(), http: makeGitHttp((u: string, init: any) => bridgeFetch(u, init)), dir, url, singleBranch: true });
  await syncMounts(); // persist the checkout to disk

  const log = await git.log({ fs: pyGitFs(), dir });
  const files = FS.readdir(dir).filter((n: string) => n !== "." && n !== ".." && n !== ".git");
  return { dir, commits: log.length, head: log[0].oid, headMsg: log[0].commit.message.trim().split("\n")[0], files };
}
