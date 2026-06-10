// "Installer hand-off": the sandbox can't mutate the host system, so the agent
// generates a script the user runs once. To make it CLICK-ONLY (no terminal
// typing, no chmod), we ship it inside a .zip that carries the executable bit
// (see zip.ts — verified that macOS restores the +x on double-click extract).
//
// Flow for the user: double-click the .zip -> double-click setup.command -> it
// runs (a Gatekeeper "unidentified developer" prompt appears; clicking Open is
// the authorization). Notarizing later removes that prompt.
import { zipWithMode } from "./zip";
import { confirmInstaller } from "./ui";

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Emit a click-to-run installer the user executes once. Returns plain instructions. */
export async function writeInstaller(name: string, script: string): Promise<string> {
  const base = name.replace(/\.(command|sh|zip)$/i, "") || "setup";
  const command = `${base}.command`;
  const body = script.startsWith("#!")
    ? script
    : `#!/bin/bash\nset -euo pipefail\n\n${script}\n\necho\necho "✅ Done. You can close this window."\n`;

  // Explicit consent: the user must see the full script and approve before any
  // .zip is produced (file/MCP content steering the model is the threat here).
  if (!(await confirmInstaller(command, body)))
    return "The user reviewed the installer and chose not to download it. Don't retry unless they ask.";

  download(`${base}.zip`, zipWithMode(command, body));

  return [
    `Created "${base}.zip" (in your Downloads).`,
    ``,
    `To run it — all clicks, no typing:`,
    `  1. Double-click "${base}.zip" to unzip it.`,
    `  2. Double-click "${command}".`,
    `  3. If macOS warns it's from an unidentified developer: right-click it →`,
    `     Open → Open. (That's you authorizing it.)`,
    ``,
    `It runs the steps that need your permission, shows progress, then finishes.`,
  ].join("\n");
}
