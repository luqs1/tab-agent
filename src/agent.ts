// The agent loop: LLM -> tool calls -> execute -> feed results back -> repeat.
//
// Uses the OpenAI chat-completions format. The browser calls OpenRouter directly
// (it sends permissive CORS) — there is no backend.
import { log } from "./ui";
import { runPython } from "./pyenv";
import { runShell } from "./shell";
import { callMcp, mcpTools } from "./mcp";
import { loadSkills } from "./skills";
import { getKey, getModel } from "./settings";
import { writeInstaller } from "./installer";

// The key comes from localStorage (see settings.ts).
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM = `You are tab-agent, an autonomous agent running entirely inside a browser tab.
You have a Python sandbox (tool: python_exec) and a bash-like shell (tool: shell).
The user's real files are mounted at /mnt/user. A fast scratch dir is at /scratch.
Prefer python_exec for real work; use shell for quick file ops and pipelines.

You run in a browser sandbox, so you CANNOT install system software or run native
tools (brew, system pip, arbitrary binaries) yourself. When a task needs that, do
NOT pretend you can. Instead call write_installer to generate a script the user
runs once to grant that access, and briefly tell them what it will do. Keep the
script minimal, idempotent, and safe. Do everything else (reading/writing their
files, analysis, scaffolding) directly in the sandbox.${loadSkills()}`;

// Built-in tools in OpenAI function-calling format.
function builtinTools() {
  return [
    {
      type: "function",
      function: {
        name: "python_exec",
        description: "Execute Python in-browser. Read/write the user's files under /mnt/user.",
        parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
      },
    },
    {
      type: "function",
      function: {
        name: "shell",
        description: "Run a bash-like command (grep/sed/awk/cat/ls/…) over the in-tab filesystem.",
        parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      },
    },
    {
      type: "function",
      function: {
        name: "write_installer",
        description:
          "Generate a script the user runs once to perform actions the sandbox can't (install software, run native tools). Downloads a .command file and explains how to run it.",
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
  if (name === "write_installer") return writeInstaller(args.name, args.script);
  if (name.startsWith("mcp__")) return callMcp(name.slice(5), args);
  return `unknown tool: ${name}`;
}

export async function runAgent(userText: string, maxTurns = 10) {
  const key = getKey();
  if (!key) {
    log('⚠️ No OpenRouter key set — paste a free key (openrouter.ai/keys) in the field above.');
    return;
  }

  const messages: any[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: userText },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "HTTP-Referer": location.origin,
        "X-Title": "tab-agent",
      },
      body: JSON.stringify({
        model: getModel(),
        messages,
        tools: allTools(),
        tool_choice: "auto",
      }),
    }).then((r) => r.json());

    if (resp.error) {
      log("❌ " + JSON.stringify(resp.error));
      return;
    }

    const msg = resp.choices?.[0]?.message;
    if (!msg) {
      log("❌ unexpected response: " + JSON.stringify(resp).slice(0, 300));
      return;
    }

    messages.push(msg); // push the assistant turn verbatim (keeps tool_calls intact)
    if (msg.content) log("🤖 " + msg.content);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) return; // no tools requested -> we're done

    for (const call of calls) {
      const name = call.function.name;
      let args: any = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      log(`🔧 ${name} ${JSON.stringify(args).slice(0, 100)}`);
      const out = await dispatch(name, args);
      messages.push({ role: "tool", tool_call_id: call.id, content: out });
    }
  }
  log("⏹️ hit max turns");
}
