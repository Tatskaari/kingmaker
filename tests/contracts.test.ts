import { ModelTranscripts } from "../apps/web/src/model-transcripts.js";
import { courtAgentObservation } from "../apps/web/src/court-agent.js";
import { doorActionLegality } from "../packages/core/src/access.js";
import { actionsAtTile, type CourtInteractionLayer } from "../apps/web/src/court-interactions.js";
import { courtMarkers, courtPath, courtRoomAt, courtWalkPoint, redirectCourtPath, courtInteractionPoint, nearestDoorSpot } from "../apps/web/src/court-map.js";
import { PalaceDialogue, palaceSurroundings, palaceDialogueContext, createPalacePlayer } from "../apps/web/src/palace-dialogue.js";
import { interactionActions, executeInteraction } from "../apps/web/src/palace-interactions.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { create, fromBinary, fromJson, fromJsonString, toBinary, toJson, toJsonString } from "@bufbuild/protobuf";
import {
  AvailableActionSchema,
  DecisionRequestSchema,
  DialogueRequestSchema,
  EventSchema,
  EventVisibility,
  GameMasterRequestSchema,
  GamePhase,
  PlayerSetupSchema,
  RelationshipSchema,
  RelationshipUpdateSchema,
  CharacterSchema,
  ScenarioSchema,
  WorldMapSchema,
  TranscriptRole,
  TilePositionSchema,
  type Scenario,
} from "../packages/contracts/src/index.js";
import { FullContextBuilder, FullGameMasterContextBuilder, worldForCharacter, characterDecisionContext } from "../packages/core/src/context.js";
import { MemoryGame } from "../packages/core/src/game.js";
import { palaceMap } from "../apps/web/src/palace-map.js";

import { canWalk, findPath, pointKey, reachableRoutes } from "../apps/web/src/navigation.js";
import { palaceNodes, palaceEdges } from "../apps/web/src/palace-navigation.js";

import { createDoors, doorBlockers, doorGraph, toggleDoor } from "../apps/web/src/palace-doors.js";

import { JevClient, type Choose, type JevChoice } from "../packages/providers/src/jev.js";
import { PalaceAgent, legalActions, type AgentHost } from "../apps/web/src/palace-agent.js";

import { createFurniture, addFurnitureNodes, furnitureBlockers, furnitureActions, applyFurnitureAction, observeFurniture } from "../apps/web/src/palace-furniture.js";

const fixturePath = new URL("../content/scenarios/last-night.json", import.meta.url);
const load = (): Scenario => fromJsonString(ScenarioSchema, readFileSync(fixturePath, "utf8"));

test("the small authored scenario strictly parses and survives protobuf", () => {
  const scenario = load();
  const decoded = fromBinary(ScenarioSchema, toBinary(ScenarioSchema, scenario));
  assert.equal(toJsonString(ScenarioSchema, decoded), toJsonString(ScenarioSchema, scenario));
  assert.deepEqual(scenario.characters.map(character => character.id), ["merlin", "lancelot", "king"]);
  assert.equal(scenario.events.length, 3);
  assert.match(scenario.premise, /emissary from a vassal state of Caerwyn/);
  assert.equal(scenario.world?.phase, GamePhase.PLAYER_CREATION);
  assert.ok(scenario.world?.actors.every(actor => !actor.awake && actor.roomId === actor.homeRoomId));
  assert.equal(scenario.world?.rooms.length, 8);
  assert.ok(scenario.world?.rooms.every(room => room.searchSpots.length === 0 || room.searchSpots.length >= 3));
});

test("the palace map is a complete layered tile grid", () => {
  const decoded = fromBinary(WorldMapSchema, toBinary(WorldMapSchema, palaceMap));
  assert.equal(decoded.tiles.length, decoded.width * decoded.height);
  assert.equal(decoded.rooms.length, 8);
  assert.ok(decoded.tiles.some(tile => tile.layers.length > 1));
  assert.ok(decoded.tiles.flatMap(tile => tile.layers).some(layer => layer.solid && layer.bounds));

  const solidTileIds = new Set(decoded.tiles.flatMap(tile => tile.layers)
    .filter(layer => layer.solid)
    .map(layer => layer.tileId));
  assert.ok([2, 26].every(tileId => solidTileIds.has(tileId)), "horizontal wall sprites are used");
  assert.ok([13, 15].every(tileId => solidTileIds.has(tileId)), "vertical wall sprites are used");

  const passable = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) return false;
    const tile = decoded.tiles[y * decoded.width + x];
    return Boolean(tile?.layers.length && tile.layers.every(layer => !layer.solid));
  };
  const start = decoded.rooms.find(room => room.id === "great_hall")!.regions[0]!;
  const pending = [[start.x, start.y] as const];
  const reached = new Set<string>();
  while (pending.length) {
    const [x, y] = pending.shift()!;
    const key = `${x},${y}`;
    if (reached.has(key) || !passable(x, y)) continue;
    reached.add(key);
    pending.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }
  for (const room of decoded.rooms) {
    for (const region of room.regions) {
      for (let y = region.y; y < region.y + region.height; y += 1) {
        for (let x = region.x; x < region.x + region.width; x += 1) {
          assert.ok(reached.has(`${x},${y}`), `${room.name} floor at ${x},${y} is reachable`);
        }
      }
    }
  }
  // Facing rooms need a bottom edge, north cap and masonry face in separate
  // solid rows. A one-row band formerly produced overlapping, broken walls.
  for (const [x, y] of [[3, 8], [12, 14], [13, 24]] as const) {
    const band = [0, 1, 2].map(dy => decoded.tiles[(y + dy) * decoded.width + x]!.layers.at(-1)!.tileId);
    assert.deepEqual(band, [26, 2, 40]);
    assert.ok([0, 1, 2].every(dy => !passable(x, y + dy)));
  }
  const doorwayEdge = [0, 1, 2].map(dy => decoded.tiles[(8 + dy) * decoded.width + 4]!.layers.at(-1)!.tileId);
  assert.deepEqual(doorwayEdge, [5, 17, 59], "doorway uses inner corners and a wall end");
  assert.ok(reached.has(`15,${decoded.height - 1}`), "exterior entrance stays open");
});

test("game master context frames an emissary interview without defining the player", () => {
  const scenario = load();
  const request = create(GameMasterRequestSchema, { scenario });
  const messages = new FullGameMasterContextBuilder().build(request);
  const prompt = messages.map(message => message.content).join("\n");
  assert.equal(messages.length, 5);
  assert.match(prompt, /player define or invent their homeland/i);
  assert.match(prompt, /emissary from a vassal state of Caerwyn/i);
  assert.match(prompt, /Interview the player/);
  assert.doesNotMatch(prompt, /playerCharacterId/);
});

test("dialogue context includes premise before character context and conversation", () => {
  const scenario = load();
  const request = create(DialogueRequestSchema, {
    characterId: "merlin",
    scenario,
    transcript: [
      { role: TranscriptRole.PLAYER, speakerId: "player", text: "Would you trust Lancelot with the key?" },
      { role: TranscriptRole.CHARACTER, speakerId: "merlin", text: "Trust is too generous a word." },
    ],
  });
  const messages = new FullContextBuilder().build(request);
  assert.equal(messages.length, 8);
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[1]?.content ?? "", /^# Scenario premise[\s\S]*ancient law/);
  assert.match(messages[2]?.content ?? "", /# Character[\s\S]*# Current goal/);
  assert.match(messages[3]?.content ?? "", /^# Relationships/);
  assert.match(messages[4]?.content ?? "", /^# Events/);
  assert.match(messages[5]?.content ?? "", /^# Known world state/);
  assert.equal(messages[6]?.content, "Would you trust Lancelot with the key?");
  assert.equal(messages[7]?.role, "assistant");
});

test("Merlin sees his known key location but not Lancelot's hidden lockbox", () => {
  const scenario = load();
  assert.ok(scenario.world);
  const request = create(DialogueRequestSchema, { characterId: "merlin", scenario });
  const prompt = new FullContextBuilder().build(request).map(message => message.content).join("\n");
  const world = worldForCharacter(scenario.world, "merlin");
  assert.match(prompt, /brass_key/);
  assert.match(prompt, /merlin_desk/);
  assert.match(prompt, /left humiliated/);
  assert.ok(!world.objects.some(object => object.id === "crown_box"));
  assert.ok(!world.rooms.flatMap(room => room.searchSpots).some(spot => spot.id === "royal_bedside_chest"));
  assert.doesNotMatch(prompt, /ordinary banter|unexpectedly took offence/);
});

test("Lancelot sees the crown box while an uninformed king sees neither hiding place", () => {
  const scenario = load();
  assert.ok(scenario.world);
  const lancelot = worldForCharacter(scenario.world, "lancelot");
  const king = worldForCharacter(scenario.world, "king");
  assert.ok(lancelot.rooms.flatMap(room => room.searchSpots).some(spot => spot.id === "royal_bedside_chest"));
  assert.ok(lancelot.objects.some(object => object.id === "crown_box"));
  assert.ok(!lancelot.objects.some(object => object.id === "brass_key"));
  assert.ok(!lancelot.rooms.flatMap(room => room.searchSpots).some(spot => spot.id === "merlin_desk"));
  assert.ok(!king.objects.some(object => object.id === "brass_key" || object.id === "crown_box"));
  assert.ok(!king.rooms.flatMap(room => room.searchSpots).some(spot =>
    spot.id === "merlin_desk" || spot.id === "royal_bedside_chest",
  ));
});

test("Jev request carries free goal, events, world and grounded actions", () => {
  const scenario = load();
  const merlin = scenario.characters.find(character => character.id === "merlin");
  assert.ok(merlin && scenario.world);
  const actions = [
    create(AvailableActionSchema, {
      id: "wake:merlin",
      type: "wake",
      description: "Wake up in Merlin's chamber.",
      parameters: {},
    }),
  ];
  const request = create(DecisionRequestSchema, {
    character: merlin,
    world: worldForCharacter(scenario.world, "merlin"),
    recentEvents: scenario.events.filter(event =>
      event.characterIds.includes("merlin") || event.visibility === EventVisibility.PUBLIC,
    ),
    availableActions: actions,
  });
  assert.match(request.character?.currentGoal ?? "", /Remain in the Great Hall and greet the visiting player/);
  assert.deepEqual(request.availableActions.map(action => action.id), ["wake:merlin"]);
  assert.equal(request.world?.revision, 0);
  assert.equal(request.world?.day, 0);
  assert.equal(request.world?.solsticeDay, 2);
});

test("unknown fixture fields remain schema errors", () => {
  assert.throws(() => fromJsonString(ScenarioSchema, '{"id":"x","quests":[]}'));
});

test("creating the emissary begins day one with the whole cast in the Great Hall", () => {
  const game = new MemoryGame(load());
  const npcIds = ["merlin", "lancelot", "king"];
  const setup = create(PlayerSetupSchema, {
    homeland: "Valedorn",
    embassyRole: "special envoy",
    player: create(CharacterSchema, {
      id: "ignored",
      name: "Ilyra Venn",
      lore: "A Valedorn envoy carrying a trade mandate and a private interest in a peaceful succession.",
      currentGoal: "Learn what each claimant intends before choosing whom to support.",
      relationships: npcIds.map(characterId => create(RelationshipSchema, {
        characterId,
        description: `Ilyra has heard conflicting reports about ${characterId}.`,
      })),
    }),
    npcRelationships: npcIds.map(ownerCharacterId => create(RelationshipUpdateSchema, {
      ownerCharacterId,
      relationship: create(RelationshipSchema, {
        characterId: "player",
        description: "A newly arrived foreign envoy whose real loyalties are unknown.",
      }),
    })),
  });

  const created = game.createPlayer(setup);
  assert.equal(created.ok, true);
  const scenario = game.scenario();
  assert.equal(scenario.playerCharacterId, "player");
  assert.equal(scenario.world?.day, 1);
  assert.equal(scenario.world?.phase, GamePhase.CONVERSATIONS);
  assert.deepEqual(scenario.world?.actors.map(actor => actor.characterId).sort(), ["king", "lancelot", "merlin", "player"]);
  assert.ok(scenario.world?.actors.every(actor => actor.roomId === "great_hall" && actor.awake));
  for (const actor of scenario.world!.actors) {
    assert.deepEqual(actor.position, scenario.courtArrivalPlacements.find(placement => placement.characterId === actor.characterId)!.position);
  }
  assert.ok(npcIds.every(id => scenario.characters.find(character => character.id === id)?.relationships.some(relationship => relationship.characterId === "player")));
  const arrivals = scenario.events.filter(event => event.type === "arrival");
  assert.equal(arrivals.length, 3);
  assert.ok(arrivals.every(event => event.summary.includes("Ilyra Venn") && event.summary.includes("Valedorn")));
  assert.deepEqual(arrivals.map(event => event.characterIds[0]).sort(), [...npcIds].sort());
});

// Exercise the runtime using scripted model replies, without credentials or network calls.
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { OpenRouterClient, type OpenRouterMessage } from "../packages/providers/src/openrouter.js";
import { compulsionNarration, parseReplyOptions } from "../apps/web/src/reply-options.js";

const offer = (compelled: boolean, options = ["I want to protect my family.", "I intend to earn a place at court."]): OpenRouterMessage => ({
  role: "assistant", content: "What do you want from this journey?",
  tool_calls: [{ id: "offer-1", type: "function", function: {
    name: "offer_replies", arguments: JSON.stringify({ options, compelled }),
  } }],
});

test("GM choices survive saves, accept selected speech, and clear after the answer", async t => {
  const replies: OpenRouterMessage[] = [offer(true), { role: "assistant", content: "A scheme of your own! Tell me about your family." }];
  t.mock.method(OpenRouterClient.prototype, "complete", async () => replies.shift()!);
  const runtime = new BrowserGameRuntime(load(), "test");
  const reply = await runtime.talkToGameMaster("I refuse to say what I want.");
  assert.match(reply, new RegExp(compulsionNarration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const saved = structuredClone(runtime.snapshot());
  assert.equal(saved.gameMasterReplyOptions?.compelled, true);
  assert.equal(saved.gameMasterReplyOptions?.options.length, 2);
  const restored = new BrowserGameRuntime(load(), "test", saved);
  await restored.talkToGameMaster(saved.gameMasterReplyOptions!.options[0]!);
  assert.equal(restored.view().gmReplyOptions, null);
  assert.ok(restored.snapshot().gameMasterHistory.some(message => message.role === "user" && message.content === "I want to protect my family."));
  restored.reset();
  assert.equal(restored.view().gmReplyOptions, null);
});

test("failed GM requests retain offered replies and do not duplicate the player's answer", async t => {
  const runtime = new BrowserGameRuntime(load(), "test");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => offer(false));
  await runtime.talkToGameMaster("Give me some ideas.");
  const before = structuredClone(runtime.snapshot());
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { throw new Error("network unavailable"); });
  await assert.rejects(runtime.talkToGameMaster("My family."), /network unavailable/);
  assert.deepEqual(runtime.snapshot(), before);
});

test("NPC reply options are optional speech, never compulsion, and stay with their conversation", async t => {
  const scenario = load();
  scenario.world!.phase = GamePhase.CONVERSATIONS;
  const replies = [
    { utterance: "Will you help me?", newEvents: [], goalUpdate: null, replyOptions: ["On one condition.", "You have my word."], compelled: true },
    { utterance: "Name your condition.", newEvents: [], goalUpdate: null, replyOptions: [] },
  ];
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: { tools?: unknown }) => {
    assert.equal(request.tools, undefined, "NPCs must not receive GM tools");
    return { role: "assistant", content: JSON.stringify(replies.shift()) };
  });
  const runtime = new BrowserGameRuntime(scenario, "test");
  const initialEvents = scenario.events.length;
  await runtime.talkToCharacter("merlin", "What do you want?");
  const saved = structuredClone(runtime.snapshot());
  assert.deepEqual(saved.conversationReplyOptions?.merlin, ["On one condition.", "You have my word."]);
  assert.equal(saved.gameMasterReplyOptions, null, "NPC output cannot set GM compulsion");
  assert.equal((saved.scenario as { events: unknown[] }).events.length, initialEvents);
  assert.equal(saved.conversations.merlin?.length, 2, "Suggestions are not player speech yet");
  const restored = new BrowserGameRuntime(scenario, "test", saved);
  await restored.talkToCharacter("merlin", "On one condition.");
  assert.deepEqual(restored.snapshot().conversationReplyOptions?.merlin, []);
  assert.equal(restored.snapshot().conversationReplyOptions?.lancelot, undefined);
});

test("reply validation rejects malformed or duplicate suggestions and old saves load without options", () => {
  assert.deepEqual(parseReplyOptions(["I agree."], false), ["I agree."]);
  const many = Array.from({ length: 8 }, (_, index) => `Response ${index + 1}`);
  assert.deepEqual(parseReplyOptions(many, false), many);
  assert.throws(() => parseReplyOptions([], false));
  assert.throws(() => parseReplyOptions(["Yes", " Yes "]));
  assert.throws(() => parseReplyOptions(["Yes", " "]));
  assert.throws(() => parseReplyOptions(["Yes", 3]));
  assert.deepEqual(parseReplyOptions(undefined), []);
  const runtime = new BrowserGameRuntime(load(), "test");
  const saved = runtime.snapshot();
  delete saved.gameMasterReplyOptions;
  delete saved.conversationReplyOptions;
  const restored = new BrowserGameRuntime(load(), "test", saved);
  assert.equal(restored.view().gmReplyOptions, null);
  assert.deepEqual(restored.view().conversationReplyOptions, {});
});

test("private crossroads framing belongs to the GM, not the shared court premise", () => {
  const scenario = load();
  assert.doesNotMatch(scenario.premise, /crossroads|stranger/i);
  assert.match(scenario.gameMasterPrompt, /crossroads/);
  assert.match(scenario.systemPrompt, /cannot compel a response/);
});

test("GM compulsion is rejected after character creation", async t => {
  const scenario = load();
  scenario.world!.phase = GamePhase.CONVERSATIONS;
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ++calls === 1 ? offer(true) : { role: "assistant", content: "The choice is yours." });
  const runtime = new BrowserGameRuntime(scenario, "test");
  assert.equal(await runtime.talkToGameMaster("What now?"), "The choice is yours.");
  assert.equal(runtime.view().gmReplyOptions, null);
  assert.ok(runtime.snapshot().gameMasterHistory.some(message => message.role === "tool" && message.content?.includes("Compulsion is only available during character creation")));
});

test("GM tool-call prose and suggested question render as one complete reply", async t => {
  for (const compelled of [false, true]) {
    const modelReply = offer(compelled);
    modelReply.content = "Oh, Maren—fate keeps its appointments. What do you want from this journey?";
    t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply);
    const runtime = new BrowserGameRuntime(load(), "test");
    await runtime.talkToGameMaster("How do you know my name?");
    const messages = runtime.view().gmMessages as Array<{ role: string; text: string }>;
    const displayed = messages.filter(message => message.role === "assistant");
    assert.equal(displayed.length, 1);
    assert.equal(displayed[0]?.text, compelled ? `${compulsionNarration}\n\n${modelReply.content}` : modelReply.content);
    assert.equal(displayed[0]?.text.match(/What do you want from this journey\?/g)?.length, 1);
    const restored = new BrowserGameRuntime(load(), "test", structuredClone(runtime.snapshot()));
    assert.deepEqual(restored.view().gmMessages, messages);
  }
});


