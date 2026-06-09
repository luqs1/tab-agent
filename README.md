# tab.agent

Live: https://luqs1.github.io/tab-agent/

An agent that runs entirely in a browser tab. No backend — the whole app is
static JS/WASM. Bring a free OpenRouter key (stored in `localStorage`, sent
only to OpenRouter), or run the model on your own GPU.

The UI is a plain-language chat aimed at non-technical users. Code and commands
run behind activity lines with a "show the details" fold; the dot in the
wordmark is the status light (amber = thinking, green = ready).

- **Model**: free OpenRouter models, called directly from the browser (CORS-ok,
  no proxy), or on-device via WebLLM (Hermes 7/8B, WebGPU)
- **Execution**: in-tab CPython (Pyodide) + a bash-like shell (just-bash), one
  shared filesystem
- **Files**: a real local folder via the File System Access API; OPFS scratch dir
- **Voice**: local dictation, Parakeet TDT 0.6B v3 (onnxruntime-web)
- **Sharing**: workflows encoded in the URL fragment; the app downloads itself
  as a single file
- **Tools**: remote MCP servers over Streamable HTTP
- **Skills**: markdown under `skills/` injected into the prompt

## No backend

The only server is static file delivery. The agent loop, tool execution,
filesystem, MCP, and the LLM call all run in the tab. The key never leaves the
browser except in the direct request to OpenRouter; with the on-device model,
nothing leaves at all.

## Run it

The hosted copy deploys from `main` (GitHub Actions → Pages). For development:

```bash
bun install
bun run dev          # -> http://localhost:5173
```

