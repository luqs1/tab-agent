// Mint #wf= workflow links (same encoding as src/wf.ts). Run: bun scripts/make-links.ts
import { deflateRawSync } from "node:zlib";

const BASE = "https://luqs1.github.io/tab-agent/";

const link = (t: string, i: string) =>
  BASE + "#wf=" + deflateRawSync(JSON.stringify({ v: 1, t, i })).toString("base64url");

const workflows: Record<string, [string, string]> = {
  brew: [
    "Install Homebrew",
    `# Install Homebrew

The user wants Homebrew (the macOS package manager) installed.

1. Briefly explain what's about to happen: you'll hand them a one-time setup file that installs Homebrew, and nothing runs until they open it themselves.
2. Call write_installer with name "install-homebrew" and exactly this script:

if command -v brew >/dev/null 2>&1; then
  echo "Homebrew is already installed: $(brew --version | head -1)"
else
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

3. Relay the click-by-click run instructions simply, and reassure them that the macOS "unidentified developer" prompt is expected — right-click → Open is how they authorize it.`,
  ],
  opencode: [
    "Install opencode",
    `# Install opencode

The user wants opencode (https://opencode.ai — a coding agent for the terminal) installed.

1. Briefly explain: a one-time setup file installs it; nothing runs until they open the file themselves.
2. Call write_installer with name "install-opencode" and exactly this script:

if command -v opencode >/dev/null 2>&1; then
  echo "opencode is already installed."
else
  curl -fsSL https://opencode.ai/install | bash
fi

3. Relay the click-by-click run instructions simply, reassure them about the macOS security prompt, and finish by telling them: open the Terminal app and type opencode to start it.`,
  ],
  clonerepo: [
    "Clone a public GitHub repo",
    `# Clone a public GitHub repo

Copy this public GitHub repository into a local folder:

{{repository (owner/name or github.com link)}}

1. Derive OWNER/NAME from the input (strip any https://github.com/ prefix, .git suffix, or extra path).
2. Using python_exec (from pyodide.http import pyfetch; r = await pyfetch(url); data = await r.bytes()):
   - GET https://api.github.com/repos/OWNER/NAME and read default_branch. On 404, explain that only public repos work here and stop. On 403, GitHub is rate-limiting — say so and suggest trying again later.
   - GET https://api.github.com/repos/OWNER/NAME/git/trees/BRANCH?recursive=1 — entries with type "blob" are the files. If "truncated" is true, warn that the repo is too large to copy fully and stop.
   - If there are more than 300 files, ask the user before continuing.
   - Destination: the user's shared folder /NAME if one is shared, otherwise /scratch/NAME. Create subdirectories as needed.
   - Fetch each blob from https://raw.githubusercontent.com/OWNER/NAME/BRANCH/PATH as BYTES (files may be binary) and write it under the destination.
   IMPORTANT: do NOT attempt git, zip/codeload downloads, or github.com page fetches — the browser blocks them (CORS). The api.github.com + raw.githubusercontent.com pair above is the only route that works.
3. Finish by telling the user where the files landed, how many were copied, and that this is a snapshot of the latest BRANCH — the git history itself doesn't come along.`,
  ],
  drawio: [
    "Turn a description into a draw.io diagram",
    `# Make a draw.io diagram

Create a diagram from this description:

{{what should the diagram show?}}

1. Work out the boxes and the arrows between them from the description.
2. Using python_exec, write a valid draw.io file: an <mxfile> containing one <diagram> with an <mxGraphModel><root>. Include the two required cells (id "0", and id "1" with parent "0"). Add each box as an mxCell vertex="1" parent="1" with style "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" and an mxGeometry (width 160, height 60, as="geometry"), laid out left-to-right / top-to-bottom with ~80px gaps. Add each arrow as an mxCell edge="1" parent="1" with source/target ids and style "edgeStyle=orthogonalEdgeStyle;rounded=1;" plus <mxGeometry relative="1" as="geometry"/>.
3. Save it as diagram.drawio in the user's shared folder if one is shared, otherwise in /scratch.
4. Tell the user where the file is and that it opens at https://app.diagrams.net (File → Open From → Device). Keep the explanation to two sentences.`,
  ],
};

for (const [key, [t, i]] of Object.entries(workflows)) {
  const url = link(t, i);
  console.log(`### ${key} (${url.length} chars)\n${url}\n`);
}