test("options-only tool calls wait for spoken dialogue rather than supplying a question", async t => {
  const toolReply = offer(true);
  toolReply.content = null;
  const replies: OpenRouterMessage[] = [toolReply, { role: "assistant", content: "What did you leave behind?" }];
  t.mock.method(OpenRouterClient.prototype, "complete", async () => replies.shift()!);
  const runtime = new BrowserGameRuntime(load(), "test");
  const reply = await runtime.talkToGameMaster("I cannot say.");
  assert.equal(reply, `${compulsionNarration}\n\nWhat did you leave behind?`);
  const messages = runtime.view().gmMessages as Array<{ role: string; text: string }>;
  assert.deepEqual(messages.filter(message => message.role === "assistant"), [{ role: "assistant", text: reply }]);
  assert.deepEqual(Object.keys(JSON.parse(toolReply.tool_calls![0]!.function.arguments)).sort(), ["compelled", "options"]);
});

test("the documented Stranger checklist and escalation are the runtime prompt", () => {
  const documented = readFileSync(new URL("../content/prompts/game-master.md", import.meta.url), "utf8")
    .replace(/^# The Laughing Stranger\s+/, "").trim();
  assert.equal(load().gameMasterPrompt, documented);
});

test("GM debug distinguishes consumed flags, raw responses, outdated prompts, and failures", async t => {
  const runtime = new BrowserGameRuntime(load(), "do-not-display-this-key");
  let debug = runtime.debugGameMaster() as any;
  assert.equal(debug.compulsion.consumedFlag, null);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => offer(true));
  await runtime.talkToGameMaster("I refuse again.");
  debug = runtime.debugGameMaster();
  assert.equal(debug.compulsion.active, true);
  assert.equal(debug.compulsion.consumedFlag, true);
  assert.equal(debug.compulsion.latestOffers[0].arguments.compelled, true);
  assert.equal(debug.latestTurnCalls[0].response.content, "What do you want from this journey?");
  assert.equal(debug.latestTurnCalls[0].toolResults[0].result.ok, true);
  assert.ok(debug.latestTurnCalls[0].request.messages.length > 0);
  assert.ok(!JSON.stringify(debug).includes("do-not-display-this-key"));
  const saved = runtime.snapshot();
  (saved.scenario as any).gameMasterPrompt = "An older prompt";
  assert.equal(new BrowserGameRuntime(load(), "test", saved).debugGameMaster().promptMatchesCurrentScenario, false);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { throw new Error("failed request"); });
  await assert.rejects(runtime.talkToGameMaster("I want to protect my family."), /failed request/);
  debug = runtime.debugGameMaster();
  assert.equal(debug.latestTurnCalls[0].error, "failed request");
  assert.equal(debug.compulsion.active, true, "Failed requests preserve the last accepted choices");
});


test("compulsion requires an offered choice, then releases free-text input", async t => {
  const replies: OpenRouterMessage[] = [offer(true), { role: "assistant", content: "Good. Tell me more." }, { role: "assistant", content: "I see." }];
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { calls += 1; return replies.shift()!; });
  const runtime = new BrowserGameRuntime(load(), "test");
  await runtime.talkToGameMaster("I refuse.");
  const before = structuredClone(runtime.snapshot());
  await assert.rejects(runtime.talkToGameMaster("I still refuse."), /Choose one of the offered responses/);
  assert.equal(calls, 1);
  assert.deepEqual(runtime.snapshot(), before);
  await runtime.talkToGameMaster("I want to protect my family.");
  assert.equal(runtime.view().gmReplyOptions, null);
  await runtime.talkToGameMaster("Here is my own answer.");
  assert.equal(calls, 3);
});

test("generated character waits for editable review and only enters court on explicit save", async t => {
  const ids = ["merlin", "lancelot", "king"];
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ({
    role: "assistant", content: null, tool_calls: [{ id: "draft", type: "function", function: {
      name: "create_player", arguments: JSON.stringify({ name: "Maren", homeland: "Alderreach", embassyRole: "Clerk", lore: "A clerk of the harbour.", currentGoal: "Win relief from tribute.", relationships: ids.map(characterId => ({ characterId, description: "I have not met them." })), npcViews: ids.map(characterId => ({ characterId, description: "An unknown witness." })) }),
    } }],
  }));
  const runtime = new BrowserGameRuntime(load(), "test");
  await runtime.talkToGameMaster("I am ready.");
  assert.equal(runtime.view().phase, "character_review");
  assert.equal(runtime.view().player, null);
  assert.equal(runtime.view().day, 0);
  const restored = new BrowserGameRuntime(load(), "test", structuredClone(runtime.snapshot()));
  assert.equal(restored.view().phase, "character_review");
  const draft = structuredClone(restored.snapshot().playerDraft) as any;
  draft.player.name = "Maren Reed";
  draft.homeland = "Westmere";
  draft.embassyRole = "Envoy";
  draft.player.currentGoal = "Return home safely.";
  draft.player.relationships[0].description = "I distrust Merlin.";
  draft.npcRelationships[0].relationship.description = "An envoy to watch carefully.";
  const invalid = structuredClone(draft);
  invalid.player.name = " ";
  assert.throws(() => restored.confirmPlayer(invalid), /Name must/);
  assert.equal(restored.view().phase, "character_review");
  restored.confirmPlayer(draft);
  assert.equal(restored.view().phase, "conversations");
  assert.equal(restored.view().day, 1);
  assert.equal((restored.view().player as any).name, "Maren Reed");
  assert.equal((restored.view().player as any).currentGoal, "Return home safely.");
  assert.equal((restored.view().player as any).relationships[0].description, "I distrust Merlin.");
  assert.equal(restored.snapshot().playerDraft, null);
  assert.match(JSON.stringify(restored.snapshot().scenario), /Maren Reed, Envoy from Westmere/);
  assert.throws(() => restored.confirmPlayer(draft), /No character is awaiting review/);
});

// Script model responses to verify the complete conversation lifecycle offline.

function conversationScenario(): Scenario {
  const scenario = load();
  scenario.world!.phase = GamePhase.CONVERSATIONS;
  scenario.world!.day = 1;
  scenario.playerCharacterId = "player";
  scenario.characters.push(create(CharacterSchema, { id: "player", name: "Envoy" }));
  return scenario;
}

const remembered = {
  newEvents: [{ type: "promise", summary: "The envoy promised Merlin help securing the succession." }],
  goalUpdate: { goal: "Meet the envoy tonight.", reason: "They offered help." },
  relationships: [{ characterId: "player", description: "A potential ally who offered help." }],
  lore: null,
};
const modelReply = (value: unknown): OpenRouterMessage => ({ role: "assistant", content: JSON.stringify(value) });

