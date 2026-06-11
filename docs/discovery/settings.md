# Discovery: settings UX + the overloaded ⚙

Status: **discovery / proposal** — not implemented on this branch (this is the writeup).
Spikes that begin the work live on sibling `spike/*` branches (see end).

The ⚙ card (`#onboard` in `index.html`) is currently doing three unrelated jobs at
once: first-run onboarding, ongoing settings, and workflow history. This doc works
through the five improvement asks and proposes an information-architecture split.

---

## 1. ⚙ should toggle the card closed

**Today:** `onClick("settings", () => showOnboard(true))` only ever *opens* it; the
only way to dismiss is to connect or scroll past. Clicking ⚙ again does nothing.

**Fix:** make it a toggle — `showOnboard(card.hidden)`. Trivial and unambiguous.
Caveat: don't let the user close it while *unconnected* on first run (there's no
brain yet), or guard with a confirmation. Simplest: allow toggle always; if they
close it unconnected, the next `send()` reopens it anyway (existing behavior).

→ spiked in `spike/settings-quick-wins`.

---

## 2. Prefill model id + OpenRouter key when already set — what's possible

**Model id:** *already* prefilled — `main.ts` does
`(#model).value = getStoredModel()`. It's blank only when the user is on the free
default (no override saved). Improvement: when blank, set the **placeholder** to the
effective default (e.g. `moonshotai/kimi-k2.6:free`) so the field never reads as
"unconfigured." Cheap.

**OpenRouter key:** *not* prefilled. It's a `type=password` input; `savekey` reads it
but nothing writes it back. Three options:

| Option | What | Pros | Cons |
|---|---|---|---|
| **A. Prefill the raw key** (masked dots) | put `getKey()` into the password field | user can see/edit in place | renders the secret into the DOM; a "reveal" toggle would expose it on screen |
| **B. Saved-state indicator** *(recommended)* | replace the input with `✓ Key saved (sk-or-…AB12)` + a **Change** button that reveals an empty input | signals saved state, never re-renders the secret, clearest UX | one extra click to replace |
| **C. Masked placeholder** | `placeholder="•••• saved — paste a new key to replace"`, leave value empty | no secret in DOM, no extra control | can't tell *which* key is saved |

**Security note:** the key already lives in `localStorage`, readable by any script on
the origin — so prefilling it into an input is **not a new exposure** (same threat
model). The real rule is the one we already enforce: never log it, never send it
anywhere but OpenRouter. So all three are "safe"; the choice is pure UX. **Recommend B**
— it communicates "you're set up" without putting the secret back on screen, and the
last-4 suffix lets a user confirm *which* key without revealing it.

→ B spiked in `spike/settings-quick-wins` (key chip + Change), plus the model placeholder.

---

## 3. OpenRouter model list → autocomplete

