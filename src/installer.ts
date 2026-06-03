// "Installer hand-off": the sandbox can't mutate the host system (install software,
// run native tools), so instead the agent GENERATES a script the user runs once.
// The browser writes the file; the user authorizes it by running it. This relocates
// the one unavoidable native step into a single, friendly, user-blessed action.
//
// macOS reality (deliberate OS security, not a bug we can patch):
//  - the browser CANNOT set the executable bit, so we tell the user to run it with
//    `sh <file>` (which needs no chmod), the simplest no-terminal-skill path;
//  - browser-written files are quarantined, so a Gatekeeper prompt may appear —
//    that prompt IS the "authorize" gesture. Warning-free needs Apple code-signing.
import { writeUserFile } from "./pyenv";

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/x-shellscript" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Emit a runnable installer the user can execute once. Downloads it (lands in
 * ~/Downloads) and also writes it into the mounted folder if one is mounted.
 */
export async function writeInstaller(name: string, script: string): Promise<string> {
  const file = name.endsWith(".command") || name.endsWith(".sh") ? name : `${name}.command`;
  const body = script.startsWith("#!")
    ? script
    : `#!/bin/bash\nset -euo pipefail\n\n${script}\n\necho\necho "✅ Done. You can close this window."\n`;

  download(file, body);

  let alsoMounted = "";
  try {
    if (await writeUserFile(file, body)) alsoMounted = " (also saved into your mounted folder)";
  } catch {
    /* no folder mounted — the download is enough */
  }

  return [
    `Created installer "${file}"${alsoMounted}.`,
    ``,
    `To run it (no terminal skills needed):`,
    `  1. Open the Terminal app (Spotlight → type "Terminal" → Enter).`,
    `  2. Paste this and press Enter:`,
    `       sh ~/Downloads/${file}`,
    `  3. Approve any macOS security prompt.`,
    ``,
    `It will run the steps it needs system permission for, then exit.`,
  ].join("\n");
}