test("ending reviews the full transcript, saves private memory, and starts a fresh thread after reload", async t => {
  const requests: Array<{ messages: readonly { role: string; content: string | null }[] }> = [];
  const replies = [
    { utterance: "I need an ally." }, { utterance: "Then meet me tonight." }, remembered,
    { utterance: "Welcome back, my ally." },
  ];
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: typeof requests[number]) => {
    requests.push(request);
    return modelReply(replies.shift());
  });
  const scenario = conversationScenario();
  const runtime = new BrowserGameRuntime(scenario, "test");
  await runtime.talkToCharacter("merlin", "What troubles you?");
  await runtime.talkToCharacter("merlin", "I offer my help.");
  assert.deepEqual(fromJson(ScenarioSchema, runtime.snapshot().scenario), scenario, "Speaking does not prematurely commit memory");
  const openSave = structuredClone(runtime.snapshot());
  const restored = new BrowserGameRuntime(scenario, "test", openSave);
  await restored.endConversation("merlin");
  const review = requests[2]!.messages;
  assert.deepEqual(JSON.parse(review.at(-1)!.content!), [
    { speakerId: "player", text: "What troubles you?" }, { speakerId: "merlin", text: "I need an ally." },
    { speakerId: "player", text: "I offer my help." }, { speakerId: "merlin", text: "Then meet me tonight." },
  ]);
  const saved = structuredClone(restored.snapshot());
  assert.equal(saved.conversations.merlin, undefined);
  const updated = fromJson(ScenarioSchema, saved.scenario);
  const merlin = updated.characters.find(character => character.id === "merlin")!;
  assert.equal(merlin.currentGoal, remembered.goalUpdate.goal);
  assert.deepEqual(merlin.objectives, scenario.characters[0]!.objectives);
  assert.equal(merlin.lore, scenario.characters[0]!.lore);
  assert.equal(merlin.relationships.find(item => item.characterId === "player")?.description, remembered.relationships[0]!.description);
  assert.deepEqual(merlin.relationships.filter(item => item.characterId !== "player"), scenario.characters[0]!.relationships);
  assert.deepEqual(updated.characters.slice(1), scenario.characters.slice(1));
  const event = updated.events.at(-1)!;
  assert.equal(event.summary, remembered.newEvents[0]!.summary);
  assert.equal(event.visibility, EventVisibility.PRIVATE);
  assert.deepEqual(event.characterIds, ["merlin", "player"]);
  assert.equal(event.day, 1);
  assert.deepEqual(updated.events.slice(0, -1), scenario.events);
  assert.deepEqual(updated.world, { ...scenario.world, revision: scenario.world!.revision + 1 });
  const nextVisit = new BrowserGameRuntime(scenario, "test", saved);
  await nextVisit.endConversation("merlin");
  assert.equal(requests.length, 3, "Repeated end must not duplicate memory or call the model");
  await nextVisit.talkToCharacter("merlin", "Hello again.");
  const nextPrompt = requests[3]!.messages;
  assert.deepEqual(nextPrompt.filter(message => message.role !== "system"), [{ role: "user", content: "Hello again." }]);
  assert.match(nextPrompt.map(message => message.content).join("\n"), /potential ally|Meet the envoy tonight/);
  assert.equal(nextVisit.snapshot().conversations.merlin?.length, 2);
  const kingContext = nextVisit.debugCharacter("king");
  assert.doesNotMatch(JSON.stringify(kingContext), /envoy promised Merlin/);
});

test("failed or malformed reviews keep every part of the open conversation for retry", async t => {
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "I will consider it." }));
  await runtime.talkToCharacter("merlin", "Will you help?");
  const before = structuredClone(runtime.snapshot());
  const failures = [null, "{", "{}", JSON.stringify({ ...remembered, relationships: [{ characterId: "unknown", description: "An ally" }] }), JSON.stringify({ ...remembered, newEvents: [{ type: "promise", summary: " " }] })];
  for (const content of failures) {
    t.mock.method(OpenRouterClient.prototype, "complete", async () => ({ role: "assistant", content }));
    await assert.rejects(runtime.endConversation("merlin"));
    assert.deepEqual(runtime.snapshot(), before);
  }
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { throw new Error("Network failure"); });
  await assert.rejects(runtime.endConversation("merlin"), /Network failure/);
  assert.deepEqual(runtime.snapshot(), before);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply(remembered));
  await runtime.endConversation("merlin");
  assert.equal(runtime.snapshot().conversations.merlin, undefined);
});

test("empty conversations do not call the model and invalid targets cannot be ended", async t => {
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { assert.fail("No model call expected"); });
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  const before = runtime.snapshot();
  await runtime.endConversation("merlin");
  assert.deepEqual(runtime.snapshot(), before);
  await assert.rejects(runtime.endConversation("player"), /Unknown character/);
  await assert.rejects(runtime.endConversation("unknown"), /Unknown character/);
  await assert.rejects(new BrowserGameRuntime(load(), "test").endConversation("merlin"), /have not begun/);
});

test("ending one NPC's thread leaves other conversations intact and saves biography updates", async t => {
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Good evening." }));
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  await runtime.talkToCharacter("merlin", "Hello.");
  await runtime.talkToCharacter("king", "Your Majesty.");
  const kingHistory = runtime.snapshot().conversations.king;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({
    newEvents: [], goalUpdate: null, relationships: [], lore: "Merlin remembers his new appointment as court adviser.",
  }));
  await runtime.endConversation("merlin");
  assert.deepEqual(runtime.snapshot().conversations.king, kingHistory);
  assert.equal(fromJson(ScenarioSchema, runtime.snapshot().scenario).characters[0]!.lore, "Merlin remembers his new appointment as court adviser.");
});

// Navigation tests exercise actual palace geometry, dynamic obstruction and A* optimality.

test("closed threshold filters destinations; opening it restores valid paths", () => {
  const blocked = new Set(createDoors().find(door => door.id === "royal_door")!.tiles.map(pointKey));
  const closed = reachableRoutes(palaceMap, palaceNodes, palaceEdges, "great_hall", blocked);
  assert.equal(closed.length, palaceNodes.length - 2);
  assert.ok(!closed.some(route => route.node.id === "royal"));
  assert.ok(closed.some(route => route.node.id === "merlin"));
  assert.ok(closed.some(route => route.node.id === "north_junction"));
  const open = reachableRoutes(palaceMap, palaceNodes, palaceEdges, "great_hall");
  assert.equal(open.length, palaceNodes.length - 1);
  assert.deepEqual(open.find(route => route.node.id === "royal")?.via, ["great_hall", "north_junction", "royal"]);
  for (const route of [...closed, ...open]) {
    route.path.forEach((point, i) => {
      assert.ok(canWalk(palaceMap, point, new Set()));
      if (i) assert.equal(Math.abs(point.x - route.path[i - 1]!.x) + Math.abs(point.y - route.path[i - 1]!.y), 1);
    });
    assert.equal(pointKey(route.path.at(-1)!), pointKey(route.node));
  }
  const inside = reachableRoutes(palaceMap, palaceNodes, palaceEdges, "royal", blocked);
  assert.equal(inside.length, 0);
  assert.equal(findPath(palaceMap, { x: -1, y: 5 }, palaceNodes[0]!), undefined);
  assert.equal(findPath(palaceMap, { x: 0, y: 0 }, palaceNodes[0]!), undefined);
});

test("A* detours around blockers and matches a breadth-first shortest path", () => {
  const start = palaceNodes[0]!;
  const goal = palaceNodes.find(node => node.id === "merlin")!;
  const blocked = new Set(["15,20", "14,20", "16,20"]);
  const path = findPath(palaceMap, start, goal, blocked)!;
  assert.ok(path);
  assert.ok(path.every(point => !blocked.has(pointKey(point))));
  const queue = [{ x: start.x, y: start.y, distance: 0 }];
  const seen = new Set([pointKey(start)]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    if (pointKey(current) === pointKey(goal)) { assert.equal(path.length - 1, current.distance); return; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next = { x: current.x + dx, y: current.y + dy, distance: current.distance + 1 };
      if (!seen.has(pointKey(next)) && canWalk(palaceMap, next, blocked)) {
        seen.add(pointKey(next)); queue.push(next);
      }
    }
  }
  assert.fail("Goal should be reachable");
});

test("every palace door blocks its full threshold and can be operated from either side", () => {
  for (const candidate of createDoors()) {
    const doors = createDoors();
    doors.forEach(door => { door.open = true; });
    const door = doors.find(door => door.id === candidate.id)!;
    const [outside, inside] = door.sides;
    assert.ok(findPath(palaceMap, outside, inside, doorBlockers(doors)));
    assert.ok(toggleDoor(door, outside));
    assert.equal(door.open, false);
    assert.equal(findPath(palaceMap, outside, inside, doorBlockers(doors)), undefined);
    assert.equal(toggleDoor(door, palaceNodes[0]!), false, "remote interaction rejected");
    assert.equal(toggleDoor(door, outside, true), false, "interaction during movement rejected");
    assert.equal(toggleDoor(door, door.tiles[0]!), false, "occupied threshold rejected");
    assert.ok(toggleDoor(door, inside));
    assert.ok(findPath(palaceMap, outside, inside, doorBlockers(doors)));
  }
});

test("door approaches remain reachable while destinations behind closed doors are hidden", () => {
  const doors = createDoors();
  const graph = doorGraph(doors);
  const routes = reachableRoutes(palaceMap, graph.nodes, graph.edges, "great_hall", doorBlockers(doors));
  for (const id of ["merlin", "royal", "lancelot", "guest", "treasury"]) {
    assert.ok(!routes.some(route => route.node.id === id));
  }
  assert.ok(routes.some(route => route.node.id === "royal_door_outside"));
  const royal = doors.find(door => door.id === "royal_door")!;
  assert.ok(toggleDoor(royal, royal.sides[0]));
  const opened = reachableRoutes(palaceMap, graph.nodes, graph.edges, royal.sides[0].id, doorBlockers(doors));
  assert.ok(opened.some(route => route.node.id === "royal"));
  assert.ok(!opened.some(route => route.node.id === "merlin"));
  for (const route of opened) assert.ok(route.path.every(point => canWalk(palaceMap, point, doorBlockers(doors))));
});

test("Jev transport sends typed choices and rejects invalid responses and HTTP failures", async () => {
  let sent: Record<string, any> = {};
  const client = new JevClient("test-key", async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/alpha/decisions");
    sent = JSON.parse(String(init?.body));
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-key");
    return new Response(JSON.stringify({ answers: { next: { type: "choice", choice: "walk", probabilities: { walk: 1, stop: 0 }, confidence: 1 } } }));
  });
  const criteria = { walk: "Walk to Merlin", stop: "Stop" };
  assert.equal((await client.choose({ goal: "Merlin" }, "Choose", criteria, new AbortController().signal)).choice, "walk");
  assert.equal(sent.model, "typesafe/jev-1.13");
  assert.deepEqual(sent.questions.next.criteria, criteria);
  assert.ok(!JSON.stringify(sent).includes("test-key"));
  for (const answer of [
    { type: "choice", choice: "invented", probabilities: { walk: 1, stop: 0 } },
    { type: "choice", choice: "walk", probabilities: { walk: 2, stop: 0 } },
    { type: "choice", choice: "walk", probabilities: {} },
    { type: "noul", choice: "walk", probabilities: { walk: 1, stop: 0 } },
  ]) {
    const bad = new JevClient("key", async () => new Response(JSON.stringify({ answers: { next: answer } })));
    await assert.rejects(() => bad.choose({}, "", criteria, new AbortController().signal), /invalid/);
  }
  const failed = new JevClient("key", async () => new Response("unauthorized", { status: 401 }));
  await assert.rejects(() => failed.choose({}, "", criteria, new AbortController().signal), /HTTP 401/);
});

function agentFixture() {
  const doors = createDoors();
  const graph = doorGraph(doors);
  let current = graph.nodes[0]!;
  let revision = 0;
  const executed: string[] = [], reports: string[] = [];
  const host: AgentHost = {
    snapshot: () => ({ at: current.id, revision, world: { doors: doors.map(door => ({ id: door.id, open: door.open })) },
      actions: legalActions(reachableRoutes(palaceMap, graph.nodes, graph.edges, current.id, doorBlockers(doors)), doors, current) }),
    execute: async action => {
      assert.ok(host.snapshot().actions.some(candidate => candidate.id === action.id));
      if (action.type === "move") current = graph.nodes.find(node => node.id === action.target)!;
      else assert.ok(toggleDoor(doors.find(door => door.id === action.target)!, current));
      executed.push(action.id); revision++;
    },
    report: message => { reports.push(message); }, changed: () => {},
  };
  return { agent: new PalaceAgent(host), host, executed, reports, mutate: () => { revision++; } };
}
function choices(...ids: string[]): Choose {
  return async (_state, _instructions, criteria) => {
    const choice = ids.shift()!;
    assert.ok(Object.hasOwn(criteria, choice), `Missing candidate ${choice}`);
    return { choice, probabilities: Object.fromEntries(Object.keys(criteria).map(id => [id, id === choice ? 1 : 0])) };
  };
}

test("agent opens a blocking door and reaches its goal using only legal actions", async () => {
  const { agent, executed, reports } = agentFixture();
  await agent.run("Go to Merlin", choices("move_merlin_door_outside", "open_merlin_door", "move_merlin", "complete"));
  assert.deepEqual(executed, ["move_merlin_door_outside", "open_merlin_door", "move_merlin"]);
  assert.match(reports.at(-1)!, /reports the goal complete/);
  assert.equal(agent.running, false);
});

