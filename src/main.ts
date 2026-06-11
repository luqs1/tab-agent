// Wiring: boot pyodide, connect MCP, hook up the friendly chat shell.
import {
  say, userSay, workflowSay, note, error, status, thinking,
  onClick, inputValue, showOnboard, showFolderChip,
} from "./ui";
import { asrSupported, asrReady, loadAsr, startDictation, stopDictation, dictating } from "./asr";
import { ready, mountUserFolder, scratchPersists, uploadToScratch } from "./pyenv";
import { shellCd } from "./shell";
import {
  decodeWorkflowHash, workflowParams, fillParams,
  rememberWorkflow, recentWorkflows, type Workflow,
} from "./wf";
import { connectMcp, disconnectMcp, mcpServers } from "./mcp";
import { runAgent, stopAgent } from "./agent";
import {
  setKey, hasKey, getProvider, setProvider, getLocalModel, setLocalModel,
  getMcpServers, setMcpServers, getModel, setModel, getStoredModel, FALLBACK_MODELS,
} from "./settings";

// The free tier shifts: a saved FREE model that's left our known-good list
// would burn a failed call every turn, so drop it back to the default. A
// deliberately-chosen paid model (no :free suffix) is the user's call — leave it.
{
  const m = getModel();
  if (m.endsWith(":free") && !FALLBACK_MODELS.includes(m)) setModel("");
}
import { LOCAL_MODELS, loadLocalModel, localReady, gpuAvailable } from "./local";

// Point this at any browser-CORS-friendly MCP server.
const MCP_URL = import.meta.env.VITE_MCP_URL;

const WELCOME =
  "Hi! I'm **tab.agent** 👋 I live in this tab and can help you " +
  "do real things on your computer, without installing anything new. \n\n" +
  "Use **📁 Share a folder** to let me work with your real files, " +
  "then just tell me what you need to do.";

const connected = () => hasKey() || (getProvider() === "local" && getLocalModel() !== "");

// A workflow link should open straight onto its consent card, not the intro.
const WF_LINK = location.hash.startsWith("#wf=");
if (!WF_LINK) say(WELCOME);
if (!connected()) showOnboard(true);

// The on-device option: populate the model choices; hide it without WebGPU.
{
  const sel = document.getElementById("localmodel") as HTMLSelectElement;
  for (const m of LOCAL_MODELS) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.label;
    sel.appendChild(o);
  }
  // A saved model that's no longer in the curated list is stale — ignore it.
  if (LOCAL_MODELS.some((m) => m.id === getLocalModel())) sel.value = getLocalModel();
  else setLocalModel("");
  if (!gpuAvailable()) (document.getElementById("local-section") as HTMLElement).hidden = true;
}

onClick("getkey", () => window.open("https://openrouter.ai/keys", "_blank"));

onClick("savekey", () => {
  setKey(inputValue("key"));
  if (hasKey()) {
    setProvider("openrouter");
    showOnboard(false);
    note("Connected! You're all set.");
    say("All connected. What shall we do first?");
  } else {
    note("That looks empty — paste the whole key, it starts with sk-or-…");
  }
});

// Optional model override (paid keys can point at Claude/GPT/etc.); persisted,
// blank falls back to the free default.
(document.getElementById("model") as HTMLInputElement).value = getStoredModel();
onClick("savemodel", () => {
  setModel(inputValue("model"));
  const m = getStoredModel();
  note(m ? `Model set to ${m}.` : "Using the free default model.");
});

// Autocomplete the model field from OpenRouter's catalogue — nobody remembers
// those ids. Fetched once, lazily, on first focus (no cost if never opened);
// filtered to tool-capable models since a model without tools can't act.
// Offline / fetch failure just leaves the field as free-text entry.
{
  const el = document.getElementById("model") as HTMLInputElement;
  let loaded = false;
  el.addEventListener("focus", async () => {
    if (loaded) return;
    loaded = true;
    try {
      const { data } = await fetch("https://openrouter.ai/api/v1/models").then((r) => r.json());
      const list = document.getElementById("model-list") as HTMLDataListElement;
      const tooled = (data as any[])
        .filter((m) => (m.supported_parameters ?? []).includes("tools"))
        .sort((a, b) => a.id.localeCompare(b.id));
      for (const m of tooled) {
        const o = document.createElement("option");
        o.value = m.id;
        o.label = m.id.endsWith(":free") ? `${m.name} — free` : m.name;
        list.appendChild(o);
      }
    } catch {
      loaded = false; // let a later focus retry
    }
  });
}

