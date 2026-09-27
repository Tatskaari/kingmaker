import type { Character, ConversationMemory, DialogueRequest, GameMasterRequest, Note, PlayerSetup, Scenario } from "../../contracts/src/index.js";

export type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; issues: readonly { code: string; message: string }[] };

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface DialogueContextBuilder { build(request: DialogueRequest): readonly PromptMessage[] }
export interface GameMasterContextBuilder { build(request: GameMasterRequest): readonly PromptMessage[] }
export interface GameState {
  scenario(): Scenario;
  createPlayer(setup: PlayerSetup): Validation<Character>;
  commitConversation(characterId: string, memory: ConversationMemory, includePlayer?: boolean): Validation<readonly Note[]>;
}
