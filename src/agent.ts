// The agent loop: LLM -> tool calls -> execute -> feed results back -> repeat.
//
// Uses the OpenAI chat-completions format. The browser calls OpenRouter directly
// (it sends permissive CORS) — there is no backend.
import { say, note, error, activity, thinking } from "./ui";
import { runPython, userMount, downloadSandboxFile } from "./pyenv";
import { runShell } from "./shell";
import { callMcp, mcpTools } from "./mcp";
import { loadSkills } from "./skills";
import { getKey, getModel, getProvider, FALLBACK_MODELS } from "./settings";
import { localComplete, localReady } from "./local";
import { writeInstaller } from "./installer";
import { encodeWorkflowLink } from "./wf";

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
files, analysis, scaffolding) directly in the sandbox.${loadSkills()}`;
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

function allTools() {
  return [
    ...builtinTools(),
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
  if (name === "make_workflow_link") {
    const url = await encodeWorkflowLink({ title: args.title, instructions: args.instructions });
    return `Link created (${url.length} chars — fragment stays on-device, never sent to any server):\n${url}\nShow it to the user as a markdown link they can copy.`;
  }
  if (name === "write_installer") return writeInstaller(args.name, args.script);
  if (name.startsWith("mcp__")) return callMcp(name.slice(5), args);
  return `unknown tool: ${name}`;
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

// Free models get rate-limited. Try the user's model first, then fall through
// the free fallbacks; retry each once on 429 before moving on.
async function complete(key: string, messages: any[], signal: AbortSignal): Promise<any> {
  if (getProvider() === "local") return localComplete(messages, allTools());
  const models = [getModel(), ...FALLBACK_MODELS.filter((m) => m !== getModel())];
  let last: any = { error: { message: "no models attempted" } };
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let resp: any;
      const timeout = new AbortController();
      const t = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
      try {
        resp = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
            "HTTP-Referer": location.origin,
            "X-Title": "tab.agent",
          },
          body: JSON.stringify({ model, messages, tools: allTools(), tool_choice: "auto" }),
          signal: anySignal([signal, timeout.signal]),
        }).then((r) => r.json());
      } catch (e) {
        if (signal.aborted) return { stopped: true }; // user hit Stop — bail out entirely
        // A timeout looks like a transient 5xx so it gets the one retry below.
        resp = timeout.signal.aborted
          ? { error: { message: "That took too long, so I gave up on it.", code: 504 } }
          : { error: { message: (e as Error).message } };
      } finally {
        clearTimeout(t);
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
    const resp = await complete(key, messages, signal);
    thinking(false);

    if (stopped || resp.stopped) {
      note("Okay — I've stopped.");
      return;
    }

    if (resp.error) {
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
      error("I got a reply I didn't understand. Mind trying that again?");
      return;
    }

    messages.push(msg); // push the assistant turn verbatim (keeps tool_calls intact)
    if (msg.content) say(msg.content);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      // Some (especially local) models go quiet after acting; don't end on silence.
      if (!msg.content && seenCalls.size > 0)
        note("I've finished working on that — ask me to double-check the result if you like.");
      return;
    }

    for (const call of calls) {
      if (stopped) {
        note("Okay — I've stopped.");
        return;
      }
      const name = call.function.name;
      let args: any = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      const { label, detail } = describe(name, args);
      const done = activity(label, detail);
      // A throwing tool (e.g. an MCP network blip) must not kill the run: turn
      // the error into a tool result the model can react to, and always clear
      // the spinner. Then cap the result to protect the context window.
      let out: string;
      try {
        out = await dispatch(name, args);
      } catch (e) {
        out = `[tool error] ${(e as Error).message ?? String(e)}`;
      }
      // make_workflow_link returns a #wf= URL that IS the payload — clamping it
      // would replace the fragment's middle with the trim marker and make the
      // shared link undecodable. Everything else gets capped.
      if (name !== "make_workflow_link") out = clampToolOutput(out);
      done();
      const sig = name + JSON.stringify(args);
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
