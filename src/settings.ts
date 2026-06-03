// All config lives in the browser (localStorage). No backend, no env files needed
// at runtime. The user pastes their own free OpenRouter key once.
const KEY = "tab-agent.openrouter_key";
const MODEL = "tab-agent.model";

const DEFAULT_MODEL = "z-ai/glm-4.5-air:free";

export const getKey = () => localStorage.getItem(KEY) ?? "";
export const setKey = (k: string) => localStorage.setItem(KEY, k.trim());
export const hasKey = () => getKey().length > 0;

export const getModel = () => localStorage.getItem(MODEL) || DEFAULT_MODEL;
export const setModel = (m: string) => localStorage.setItem(MODEL, m.trim());
