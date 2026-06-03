# tab-agent

An agent that runs **entirely in a browser tab — no backend.** The whole app is
static JS/WASM; nothing runs on a server. The user brings a free OpenRouter key
(stored in `localStorage`) and the browser calls OpenRouter directly.

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

> ⚠️ **Don't open `dist/index.html` directly via `file://`.** Verified: the LLM
> call works from `file://`, but Chrome blocks **OPFS** for `file://` origins
> (`SecurityError`), so the filesystem breaks. Serve it over `http(s)://` (even
> `localhost`) — that's still just file delivery, not a backend. OPFS + File
> System Access both work fine over plain static HTTP.

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
3. Click **Mount a folder**, then **"read every file in /mnt/user and summarize"** → the killer feature: agent on your *real* local files.
4. **"create /mnt/user/haiku.md with a haiku about tabs"** → reload, check the file is on disk → write + `syncfs` works.
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

- **Shell and Python have separate filesystems.** `just-bash` runs on its own
  in-memory FS; Pyodide owns `/mnt/user` + `/scratch`. To unify: implement
  just-bash's `IFileSystem` (or use `MountableFs`) backed by the same OPFS/FSA
  store Pyodide uses. See `src/shell.ts`.
- **No streaming** — responses arrive in full per turn.
- **Skills are eagerly loaded** into every prompt. Real harnesses lazy-load by
  description (progressive disclosure). See `src/skills.ts`.
- **The key sits in `localStorage` and is sent directly to OpenRouter.** Fine for
  a personal tool / bring-your-own-key. Each user uses their own key, so there's
  no shared rate limit and no one gets charged for anyone else.
- **Free-model tool calling is uneven** — quality/reliability varies by model,
  and free models get rate-limited (429) when congested. Switch models in the UI;
  default is `z-ai/glm-4.5-air:free`.
- `node:zlib` is stubbed (`src/shims/zlib.ts`); `just-bash`'s gzip commands are
  no-ops in the browser (as it documents). Wire `fflate` if you need them.
- Firefox/Safari: OPFS works, but **Mount a folder** (FSA) does not.
