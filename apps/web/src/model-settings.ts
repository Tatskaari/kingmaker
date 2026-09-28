// Explicit effort avoids model defaults changing dialogue latency.
export const DIALOGUE_MODEL = { model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "none" } } as const;
export const FLAVOUR_MODEL = { ...DIALOGUE_MODEL, max_tokens: 100 } as const;
export const REASONING_MODEL = { model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "low" } } as const;
