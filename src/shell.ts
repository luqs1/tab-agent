// A bash-like shell veneer via just-bash (pure TS, runs in-tab, no wasm weight).
// Good for grep/sed/awk/cat/ls pipelines and skill scripts that assume a shell.
//
// The shell runs on Pyodide's Emscripten filesystem (see pyfs.ts), so `shell`
// and `python_exec` share one world: /scratch (OPFS) and /mnt/user (the user's
// real folder) are visible to both, and writes from either persist to disk.
import { Bash } from "just-bash/browser";
import { PyodideFs } from "./pyfs";
import { ready, getFS, syncMounts } from "./pyenv";

// One persistent shell so state (cwd, env) survives across calls. Created
// lazily because it needs Pyodide's FS to exist first.
let bash: Bash | null = null;

function ensureBash(): Bash {
  if (!bash) {
    bash = new Bash({
      fs: new PyodideFs(getFS()),
      cwd: "/scratch",
      env: { HOME: "/scratch" },
      // network/python/js are off by default — enable explicitly when you need them.
    });
  }
  return bash;
}

// just-bash resets its cwd after every exec(), so we keep our own and pass it
// per call. Starts in /scratch; moves to the user's folder when one is shared.
let cwd = "/scratch";

/** Point the shell at a directory (used when the user shares a folder). */
export async function shellCd(path: string) {
  cwd = path;
}

export async function runShell(command: string): Promise<string> {
  await ready;
  const { stdout, stderr, exitCode } = await ensureBash().exec(command, { cwd });
  await syncMounts(); // persist any writes to OPFS / the real folder
  let out = stdout;
  if (stderr) out += (out ? "\n" : "") + stderr;
  if (exitCode !== 0) out += `\n[exit ${exitCode}]`;
  return out.trim() || "(no output)";
}
