import type { ActionPolicy, DialogueModel, GameMasterModel } from "../../core/src/ports.js";
export * from "./openrouter.js";

/** Server-only configuration. Never serialize into a view or browser bundle. */
export interface OpenRouterConfiguration {
  apiKey: string;
  decisionModel: string;
  dialogueModel: string;
  timeoutMs: number;
}
export interface ModelProviders {
  actions: ActionPolicy;
  dialogue: DialogueModel;
  gameMaster: GameMasterModel;
}

// Action adapter: POST https://openrouter.ai/api/alpha/decisions, using one
// Choice criterion per concrete AvailableAction.
// Dialogue and game-master calls use the implemented chat-completions client.