test("Step does one action; resume retains history; new goals start fresh", async () => {
  const { agent, executed, reports } = agentFixture();
  await agent.run("Go to Merlin", choices("move_merlin_door_outside"), true);
  assert.equal(executed.length, 1);
  assert.equal(agent.history.length, 1);
  await agent.run("Go to Merlin", choices("open_merlin_door", "move_merlin", "complete"));
  await agent.run("Return to Great Hall", choices("move_great_hall", "complete"));
  assert.equal(agent.history.length, 1);
  assert.match(reports.at(-1)!, /reports the goal complete/);
});

test("pause and reset discard in-flight Jev answers", async () => {
  for (const reset of [false, true]) {
    const { agent, executed } = agentFixture();
    await agent.run("Merlin", choices("move_merlin_door_outside"), true);
    let resolve!: (value: JevChoice) => void;
    const pending = agent.run("Merlin", () => new Promise(done => { resolve = done; }));
    if (reset) agent.reset(); else agent.pause();
    resolve({ choice: "open_merlin_door", probabilities: { open_merlin_door: 1 } });
    await pending;
    assert.equal(executed.length, 1);
    assert.equal(agent.running, false);
  }
});

test("agent rejects stale decisions, invented actions, network errors and unfulfillable goals", async () => {
  for (const failure of ["stale", "invented", "network", "unable"]) {
    const fixture = agentFixture();
    await fixture.agent.run("Go to Merlin", async () => {
      if (failure === "network") throw new Error("Network unavailable");
      if (failure === "unable") return { choice: "unable", probabilities: { unsupported: 1 } };
      if (failure === "stale") fixture.mutate();
      return { choice: failure === "invented" ? "teleport" : "move_merlin_door_outside", probabilities: {} };
    });
    assert.equal(fixture.executed.length, 0);
    assert.equal(fixture.agent.running, false);
    assert.ok(!fixture.reports.at(-1)!.includes("Goal reached"));
  }
});

test("arbitrary multi-stop goals are passed verbatim and do not stop at the first room", async () => {
  const { agent, executed, reports } = agentFixture();
  const goal = "Visit Merlin, return to the Great Hall, then close the hall door";
  const scripted = choices("move_merlin_door_outside", "open_merlin_door", "move_merlin", "move_great_hall", "move_hall_door_outside", "close_hall_door", "complete");
  await agent.run(goal, async (state, instructions, criteria, signal) => {
    assert.equal((state as { goal: string }).goal, goal);
    assert.ok(!Object.hasOwn(criteria, "merlin"), "no room-classification gate");
    return scripted(state, instructions, criteria, signal);
  });
  assert.equal(executed.length, 6);
  assert.match(reports.at(-1)!, /reports the goal complete/);
});

test("intentional repeated actions are allowed but the run stops at its action budget", async () => {
  const { agent, executed, reports } = agentFixture();
  await agent.run("Patrol back and forth forever", choices(...Array.from({length: 24}, (_, i) => i % 2 ? "move_great_hall" : "move_entrance")));
  assert.equal(executed.length, 24);
  assert.match(reports.at(-1)!, /Stopped after 24 actions/);
});

test("Jev default transport preserves the browser fetch receiver", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async function (this: unknown) {
      assert.equal(this, globalThis, "native browser fetch requires its Window receiver");
      return new Response(JSON.stringify({ answers: { next: { type: "choice", choice: "walk", probabilities: { walk: 1 } } } }));
    };
    const result = await new JevClient("test-key").choose({}, "Choose", { walk: "Walk" }, new AbortController().signal);
    assert.equal(result.choice, "walk");
  } finally { globalThis.fetch = original; }
});

test("401 diagnostics distinguish invalid keys from Decisions access and redact secrets", async () => {
  for (const valid of [false, true]) {
    const urls: string[] = [];
    const client = new JevClient("sk-or-secret", async url => {
      urls.push(String(url));
      if (String(url).endsWith("/key")) return new Response("{}", { status: valid ? 200 : 401 });
      return new Response(JSON.stringify({ error: { message: "Rejected sk-or-secret" } }), { status: 401 });
    });
    await assert.rejects(() => client.choose({}, "", { walk: "Walk" }, new AbortController().signal), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, valid ? /key authenticates/ : /also rejected this key/);
      assert.ok(!error.message.includes("sk-or-secret"));
      return true;
    });
    assert.equal(urls.length, 2);
  }
});

test("pausing during movement preserves the completed action for resuming a multi-step goal", async () => {
  const fixture = agentFixture();
  const execute = fixture.host.execute;
  let finish!: () => void;
  fixture.host.execute = action => new Promise(resolve => { finish = () => { void execute(action).then(resolve); }; });
  const pending = fixture.agent.run("Visit entrance then return", choices("move_entrance"));
  // Let the decision dispatch before pausing the in-flight movement.
  await Promise.resolve();
  fixture.agent.pause(); finish(); await pending;
  assert.equal(fixture.agent.history.length, 1);
  assert.match(fixture.agent.history[0]!, /entrance/i);
});

test("drawer contents are hidden until opened; taking the key transfers it exactly once", () => {
  const state = createFurniture();
  const drawers = state.furniture.find(item => item.id === "merlin_drawers")!;
  const beside = drawers.approach!;
  const observed = () => observeFurniture(state).find(item => (item as { id: string }).id === drawers.id);
  assert.ok(!JSON.stringify(observed()).includes("royal_key"));
  assert.ok(!furnitureActions(state, beside).some(action => action.type === "take_item"));
  assert.throws(() => applyFurnitureAction(state, beside, "take_royal_key"), /unavailable/);
  assert.throws(() => applyFurnitureAction(state, { x: 15, y: 21 }, "open_merlin_drawers"), /unavailable/);
  assert.throws(() => applyFurnitureAction(state, beside, "open_merlin_drawers", true), /unavailable/);
  applyFurnitureAction(state, beside, "open_merlin_drawers");
  assert.ok(JSON.stringify(observed()).includes("royal_key"));
  applyFurnitureAction(state, beside, "take_royal_key");
  assert.deepEqual(state.inventory.map(item => item.id), ["royal_key"]);
  assert.equal(drawers.contents.length, 0);
  assert.throws(() => applyFurnitureAction(state, beside, "take_royal_key"), /unavailable/);
  applyFurnitureAction(state, beside, "close_merlin_drawers");
  applyFurnitureAction(state, beside, "open_merlin_drawers");
  assert.ok(!furnitureActions(state, beside).some(action => action.type === "take_item"));
});

test("lockbox rejects keyless and remote opens; matching key is retained after use", () => {
  const state = createFurniture();
  const box = state.furniture.find(item => item.id === "coffer_03")!;
  const drawers = state.furniture.find(item => item.id === "merlin_drawers")!;
  assert.ok(!furnitureActions(state, box.approach!).some(action => action.id === "open_coffer_03"));
  assert.throws(() => applyFurnitureAction(state, box.approach!, "open_coffer_03"), /unavailable/);
  state.inventory.push({ id: "wrong_key", name: "Wrong key" });
  assert.throws(() => applyFurnitureAction(state, box.approach!, "open_coffer_03"), /unavailable/);
  applyFurnitureAction(state, drawers.approach!, "open_merlin_drawers");
  applyFurnitureAction(state, drawers.approach!, "take_royal_key");
  assert.throws(() => applyFurnitureAction(state, drawers.approach!, "open_coffer_03"), /unavailable/);
  applyFurnitureAction(state, box.approach!, "open_coffer_03");
  assert.equal(box.open, true);
  assert.ok(state.inventory.some(item => item.id === "royal_key"));
  applyFurnitureAction(state, box.approach!, "close_coffer_03");
  applyFurnitureAction(state, box.approach!, "open_coffer_03");
  assert.equal(box.open, true);
  const reset = createFurniture();
  assert.equal(reset.inventory.length, 0);
  assert.equal(reset.furniture.find(item => item.id === "coffer_03")!.open, false);
  assert.equal(reset.furniture.find(item => item.id === "merlin_drawers")!.contents.length, 1);
});

test("furnishing blocks occupied tiles but preserves every waypoint when doors are open", () => {
  const state = createFurniture();
  const doors = createDoors(); doors.forEach(door => { door.open = true; });
  const graph = doorGraph(doors); addFurnitureNodes(graph, state);
  const blocked = new Set([...doorBlockers(doors), ...furnitureBlockers(state)]);
  assert.equal(new Set(furnitureBlockers(state)).size, state.furniture.length);
  for (const furniture of state.furniture) {
    assert.ok(canWalk(palaceMap, furniture, new Set()), "furniture is placed on floor");
    assert.ok(!canWalk(palaceMap, furniture, blocked));
  }
  const routes = reachableRoutes(palaceMap, graph.nodes, graph.edges, "great_hall", blocked);
  assert.equal(routes.length, graph.nodes.length - 1);
  for (const route of routes) assert.ok(route.path.every(point => canWalk(palaceMap, point, blocked)));
});

test("Jev action loop can fetch the key and open the king's lockbox through actual furniture state", async () => {
  const state = createFurniture(), doors = createDoors(), graph = doorGraph(doors);
  addFurnitureNodes(graph, state);
  let current = graph.nodes[0]!, revision = 0;
  const reports: string[] = [];
  const host: AgentHost = {
    snapshot: () => {
      const blocked = new Set([...doorBlockers(doors), ...furnitureBlockers(state)]);
      return { at: current.id, revision, world: { furniture: observeFurniture(state), inventory: state.inventory },
        actions: [...legalActions(reachableRoutes(palaceMap, graph.nodes, graph.edges, current.id, blocked), doors, current), ...furnitureActions(state, current)] };
    },
    execute: async action => {
      assert.ok(host.snapshot().actions.some(legal => legal.id === action.id));
      if (action.type === "move") current = graph.nodes.find(node => node.id === action.target)!;
      else if (action.type === "open" || action.type === "close") assert.ok(toggleDoor(doors.find(door => door.id === action.target)!, current));
      else applyFurnitureAction(state, current, action.id);
      revision++;
    }, report: message => { reports.push(message); }, changed: () => {},
  };
  const agent = new PalaceAgent(host);
  await agent.run("Get the key from Merlin's drawers and open the king's lockbox", choices(
    "move_merlin_door_outside", "open_merlin_door", "move_merlin_drawers_approach", "open_merlin_drawers", "take_royal_key",
    "move_royal_door_outside", "open_royal_door", "move_coffer_03_approach", "open_coffer_03", "complete"));
  assert.ok(state.furniture.find(item => item.id === "coffer_03")!.open);
  assert.deepEqual(state.inventory.map(item => item.id), ["royal_key"]);
  assert.match(reports.at(-1)!, /reports the goal complete/);
});


test("palace decisions reuse Merlin's authored lore, relationships and only visible memories", () => {
  const scenario = load();
  const original = scenario.characters.find(character => character.id === "merlin")!;
  const context = characterDecisionContext(scenario, "merlin", "Find the key and open the royal lockbox");
  assert.equal(context.character.name, "Merlin");
  assert.equal(context.character.lore, original.lore);
  assert.deepEqual(context.character.objectives, original.objectives);
  assert.equal(context.character.currentGoal, "Find the key and open the royal lockbox");
  assert.equal(context.character.relationships.length, original.relationships.length);
  assert.equal(context.premise, scenario.premise);
  assert.ok(context.visibleEvents.some(event => event.id === "feast_joke_merlin"));
  assert.ok(context.visibleEvents.some(event => event.id === "solstice_rule"));
  assert.ok(!context.visibleEvents.some(event => event.id === "feast_joke_lancelot"));
  assert.notEqual(original.currentGoal, context.character.currentGoal, "source character is not mutated");
  assert.ok(!JSON.stringify(context).includes("Return spoken dialogue"), "dialogue output instructions are not decision instructions");
});

test("every agent decision receives the shared character context with the free-form task", async () => {
  const fixture = agentFixture();
  fixture.host.characterContext = goal => characterDecisionContext(load(), "merlin", goal);
  let inspected = false;
  await fixture.agent.run("Find the key", async state => {
    const request = state as { goal: string; characterContext: ReturnType<typeof characterDecisionContext> };
    assert.equal(request.characterContext.character.name, "Merlin");
    assert.equal(request.characterContext.character.currentGoal, request.goal);
    inspected = true;
    return { choice: "unable", probabilities: { unable: 1 } };
  });
  assert.ok(inspected);
});

test("coffers do not advertise the royal lockbox or key requirements before examination", () => {
  const state = createFurniture();
  const box = state.furniture.find(item => item.id === "coffer_03")!;
  const initial = JSON.stringify(observeFurniture(state));
  assert.ok(!initial.includes("King's lockbox"));
  assert.ok(!initial.includes("requiresItemToOpen"));
  assert.ok(!initial.includes("royal_seal"));
  assert.equal(box.approach!.name, "Carved wooden coffer");
  assert.throws(() => applyFurnitureAction(state, palaceNodes[0]!, "inspect_coffer_03"), /unavailable/);
  applyFurnitureAction(state, box.approach!, "inspect_coffer_03");
  const inspected = JSON.stringify(observeFurniture(state));
  assert.ok(inspected.includes("King's lockbox"));
  assert.ok(inspected.includes("requiresItemToOpen"));
  assert.ok(!inspected.includes("royal_seal"));
  assert.equal(box.open, false);
  assert.equal(box.searched, false);
  assert.ok(!furnitureActions(state, box.approach!).some(action => action.id === "open_coffer_03"));
});

