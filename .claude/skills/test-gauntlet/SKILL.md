---
name: test-gauntlet
description: Use when end-to-end testing tab-agent's real agent loop (LLM + tool calls) with an OpenRouter key — release smoke tests, or after changes to agent.ts, pyenv, shell, streaming, or model fallback.
---

# The validation gauntlet (real LLM, real tools)

End-to-end proof of the risky pieces, adapted from the README. **Requires an OpenRouter key.**

## Key sourcing — in order

1. `$OPENROUTER_API_KEY` env var, if set.
2. Ask the user. **Never** commit, echo, or log the key.

Seed it before testing (isolated browser context, then):

```js
localStorage.setItem("tab-agent.openrouter_key", KEY); location.reload();
```

Serve + browser driving: same as the `test-ui` skill (dev server on a free port, Chrome DevTools MCP, isolated context).

## The gauntlet

Send each message in `#msg`; wait for the turn to finish before judging.

| # | Send | Proves | Pass |
|---|---|---|---|
| 1 | `print 2+2 in python` | agent loop + Pyodide + LLM | A `.msg.agent` (or activity detail) showing the answer 4 |
| 2 | `list the files in /scratch` | OPFS mount | A listing (possibly empty) — not an error |
| 3 | `create haiku.md in /scratch with a haiku about tabs` | tool writes + syncfs | Then `await window.__tabagent.runShell("cat /scratch/haiku.md")` returns the haiku |
| 4 | `using your shell tool, count the lines in /scratch/haiku.md` | shell tool + shared FS | A count consistent with step 3 |
| 5 | (optional, ⚙/📦) connect `https://mcp.deepwiki.com/mcp`, then ask something needing it | remote MCP + CORS | "Extra tools connected" note, then a tool-using answer |

The README's folder-share step needs a native picker — not automatable; use the `/scratch` variants above.

## Free-tier patience rules

- Allow **up to ~90s per turn**. Free models rate-limit constantly.
- "Giving it another try…" and "switching to a backup model…" notes are **normal fallback churn**, not failures.
- A turn is a FAIL only if it ends in an error card (`.oops`) or produces nothing relevant.
- Models vary: judge that the work happened (file exists, answer correct), not the phrasing.

## Verify outcomes out-of-band

Don't trust chat prose — check the filesystem via the debug handle:

```js
await window.__tabagent.runShell("ls -la /scratch && cat /scratch/haiku.md")
```

## Cleanup

```js
localStorage.removeItem("tab-agent.openrouter_key")
```

and delete any files the run created (`rm /scratch/haiku.md` via the handle). Report each gauntlet step as pass/fail/skipped with evidence.
