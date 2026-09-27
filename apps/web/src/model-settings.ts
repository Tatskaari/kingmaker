// Explicit effort avoids model defaults changing dialogue latency.
export const DIALOGUE_MODEL = { model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "none" } } as const;
// OpenRouter's balanced Terra tier is GPT-5.6; there is no GPT-6 Terra model ID.
export const REASONING_MODEL = { model: "openai/gpt-5.6-terra", api: "responses", reasoning: { effort: "medium" } } as const;