test("all new containers expose and transfer their distinct contents only after opening", () => {
  const state = createFurniture();
  const containers = state.furniture.filter(item => item.kind !== "decoration");
  assert.equal(containers.length, 14);
  const itemIds = containers.flatMap(item => item.contents.map(item => item.id));
  assert.equal(new Set(itemIds).size, itemIds.length);
  assert.ok(itemIds.length >= 20);
  // Collect ordinary containers first; they include all three matching keys.
  const ordered = [...containers.filter(item => !item.requiredKey), ...containers.filter(item => item.requiredKey)];
  for (const container of ordered) {
    const before = furnitureActions(state, container.approach!);
    assert.ok(!before.some(action => action.target === container.id && action.type === "take_item"));
    applyFurnitureAction(state, container.approach!, `open_${container.id}`);
    const contents = [...container.contents];
    for (const item of contents) applyFurnitureAction(state, container.approach!, `take_${item.id}`);
    assert.equal(container.contents.length, 0);
    applyFurnitureAction(state, container.approach!, `close_${container.id}`);
    assert.ok(container.searched);
  }
  assert.equal(state.inventory.length, itemIds.length);
  assert.equal(new Set(state.inventory.map(item => item.id)).size, itemIds.length);
});

test("different coffers require their own matching keys", () => {
  const state = createFurniture();
  state.inventory.push({ id: "brass_key", name: "Small brass key" });
  const jewellery = state.furniture.find(item => item.id === "coffer_02")!;
  const royal = state.furniture.find(item => item.id === "coffer_03")!;
  const gatekeeper = state.furniture.find(item => item.id === "coffer_01")!;
  applyFurnitureAction(state, jewellery.approach!, "open_coffer_02");
  assert.throws(() => applyFurnitureAction(state, royal.approach!, "open_coffer_03"), /unavailable/);
  assert.throws(() => applyFurnitureAction(state, gatekeeper.approach!, "open_coffer_01"), /unavailable/);
  assert.ok(jewellery.open);
  assert.equal(state.inventory.length, 1);
});

test("interaction choices bundle reachable spots and distinguish both door sides", () => {
  const doors = createDoors(), furniture = createFurniture(), graph = doorGraph(doors);
  addFurnitureNodes(graph, furniture);
  const actionsAt = (id: string) => {
    const position = graph.nodes.find(node => node.id === id)!;
    const blocked = new Set([...doorBlockers(doors), ...furnitureBlockers(furniture)]);
    return interactionActions(reachableRoutes(palaceMap, graph.nodes, graph.edges, id, blocked), doors, furniture, position);
  };
  const initial = actionsAt("great_hall");
  assert.ok(initial.some(action => action.id === "open_hall_cabinet" && action.interactionSpot === "hall_cabinet_approach"));
  assert.ok(!initial.some(action => action.id === "open_merlin_drawers"));
  assert.ok(!initial.some(action => action.type === "move" && action.target.endsWith("_approach")));
  const merlinChoices = initial.filter(action => action.target === "merlin_door");
  assert.deepEqual(merlinChoices.map(action => action.interactionSpot), ["merlin_door_outside"]);
  assert.equal(initial.filter(action => action.target === "hall_door").length, 2);
  doors.find(door => door.id === "merlin_door")!.open = true;
  assert.ok(actionsAt("great_hall").some(action => action.id === "open_merlin_drawers"));
  assert.ok(actionsAt("merlin_drawers_approach").some(action => action.id === "open_merlin_drawers"));
  assert.ok(!actionsAt("royal").some(action => action.id === "open_coffer_03"));
});

test("combined interactions apply after arrival and revalidate or cancel before effects", async () => {
  const action = { id: "open_drawers", type: "open_container" as const, target: "drawers", interactionSpot: "spot", description: "Open drawers" };
  let at = "room", available = true, effects = 0;
  const order: string[] = [];
  const host = {
    actions: () => available ? [action] : [], at: () => at,
    walk: async (destination: string) => { order.push("walk"); at = destination; },
    apply: () => { assert.equal(at, "spot"); order.push("open"); effects++; },
  };
  await executeInteraction(action, host);
  assert.deepEqual(order, ["walk", "open"]);
  await executeInteraction(action, host);
  assert.deepEqual(order, ["walk", "open", "open"]);
  at = "room";
  await assert.rejects(executeInteraction(action, { ...host, walk: async () => { at = "spot"; available = false; } }), /no longer available/);
  assert.equal(effects, 2);
  available = true; at = "room";
  const controller = new AbortController();
  await assert.rejects(executeInteraction(action, { ...host, walk: async () => { at = "spot"; controller.abort(); } }, controller.signal), /abort/i);
  assert.equal(effects, 2);
});

test("combined actions navigate through doors, fetch the key and open the royal coffer", async () => {
  const doors = createDoors(), furniture = createFurniture(), graph = doorGraph(doors);
  addFurnitureNodes(graph, furniture);
  let current = graph.nodes.find(node => node.id === "great_hall")!;
  const routes = () => reachableRoutes(palaceMap, graph.nodes, graph.edges, current.id,
    new Set([...doorBlockers(doors), ...furnitureBlockers(furniture)]));
  const actions = () => interactionActions(routes(), doors, furniture, current);
  const host = {
    actions, at: () => current.id,
    walk: async (id: string) => { const route = routes().find(route => route.node.id === id); assert.ok(route); current = route.node; },
    apply: (action: ReturnType<typeof actions>[number]) => {
      if (action.type === "open" || action.type === "close") {
        assert.ok(toggleDoor(doors.find(door => door.id === action.target)!, current));
      } else applyFurnitureAction(furniture, current, action.id);
    },
  };
  for (const id of ["open_merlin_door_from_merlin_door_outside", "open_merlin_drawers", "take_royal_key",
    "open_royal_door_from_royal_door_outside", "open_coffer_03"]) {
    const action = actions().find(action => action.id === id); assert.ok(action, id);
    await executeInteraction(action, host);
  }
  assert.equal(current.id, "coffer_03_approach");
  assert.ok(furniture.inventory.some(item => item.id === "royal_key"));
  assert.ok(furniture.furniture.find(item => item.id === "coffer_03")!.open);
});

