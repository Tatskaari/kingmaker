import type { OpenRouterTool } from "../../../packages/providers/src/openrouter.js";
import { reconciliationTools } from "./gm-reconciliation.js";

export function reviewWriteTools(reviewSchema: unknown): OpenRouterTool[] {
  return [
    { type: "function", function: { name: "read_state", description: "Read authoritative plain resource values after a state conflict. Missing resources are null. Use exact resource IDs, e.g. character:corvin or item:letter.", parameters: {
      type: "object", additionalProperties: false, required: ["resourceIds"], properties: { resourceIds: { type: "array", maxItems: 200, items: { type: "string" } } },
    } } },
    { type: "function", function: { name: "commit_review", description: "Atomically write the complete reviewed character updates and world changes. Nothing is written on conflict: inspect the returned current state, reconcile the proposal, and call this tool again. Call alone. Staging tools and final prose do not publish changes.", parameters: {
      type: "object", additionalProperties: false, required: ["review", "worldChanges"], properties: {
        review: reviewSchema,
        worldChanges: { type: "array", maxItems: 40, items: { oneOf: reconciliationTools.map(tool => ({
          type: "object", additionalProperties: false, required: ["name", "arguments"], properties: {
            name: { type: "string", const: tool.function.name }, arguments: tool.function.parameters,
          },
        })) } },
      },
    } } },
  ];
}
