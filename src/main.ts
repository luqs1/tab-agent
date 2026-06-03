// Wiring: boot pyodide, connect MCP, hook up the buttons.
import { log, status, onClick, inputValue } from "./ui";
import { ready, mountUserFolder } from "./pyenv";
import { connectMcp } from "./mcp";
import { runAgent } from "./agent";
import { getKey, setKey, hasKey } from "./settings";

// Point this at any browser-CORS-friendly MCP server.
const MCP_URL = import.meta.env.VITE_MCP_URL;

// Restore a previously saved key into the field (masked input).
(document.getElementById("key") as HTMLInputElement).value = getKey();

onClick("savekey", () => {
  setKey(inputValue("key"));
  log(hasKey() ? "✅ key saved (localStorage)" : "key cleared");
});

async function boot() {
  await ready;
  if (!hasKey()) log('⚠️ Paste a free OpenRouter key (openrouter.ai/keys) and click "Save key".');
  if (MCP_URL) await connectMcp(MCP_URL);
  log("\nType a request below. Try: \"list the files in /scratch\" first,");
  log('then "Mount a folder" and ask it to work on your real files.\n');
}

onClick("pick", () => mountUserFolder().catch((e) => log("⚠️ " + e.message)));

onClick("send", () => {
  const text = inputValue("msg");
  if (!text.trim()) return;
  log("\n👤 " + text);
  runAgent(text).catch((e) => log("❌ " + e.message));
});

document.getElementById("msg")!.addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") (document.getElementById("send") as HTMLButtonElement).click();
});

boot();