test("palace dialogue sees its actual room and conceals unopened contents and other rooms", () => {
  const furniture = createFurniture(), doors = createDoors();
  const room = palaceSurroundings({ x: 15, y: 21 }, doors, furniture);
  assert.equal(room.room, "Great Hall");
  const view = JSON.stringify(room);
  assert.match(view, /Hall sideboard/);
  assert.doesNotMatch(view, /Iron storeroom key|royal_seal|Merlin's bookcase|Carved wooden coffer/);
  const scenario = load(); scenario.characters.push(createPalacePlayer());
  const context = palaceDialogueContext(scenario, "Visit the treasury", room);
  const text = JSON.stringify(context);
  assert.match(text, /Alden/); assert.match(text, /cousin/);
  assert.match(text, /Visit the treasury/);
  assert.ok(!context.some(message => message.content.startsWith("# Known world state")));
  assert.doesNotMatch(text, /feast_joke_lancelot/);
  const sideboard = furniture.furniture.find(item => item.id === "hall_cabinet")!;
  applyFurnitureAction(furniture, sideboard.approach!, "open_hall_cabinet");
  assert.match(JSON.stringify(palaceSurroundings({ x: 15, y: 21 }, doors, furniture)), /Iron storeroom key/);
});

test("palace dialogue reviews intent into a returned goal and durable private memory without moving objects", async () => {
  const scenario = load(); scenario.characters.push(createPalacePlayer());
  const originalWorld = JSON.stringify(scenario.world);
  const eventsBefore = scenario.events.length;
  const dialogue = new PalaceDialogue(scenario, () => ({ room: "Great Hall" }), () => "Wait in the hall");
  await dialogue.speak("Please visit the treasury.", async request => {
    assert.equal(request.messages.at(-1)?.content, "Please visit the treasury.");
    return { role: "assistant", content: JSON.stringify({ utterance: "I shall go there.", replyOptions: ["Thank you."] }) };
  });
  assert.equal(dialogue.transcript.length, 2);
  const result = await dialogue.finish(async request => {
    assert.match(request.messages.at(-1)!.content!, /I shall go there/);
    return { role: "assistant", content: JSON.stringify({ newEvents: [{ type: "agreement", summary: "I agreed to visit the treasury at Alden's request." }],
      goalUpdate: { goal: "Visit the treasury", reason: "I agreed to Alden's request." }, relationships: [], lore: null }) };
  });
  assert.equal(result.goal, "Visit the treasury");
  assert.match(result.reason, /agreed/);
  assert.equal(scenario.characters.find(character => character.id === "merlin")!.currentGoal, result.goal);
  assert.equal(scenario.events.length, eventsBefore + 1);
  assert.equal(scenario.events.at(-1)!.visibility, EventVisibility.PRIVATE);
  assert.deepEqual(scenario.events.at(-1)!.characterIds, ["merlin", "player"]);
  assert.equal(JSON.stringify(scenario.world), originalWorld);
  assert.equal(dialogue.transcript.length, 0);
  assert.match(JSON.stringify(dialogue.context()), /I agreed to visit the treasury/);
});

test("palace review preserves conversation on invalid output and returns unchanged goal when appropriate", async () => {
  const scenario = load();
  const dialogue = new PalaceDialogue(scenario, () => ({ room: "Great Hall" }), () => "Stay here");
  await dialogue.speak("Hello", async () => ({ role: "assistant", content: '{"utterance":"Hello","replyOptions":[]}' }));
  const before = JSON.stringify(scenario);
  await assert.rejects(dialogue.finish(async () => ({ role: "assistant", content: '{"goalUpdate":{"goal":"Leave"}}' })), /incomplete/);
  assert.equal(dialogue.transcript.length, 2);
  assert.equal(JSON.stringify(scenario), before);
  const result = await dialogue.finish(async () => ({ role: "assistant", content: '{"newEvents":[],"goalUpdate":null,"relationships":[],"lore":null}' }));
  assert.equal(result.goal, "Stay here");
  assert.match(result.reason, /did not change/);
});

test("aborted palace replies and reviews cannot restore a reset conversation or mutate memory", async () => {
  const scenario = load(), controller = new AbortController();
  const dialogue = new PalaceDialogue(scenario, () => ({ room: "Great Hall" }), () => "Wait");
  await assert.rejects(dialogue.speak("Hello", async () => {
    controller.abort(); dialogue.reset();
    return { role: "assistant", content: '{"utterance":"Hello","replyOptions":[]}' };
  }, controller.signal), /abort/i);
  assert.equal(dialogue.transcript.length, 0);
  await dialogue.speak("Hello", async () => ({ role: "assistant", content: '{"utterance":"Hello","replyOptions":[]}' }));
  const before = JSON.stringify(scenario), reviewController = new AbortController();
  await assert.rejects(dialogue.finish(async () => {
    reviewController.abort(); dialogue.reset();
    return { role: "assistant", content: '{"newEvents":[],"goalUpdate":{"goal":"Leave","reason":"Agreed"},"relationships":[],"lore":null}' };
  }, reviewController.signal), /abort/i);
  assert.equal(dialogue.transcript.length, 0);
  assert.equal(JSON.stringify(scenario), before);
});

test("palace memory schema limits targets and normalizes names and duplicate relationship entries", async () => {
  const scenario = load(); scenario.characters.push(createPalacePlayer());
  const dialogue = new PalaceDialogue(scenario, () => ({ room: "Great Hall" }), () => "Wait");
  await dialogue.speak("Can you help me?", async () => ({ role: "assistant", content: '{"utterance":"Yes","replyOptions":[]}' }));
  const result = await dialogue.finish(async request => {
    const schema = request.response_format as { json_schema: { schema: { properties: { relationships: { items: { properties: { characterId: { enum: string[] } } } } } } } };
    assert.deepEqual(schema.json_schema.schema.properties.relationships.items.properties.characterId.enum, ["lancelot", "king", "player"]);
    return { role: "assistant", content: JSON.stringify({ newEvents: [], goalUpdate: { goal: "Help Alden", reason: "Agreed" }, lore: null,
      relationships: [{ characterId: "Alden", description: "He asked for help." }, { characterId: "player", description: "He asked for help." },
        { characterId: "alden", description: "I am willing to listen." }] }) };
  });
  assert.equal(result.goal, "Help Alden");
  const relationship = scenario.characters.find(character => character.id === "merlin")!.relationships.filter(item => item.characterId === "player");
  assert.equal(relationship.length, 1);
  assert.equal(relationship[0]!.description, "He asked for help.\nI am willing to listen.");
});

test("unknown or self relationship targets fail clearly without losing the palace conversation", async () => {
  const scenario = load(); scenario.characters.push(createPalacePlayer());
  const dialogue = new PalaceDialogue(scenario, () => ({}), () => "Wait");
  await dialogue.speak("Hello", async () => ({ role: "assistant", content: '{"utterance":"Hello","replyOptions":[]}' }));
  const before = JSON.stringify(scenario);
  for (const target of ["imaginary_person", "merlin"]) {
    await assert.rejects(dialogue.finish(async () => ({ role: "assistant", content: JSON.stringify({ newEvents: [], goalUpdate: null,
      relationships: [{ characterId: target, description: "A friend" }], lore: null }) })), /invalid relationship target/);
  }
  assert.equal(dialogue.transcript.length, 2);
  assert.equal(JSON.stringify(scenario), before);
});

test("main palace markers use saved rooms and separate characters on walkable tiles", () => {
  const markers = courtMarkers(load().courtArrivalPlacements.map(item => ({ id: item.characterId, name: item.characterId, roomId: item.roomId, position: item.position! })));
  assert.equal(new Set(markers.map(marker => pointKey(marker.point!))).size, 4);
  assert.ok(markers.every(marker => courtRoomAt(marker.point!)?.id === "great_hall"));
  assert.ok(markers.every(marker => courtPath(markers[0]!.point!, marker.point!)));
  const merlin = courtMarkers([{ id: "merlin", name: "Merlin", roomId: "merlin_chamber", position: { x: 5, y: 5 } }])[0]!;
  assert.equal(courtRoomAt(merlin.point!)?.id, "merlin_chamber");
  assert.equal(courtMarkers([{ id: "king", name: "King", roomId: "nonexistent_room" }])[0]!.point, undefined);
});

test("main palace movement validates routes and survives saving and restoring", () => {
  const scenario = load(); scenario.characters.push(createPalacePlayer()); scenario.playerCharacterId = "player";
  scenario.world!.phase = GamePhase.CONVERSATIONS;
  for (const actor of scenario.world!.actors) actor.roomId = "great_hall";
  scenario.world!.actors.push({ $typeName: "kingmaker.v1.ActorState", characterId: "player", homeRoomId: "guest_chamber", roomId: "great_hall", awake: true, position: create(TilePositionSchema, { x: 16, y: 22 }) });
  const runtime = new BrowserGameRuntime(scenario, "test");
  runtime.movePlayer({ x: 5, y: 10 });
  runtime.setDoor("merlin_door", true);
  runtime.movePlayer({ x: 5, y: 5 });
  assert.deepEqual(fromJson(ScenarioSchema, runtime.snapshot().scenario).world!.actors.find(actor => actor.characterId === "player")!.position, create(TilePositionSchema, { x: 5, y: 5 }));
  assert.equal(runtime.view().location, "Merlin's Chamber");
  const restored = new BrowserGameRuntime(scenario, "test", structuredClone(runtime.snapshot()));
  assert.deepEqual(restored.view().player && (restored.view().player as { position: unknown }).position, create(TilePositionSchema, { x: 5, y: 5 }));
  const before = JSON.stringify(restored.snapshot());
  assert.throws(() => restored.movePlayer({ x: 0, y: 0 }), /not reachable/);
  assert.throws(() => restored.movePlayer({ x: 6, y: 4 }), /not reachable/);
  assert.throws(() => restored.movePlayer({ x: NaN, y: 4 }), /not reachable/);
  assert.equal(JSON.stringify(restored.snapshot()), before);
  restored.movePlayer({ x: 15, y: 29 });
  assert.equal(restored.view().location, "Entrance Hall");
  restored.reset(); assert.deepEqual(fromJson(ScenarioSchema, restored.snapshot().scenario).world!.actors.find(actor => actor.characterId === "player")!.position, create(TilePositionSchema, { x: 16, y: 22 }));
  assert.throws(() => new BrowserGameRuntime(load(), "test").movePlayer({ x: 5, y: 5 }), /Enter the court/);
});


test("mid-walk redirection preserves the current visual position and rejects blocked destinations", () => {
  const original = courtPath({ x: 15, y: 21 }, { x: 5, y: 5 })!;
  const visual = courtWalkPoint(original, 2.4);
  const changed = redirectCourtPath(original, 2.4, { x: 26, y: 25 })!;
  assert.deepEqual(changed[0], visual);
  assert.deepEqual(changed[1], original[3]);
  assert.deepEqual(changed.at(-1), { x: 26, y: 25 });
  assert.equal(redirectCourtPath(original, 2.4, { x: 0, y: 0 }), undefined);
  const again = redirectCourtPath(changed, 0.2, { x: 15, y: 21 })!;
  assert.deepEqual(again[0], courtWalkPoint(changed, 0.2));
  assert.deepEqual(again.at(-1), { x: 15, y: 21 });
  const stop = redirectCourtPath(original, 3, original[3]!)!;
  assert.equal(stop.length, 1);
});


test("authored actor coordinates round-trip and rendering never invents positions", () => {
  const scenario = load();
  const restored = fromBinary(ScenarioSchema, toBinary(ScenarioSchema, scenario));
  for (const actor of restored.world!.actors) {
    assert.ok(actor.position);
    assert.equal(courtRoomAt(actor.position)?.id, actor.roomId);
    const marker = courtMarkers([{ id: actor.characterId, name: actor.characterId, roomId: actor.roomId, position: actor.position }])[0]!;
    assert.deepEqual(marker.point, actor.position);
  }
  assert.equal(courtMarkers([{ id: "merlin", name: "Merlin", roomId: "great_hall" }])[0]!.point, undefined);
  const customized = { x: 14, y: 21 };
  assert.deepEqual(courtMarkers([{ id: "merlin", name: "Merlin", roomId: "great_hall", position: customized }])[0]!.point, customized);
  assert.equal(courtMarkers([{ id: "merlin", name: "Merlin", roomId: "great_hall", position: { x: 5, y: 5 } }])[0]!.point, undefined);
});


test("tile menus gather every layer with stable action and layer order and preserve legality", () => {
  const layers: CourtInteractionLayer[] = [
    { id: "merlin", position: { x: 5, y: 5 }, order: 30, actions: [{ id: "talk", label: "Talk to Merlin", type: "talk", target: "merlin", order: 10, legality: "normal" }] },
    { id: "drawer", position: { x: 5, y: 5 }, order: 20, actions: [{ id: "inspect", label: "Inspect drawer", type: "inspect", target: "drawer", order: 20, legality: "illegal" }] },
    { id: "floor", position: { x: 5, y: 5 }, order: 0, actions: [{ id: "walk", label: "Walk here", type: "walk", target: "floor", order: 100, legality: "normal" }] },
    { id: "other", position: { x: 6, y: 5 }, order: 0, actions: [{ id: "wrong", label: "Elsewhere", type: "walk", target: "other", order: 0, legality: "normal" }] },
  ];
  const actions = actionsAtTile({ x: 5, y: 5 }, layers);
  assert.deepEqual(actions.map(action => action.id), ["talk", "inspect", "walk"]);
  assert.equal(actions[1]!.legality, "illegal");
  assert.deepEqual(actionsAtTile({ x: 5, y: 5 }, [...layers].reverse()), actions);
  const tied = layers.slice(0, 3).map(layer => ({ ...layer, actions: layer.actions.map(action => ({ ...action, order: 1 })) }));
  assert.deepEqual(actionsAtTile({ x: 5, y: 5 }, tied).map(action => action.id), ["walk", "inspect", "talk"]);
  assert.deepEqual(actionsAtTile({ x: 0, y: 0 }, layers), []);
});


test("interaction spots approach characters and honor authored furniture points", () => {
  const target = { x: 12, y: 20 }, start = { x: 16, y: 22 };
  const spot = courtInteractionPoint(start, target)!;
  assert.equal(Math.abs(spot.x - target.x) + Math.abs(spot.y - target.y), 1);
  assert.ok(courtPath(start, spot));
  assert.deepEqual(courtInteractionPoint(spot, target), spot);
  const authored = { x: 6, y: 5 };
  assert.deepEqual(courtInteractionPoint(start, { x: 6, y: 4 }, authored), authored);
  assert.equal(courtInteractionPoint(start, target, { x: 0, y: 0 }), undefined);
});


test("main doors choose the closest reachable side and block paths until opened", () => {
  const doors = load().world!.doors;
  const merlin = doors.find(door => door.id === "merlin_door")!;
  assert.equal(courtPath({ x: 15, y: 21 }, { x: 5, y: 5 }, doors), undefined);
  assert.deepEqual(nearestDoorSpot({ x: 15, y: 21 }, merlin, doors), merlin.interactionSpots[0]);
  merlin.open = true;
  assert.ok(courtPath({ x: 15, y: 21 }, { x: 5, y: 5 }, doors));
  assert.deepEqual(nearestDoorSpot({ x: 5, y: 5 }, merlin, doors), merlin.interactionSpots[1]);
  assert.deepEqual(nearestDoorSpot({ x: 5, y: 12 }, merlin, doors), merlin.interactionSpots[0]);
});

test("door operations validate approach and occupancy, and persist through saves", () => {
  const scenario = load(); scenario.characters.push(createPalacePlayer()); scenario.playerCharacterId = "player";
  scenario.world!.phase = GamePhase.CONVERSATIONS;
  scenario.world!.actors.push({ $typeName: "kingmaker.v1.ActorState", characterId: "player", homeRoomId: "guest_chamber", roomId: "great_hall", awake: true,
    position: create(TilePositionSchema, { x: 16, y: 22 }) });
  const runtime = new BrowserGameRuntime(scenario, "test");
  assert.throws(() => runtime.setDoor("merlin_door", true), /interaction spot/);
  assert.throws(() => runtime.movePlayer({ x: 5, y: 5 }), /not reachable/);
  runtime.movePlayer({ x: 5, y: 10 }); runtime.setDoor("merlin_door", true);
  runtime.movePlayer({ x: 5, y: 8 }); runtime.setDoor("merlin_door", false);
  const restored = new BrowserGameRuntime(scenario, "test", structuredClone(runtime.snapshot()));
  assert.equal(fromJson(ScenarioSchema, restored.snapshot().scenario).world!.doors.find(door => door.id === "merlin_door")!.open, false);
  assert.throws(() => restored.movePlayer({ x: 5, y: 12 }), /not reachable/);
  restored.setDoor("merlin_door", true);
  const occupied = fromJson(ScenarioSchema, restored.snapshot().scenario);
  occupied.world!.actors.find(actor => actor.characterId === "merlin")!.position = create(TilePositionSchema, { x: 5, y: 9 });
  const blocked = new BrowserGameRuntime(occupied, "test");
  assert.throws(() => blocked.setDoor("merlin_door", false), /standing in the doorway/);
});


test("bedroom doors are illegal to open except for characters on the room access list", () => {
  const world = load().world!;
  for (const [id, resident] of [["merlin_door", "merlin"], ["lancelot_door", "lancelot"], ["royal_door", "king"], ["guest_door", "player"]]) {
    const door = world.doors.find(door => door.id === id)!;
    assert.equal(doorActionLegality(door, world.rooms, resident!), "normal");
    assert.equal(doorActionLegality(door, world.rooms, "stranger"), "illegal");
    assert.equal(doorActionLegality({ ...door, open: true }, world.rooms, "stranger"), "normal");
  }
  const merlin = world.doors.find(door => door.id === "merlin_door")!;
  assert.equal(doorActionLegality(merlin, world.rooms, "player"), "illegal");
  world.rooms.find(room => room.id === "merlin_chamber")!.allowedCharacterIds.push("player");
  assert.equal(doorActionLegality(merlin, world.rooms, "player"), "normal");
  const hall = world.doors.find(door => door.id === "hall_door")!;
  assert.equal(doorActionLegality({ ...hall, open: false }, world.rooms, "stranger"), "normal");
  const restored = fromBinary(ScenarioSchema, toBinary(ScenarioSchema, load())).world!;
  assert.equal(doorActionLegality(restored.doors.find(door => door.id === "royal_door")!, restored.rooms, "player"), "illegal");
});


test("NPC dialogue frames the current goal as a concrete planner task while retaining motives", () => {
  const scenario = load();
  assert.ok(scenario.characters.every(character => character.currentGoal.includes("greet the visiting player")));
  const messages = new FullContextBuilder().build(create(DialogueRequestSchema, { scenario, characterId: "merlin" }));
  const context = messages.map(message => message.content).join("\n");
  assert.match(context, /Immediate goal for the action planner/);
  assert.match(context, /available actions such as moving, talking/);
  assert.match(context, /concrete next step rather than an open-ended objective/);
  assert.match(context, /Return null if there is no task to perform/);
  assert.match(context, /follow through after ending the conversation/);
  assert.match(context, /He wants the king replaced/);
});

test("NPC leave-taking persists, blocks more speech, and reviews closing words once", async t => {
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Excuse me; I must attend to my duties.", endConversation: true, replyOptions: [] }));
  await runtime.talkToCharacter("merlin", "Good evening.");
  const saved = structuredClone(runtime.snapshot());
  assert.equal(saved.conversationEndRequested?.merlin, true);
  assert.deepEqual(saved.conversationReplyOptions?.merlin, []);
  const restored = new BrowserGameRuntime(conversationScenario(), "test", saved);
  await assert.rejects(restored.talkToCharacter("merlin", "Wait!"), /ended the conversation/);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { throw new Error("Offline"); });
  await assert.rejects(restored.endConversation("merlin"), /Offline/);
  assert.deepEqual(restored.snapshot(), saved);
  let reviews = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: { messages: readonly { content: string | null }[] }) => {
    reviews++;
    assert.match(request.messages.at(-1)!.content!, /attend to my duties/);
    assert.match(JSON.stringify(request.messages), /Long-term objectives/);
    return modelReply(remembered);
  });
  await restored.endConversation("merlin");
  await restored.endConversation("merlin");
  assert.equal(reviews, 1);
  assert.equal(restored.snapshot().conversationEndRequested?.merlin, undefined);
});

