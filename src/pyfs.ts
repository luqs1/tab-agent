// just-bash IFileSystem backed by Pyodide's Emscripten FS.
//
// This is what makes `shell` and `python_exec` share ONE world: both see
// /scratch (OPFS) and /mnt/user (the user's real folder) because both go
// through the same Emscripten filesystem. Emscripten's API is synchronous;
// the interface is async, so every method is a thin async wrapper.
import type { IFileSystem, FsStat, FileContent } from "just-bash/browser";

// Emscripten (wasi) errno values -> POSIX names, for readable command errors.
const ERRNO: Record<number, string> = {
  2: "ENOENT", 20: "EEXIST", 21: "ENOTDIR", 29: "EINVAL", 31: "EISDIR",
  44: "ENOENT", 54: "ENOTDIR", 55: "ENOTEMPTY", 63: "ENAMETOOLONG",
  73: "EBUSY", 75: "EXDEV",
};

// For glob expansion we walk everything under "/" EXCEPT Pyodide's own system
// dirs (/lib is the whole CPython stdlib). User folders mount at /<FolderName>,
// so an allowlist of roots would miss them.
const GLOB_SKIP = new Set(["dev", "proc", "lib", "usr", "etc", "sbin", "bin", "var", "sys", "share"]);
const GLOB_CAP = 50_000;

function rethrow(e: any, op: string, path: string): never {
  const code = typeof e?.errno === "number" ? ERRNO[e.errno] ?? `errno ${e.errno}` : null;
  if (code) throw new Error(`${code}: ${op} '${path}'`);
  throw e instanceof Error ? e : new Error(String(e));
}

