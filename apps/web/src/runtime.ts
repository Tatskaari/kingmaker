import { compulsionNarration, parseReplyOptions, type ReplyOptions } from "./reply-options.js";
import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import {
  CharacterSchema, DialogueRequestSchema, DialogueResponseSchema, EventSchema,
  EventVisibility, GameMasterRequestSchema, GamePhase, GoalUpdateSchema,
  PlayerSetupSchema, RelationshipSchema, RelationshipUpdateSchema, ScenarioSchema,
  TranscriptMessageSchema, TranscriptRole, WorldStateSchema,
  type Scenario, type TranscriptMessage,
} from "../../../packages/contracts/src/index.js";
import { FullContextBuilder, FullGameMasterContextBuilder, worldForCharacter } from "../../../packages/core/src/context.js";
import { MemoryGame } from "../../../packages/core/src/game.js";
import { OpenRouterClient, type OpenRouterMessage, type OpenRouterTool } from "../../../packages/providers/src/openrouter.js";

export interface RuntimeSnapshot {
  scenario: JsonValue;
  gameMasterReplyOptions?: ReplyOptions | null;
  conversationReplyOptions?: Record<string, string[]>;
  gameMasterHistory: OpenRouterMessage[];
  conversations: Record<string, JsonValue[]>;
}

