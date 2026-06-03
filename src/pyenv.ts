// In-tab CPython via Pyodide. This is the agent's main execution + real-file engine.
//
// Two mounts:
//   /scratch  -> OPFS  (sync, works in every browser) — fast working dir
//   /mnt/user -> a folder the user picked via the File System Access API
//                (the user's REAL files; Chromium-only; async)
import { log, status } from "./ui";

declare const loadPyodide: any;

let pyodide: any;
let userFs: any = null; // the mountNativeFS handle for /mnt/user, if mounted
let captured = "";

export const ready = (async () => {
  status("loading pyodide…");
  pyodide = await loadPyodide();
  pyodide.setStdout({ batched: (s: string) => (captured += s + "\n") });
  pyodide.setStderr({ batched: (s: string) => (captured += s + "\n") });

  // OPFS scratch dir — always available.
  const opfs = await navigator.storage.getDirectory();
  await pyodide.mountNativeFS("/scratch", opfs);

  status("ready");
  log("✅ pyodide ready · /scratch mounted (OPFS)");
})();

/** Let the user grant access to a real local folder, mounted at /mnt/user. */
export async function mountUserFolder() {
  const dir = await (window as any).showDirectoryPicker({ mode: "readwrite" });
  await ready;
  userFs = await pyodide.mountNativeFS("/mnt/user", dir);
  log(`✅ mounted "${dir.name}" at /mnt/user`);
}

/** Write a file into the mounted real folder, if one is mounted. Returns false if not. */
export async function writeUserFile(path: string, content: string): Promise<boolean> {
  await ready;
  if (!userFs) return false;
  pyodide.FS.writeFile("/mnt/user/" + path, content);
  await userFs.syncfs(); // persist to the real folder on disk
  return true;
}

/** Run Python, return whatever it printed. Flushes writes back to the real folder. */
export async function runPython(code: string): Promise<string> {
  await ready;
  captured = "";
  try {
    await pyodide.runPythonAsync(code);
  } catch (e) {
    captured += "\n[python error] " + (e as Error).message;
  }
  if (userFs) await userFs.syncfs(); // persist any writes to /mnt/user back to disk
  return captured.trim() || "(no output)";
}