onClick("uselocal", async () => {
  const id = inputValue("localmodel");
  if (await loadLocalModel(id)) {
    setLocalModel(id);
    setProvider("local");
    showOnboard(false);
    say("I'm now thinking right here on your computer — no account, and nothing goes online. What shall we do first?");
  }
});

// If they chose on-device last time, warm it up again (weights come from cache).
if (getProvider() === "local" && getLocalModel() && gpuAvailable()) {
  loadLocalModel(getLocalModel());
}

// The ⚙ button just reopens the connection card.
onClick("settings", () => showOnboard(true));

// Optional MCP tool servers: several at once, each with an optional bearer
// token, persisted and reconnected at boot.
function renderMcpServers() {
  const holder = document.getElementById("mcp-servers")!;
  holder.innerHTML = "";
  for (const s of mcpServers()) {
    const chip = document.createElement("button");
    chip.className = "ghost";
    chip.textContent = `🔌 ${s.url}  ✕`;
    chip.title = "Disconnect this server";
    chip.addEventListener("click", async () => {
      await disconnectMcp(s.url);
      setMcpServers(getMcpServers().filter((x) => x.url !== s.url));
      renderMcpServers();
      note("Tool server removed.");
    });
    holder.appendChild(chip);
  }
}
renderMcpServers();

onClick("savemcp", async () => {
  const url = inputValue("mcpurl").trim();
  if (!url) {
    note("Paste a server URL first.");
    return;
  }
  const token = inputValue("mcptoken").trim();
  await connectMcp(url, token || undefined);
  if (mcpServers().some((s) => s.url === url)) {
    // Connected OK — persist it (replacing any stale entry for the same url).
    setMcpServers([...getMcpServers().filter((s) => s.url !== url), { url, token: token || undefined }]);
    (document.getElementById("mcpurl") as HTMLInputElement).value = "";
    (document.getElementById("mcptoken") as HTMLInputElement).value = "";
    renderMcpServers();
  }
});

// Folder sharing needs the File System Access API — Chrome/Edge only.
const FSA_OK = "showDirectoryPicker" in window;
if (!FSA_OK) (document.getElementById("pick") as HTMLButtonElement).style.opacity = "0.55";

onClick("pick", async () => {
  if (!FSA_OK) {
    note(
      "Sharing a folder only works in Chrome or Edge — this browser doesn't allow web pages " +
        "to work with folders yet. I can still chat and do everything else right here."
    );
    return;
  }
  try {
    const { name, path } = await mountUserFolder();
    await shellCd(path); // the shell now starts where the user's files are
    showFolderChip(name);
    note(`Now working with your “${name}” folder.`);
  } catch (e) {
    if ((e as Error).name !== "AbortError") error("I couldn't open that folder: " + (e as Error).message);
  }
});

// Upload fallback: works on any browser (Firefox/Safari can't share a folder).
// Chosen files land in /scratch, where both python_exec and shell can see them.
{
  const fileInput = document.getElementById("fileinput") as HTMLInputElement;
  onClick("attach", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    for (const file of Array.from(fileInput.files ?? [])) {
      try {
        const path = await uploadToScratch(file);
        note(`📎 Uploaded “${file.name}” to ${path}.`);
      } catch (e) {
        error(`Couldn't upload “${file.name}”: ${(e as Error).message}`);
      }
    }
    fileInput.value = ""; // let the same file be re-uploaded
  });
}

let busy = false;
async function send(textOverride?: string, wf?: { title: string; body: string }) {
  const box = document.getElementById("msg") as HTMLTextAreaElement;
  const text = (textOverride ?? box.value).trim();
  if (!text) return;
  if (busy) {
    note("I'm still on the last thing — give me a moment, then send it again. (Or hit ⏹ Stop.)");
    return;
  }
  if (!textOverride) {
    box.value = "";
    box.style.height = "auto";
  }
  if (wf) workflowSay(wf.title, wf.body);
  else userSay(text);
  if (getProvider() === "local") {
    if (!localReady()) {
      note("My on-device brain is still warming up — give it a moment, then ask again.");
      return;
    }
  } else if (!hasKey()) {
    showOnboard(true);
    note("First I need that free key from step 1 above — then ask me again!");
    return;
  }
  busy = true;
  status("think");
  thinking(true);
  showStop(true);
  try {
    await runAgent(text);
  } catch (e) {
    error("Something went wrong on my side: " + (e as Error).message);
  } finally {
    thinking(false);
    status("ready");
    busy = false;
    showStop(false);
  }
}

