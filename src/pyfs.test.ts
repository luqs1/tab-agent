import { test, expect } from "bun:test";
import { PyodideFs } from "./pyfs";

// A tiny in-memory stand-in for Pyodide's Emscripten FS — just the surface
// PyodideFs touches. rename() raises EXDEV across top-level mounts, so the
// cross-mount mv fallback (copy + delete) can be exercised without Pyodide.
const DIR = 0o040000;
const FILE = 0o100000;

function norm(p: string): string {
  const parts: string[] = [];
  for (const s of p.split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") parts.pop();
    else parts.push(s);
  }
  return "/" + parts.join("/");
}
const parent = (p: string) => {
  const n = norm(p);
  const i = n.lastIndexOf("/");
  return i <= 0 ? "/" : n.slice(0, i);
};
const base = (p: string) => {
  const n = norm(p);
  return n.slice(n.lastIndexOf("/") + 1);
};

class MockFS {
  m = new Map<string, { mode: number; data?: Uint8Array }>();
  constructor() {
    this.m.set("/", { mode: DIR });
  }
  isFile(mode: number) { return (mode & 0o170000) === FILE; }
  isDir(mode: number) { return (mode & 0o170000) === DIR; }
  isLink(mode: number) { return (mode & 0o170000) === 0o120000; }
  analyzePath(p: string) { return { exists: this.m.has(norm(p)) }; }
  private node(p: string) {
    const n = this.m.get(norm(p));
    if (!n) throw { errno: 44 };
    return n;
  }
  stat(p: string) {
    const n = this.node(p);
    return { mode: n.mode, size: n.data ? n.data.length : 0, mtime: new Date(0) };
  }
  lstat(p: string) { return this.stat(p); }
  readFile(p: string, _opts?: any): Uint8Array {
    const n = this.node(p);
    if (!this.isFile(n.mode)) throw { errno: 31 };
    return n.data ?? new Uint8Array(0);
  }
  writeFile(p: string, bytes: Uint8Array) {
    if (!this.m.has(parent(p))) throw { errno: 44 };
    this.m.set(norm(p), { mode: FILE, data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes) });
  }
  mkdir(p: string) {
    if (this.m.has(norm(p))) throw { errno: 20 };
    if (!this.m.has(parent(p))) throw { errno: 44 };
    this.m.set(norm(p), { mode: DIR });
  }
  mkdirTree(p: string) {
    let cur = "";
    for (const s of norm(p).split("/").filter(Boolean)) {
      cur += "/" + s;
      if (!this.m.has(cur)) this.m.set(cur, { mode: DIR });
    }
  }
  readdir(p: string): string[] {
    const dir = norm(p);
    const out = [".", ".."];
    for (const k of this.m.keys()) if (k !== dir && parent(k) === dir) out.push(base(k));
    return out;
  }
  unlink(p: string) { this.m.delete(norm(p)); }
  rmdir(p: string) { this.m.delete(norm(p)); }
  rename(src: string, dst: string) {
    const s = norm(src);
    const d = norm(dst);
    if (s.split("/")[1] !== d.split("/")[1]) throw { errno: 75 }; // EXDEV across mounts
    for (const k of [...this.m.keys()]) {
      if (k === s || k.startsWith(s + "/")) {
        const v = this.m.get(k)!;
        this.m.delete(k);
        this.m.set(d + k.slice(s.length), v);
      }
    }
  }
  chmod() {}
}

const fresh = () => new PyodideFs(new MockFS() as any);

test("errno is mapped to a POSIX name in the message", async () => {
  const fs = fresh();
  expect(fs.readFile("/nope.txt")).rejects.toThrow(/ENOENT: open '\/nope\.txt'/);
  expect(fs.rm("/ghost")).rejects.toThrow(/ENOENT: rm '\/ghost'/);
});

test("cp of a file INTO an existing directory copies it under that dir", async () => {
  const fs = fresh();
  await fs.writeFile("/a.txt", "hello");
  await fs.mkdir("/d");
  await fs.cp("/a.txt", "/d");
  expect(await fs.exists("/d/a.txt")).toBe(true);
  expect(await fs.readFile("/d/a.txt")).toBe("hello");
  expect(await fs.exists("/a.txt")).toBe(true); // original stays
});

test("mv within one mount uses rename", async () => {
  const fs = fresh();
  await fs.mkdir("/scratch", { recursive: true });
  await fs.writeFile("/scratch/x", "1");
  await fs.mv("/scratch/x", "/scratch/y");
  expect(await fs.exists("/scratch/x")).toBe(false);
  expect(await fs.readFile("/scratch/y")).toBe("1");
});

test("mv across mounts falls back to copy + delete on EXDEV", async () => {
  const fs = fresh();
  await fs.mkdir("/scratch", { recursive: true });
  await fs.mkdir("/mnt/user", { recursive: true });
  await fs.writeFile("/scratch/f.txt", "data");
  await fs.mv("/scratch/f.txt", "/mnt/user/f.txt");
  expect(await fs.exists("/scratch/f.txt")).toBe(false);
  expect(await fs.exists("/mnt/user/f.txt")).toBe(true);
  expect(await fs.readFile("/mnt/user/f.txt")).toBe("data");
});

test("rm -r removes a directory tree; force swallows a missing path", async () => {
  const fs = fresh();
  await fs.mkdir("/scratch", { recursive: true });
  await fs.writeFile("/scratch/a", "1");
  await fs.rm("/scratch", { recursive: true });
  expect(await fs.exists("/scratch")).toBe(false);
  await fs.rm("/gone", { force: true }); // must not throw
});
