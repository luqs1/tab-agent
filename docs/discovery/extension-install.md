# Installing the companion extension without an app store

Research June 2026. Bottom line: **Chrome has no clean marketplace-free consumer
install in 2026; Firefox does** (unlisted AMO-signed XPI). Build the extension
cross-browser and **lead with Firefox** for the frictionless story.

## Chrome / Chromium

| Method | Friction | Persists / auto-updates | Catch |
|---|---|---|---|
| **Load unpacked** (chrome://extensions → Dev mode) | Medium-high | Survives restart; **no auto-update** | "Disable developer mode extensions" **nag bubble every startup** — can't be turned off without enterprise policy. Folder must not move. |
| **Self-hosted .crx + `update_url`** | — | Auto-updates | **Dead on Win/macOS** since Chrome 33/44 — off-store CRX install only works on **Linux**. `.crx` drag-drop blocked (except Edge). |
| **`ExtensionInstallForcelist`** policy | Zero clicks for user | Silent, locked, auto-updates | **Only prompt-free Chrome path**, but needs the machine domain/MDM-managed (registry key / config profile / admin). Not a consumer path. |
| **`--load-extension` CLI flag** | — | — | **Removed from stock Chrome in 137**; still works in plain Chromium / Chrome for Testing / forks. |
| Forks (Edge/Brave/Arc) | varies | — | Edge still allows `.crx` drag-drop; Brave blocks it (Load unpacked only). |

## Firefox (the low-friction winner)

| Method | Friction | Notes |
|---|---|---|
| **Unlisted, AMO-signed XPI** | **Low** — click an install link (or drag onto `about:addons`) + one "Add" prompt | Works on **stock release Firefox**, no dev mode. AMO is used purely as a **signing service** (automated review); the add-on is **not publicly listed**, you keep distribution control. Signed = tamper-evident. Optional self-hosted `update_url` for auto-update. Only requirement: a free AMO account. |
| Unsigned XPI + `xpinstall.signatures.required=false` | Higher (about:config edit) | Only Developer Edition / Nightly / ESR — **not release/Beta**. Dev-only. |

## Recommendation

- **Ship a Firefox unlisted signed XPI** as the primary distribution: one link, one
  "Add" prompt, signed, on stock Firefox. Residual friction: a free AMO account to
  sign each version, and the user sees one permission dialog. Lowest-friction real
  path that exists.
- **Chrome support = "developer-mode, with a known per-startup warning"**, or pursue
  a Web Store listing if Chrome must be first-class. Be upfront about the nag.

Note for our build: the extension here is MV3 (Chromium). Firefox supports MV3 with
differences (background scripts/event pages vs service workers; `browser.*` namespace).
Cross-browser packaging is a follow-up; the bridge protocol itself is identical.

## Sources
- Chrome — install/distribute: https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions
- Chrome — host on Linux (only off-store CRX path): https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux
- Chrome — ExtensionInstallForcelist: https://chromeenterprise.google/policies/extension-install-forcelist/
- `--load-extension` removal (Chrome 137): https://groups.google.com/a/chromium.org/g/chromium-extensions/c/aEHdhDZ-V0E
- Dev-mode startup bubble: https://support.google.com/chrome/thread/48065815
- Firefox signing & self-distribution: https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/ , https://extensionworkshop.com/documentation/publish/self-distribution/
- Firefox signature requirement: https://wiki.mozilla.org/Add-ons/Extension_Signing
- macOS forcelist via profile: https://support.pendo.io/hc/en-us/articles/21165322774555
