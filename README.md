# tab.agent

An agent that runs **entirely in a browser tab — no backend.** The whole app is
static JS/WASM; nothing runs on a server. The user brings a free OpenRouter key
(stored in `localStorage`) and the browser calls OpenRouter directly.

The UI is a warm, plain-language chat designed for **non-technical users** — no
terminal anywhere. Code and commands run behind friendly activity lines with a
"show the details" fold; the dot in the `tab.agent` wordmark is the status light
(amber = thinking, green = ready).

- **Model**: remote **free** models via OpenRouter (`:free`, no per-token charge), called **directly from the browser** (OpenRouter sends permissive CORS — no proxy needed)
- **Execution**: in-tab CPython (Pyodide) + a bash-like shell (`just-bash`)
- **Files**: the user's *real* folder via the File System Access API, mounted into Pyodide; OPFS as a fast scratch dir
- **Tools**: remote MCP servers over Streamable HTTP
- **Skills**: markdown under `skills/` injected into the prompt

This is a **de-risking sketch**: the goal is to prove the hard integrations work
end-to-end, not to be a finished product.

## No backend — really

The only "server" anywhere is **dumb static file delivery** (handing the browser
an HTML file). All agent logic — the loop, tool execution, filesystem, MCP, the
LLM call — runs in the tab. The key is entered in the UI and never leaves the
browser except in the direct request to OpenRouter.

## Run it

```bash
bun install
bun run dev          # -> http://localhost:5173  (Vite dev server = hot-reload, still no app backend)
```

Open in **Chrome or Edge**, paste a free key from https://openrouter.ai/keys into
the **OpenRouter key** field, click **Save key**, and go.

### Ship it as one file

```bash
bun run build        # -> dist/index.html  (the ENTIRE app inlined into one file)
```

Host that single file on anything static: **GitHub Pages**, S3, or locally with
`python3 -m http.server -d dist`. No server logic, no env, no secrets.

### Share it / run it locally

