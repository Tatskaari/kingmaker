import type { ActionPolicy, DialogueModel, GameMasterModel } from "../../core/src/ports.js";
export * from "./openrouter.js";
export * from "./jev.js";

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

// JevClient calls the Decisions API with one Choice criterion per legal action.
// The palace prototype supplies navigation state; the narrative ActionPolicy remains a port.
// Dialogue and game-master calls use the implemented chat-completions client.
