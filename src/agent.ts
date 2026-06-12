// The agent loop: LLM -> tool calls -> execute -> feed results back -> repeat.
//
// Uses the OpenAI chat-completions format. The browser calls OpenRouter directly
// (it sends permissive CORS) — there is no backend.
import { say, note, error, activity, thinking, streamingSay } from "./ui";
import { runPython, userMount, downloadSandboxFile } from "./pyenv";
import { runShell } from "./shell";
import { callMcp, mcpTools } from "./mcp";
import { loadSkills } from "./skills";
import { getKey, getModel, getProvider, FALLBACK_MODELS } from "./settings";
import { localComplete, localReady } from "./local";
import { writeInstaller } from "./installer";
import { encodeWorkflowLink } from "./wf";
import {
  bridgePresent,
  tabsList,
  tabOpen,
  tabClose,
  tabNavigate,
  pageRead,
  pageEval,
  pageClick,
  pageFill,
} from "./bridge";
import { cloneRepo } from "./gitclone";

// The key comes from localStorage (see settings.ts).
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function systemPrompt(): string {
  const mount = userMount();
  const folders = mount
    ? `The user shared their real folder "${mount.name}" — it is mounted at ${mount.path}
(same name as on their computer; the shell starts there). Work on their files THERE.
There is also a persistent scratch dir at /scratch for temporary work.`
    : `The user has NOT shared a folder yet, so you cannot see their real files —
if the task needs them, ask them to click "Share a folder" (top right). You do
have a persistent scratch dir at /scratch for your own work.`;

  return `You are tab.agent, a friendly helper that runs entirely inside a browser tab.
Your user may not be technical: reply in warm, plain language, keep answers short,
and never paste big blobs of code or output into chat — do the work with your tools
and describe the result simply.
You have a Python sandbox (tool: python_exec) and a bash-like shell (tool: shell).
Both tools share ONE filesystem; a file written by one is visible to the other.
${folders}
Files move without a shared folder too: the user can upload files (they land in
/scratch with the 📎 button), and you can hand any sandbox file back to them with
download_file — use it to deliver a result when no folder is shared.
Prefer python_exec for real work; use shell for quick file ops and pipelines.
python_exec accepts ONLY Python source; shell accepts ONLY bash. If a tool call
errors, change your approach — never repeat the identical call.

You run in a browser sandbox, so you CANNOT install system software or run native
tools (brew, system pip, arbitrary binaries) yourself. When a task needs that, do
NOT pretend you can. Instead call write_installer to generate a script the user
runs once to grant that access, and briefly tell them what it will do. Keep the
script minimal, idempotent, and safe. Do everything else (reading/writing their
files, analysis, scaffolding) directly in the sandbox.${getProvider() === "local" ? "" : loadSkills()}`;
  // On-device, prefill runs at tens of tokens/sec — every KB of prompt costs
  // seconds before the first token, so skills are left out of the local path.
}

// Built-in tools in OpenAI function-calling format.
function builtinTools() {
  const mount = userMount();
  const files = mount
    ? `Files: the user's folder "${mount.name}" is at ${mount.path}; /scratch for temp work.`
    : "Files: /scratch only (the user hasn't shared a folder yet).";
  return [
    {
      type: "function",
      function: {
        name: "python_exec",
        description: `Run PYTHON source code (never shell syntax). ${files}`,
        parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
      },
    },
    {
      type: "function",
      function: {
        name: "shell",
        description: `Run a BASH command (echo/ls/grep/sed/cat/mkdir/…), never Python. Same filesystem as python_exec.`,
        parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      },
    },
    {
      type: "function",
      function: {
        name: "download_file",
        description:
          "Hand a file from the sandbox to the user as a browser download. Use this to give back a result they can't otherwise reach — e.g. when no folder is shared.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "sandbox path, e.g. /scratch/report.csv" } },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "make_workflow_link",
        description:
          "Pack instructions (e.g. an install.md or a repeatable chore) into a shareable tab.agent link. Anyone opening the link sees the instructions and can run them in their own tab.agent after confirming. Use {{name}} placeholders for values the recipient should fill in.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "short human title, e.g. \"Set up Claude Code\"" },
            instructions: { type: "string", description: "the full instructions, markdown welcome" },
          },
          required: ["instructions"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_installer",
        description:
          "Generate a script the user runs once to perform actions the sandbox can't (install software, run native tools). Downloads a click-to-run .zip (double-click zip → double-click setup.command, no terminal typing) and explains the clicks.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: 'e.g. "setup" -> setup.command' },
            script: { type: "string", description: "bash to run on the user's machine; minimal and idempotent" },
          },
          required: ["name", "script"],
        },
      },
    },
  ];
}