The app can hand itself out: **"Save a copy of me"** (footer) downloads the
running single file as `tab.agent.html`. Double-clicking that file works —
verified: Chrome blocks OPFS on `file://`, so `/scratch` degrades to in-memory
(a note says it won't survive reloads), but everything else — the LLM call,
folder sharing (FSA is available on `file://`), shell, python — works. For
persistent scratch, serve it over any static HTTP instead
(`python3 -m http.server -d dist`).

## Workflows in a link

Instructions (an install.md, a repeatable chore) can ride inside the URL
**fragment**: `…/#wf=<base64url(deflate-raw(JSON{v,t,i}))>` (`src/wf.ts`). The
fragment never leaves the browser — it's not sent in any request, so even the
hosted copy can't see it — and the same link works on a `file://` copy.

- `{{name}}` placeholders become input fields the recipient fills in.
- **Nothing auto-runs.** A consent card shows the exact instructions with a
  Run / No thanks choice; the hash is scrubbed after handling.
- Ask the agent to "turn this into a shareable link" — the `make_workflow_link`
  tool mints one (the sample skill compresses to ~250 URL chars; ~10k chars,
  i.e. ~15–25 KB of markdown, stays shareable in every chat app).

## System actions: the click-to-run installer

The sandbox can't install software or run native tools. So when a task needs that,
the agent calls `write_installer` and emits a **click-only** installer — no terminal,
no typing, no `chmod`:

1. A `.zip` downloads. The browser can't set a file's executable bit, but a **zip
   stores the Unix mode**, and macOS restores it on unzip. So the zip carries a
   `setup.command` with mode `0755` (`src/zip.ts`, a tiny dependency-free zip writer
   — verified end-to-end: `ditto`-extracted file is `-rwxr-xr-x` and runs with no chmod).
2. Double-click the `.zip` → double-click `setup.command` → it runs.
3. macOS shows an "unidentified developer" prompt; right-click → Open → Open is the
   user *authorizing* it. (Notarizing with an Apple Developer cert removes the prompt.)

This relocates the one unavoidable native step into a single, all-clicks, user-blessed
action. A persistent signed companion app (for live system access without per-task
files) is the heavier future option — see issue #2.

## The validation gauntlet

Run these in order — each proves one risky piece:

1. **"print 2+2 in python"** → agent loop + Pyodide + direct OpenRouter call all work.
2. **"list the files in /scratch"** → OPFS works.
3. Click **Share a folder**, then **"read every file in /mnt/user and summarize"** → the killer feature: agent on your *real* local files.
4. **"create haiku.md in my folder with a haiku about tabs"** → reload, check the file is on disk → write + `syncfs` works.
5. Set `VITE_MCP_URL` to a real server, ask something needing its tool → MCP path + the CORS reality.

## Architecture

```
BROWSER TAB (the entire app — no backend)
  Chat UI ─► Agent loop (src/agent.ts)
               ├─ LLM ──► fetch() ──► OpenRouter (free models, direct, CORS-ok)
               │           key from localStorage (src/settings.ts)
               └─ tools
                    ├─ python_exec ─► Pyodide (src/pyenv.ts)
                    │     /mnt/user ◄─ your real folder (FSA, async, Chromium)
                    │     /scratch  ◄─ OPFS (sync, all browsers)
                    ├─ shell ──────► just-bash (src/shell.ts)
                    └─ mcp__* ─────► remote MCP (src/mcp.ts)
```

## Known sketch-stage gaps (deliberate)

- **No streaming** — responses arrive in full per turn.
- **Skills are eagerly loaded** into every prompt. Real harnesses lazy-load by
  description (progressive disclosure). See `src/skills.ts`.
- **The key sits in `localStorage` and is sent directly to OpenRouter.** Fine for
  a personal tool / bring-your-own-key. Each user uses their own key, so there's
  no shared rate limit and no one gets charged for anyone else.
- **Free-model tool calling is uneven** — quality/reliability varies by model,
  and free models get rate-limited (429) when congested. The agent retries once
  and then falls through `FALLBACK_MODELS` (src/settings.ts); default is
  `z-ai/glm-4.5-air:free`.
- `node:zlib` is stubbed (`src/shims/zlib.ts`); `just-bash`'s gzip commands are
  no-ops in the browser (as it documents). Wire `fflate` if you need them.
- Firefox/Safari: OPFS works, but **Share a folder** (FSA) does not.

## On-device AI (no account at all)

Besides OpenRouter, the onboarding card offers **"Run the AI on this computer"**:
WebLLM (`@mlc-ai/web-llm`, loaded from CDN only when chosen) runs the model on the
user's GPU via WebGPU, speaking the same OpenAI chat-completions format — including
structured `tool_calls` — so the agent loop is provider-agnostic (`src/local.ts`).
Weights download once (~4–5 GB) and are cached by the browser.

Hard-won constraints (all verified live):

- **Only Hermes models can do native tool calls** in WebLLM 0.2.84
  (Hermes-2-Pro 7/8B, Hermes-3-Llama-3.1-8B). Smaller models chat but can't
  act — they'll *claim* they wrote files. The curated list is Hermes-only.
- **No custom system prompt with `tools`** — WebLLM injects its own Hermes-format
  one. Our instructions are folded into the first user message instead.
- Assistant tool-call turns must have **string content** (OpenAI sends `null`).
- The gemma3 prebuilt record in 0.2.84 is broken (context/sliding-window clash),
  and overriding it produces degenerate output — gemma stays off the list.
- 8B-q4 models still misfire (bash into python_exec, repeated failing calls);
  the loop nudges with a "you already tried exactly this" note on repeats.

## Shared filesystem (shell ⇄ python)

`shell` and `python_exec` see the SAME files: just-bash runs on an `IFileSystem`
implemented over Pyodide's Emscripten FS (`src/pyfs.ts`). Both tools share
`/scratch` (OPFS, persists across reloads) and `/mnt/user` (the user's real
folder), and every tool run flushes writes back to disk via `syncfs`.
