# tab-agent

An agent that runs **entirely on a browser tab**. No install — the user just opens a URL.

- **Model**: remote **free** models via OpenRouter (`:free`, no per-token charge), behind a tiny key-hiding proxy (`worker.ts`)
- **Execution**: in-tab CPython (Pyodide) + a bash-like shell (`just-bash`)
- **Files**: the user's *real* folder via the File System Access API, mounted into Pyodide; OPFS as a fast scratch dir
- **Tools**: remote MCP servers over Streamable HTTP
- **Skills**: markdown under `skills/` injected into the prompt

This is a **de-risking sketch**: the goal is to prove the four hard integrations work
end-to-end, not to be a finished product.

## Run it

```bash
bun install

# 1. LLM proxy (holds the OpenRouter key, adds CORS). Free key: https://openrouter.ai/keys
echo 'OPENROUTER_API_KEY=sk-or-v1-...' > .dev.vars
bun run worker            # -> http://localhost:8787

# 2. the app
cp .env.example .env.local   # defaults already point at the local worker
bun run dev               # -> http://localhost:5173
```

Open http://localhost:5173 in **Chrome or Edge** (File System Access API is Chromium-only).

## The validation gauntlet

Run these in order — each proves one risky piece:

1. **"print 2+2 in python"** → agent loop + Pyodide + LLM proxy all work.
2. **"list the files in /scratch"** → OPFS mount works (all browsers).
3. Click **Mount a folder**, then **"read every file in /mnt/user and summarize"** → the killer feature: agent on your *real* local files.
4. **"create /mnt/user/haiku.md with a haiku about tabs"** → reload, check the file is on disk → write + `syncfs` works.
5. Set `VITE_MCP_URL` to a real server, ask something needing its tool → MCP path + the CORS reality.

## Architecture

```
BROWSER TAB
  Chat UI ─► Agent loop (src/agent.ts)
               ├─ LLM ──► worker.ts proxy ──► OpenRouter (free models)
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
- **OpenRouter key lives in the proxy**, not the client — the one piece of server
  you deploy once. The end *user* installs and configures nothing.
- **Free models are rate-limited against your key** (~20 req/min; 50/day under 10
  credits, 1000/day at ≥10). No per-token charge. If you deploy this publicly, add
  an Origin allow-list in `worker.ts` so strangers can't drain your limits.
- **Free-model tool calling is uneven** — quality/reliability varies by model.
  Swap the default via `VITE_MODEL` (must be a `tools`-capable `:free` model).
- `node:zlib` is stubbed (`src/shims/zlib.ts`); `just-bash`'s gzip commands are
  no-ops in the browser (as it documents). Wire `fflate` if you need them.
- Firefox/Safari: OPFS works, but **Mount a folder** (FSA) does not.
```
