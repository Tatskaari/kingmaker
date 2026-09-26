import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { create, fromJson, fromJsonString, toJson, type JsonValue } from "@bufbuild/protobuf";
import {
  CharacterSchema, DialogueRequestSchema, DialogueResponseSchema, EventSchema,
  EventVisibility, GameMasterRequestSchema, GamePhase, GoalUpdateSchema,
  PlayerSetupSchema, RelationshipSchema, RelationshipUpdateSchema, ScenarioSchema,
  TranscriptMessageSchema, TranscriptRole, WorldStateSchema, type TranscriptMessage,
} from "../../../packages/contracts/src/index.js";
import { FullContextBuilder, FullGameMasterContextBuilder, worldForCharacter } from "../../../packages/core/src/context.js";
import { MemoryGame } from "../../../packages/core/src/game.js";
import { OpenRouterClient, type OpenRouterMessage, type OpenRouterTool } from "../../../packages/providers/src/openrouter.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const scenarioFile = join(root, "content/scenarios/last-night.json");
const publicDir = join(root, "apps/web/public");
const dialogueModel = process.env.DIALOGUE_MODEL || "openai/gpt-5.4-mini";
const port = Number(process.env.PORT || 4317);
const devStateFile = process.env.KINGMAKER_DEV_STATE_FILE
  ? join(root, process.env.KINGMAKER_DEV_STATE_FILE)
  : undefined;
const devInstanceId = `${Date.now()}-${process.pid}`;
const devEventClients = new Set<ServerResponse>();

function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function loadKey(): string {
  const direct = process.env.OPENROUTER_API_KEY?.trim();
  if (direct) return direct;
  const file = expandHome(process.env.OPENROUTER_API_KEY_FILE || "~/secrets/kingmaker-dev-openrouter.txt");
  if (!existsSync(file)) throw new Error(`OpenRouter key file not found: ${file}`);
  const key = readFileSync(file, "utf8").trim();
  if (!key) throw new Error(`OpenRouter key file is empty: ${file}`);
  return key;
}

const client = new OpenRouterClient(loadKey());
let game = new MemoryGame(fromJsonString(ScenarioSchema, readFileSync(scenarioFile, "utf8")));
let gmHistory: OpenRouterMessage[] = [];
let conversations = new Map<string, TranscriptMessage[]>();