// Offered only when the companion extension is connected — it's what makes the
// CORS-free git fetch possible.
const gitCloneTool = () => ({
  type: "function",
  function: {
    name: "git_clone",
    description:
      "Clone a PUBLIC git repository (GitHub) into the shared folder using the real git protocol, via the connected tab.agent extension. Lands a full working tree where shell and python_exec can see it. Input: \"owner/repo\" or a full https URL.",
    parameters: {
      type: "object",
      properties: { repository: { type: "string", description: 'e.g. "octocat/Hello-World"' } },
      required: ["repository"],
    },
  },
});

// Browser-automation tools — offered only when the companion extension is
// connected. They drive real Chrome tabs (open, inspect, interact), turning
// tab.agent into an automation harness instead of a sandboxed-only chat.
function browserTools() {
  const fn = (name: string, description: string, properties: any, required: string[]) => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  });
  return [
    fn(
      "browser_open",
      "Open a URL in a new real browser tab and wait for it to load. Returns its tabId (use it with the other browser_* tools) plus the final url and title.",
      { url: { type: "string", description: "absolute URL, e.g. https://example.com" } },
      ["url"],
    ),
    fn("browser_tabs", "List the user's currently open browser tabs (tabId, url, title).", {}, []),
    fn(
      "browser_read",
      "Read a tab's RENDERED content (works cross-origin — no CORS limit): its title, visible text, and links. Use this to inspect or scrape a page the user has open or that you opened.",
      { tabId: { type: "number", description: "from browser_open or browser_tabs" } },
      ["tabId"],
    ),
    fn(
      "browser_eval",
      "Run a JavaScript expression in a tab's page context and get its (JSON-stringified) value. Powerful: read DOM, computed values, page globals. Subject to that page's CSP.",
      {
        tabId: { type: "number" },
        expression: { type: "string", description: "e.g. document.querySelectorAll('h2').length" },
      },
      ["tabId", "expression"],
    ),
    fn(
      "browser_click",
      "Click the first element matching a CSS selector in a tab.",
      { tabId: { type: "number" }, selector: { type: "string", description: "CSS selector" } },
      ["tabId", "selector"],
    ),
    fn(
      "browser_fill",
      "Set the value of an input/textarea matching a CSS selector (fires input & change events).",
      { tabId: { type: "number" }, selector: { type: "string" }, value: { type: "string" } },
      ["tabId", "selector", "value"],
    ),
    fn(
      "browser_navigate",
      "Navigate an existing tab to a new URL and wait for load.",
      { tabId: { type: "number" }, url: { type: "string" } },
      ["tabId", "url"],
    ),
    fn("browser_close", "Close a browser tab by tabId.", { tabId: { type: "number" } }, ["tabId"]),
  ];
}

function allTools() {
  return [
    ...builtinTools(),
    ...(bridgePresent() ? [gitCloneTool(), ...browserTools()] : []),
    ...mcpTools().map((t) => ({
      type: "function",
      function: {
        name: "mcp__" + t.name,
        description: t.description ?? "",
        parameters: t.inputSchema ?? { type: "object", properties: {} },
      },
    })),
  ];
}

async function dispatch(name: string, args: any): Promise<string> {
  if (name === "python_exec") return runPython(args.code);
  if (name === "shell") return runShell(args.command);
  if (name === "download_file") return downloadSandboxFile(args.path);
  if (name === "git_clone") {
    const r = await cloneRepo(args.repository);
    return `Cloned ${args.repository} into ${r.dir} (${r.commits} commits, HEAD ${r.head.slice(0, 8)} "${r.headMsg}"). Top-level: ${r.files.join(", ")}. The files are in the shared filesystem now — use shell or python_exec to work with them.`;
  }
  if (name.startsWith("browser_")) return dispatchBrowser(name, args);
  if (name === "make_workflow_link") {
    const url = await encodeWorkflowLink({ title: args.title, instructions: args.instructions });
    return `Link created (${url.length} chars — fragment stays on-device, never sent to any server):\n${url}\nShow it to the user as a markdown link they can copy.`;
  }
  if (name === "write_installer") return writeInstaller(args.name, args.script);
  if (name.startsWith("mcp__")) return callMcp(name.slice(5), args);
  return `unknown tool: ${name}`;
}

