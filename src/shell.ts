// A bash-like shell veneer via just-bash (pure TS, runs in-tab, no wasm weight).
// Good for grep/sed/awk/cat/ls pipelines and skill scripts that assume a shell.
//
// IMPORTANT (sketch-stage limitation): just-bash has its OWN in-memory filesystem,
// which is SEPARATE from Pyodide's /mnt/user and /scratch. So `shell` and
// `python_exec` don't see each other's files yet.
//
// The clean fix later: implement just-bash's `IFileSystem` interface (or use its
// `MountableFs`) backed by OPFS / the FSA directory handle, and mount the SAME
// backing store that Pyodide uses. Then both tools share one filesystem.
//   see: import { MountableFs, InMemoryFs } from "just-bash/browser"
import { Bash } from "just-bash/browser";

// One persistent shell so state (cwd, env, files) survives across calls.
const bash = new Bash({
  files: {
    "/work/readme.txt": "tab-agent shell is alive.\nedit me, grep me, pipe me.\n",
  },
  cwd: "/work",
  // network/python/js are off by default — enable explicitly when you need them.
});

export async function runShell(command: string): Promise<string> {
  const { stdout, stderr, exitCode } = await bash.exec(command);
  let out = stdout;
  if (stderr) out += (out ? "\n" : "") + stderr;
  if (exitCode !== 0) out += `\n[exit ${exitCode}]`;
  return out.trim() || "(no output)";
}