if (devStateFile && existsSync(devStateFile)) {
  try {
    const saved = JSON.parse(readFileSync(devStateFile, "utf8")) as {
      scenario: JsonValue;
      gameMasterHistory?: OpenRouterMessage[];
      conversations?: Record<string, JsonValue[]>;
    };
    game = new MemoryGame(fromJson(ScenarioSchema, saved.scenario));
    gmHistory = saved.gameMasterHistory || [];
    conversations = new Map(Object.entries(saved.conversations || {}).map(([characterId, messages]) => [
      characterId,
      messages.map(message => fromJson(TranscriptMessageSchema, message)),
    ]));
    console.log(`Restored development state from ${devStateFile}`);
  } catch (error) {
    console.warn(`Could not restore development state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function persistDevelopmentState(): void {
  if (!devStateFile) return;
  mkdirSync(dirname(devStateFile), { recursive: true });
  writeFileSync(devStateFile, JSON.stringify({
    scenario: toJson(ScenarioSchema, game.scenario(), { alwaysEmitImplicit: true }),
    gameMasterHistory: gmHistory,
    conversations: Object.fromEntries([...conversations].map(([characterId, messages]) => [
      characterId,
      messages.map(message => toJson(TranscriptMessageSchema, message, { alwaysEmitImplicit: true })),
    ])),
  }));
}

const gmTools: readonly OpenRouterTool[] = [
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
          lore: { type: "string", description: "Identity, public mission, private agenda, useful history, and diplomatic access." },
          currentGoal: { type: "string" },
          relationships: {
            type: "array", minItems: 3, maxItems: 3,
            items: { type: "object", additionalProperties: false, required: ["characterId", "description"], properties: {
              characterId: { type: "string", enum: ["merlin", "lancelot", "king"] }, description: { type: "string" },
            } },
          },
          npcViews: {
            type: "array", minItems: 3, maxItems: 3,
            items: { type: "object", additionalProperties: false, required: ["characterId", "description"], properties: {
              characterId: { type: "string", enum: ["merlin", "lancelot", "king"] }, description: { type: "string" },
            } },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_character",
      description: "Edit a character biography or current goal in this game's in-memory scenario.",
      parameters: { type: "object", additionalProperties: false, required: ["characterId"], properties: {
        characterId: { type: "string", enum: ["merlin", "lancelot", "king", "player"] },
        lore: { type: "string" }, currentGoal: { type: "string" },
      } },
    },
  },
  {
    type: "function",
    function: {
      name: "update_premise",
      description: "Replace the prose scenario premise in memory when the player's setup adds a durable fact.",
      parameters: { type: "object", additionalProperties: false, required: ["premise"], properties: { premise: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "add_event",
      description: "Add a remembered or public event to the in-memory scenario.",
      parameters: { type: "object", additionalProperties: false, required: ["type", "summary", "characterIds", "visibility"], properties: {
        type: { type: "string" }, summary: { type: "string" }, characterIds: { type: "array", items: { type: "string" } },
        visibility: { type: "string", enum: ["public", "private"] },
      } },
    },
  },
];

type JsonObject = Record<string, unknown>;

function asText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Tool argument ${field} must be a non-empty string`);
  return value.trim();
}

function executeGmTool(name: string, input: JsonObject): JsonObject {
  if (name === "create_player") {
    const relationships = Array.isArray(input.relationships) ? input.relationships as JsonObject[] : [];
    const npcViews = Array.isArray(input.npcViews) ? input.npcViews as JsonObject[] : [];
    const setup = create(PlayerSetupSchema, {
      homeland: asText(input.homeland, "homeland"), embassyRole: asText(input.embassyRole, "embassyRole"),
      player: create(CharacterSchema, {
        id: "player", name: asText(input.name, "name"), lore: asText(input.lore, "lore"), currentGoal: asText(input.currentGoal, "currentGoal"),
        relationships: relationships.map(item => create(RelationshipSchema, {
          characterId: asText(item.characterId, "relationships.characterId"), description: asText(item.description, "relationships.description"),
        })),
      }),
      npcRelationships: npcViews.map(item => create(RelationshipUpdateSchema, {
        ownerCharacterId: asText(item.characterId, "npcViews.characterId"),
        relationship: create(RelationshipSchema, { characterId: "player", description: asText(item.description, "npcViews.description") }),
      })),
    });
    const result = game.createPlayer(setup);
    if (!result.ok) throw new Error(result.issues.map(issue => issue.message).join("; "));
    return { ok: true, player: result.value.name, phase: "conversations", day: 1 };
  }
  if (name === "update_character") {
    const result = game.updateCharacter(asText(input.characterId, "characterId"), typeof input.lore === "string" ? input.lore : undefined, typeof input.currentGoal === "string" ? input.currentGoal : undefined);
    if (!result.ok) throw new Error(result.issues.map(issue => issue.message).join("; "));
    return { ok: true, character: result.value.name };
  }
  if (name === "update_premise") {
    game.updatePremise(asText(input.premise, "premise"));
    return { ok: true };
  }
  if (name === "add_event") {
    const ids = Array.isArray(input.characterIds) ? input.characterIds.filter(value => typeof value === "string") as string[] : [];
    const event = game.addEvent(create(EventSchema, {
      type: asText(input.type, "type"), summary: asText(input.summary, "summary"), characterIds: ids,
      visibility: input.visibility === "public" ? EventVisibility.PUBLIC : EventVisibility.PRIVATE, details: {},
    }));
    return { ok: true, eventId: event.id };
  }
  throw new Error(`Unknown game-master tool: ${name}`);
}

async function talkToGameMaster(text: string): Promise<string> {
  gmHistory.push({ role: "user", content: text });
  for (let step = 0; step < 5; step += 1) {
    const setup = new FullGameMasterContextBuilder().build(create(GameMasterRequestSchema, { scenario: game.scenario() }));
    const message = await client.complete({
      model: dialogueModel,
      messages: [...setup.map(item => ({ role: item.role, content: item.content } satisfies OpenRouterMessage)), ...gmHistory],
      tools: gmTools, temperature: 0.8, max_tokens: 900,
    });
    gmHistory.push(message);
    if (!message.tool_calls?.length) {
      persistDevelopmentState();
      return message.content || "The game master pauses, considering your answer.";
    }
    for (const call of message.tool_calls) {
      let result: JsonObject;
      try {
        result = executeGmTool(call.function.name, JSON.parse(call.function.arguments) as JsonObject);
        persistDevelopmentState();
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      gmHistory.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
    }
  }
  throw new Error("The game master used too many consecutive tool calls");
}

const dialogueFormat = {
  type: "json_schema",
  json_schema: {
    name: "character_dialogue", strict: true,
    schema: {
      type: "object", additionalProperties: false, required: ["utterance", "newEvents", "goalUpdate"],
      properties: {
        utterance: { type: "string" },
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

async function talkToCharacter(characterId: string, text: string): Promise<string> {
  const scenario = game.scenario();
  if (scenario.world?.phase !== GamePhase.CONVERSATIONS) throw new Error("Character conversations have not begun");
  if (!scenario.characters.some(character => character.id === characterId && character.id !== "player")) throw new Error("Unknown character");
  const history = conversations.get(characterId) || [];
  const playerMessage = create(TranscriptMessageSchema, { role: TranscriptRole.PLAYER, speakerId: "player", text });
  const request = create(DialogueRequestSchema, { characterId, scenario, transcript: [...history, playerMessage] });
  const messages = new FullContextBuilder().build(request).map(item => ({ role: item.role, content: item.content } satisfies OpenRouterMessage));
  const completion = await client.complete({ model: dialogueModel, messages, response_format: dialogueFormat, temperature: 0.9, max_tokens: 900 });
  if (!completion.content) throw new Error("Character returned no dialogue");
  const parsed = JSON.parse(completion.content) as { utterance?: unknown; newEvents?: Array<{ type?: unknown; summary?: unknown }>; goalUpdate?: { goal?: unknown; reason?: unknown } | null };
  const response = create(DialogueResponseSchema, {
    utterance: asText(parsed.utterance, "utterance"),
    newEvents: (parsed.newEvents || []).map(event => create(EventSchema, {
      type: asText(event.type, "newEvents.type"), summary: asText(event.summary, "newEvents.summary"),
      characterIds: [characterId, "player"], visibility: EventVisibility.PRIVATE, details: {},
    })),
    goalUpdate: parsed.goalUpdate ? create(GoalUpdateSchema, {
      goal: asText(parsed.goalUpdate.goal, "goalUpdate.goal"), reason: asText(parsed.goalUpdate.reason, "goalUpdate.reason"),
    }) : undefined,
  });
  const committed = game.commitDialogue(characterId, response);
  if (!committed.ok) throw new Error(committed.issues.map(issue => issue.message).join("; "));
  conversations.set(characterId, [...history, playerMessage, create(TranscriptMessageSchema, {
    role: TranscriptRole.CHARACTER, speakerId: characterId, text: response.utterance,
  })]);
  persistDevelopmentState();
  return response.utterance;
}

function viewState(): JsonObject {
  const scenario = game.scenario();
  const world = scenario.world;
  const player = scenario.characters.find(character => character.id === scenario.playerCharacterId);
  return {
    phase: world?.phase === GamePhase.PLAYER_CREATION ? "player_creation" : world?.phase === GamePhase.CONVERSATIONS ? "conversations" : "other",
    day: world?.day || 0, location: world?.rooms.find(room => room.id === "great_hall")?.name || "Great Hall", premise: scenario.premise,
    player: player ? {
      id: player.id,
      name: player.name,
      lore: player.lore,
      currentGoal: player.currentGoal,
      relationships: player.relationships.map(relationship => ({
        characterId: relationship.characterId,
        characterName: scenario.characters.find(character => character.id === relationship.characterId)?.name || relationship.characterId,
        description: relationship.description,
      })),
    } : null,
    characters: scenario.characters.filter(character => character.id !== "player").map(character => ({ id: character.id, name: character.name })),
    gmMessages: gmHistory.filter(message => (message.role === "user" || message.role === "assistant") && message.content).map(message => ({ role: message.role, text: message.content })),
    conversations: Object.fromEntries([...conversations].map(([id, messages]) => [id, messages.map(message => ({
      role: message.role === TranscriptRole.CHARACTER ? "character" : "player", text: message.text,
    }))])),
  };
}

function debugState(): JsonObject {
  return {
    runtime: {
      dialogueModel,
      devInstanceId,
      eventClients: devEventClients.size,
    },
    scenario: toJson(ScenarioSchema, game.scenario(), { alwaysEmitImplicit: true }),
    gameMasterHistory: gmHistory,
    conversations: Object.fromEntries([...conversations].map(([characterId, messages]) => [
      characterId,
      messages.map(message => toJson(TranscriptMessageSchema, message, { alwaysEmitImplicit: true })),
    ])),
  };
}

function debugCharacter(characterId: string): JsonObject {
  const scenario = game.scenario();
  const character = scenario.characters.find(item => item.id === characterId);
  if (!character || characterId === "player") throw new Error(`Unknown NPC: ${characterId}`);
  if (!scenario.world) throw new Error("Scenario has no world");
  const transcript = conversations.get(characterId) || [];
  const request = create(DialogueRequestSchema, { characterId, scenario, transcript });
  return {
    character: toJson(CharacterSchema, character, { alwaysEmitImplicit: true }),
    visibleEvents: scenario.events
      .filter(event => event.visibility === EventVisibility.PUBLIC || event.characterIds.includes(characterId))
      .map(event => toJson(EventSchema, event, { alwaysEmitImplicit: true })),
    knownWorld: toJson(WorldStateSchema, worldForCharacter(scenario.world, characterId), { alwaysEmitImplicit: true }),
    conversation: transcript.map(message => toJson(TranscriptMessageSchema, message, { alwaysEmitImplicit: true })),
    modelMessages: new FullContextBuilder().build(request),
  };
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk); size += buffer.length;
    if (size > 64 * 1024) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as JsonObject;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function serveFile(pathname: string, response: ServerResponse): void {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safe = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const file = join(publicDir, safe);
  if (!file.startsWith(publicDir) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404); response.end("Not found"); return;
  }
  const mime: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
  response.writeHead(200, { "Content-Type": `${mime[extname(file)] || "application/octet-stream"}; charset=utf-8` });
  response.end(readFileSync(file));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/__dev/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      response.write(`event: ready\ndata: ${devInstanceId}\n\n`);
      devEventClients.add(response);
      request.on("close", () => devEventClients.delete(response));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, viewState());
    if (request.method === "GET" && url.pathname === "/api/debug") return json(response, 200, debugState());
    const characterDebug = request.method === "GET" ? url.pathname.match(/^\/api\/debug\/character\/([a-z_]+)$/) : null;
    if (characterDebug) return json(response, 200, debugCharacter(characterDebug[1]!));
    if (request.method === "POST" && url.pathname === "/api/reset") {
      game = new MemoryGame(fromJsonString(ScenarioSchema, readFileSync(scenarioFile, "utf8"))); gmHistory = []; conversations = new Map();
      persistDevelopmentState();
      return json(response, 200, viewState());
    }
    if (request.method === "POST" && url.pathname === "/api/gm") {
      const body = await readJson(request); const reply = await talkToGameMaster(asText(body.message, "message"));
      return json(response, 200, { reply, state: viewState() });
    }
    const talk = request.method === "POST" ? url.pathname.match(/^\/api\/talk\/([a-z_]+)$/) : null;
    if (talk) {
      const body = await readJson(request); const reply = await talkToCharacter(talk[1]!, asText(body.message, "message"));
      return json(response, 200, { reply, state: viewState() });
    }
    if (request.method === "POST" && url.pathname === "/api/end-day") return json(response, 501, { error: "The twelve-hour night loop is the next milestone." });
    if (request.method === "GET") return serveFile(url.pathname, response);
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return json(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Kingmaker is ready at http://127.0.0.1:${port}`);
  console.log(`Dialogue model: ${dialogueModel}`);
});

setInterval(() => {
  for (const response of devEventClients) response.write(": keepalive\n\n");
}, 15_000).unref();