test("authored objectives remain distinct from immediate greeting goals in model context", () => {
  const scenario = load();
  for (const character of scenario.characters) {
    assert.equal(character.objectives.length, 3);
    const context = new FullContextBuilder().build(create(DialogueRequestSchema, { scenario, characterId: character.id }));
    for (const objective of character.objectives) assert.ok(context.some(message => message.content.includes(objective)));
    assert.match(character.currentGoal, /greet the visiting player/);
  }
});

function furnishedCourt(): Scenario {
  const scenario = conversationScenario();
  scenario.world!.actors.push({ $typeName: "kingmaker.v1.ActorState", characterId: "player", homeRoomId: "guest_chamber", roomId: "great_hall", awake: true, position: create(TilePositionSchema, { x: 16, y: 22 }) });
  return scenario;
}

test("main containers enforce approaches and keys, conceal contents, and persist item transfers", () => {
  const scenario = furnishedCourt(), runtime = new BrowserGameRuntime(scenario, "test");
  const known = worldForCharacter(scenario.world!, "player");
  assert.ok(!known.objects.some(item => item.id === "palace_royal_key"));
  assert.equal(known.fixtures.find(item => item.id === "palace_coffer_03")!.requiredKeyId, "");
  assert.throws(() => runtime.interactFixture("open_palace_merlin_drawers"), /interaction spot/);
  runtime.movePlayer({ x: 5, y: 10 }); runtime.setDoor("merlin_door", true);
  runtime.movePlayer({ x: 6, y: 5 });
  assert.match(runtime.interactFixture("open_palace_merlin_drawers"), /Royal lockbox key/);
  let saved = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.ok(worldForCharacter(saved.world!, "player").objects.some(item => item.id === "palace_royal_key"));
  assert.match(runtime.interactFixture("take_palace_royal_key"), /Picked up/);
  assert.throws(() => runtime.interactFixture("take_palace_royal_key"), /Unknown/);
  runtime.interactFixture("close_palace_merlin_drawers");
  runtime.movePlayer({ x: 15, y: 10 }); runtime.setDoor("royal_door", true);
  runtime.movePlayer({ x: 17, y: 5 });
  runtime.interactFixture("open_palace_coffer_03");
  runtime.interactFixture("take_palace_royal_seal");
  const restored = new BrowserGameRuntime(scenario, "test", structuredClone(runtime.snapshot()));
  saved = fromJson(ScenarioSchema, restored.snapshot().scenario);
  assert.equal(saved.world!.objects.find(item => item.id === "palace_royal_seal")!.locationId, "player");
  assert.equal(saved.world!.objects.find(item => item.id === "palace_royal_key")!.locationId, "player", "Key is not consumed");
  assert.equal(saved.world!.fixtures.find(item => item.id === "palace_coffer_03")!.open, true);
  assert.equal(saved.world!.objects.find(item => item.id === "crown")!.locationId, "crown_box");
});

test("trying locked containers needs the correct carried key and preserves concealed loot", () => {
  const scenario = furnishedCourt();
  for (const door of scenario.world!.doors) door.open = true;
  const runtime = new BrowserGameRuntime(scenario, "test");
  runtime.movePlayer({ x: 17, y: 5 });
  assert.match(runtime.interactFixture("open_palace_coffer_03"), /locked/);
  const saved = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.equal(saved.world!.fixtures.find(item => item.id === "palace_coffer_03")!.open, false);
  assert.ok(!worldForCharacter(saved.world!, "player").objects.some(item => item.id === "palace_royal_seal"));
  assert.throws(() => runtime.interactFixture("take_palace_royal_seal"), /Unknown/);
});

test("resetting physical world keeps character and conversation while refreshing containers and placements", async t => {
  const authored = load(), scenario = furnishedCourt();
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Welcome, envoy." }));
  const runtime = new BrowserGameRuntime(authored, "test", new BrowserGameRuntime(scenario, "test").snapshot());
  await runtime.talkToCharacter("merlin", "Hello.");
  runtime.movePlayer({ x: 20, y: 21 });
  runtime.interactFixture("open_palace_hall_cabinet");
  runtime.interactFixture("take_palace_iron_key");
  const before = runtime.snapshot(), characters = fromJson(ScenarioSchema, before.scenario).characters;
  runtime.resetWorld();
  const after = runtime.snapshot(), result = fromJson(ScenarioSchema, after.scenario);
  assert.deepEqual(result.characters, characters);
  assert.deepEqual(after.conversations, before.conversations);
  assert.deepEqual(result.events, fromJson(ScenarioSchema, before.scenario).events);
  assert.deepEqual(result.world!.fixtures, authored.world!.fixtures);
  assert.deepEqual(result.world!.objects, authored.world!.objects);
  assert.deepEqual(result.world!.doors, authored.world!.doors);
  for (const actor of result.world!.actors) assert.deepEqual(actor.position, authored.courtArrivalPlacements.find(item => item.characterId === actor.characterId)!.position);
  assert.equal(result.world!.phase, GamePhase.CONVERSATIONS);
  assert.equal(result.world!.actors.filter(actor => actor.characterId === "player").length, 1);
  assert.deepEqual(new BrowserGameRuntime(authored, "test", after).snapshot(), after);
  assert.throws(() => new BrowserGameRuntime(authored, "test").resetWorld(), /Create your character/);
});

test("reviewed immediate goal reaches Jev, which opens doors and moves the NPC in saved world state", async t => {
  const scenario = furnishedCourt();
  for (const actor of scenario.world!.actors) {
    const placement = scenario.courtArrivalPlacements.find(item => item.characterId === actor.characterId)!;
    actor.position = placement.position; actor.roomId = placement.roomId;
  }
  const runtime = new BrowserGameRuntime(scenario, "test");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Meet me in my chamber." }));
  await runtime.talkToCharacter("merlin", "Let's speak privately.");
  await assert.rejects(runtime.planNpc("merlin", [], new AbortController().signal), /review first/);
  const goal = "Go to Merlin's Chamber and wait for the player.";
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newEvents: [], relationships: [], goalUpdate: { goal, reason: "Agreed a meeting." }, lore: null }));
  await runtime.endConversation("merlin");
  let step = 0;
  t.mock.method(JevClient.prototype, "choose", async (state: any, _instructions: unknown, criteria: Record<string, string>) => {
    assert.equal(state.goal, goal);
    assert.equal(state.characterContext.character.id, "merlin");
    assert.equal(state.characterContext.character.objectives.length, 3);
    assert.ok(!JSON.stringify(state.world).includes("Sealed royal decree"));
    const choice = ["open_merlin_door_0", "move_merlin", "complete"][step++]!;
    assert.ok(criteria[choice]);
    if (step === 1) assert.ok(!criteria.move_merlin, "Closed room cannot be selected as a move target");
    return { choice, probabilities: { [choice]: 1 } };
  });
  for (let i = 0; i < 2; i++) {
    const plan = await runtime.planNpc("merlin", [], new AbortController().signal);
    assert.ok(plan.action);
    runtime.executeNpcAction("merlin", plan.action.id, plan.revision, plan.goal);
  }
  const finished = await runtime.planNpc("merlin", [], new AbortController().signal);
  assert.equal(finished.decision.choice, "complete");
  const saved = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.equal(saved.world!.actors.find(actor => actor.characterId === "merlin")!.roomId, "merlin_chamber");
  assert.deepEqual(saved.world!.actors.find(actor => actor.characterId === "player")!.position, scenario.world!.actors.find(actor => actor.characterId === "player")!.position);
  assert.deepEqual(new BrowserGameRuntime(scenario, "test", runtime.snapshot()).snapshot(), runtime.snapshot());
});

test("NPC actions use their own keys and inventory, reject stale plans, and preserve the player's inventory", () => {
  const scenario = furnishedCourt();
  for (const door of scenario.world!.doors) door.open = true;
  const merlin = scenario.world!.actors.find(actor => actor.characterId === "merlin")!;
  merlin.roomId = "merlin_chamber"; merlin.position = create(TilePositionSchema, { x: 5, y: 5 });
  const runtime = new BrowserGameRuntime(scenario, "test");
  const activeSnapshot = runtime.snapshot();
  activeSnapshot.npcActivities = { merlin: { status: "active", goal: scenario.characters.find(item => item.id === "merlin")!.currentGoal, history: [] } };
  runtime.restore(activeSnapshot);
  function execute(id: string) {
    const s = fromJson(ScenarioSchema, runtime.snapshot().scenario), observation = courtAgentObservation(s, "merlin");
    assert.ok(observation.actions.some(action => action.id === id));
    return runtime.executeNpcAction("merlin", id, observation.revision, observation.goal);
  }
  execute("open_palace_merlin_drawers"); execute("take_palace_royal_key"); execute("move_royal"); execute("open_palace_coffer_03"); execute("take_palace_royal_seal");
  const snapshot = runtime.snapshot(), saved = fromJson(ScenarioSchema, snapshot.scenario);
  assert.equal(saved.world!.objects.find(item => item.id === "palace_royal_key")!.locationId, "merlin");
  assert.equal(saved.world!.objects.find(item => item.id === "palace_royal_seal")!.locationId, "merlin");
  assert.deepEqual(runtime.view().inventory, []);
  const observation = courtAgentObservation(saved, "merlin");
  runtime.resetWorld();
  assert.throws(() => runtime.executeNpcAction("merlin", observation.actions[0]!.id, observation.revision, observation.goal), /World changed|not accepting actions/);
  assert.throws(() => courtAgentObservation(saved, "player"), /NPC/);
});

test("greeting goal is idle until the LLM explicitly assigns a task", async t => {
  const runtime = new BrowserGameRuntime(furnishedCourt(), "test");
  assert.ok(Object.values(runtime.view().npcActivities as Record<string, {status: string}>).every(activity => activity.status === "idle"));
  await assert.rejects(runtime.planNpc("merlin", [], new AbortController().signal), /idle/);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Welcome." }));
  await runtime.talkToCharacter("merlin", "Hello.");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newEvents: [], relationships: [], goalUpdate: null, lore: null }));
  await runtime.endConversation("merlin");
  assert.equal(runtime.snapshot().npcActivities?.merlin?.status, "idle");
  assert.match(fromJson(ScenarioSchema, runtime.snapshot().scenario).characters[0]!.currentGoal, /greet the visiting player/);
  await assert.rejects(runtime.planNpc("merlin", [], new AbortController().signal), /idle/);
});

test("NPC reviews actual planner results, can activate a follow-up, and later returns idle", async t => {
  const runtime = new BrowserGameRuntime(furnishedCourt(), "test");
  const active = runtime.snapshot();
  active.npcActivities = { merlin: { status: "active", goal: "Inspect my drawers.", history: ["Merlin's chest of drawers is closed."] } };
  runtime.restore(active);
  runtime.finishNpcRun("merlin", "complete", "Jev chose complete with confidence 0.8.");
  const ended = runtime.snapshot();
  assert.equal(ended.npcActivities!.merlin!.status, "idle");
  assert.equal(ended.npcActivities!.merlin!.reviewPending, true);
  await assert.rejects(runtime.planNpc("merlin", [], new AbortController().signal), /idle/);
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: { messages: {content: string}[] }) => {
    const outcome = JSON.parse(request.messages.at(-1)!.content);
    assert.equal(outcome.goal, "Inspect my drawers.");
    assert.deepEqual(outcome.actionsPerformed, ["Merlin's chest of drawers is closed."]);
    assert.equal(outcome.result.reason, "complete");
    assert.ok(outcome.observations.location);
    return modelReply({ newEvents: [{ type: "observation", summary: "My drawers are closed." }], relationships: [], lore: null,
      goalUpdate: { goal: "Open my drawers.", reason: "I want to examine the contents." } });
  });
  await runtime.reviewNpcOutcome("merlin");
  assert.equal(runtime.snapshot().npcActivities!.merlin!.status, "active");
  assert.equal(runtime.snapshot().npcActivities!.merlin!.goal, "Open my drawers.");
  assert.deepEqual(runtime.snapshot().npcActivities!.merlin!.history, []);
  assert.deepEqual(fromJson(ScenarioSchema, runtime.snapshot().scenario).events.at(-1)!.characterIds, ["merlin"], "Private planner memories do not become player knowledge");
  runtime.finishNpcRun("merlin", "unable", "No progress possible.");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newEvents: [], relationships: [], lore: null, goalUpdate: null }));
  await runtime.reviewNpcOutcome("merlin");
  assert.equal(runtime.snapshot().npcActivities!.merlin!.status, "idle");
  assert.equal(runtime.snapshot().npcActivities!.merlin!.reviewPending, false);
  const done = runtime.snapshot();
  await runtime.reviewNpcOutcome("merlin");
  assert.deepEqual(runtime.snapshot(), done, "Repeated review is a no-op");
});

