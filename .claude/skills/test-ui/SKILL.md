---
name: test-ui
description: Use when smoke-testing the tab-agent UI in a real browser WITHOUT an OpenRouter key — after UI/onboarding/settings changes, or to verify the app boots, chats gracefully keyless, and the in-tab sandbox works.
---

# Browser smoke test (no API key)

Verifies what a first-time user sees, plus the in-tab execution engine — none of it needs an LLM key.

## Serve — pick by purpose

- Testing a branch / source changes (default): `bun run dev -- --port 5199` (pick a free port; 5173 is often taken)
- Verifying the production artifact: `bun run build && python3 -m http.server 4173 -d dist`

## Drive the browser

Load the Chrome DevTools MCP tools, then use an **isolated browser context** (guaranteed-empty localStorage = true first run):

```
ToolSearch "select:mcp__plugin_chrome-devtools-mcp_chrome-devtools__new_page,...navigate_page,...take_snapshot,...evaluate_script,...click,...fill,...press_key,...list_console_messages,...take_screenshot,...close_page"
```

Verify rendering with a screenshot at least once — the a11y snapshot alone misses visual breakage.

## DOM reference

| Selector | Meaning |
|---|---|
| `.msg.agent` / `.msg.user` | agent / user chat bubbles |
| `.note` | soft system line (nudges, "Connected!", progress) |
| `.oops` | error card (friendly errors render HERE, not in `.msg`) |
| `.doing` | tool-activity chip with "show details" fold |
| `#onboard` `#settings` `#msg` `#send` `#dot` `#key` `#savekey` | card, ⚙, composer, send, status dot, key input, connect |

## Checklist (run in this order)

| # | Action | Pass |
|---|---|---|
| 1 | Open the page fresh | Welcome bubble (`.msg.agent`), `#onboard` visible ("One quick thing…"), `#dot` reaches class `ready` within 60s (Pyodide booted) |
| 2 | Type in `#msg`, press Enter, no key | A `.note` appears: "First I need that free key…" — no crash |
| 3 | Click `#settings` (⚙) twice | **Pass criterion depends on branch** — read `onClick("settings", …)` in `src/main.ts` first. Re-open semantics (`showOnboard(true)`): card visible after both clicks. Toggle semantics (split branches): first click hides the already-open card, second shows it |
| 4 | Click `#library-btn` (📦) — only exists on settings-split branches | "Tools & workflows" card with MCP url/token inputs. Skip silently on `main` |
| 5 | Sandbox, keyless | `await window.__tabagent.runShell("echo hi")` via evaluate_script returns exactly `"hi"`. (Shell only — `python3` is NOT a shell binary in the sandbox; Python runs via the LLM's python_exec tool, covered by `test-gauntlet`) |
| 6 | Console check | `list_console_messages` — only the expected noise for your serve mode (below) |
| 7 | Fake-key connected state (LAST — it dirties the console) | Seed `localStorage["tab-agent.openrouter_key"]="sk-or-fake"`, reload → onboarding hidden. Send a message → a network 401 plus a `.oops` card reading "That key didn't work — open ⚙ and check it was pasted in full." The 401 console error is expected here |

## State setup (localStorage)

| Key | Meaning |
|---|---|
| `tab-agent.openrouter_key` | OpenRouter key ("" = first run) |
| `tab-agent.provider` | `openrouter` (default) or `local` |
| `tab-agent.model` | model override ("" = free default) |
| `tab-agent.mcp_servers` | JSON array `[{url, token?}]` |
| `tab-agent.recent_workflows` | JSON array of past workflows |

## Expected console noise (do NOT report as findings)

Both serve modes: `SharedArrayBuffer … cross-origin isolation` (no COOP/COEP headers; Pyodide falls back fine), a "deprecated feature" notice, `[verbose]` "Password field is not contained in a form".
Dev server adds: vite `[debug]` connect messages.
Static `http.server` adds: `favicon.ico` 404.
After step 7 only: one `401` resource error.

## Known behavior (not bugs)

- Connect accepts any non-empty key without validating against OpenRouter; failure surfaces on first send. Known/deliberate.
- The onboarding card IS the settings card (one element; on split branches it has two modes).

## Cannot be automated (skip, list as untested)

Native pickers (📁 share folder, 📎 upload), 🎤 dictation, on-device WebLLM (multi-GB download), "Save a copy of me". The real agent loop needs a key — that's the `test-gauntlet` skill.
