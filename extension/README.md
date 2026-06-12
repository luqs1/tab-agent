# tab.agent bridge (companion extension)

Optional. tab.agent is a pure web page that works with **no extension at all**.
This little extension *expands* what it can do — by lending it privileged,
CORS-free network access on the hosts you allow, with the work staying on your
machine.

## What it unlocks

Two kinds of power a plain web page can't have:

1. **CORS-free fetches.** A normal page can't fetch from servers that don't opt
   into CORS (most of them), and can't speak the git protocol to GitHub. The
   extension fetches from its own context (where CORS doesn't apply) and hands
   the bytes back. Headline payoff: **`git clone` of a public repo, over the
   real git protocol, straight into your shared folder** — no proxy, no backend.

2. **Browser control.** The agent can open, read, and drive your other browser
   tabs — `browser_open`, `browser_tabs`, `browser_read` (rendered text + links,
   cross-origin), `browser_eval` (run an expression in the page), `browser_click`,
   `browser_fill`, `browser_navigate`, `browser_close`. That turns tab.agent from
   a sandboxed chat into a real automation harness: "open this page and pull out
   the prices", "fill this form", "what's on the tab I have open?"

## How it works (and why it's safe-ish)

- A **content script** runs only on tab.agent's pages and is the only link
  between the page and the extension. It accepts same-origin requests and
  forwards them to —
- a **service worker** that holds the `host_permissions` and performs the
  actual fetch. The page never touches `chrome.*`.
- The permission prompt you see at install time **is** the consent: you're
  granting the listed hosts (GitHub, by default). Broaden `host_permissions`
  in `manifest.json` to allow more.

## Install (Chrome / Edge / Brave / Chromium)

No web store. Developer mode:

1. Download/clone this `extension/` folder to a stable location (don't move it later).
2. Open `chrome://extensions`.
3. Toggle **Developer mode** (top-right).
4. Click **Load unpacked** → select this `extension/` folder.
5. Open tab.agent — it'll note "🔌 Power-up extension connected."

> Heads up: while any unpacked extension is loaded, Chrome shows a "Disable
> developer mode extensions" bubble on every startup. That's Chrome's anti-malware
> nag, not a problem with this extension. (Firefox has a cleaner path — see
> `docs/discovery/extension-install.md`.)

## Scope

This version requests broad access so the browser-control tools work on any tab:

- `host_permissions: <all_urls>` — CORS-free fetch of any host, and script
  injection into any tab you ask the agent to drive.
- `tabs` + `scripting` — enumerate tabs and run the read/click/fill/eval helpers.

That's a powerful (and honest) install prompt: with it, the page you trust can
ask the extension to fetch anything and to read/drive any tab. The page can only
reach the narrow ops in `background.js` — never `chrome.*` directly — and the
content script still only injects into tab.agent's own origins. If you want to
narrow it, replace `<all_urls>` with a specific host list (git clone alone needs
only `github.com`, `*.githubusercontent.com`, `api.github.com`,
`codeload.github.com`); the browser-control tools then work only on matching tabs.