Open in Chrome or Edge. The onboarding card offers two options: an OpenRouter
key (https://openrouter.ai/keys) or an on-device model (WebGPU).

### Ship it as one file

```bash
bun run build        # -> dist/index.html, the whole app in one file
```

Host it on anything static, or serve locally with `python3 -m http.server -d dist`.

### Share it / run it locally

"Save a copy of me" (footer) downloads the running app as `tab.agent.html`.
Double-clicking that file works: Chrome blocks OPFS on `file://`, so `/scratch`
falls back to in-memory (lost on reload — the app says so), but the LLM call,
folder sharing, shell, and python all work. Downloaded copies are frozen at
their build, so on `file://` the footer links back to the hosted URL instead.

## Workflows in a link

Instructions (an install.md, a repeatable chore) ride in the URL fragment:
`…/#wf=<base64url(deflate-raw(JSON{v,t,i}))>` (`src/wf.ts`). The fragment is
never sent in any request — the host can't see it — and the same link works on
a `file://` copy.

- `{{name}}` placeholders become input fields the recipient fills in.
- Nothing auto-runs. A consent card shows the exact instructions with a
  Run / No thanks choice; the hash is removed after handling.
- Shared workflows are visually third-party: a "SHARED WITH YOU" badge on the
  card, and runs appear as a "Running shared workflow" bubble with foldable
  steps rather than as the user's own message. Workflow links skip the intro.
- The `make_workflow_link` tool mints links. The sample skill compresses to
  ~250 URL chars; ~10k chars (≈15–25 KB of markdown) stays shareable in chat apps.

## System actions: the click-to-run installer

The sandbox can't install software or run native binaries. When a task needs
that, the agent calls `write_installer`, which downloads a click-only installer:

1. A `.zip` containing `setup.command` with mode `0755` (`src/zip.ts`). The
   browser can't set an executable bit, but a zip stores the Unix mode and
   macOS restores it on unzip — no terminal, no chmod.
2. Double-click the zip, double-click `setup.command`.
3. macOS shows an unidentified-developer prompt; right-click → Open is the
   authorization step. Notarizing would remove it.

A persistent signed companion app (live system access without per-task files)
is the heavier future option — see issue #2.

## The validation gauntlet

Each step proves one risky piece:

1. "print 2+2 in python" → agent loop + Pyodide + LLM call.
2. "list the files in /scratch" → OPFS.
3. Share a folder, then "read every file in /mnt/user and summarize" → real
   local files.
4. "create haiku.md in my folder with a haiku about tabs" → reload, check disk
   → writes + `syncfs`.
5. Set `VITE_MCP_URL` to a real server, ask something needing its tool → MCP + CORS.

## Architecture

```
BROWSER TAB (the entire app)
  Chat UI ─► Agent loop (src/agent.ts)
               ├─ LLM ─► OpenRouter (fetch; src/settings.ts)
               │     └─ or on-device: WebLLM / Hermes on WebGPU (src/local.ts)
               └─ tools
                    ├─ python_exec ─► Pyodide (src/pyenv.ts)
                    │     /mnt/user ◄─ your real folder (FSA, Chromium)
                    │     /scratch  ◄─ OPFS (in-memory on file://)
                    ├─ shell ──────► just-bash on Pyodide's FS (src/shell.ts, src/pyfs.ts)
                    ├─ make_workflow_link ─► #wf= links (src/wf.ts)
                    ├─ write_installer ───► click-to-run .zip (src/installer.ts)
                    └─ mcp__* ─────► remote MCP (src/mcp.ts)
  🎤 dictation ─► Parakeet TDT v3 via onnxruntime-web (src/asr.ts)
```

## Known gaps (deliberate)

- No streaming — responses arrive in full per turn.
- Skills are eagerly loaded into every prompt; no progressive disclosure
  (`src/skills.ts`).
- The key sits in `localStorage`. Fine for bring-your-own-key: no shared rate
  limit, nobody pays for anyone else.
- Free-model tool calling is uneven and rate-limited when congested. The agent
  retries once, then falls through `FALLBACK_MODELS` (`src/settings.ts`).
  Default: `z-ai/glm-4.5-air:free`.
- `node:zlib` is stubbed (`src/shims/zlib.ts`); just-bash's gzip commands are
  no-ops. Wire `fflate` if needed.
- Firefox/Safari: OPFS works, but folder sharing (FSA) does not — the app says
  so and dims the button. On-device AI and dictation also do best in Chromium.

## On-device AI

WebLLM (`@mlc-ai/web-llm`, CDN-loaded only when chosen) runs the model on the
user's GPU, speaking the same OpenAI chat-completions format including
structured `tool_calls`, so the agent loop is provider-agnostic (`src/local.ts`).
Weights download once (~4–5 GB) and are cached.

Constraints, all hit in practice:

- Only Hermes models support native tool calls in WebLLM 0.2.84 (Hermes-2-Pro
  7/8B, Hermes-3-Llama-3.1-8B). Smaller models claim to act but can't — the
  model list is Hermes-only.
- WebLLM rejects a custom system prompt when `tools` is set; instructions are
  folded into the first user message instead.
- Assistant tool-call turns need string content (OpenAI sends `null`).
- The gemma3 record in 0.2.84 is broken (context/sliding-window clash), and
  patching it produces degenerate output — gemma is off the list.
- 8B-q4 models still misfire (bash into python_exec, repeated failing calls);
  repeated identical calls get a "try something different" nudge.

## Dictation (local ASR)

The 🎤 button runs NVIDIA Parakeet TDT 0.6B v3 in the tab via
[parakeet.js](https://www.npmjs.com/package/parakeet.js) (onnxruntime-web),
CDN-loaded on first use after a size warning (~620 MB int8, once). Audio stays
on the machine. Recording is single-shot: talk, click ⏹, one transcription
lands in the textbox, which grows for review and editing before Send.

No live streaming, by trial: continuous re-decoding lags on single-threaded
wasm; pause-gated decoding still felt laggy; the fp16 WebGPU encoder fails
session creation (`std::bad_alloc`); chunked StatefulStreamingTranscriber
degenerates after one chunk (disjoint chunks lose conformer context).

## Shared filesystem (shell ⇄ python)

just-bash runs on an `IFileSystem` implemented over Pyodide's Emscripten FS
(`src/pyfs.ts`), so `shell` and `python_exec` see the same files: `/scratch`
(OPFS, persists across reloads) and `/mnt/user` (the real folder). Every tool
run flushes writes to disk via `syncfs`.
