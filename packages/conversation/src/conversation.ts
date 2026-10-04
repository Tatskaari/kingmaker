import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole, type TranscriptMessage } from "../../contracts/src/index.js";
import type { WorldState } from "../../contracts/src/v2.js";
import type { ChatCompletionRequest, OpenRouterMessage } from "../../providers/src/openrouter.js";
import { runConversation } from "./phases.js";
import type { ConversationRuntime } from "./runtime.js";

export const CHARACTER_PROMPT = `You are a character in a game, speaking with the player. Embody the supplied identity, voice, relationships and current circumstances. Pursue your conversation objectives naturally. Respond only with your character's words and brief observable gestures. Do not speak or decide for the player. Distinguish your knowledge and beliefs from player claims; admit uncertainty when information is missing. Speech and promises do not execute actions or change game state. Markdown links are references, not additional knowledge. Return plain text.`;

export interface LoreDocument { path: string; markdown: string }
export type CharacterSources = readonly LoreDocument[];
export interface ConversationInput {
  snapshot: { world: WorldState };
  characterId: string;
  sources: CharacterSources;
  transcript: readonly TranscriptMessage[];
  message: string;
}
export type Complete = (request: ChatCompletionRequest, signal?: AbortSignal) => Promise<OpenRouterMessage>;
export interface LlmTurn {
  request: ChatCompletionRequest;
  response?: OpenRouterMessage;
  error?: string;
  durationMs?: number;
}

/** Context comes entirely from Markdown; the snapshot only validates character identity. */
export function conversationRequest(input: ConversationInput): ChatCompletionRequest {
  const exists = !!input.snapshot.world.runtimeCharacters[input.characterId];
  if (!exists) throw new Error(`Unknown snapshot character: ${input.characterId}`);
  return {
    model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "none" }, max_tokens: 1200,
    messages: [
      { role: "system", content: CHARACTER_PROMPT },
      ...input.sources.map(document => ({ role: "system" as const, content: `# Lore: ${document.path}\n${document.markdown}` })),
      ...input.transcript.map(message => ({
        role: message.role === TranscriptRole.CHARACTER ? "assistant" as const
          : message.role === TranscriptRole.GAME_MASTER ? "system" as const : "user" as const,
        content: message.role === TranscriptRole.OTHER_CHARACTER ? `${message.speakerId}: ${message.text}` : message.text,
      })),
      { role: "user", content: input.message },
    ],
  };
}

/** One plain dialogue turn. Return the complete transcript for a later review; never commit game changes. */
export async function converse<Labels>(input: ConversationInput, runtime: ConversationRuntime<Labels>, signal?: AbortSignal,
  trace: (turn: LlmTurn) => void = () => {}) {
  if (!input.message.trim()) throw new Error("Say something first.");
  let request = conversationRequest(input);
  const started = Date.now();
  trace({ request });
  try {
    const response = await runConversation(request, runtime, signal, prepared => { request = prepared; trace({ request }); });
    signal?.throwIfAborted();
    if (response.role !== "assistant" || !response.content?.trim() || response.tool_calls?.length) throw new Error("Expected a plain character reply.");
    trace({ request, response, durationMs: Date.now() - started });
    return { characterId: input.characterId, transcript: [...input.transcript,
      create(TranscriptMessageSchema, { role: TranscriptRole.PLAYER, speakerId: "player", text: input.message }),
      create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER, speakerId: input.characterId, text: response.content }),
    ] };
  } catch (error) {
    trace({ request, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started });
    throw error;
  }
}