// Browser-automation tools, dispatched to the extension bridge. Each returns a
// short text summary the model can act on.
async function dispatchBrowser(name: string, args: any): Promise<string> {
  switch (name) {
    case "browser_open": {
      const t = await tabOpen(args.url);
      return `Opened tab ${t.tabId}: "${t.title ?? ""}" (${t.url}). Use tabId ${t.tabId} with the other browser_* tools.`;
    }
    case "browser_tabs": {
      const { tabs } = await tabsList();
      if (!tabs.length) return "No open tabs.";
      return tabs.map((t) => `#${t.tabId}${t.active ? "*" : ""} ${t.title ?? ""} — ${t.url ?? ""}`).join("\n");
    }
    case "browser_read": {
      const p = await pageRead(args.tabId);
      const links = p.links
        .slice(0, 50)
        .map((l) => `- ${l.text || "(no text)"} → ${l.href}`)
        .join("\n");
      return `# ${p.title}\n${p.url}\n\n${p.text}\n\n## Links\n${links}`;
    }
    case "browser_eval": {
      const r = await pageEval(args.tabId, args.expression);
      return r.error ? `Error: ${r.error}` : (r.value ?? "undefined");
    }
    case "browser_click": {
      const r = await pageClick(args.tabId, args.selector);
      return r.found ? `Clicked ${args.selector}.` : `No element matched ${args.selector}.`;
    }
    case "browser_fill": {
      const r = await pageFill(args.tabId, args.selector, args.value ?? "");
      return r.found ? `Filled ${args.selector}.` : `No element matched ${args.selector}.`;
    }
    case "browser_navigate": {
      const t = await tabNavigate(args.tabId, args.url);
      return `Tab ${t.tabId} is now at ${t.url} ("${t.title ?? ""}").`;
    }
    case "browser_close": {
      await tabClose(args.tabId);
      return `Closed tab ${args.tabId}.`;
    }
  }
  return `unknown browser tool: ${name}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A hung OpenRouter request must not freeze the turn: each fetch gets its own
// timeout, and the whole run is cancellable from a Stop button. Worst case used
// to be 4 fallback models × 2 attempts of unkillable hangs.
const REQUEST_TIMEOUT_MS = 60_000;
let runController: AbortController | null = null; // user-stop for the active run
let stopped = false;

/** True while a turn is in flight (the Stop button shows only then). */
export function agentBusy(): boolean {
  return runController !== null;
}

/** Abort the in-flight turn: kills the current request and ends the loop. */
export function stopAgent() {
  stopped = true;
  runController?.abort();
}

// One signal that fires when EITHER input does (user stop OR per-request
// timeout). AbortSignal.any isn't in every target, so combine by hand.
function anySignal(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort();
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

// Free/local models run with small context windows; one `cat` of a big file or
// a chatty script can blow the next completion. Cap each tool result, keeping
// the head and tail (the start sets up the result; the tail usually carries the
// error/answer) and marking what was dropped so the model knows it's partial.
const MAX_TOOL_CHARS = 8000;
function clampToolOutput(out: string): string {
  if (out.length <= MAX_TOOL_CHARS) return out;
  const half = Math.floor(MAX_TOOL_CHARS / 2);
  const dropped = out.length - MAX_TOOL_CHARS;
  return (
    out.slice(0, half) +
    `\n\n…[${dropped} characters trimmed to fit — re-run targeting just the part you need, e.g. grep/head/tail or slice the file]…\n\n` +
    out.slice(out.length - half)
  );
}

// A live text sink (see ui.streamingSay): tokens flow in as they arrive.
type Sink = { push(delta: string): void; reset(): void };

// One streaming call to one model. Renders content deltas into `sink` as they
// arrive and reassembles the final OpenAI-shaped response (content + tool_calls
// rebuilt from their fragments) so the agent loop is unchanged. Returns an
// { error } object on any failure, matching the non-streaming shape.
async function streamOnce(key: string, model: string, messages: any[], sink: Sink, signal: AbortSignal): Promise<any> {
  let resp: Response;
  try {
    resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "HTTP-Referer": location.origin,
        "X-Title": "tab.agent",
      },
      body: JSON.stringify({ model, messages, tools: allTools(), tool_choice: "auto", stream: true }),
      signal,
    });
  } catch (e) {
    if (signal.aborted) return { aborted: true }; // user Stop or per-request timeout
    return { error: { message: (e as Error).message } };
  }

  if (!resp.ok) {
    // Errors (429, model withdrawn, bad key) arrive as a normal JSON body
    // before any stream starts — parse it and let the caller's fallback decide.
    const body = await resp.json().catch(() => ({}));
    return { error: { code: resp.status, status: resp.status, ...(body.error ?? {}) } };
  }

  // Some models/providers ignore stream:true and return a plain JSON completion.
  // Detect that and hand it back whole (the loop will render it after the fact).
  // Reset first: a previous model may have streamed partial text into the sink,
  // which would otherwise shadow this completion's content in the loop.
  if (!resp.headers.get("content-type")?.includes("text/event-stream")) {
    sink.reset();
    return resp.json().catch((e) => ({ error: { message: (e as Error).message } }));
  }

  sink.reset(); // clear any partial text left by a previous failed model
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  const toolCalls: any[] = []; // indexed by delta.tool_calls[].index
  let finish: string | null = null;
  let streamErr: any = null;

  for (;;) {
    let done: boolean, value: Uint8Array | undefined;
    try {
      ({ done, value } = await reader.read());
    } catch (e) {
      if (signal.aborted) return { aborted: true }; // Stop or timeout mid-stream
      return { error: { message: (e as Error).message } };
    }
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue; // skip SSE comments / keep-alives
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error) {
        streamErr = json.error;
        continue;
      }
      const choice = json.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (delta.content) {
        content += delta.content;
        sink.push(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? 0;
        if (!toolCalls[i]) toolCalls[i] = { id: tc.id, type: "function", function: { name: "", arguments: "" } };
        if (tc.id) toolCalls[i].id = tc.id;
        if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }

  if (streamErr) return { error: streamErr };
  const message: any = { role: "assistant", content: content || null };
  const calls = toolCalls.filter(Boolean);
  if (calls.length) message.tool_calls = calls;
  return { choices: [{ message, finish_reason: finish }] };
}

// Free models get rate-limited. Try the user's model first, then fall through
// the free fallbacks; retry each once on 429 before moving on. `sink` receives
// streamed tokens (unused by the non-streaming on-device path); `signal` is the
// user-stop, combined per attempt with a request timeout.
async function complete(key: string, messages: any[], sink: Sink, signal: AbortSignal): Promise<any> {
  if (getProvider() === "local") return localComplete(messages, allTools());
  const models = [getModel(), ...FALLBACK_MODELS.filter((m) => m !== getModel())];
  let last: any = { error: { message: "no models attempted" } };
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const timeout = new AbortController();
      const t = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
      let resp: any;
      try {
        resp = await streamOnce(key, model, messages, sink, anySignal([signal, timeout.signal]));
      } finally {
        clearTimeout(t);
      }
      if (resp.aborted) {
        if (signal.aborted) return { stopped: true }; // user hit Stop — bail out entirely
        // A timeout looks like a transient 5xx so it gets the one retry below.
        resp = { error: { message: "That took too long, so I gave up on it.", code: 504 } };
      }
      const code = resp.error?.code ?? resp.error?.status;
      if (!resp.error) return resp;
      last = resp;
      if (code === 401 || code === 403) return resp; // bad key — retrying won't help
      if ((code === 429 || code >= 500) && attempt === 0) {
        note("It's a little busy right now — giving it another try…");
        await sleep(2500);
        continue;
      }
      // Anything else — model withdrawn, 404, repeated 429 — try the next model.
      // The free tier shifts constantly; a dead default mustn't kill the agent.
      note("That model isn't answering — switching to a backup model…");
      break;
    }
  }
  return last;
}

// Plain-language descriptions of what each tool call is doing.
function describe(name: string, args: any): { label: string; detail?: string } {
  if (name === "python_exec") return { label: "doing a bit of work behind the scenes…", detail: args.code };
  if (name === "shell") return { label: "looking through the files…", detail: args.command };
  if (name === "download_file") return { label: "saving that to your computer…", detail: args.path };
  if (name === "git_clone") return { label: "cloning that repository…", detail: args.repository };
  if (name === "browser_open") return { label: "opening a browser tab…", detail: args.url };
  if (name === "browser_tabs") return { label: "checking your open tabs…" };
  if (name === "browser_read") return { label: "reading that page…", detail: `tab ${args.tabId}` };
  if (name === "browser_eval") return { label: "inspecting that page…", detail: args.expression };
  if (name === "browser_click") return { label: "clicking on the page…", detail: args.selector };
  if (name === "browser_fill") return { label: "filling that in…", detail: `${args.selector} = ${args.value}` };
  if (name === "browser_navigate") return { label: "navigating that tab…", detail: args.url };
  if (name === "browser_close") return { label: "closing a tab…", detail: `tab ${args.tabId}` };
  if (name === "write_installer") return { label: "preparing a one-click setup file for you…", detail: args.script };
  if (name === "make_workflow_link") return { label: "packing that into a shareable link…", detail: args.instructions };
  return { label: `using ${name.replace(/^mcp__/, "")}…`, detail: JSON.stringify(args, null, 2) };
}

// The running conversation, kept across sends so the agent remembers earlier
// turns: follow-ups ("rename that file", "what did you find?") and "keep going"
// after a maxTurns pause all need the prior messages. Lives for the session.
const history: any[] = [];

export async function runAgent(userText: string, maxTurns = 10) {
  const key = getKey();
  if (!key && !(getProvider() === "local" && localReady())) return; // main.ts reopens onboarding

  // Keep one running history. Refresh the system prompt each turn — the folder
  // mount (and so the file guidance) can change between sends.
  const sys = { role: "system", content: systemPrompt() };
  if (history.length === 0) history.push(sys);
  else history[0] = sys;
  history.push({ role: "user", content: userText });
  const messages = history;

  const seenCalls = new Map<string, number>(); // small local models love repeating a failing call

  stopped = false;
  runController = new AbortController();
  const signal = runController.signal;
  try {
  for (let turn = 0; turn < maxTurns; turn++) {
    thinking(true);
    const stream = streamingSay();
    const resp = await complete(key, messages, stream, signal);
    thinking(false);

    if (stopped || resp.stopped) {
      stream.done(); // finalize whatever streamed before the stop
      note("Okay — I've stopped.");
      return;
    }

    if (resp.error) {
      stream.reset();
      stream.done(); // drop the bubble — any partial text came from a dead stream
      const detail = resp.error.message ?? JSON.stringify(resp.error);
      error(
        resp.error.code === 401
          ? "That key didn't work — open ⚙ and check it was pasted in full."
          : "I hit a snag talking to my model: " + detail
      );
      return;
    }

    const msg = resp.choices?.[0]?.message;
    if (!msg) {
      stream.reset();
      stream.done();
      error("I got a reply I didn't understand. Mind trying that again?");
      return;
    }

    stream.done(); // finalize the live bubble (or drop it if nothing streamed)

    messages.push(msg); // push the assistant turn verbatim (keeps tool_calls intact)
    // Streamed content is already on screen; only say() what wasn't streamed
    // (the on-device path, or a model that returned plain JSON).
    if (msg.content && !stream.text) say(msg.content);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      // NEVER end a turn in silence. Measured failure on-device: a misfired
      // generation (unparseable tool-call text) returns no content and no
      // calls — the user watched dots for 5 minutes and then got nothing.
      if (!msg.content) {
        note(
          seenCalls.size > 0
            ? "I've finished working on that — ask me to double-check the result if you like."
            : "Hmm, I didn't manage to put an answer together that time — mind asking again, maybe a bit differently?"
        );
      }
      return;
    }

    for (const call of calls) {
      if (stopped) {
        note("Okay — I've stopped.");
        return;
      }
      const name = call.function.name;
      let args: any = {};
      let badArgs: string | null = null;
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        // Don't silently run with {} — that hides the real problem (e.g.
        // runPython(undefined)). Tell the model its arguments didn't parse so
        // it can resend them; small local models especially need this nudge.
        badArgs = call.function.arguments ?? "";
      }
      const { label, detail } = describe(name, args);
      const done = activity(label, detail);
      // A throwing tool (e.g. an MCP network blip) must not kill the run: turn
      // the error into a tool result the model can react to, and always clear
      // the spinner. Then cap the result to protect the context window.
      let out: string;
      if (badArgs !== null) {
        out = `[bad arguments] The arguments for ${name} were not valid JSON, so the call didn't run. You sent: ${badArgs}\nResend the call with valid JSON arguments.`;
      } else {
        try {
          out = await dispatch(name, args);
        } catch (e) {
          out = `[tool error] ${(e as Error).message ?? String(e)}`;
        }
      }
      // make_workflow_link returns a #wf= URL that IS the payload — clamping it
      // would replace the fragment's middle with the trim marker and make the
      // shared link undecodable. Everything else gets capped.
      if (name !== "make_workflow_link") out = clampToolOutput(out);
      done();
      // For malformed calls args is {}, so keying on it would collapse every
      // bad payload for a tool into one signature — a model that resends a
      // *different* still-invalid payload would be wrongly flagged a repeat.
      // Key on the raw argument string in that case.
      const sig = name + (badArgs !== null ? badArgs : JSON.stringify(args));
      const seen = (seenCalls.get(sig) ?? 0) + 1;
      seenCalls.set(sig, seen);
      if (seen > 1) out += "\n\n(You already ran exactly this and got this same result. Do NOT run it again — try a different approach.)";
      messages.push({ role: "tool", tool_call_id: call.id, content: out });
    }
  }
  note("That was a lot of steps, so I paused here — say “keep going” to continue.");
  } finally {
    runController = null;
  }
}
