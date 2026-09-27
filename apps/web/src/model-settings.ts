// Explicit effort avoids model defaults changing dialogue latency.
export const DIALOGUE_MODEL = { model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "none" } } as const;
export const REASONING_MODEL = { model: "openai/gpt-6-terra", api: "responses", reasoning: { effort: "medium" } } as const;