// While a turn is in flight, swap Send for a Stop button that aborts it
// (kills the in-flight request and ends the loop).
const stopBtn = document.getElementById("stop") as HTMLButtonElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
function showStop(on: boolean) {
  stopBtn.hidden = !on;
  sendBtn.hidden = on;
}
onClick("stop", () => stopAgent());

onClick("send", () => send());

// The composer grows upward as the message gets longer (capped in CSS);
// Enter sends, Shift+Enter makes a new line.
const msgBox = document.getElementById("msg") as HTMLTextAreaElement;
function autoGrow() {
  msgBox.style.height = "auto";
  msgBox.style.height = msgBox.scrollHeight + "px";
}
msgBox.addEventListener("input", autoGrow);
msgBox.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

// ---- workflows: consent card (from a link or from the recents list) ----
let activeWf: Workflow | null = null;
let wfFromLink = false;
const wfCard = document.getElementById("wfcard") as HTMLElement;
const wfParamsEl = document.getElementById("wf-params")!;

function offerWorkflow(wf: Workflow, fromLink: boolean) {
  activeWf = wf;
  wfFromLink = fromLink;
  document.getElementById("wf-title")!.textContent = wf.title
    ? (fromLink ? `This link asks me to: ${wf.title}` : `Run again: ${wf.title}`)
    : "These instructions were shared with me";
  document.getElementById("wf-intro")!.textContent = fromLink
    ? "Someone packed a task into this link. Here's exactly what they're asking me to do — I won't start until you say so, and you should only run it if you trust the sender."
    : "You've run this before. Here's exactly what it does — nothing starts until you click Run.";
  document.getElementById("wf-body")!.textContent = wf.instructions;
  wfParamsEl.innerHTML = "";
  for (const name of workflowParams(wf.instructions)) {
    const row = document.createElement("div");
    row.className = "step";
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = name; // param names come from attacker-controlled #wf= links — never innerHTML
    row.appendChild(chip);
    const input = document.createElement("input");
    input.dataset.param = name;
    input.placeholder = name;
    input.style.flex = "1";
    row.appendChild(input);
    wfParamsEl.appendChild(row);
  }
  document.getElementById("chat")!.appendChild(wfCard); // keep it in conversation flow
  wfCard.hidden = false;
  wfCard.scrollIntoView({ behavior: "smooth", block: "center" });
}

const closeWf = () => {
  wfCard.hidden = true;
  history.replaceState(null, "", location.pathname + location.search);
};

onClick("wf-skip", () => {
  const fromLink = wfFromLink;
  closeWf();
  note("Okay, ignored.");
  if (fromLink) say(WELCOME);
});

onClick("wf-run", () => {
  if (!activeWf) return;
  const values: Record<string, string> = {};
  for (const input of wfParamsEl.querySelectorAll("input")) {
    if (!input.value.trim()) {
      input.focus();
      note("Fill in the blanks above first, then hit Run.");
      return;
    }
    values[input.dataset.param!] = input.value.trim();
  }
  closeWf();
  rememberWorkflow(activeWf);
  renderRecents();
  const filled = fillParams(activeWf.instructions, values);
  send("Please carry out these instructions now:\n\n" + filled, {
    title: activeWf.title ?? "from a link",
    body: filled,
  });
});

// The last few workflows the user ran, re-offerable from the ⚙ card.
function renderRecents() {
  const recents = recentWorkflows();
  (document.getElementById("recent-section") as HTMLElement).hidden = recents.length === 0;
  const holder = document.getElementById("recent-wfs")!;
  holder.innerHTML = "";
  for (const wf of recents) {
    const b = document.createElement("button");
    b.className = "ghost";
    b.textContent = "📦 " + wf.title;
    b.addEventListener("click", () => {
      showOnboard(false);
      offerWorkflow(wf, false);
    });
    holder.appendChild(b);
  }
}
renderRecents();

// A workflow arriving in the URL fragment — never auto-run.
(async () => {
  const wf = WF_LINK ? await decodeWorkflowHash(location.hash).catch(() => null) : null;
  if (!wf) {
    if (WF_LINK) say(WELCOME); // malformed link — fall back to the normal intro
    return;
  }
  offerWorkflow(wf, true);
})();

