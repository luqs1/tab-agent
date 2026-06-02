---
name: example-skill
description: Demonstrates how a skill is injected into the agent's prompt.
---

# Example skill

When the user asks you to "summarize a folder", do this:

1. Use the `shell` tool: `ls -la /mnt/user` to see the files.
2. For each text-ish file, use `python_exec` to read it and extract the first line.
3. Report a short bullet list: filename → first line.

Keep it to one paragraph plus the bullets.
