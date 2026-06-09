// In-tab CPython via Pyodide. This is the agent's main execution + real-file engine.
//
// Two mounts:
//   /scratch  -> OPFS (persists across reloads) — fast working dir
//   /mnt/user -> a folder the user picked via the File System Access API
//                (the user's REAL files; Chromium-only). The browser never
//                reveals the folder's real absolute path, so we use a fixed,
//                clearly-synthetic mount point rather than pretending.
//
// The shell (just-bash) runs on the SAME Emscripten filesystem via PyodideFs,
// so python_exec and shell see each other's files.
declare const loadPyodide: any;

let pyodide: any;
let scratchFs: any = null; // mountNativeFS handle for /scratch (OPFS)
const USER_PATH = "/mnt/user"; // fixed mount point for the user's folder
let userFs: any = null; // mountNativeFS handle for the user's folder, if mounted
let userName: string | null = null; // the folder's real name
let captured = "";

/** False when /scratch is memory-only (file:// blocks OPFS) — lost on reload. */
export let scratchPersists = true;

export const ready = (async () => {
  if ((window as any).__MOBILE__) return; // splash is up; skip the big downloads
  pyodide = await loadPyodide();
  pyodide.setStdout({ batched: (s: string) => (captured += s + "\n") });
  pyodide.setStderr({ batched: (s: string) => (captured += s + "\n") });

  // OPFS scratch dir. Chrome blocks OPFS on file:// origins (the double-clicked
  // HTML file case) — degrade to a plain in-memory /scratch so everything else
  // still works; it just won't survive a reload.
  try {
    const opfs = await navigator.storage.getDirectory();
    scratchFs = await pyodide.mountNativeFS("/scratch", opfs);
  } catch {
    scratchPersists = false;
    pyodide.FS.mkdirTree("/scratch");
  }
})();

/** The Emscripten FS — the one filesystem shared by python and the shell. */
export function getFS(): any {
  return pyodide.FS;
}

/** Flush in-memory writes back to OPFS and (if mounted) the user's real folder. */
export async function syncMounts() {
  if (scratchFs) await scratchFs.syncfs();
  if (userFs) await userFs.syncfs();
}

/** The current user-folder mount, or null if none shared yet. */
export function userMount(): { name: string; path: string } | null {
  return userFs ? { name: userName!, path: USER_PATH } : null;
}

/** Let the user grant access to a real local folder, mounted at /mnt/user. */
export async function mountUserFolder(): Promise<{ name: string; path: string }> {
  const dir = await (window as any).showDirectoryPicker({ mode: "readwrite" });
  await ready;
  if (userFs) {
    // Re-picking: flush and unmount the previous folder first.
    await userFs.syncfs();
    pyodide.FS.unmount(USER_PATH);
    userFs = null;
  } else if (!pyodide.FS.analyzePath(USER_PATH).exists) {
    pyodide.FS.mkdirTree(USER_PATH);
  }
  userFs = await pyodide.mountNativeFS(USER_PATH, dir);
  userName = dir.name;
  return { name: dir.name, path: USER_PATH };
}

/** Write a file into the mounted real folder, if one is mounted. Returns false if not. */
export async function writeUserFile(path: string, content: string): Promise<boolean> {
  await ready;
  if (!userFs) return false;
  pyodide.FS.writeFile(USER_PATH + "/" + path, content);
  await userFs.syncfs(); // persist to the real folder on disk
  return true;
}

/** Run Python, return whatever it printed. Flushes writes back to disk. */
export async function runPython(code: string): Promise<string> {
  await ready;
  captured = "";
  try {
    await pyodide.runPythonAsync(code);
  } catch (e) {
    captured += "\n[python error] " + (e as Error).message;
  }
  await syncMounts();
  return captured.trim() || "(no output)";
}