**Strongly feasible.** `GET https://openrouter.ai/api/v1/models` is public and
CORS-friendly (it's the same origin the chat endpoint already hits from the browser).
As of this writing: **337 models, 251 tool-capable, 16 tool-capable free.** Each entry
has `id` (e.g. `anthropic/claude-sonnet-4.6`) and a friendly `name`
(`Anthropic: Claude Sonnet 4.6`), plus `supported_parameters`, `pricing`, `context_length`.

**Plan:**
- On settings open, fetch the list once (cache in memory; tolerate offline → no
  autocomplete, manual entry still works).
- Filter to `supported_parameters.includes("tools")` — a model without tool support
  makes the agent silently useless, so don't offer those.
- Back the `#model` input with a `<datalist>` of `id`s, labelled with `name`.
- Nice-to-have: mark `:free` ones, show price/context as the option label.

Why a `<datalist>` and not a `<select>`: 251 options needs type-to-filter, and the
field must still accept a hand-typed id (new models appear before we'd re-fetch).

→ spiked in `spike/openrouter-model-autocomplete`.

---

## 4. Chrome MCP as a default addable tool — feasibility

**Verdict: not as a zero-install default URL.** Worth doing, but not the way the other
MCP servers work.

`ChromeDevTools/chrome-devtools-mcp` is a **local Node/Puppeteer stdio server** — it
spawns and drives a Chrome on the user's machine. It is not a hosted service with a URL
we can ship. Two hard blockers for our in-tab model:

1. **It's local + install-required.** Default transport is stdio (`npx chrome-devtools-mcp`).
   It can be exposed over Streamable HTTP via `mcp-proxy`
   (`mcp-proxy --transport streamablehttp --port 8080 -- npx -y chrome-devtools-mcp@latest`),
   or a native `--transport http` flag is in progress upstream (PR #459 / issue #543).
   Either way the user must run it themselves — which cuts against tab-agent's
   "nothing to install" promise.
2. **Mixed content.** The hosted app is `https://luqs1.github.io`; the local server is
   `http://localhost:8080`. Browsers block `https → http` requests as mixed content,
   and the proxy would also need to send permissive CORS. A user running tab-agent
   itself on `http://localhost` (or a downloaded `file://` copy) sidesteps the mixed-
   content issue but not the install.

**Two honest paths:**

- **(a) "Power-user recipe."** Use the *existing* `write_installer` tool to hand the
  user a one-click script that runs `chrome-devtools-mcp` behind `mcp-proxy` with CORS
  on, then offer `http://localhost:8080/mcp` as a one-tap "add" in the MCP section. Only
  works when tab-agent is served from localhost/file (mixed content). Document the
  constraint loudly. This is real and shippable but niche.
- **(b) Browser-native MCP (the exciting lead).** Projects like `@mcp-b/*` / "WebMCP"
  run an MCP server **inside the browser** (extension or in-tab), controlling the
  current tab with no Node server and no network hop — which is exactly tab-agent's
  ethos. This could give "control the browser" tools with zero install if paired with a
  companion extension, or even fully in-tab for the app's own surface. Needs a real
  spike to assess maturity and the security model (a tab that can drive the browser is
  a big capability — gate it hard).

**Recommendation:** ship neither as a "default addable" yet. File (b) as a discovery
spike — it's the version that fits the product. Treat (a) as documentation for power
users. Do **not** advertise "Chrome MCP" as one-click until one of these is real.

→ tracked as a follow-up spike `spike/webmcp-browser-native` (research only).

---

## 5. The ⚙ is overloaded — proposed split

**Today** `#onboard` conflates three audiences in one scroll:
- **First-run onboarding** — guided "step 1 / step 2", goal: get *one* brain connected.
- **Ongoing settings** — change model/key, switch provider, manage MCP servers.
- **Workflow history** — "recent workflows" — which isn't configuration at all.

This is why it feels heavy: a returning user who just wants to swap a model wades past
onboarding copy, on-device download warnings, MCP fields, and a workflow list.

### Proposal

**Separate by intent, keep one entry point (the ⚙), branch the content:**

1. **Onboarding ≠ Settings.** Same card, different mode:
   - *Unconnected* (first run): the current guided, minimal "get connected" flow —
     trimmed to just the fastest path (free key OR on-device), with MCP/advanced hidden
     behind a fold.
   - *Connected* (⚙ later): a **Settings** view titled as such, no "step 1/2" framing,
     showing current state (saved key chip, current model) and letting any of it change.

2. **Group settings into sections (light tabs or accordions):**
   - **Brain** — provider toggle (OpenRouter ⇄ on-device), key (saved-chip from §2),
     model (autocomplete from §3).
   - **Tools** — MCP server list + add (url + token), the §4 Chrome recipe if we ship it.
   - **About** — version/update chip, "save a copy", links.

3. **Evict workflow history from settings.** "Recent workflows" is *content*, not
   config. Give it its own affordance — e.g. a 📦 button in the header or a small
   launcher — so it stops bloating the settings surface. (Low effort, high de-clutter.)

### Options weighed

| Approach | Effort | Notes |
|---|---|---|
| **Tabs/accordion inside the existing card** | low–med | smallest change; one entry point; recommended first step |
| **Distinct onboarding card + separate settings panel** | med | cleanest mental model; more DOM/CSS work |
| **Keep one card, just fold "advanced" (MCP/on-device)** | low | quickest de-clutter, doesn't fix onboarding-vs-settings conflation |

**Recommendation:** start with **§5.1 (branch onboarding vs settings by connection
state)** + **§5.3 (move workflows out)** — they remove most of the overload for little
risk — then layer in sections (§5.2). Hold the full separate-panel rebuild until the
autocomplete + key-chip land, since those reshape the Brain section anyway.

---

## Suggested sequencing

1. `spike/settings-quick-wins` — ⚙ toggle (§1), key saved-chip + model placeholder (§2). Low risk, ship-able.
2. `spike/openrouter-model-autocomplete` — datalist from the models API (§3).
3. IA split (§5.1 + §5.3) — once 1 & 2 land, since they reshape the Brain section.
4. `spike/webmcp-browser-native` — research the in-browser MCP path (§4b).
5. Power-user doc for `chrome-devtools-mcp` via `mcp-proxy` (§4a) — docs only.

## Sources
- chrome-devtools-mcp — https://github.com/ChromeDevTools/chrome-devtools-mcp
- HTTP transport (PR #459 / issue #543) — https://github.com/ChromeDevTools/chrome-devtools-mcp/pull/459
- `@mcp-b/chrome-devtools-mcp` (browser-native lead) — https://www.npmjs.com/package/@mcp-b/chrome-devtools-mcp
- OpenRouter models API — https://openrouter.ai/api/v1/models
