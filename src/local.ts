// On-device AI via WebLLM (MLC): the model runs on the user's GPU, in the tab.
// Speaks the same OpenAI chat-completions format (including structured
// tool_calls), so the agent loop doesn't know or care which model it's using.
//
// The library (and the model weights) load lazily from CDN only when the user
// opts in — the shipped single file stays small. Weights are cached by the
// browser after the first download.
import { note, error, status, progressNote } from "./ui";

// Pinned: bump deliberately. esm.run serves the npm package as an ES module.
const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.84";

// Curated choices. ONLY models WebLLM supports for native structured tool
// calls qualify — anything smaller can chat but can't touch files, which
// makes the agent silently useless. (Verified against 0.2.84's allowlist:
// Hermes-2-Pro 7/8B and Hermes-3-Llama-3.1-8B.)
export const LOCAL_MODELS = [
  { id: "Hermes-3-Llama-3.1-8B-q4f16_1-MLC", label: "Hermes 3 · 8B (recommended · ~4.7 GB)" },
  { id: "Hermes-2-Pro-Mistral-7B-q4f16_1-MLC", label: "Hermes 2 Pro · 7B (a bit lighter · ~4 GB)" },
];

let webllm: any = null;
let engine: any = null;
let engineModel = "";

export function gpuAvailable(): boolean {
  return "gpu" in navigator;
}

async function lib() {
  if (!webllm) webllm = await import(/* @vite-ignore */ WEBLLM_URL);
  return webllm;
}

/** Load (or switch to) a local model, narrating download progress in chat. */
export async function loadLocalModel(modelId: string): Promise<boolean> {
  if (engine && engineModel === modelId) return true;
  if (!gpuAvailable()) {
    error(
      "This browser can't run the on-device AI (it needs WebGPU — recent Chrome or Edge). " +
        "The free key option above works on any browser."
    );
    return false;
  }
  status("think");
  try {
    const m = await lib();
    const known = m.prebuiltAppConfig.model_list.some((r: any) => r.model_id === modelId);
    if (!known) {
      error("That model isn't available in this version of the on-device engine.");
      return false;
    }
    note("Downloading the on-device AI — this happens once, then it's saved in your browser.");
    const update = progressNote();
    const onProgress = (p: { text: string }) => update(p.text);
    if (engine) {
      await engine.unload();
      engine = null;
    }
    // Some models (gemma3) ship a sliding_window_size in their own config that
    // clashes with the record's context_window_size override — the engine
    // refuses both. Prefer the full context window: an agent prompt (system +
    // tools) would fall out of a 512-token sliding window immediately.
    const rec = m.prebuiltAppConfig.model_list.find((r: any) => r.model_id === modelId);
    const chatOpts =
      (rec?.overrides?.context_window_size ?? 0) > 0 ? { sliding_window_size: -1 } : undefined;
    engine = await m.CreateMLCEngine(modelId, { initProgressCallback: onProgress }, chatOpts);
    engineModel = modelId;
    (window as any).__tabagent_engine = engine; // console debugging aid
    note("On-device AI ready ✓");
    return true;
  } catch (e) {
    engine = null;
    error("I couldn't start the on-device AI: " + (e as Error).message);
    return false;
  } finally {
    status("ready");
  }
}

// WebLLM rejects a custom system prompt whenever `tools` is set (it injects
// its own Hermes-format one, with the tool JSON inside). So our instructions
// ride along inside the first user message instead.
function foldSystemIntoUser(messages: any[]): any[] {
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const rest = messages
    .filter((m) => m.role !== "system")
    // OpenAI tool-call turns have content: null; WebLLM requires a string.
    .map((m) => (m.role === "assistant" && m.content == null ? { ...m, content: "" } : m));
  if (sys && rest[0]?.role === "user") {
    rest[0] = { ...rest[0], content: `Standing instructions:\n${sys}\n\n---\n\n${rest[0].content}` };
  }
  return rest;
}

/** OpenAI-shaped completion against the local engine. Mirrors the remote response shape. */
export async function localComplete(messages: any[], tools: any[]): Promise<any> {
  if (!engine) return { error: { message: "on-device AI not loaded yet" } };
  const folded = foldSystemIntoUser(messages);
  try {
    return await engine.chat.completions.create({ messages: folded, tools, tool_choice: "auto" });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.warn("[local] completion error:", msg);
    // Only a model that genuinely can't do structured tool calls degrades to
    // plain chat — and we say so: a file-task answered from "knowledge" is a lie.
    if (/not supported for ChatCompletionRequest\.tools/i.test(msg)) {
      note("Heads up: this on-device model can't use my file tools — I can chat, but not act on your files.");
      try {
        return await engine.chat.completions.create({ messages: folded });
      } catch (e2) {
        return { error: { message: (e2 as Error).message } };
      }
    }
    return { error: { message: msg } };
  }
}

export const localReady = () => !!engine;
