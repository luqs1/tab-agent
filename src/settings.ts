// All config lives in the browser (localStorage). No backend, no env files needed
// at runtime. The user pastes their own free OpenRouter key once.
const KEY = "tab-agent.openrouter_key";
const MODEL = "tab-agent.model";

const DEFAULT_MODEL = "moonshotai/kimi-k2.6:free";

// Free models with tool-calling support, in preference order (checked against
// openrouter.ai/api/v1/models — supported_parameters includes "tools"). The
// free tier shifts under us: models get rate-limited or withdrawn, so the
// agent falls through this list on any non-auth error.
export const FALLBACK_MODELS = [
  "moonshotai/kimi-k2.6:free",
  "qwen/qwen3-coder:free",
  "openai/gpt-oss-120b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

export const getKey = () => localStorage.getItem(KEY) ?? "";
export const setKey = (k: string) => localStorage.setItem(KEY, k.trim());
export const hasKey = () => getKey().length > 0;

export const getModel = () => localStorage.getItem(MODEL) || DEFAULT_MODEL;
export const setModel = (m: string) => localStorage.setItem(MODEL, m.trim());

// Where the brain lives: "openrouter" (free key) or "local" (WebLLM on-device).
const PROVIDER = "tab-agent.provider";
const LOCAL_MODEL = "tab-agent.local_model";

export type Provider = "openrouter" | "local";
export const getProvider = (): Provider =>
  (localStorage.getItem(PROVIDER) as Provider) || "openrouter";
export const setProvider = (p: Provider) => localStorage.setItem(PROVIDER, p);

export const getLocalModel = () => localStorage.getItem(LOCAL_MODEL) ?? "";
export const setLocalModel = (m: string) => localStorage.setItem(LOCAL_MODEL, m);

// Optional remote MCP server (Streamable HTTP, must be CORS-friendly).
const MCP = "tab-agent.mcp_url";
export const getMcpUrl = () => localStorage.getItem(MCP) ?? "";
export const setMcpUrl = (u: string) => localStorage.setItem(MCP, u.trim());
