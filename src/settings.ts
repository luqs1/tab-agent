// All config lives in the browser (localStorage). No backend, no env files needed
// at runtime. The user pastes their own free OpenRouter key once.
const KEY = "tab-agent.openrouter_key";
const MODEL = "tab-agent.model";

const DEFAULT_MODEL = "z-ai/glm-4.5-air:free";

// Free models with working tool-calling, in preference order. When the active
// model is rate-limited (free tiers often are), the agent falls through these.
export const FALLBACK_MODELS = [
  "z-ai/glm-4.5-air:free",
  "qwen/qwen3-coder:free",
  "mistralai/mistral-small-3.2-24b-instruct:free",
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
