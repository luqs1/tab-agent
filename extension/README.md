# tab.agent bridge (companion extension)

Optional. tab.agent is a pure web page that works with **no extension at all**.
This little extension *expands* what it can do — by lending it privileged,
CORS-free network access on the hosts you allow, with the work staying on your
machine.

## What it unlocks

A normal web page can't fetch from servers that don't opt into CORS (most of
them), and can't speak the git protocol to GitHub. The extension does those
fetches from its own context (where CORS doesn't apply) and hands the bytes
back to the page. First payoff: **`git clone` of a public repo, over the real
git protocol, straight into your shared folder** — no proxy, no backend.

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

Default `host_permissions` cover GitHub only (`github.com`, `*.githubusercontent.com`,
`api.github.com`, `codeload.github.com`). That's all the git-clone power-up needs.
Add hosts to broaden the bridge; `<all_urls>` makes it a general CORS-free fetch
proxy (powerful — and a scarier prompt).
