---
name: get-started
description: Help a non-technical person set up a local coding agent (e.g. Claude Code) without needing terminal skills.
---

# Get started with a local agent

Use this when someone says they want to "set up an agent", "install Claude Code",
or similar, and they are NOT comfortable with the terminal.

Principles:
- Assume they don't know what a terminal is. Don't make them type commands by hand.
- You cannot install software from the sandbox. So generate the installer for them.

Steps:

1. Briefly confirm what they want (e.g. "Claude Code, a coding agent that runs in
   your terminal"). One sentence, friendly, no jargon.

2. Call `write_installer` with a minimal, idempotent script. Example for Claude Code
   on macOS (installs Homebrew if missing, then Node, then the CLI):

   ```bash
   if ! command -v brew >/dev/null 2>&1; then
     /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   fi
   brew install node
   npm install -g @anthropic-ai/claude-code
   echo "Now run:  claude"
   ```

3. Tell them, in plain language: a file was downloaded, and exactly how to run it
   (the tool's output already spells out the `sh ~/Downloads/...` steps — relay them
   simply and encouragingly). Reassure them the macOS prompt is normal.

Keep the whole interaction calm and short. They are nervous; you are the easy button.