const gmTools: readonly OpenRouterTool[] = [
  {
    type: "function",
    function: {
      name: "offer_replies",
      description: "End this turn with one complete player-facing reply and one or more suggested player replies. Put all narration and the question in question; leave assistant content empty. Call alone. Only the GM may set compelled=true, and only to obtain a missing creation detail after the player avoids answering. Never choose an answer for the player.",
      parameters: {
        type: "object", additionalProperties: false, required: ["question", "options", "compelled"],
        properties: {
          question: { type: "string", description: "The complete reply shown to the player, including any greeting, narration, and final question." },
          options: { type: "array", minItems: 1, items: { type: "string", maxLength: 300 } },
          compelled: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_player",
      description: "Finish the interview, create the visiting emissary, establish every initial relationship, and begin Day 1 in the Great Hall. Call once enough is known.",
      parameters: {
        type: "object", additionalProperties: false,
        required: ["name", "homeland", "embassyRole", "lore", "currentGoal", "relationships", "npcViews"],
        properties: {
          name: { type: "string" }, homeland: { type: "string" }, embassyRole: { type: "string" },
          lore: { type: "string" }, currentGoal: { type: "string" },
          relationships: { type: "array", minItems: 3, maxItems: 3, items: {
            type: "object", additionalProperties: false, required: ["characterId", "description"],
            properties: { characterId: { type: "string", enum: ["merlin", "lancelot", "king"] }, description: { type: "string" } },
          } },
          npcViews: { type: "array", minItems: 3, maxItems: 3, items: {
            type: "object", additionalProperties: false, required: ["characterId", "description"],
            properties: { characterId: { type: "string", enum: ["merlin", "lancelot", "king"] }, description: { type: "string" } },
          } },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_character",
      description: "Edit a character biography or current goal in this game.",
      parameters: { type: "object", additionalProperties: false, required: ["characterId"], properties: {
        characterId: { type: "string", enum: ["merlin", "lancelot", "king", "player"] }, lore: { type: "string" }, currentGoal: { type: "string" },
      } },
    },
  },
  {
    type: "function",
    function: {
      name: "update_premise",
      description: "Replace the scenario premise when setup adds a durable fact.",
      parameters: { type: "object", additionalProperties: false, required: ["premise"], properties: { premise: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "add_event",
      description: "Add a remembered or public event.",
      parameters: { type: "object", additionalProperties: false, required: ["type", "summary", "characterIds", "visibility"], properties: {
        type: { type: "string" }, summary: { type: "string" }, characterIds: { type: "array", items: { type: "string" } },
        visibility: { type: "string", enum: ["public", "private"] },
      } },
    },
  },
];

const dialogueFormat = {
  type: "json_schema",
  json_schema: {
    name: "character_dialogue", strict: true,
    schema: {
      type: "object", additionalProperties: false, required: ["utterance", "newEvents", "goalUpdate", "replyOptions"],
      properties: {
        utterance: { type: "string" },
        replyOptions: { type: "array", items: { type: "string", maxLength: 300 } },
        newEvents: { type: "array", items: { type: "object", additionalProperties: false, required: ["type", "summary"], properties: {
          type: { type: "string" }, summary: { type: "string" },
        } } },
        goalUpdate: { anyOf: [
          { type: "object", additionalProperties: false, required: ["goal", "reason"], properties: { goal: { type: "string" }, reason: { type: "string" } } },
          { type: "null" },
        ] },
      },
    },
  },
} as const;

type JsonObject = Record<string, unknown>;

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

export class BrowserGameRuntime {
  readonly #initialScenario: Scenario;
  #game: MemoryGame;
  #client: OpenRouterClient;
  #gmHistory: OpenRouterMessage[] = [];
  #gmReplyOptions: ReplyOptions | null = null;
  #conversationReplyOptions: Record<string, string[]> = {};
  #conversations = new Map<string, TranscriptMessage[]>();

  constructor(scenario: Scenario, apiKey: string, snapshot?: RuntimeSnapshot) {
    this.#initialScenario = fromJson(ScenarioSchema, toJson(ScenarioSchema, scenario));
    this.#game = new MemoryGame(this.#initialScenario);
    this.#client = new OpenRouterClient(apiKey, 60_000, globalThis.location?.origin || "http://localhost");
    if (snapshot) this.restore(snapshot);
  }

  reset(): void {
    this.#game = new MemoryGame(this.#initialScenario);
    this.#gmHistory = [];
    this.#gmReplyOptions = null;
    this.#conversationReplyOptions = {};
    this.#conversations = new Map();
  }

  restore(snapshot: RuntimeSnapshot): void {
    this.#game = new MemoryGame(fromJson(ScenarioSchema, snapshot.scenario));
    this.#gmHistory = snapshot.gameMasterHistory || [];
    this.#gmReplyOptions = snapshot.gameMasterReplyOptions || null;
    this.#conversationReplyOptions = snapshot.conversationReplyOptions || {};
    this.#conversations = new Map(Object.entries(snapshot.conversations || {}).map(([characterId, messages]) => [
      characterId,
      messages.map(message => fromJson(TranscriptMessageSchema, message)),
    ]));
  }

  snapshot(): RuntimeSnapshot {
    return {
      scenario: toJson(ScenarioSchema, this.#game.scenario(), { alwaysEmitImplicit: true }),
      gameMasterHistory: this.#gmHistory,
      gameMasterReplyOptions: this.#gmReplyOptions,
      conversationReplyOptions: this.#conversationReplyOptions,
      conversations: Object.fromEntries([...this.#conversations].map(([characterId, messages]) => [
        characterId,
        messages.map(message => toJson(TranscriptMessageSchema, message, { alwaysEmitImplicit: true })),
      ])),
    };
  }

  async talkToGameMaster(messageText: string): Promise<string> {
    const before = structuredClone(this.snapshot());
    try {
      this.#gmReplyOptions = null;
      this.#gmHistory.push({ role: "user", content: messageText });
      for (let step = 0; step < 5; step += 1) {
        const setup = new FullGameMasterContextBuilder().build(create(GameMasterRequestSchema, { scenario: this.#game.scenario() }));
        const message = await this.#client.complete({
          model: "openai/gpt-5.4-mini",
          messages: [...setup.map(item => ({ role: item.role, content: item.content } satisfies OpenRouterMessage)), ...this.#gmHistory],
          tools: gmTools, temperature: 0.8, max_tokens: 900,
        });
        this.#gmHistory.push(message);
        if (!message.tool_calls?.length) return message.content || "The game master pauses, considering your answer.";
        for (const call of message.tool_calls) {
          let result: JsonObject;
          try {
            if (call.function.name === "offer_replies" && message.tool_calls.length !== 1) throw new Error("Call offer_replies alone, after any other tools");
            result = this.executeTool(call.function.name, JSON.parse(call.function.arguments) as JsonObject);
          }
          catch (error) { result = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
          this.#gmHistory.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
          if (call.function.name === "offer_replies" && result.ok) {
            // Some models also speak alongside the tool call. Preserve that full
            // reply instead of showing its question a second time.
            const spoken = message.content?.trim();
            const reply = spoken
              ? (result.compelled && !spoken.includes(compulsionNarration) ? `${compulsionNarration}\n\n${spoken}` : spoken)
              : String(result.narration);
            this.#gmHistory.push({ role: "assistant", content: reply });
            return reply;
          }
        }
      }
      throw new Error("The game master used too many consecutive tool calls");
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }

  async talkToCharacter(characterId: string, messageText: string): Promise<string> {
    const scenario = this.#game.scenario();
    if (scenario.world?.phase !== GamePhase.CONVERSATIONS) throw new Error("Character conversations have not begun");
    if (!scenario.characters.some(character => character.id === characterId && character.id !== "player")) throw new Error("Unknown character");
    const history = this.#conversations.get(characterId) || [];
    const playerMessage = create(TranscriptMessageSchema, { role: TranscriptRole.PLAYER, speakerId: "player", text: messageText });
    const request = create(DialogueRequestSchema, { characterId, scenario, transcript: [...history, playerMessage] });
    const messages = new FullContextBuilder().build(request).map(item => ({ role: item.role, content: item.content } satisfies OpenRouterMessage));
    const completion = await this.#client.complete({ model: "openai/gpt-5.4-mini", messages, response_format: dialogueFormat, temperature: 0.9, max_tokens: 900 });
    if (!completion.content) throw new Error("Character returned no dialogue");
    const parsed = JSON.parse(completion.content) as { replyOptions?: unknown; utterance?: unknown; newEvents?: Array<{ type?: unknown; summary?: unknown }>; goalUpdate?: { goal?: unknown; reason?: unknown } | null };
    const response = create(DialogueResponseSchema, {
      utterance: text(parsed.utterance, "utterance"),
      replyOptions: parseReplyOptions(parsed.replyOptions),
      newEvents: (parsed.newEvents || []).map(event => create(EventSchema, {
        type: text(event.type, "newEvents.type"), summary: text(event.summary, "newEvents.summary"),
        characterIds: [characterId, "player"], visibility: EventVisibility.PRIVATE, details: {},
      })),
      goalUpdate: parsed.goalUpdate ? create(GoalUpdateSchema, {
        goal: text(parsed.goalUpdate.goal, "goalUpdate.goal"), reason: text(parsed.goalUpdate.reason, "goalUpdate.reason"),
      }) : undefined,
    });
    const committed = this.#game.commitDialogue(characterId, response);
    if (!committed.ok) throw new Error(committed.issues.map(issue => issue.message).join("; "));
    this.#conversations.set(characterId, [...history, playerMessage, create(TranscriptMessageSchema, {
      role: TranscriptRole.CHARACTER, speakerId: characterId, text: response.utterance,
    })]);
    this.#conversationReplyOptions[characterId] = response.replyOptions;
    return response.utterance;
  }

  view(): JsonObject {
    const scenario = this.#game.scenario();
    const world = scenario.world;
    const player = scenario.characters.find(character => character.id === scenario.playerCharacterId);
    return {
      phase: world?.phase === GamePhase.PLAYER_CREATION ? "player_creation" : world?.phase === GamePhase.CONVERSATIONS ? "conversations" : "other",
      day: world?.day || 0,
      location: world?.rooms.find(room => room.id === "great_hall")?.name || "Great Hall",
      premise: scenario.premise,
      player: player ? {
        id: player.id, name: player.name, lore: player.lore, currentGoal: player.currentGoal,
        relationships: player.relationships.map(relationship => ({
          characterId: relationship.characterId,
          characterName: scenario.characters.find(character => character.id === relationship.characterId)?.name || relationship.characterId,
          description: relationship.description,
        })),
      } : null,
      characters: scenario.characters.filter(character => character.id !== "player").map(character => ({ id: character.id, name: character.name })),
      gmReplyOptions: this.#gmReplyOptions,
      conversationReplyOptions: this.#conversationReplyOptions,
      gmMessages: this.#gmHistory.filter(message => (message.role === "user" || message.role === "assistant") && !message.tool_calls?.length && message.content).map(message => ({ role: message.role, text: message.content })),
      conversations: Object.fromEntries([...this.#conversations].map(([id, transcript]) => [id, transcript.map(message => ({
        role: message.role === TranscriptRole.CHARACTER ? "character" : "player", text: message.text,
      }))])),
    };
  }

  debug(): JsonObject {
    return { scenario: toJson(ScenarioSchema, this.#game.scenario(), { alwaysEmitImplicit: true }), gameMasterHistory: this.#gmHistory, conversations: this.snapshot().conversations };
  }

  debugCharacter(characterId: string): JsonObject {
    const scenario = this.#game.scenario();
    const character = scenario.characters.find(item => item.id === characterId);
    if (!character || characterId === "player" || !scenario.world) throw new Error(`Unknown NPC: ${characterId}`);
    const transcript = this.#conversations.get(characterId) || [];
    return {
      character: toJson(CharacterSchema, character, { alwaysEmitImplicit: true }),
      visibleEvents: scenario.events.filter(event => event.visibility === EventVisibility.PUBLIC || event.characterIds.includes(characterId)).map(event => toJson(EventSchema, event, { alwaysEmitImplicit: true })),
      knownWorld: toJson(WorldStateSchema, worldForCharacter(scenario.world, characterId), { alwaysEmitImplicit: true }),
      conversation: transcript.map(message => toJson(TranscriptMessageSchema, message, { alwaysEmitImplicit: true })),
      modelMessages: new FullContextBuilder().build(create(DialogueRequestSchema, { characterId, scenario, transcript })),
    };
  }

  private executeTool(name: string, input: JsonObject): JsonObject {
    if (name === "offer_replies") {
      const question = text(input.question, "question");
      const options = parseReplyOptions(input.options, false);
      if (typeof input.compelled !== "boolean") throw new Error("compelled must be a boolean");
      if (input.compelled && this.#game.scenario().world?.phase !== GamePhase.PLAYER_CREATION) throw new Error("Compulsion is only available during character creation");
      this.#gmReplyOptions = { options, compelled: input.compelled };
      return { ok: true, compelled: input.compelled, narration: input.compelled ? `${compulsionNarration}\n\n${question}` : question };
    }
    if (name === "create_player") {
      const relationships = Array.isArray(input.relationships) ? input.relationships as JsonObject[] : [];
      const npcViews = Array.isArray(input.npcViews) ? input.npcViews as JsonObject[] : [];
      const result = this.#game.createPlayer(create(PlayerSetupSchema, {
        homeland: text(input.homeland, "homeland"), embassyRole: text(input.embassyRole, "embassyRole"),
        player: create(CharacterSchema, {
          id: "player", name: text(input.name, "name"), lore: text(input.lore, "lore"), currentGoal: text(input.currentGoal, "currentGoal"),
          relationships: relationships.map(item => create(RelationshipSchema, { characterId: text(item.characterId, "characterId"), description: text(item.description, "description") })),
        }),
        npcRelationships: npcViews.map(item => create(RelationshipUpdateSchema, {
          ownerCharacterId: text(item.characterId, "characterId"),
          relationship: create(RelationshipSchema, { characterId: "player", description: text(item.description, "description") }),
        })),
      }));
      if (!result.ok) throw new Error(result.issues.map(issue => issue.message).join("; "));
      return { ok: true, player: result.value.name, phase: "conversations", day: 1 };
    }
    if (name === "update_character") {
      const result = this.#game.updateCharacter(text(input.characterId, "characterId"), typeof input.lore === "string" ? input.lore : undefined, typeof input.currentGoal === "string" ? input.currentGoal : undefined);
      if (!result.ok) throw new Error(result.issues.map(issue => issue.message).join("; "));
      return { ok: true, character: result.value.name };
    }
    if (name === "update_premise") { this.#game.updatePremise(text(input.premise, "premise")); return { ok: true }; }
    if (name === "add_event") {
      const ids = Array.isArray(input.characterIds) ? input.characterIds.filter(value => typeof value === "string") as string[] : [];
      const event = this.#game.addEvent(create(EventSchema, {
        type: text(input.type, "type"), summary: text(input.summary, "summary"), characterIds: ids,
        visibility: input.visibility === "public" ? EventVisibility.PUBLIC : EventVisibility.PRIVATE, details: {},
      }));
      return { ok: true, eventId: event.id };
    }
    throw new Error(`Unknown game-master tool: ${name}`);
  }
}
