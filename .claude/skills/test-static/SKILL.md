---
name: test-static
description: Use when verifying the tab-agent codebase compiles, builds, and passes unit tests — after any code change, before a commit/PR/merge, or when asked "does it build?"
---

# Static checks (tsc + unit tests + build)

## Run

```bash
cd <repo-root>
bun install              # only if node_modules is missing (fresh clone/worktree)
bunx tsc --noEmit        # type check — THE only type gate
bun test                 # unit tests (pyfs, wf, zip)
bun run build            # vite build → dist/index.html (single file)
```

## Pass criteria

| Check | Pass looks like |
|---|---|
| `bunx tsc --noEmit` | exit code 0, no output |
| `bun test` | `0 fail` — any number of passes; the suite grows over time |
| `bun run build` | `✓ built`, produces `dist/index.html` ~1.5 MB |

## Common mistakes

- **`vite build` does NOT type-check.** A green build with broken types is normal — always run tsc separately.
- **Check tsc's exit code, not its output position.** `bunx tsc --noEmit 2>&1 | tail && echo ok` prints "ok" even on failure. Use `bunx tsc --noEmit; echo "exit: $?"`.
- There is **no lint/format script** — tsc + test + build is the entire static surface. Don't hunt for one.
- The root `skills/` directory is the **app's own prompt-skills feature** (injected into the agent's system prompt at build). It is not related to repo tooling — never put dev/test docs there.
