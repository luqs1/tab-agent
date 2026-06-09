// Wiring: boot pyodide, connect MCP, hook up the friendly chat shell.
import {
  say, userSay, workflowSay, note, error, status, thinking,
  onClick, inputValue, showOnboard, showFolderChip,
} from "./ui";
import { asrSupported, asrReady, loadAsr, startDictation, stopDictation, dictating } from "./asr";
import { ready, mountUserFolder, scratchPersists } from "./pyenv";
import { shellCd } from "./shell";
import { decodeWorkflowHash, workflowParams, fillParams } from "./wf";
import { connectMcp } from "./mcp";
import { runAgent } from "./agent";
import {
  setKey, hasKey, getProvider, setProvider, getLocalModel, setLocalModel,
} from "./settings";
import { LOCAL_MODELS, loadLocalModel, localReady, gpuAvailable } from "./local";

// Point this at any browser-CORS-friendly MCP server.
const MCP_URL = import.meta.env.VITE_MCP_URL;

const WELCOME =
  "Hi! I'm **tab.agent** 👋 I live entirely in this browser tab and can help " +
  "with everyday computer chores — tidying folders, renaming photos, summarizing " +
  "documents, making lists. Your files stay on your computer.\n\n" +
  "Use **📁 Share a folder** (top right) to let me work with your real files, " +
  "then just tell me what you need.";

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

let busy = false;
async function send(textOverride?: string, wf?: { title: string; body: string }) {
  const box = document.getElementById("msg") as HTMLTextAreaElement;
  const text = (textOverride ?? box.value).trim();
  if (!text || busy) return;
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
  try {
    await runAgent(text);
  } catch (e) {
    error("Something went wrong on my side: " + (e as Error).message);
  } finally {
    thinking(false);
    status("ready");
    busy = false;
  }
}

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

// ---- workflows in the URL fragment (#wf=…) — consent card, never auto-run ----
(async () => {
  const wf = WF_LINK ? await decodeWorkflowHash(location.hash).catch(() => null) : null;
  if (!wf) {
    if (WF_LINK) say(WELCOME); // malformed link — fall back to the normal intro
    return;
  }
  const card = document.getElementById("wfcard") as HTMLElement;
  if (wf.title) document.getElementById("wf-title")!.textContent = `This link asks me to: ${wf.title}`;
  document.getElementById("wf-body")!.textContent = wf.instructions;
  const names = workflowParams(wf.instructions);
  const paramsEl = document.getElementById("wf-params")!;
  for (const name of names) {
    const row = document.createElement("div");
    row.className = "step";
    row.innerHTML = `<span class="chip">${name}</span>`;
    const input = document.createElement("input");
    input.dataset.param = name;
    input.placeholder = name;
    input.style.flex = "1";
    row.appendChild(input);
    paramsEl.appendChild(row);
  }
  const close = () => {
    card.hidden = true;
    history.replaceState(null, "", location.pathname + location.search);
  };
  onClick("wf-skip", () => {
    close();
    note("Okay, ignored. The link's instructions are gone.");
    say(WELCOME);
  });
  onClick("wf-run", () => {
    const values: Record<string, string> = {};
    for (const input of paramsEl.querySelectorAll("input")) {
      if (!input.value.trim()) {
        input.focus();
        note("Fill in the blanks above first, then hit Run.");
        return;
      }
      values[input.dataset.param!] = input.value.trim();
    }
    close();
    const filled = fillParams(wf.instructions, values);
    send("Please carry out these instructions now:\n\n" + filled, {
      title: wf.title ?? "from a link",
      body: filled,
    });
  });
  card.hidden = false;
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
  if (MCP_URL) await connectMcp(MCP_URL);
})();

// Debug handle: lets devtools reach the app's live module instances.
import { runShell } from "./shell";
import { userMount } from "./pyenv";
(window as any).__tabagent = { runShell, userMount };
