# tab.agent

Live: https://luqs1.github.io/tab-agent/

It's just a html file.

An agent that executes locally in a browser tab, removing the install friction. No backend, the app is
static JS/WASM. Bring a free OpenRouter key (stored in `localStorage`, sent
only to OpenRouter), or run the model on-device.

The UI is plain-language chat aimed at non-technical users. The dot in the
wordmark is the status light (amber = thinking, green = ready).

- **Model**: free OpenRouter models, called directly from the browser (CORS-ok,
  no proxy), or on-device via WebLLM (Hermes 7/8B, WebGPU)
- **Execution**: in-tab CPython (Pyodide) + a bash-like shell (just-bash), one
  shared filesystem
- **Files**: a real local folder via the File System Access API; OPFS scratch dir
- **Voice**: local dictation, Parakeet TDT 0.6B v3 (onnxruntime-web)
- **Sharing**: workflows encoded in the URL fragment; the app downloads itself
  as a single file
- **Tools**: remote MCP servers over Streamable HTTP, connectable at runtime (⚙)
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
falls back to in-memory (lost on reload — the app says so), but folder sharing,
shell, and python still work. Downloaded copies are frozen at their build, so on
`file://` the footer links back to the hosted URL instead.

**A saved copy is not actually offline.** The single file is the *app*, not its
runtimes: Pyodide (python/shell), WebLLM (on-device model), and Parakeet
(dictation) are each fetched from a CDN on first use, and the OpenRouter model
is a remote API. So a saved copy still needs the internet — open it on a plane
with no connection and it can't run python/shell, load a model, or chat.
Bundling Pyodide for genuine offline use is a possible future step.

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


## Golden workflows

Three ready-made links — open one, read the card, click Run:

