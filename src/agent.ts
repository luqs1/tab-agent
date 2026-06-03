// The agent loop: LLM -> tool calls -> execute -> feed results back -> repeat.
//
// Uses the OpenAI chat-completions format, because we talk to OpenRouter (free
// models) through a tiny proxy (worker.ts) that holds the key and adds CORS.
import { log } from "./ui";
import { runPython } from "./pyenv";
import { runShell } from "./shell";
import { callMcp, mcpTools } from "./mcp";
import { loadSkills } from "./skills";

const PROXY = import.meta.env.VITE_LLM_PROXY ?? "http://localhost:8787/v1/chat/completions";
// Any tool-capable free model from https://openrouter.ai/models?max_price=0
// Free models get congested (429s); if the default is busy, try another:
// z-ai/glm-4.5-air:free · qwen/qwen3-coder:free · nvidia/nemotron-3-nano-30b-a3b:free · moonshotai/kimi-k2.6:free
const MODEL = import.meta.env.VITE_MODEL ?? "z-ai/glm-4.5-air:free";

const SYSTEM = `You are tab-agent, an autonomous agent running entirely inside a browser tab.
You have a Python sandbox (tool: python_exec) and a bash-like shell (tool: shell).
The user's real files are mounted at /mnt/user. A fast scratch dir is at /scratch.
Prefer python_exec for real work; use shell for quick file ops and pipelines.${loadSkills()}`;

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
  if (name.startsWith("mcp__")) return callMcp(name.slice(5), args);
  return `unknown tool: ${name}`;
}

export async function runAgent(userText: string, maxTurns = 10) {
  const messages: any[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: userText },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const resp = await fetch(PROXY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
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