// ---- dictation: local Parakeet ASR streaming into the textbox ----
{
  const micBtn = document.getElementById("mic") as HTMLButtonElement;
  if (!asrSupported()) micBtn.hidden = true;
  let armed = false;
  let baseText = "";
  let switching = false; // ignore clicks while loading the model / opening the mic
  onClick("mic", async () => {
    if (switching) return;
    const box = document.getElementById("msg") as HTMLTextAreaElement;
    if (dictating()) {
      switching = true;
      micBtn.classList.remove("rec");
      micBtn.textContent = "…";
      try {
        const final = await stopDictation();
        if (final) {
          box.value = baseText + final;
          autoGrow();
        }
        box.focus();
      } finally {
        micBtn.textContent = "🎤";
        switching = false;
      }
      return;
    }
    switching = true;
    try {
      if (!asrReady()) {
        if (!armed) {
          armed = true;
          note(
            "To take dictation I need to download a speech model first — Parakeet, about 620 MB, " +
              "one time. It listens entirely on this computer; your voice never goes online. " +
              "Click the mic again to start the download."
          );
          return;
        }
        if (!(await loadAsr())) {
          armed = false;
          return;
        }
      }
      baseText = box.value ? box.value.replace(/\s+$/, "") + " " : "";
      await startDictation();
      micBtn.classList.add("rec");
      micBtn.textContent = "⏹";
      note("Listening… click ⏹ when you're done and I'll write it all out.");
    } catch (e) {
      error("I couldn't use the microphone: " + (e as Error).message);
    } finally {
      switching = false;
    }
  });
}

// ---- save-a-copy: the whole app is one file, so it can hand itself out ----
// A downloaded copy is frozen at whatever build it was saved from, so on
// file:// the footer points home for the freshest version instead.
const HOME_URL = "https://luqs1.github.io/tab-agent/";
if (location.protocol === "file:") {
  const a = document.getElementById("savecopy") as HTMLAnchorElement;
  a.textContent = "Go to " + HOME_URL.replace(/^https:\/\//, "").replace(/\/$/, "");
  a.href = HOME_URL;
  a.target = "_blank";
  a.rel = "noreferrer";
  document.getElementById("savecopy-tail")!.textContent = " for the most up-to-date version of me.";
} else {
  onClick("savecopy", async () => {
    try {
      const html = await fetch(location.href).then((r) => r.text());
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      a.download = "tab.agent.html";
      a.click();
      URL.revokeObjectURL(a.href);
      note("Saved! Anyone can double-click that file to get their own tab.agent.");
    } catch {
      note("Couldn't grab my own file here — you can share this page's link instead.");
    }
  });
}

(async () => {
  await ready;
  status("ready");
  if (!scratchPersists)
    note("Heads up: running from a local file, so my scratch notes vanish on reload. Your real folder is unaffected.");
  // The build-time default server (if any), then every saved one.
  if (MCP_URL && !getMcpServers().some((s) => s.url === MCP_URL)) await connectMcp(MCP_URL);
  for (const s of getMcpServers()) await connectMcp(s.url, s.token);
  renderMcpServers();
})();

// ---- update check: compare our build id against the freshly served page ----
// Long-lived tabs miss deploys (bit us in practice: a stale tab kept failing
// on a withdrawn model). When the server's build differs, the ⟳ next to the
// version starts breathing; clicking it reloads.
{
  const ownBuild = (document.querySelector('meta[name="ta-build"]') as HTMLMetaElement)?.content;
  const updBtn = document.getElementById("update") as HTMLButtonElement;
  updBtn.addEventListener("click", () => location.reload());
  async function checkForUpdate() {
    if (location.protocol === "file:" || !ownBuild || ownBuild.includes("%")) return;
    try {
      const html = await fetch(location.pathname, { cache: "no-store" }).then((r) => r.text());
      const served = html.match(/name="ta-build" content="([^"]+)"/)?.[1];
      if (served && served !== ownBuild) updBtn.hidden = false;
    } catch {}
  }
  setTimeout(checkForUpdate, 15_000);
  setInterval(checkForUpdate, 15 * 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
}

// Debug handle: lets devtools reach the app's live module instances.
import { runShell } from "./shell";
import { userMount } from "./pyenv";
(window as any).__tabagent = { runShell, userMount };