- **[Install Homebrew](https://luqs1.github.io/tab-agent/#wf=XVLbatwwEP2VgxqaBGKbTd9cCPQGKRQCTR8NRSvProbIIyON19leoE_9gNIvzJcUebMJ9E3SSOeq72Zn2tWFUdOaj5LVhoDrONA60WwuDJvWvMD_g046-eIJU6aE2YrmpxHO1BMG625uMVp3Z7dlJ3ZL6Rx8wKG-LgirGm8T0ybsQfdjsCyYvdXTDLuOk0IjvB1Hkhb7OJ2GAG-lh3oaYBGFKuWBkEmnERsOBPVWjyTPki5QnklUz7JFmiRjEuVQkPaIIwlYF9hMYUe57uSyxrtieE6s9PUoO2Fm9RA7EDrzeFr5Yyhm4aF76zTsoZ4zsks8alvc8gYuDkO5Uu2wRHXV9LRrZAoBl1cvV6-LBukEIOcjOvOUKWfYkMj2--cIW5ycLcOq2lHKHAU_4Mn2qFbnnemEQqYC1qxZmrXNHpVDZ07O3JQCqk2-_QSvOua2aZKd6y2rn9alUhdFSbR2cWiOGppH4ub6w5v3x02d_UK14eLwVY3PFGyxTnCB3V213lfLoqS-SE-TU46SkXkYw_5QTSKb85RKfzQcSnz-RJ2ZhHsS5Q1Tj552FOJIqTMYUxxGLenQ_UhOqcfDr79IvPX6yPvw-w9uloYzfJwPldtJfUz8jcBam5__AA)** — the agent hands you a click-to-run
  installer for the macOS package manager (idempotent; safe to re-run).
- **[Install opencode](https://luqs1.github.io/tab-agent/#wf=bZHditRAEIVf5dCCKEwyzHqXhb3QK0EQ3L0MSE-nsinsVIeuyswGFXwIn9Ankc7OjyzeNVV1-pz66rs7uGa3ceYa91HUfIxIE0lIHbmNY9e4V3jZaKWVh4EwK2UcvZheWngzmE3abLfnSu0Zf379hkdIHcsj_COJoU8ZNhCM8sji41vwswt1dfl_V-N9ZurjAnqaomdp4JGEKuORoGTzhJ4jnXUKtltIsqGY5FkUsxjH4rKs-Va_VWIDjUrxQFq3clPjQ9numNno6zlFxpFtgPiR0LpTtboQcPDSgZ58sLjABlZoyDxZU8Jzj5DGsYxUhyubu21Hh63MMeLm7vXutuSQVgAKQ0LrLoOs8DGT75Z_qbhWKCoVQZhzRNXr_Sf8h_f2JMIP7L0OrfRcUr2r8YWiL3EJIXL4Vu2Xan0UXqtVnoNxEoXyOMVlg0xedc7PzOD3abZVP_rw-R5KYc5sC6acxsk2K5WehXXAfoFRjOUaRdtcb_Bwujn8NK0KWya6YrIENZ8NbLX7-Rc)** — same flow for the
  [opencode](https://opencode.ai) terminal coding agent.
- **[Description → draw.io diagram](https://luqs1.github.io/tab-agent/#wf=dVTBbhMxEP2VkXugldJNU6BCSTcIFVohVHFoEZeV0GQ9G1t1PIs9m01VlSMfwCfyJcjepAQQN3s8b-a98bMf1FpNJyMlaqpuu-ABQVOsg23FsgfrhVMoYF9YBm1xGXClRsqqqTqAa7yjf48rX_mLQCj5bIhBE3gFYmzcrz9NqQ8PvUGBaLhzGsTQEyYa7l8_PqakSQGfOdwBd5JTFryhCOgHAIbAfYQFSU_kU-ipIe33Kyp_WsCnaP0S2nsx7L_QhuoR9MFmtmt0Vj_paayjKaCH89UmredQsxe0PuHZE5xvmc6ht2K2mVcBW3PNmtz8PDDLvID3vnadpkxHeoZAXzsbSENNzkU4tBoqdVKpUVaUd5NKDUVbDORlOD8q4I3WQFibNAHANAJYbS7IOVhTENqUA3RAlXt1otw7gkoF7rwmXU5mvbFCNy3WVPYB25mRlSsns8Y6d8GOQ3nQNM1pXc-iBL6jbUyfLc5ens0qlbnm9lfEK5JwD4e91WJgcnYyAkN2aQTSEmNZqeU2qVJHI3Bodb5LR40cCx-HnDwG4TZtFyzCq4H4t1cn7QaW2MY99fnG_9RPekn_V89dqGksGJYkYPXgnd1MEvQmrUsOYnjJHt27XWz2e2KptOtivuWd5kAOxa53rf_SOp4XlX9ewA2uCawkxlvPFMlllsFmv0IXKTyLEA0mXzTsNAWwTbaZ3cVHwGIo9DZSwo1jHVBqU1T-RQG3aQi7UtAbCoPhknNTieGxoCQa3JKPgAJGpI3T8RjbttgSi4UngcPLBPv5_Qd8bMnDZXpNafeW1ramowI-ELW5Pm1ahx7zfyGc_R3JC_maYqEefwE)** — type what the diagram
  should show; the agent writes a `.drawio` file into your shared folder, ready
  to open at app.diagrams.net.

Links are minted by `scripts/make-links.ts` (or ask the agent to make one).

## The validation gauntlet

Each step proves one risky piece:

1. "print 2+2 in python" → agent loop + Pyodide + LLM call.
2. "list the files in /scratch" → OPFS.
3. Share a folder, then "read every file in /mnt/user and summarize" → real
   local files.
4. "create haiku.md in my folder with a haiku about tabs" → reload, check disk
   → writes + `syncfs`.
5. Open ⚙, connect a tool server (e.g. `https://mcp.deepwiki.com/mcp`), ask
   something needing its tool → MCP + CORS. Verified against DeepWiki.

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

## MCP

Remote servers connect from ⚙ (Streamable HTTP, must allow CORS; persisted,
reconnects at boot). stdio servers can't run in a tab.

Direction — in-tab servers: most MCP servers are Python or TypeScript, and the
pieces exist to run them inside the tab itself. TS servers can connect through
the SDK's `InMemoryTransport` (no network at all); Python servers could run in
the Pyodide we already ship; Rust servers compile to wasm via the component
toolchain — see [wasmcp](https://github.com/wasmcp/wasmcp) (MCP servers as wasm
components), Microsoft's [Wassette](https://opensource.microsoft.com/blog/2025/08/06/introducing-wassette-webassembly-based-tools-for-ai-agents/)
(wasm components exposed as MCP tools), and a browser
[proof-of-concept](https://github.com/beekmarks/mcp-wasm). The catch for
anything useful: in-tab servers inherit the browser's network rules, so a
"GitHub MCP server in wasm" still can't call api.github.com unless that API
allows CORS. In-tab servers shine for compute/file tools; network-bound ones
mostly still need a CORS-friendly remote.

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