test("outcome review survives reload and failure; replanning cap leaves a proposed goal idle", async t => {
  const scenario = furnishedCourt(), runtime = new BrowserGameRuntime(scenario, "test");
  const active = runtime.snapshot(); active.npcActivities = { merlin: { status: "active", goal: "Find a way through.", history: [] } }; runtime.restore(active);
  runtime.finishNpcRun("merlin", "limit", "24 actions exhausted.");
  const pending = runtime.snapshot();
  const restored = new BrowserGameRuntime(scenario, "test", pending);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { throw new Error("Offline"); });
  await assert.rejects(restored.reviewNpcOutcome("merlin"), /Offline/);
  assert.deepEqual(restored.snapshot(), pending);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newEvents: [], relationships: [], lore: null, goalUpdate: {goal: "Go to the Great Hall.", reason: "Try later."} }));
  await restored.reviewNpcOutcome("merlin", false);
  assert.equal(restored.snapshot().npcActivities!.merlin!.status, "idle");
  assert.equal(restored.snapshot().npcActivities!.merlin!.reviewPending, false);
  assert.equal(fromJson(ScenarioSchema, restored.snapshot().scenario).characters[0]!.currentGoal, "Go to the Great Hall.");
  await assert.rejects(restored.planNpc("merlin", [], new AbortController().signal), /idle/);
});

test("treasury can be opened from the hall and closed from inside, with sides explicit to Jev", () => {
  const scenario = furnishedCourt(), actor = scenario.world!.actors.find(item => item.characterId === "merlin")!;
  actor.position = create(TilePositionSchema, { x: 22, y: 22 }); actor.roomId = "great_hall";
  scenario.characters.find(item => item.id === "merlin")!.currentGoal = "Go into the Treasury, close the door from inside, and wait there.";
  const runtime = new BrowserGameRuntime(scenario, "test"), snapshot = runtime.snapshot();
  snapshot.npcActivities = { merlin: { status: "active", goal: scenario.characters[0]!.currentGoal, history: [] } }; runtime.restore(snapshot);
  const observe = () => courtAgentObservation(fromJson(ScenarioSchema, runtime.snapshot().scenario), "merlin");
  let observation = observe();
  const open = observation.actions.find(action => action.id === "open_treasury_door_0")!;
  assert.ok(open); assert.equal(open.legality, "normal"); assert.equal(open.path.length, 1);
  assert.equal(open.interactionRoomId, "great_hall");
  assert.ok(!observation.actions.some(action => action.id === "move_treasury"));
  runtime.executeNpcAction("merlin", open.id, observation.revision, observation.goal);
  observation = observe();
  assert.ok(observation.actions.some(action => action.id === "move_treasury"));
  const outside = observation.actions.find(action => action.id === "close_treasury_door_0")!;
  const inside = observation.actions.find(action => action.id === "close_treasury_door_1")!;
  assert.equal(outside.interactionRoomId, "great_hall");
  assert.equal(inside.interactionRoomId, "treasury");
  assert.match(inside.description, /Treasury side/);
  assert.notEqual(inside.description, outside.description);
  runtime.executeNpcAction("merlin", inside.id, observation.revision, observation.goal);
  const saved = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.equal(saved.world!.doors.find(door => door.id === "treasury_door")!.open, false);
  assert.equal(saved.world!.actors.find(item => item.characterId === "merlin")!.roomId, "treasury");
  observation = observe();
  assert.ok(observation.actions.some(action => action.id === "open_treasury_door_1"));
  assert.ok(!observation.actions.some(action => action.id === "open_treasury_door_0"));
});

test("recent transcripts capture every main-game model stage and retain failed requests across rollback", async t => {
  const runtime = new BrowserGameRuntime(load(), "sk-test-secret");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ({ role: "assistant", content: "Welcome, traveller." }));
  await runtime.talkToGameMaster("Hello.");
  runtime.restore(new BrowserGameRuntime(furnishedCourt(), "test").snapshot());
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "I will go." }));
  await runtime.talkToCharacter("merlin", "Go to the Treasury.");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newEvents: [], relationships: [], lore: null, goalUpdate: { goal: "Go to the Treasury.", reason: "Agreed." } }));
  await runtime.endConversation("merlin");
  const before = runtime.snapshot();
  t.mock.method(JevClient.prototype, "choose", async () => { throw new Error("Rejected sk-test-secret"); });
  await assert.rejects(runtime.planNpc("merlin", [], new AbortController().signal), /Rejected/);
  runtime.restore(before);
  runtime.finishNpcRun("merlin", "error", "Request failed.");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newEvents: [], relationships: [], lore: null, goalUpdate: null }));
  await runtime.reviewNpcOutcome("merlin");
  const entries = runtime.recentTranscripts();
  assert.deepEqual(entries.map(entry => entry.kind), ["outcome_review", "jev", "conversation_review", "dialogue", "game_master"]);
  assert.equal(entries[1]!.status, "error");
  assert.match(entries[1]!.error!, /redacted/);
  assert.equal((entries[1]!.request as any).model, "typesafe/jev-1.13");
  assert.ok((entries[1]!.request as any).questions.next.criteria);
  assert.ok((entries[2]!.request as any).messages.length);
  assert.ok(entries.every(entry => typeof entry.durationMs === "number"));
  assert.doesNotMatch(JSON.stringify(entries), /sk-test-secret/);
  assert.deepEqual(new BrowserGameRuntime(load(), "test", runtime.snapshot()).recentTranscripts(), [], "A fresh loaded session starts a new log");
});

test("transcript recorder shows pending calls, bounds history, and isolates mutable and secret data", async () => {
  const log = new ModelTranscripts("private-key");
  let finish!: (value: unknown) => void;
  const input = { prompt: "private-key" };
  const pending = log.record("dialogue", "merlin", input, () => new Promise(resolve => { finish = resolve; }));
  input.prompt = "changed after dispatch";
  assert.equal(log.recent()[0]!.status, "pending");
  assert.deepEqual(log.recent()[0]!.request, { prompt: "[redacted]" });
  finish({ text: "sk-another-secret" }); await pending;
  const copy = log.recent(); copy[0]!.status = "error";
  assert.equal(log.recent()[0]!.status, "success");
  assert.deepEqual(log.recent()[0]!.response, { text: "[redacted]" });
  for (let i = 0; i < 55; i++) await log.record("jev", "merlin", { i }, async () => ({ choice: "complete" }));
  assert.equal(log.recent().length, 50);
  assert.equal(log.recent()[0]!.id, 56);
});

function talkingCourt() {
  const scenario = furnishedCourt();
  for (const actor of scenario.world!.actors) {
    const placement = scenario.courtArrivalPlacements.find(item => item.characterId === actor.characterId);
    if (placement) { actor.position = placement.position; actor.roomId = placement.roomId; }
    actor.awake = true;
  }
  const runtime = new BrowserGameRuntime(scenario, "test");
  const snapshot = runtime.snapshot();
  snapshot.npcActivities = { merlin: { status: "active", goal: scenario.characters.find(item => item.id === "merlin")!.currentGoal, history: [] } };
  runtime.restore(snapshot);
  const observation = courtAgentObservation(scenario, "merlin");
  const action = observation.actions.find(item => item.type === "talk")!;
  assert.ok(action);
  return { scenario, runtime, observation, action };
}

test("Jev receives reachable NPC talk actions, then both participants save private memories and goals", async t => {
  const { scenario, runtime, observation, action } = talkingCourt();
  assert.ok(!observation.actions.some(item => item.id === "talk_player" || item.id === "talk_merlin"));
  assert.throws(() => runtime.executeNpcAction("merlin", action.id, observation.revision, observation.goal), /resolution/);
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => {
    calls++;
    if (calls === 1) return modelReply({ request: "Meet me in the Treasury.", intent: "Arrange a private discussion." });
    return modelReply({ summary: "They agree to meet in the Treasury.",
      initiator: { newEvents: [], relationships: [], lore: null, goalUpdate: null },
      recipient: { newEvents: [], relationships: [], lore: null, goalUpdate: { goal: "Walk to the Treasury.", reason: "Agreed to meet." } } });
  });
  await runtime.executeNpcTalk("merlin", action.id, observation.revision, observation.goal, new AbortController().signal);
  const saved = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.equal(calls, 2);
  assert.equal(runtime.snapshot().npcActivities?.merlin?.status, "idle");
  assert.equal(runtime.snapshot().npcActivities?.[action.target]?.status, "active");
  assert.deepEqual(saved.world!.objects, scenario.world!.objects);
  const events = saved.events.filter(item => item.type === "npc_conversation");
  assert.equal(events.length, 2);
  assert.ok(events.every(item => item.characterIds.length === 1 && !item.characterIds.includes("player")));
  assert.deepEqual(runtime.recentTranscripts().map(item => item.kind), ["npc_resolution", "npc_request"]);
});

test("NPC conversation validation and cancellation cannot partially update either character", async t => {
  const { runtime, observation, action } = talkingCourt();
  const before = runtime.snapshot();
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ++calls % 2 === 1
    ? modelReply({ request: "Hello", intent: "Greet them" })
    : modelReply({ summary: "A greeting", initiator: { newEvents: [{ type: "test", summary: "Must not persist" }], relationships: [], lore: null, goalUpdate: null }, recipient: { newEvents: [], relationships: [{ characterId: "unknown", description: "Invalid" }], lore: null, goalUpdate: null } }));
  await assert.rejects(runtime.executeNpcTalk("merlin", action.id, observation.revision, observation.goal, new AbortController().signal), /relationship/);
  assert.deepEqual(runtime.snapshot(), before);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runtime.executeNpcTalk("merlin", action.id, observation.revision, observation.goal, controller.signal), /abort/i);
  assert.deepEqual(runtime.snapshot(), before);
});

test("talk availability follows closed doors and Jev gets the offered talk choice", async t => {
  const { scenario, runtime, observation, action } = talkingCourt();
  t.mock.method(JevClient.prototype, "choose", async (_state: unknown, instructions: unknown, criteria: Record<string, string>) => {
    assert.ok(action.id in criteria);
    assert.match(JSON.stringify(instructions), /offered talk actions/);
    return { choice: action.id, probabilities: { [action.id]: 1 } };
  });
  const plan = await runtime.planNpc("merlin", [], new AbortController().signal);
  assert.equal(plan.action?.type, "talk");
  const recipient = scenario.world!.actors.find(item => item.characterId === action.target)!;
  recipient.position = create(TilePositionSchema, { x: 5, y: 5 }); recipient.roomId = "merlin_chamber";
  for (const door of scenario.world!.doors) door.open = false;
  assert.ok(!courtAgentObservation(scenario, "merlin").actions.some(item => item.id === action.id));
  for (const door of scenario.world!.doors) door.open = true;
  assert.ok(courtAgentObservation(scenario, "merlin").actions.some(item => item.id === action.id));
  assert.ok(observation.actions.some(item => item.id === action.id));
});

test("resetCharacters restores authored NPCs and events, clears dialogue and tasks, and preserves player and physical world", async t => {
  const initial = load(), scenario = furnishedCourt();
  const merlin = scenario.characters.find(item => item.id === "merlin")!;
  merlin.lore = "Changed biography"; merlin.currentGoal = "Search the Treasury";
  const runtime = new BrowserGameRuntime(initial, "test", new BrowserGameRuntime(scenario, "test").snapshot());
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Goodbye", endConversation: true, replyOptions: [] }));
  await runtime.talkToCharacter("merlin", "Hello");
  const snapshot = runtime.snapshot();
  snapshot.npcActivities = { merlin: { status: "active", goal: "Search the Treasury", history: ["An old action"] } };
  const changed = fromJson(ScenarioSchema, snapshot.scenario);
  changed.events.push(create(EventSchema, { id: "learned", type: "belief", summary: "A learned fact", characterIds: ["merlin"] }));
  snapshot.scenario = toJson(ScenarioSchema, changed);
  runtime.restore(snapshot);
  const before = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  runtime.resetCharacters();
  const after = runtime.snapshot(), saved = fromJson(ScenarioSchema, after.scenario);
  assert.deepEqual(saved.characters.find(item => item.id === "merlin"), initial.characters.find(item => item.id === "merlin"));
  assert.deepEqual(saved.characters.find(item => item.id === "player"), before.characters.find(item => item.id === "player"));
  assert.deepEqual(saved.events, initial.events);
  assert.deepEqual(saved.world, { ...before.world!, revision: before.world!.revision + 1 });
  assert.deepEqual(after.npcActivities, {});
  assert.deepEqual(after.conversations, {});
  assert.deepEqual(after.conversationEndRequested, {});
  assert.deepEqual(new BrowserGameRuntime(initial, "test", after).snapshot(), after);
  assert.throws(() => new BrowserGameRuntime(initial, "test").resetCharacters(), /Create your character/);
});

test("authored world rooms and connections match the palace map", () => {
  const scenario = load(), rooms = scenario.world!.rooms;
  const ids = new Set(rooms.map(room => room.id));
  assert.deepEqual([...ids].sort(), palaceMap.rooms.map(room => room.id).sort());
  for (const room of rooms) for (const exit of room.exitRoomIds) assert.ok(ids.has(exit), `${room.id} exits to missing room ${exit}`);
  for (const fixture of scenario.world!.fixtures) assert.ok(ids.has(fixture.roomId), `${fixture.id} belongs to missing room ${fixture.roomId}`);
  assert.doesNotMatch(JSON.stringify(scenario), /chapel/i);
});