function normalize(p: string): string {
  const abs = p.startsWith("/") ? p : "/" + p;
  const parts: string[] = [];
  for (const seg of abs.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}

function toBytes(content: FileContent, encoding?: string): Uint8Array {
  if (content instanceof Uint8Array) return content;
  switch (encoding) {
    case "base64": {
      const bin = atob(content);
      return Uint8Array.from(bin, (c) => c.charCodeAt(0));
    }
    case "hex": {
      const out = new Uint8Array(content.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(content.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    case "binary":
    case "latin1":
      return Uint8Array.from(content, (c) => c.charCodeAt(0) & 0xff);
    default:
      return new TextEncoder().encode(content);
  }
}

const enc = (o?: any): string | undefined => (typeof o === "string" ? o : o?.encoding ?? undefined);

export class PyodideFs implements IFileSystem {
  constructor(private FS: any) {}

  private toStat(s: any): FsStat {
    return {
      isFile: this.FS.isFile(s.mode),
      isDirectory: this.FS.isDir(s.mode),
      isSymbolicLink: this.FS.isLink(s.mode),
      mode: s.mode & 0o7777,
      size: s.size,
      mtime: s.mtime instanceof Date ? s.mtime : new Date(s.mtime),
    };
  }

  async readFile(path: string, options?: any): Promise<string> {
    try {
      const bytes: Uint8Array = this.FS.readFile(path, { encoding: "binary" });
      const e = enc(options);
      if (e === "binary" || e === "latin1" || e === "ascii")
        return Array.from(bytes, (b) => String.fromCharCode(e === "ascii" ? b & 0x7f : b)).join("");
      if (e === "base64") return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
      if (e === "hex") return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return new TextDecoder().decode(bytes);
    } catch (e) {
      rethrow(e, "open", path);
    }
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    try {
      return this.FS.readFile(path, { encoding: "binary" });
    } catch (e) {
      rethrow(e, "open", path);
    }
  }

  async writeFile(path: string, content: FileContent, options?: any): Promise<void> {
    try {
      this.FS.writeFile(path, toBytes(content, enc(options)));
    } catch (e) {
      rethrow(e, "open", path);
    }
  }

  async appendFile(path: string, content: FileContent, options?: any): Promise<void> {
    const add = toBytes(content, enc(options));
    let prev: Uint8Array = new Uint8Array(0);
    if (await this.exists(path)) prev = await this.readFileBuffer(path);
    const merged = new Uint8Array(prev.length + add.length);
    merged.set(prev);
    merged.set(add, prev.length);
    await this.writeFile(path, merged);
  }

  async exists(path: string): Promise<boolean> {
    return this.FS.analyzePath(path).exists;
  }

  async stat(path: string): Promise<FsStat> {
    try {
      return this.toStat(this.FS.stat(path));
    } catch (e) {
      rethrow(e, "stat", path);
    }
  }

  async lstat(path: string): Promise<FsStat> {
    try {
      return this.toStat(this.FS.lstat(path));
    } catch (e) {
      rethrow(e, "lstat", path);
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    try {
      if (options?.recursive) this.FS.mkdirTree(path);
      else this.FS.mkdir(path);
    } catch (e) {
      rethrow(e, "mkdir", path);
    }
  }

  async readdir(path: string): Promise<string[]> {
    try {
      return this.FS.readdir(path).filter((n: string) => n !== "." && n !== "..");
    } catch (e) {
      rethrow(e, "scandir", path);
    }
  }

  async readdirWithFileTypes(path: string) {
    const names = await this.readdir(path);
    return names.map((name) => {
      try {
        const s = this.FS.lstat(path.replace(/\/$/, "") + "/" + name);
        return {
          name,
          isFile: this.FS.isFile(s.mode),
          isDirectory: this.FS.isDir(s.mode),
          isSymbolicLink: this.FS.isLink(s.mode),
        };
      } catch {
        return { name, isFile: false, isDirectory: false, isSymbolicLink: false };
      }
    });
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const there = await this.exists(path);
    if (!there) {
      if (options?.force) return;
      rethrow({ errno: 44 }, "rm", path);
    }
    const s = await this.lstat(path);
    try {
      if (s.isDirectory) {
        if (options?.recursive)
          for (const child of await this.readdir(path)) await this.rm(path + "/" + child, options);
        this.FS.rmdir(path);
      } else {
        this.FS.unlink(path);
      }
    } catch (e) {
      rethrow(e, "rm", path);
    }
  }

  async cp(src: string, dest: string, options?: { recursive?: boolean }): Promise<void> {
    const s = await this.stat(src);
    if (s.isDirectory) {
      if (!options?.recursive) throw new Error(`EISDIR: cp '${src}' is a directory (use -r)`);
      // cp dir into an existing dir copies *under* it, like real cp.
      let target = dest;
      if (await this.exists(dest)) {
        const d = await this.stat(dest);
        if (d.isDirectory) target = dest.replace(/\/$/, "") + "/" + src.split("/").filter(Boolean).pop();
      }
      await this.mkdir(target, { recursive: true });
      for (const child of await this.readdir(src))
        await this.cp(src + "/" + child, target + "/" + child, options);
    } else {
      let target = dest;
      if (await this.exists(dest)) {
        const d = await this.stat(dest);
        if (d.isDirectory) target = dest.replace(/\/$/, "") + "/" + src.split("/").filter(Boolean).pop();
      }
      this.FS.writeFile(target, await this.readFileBuffer(src));
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    let target = dest;
    if (await this.exists(dest)) {
      const d = await this.stat(dest);
      if (d.isDirectory) target = dest.replace(/\/$/, "") + "/" + src.split("/").filter(Boolean).pop();
    }
    try {
      this.FS.rename(src, target);
    } catch {
      // Cross-mount rename (e.g. /scratch -> /mnt/user) raises EXDEV: copy+delete.
      await this.cp(src, target, { recursive: true });
      await this.rm(src, { recursive: true, force: true });
    }
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith("/")) return normalize(path);
    return normalize(base.replace(/\/$/, "") + "/" + path);
  }

  getAllPaths(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      if (out.length >= GLOB_CAP) return;
      let names: string[];
      try {
        names = this.FS.readdir(dir).filter((n: string) => n !== "." && n !== "..");
      } catch {
        return;
      }
      for (const name of names) {
        const p = (dir === "/" ? "" : dir) + "/" + name;
        out.push(p);
        try {
          if (this.FS.isDir(this.FS.lstat(p).mode)) walk(p);
        } catch {}
      }
    };
    let roots: string[] = [];
    try {
      roots = this.FS.readdir("/").filter((n: string) => n !== "." && n !== ".." && !GLOB_SKIP.has(n));
    } catch {}
    for (const name of roots) {
      const root = "/" + name;
      out.push(root);
      try {
        if (this.FS.isDir(this.FS.lstat(root).mode)) walk(root);
      } catch {}
    }
    return out;
  }

  async chmod(path: string, mode: number): Promise<void> {
    try {
      this.FS.chmod(path, mode);
    } catch (e) {
      rethrow(e, "chmod", path);
    }
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    try {
      this.FS.symlink(target, linkPath);
    } catch (e) {
      rethrow(e, "symlink", linkPath);
    }
  }

  async link(_existingPath: string, _newPath: string): Promise<void> {
    throw new Error("EPERM: hard links are not supported in the browser filesystem");
  }

  async readlink(path: string): Promise<string> {
    try {
      return this.FS.readlink(path);
    } catch (e) {
      rethrow(e, "readlink", path);
    }
  }

  async realpath(path: string): Promise<string> {
    try {
      return this.FS.lookupPath(path, { follow: true }).path;
    } catch (e) {
      rethrow(e, "realpath", path);
    }
  }

  async utimes(path: string, _atime: Date, mtime: Date): Promise<void> {
    try {
      this.FS.utime(path, mtime.getTime(), mtime.getTime());
    } catch (e) {
      rethrow(e, "utimes", path);
    }
  }
}
