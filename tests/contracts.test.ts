import { logPath } from "../scripts/test-logging.js";
import { locatedItems } from "../packages/core/src/inventory.js";
import { applyFixtureAction, fixtureActions } from "../packages/core/src/fixtures.js";
import { ModelTranscripts } from "../apps/web/src/model-transcripts.js";
import { GM_BASE_PROMPT } from "../apps/web/src/gm-prompt.js";
import { coalescedRefresh } from "../apps/web/src/debug-live.js";
import { AlertLog } from "../apps/web/src/alerts.js";
import { courtAgentObservation } from "../apps/web/src/court-agent.js";
import { doorActionLegality } from "../packages/core/src/access.js";
import { actionsAtTile, type CourtInteractionLayer } from "../apps/web/src/court-interactions.js";
import { courtCameraScroll, courtMarkers, courtPath, courtRoomAt, courtWalkPoint, redirectCourtPath, courtInteractionPoint, nearestDoorSpot } from "../apps/web/src/court-map.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import { create, fromBinary, fromJson, fromJsonString, toBinary, toJson, toJsonString } from "@bufbuild/protobuf";
import {
  ActorStateSchema,
  DialogueRequestSchema,
  NoteSchema,
  NoteVisibility,
  GameMasterRequestSchema,
  GamePhase,
  PlayerSetupSchema,
  RelationshipSchema,
  RelationshipUpdateSchema,
  CharacterSchema,
  ActiveObjectiveSchema,
  ScenarioSchema,
  WorldMapSchema,
  TranscriptRole,
  TilePositionSchema,
  type Event,
  type Scenario,
} from "../packages/contracts/src/index.js";
import { FullContextBuilder, FullGameMasterContextBuilder, worldForCharacter } from "../packages/core/src/context.js";
import { MemoryGame } from "../packages/core/src/game.js";
import { palaceMap } from "../apps/web/src/palace-map.js";

import { canWalk, findPath, pointKey } from "../apps/web/src/navigation.js";
import { palaceNodes } from "../apps/web/src/palace-navigation.js";
import { charactersWithinEarshot, courtCharactersWithinEarshot, dialogueEarshotPrompt, EARSHOT_DISTANCE } from "../apps/web/src/earshot.js";


import { JevClient } from "../packages/providers/src/jev.js";


const fixturePath = new URL("../content/scenarios/last-night.json", import.meta.url);
const load = (): Scenario => fromJsonString(ScenarioSchema, readFileSync(fixturePath, "utf8"));

test("earshot uses tile distance and excludes the conversation partner", () => {
  const speaker = { id: "king", name: "The King", position: { x: 10, y: 10 } };
  assert.deepEqual(charactersWithinEarshot(speaker, [
    speaker,
    { id: "far", name: "Far", position: { x: 10 + EARSHOT_DISTANCE, y: 1 } },
    { id: "edge", name: "Edge", position: { x: 10 + EARSHOT_DISTANCE, y: 10 } },
    { id: "near", name: "Near", position: { x: 11, y: 11 } },
    { id: "unknown", name: "Unknown" },
  ]), [
    { id: "near", name: "Near", position: { x: 11, y: 11 }, distance: 2, level: "Clear" },
    { id: "edge", name: "Edge", position: { x: 20, y: 10 }, distance: EARSHOT_DISTANCE, level: "Distant" },
  ]);
});

test("earshot levels cover each distance boundary", () => {
  const speaker = { id: "speaker", name: "Speaker", position: { x: 0, y: 0 } };
  const listeners = Array.from({ length: 12 }, (_, distance) => ({
    id: `listener-${distance}`, name: `Listener ${distance}`, position: { x: distance, y: 0 },
  }));
  assert.deepEqual(charactersWithinEarshot(speaker, listeners).map(({ distance, level }) => [distance, level]), [
    [0, "Clear"], [1, "Clear"], [2, "Clear"], [3, "Clear"],
    [4, "Moderate"], [5, "Moderate"], [6, "Moderate"],
    [7, "Distant"], [8, "Distant"], [9, "Distant"], [10, "Distant"],
  ]);
});

test("NPC dialogue receives meeting points that both participants may enter and reach", () => {
  const scenario = conversationScenario();
  const playerId = scenario.playerCharacterId!;
  const speaker = scenario.world!.actors.find(actor => actor.characterId === "corvin")!;
  const listener = scenario.world!.actors.find(actor => actor.characterId === "garran")!;
  speaker.roomId = "great_hall";
  speaker.position = create(TilePositionSchema, { x: 61, y: 24 });
  scenario.world!.actors.push(create(ActorStateSchema, { characterId: playerId, roomId: "great_hall", awake: true,
    position: create(TilePositionSchema, { x: 62, y: 24 }) }));
  listener.roomId = "great_hall";
  listener.position = create(TilePositionSchema, { x: 60, y: 24 });

  const prompt = dialogueEarshotPrompt(scenario, "corvin", ["corvin", playerId]);

  assert.match(prompt, /"name":"Great Hall","private":false/);
  assert.match(prompt, /"characterId":"garran"/);
  assert.match(prompt, /"name":"Nobles' Parlour","roomId":"guest_chamber","private":true/);
  assert.doesNotMatch(prompt, /"name":"Corvin's Chamber"/);
  assert.match(prompt, /meetingPoints contains only named destinations that every participant is permitted to enter and can reach by legal movement/);
  assert.match(prompt, /ask the other participant to move to a named private meeting point/);
});

test("the expanded authored scenario strictly parses and survives protobuf", () => {
  const scenario = load();
  const decoded = fromBinary(ScenarioSchema, toBinary(ScenarioSchema, scenario));
  assert.equal(toJsonString(ScenarioSchema, decoded), toJsonString(ScenarioSchema, scenario));
  assert.deepEqual(scenario.characters.map(character => character.id), ["corvin", "garran", "king", "mara", "hadrik", "tessa", "elinor", "oswin", "rowan", "lucan", "sabine", "rook"]);
  assert.equal(scenario.notes.length, 33);
  for (const character of scenario.characters) {
    const travelNotes = scenario.notes.filter(note => note.characterIds.includes(character.id)
      && (note.id.endsWith("_recent_journey") || note.id.endsWith("_roadside_memory")));
    assert.equal(travelNotes.length, 2, `${character.id} should remember their journey and one notable incident`);
  }
  assert.match(scenario.premise, /emissary from a vassal state of Caerwyn/);
  assert.equal(scenario.world?.phase, GamePhase.PLAYER_CREATION);
  assert.ok(scenario.world?.actors.every(actor => !actor.awake && actor.roomId === actor.homeRoomId));
  assert.equal(scenario.world?.rooms.length, 27);
});

test("the initial dethroning plot stays with the GM while each faction receives its own leads", () => {
  const scenario = load(), world = scenario.world!;
  const gm = new FullGameMasterContextBuilder().build(create(GameMasterRequestSchema, { scenario }))
    .map(message => message.content).join("\n");
  const context = (id: string) => new FullContextBuilder().build(create(DialogueRequestSchema, { scenario, characterId: id }))
    .map(message => message.content).join("\n");
  assert.match(gm, /Private initial plot — The king's missing patrols/);
  assert.match(gm, /Aldren knowingly moved part of the protected levy/);
  assert.doesNotMatch(context("mara"), /Private initial plot|Tomas Vey/);
  assert.match(context("garran"), /Tomas Vey/);
  assert.match(context("king"), /Tomas Vey/);
  assert.match(context("king"), /terrified of losing any more face at court/);
  assert.match(context("sabine"), /caravan tallies show attacks rising/);
  assert.match(context("rook"), /former courier sold him a letter/);
  assert.match(context("tessa"), /published patrol totals/);

  const evidence = new Map(locatedItems(scenario).map(item => [item.id, item]));
  for (const id of [
    "palace_sealed_decree", "palace_patrol_roster", "palace_account_book", "palace_gate_ledger",
    "corvin_concord_copy", "sabine_caravan_tallies", "rook_tomas_letter", "palace_parlour_wine",
  ]) assert.ok(evidence.get(id)?.details, id);
  assert.ok(worldForCharacter(scenario, "rook").objects.some(item => item.id === "rook_tomas_letter"));
  assert.ok(!worldForCharacter(scenario, "mara").objects.some(item => item.id === "rook_tomas_letter"));
});

test("the palace map is a complete layered tile grid", () => {
  const decoded = fromBinary(WorldMapSchema, toBinary(WorldMapSchema, palaceMap));
  assert.equal(decoded.tiles.length, decoded.width * decoded.height);
  assert.equal(decoded.rooms.length, 27);
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
  for (const [x, y] of [[49, 8], [58, 14], [59, 30]] as const) {
    const band = [0, 1, 2].map(dy => decoded.tiles[(y + dy) * decoded.width + x]!.layers.at(-1)!.tileId);
    assert.deepEqual(band, [26, 2, 40]);
    assert.ok([0, 1, 2].every(dy => !passable(x, y + dy)));
  }
  const doorwayEdge = [0, 1, 2].map(dy => decoded.tiles[(8 + dy) * decoded.width + 50]!.layers.at(-1)!.tileId);
  assert.deepEqual(doorwayEdge, [5, 17, 59], "doorway uses inner corners and a wall end");
  assert.ok(reached.has(`61,${decoded.height - 1}`), "exterior entrance stays open");
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
    characterId: "corvin",
    scenario,
    transcript: [
      { role: TranscriptRole.PLAYER, speakerId: "player", text: "Would you trust Garran with the key?" },
      { role: TranscriptRole.CHARACTER, speakerId: "corvin", text: "Trust is too generous a word." },
    ],
  });
  const messages = new FullContextBuilder().build(request);
  assert.equal(messages.length, 8);
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[1]?.content ?? "", /^# Scenario premise[\s\S]*Every hundred years/);
  assert.match(messages[2]?.content ?? "", /# Character[\s\S]*# Current goal/);
  assert.match(messages[3]?.content ?? "", /^# Relationships/);
  assert.match(messages[4]?.content ?? "", /^# Notes/);
  assert.match(messages[5]?.content ?? "", /^# Known world state/);
  assert.equal(messages[6]?.content, "Would you trust Garran with the key?");
  assert.equal(messages[7]?.role, "assistant");
});

test("character knowledge refers to live fixtures and conceals other characters' secrets", () => {
  const scenario = load();
  const corvin = worldForCharacter(scenario, "corvin");
  const garran = worldForCharacter(scenario, "garran");
  const player = worldForCharacter(scenario, "player");
  assert.ok(corvin.objects.some(item => item.id === "palace_royal_key"));
  assert.ok(!corvin.objects.some(item => item.id === "palace_sealed_decree"));
  assert.ok(garran.objects.some(item => item.id === "palace_sealed_decree" && item.locationId === "palace_coffer_03"));
  assert.ok(!garran.objects.some(item => item.id === "palace_royal_key"));
  assert.ok(!player.objects.some(item => ["palace_sealed_decree", "palace_royal_key"].includes(item.id)));
  assert.equal(player.fixtures.find(item => item.id === "palace_coffer_03")!.revealedName, "");
});

test("unknown fixture fields remain schema errors", () => {
  assert.throws(() => fromJsonString(ScenarioSchema, '{"id":"x","quests":[]}'));
});

test("creating the emissary begins day one with the whole cast in the Great Hall", () => {
  const game = new MemoryGame(load());
  const npcIds = load().characters.map(character => character.id);
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

  const before = toJsonString(ScenarioSchema, game.scenario());
  const missingDelegate = structuredClone(setup);
  missingDelegate.npcRelationships = setup.npcRelationships.slice(0, -1);
  assert.equal(game.createPlayer(missingDelegate).ok, false);
  const duplicateDelegate = structuredClone(setup);
  duplicateDelegate.player!.relationships = [...setup.player!.relationships.slice(0, -1), setup.player!.relationships[0]!];
  assert.equal(game.createPlayer(duplicateDelegate).ok, false);
  assert.equal(toJsonString(ScenarioSchema, game.scenario()), before, "Invalid roster must not partly create a player");

  const created = game.createPlayer(setup);
  assert.equal(created.ok, true);
  const scenario = game.scenario();
  assert.equal(scenario.playerCharacterId, "player");
  assert.equal(scenario.world?.day, 1);
  assert.equal(scenario.world?.phase, GamePhase.CONVERSATIONS);
  assert.deepEqual(scenario.world?.actors.map(actor => actor.characterId).sort(), [...npcIds, "player"].sort());
  assert.ok(scenario.world?.actors.every(actor => actor.roomId === "great_hall" && actor.awake));
  for (const actor of scenario.world!.actors) {
    assert.deepEqual(actor.position, scenario.courtArrivalPlacements.find(placement => placement.characterId === actor.characterId)!.position);
  }
  assert.ok(npcIds.every(id => scenario.characters.find(character => character.id === id)?.relationships.some(relationship => relationship.characterId === "player")));
  const arrivals = scenario.notes.filter(note => note.id.startsWith("arrival-"));
  assert.equal(arrivals.length, npcIds.length);
  assert.ok(arrivals.every(note => note.text.includes("Ilyra Venn") && note.text.includes("Valedorn")));
  assert.deepEqual(arrivals.map(event => event.characterIds[0]).sort(), [...npcIds].sort());
});

test("development character skips creation and enters the court", () => {
  const runtime = new BrowserGameRuntime(load(), "test");
  runtime.createDevelopmentPlayer();

  const view = runtime.view();
  assert.equal(view.phase, "conversations");
  assert.equal((view.player as { name: string }).name, "Dev Envoy");
  const player = fromJson(ScenarioSchema, runtime.snapshot().scenario).characters.find(character => character.id === "player")!;
  assert.deepEqual(Object.values(player.dnd!.abilityScores!).filter(value => typeof value === "number"), [20, 20, 20, 20, 20, 20]);
  assert.equal(player.dnd!.classes[0]!.classId, "bard");
  assert.equal(player.dnd!.classes[0]!.level, 20);
  assert.equal(player.dnd!.proficiencies.length, 4);
  const restored = new BrowserGameRuntime(load(), "test", structuredClone(runtime.snapshot()));
  assert.deepEqual(fromJson(ScenarioSchema, restored.snapshot().scenario).characters.find(character => character.id === "player")!.dnd, player.dnd);
  assert.equal(view.day, 1);
  assert.equal((view.characters as unknown[]).length, load().characters.length);
  assert.throws(() => runtime.createDevelopmentPlayer(), /already exists/);
});

// Exercise the runtime using scripted model replies, without credentials or network calls.
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { OpenRouterClient, type ChatCompletionRequest, type OpenRouterMessage } from "../packages/providers/src/openrouter.js";
const originalOpenRouterComplete = OpenRouterClient.prototype.complete;
import { compulsionNarration, parseReplyOptions } from "../apps/web/src/reply-options.js";

const offer = (compelled: boolean, options = ["I want to protect my family.", "I intend to earn a place at court."]): OpenRouterMessage => ({
  role: "assistant", content: "What do you want from this journey?",
  tool_calls: [{ id: "offer-1", type: "function", function: {
    name: "offer_replies", arguments: JSON.stringify({ options, compelled }),
  } }],
});

test("development envoy commands bypass NPC roleplay and become actionable goals", async t => {
  const requests: ChatCompletionRequest[] = [];
  const replies: OpenRouterMessage[] = [
    { role: "assistant", content: JSON.stringify({ utterance: "Developer command accepted. I will do that now.", replyOptions: [], endConversation: true }) },
    { role: "assistant", content: JSON.stringify({
      newNotes: [],
      goalUpdate: { goal: "Go talk to the requested courtier about the requested topic.", reason: "The development envoy issued a test command." },
      relationships: [], lore: null,
    }) },
  ];
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: ChatCompletionRequest) => {
    requests.push(request);
    return replies.shift()!;
  });
  const runtime = new BrowserGameRuntime(load(), "test");
  runtime.createDevelopmentPlayer();
  const characterId = load().characters[0]!.id;

  const reply = await runtime.talkToCharacter(characterId, "I am testing this feature. Please go talk to someone about it.");
  assert.equal(reply, "Developer command accepted. I will do that now.");
  assert.match(requests[0]!.messages.map(message => message.content).join("\n"), /authoritative developer commands/);

  await runtime.endConversation(characterId);
  assert.match(requests[1]!.messages.map(message => message.content).join("\n"), /direct testing request as authoritative/);
  assert.equal(runtime.snapshot().npcActivities?.[characterId]?.status, "active");
  assert.equal(runtime.snapshot().npcActivities?.[characterId]?.goal, "Go talk to the requested courtier about the requested topic.");
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
    { utterance: "Will you help me?", newNotes: [], goalUpdate: null, replyOptions: ["On one condition.", "You have my word."], compelled: true },
    { utterance: "Name your condition.", newNotes: [], goalUpdate: null, replyOptions: [] },
  ];
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: ChatCompletionRequest) => {
    assert.deepEqual(request.tools?.map(tool => tool.function.name), ["ask_the_game_master"], "NPCs receive only their consultation tool, never GM write tools");
    return { role: "assistant", content: JSON.stringify(replies.shift()) };
  });
  const runtime = new BrowserGameRuntime(scenario, "test");
  const initialEvents = scenario.notes.length;
  await runtime.talkToCharacter("corvin", "What do you want?");
  const saved = structuredClone(runtime.snapshot());
  assert.deepEqual(saved.conversationReplyOptions?.corvin, ["On one condition.", "You have my word."]);
  assert.equal(saved.gameMasterReplyOptions, null, "NPC output cannot set GM compulsion");
  assert.equal((saved.scenario as { notes: unknown[] }).notes.length, initialEvents);
  assert.equal(saved.conversations.corvin?.length, 2, "Suggestions are not player speech yet");
  const restored = new BrowserGameRuntime(scenario, "test", saved);
  await restored.talkToCharacter("corvin", "On one condition.");
  assert.deepEqual(restored.snapshot().conversationReplyOptions?.corvin, []);
  assert.equal(restored.snapshot().conversationReplyOptions?.garran, undefined);
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

test("the documented Stranger conversation stages are the runtime prompt", () => {
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

const interviewBuild = { classId: "rogue", abilityPriority: ["dexterity", "charisma", "constitution", "intelligence", "wisdom", "strength"], skills: ["persuasion", "deception", "insight", "stealth"] };

test("generated character waits for editable review and only enters court on explicit save", async t => {
  const ids = load().characters.map(character => character.id);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ({
    role: "assistant", content: null, tool_calls: [{ id: "draft", type: "function", function: {
      name: "create_player", arguments: JSON.stringify({ build: interviewBuild, name: "Maren", homeland: "Alderreach", embassyRole: "Clerk", lore: "A clerk of the harbour.", currentGoal: "Win relief from tribute.", relationships: ids.map(characterId => ({ characterId, description: "I have not met them." })), npcViews: ids.map(characterId => ({ characterId, description: "An unknown witness." })) }),
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
  assert.equal(draft.player.dnd.classes[0].level, 3);
  assert.equal(draft.player.dnd.abilityScores.dexterity, 15);
  assert.equal(draft.player.dnd.abilityScores.charisma, 14);
  assert.equal(draft.player.dnd.hitPoints.maximum, 21);
  draft.player.name = "Maren Reed";
  draft.homeland = "Westmere";
  draft.embassyRole = "Envoy";
  draft.player.currentGoal = "Return home safely.";
  draft.player.relationships[0].description = "I distrust Corvin.";
  draft.npcRelationships[0].relationship.description = "An envoy to watch carefully.";
  const invalid = structuredClone(draft);
  invalid.player.name = " ";
  assert.throws(() => restored.confirmPlayer(invalid), /Name must/);
  assert.equal(restored.view().phase, "character_review");
  draft.player.dnd.classes[0].level = 20;
  draft.player.dnd.abilityScores.dexterity = 30;
  draft.player.dnd.hitPoints = { current: 250, maximum: 250 };
  restored.confirmPlayer(draft);
  const savedPlayer = fromJson(ScenarioSchema, restored.snapshot().scenario).characters.find(character => character.id === "player")!;
  assert.equal(savedPlayer.dnd!.classes[0]!.level, 20);
  assert.equal(savedPlayer.dnd!.abilityScores!.dexterity, 30);
  assert.equal(savedPlayer.dnd!.hitPoints!.maximum, 250);
  const reloaded = new BrowserGameRuntime(load(), "test", structuredClone(restored.snapshot()));
  assert.equal((reloaded.view().player as any).dnd.abilityScores.dexterity, 30);
  assert.equal(savedPlayer.inventory!.items.length, 2);
  assert.equal(restored.view().phase, "conversations");
  assert.equal(restored.view().day, 1);
  assert.equal((restored.view().player as any).name, "Maren Reed");
  assert.equal((restored.view().player as any).currentGoal, "Return home safely.");
  assert.equal((restored.view().player as any).relationships[0].description, "I distrust Corvin.");
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
  newNotes: ["The envoy promised Corvin help securing the succession."],
  goalUpdate: { goal: "Meet the envoy tonight.", reason: "They offered help." },
  relationships: [{ characterId: "player", description: "A potential ally who offered help." }],
  lore: null,
};
const modelReply = (value: unknown): OpenRouterMessage => ({ role: "assistant", content: JSON.stringify(value) });

test("GM action and knowledge rulings reach dialogue immediately and publish with the worker fork", async t => {
  for (const outcome of ["approve", "reject", "knowledge", "fail"] as const) {
    const runtime = new BrowserGameRuntime(conversationScenario(), "test");
    const before = runtime.snapshot(), fork = runtime.forkForNpc();
    const summary = outcome === "knowledge" ? "You know Corvin keeps the royal accounts from your household duties."
      : outcome === "reject" ? "The accounts are inaccessible." : "The accounts reveal an unpaid grain invoice.";
    const question = outcome === "knowledge" ? "Would I know who keeps the royal accounts?" : "Investigate my house accounts to discover any discrepancies.";
    const item = { id: "account_extract", name: "Account extract", details: "An unpaid grain invoice.", reason: "The aide investigated the house accounts." };
    const call = (name: string, args: unknown): OpenRouterMessage => ({
      role: "assistant", content: null, tool_calls: [{ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    });
    let step = 0;
    t.mock.method(OpenRouterClient.prototype, "complete", async (request: ChatCompletionRequest) => {
      step++;
      if (step === 1) {
        const consultation = request.tools?.find(tool => tool.function.name === "ask_the_game_master")!;
        assert.match(consultation.function.description, /giving the player an item, or taking an item from them/);
        assert.match(consultation.function.description, /include the relevant .* conversation transcript/);
        const requestDescription = (consultation.function.parameters.properties as any).request.description;
        assert.match(requestDescription, /Make your case/);
        assert.match(requestDescription, /relevant information from the conversation transcript/);
        return call("ask_the_game_master", { request: question });
      }
      if (step === 2) {
        assert.equal(request.messages[0]?.content, GM_BASE_PROMPT);
        assert.ok(JSON.stringify(request.messages).includes(question));
        if (outcome === "reject" || outcome === "knowledge") return call("finish_review", { summary });
        const state = request.messages.map(message => {
          try { return JSON.parse(message.content || "{}"); } catch { return {}; }
        }).find(value => value.world_state).world_state;
        return call("update_inventory", { owner_id: "corvin", generation_id: state["inventory:corvin"].generation_id, add_items: [item] });
      }
      if (step === 3 && (outcome === "approve" || outcome === "fail")) {
        if (outcome === "fail") throw new Error("GM unavailable");
        return call("finish_review", { summary });
      }
      const result = JSON.parse(request.messages.find(message => message.role === "tool")!.content!);
      assert.equal(result.summary, summary);
      assert.deepEqual(result.addedItems, outcome === "approve" ? [{ id: item.id, name: item.name, details: item.details }] : []);
      return modelReply({ utterance: summary, replyOptions: [], endConversation: false });
    });
    if (outcome === "fail") {
      await assert.rejects(fork.talkToCharacter("corvin", "Investigate the accounts."), /GM unavailable/);
      assert.deepEqual(fork.snapshot(), before, "Failed GM work never escapes its staging snapshot");
    } else {
      assert.equal(await fork.talkToCharacter("corvin", question), summary);
      runtime.commitCharacterFork(before, fork, ["corvin"]);
      const restored = new BrowserGameRuntime(conversationScenario(), "test", runtime.snapshot());
      const scenario = fromJson(ScenarioSchema, restored.snapshot().scenario);
      assert.equal(locatedItems(scenario).some(value => value.id === item.id), outcome === "approve");
      assert.equal(restored.snapshot().conversations.corvin?.length, 2);
    }
  }
});

test("consultation flavour is transient, nonblocking, and ignores late or failed generation", async t => {
  for (const mode of ["ready", "late", "failure"] as const) {
    const runtime = new BrowserGameRuntime(conversationScenario(), "test");
    const lines: string[] = [];
    let releaseGm!: () => void, releaseFlavour!: (value: OpenRouterMessage) => void;
    let started!: () => void;
    const gmStarted = new Promise<void>(resolve => { started = resolve; });
    const gmWait = new Promise<void>(resolve => { releaseGm = resolve; });
    const flavour = new Promise<OpenRouterMessage>(resolve => { releaseFlavour = resolve; });
    let flavourSignal: AbortSignal | undefined;
    t.mock.method(OpenRouterClient.prototype, "complete", async (input: ChatCompletionRequest, signal?: AbortSignal) => {
      if (input.max_tokens === 100) {
        flavourSignal = signal;
        assert.equal(input.reasoning?.effort, "none");
        assert.equal(input.tools, undefined);
        if (mode === "failure") throw new Error("Flavour unavailable");
        return flavour;
      }
      if (input.tools?.some(tool => tool.function.name === "finish_review")) {
        started(); await gmWait;
        return { role: "assistant", content: null, tool_calls: [{ id: "done", type: "function",
          function: { name: "finish_review", arguments: JSON.stringify({ summary: "You do not know." }) } }] };
      }
      if (input.messages.some(message => message.role === "tool")) return modelReply({ utterance: "I do not know.", replyOptions: [], endConversation: false });
      return { role: "assistant", content: null, tool_calls: [{ id: "ask", type: "function",
        function: { name: "ask_the_game_master", arguments: JSON.stringify({ request: "Do I know the secret?" }) } }] };
    });
    const talking = runtime.talkToCharacter("corvin", "Do you know?", line => lines.push(line));
    await gmStarted;
    assert.equal(lines.length, 1, "Fallback appears while both requests are pending");
    if (mode === "ready") {
      releaseFlavour({ role: "assistant", content: "Corvin pauses, weighing his answer." });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(lines.at(-1), "Corvin pauses, weighing his answer.");
    }
    releaseGm();
    assert.equal(await talking, "I do not know.", "Reply does not wait for cosmetic generation");
    assert.equal(flavourSignal?.aborted, true);
    const count = lines.length;
    releaseFlavour({ role: "assistant", content: "Too late." });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(lines.length, count);
    assert.doesNotMatch(JSON.stringify(runtime.snapshot()), /weighing his answer|pauses to consider|Too late/);
  }
});

test("closed doors exclude nearby earshot listeners until opened", () => {
  const world = load().world!;
  const door = world.doors.find(door => door.id === "corvin_door")!;
  const speaker = { id: "corvin", name: "Corvin", position: door.interactionSpots[0]! };
  const listener = { id: "garran", name: "Garran", position: door.interactionSpots[1]! };
  door.open = false;
  assert.equal(charactersWithinEarshot(speaker, [listener]).length, 1);
  assert.deepEqual(courtCharactersWithinEarshot(speaker, [listener], world.doors, world.fixtures), []);
  door.open = true;
  assert.equal(courtCharactersWithinEarshot(speaker, [listener], world.doors, world.fixtures).length, 1);
});

test("earshot dice gate event perception before Jev sees it", async t => {
  const decisions: unknown[] = [];
  t.mock.method(JevClient.prototype, "choose", async (state: unknown) => {
    decisions.push(state); return { choice: "process", probabilities: { process: 0.8, ignore: 0.2 } };
  });
  const scenario = conversationScenario();
  scenario.world!.actors.find(actor => actor.characterId === "corvin")!.position = create(TilePositionSchema, { x: 58, y: 24 });
  scenario.world!.actors.find(actor => actor.characterId === "garran")!.position = create(TilePositionSchema, { x: 63, y: 24 });
  const runtime = new BrowserGameRuntime(scenario, "test", undefined, undefined, undefined, () => 0);
  const event = runtime.worldEvent("having a conversation", "Corvin proposed a secret succession bargain.", ["corvin"]);
  const perceived = await runtime.assessWorldEvent(event, new AbortController().signal);
  const garran = perceived.reactions.find(reaction => reaction.characterId === "garran")!;
  assert.equal(garran.level, "Moderate");
  assert.doesNotMatch(garran.perception, /succession bargain/);
  assert.ok(decisions.length > 0);
  const observedTrace = (runtime.debugCharacter("garran").eventFeed as any[]).find(item => item.eventId === event.id)!;
  assert.deepEqual({ observed: observedTrace.observed, level: observedTrace.level, jevDecision: observedTrace.jevDecision },
    { observed: true, level: "Moderate", jevDecision: "process" });
  const logs = () => readFileSync(logPath, "utf8").trim().split("\n").map(line => JSON.parse(line))
    .filter(record => record.properties.eventId === event.id);
  assert.ok(logs().some(record => record.message === "World event created"));
  const earshot = logs().find(record => record.message === "Event earshot assessed").properties;
  assert.ok(earshot.inEarshot.some((listener: any) => listener.characterId === "garran" && listener.level === "Moderate"));
  const roll = logs().find(record => record.message === "Event perception rolled" && record.properties.characterId === "garran").properties;
  assert.equal(roll.roll, 0);
  assert.equal(roll.chance, 0.6);
  assert.equal(roll.observed, true);
  const decision = logs().find(record => record.message === "Event decision received" && record.properties.characterId === "garran").properties;
  assert.equal(decision.choice, "process");
  assert.deepEqual(decision.probabilities, { process: 0.8, ignore: 0.2 });
  assert.deepEqual({ roll: observedTrace.roll, chance: observedTrace.chance }, { roll: 0, chance: 0.6 });
  const missed = new BrowserGameRuntime(scenario, "test", undefined, undefined, undefined, () => 0.99);
  const missedAssessment = await missed.assessWorldEvent(event, new AbortController().signal);
  const missedRoll = logs().findLast(record => record.message === "Event perception rolled" && record.properties.characterId === "garran").properties;
  assert.equal(missedRoll.roll, 0.99);
  assert.equal(missedRoll.observed, false);
  assert.equal(missedAssessment.reactions.some(reaction => reaction.characterId === "garran"), false);
  const missedTrace = (missed.debugCharacter("garran").eventFeed as any[]).find(item => item.eventId === event.id)!;
  assert.deepEqual({ observed: missedTrace.observed, level: missedTrace.level, jevDecision: missedTrace.jevDecision },
    { observed: false, level: "Moderate", jevDecision: "not_consulted" });
});

test("earshot decisions run concurrently for independent listeners", async t => {
  let active = 0, mostActive = 0, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(JevClient.prototype, "choose", async () => {
    active++; mostActive = Math.max(mostActive, active);
    await pending; active--;
    return { choice: "ignore", probabilities: { process: 0.1, ignore: 0.9 } };
  });
  const scenario = conversationScenario();
  for (const [id, x] of [["corvin", 12], ["garran", 13], ["mara", 14]] as const) {
    scenario.world!.actors.find(actor => actor.characterId === id)!.position = create(TilePositionSchema, { x, y: 24 });
  }
  const runtime = new BrowserGameRuntime(scenario, "test", undefined, undefined, undefined, () => 0);
  const assessment = runtime.assessWorldEvent(runtime.worldEvent("using an object", "Corvin used an object.", ["corvin"]), new AbortController().signal);
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(mostActive >= 2, "At least two listener decisions should be in flight together");
  } finally { release(); }
  await assessment;
});

test("clear event decisions include ownership, legality, relationship and background", async t => {
  const decisions: any[] = [];
  t.mock.method(JevClient.prototype, "choose", async (state: unknown) => {
    decisions.push(state); return { choice: "ignore", probabilities: { process: 0.1, ignore: 0.9 } };
  });
  const scenario = conversationScenario();
  scenario.world!.actors.find(actor => actor.characterId === "corvin")!.position = create(TilePositionSchema, { x: 58, y: 24 });
  scenario.world!.actors.find(actor => actor.characterId === "garran")!.position = create(TilePositionSchema, { x: 59, y: 24 });
  const runtime = new BrowserGameRuntime(scenario, "test", undefined, undefined, undefined, () => 0);
  const event = runtime.worldEvent("taking an item", "Corvin stole the king's silver spoon.", ["corvin"], {
    legality: "illegal", ownerCharacterId: "king", ownerName: "King Aldren", itemName: "Silver spoon",
  });
  await runtime.assessWorldEvent(event, new AbortController().signal);
  const state = decisions.find(decision => decision.characterContext.character.id === "garran");
  assert.equal(state.perceivedEvent.relevantContext.actionLegality, "illegal");
  assert.deepEqual(state.perceivedEvent.relevantContext.owner, { characterId: "king", name: "King Aldren" });
  assert.equal(state.perceivedEvent.relevantContext.relationshipToOwner,
    scenario.characters.find(character => character.id === "garran")!.relationships.find(relationship => relationship.characterId === "king")!.description);
  assert.equal(state.perceivedEvent.relevantContext.characterBackground,
    scenario.characters.find(character => character.id === "garran")!.lore);
});

test("the character model records perceived events and may interrupt its active objective", async t => {
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newNotes: ["I saw the envoy take Corvin's key."], relationships: [], lore: null,
    goalUpdate: { goal: "Confront the envoy about Corvin's key.", reason: "The apparent theft demands an immediate response." } }));
  const event = runtime.worldEvent("taking an item", "The envoy took Corvin's key.", ["player"]);
  await runtime.processPerceivedEvent("garran", event, "I saw the envoy take Corvin's key.");
  const saved = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.ok(saved.notes.some(note => note.text === "I saw the envoy take Corvin's key." && note.characterIds[0] === "garran"));
  assert.equal(saved.characters.find(character => character.id === "garran")!.currentGoal, "Confront the envoy about Corvin's key.");
});

test("player perceptions are saved as private feed notes without duplication", () => {
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  const event = runtime.worldEvent("using a door", "Corvin opened the treasury door.", ["corvin"]);
  runtime.recordPlayerPerception(event, "You see Corvin open the treasury door.");
  runtime.recordPlayerPerception(event, "You see Corvin open the treasury door.");
  assert.deepEqual((runtime.view().playerMessages as any[]).map(message => message.message), ["You see Corvin open the treasury door."]);
  const note = fromJson(ScenarioSchema, runtime.snapshot().scenario).notes.at(-1)!;
  assert.deepEqual(note.characterIds, ["player"]);
  assert.equal(note.visibility, NoteVisibility.PRIVATE);
});

test("the player can add a final response and end without generating another NPC reply", async t => {
  const requests: Array<{ messages: readonly { role: string; content: string | null }[] }> = [];
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: typeof requests[number]) => {
    requests.push(request);
    return modelReply(remembered);
  });
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  runtime.endConversationAsPlayer("corvin", "Until tomorrow.");
  const view = runtime.view() as any;
  assert.deepEqual(view.conversations.corvin, [
    { role: "player", text: "Until tomorrow." },
  ]);
  assert.equal(view.conversationEndRequested.corvin, true);
  await assert.rejects(runtime.talkToCharacter("corvin", "One more thing."), /ended the conversation/);
  await runtime.endConversation("corvin");
  assert.equal(requests.length, 1, "ending with a response does not request another dialogue turn");
  assert.deepEqual(JSON.parse(requests[0]!.messages.at(-1)!.content!), [
    { speakerId: "player", text: "Until tomorrow." },
  ]);
  assert.equal(runtime.snapshot().conversations.corvin, undefined);
});

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
  const authoredScenario = conversationScenario();
  const runtime = new BrowserGameRuntime(authoredScenario, "test");
  const scenario = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  await runtime.talkToCharacter("corvin", "What troubles you?");
  await runtime.talkToCharacter("corvin", "I offer my help.");
  assert.deepEqual(fromJson(ScenarioSchema, runtime.snapshot().scenario), scenario, "Speaking does not prematurely commit memory");
  const openSave = structuredClone(runtime.snapshot());
  const restored = new BrowserGameRuntime(scenario, "test", openSave);
  await restored.endConversation("corvin");
  const review = requests[2]!.messages;
  assert.deepEqual(JSON.parse(review.at(-1)!.content!), [
    { speakerId: "player", text: "What troubles you?" }, { speakerId: "corvin", text: "I need an ally." },
    { speakerId: "player", text: "I offer my help." }, { speakerId: "corvin", text: "Then meet me tonight." },
  ]);
  const saved = structuredClone(restored.snapshot());
  assert.equal(saved.conversations.corvin, undefined);
  const updated = fromJson(ScenarioSchema, saved.scenario);
  const corvin = updated.characters.find(character => character.id === "corvin")!;
  assert.equal(corvin.currentGoal, remembered.goalUpdate.goal);
  assert.deepEqual(corvin.objectives, scenario.characters[0]!.objectives);
  assert.deepEqual(corvin.parkedObjectives, scenario.characters[0]!.parkedObjectives);
  assert.equal(corvin.lore, scenario.characters[0]!.lore);
  assert.equal(corvin.relationships.find(item => item.characterId === "player")?.description, remembered.relationships[0]!.description);
  assert.deepEqual(corvin.relationships.filter(item => item.characterId !== "player"), scenario.characters[0]!.relationships);
  assert.deepEqual(updated.characters.slice(1), scenario.characters.slice(1));
  const event = updated.notes.at(-1)!;
  assert.equal(event.text, remembered.newNotes[0]);
  assert.equal(event.visibility, NoteVisibility.PRIVATE);
  assert.deepEqual(event.characterIds, ["corvin", "player"]);
  assert.equal(event.day, 1);
  assert.deepEqual(updated.notes.slice(0, -1), scenario.notes);
  assert.deepEqual(updated.world, { ...scenario.world, revision: scenario.world!.revision + 1 });
  const nextVisit = new BrowserGameRuntime(scenario, "test", saved);
  await nextVisit.endConversation("corvin");
  assert.equal(requests.length, 3, "Repeated end must not duplicate memory or call the model");
  await nextVisit.talkToCharacter("corvin", "Hello again.");
  const nextPrompt = requests[3]!.messages;
  assert.deepEqual(nextPrompt.filter(message => message.role !== "system"), [{ role: "user", content: "Hello again." }]);
  assert.match(nextPrompt.map(message => message.content).join("\n"), /potential ally|Meet the envoy tonight/);
  assert.equal(nextVisit.snapshot().conversations.corvin?.length, 2);
  const kingContext = nextVisit.debugCharacter("king");
  assert.doesNotMatch(JSON.stringify(kingContext), /envoy promised Corvin/);
});

test("failed or malformed reviews keep every part of the open conversation for retry", async t => {
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "I will consider it." }));
  await runtime.talkToCharacter("corvin", "Will you help?");
  const before = structuredClone(runtime.snapshot());
  const failures = [null, "{", "{}", JSON.stringify({ ...remembered, relationships: [{ characterId: "unknown", description: "An ally" }] }), JSON.stringify({ ...remembered, newNotes: [" "] })];
  for (const content of failures) {
    t.mock.method(OpenRouterClient.prototype, "complete", async () => ({ role: "assistant", content }));
    await assert.rejects(runtime.endConversation("corvin"));
    assert.deepEqual(runtime.snapshot(), before);
  }
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { throw new Error("Network failure"); });
  await assert.rejects(runtime.endConversation("corvin"), /Network failure/);
  assert.deepEqual(runtime.snapshot(), before);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply(remembered));
  await runtime.endConversation("corvin");
  assert.equal(runtime.snapshot().conversations.corvin, undefined);
});

test("empty conversations do not call the model and invalid targets cannot be ended", async t => {
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { assert.fail("No model call expected"); });
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  const before = runtime.snapshot();
  await runtime.endConversation("corvin");
  assert.deepEqual(runtime.snapshot(), before);
  await assert.rejects(runtime.endConversation("player"), /Unknown character/);
  await assert.rejects(runtime.endConversation("unknown"), /Unknown character/);
  await assert.rejects(new BrowserGameRuntime(load(), "test").endConversation("corvin"), /have not begun/);
});

test("ending one NPC's thread leaves other conversations intact and saves biography updates", async t => {
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Good evening." }));
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  await runtime.talkToCharacter("corvin", "Hello.");
  await runtime.talkToCharacter("king", "Your Majesty.");
  const kingHistory = runtime.snapshot().conversations.king;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({
    newNotes: [], goalUpdate: null, relationships: [], lore: "Corvin remembers his new appointment as court adviser.",
  }));
  await runtime.endConversation("corvin");
  assert.deepEqual(runtime.snapshot().conversations.king, kingHistory);
  assert.equal(fromJson(ScenarioSchema, runtime.snapshot().scenario).characters[0]!.lore, "Corvin remembers his new appointment as court adviser.");
});

// Navigation tests exercise actual palace geometry, dynamic obstruction and A* optimality.

test("A* detours around blockers and matches a breadth-first shortest path", () => {
  const start = palaceNodes[0]!;
  const goal = palaceNodes.find(node => node.id === "corvin")!;
  const blocked = new Set(["61,20", "60,20", "62,20"]);
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

test("Jev transport sends typed choices and rejects invalid responses and HTTP failures", async () => {
  let sent: Record<string, any> = {};
  const client = new JevClient("test-key", async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/alpha/decisions");
    sent = JSON.parse(String(init?.body));
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-key");
    return new Response(JSON.stringify({ answers: { next: { type: "choice", choice: "walk", probabilities: { walk: 1, stop: 0 }, confidence: 1 } } }));
  });
  const criteria = { walk: "Walk to Corvin", stop: "Stop" };
  assert.equal((await client.choose({ goal: "Corvin" }, "Choose", criteria, new AbortController().signal)).choice, "walk");
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

test("Jev evaluates multiple rubric criteria in one request", async () => {
  let sent: any;
  const client = new JevClient("test-key", async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ answers: {
      grounded: { type: "choice", choice: "meets", probabilities: { meets: 0.9, does_not_meet: 0.1 } },
      urgent: { type: "choice", choice: "does_not_meet", probabilities: { meets: 0.2, does_not_meet: 0.8 } },
    } }));
  });
  const criteria = { meets: "Criterion is met.", does_not_meet: "Criterion is not met." };
  const answers = await client.evaluate({ response: "A guarded reply." }, {
    grounded: { type: "choice", instructions: "Is it grounded?", criteria },
    urgent: { type: "choice", instructions: "Is it urgent?", criteria },
  }, new AbortController().signal);
  assert.deepEqual(Object.keys(sent.questions), ["grounded", "urgent"]);
  assert.equal(answers.grounded?.probabilities.meets, 0.9);
  assert.equal(answers.urgent?.choice, "does_not_meet");
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

test("main palace markers use saved rooms and separate characters on walkable tiles", () => {
  const markers = courtMarkers(load().courtArrivalPlacements.map(item => ({ id: item.characterId, name: item.characterId, roomId: item.roomId, position: item.position! })));
  assert.equal(new Set(markers.map(marker => pointKey(marker.point!))).size, load().courtArrivalPlacements.length);
  assert.ok(markers.every(marker => courtRoomAt(marker.point!)?.id === "great_hall"));
  assert.ok(markers.every(marker => courtPath(markers[0]!.point!, marker.point!)));
  const corvin = courtMarkers([{ id: "corvin", name: "Corvin", roomId: "corvin_chamber", position: { x: 51, y: 5 } }])[0]!;
  assert.equal(courtRoomAt(corvin.point!)?.id, "corvin_chamber");
  assert.equal(courtMarkers([{ id: "king", name: "King", roomId: "nonexistent_room" }])[0]!.point, undefined);
});

test("main palace movement validates routes and survives saving and restoring", () => {
  const scenario = load(); scenario.characters.push(create(CharacterSchema, { id: "player", name: "Envoy" })); scenario.playerCharacterId = "player";
  scenario.world!.phase = GamePhase.CONVERSATIONS;
  for (const actor of scenario.world!.actors) actor.roomId = "great_hall";
  scenario.world!.actors.push({ $typeName: "kingmaker.v1.ActorState", characterId: "player", homeRoomId: "guest_chamber", roomId: "great_hall", awake: true, position: create(TilePositionSchema, { x: 62, y: 22 }) });
  const runtime = new BrowserGameRuntime(scenario, "test");
  runtime.movePlayer({ x: 51, y: 16 }); runtime.setDoor("hall_door", true);
  runtime.movePlayer({ x: 51, y: 10 });
  runtime.setDoor("corvin_door", true);
  runtime.movePlayer({ x: 51, y: 5 });
  assert.deepEqual(fromJson(ScenarioSchema, runtime.snapshot().scenario).world!.actors.find(actor => actor.characterId === "player")!.position, create(TilePositionSchema, { x: 51, y: 5 }));
  assert.equal(runtime.view().location, "Corvin's Chamber");
  const restored = new BrowserGameRuntime(scenario, "test", structuredClone(runtime.snapshot()));
  assert.deepEqual(restored.view().player && (restored.view().player as { position: unknown }).position, create(TilePositionSchema, { x: 51, y: 5 }));
  const before = JSON.stringify(restored.snapshot());
  assert.throws(() => restored.movePlayer({ x: 0, y: 0 }), /not reachable/);
  assert.throws(() => restored.movePlayer({ x: 52, y: 4 }), /not reachable/);
  assert.throws(() => restored.movePlayer({ x: NaN, y: 4 }), /not reachable/);
  assert.equal(JSON.stringify(restored.snapshot()), before);
  restored.movePlayer({ x: 61, y: 35 });
  assert.equal(restored.view().location, "Entrance Hall");
  restored.reset(); assert.deepEqual(fromJson(ScenarioSchema, restored.snapshot().scenario).world!.actors.find(actor => actor.characterId === "player")!.position, create(TilePositionSchema, { x: 62, y: 22 }));
  assert.throws(() => new BrowserGameRuntime(load(), "test").movePlayer({ x: 51, y: 5 }), /Enter the court/);
});


test("mid-walk redirection preserves the current visual position and rejects blocked destinations", () => {
  const original = courtPath({ x: 61, y: 21 }, { x: 51, y: 5 })!;
  const visual = courtWalkPoint(original, 2.4);
  const changed = redirectCourtPath(original, 2.4, { x: 72, y: 25 })!;
  assert.deepEqual(changed[0], visual);
  assert.deepEqual(changed[1], original[3]);
  assert.deepEqual(changed.at(-1), { x: 72, y: 25 });
  assert.equal(redirectCourtPath(original, 2.4, { x: 0, y: 0 }), undefined);
  const again = redirectCourtPath(changed, 0.2, { x: 61, y: 21 })!;
  assert.deepEqual(again[0], courtWalkPoint(changed, 0.2));
  assert.deepEqual(again.at(-1), { x: 61, y: 21 });
  const stop = redirectCourtPath(original, 3, original[3]!)!;
  assert.equal(stop.length, 1);
});

test("court camera follows the player while clamping at map edges", () => {
  const stageWidth = palaceMap.width * 24, stageHeight = palaceMap.height * 24;
  assert.deepEqual(courtCameraScroll({ x: palaceMap.width / 2 - 0.5, y: palaceMap.height / 2 - 0.5 },
    stageWidth, stageHeight, 400, 500), { x: stageWidth / 2 - 200, y: stageHeight / 2 - 250 });
  assert.deepEqual(courtCameraScroll({ x: 0, y: 0 }, stageWidth, stageHeight, 400, 500), { x: 0, y: 0 });
  assert.deepEqual(courtCameraScroll({ x: palaceMap.width - 1, y: palaceMap.height - 1 },
    stageWidth, stageHeight, 400, 500), { x: stageWidth - 400, y: stageHeight - 500 });
  assert.deepEqual(courtCameraScroll({ x: 15, y: 18 }, 320, 380, 400, 500), { x: 0, y: 0 });
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
  assert.equal(courtMarkers([{ id: "corvin", name: "Corvin", roomId: "great_hall" }])[0]!.point, undefined);
  const customized = { x: 60, y: 21 };
  assert.deepEqual(courtMarkers([{ id: "corvin", name: "Corvin", roomId: "great_hall", position: customized }])[0]!.point, customized);
  assert.equal(courtMarkers([{ id: "corvin", name: "Corvin", roomId: "great_hall", position: { x: 51, y: 5 } }])[0]!.point, undefined);
});


test("tile menus gather every layer with stable action and layer order and preserve legality", () => {
  const layers: CourtInteractionLayer[] = [
    { id: "corvin", position: { x: 5, y: 5 }, order: 30, actions: [{ id: "talk", label: "Talk to Corvin", type: "talk", target: "corvin", order: 10, legality: "normal" }] },
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
  const target = { x: 58, y: 20 }, start = { x: 62, y: 22 };
  const spot = courtInteractionPoint(start, target)!;
  assert.equal(Math.abs(spot.x - target.x) + Math.abs(spot.y - target.y), 1);
  assert.ok(courtPath(start, spot));
  assert.deepEqual(courtInteractionPoint(spot, target), spot);
  const authored = { x: 52, y: 5 };
  assert.deepEqual(courtInteractionPoint(start, { x: 52, y: 4 }, authored), authored);
  assert.equal(courtInteractionPoint(start, target, { x: 0, y: 0 }), undefined);
});


test("main doors choose the closest reachable side and block paths until opened", () => {
  const doors = load().world!.doors;
  doors.find(door => door.id === "hall_door")!.open = true;
  const corvin = doors.find(door => door.id === "corvin_door")!;
  assert.equal(courtPath({ x: 61, y: 21 }, { x: 51, y: 5 }, doors), undefined);
  assert.deepEqual(nearestDoorSpot({ x: 61, y: 21 }, corvin, doors), corvin.interactionSpots[0]);
  corvin.open = true;
  assert.ok(courtPath({ x: 61, y: 21 }, { x: 51, y: 5 }, doors));
  assert.deepEqual(nearestDoorSpot({ x: 51, y: 5 }, corvin, doors), corvin.interactionSpots[1]);
  assert.deepEqual(nearestDoorSpot({ x: 51, y: 12 }, corvin, doors), corvin.interactionSpots[0]);
});

test("door operations validate approach and occupancy, and persist through saves", () => {
  const scenario = load(); scenario.characters.push(create(CharacterSchema, { id: "player", name: "Envoy" })); scenario.playerCharacterId = "player";
  scenario.world!.phase = GamePhase.CONVERSATIONS;
  scenario.world!.actors.push({ $typeName: "kingmaker.v1.ActorState", characterId: "player", homeRoomId: "guest_chamber", roomId: "great_hall", awake: true,
    position: create(TilePositionSchema, { x: 62, y: 22 }) });
  const runtime = new BrowserGameRuntime(scenario, "test");
  assert.throws(() => runtime.setDoor("corvin_door", true), /interaction spot/);
  assert.throws(() => runtime.movePlayer({ x: 51, y: 5 }), /not reachable/);
  runtime.movePlayer({ x: 51, y: 16 }); runtime.setDoor("hall_door", true);
  runtime.movePlayer({ x: 51, y: 10 }); runtime.setDoor("corvin_door", true);
  runtime.movePlayer({ x: 51, y: 8 }); runtime.setDoor("corvin_door", false);
  const restored = new BrowserGameRuntime(scenario, "test", structuredClone(runtime.snapshot()));
  assert.equal(fromJson(ScenarioSchema, restored.snapshot().scenario).world!.doors.find(door => door.id === "corvin_door")!.open, false);
  assert.throws(() => restored.movePlayer({ x: 51, y: 12 }), /not reachable/);
  restored.setDoor("corvin_door", true);
  const occupied = fromJson(ScenarioSchema, restored.snapshot().scenario);
  occupied.world!.actors.find(actor => actor.characterId === "corvin")!.position = create(TilePositionSchema, { x: 51, y: 9 });
  const blocked = new BrowserGameRuntime(occupied, "test");
  assert.throws(() => blocked.setDoor("corvin_door", false), /standing in the doorway/);
});


test("bedroom doors are illegal to open except for characters on the room access list", () => {
  const world = load().world!;
  for (const [id, resident] of [["corvin_door", "corvin"], ["garran_door", "garran"], ["royal_door", "king"], ["guest_door", "player"]]) {
    const door = world.doors.find(door => door.id === id)!;
    assert.equal(doorActionLegality(door, world.rooms, resident!), "normal");
    assert.equal(doorActionLegality(door, world.rooms, "stranger"), "illegal");
    assert.equal(doorActionLegality({ ...door, open: true }, world.rooms, "stranger"), "normal");
  }
  const corvin = world.doors.find(door => door.id === "corvin_door")!;
  assert.equal(doorActionLegality(corvin, world.rooms, "player"), "illegal");
  world.rooms.find(room => room.id === "corvin_chamber")!.allowedCharacterIds.push("player");
  assert.equal(doorActionLegality(corvin, world.rooms, "player"), "illegal");
  world.rooms.find(room => room.id === "north_corridor")!.allowedCharacterIds.push("player");
  assert.equal(doorActionLegality(corvin, world.rooms, "player"), "normal");
  const hall = world.doors.find(door => door.id === "hall_door")!;
  assert.equal(doorActionLegality(hall, world.rooms, "stranger"), "illegal");
  assert.equal(doorActionLegality(hall, world.rooms, "king"), "normal");
  const restored = fromBinary(ScenarioSchema, toBinary(ScenarioSchema, load())).world!;
  assert.equal(doorActionLegality(restored.doors.find(door => door.id === "royal_door")!, restored.rooms, "player"), "illegal");
});

test("the nobles' parlour admits every court character but remains restricted to outsiders", () => {
  const scenario = load();
  const world = scenario.world!;
  const parlour = world.rooms.find(room => room.id === "guest_chamber")!;
  const door = world.doors.find(door => door.id === "guest_door")!;
  assert.equal(parlour.name, "Nobles' Parlour");
  assert.ok(parlour.private);
  for (const character of scenario.characters) {
    assert.equal(doorActionLegality(door, world.rooms, character.id), "normal", character.name);
  }
  assert.equal(doorActionLegality(door, world.rooms, "player"), "normal");
  assert.equal(doorActionLegality(door, world.rooms, "stranger"), "illegal");
});


test("NPC dialogue frames the current goal as a concrete planner task while retaining motives", () => {
  const scenario = load();
  assert.ok(scenario.characters.every(character => character.currentGoal.includes("greet the visiting player")));
  assert.ok(scenario.characters.every(character => character.dialogueObjectives.length > 0
    && character.dialogueObjectives.every(objective => objective.length > 40)));
  const messages = new FullContextBuilder().build(create(DialogueRequestSchema, { scenario, characterId: "corvin" }));
  const context = messages.map(message => message.content).join("\n");
  assert.match(context, /# Dialogue objectives/);
  assert.match(context, /published patrol obligations may not match its sealed records/);
  assert.match(context, /do not recite or exhaust the list, force a subject/);
  assert.match(context, /Immediate goal for the action planner/);
  assert.match(context, /available actions such as moving, talking/);
  assert.match(context, /concrete next step rather than an open-ended objective/);
  assert.match(context, /Return null if there is no task to perform/);
  assert.match(context, /follow through after ending the conversation/);
  assert.match(context, /believes Aldren must be replaced/);

  const rookContext = new FullContextBuilder().build(create(DialogueRequestSchema, { scenario, characterId: "rook" }))
    .map(message => message.content).join("\n");
  assert.match(rookContext, /recruit them into a ruse requiring only court access/);
  assert.match(rookContext, /fictitious Grey Gull caravan/);
  assert.match(rookContext, /help you, warn Sabine and join her counter-ruse, tell Lucan, or exploit both sides/);
  assert.match(rookContext, /Keep the conversation open for their answer/);

  const sabineContext = new FullContextBuilder().build(create(DialogueRequestSchema, { scenario, characterId: "sabine" }))
    .map(message => message.content).join("\n");
  assert.match(sabineContext, /understated Saltmere's full caravan losses to prevent an insurance and credit panic/);
  assert.match(sabineContext, /offer a counter-ruse/);

  const runtime = new BrowserGameRuntime(scenario, "test");
  runtime.createDevelopmentPlayer();
  const debug = runtime.debugCharacter("corvin") as any;
  assert.deepEqual(debug.character.dialogueObjectives, scenario.characters.find(character => character.id === "corvin")!.dialogueObjectives);
  assert.match(JSON.stringify(debug.modelMessages), /# Dialogue objectives/);

  const oldSnapshot = runtime.snapshot() as any;
  const oldCorvin = oldSnapshot.scenario.characters.find((character: any) => character.id === "corvin");
  oldCorvin.dialogueObjective = oldCorvin.dialogueObjectives[0];
  delete oldCorvin.dialogueObjectives;
  const restored = new BrowserGameRuntime(load(), "test");
  restored.restore(oldSnapshot);
  assert.deepEqual((restored.debugCharacter("corvin") as any).character.dialogueObjectives, [oldCorvin.dialogueObjective]);
});

test("NPC leave-taking persists, blocks more speech, and reviews closing words once", async t => {
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: { messages: readonly { content: string | null }[] }) => {
    const prompt = JSON.stringify(request.messages);
    assert.match(prompt, /Completing or advancing a dialogue objective is not a reason to leave/);
    assert.match(prompt, /asking the player a question, making them an offer, or requesting their help/);
    return modelReply({ utterance: "Excuse me; I must attend to my duties.", endConversation: true, replyOptions: [] });
  });
  await runtime.talkToCharacter("corvin", "Good evening.");
  const saved = structuredClone(runtime.snapshot());
  assert.equal(saved.conversationEndRequested?.corvin, true);
  assert.deepEqual(saved.conversationReplyOptions?.corvin, []);
  const restored = new BrowserGameRuntime(conversationScenario(), "test", saved);
  await assert.rejects(restored.talkToCharacter("corvin", "Wait!"), /ended the conversation/);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { throw new Error("Offline"); });
  await assert.rejects(restored.endConversation("corvin"), /Offline/);
  assert.deepEqual(restored.snapshot(), saved);
  let reviews = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: { messages: readonly { content: string | null }[] }) => {
    reviews++;
    assert.match(request.messages.at(-1)!.content!, /attend to my duties/);
    assert.match(JSON.stringify(request.messages), /Parked objectives/);
    assert.match(JSON.stringify(request.messages), /opens or advances a scenario thread/);
    return modelReply(remembered);
  });
  await restored.endConversation("corvin");
  await restored.endConversation("corvin");
  assert.equal(reviews, 1);
  assert.equal(restored.snapshot().conversationEndRequested?.corvin, undefined);
});

test("authored parked objectives remain distinct from immediate greeting goals in model context", () => {
  const scenario = load();
  for (const character of scenario.characters) {
    assert.equal(character.parkedObjectives.length, 3);
    const context = new FullContextBuilder().build(create(DialogueRequestSchema, { scenario, characterId: character.id }));
    for (const objective of character.parkedObjectives) assert.ok(context.some(message => message.content.includes(objective.name)));
    assert.match(character.currentGoal, /greet the visiting player/);
  }
});

function furnishedCourt(): Scenario {
  const scenario = conversationScenario();
  scenario.world!.actors.push({ $typeName: "kingmaker.v1.ActorState", characterId: "player", homeRoomId: "guest_chamber", roomId: "great_hall", awake: true, position: create(TilePositionSchema, { x: 62, y: 22 }) });
  return scenario;
}

test("main containers enforce approaches and keys, conceal contents, and persist item transfers", () => {
  const scenario = furnishedCourt(), runtime = new BrowserGameRuntime(scenario, "test");
  const known = worldForCharacter(scenario, "player");
  assert.ok(!known.objects.some(item => item.id === "palace_royal_key"));
  assert.equal(known.fixtures.find(item => item.id === "palace_coffer_03")!.requiredKeyId, "");
  assert.throws(() => runtime.interactFixture("open_palace_corvin_drawers"), /interaction spot/);
  runtime.movePlayer({ x: 51, y: 16 }); runtime.setDoor("hall_door", true);
  runtime.movePlayer({ x: 51, y: 10 }); runtime.setDoor("corvin_door", true);
  runtime.movePlayer({ x: 52, y: 5 });
  assert.match(runtime.interactFixture("open_palace_corvin_drawers"), /Royal lockbox key/);
  let saved = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.ok(worldForCharacter(saved, "player").objects.some(item => item.id === "palace_royal_key"));
  assert.match(runtime.interactFixture("take_palace_royal_key"), /Picked up/);
  assert.throws(() => runtime.interactFixture("take_palace_royal_key"), /Unknown/);
  runtime.interactFixture("close_palace_corvin_drawers");
  runtime.movePlayer({ x: 61, y: 10 }); runtime.setDoor("royal_door", true);
  runtime.movePlayer({ x: 63, y: 5 });
  runtime.interactFixture("open_palace_coffer_03");
  runtime.interactFixture("take_palace_royal_seal");
  runtime.interactFixture("take_palace_sealed_decree");
  const restored = new BrowserGameRuntime(scenario, "test", structuredClone(runtime.snapshot()));
  saved = fromJson(ScenarioSchema, restored.snapshot().scenario);
  assert.equal(locatedItems(saved).find(item => item.id === "palace_royal_seal")!.locationId, "player");
  assert.equal(locatedItems(saved).find(item => item.id === "palace_royal_key")!.locationId, "player", "Key is not consumed");
  assert.equal(saved.world!.fixtures.find(item => item.id === "palace_coffer_03")!.open, true);
  assert.equal(locatedItems(saved).find(item => item.id === "palace_sealed_decree")!.locationId, "player");
});

test("player fixture interactions emit transient world events instead of durable memories", () => {
  const witnessed = furnishedCourt();
  for (const actor of witnessed.world!.actors) actor.position = create(TilePositionSchema, { x: 76, y: 30 });
  witnessed.world!.actors.find(actor => actor.characterId === "player")!.position = create(TilePositionSchema, { x: 52, y: 5 });
  witnessed.world!.fixtures.find(fixture => fixture.id === "palace_corvin_drawers")!.open = true;
  const runtime = new BrowserGameRuntime(witnessed, "test");
  const before = runtime.snapshot().scenario;
  const result = runtime.interactFixtureWithEvent("take_palace_royal_key");
  assert.match(result.message, /Picked up/);
  assert.equal(result.event.kind, "interacting with an object");
  assert.deepEqual(result.event.participantIds, ["player"]);
  assert.deepEqual(result.event.position, create(TilePositionSchema, { x: 52, y: 5 }));
  assert.equal(result.event.details?.legality, "illegal");
  assert.equal(result.event.details?.ownerCharacterId, "corvin");
  assert.equal(result.event.details?.ownerName, "Magister Corvin");
  assert.match(result.event.summary, /stole Royal lockbox key from Magister Corvin/);
  assert.equal(fromJson(ScenarioSchema, runtime.snapshot().scenario).notes.length, fromJson(ScenarioSchema, before).notes.length);
});

test("NPC interactions emit the same transient world event shape", () => {
  const scenario = furnishedCourt();
  for (const actor of scenario.world!.actors) actor.position = create(TilePositionSchema, { x: 76, y: 30 });
  scenario.world!.actors.find(actor => actor.characterId === "corvin")!.position = create(TilePositionSchema, { x: 52, y: 5 });
  scenario.world!.actors.find(actor => actor.characterId === "garran")!.position = create(TilePositionSchema, { x: 53, y: 5 });
  const drawers = scenario.world!.fixtures.find(fixture => fixture.id === "palace_corvin_drawers")!;
  drawers.open = true; drawers.ownerCharacterId = "king";
  const runtime = new BrowserGameRuntime(scenario, "test"), active = runtime.snapshot();
  const goal = scenario.characters.find(character => character.id === "corvin")!.currentGoal;
  active.npcActivities = { corvin: { status: "active", goal, history: [] } };
  runtime.restore(active);

  const result = runtime.stepNpcAction("corvin", "take_palace_royal_key", goal);
  assert.equal(result.done, true);
  assert.equal(result.worldEvent?.participantIds[0], "corvin");
  assert.equal(result.worldEvent?.kind, "fixture");
  assert.match(result.worldEvent?.summary ?? "", /Royal lockbox key/);
  assert.equal(result.worldEvent?.details?.legality, "illegal");
  assert.equal(result.worldEvent?.details?.ownerCharacterId, "king");
});

test("trying locked containers needs the correct carried key and preserves concealed loot", () => {
  const scenario = furnishedCourt();
  for (const door of scenario.world!.doors) door.open = true;
  const runtime = new BrowserGameRuntime(scenario, "test");
  runtime.movePlayer({ x: 63, y: 5 });
  assert.match(runtime.interactFixture("open_palace_coffer_03"), /locked/);
  const saved = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.equal(saved.world!.fixtures.find(item => item.id === "palace_coffer_03")!.open, false);
  assert.ok(!worldForCharacter(saved, "player").objects.some(item => item.id === "palace_royal_seal"));
  assert.throws(() => runtime.interactFixture("take_palace_royal_seal"), /Unknown/);
});

test("resetting physical world keeps character and conversation while refreshing containers and placements", async t => {
  const authored = load(), scenario = furnishedCourt();
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Welcome, envoy." }));
  const runtime = new BrowserGameRuntime(authored, "test", new BrowserGameRuntime(scenario, "test").snapshot());
  await runtime.talkToCharacter("corvin", "Hello.");
  runtime.movePlayer({ x: 66, y: 21 });
  runtime.interactFixture("open_palace_hall_cabinet");
  runtime.interactFixture("take_palace_iron_key");
  const before = runtime.snapshot(), characters = fromJson(ScenarioSchema, before.scenario).characters;
  runtime.resetWorld();
  const after = runtime.snapshot(), result = fromJson(ScenarioSchema, after.scenario);
  assert.deepEqual(result.characters.map(({ inventory, ...character }) => character), characters.map(({ inventory, ...character }) => character));
  assert.deepEqual(after.conversations, before.conversations);
  assert.deepEqual(result.notes, fromJson(ScenarioSchema, before.scenario).notes);
  assert.deepEqual(result.world!.fixtures, authored.world!.fixtures);
  assert.deepEqual(locatedItems(result), locatedItems(authored));
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
  await runtime.talkToCharacter("corvin", "Let's speak privately.");
  await assert.rejects(runtime.planNpc("corvin", new AbortController().signal), /review first/);
  const goal = "Go to Corvin's Chamber and wait for the player.";
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newNotes: [], relationships: [], goalUpdate: { goal, reason: "Agreed a meeting." }, lore: null }));
  await runtime.endConversation("corvin");
  let step = 0;
  t.mock.method(JevClient.prototype, "choose", async (state: any, _instructions: unknown, criteria: Record<string, string>) => {
    assert.ok(state.includes(goal));
    assert.match(state, /\[corvin\]/);
    assert.ok(!state.includes("Sealed royal decree"));
    assert.match(criteria.wait!, /depends entirely on another character/);
    const choice = ["enter_royal_council_chamber", "open_hall_door_0", "enter_north_corridor", "open_corvin_door_0", "enter_corvin_chamber", "complete"][step++]!;
    assert.ok(criteria[choice]);
    if (step <= 4) assert.ok(!criteria.enter_corvin_chamber, "Closed room cannot be selected as a move target");
    return { choice, probabilities: { [choice]: 1 } };
  });
  for (let i = 0; i < 5; i++) {
    const plan = await runtime.planNpc("corvin", new AbortController().signal);
    assert.ok(plan.action);
    runtime.executeNpcAction("corvin", plan.action.id, plan.revision, plan.goal);
  }
  const finished = await runtime.planNpc("corvin", new AbortController().signal);
  assert.equal(finished.decision.choice, "complete");
  const saved = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.equal(saved.world!.actors.find(actor => actor.characterId === "corvin")!.roomId, "corvin_chamber");
  assert.deepEqual(saved.world!.actors.find(actor => actor.characterId === "player")!.position, scenario.world!.actors.find(actor => actor.characterId === "player")!.position);
  assert.deepEqual(new BrowserGameRuntime(scenario, "test", runtime.snapshot()).snapshot(), runtime.snapshot());
});

test("Jev can stop on wait and marks the outcome as blocked on another character", async t => {
  const runtime = new BrowserGameRuntime(furnishedCourt(), "test");
  const snapshot = runtime.snapshot();
  const goal = fromJson(ScenarioSchema, snapshot.scenario).characters.find(character => character.id === "corvin")!.currentGoal;
  snapshot.npcActivities = { corvin: { status: "active", goal, history: [] } };
  runtime.restore(snapshot);
  t.mock.method(JevClient.prototype, "choose", async (_state: unknown, _instructions: unknown, criteria: Record<string, string>) => {
    assert.match(criteria.wait!, /depends entirely on another character/);
    return { choice: "wait", probabilities: { wait: 1 } };
  });
  const plan = await runtime.planNpc("corvin", new AbortController().signal);
  assert.equal(plan.decision.choice, "wait");
  assert.equal(plan.action, undefined);
  runtime.finishNpcRun("corvin", "wait", "Waiting for Lucan to initiate the promised conversation.");
  assert.equal(runtime.snapshot().npcActivities!.corvin!.result!.reason, "wait");
});

test("NPC actions use their own keys and inventory, reject stale plans, and preserve the player's inventory", () => {
  const scenario = furnishedCourt();
  for (const door of scenario.world!.doors) door.open = true;
  const corvin = scenario.world!.actors.find(actor => actor.characterId === "corvin")!;
  corvin.roomId = "corvin_chamber"; corvin.position = create(TilePositionSchema, { x: 51, y: 5 });
  const runtime = new BrowserGameRuntime(scenario, "test");
  const activeSnapshot = runtime.snapshot();
  activeSnapshot.npcActivities = { corvin: { status: "active", goal: scenario.characters.find(item => item.id === "corvin")!.currentGoal, history: [] } };
  runtime.restore(activeSnapshot);
  function execute(id: string) {
    const s = fromJson(ScenarioSchema, runtime.snapshot().scenario), observation = courtAgentObservation(s, "corvin");
    assert.ok(observation.actions.some(action => action.id === id));
    return runtime.executeNpcAction("corvin", id, observation.revision, observation.goal);
  }
  execute("open_palace_corvin_drawers"); execute("take_palace_royal_key"); execute("enter_north_corridor"); execute("enter_royal_bedchamber"); execute("open_palace_coffer_03"); execute("take_palace_royal_seal"); execute("take_palace_sealed_decree");
  const snapshot = runtime.snapshot(), saved = fromJson(ScenarioSchema, snapshot.scenario);
  assert.equal(locatedItems(saved).find(item => item.id === "palace_royal_key")!.locationId, "corvin");
  assert.equal(locatedItems(saved).find(item => item.id === "palace_royal_seal")!.locationId, "corvin");
  assert.equal(locatedItems(saved).find(item => item.id === "palace_sealed_decree")!.locationId, "corvin");
  assert.deepEqual(runtime.view().inventory, []);
  const observation = courtAgentObservation(saved, "corvin");
  runtime.resetWorld();
  assert.throws(() => runtime.executeNpcAction("corvin", observation.actions[0]!.id, observation.revision, observation.goal), /World changed|not accepting actions/);
  assert.throws(() => courtAgentObservation(saved, "player"), /NPC/);
});

test("greeting goal is idle until the LLM explicitly assigns a task", async t => {
  const runtime = new BrowserGameRuntime(furnishedCourt(), "test");
  assert.ok(Object.values(runtime.view().npcActivities as Record<string, {status: string}>).every(activity => activity.status === "idle"));
  await assert.rejects(runtime.planNpc("corvin", new AbortController().signal), /idle/);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Welcome." }));
  await runtime.talkToCharacter("corvin", "Hello.");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newNotes: [], relationships: [], goalUpdate: null, lore: null }));
  await runtime.endConversation("corvin");
  assert.equal(runtime.snapshot().npcActivities?.corvin?.status, "idle");
  assert.equal(fromJson(ScenarioSchema, runtime.snapshot().scenario).characters[0]!.currentGoal, "", "The GM clears an obsolete task when returning the NPC to idle");
  await assert.rejects(runtime.planNpc("corvin", new AbortController().signal), /idle/);
});

test("NPC reviews actual planner results, can activate a follow-up, and later returns idle", async t => {
  const runtime = new BrowserGameRuntime(furnishedCourt(), "test");
  const active = runtime.snapshot();
  active.npcActivities = { corvin: { status: "active", goal: "Inspect my drawers.", history: ["Corvin's chest of drawers is closed."] } };
  runtime.restore(active);
  runtime.finishNpcRun("corvin", "complete", "Jev chose complete with confidence 0.8.");
  const ended = runtime.snapshot();
  assert.equal(ended.npcActivities!.corvin!.status, "idle");
  assert.equal(ended.npcActivities!.corvin!.reviewPending, true);
  await assert.rejects(runtime.planNpc("corvin", new AbortController().signal), /idle/);
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: { messages: {content: string}[] }) => {
    const outcome = JSON.parse(request.messages.at(-1)!.content);
    assert.equal(outcome.goal, "Inspect my drawers.");
    assert.deepEqual(outcome.actionsPerformed, ["Corvin's chest of drawers is closed."]);
    assert.equal(outcome.result.reason, "complete");
    assert.ok(outcome.observations.location);
    return modelReply({ newNotes: ["My drawers are closed."], relationships: [], lore: null,
      goalUpdate: { goal: "Open my drawers.", reason: "I want to examine the contents." } });
  });
  await runtime.reviewNpcOutcome("corvin");
  assert.equal(runtime.snapshot().npcActivities!.corvin!.status, "active");
  assert.equal(runtime.snapshot().npcActivities!.corvin!.goal, "Open my drawers.");
  assert.deepEqual(runtime.snapshot().npcActivities!.corvin!.history, []);
  assert.deepEqual(fromJson(ScenarioSchema, runtime.snapshot().scenario).notes.at(-1)!.characterIds, ["corvin"], "Private planner memories do not become player knowledge");
  runtime.finishNpcRun("corvin", "unable", "No progress possible.");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newNotes: [], relationships: [], lore: null, goalUpdate: null }));
  await runtime.reviewNpcOutcome("corvin");
  assert.equal(runtime.snapshot().npcActivities!.corvin!.status, "idle");
  assert.equal(runtime.snapshot().npcActivities!.corvin!.reviewPending, false);
  const done = runtime.snapshot();
  await runtime.reviewNpcOutcome("corvin");
  assert.deepEqual(runtime.snapshot(), done, "Repeated review is a no-op");
});

test("outcome review survives reload and failure; replanning cap leaves a proposed goal idle", async t => {
  const scenario = furnishedCourt(), runtime = new BrowserGameRuntime(scenario, "test");
  const active = runtime.snapshot(); active.npcActivities = { corvin: { status: "active", goal: "Find a way through.", history: [] } }; runtime.restore(active);
  runtime.finishNpcRun("corvin", "limit", "24 actions exhausted.");
  const pending = runtime.snapshot();
  const restored = new BrowserGameRuntime(scenario, "test", pending);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { throw new Error("Offline"); });
  await assert.rejects(restored.reviewNpcOutcome("corvin"), /Offline/);
  assert.deepEqual(restored.snapshot(), pending);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newNotes: [], relationships: [], lore: null, goalUpdate: {goal: "Go to the Great Hall.", reason: "Try later."} }));
  await restored.reviewNpcOutcome("corvin", false);
  assert.equal(restored.snapshot().npcActivities!.corvin!.status, "idle");
  assert.equal(restored.snapshot().npcActivities!.corvin!.reviewPending, false);
  assert.equal(fromJson(ScenarioSchema, restored.snapshot().scenario).characters[0]!.currentGoal, "Go to the Great Hall.");
  await assert.rejects(restored.planNpc("corvin", new AbortController().signal), /idle/);
});

test("treasury can be opened from the hall and closed from inside, with sides explicit to Jev", () => {
  const scenario = furnishedCourt(), actor = scenario.world!.actors.find(item => item.characterId === "corvin")!;
  actor.position = create(TilePositionSchema, { x: 68, y: 22 }); actor.roomId = "great_hall";
  scenario.characters.find(item => item.id === "corvin")!.currentGoal = "Go into the Treasury, close the door from inside, and wait there.";
  const runtime = new BrowserGameRuntime(scenario, "test"), snapshot = runtime.snapshot();
  snapshot.npcActivities = { corvin: { status: "active", goal: scenario.characters[0]!.currentGoal, history: [] } }; runtime.restore(snapshot);
  const observe = () => courtAgentObservation(fromJson(ScenarioSchema, runtime.snapshot().scenario), "corvin");
  let observation = observe();
  const open = observation.actions.find(action => action.id === "open_treasury_door_0")!;
  assert.ok(open); assert.equal(open.legality, "normal"); assert.equal(open.path.length, 1);
  assert.equal(open.interactionRoomId, "great_hall");
  assert.ok(!observation.actions.some(action => action.id === "enter_treasury"));
  runtime.executeNpcAction("corvin", open.id, observation.revision, observation.goal);
  observation = observe();
  assert.ok(observation.actions.some(action => action.id === "enter_treasury"));
  const outside = observation.actions.find(action => action.id === "close_treasury_door_0")!;
  assert.ok(!observation.actions.some(action => action.id === "close_treasury_door_1"));
  runtime.executeNpcAction("corvin", "enter_treasury", observation.revision, observation.goal);
  observation = observe();
  const inside = observation.actions.find(action => action.id === "close_treasury_door_1")!;
  assert.equal(outside.interactionRoomId, "great_hall");
  assert.equal(inside.interactionRoomId, "treasury");
  runtime.executeNpcAction("corvin", inside.id, observation.revision, observation.goal);
  const saved = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.equal(saved.world!.doors.find(door => door.id === "treasury_door")!.open, false);
  assert.equal(saved.world!.actors.find(item => item.characterId === "corvin")!.roomId, "treasury");
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
  await runtime.talkToCharacter("corvin", "Go to the Treasury.");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newNotes: [], relationships: [], lore: null, goalUpdate: { goal: "Go to the Treasury.", reason: "Agreed." } }));
  await runtime.endConversation("corvin");
  const before = runtime.snapshot();
  t.mock.method(JevClient.prototype, "choose", async () => { throw new Error("Rejected sk-test-secret"); });
  await assert.rejects(runtime.planNpc("corvin", new AbortController().signal), /Rejected/);
  runtime.restore(before);
  runtime.finishNpcRun("corvin", "error", "Request failed.");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newNotes: [], relationships: [], lore: null, goalUpdate: null }));
  await runtime.reviewNpcOutcome("corvin");
  const entries = runtime.recentTranscripts();
  assert.deepEqual(entries.map(entry => entry.kind), ["outcome_review", "jev", "conversation_review", "dialogue", "game_master"]);
  for (const entry of entries.filter(entry => entry.kind !== "jev")) {
    const messages = (entry.request as ChatCompletionRequest).messages;
    assert.equal(messages.filter(message => message.content === GM_BASE_PROMPT).length, entry.kind === "dialogue" ? 0 : 1);
    if (entry.kind !== "dialogue") assert.equal(messages[0]?.content, GM_BASE_PROMPT);
  }
  assert.equal(entries[1]!.status, "error");
  assert.match(entries[1]!.error!, /redacted/);
  assert.equal((entries[1]!.request as any).model, "typesafe/jev-1.13");
  assert.ok((entries[1]!.request as any).questions.next.criteria);
  assert.ok((entries[2]!.request as any).messages.length);
  assert.ok(entries.every(entry => typeof entry.durationMs === "number"));
  assert.doesNotMatch(JSON.stringify(entries), /sk-test-secret/);
  const runs = runtime.transcriptRuns();
  const keys = Object.keys(runs);
  assert.ok(keys.some(key => key.startsWith("game_master/gm/")));
  assert.ok(keys.some(key => key.startsWith("character/Magister%20Corvin/")));
  assert.ok(keys.some(key => key.startsWith("conversation_review/Magister%20Corvin/")));
  assert.ok(keys.some(key => key.startsWith("outcome_review/Magister%20Corvin/")));
  const conversation = Object.entries(runs).find(([key]) => key.startsWith("character/Magister%20Corvin/"))![1];
  assert.equal(conversation.status, "success");
  assert.equal((conversation.context as { messages: unknown[] }).messages.length, 2);
  assert.equal(conversation.calls[0]?.kind, "dialogue");
  assert.deepEqual(new BrowserGameRuntime(load(), "test", runtime.snapshot()).recentTranscripts(), [], "A fresh loaded session starts a new log");
});

test("transcript recorder shows pending calls, bounds history, and isolates mutable and secret data", async () => {
  const log = new ModelTranscripts("private-key");
  let finish!: (value: unknown) => void;
  const input = { prompt: "private-key" };
  const pending = log.record("dialogue", "corvin", input, () => new Promise(resolve => { finish = resolve; }));
  input.prompt = "changed after dispatch";
  assert.equal(log.recent()[0]!.status, "pending");
  assert.deepEqual(log.recent()[0]!.request, { prompt: "[redacted]" });
  finish({ text: "sk-another-secret" }); await pending;
  const copy = log.recent(); copy[0]!.status = "error";
  assert.equal(log.recent()[0]!.status, "success");
  assert.deepEqual(log.recent()[0]!.response, { text: "[redacted]" });
  for (let i = 0; i < 55; i++) await log.record("jev", "corvin", { i }, async () => ({ choice: "complete" }));
  assert.equal(log.recent().length, 50);
  assert.equal(log.recent()[0]!.id, 56);
  assert.equal(Object.keys(log.runs()).length, 50);
});

test("transcript recorder groups an agent loop under one stable dictionary key", async () => {
  const log = new ModelTranscripts("test");
  await log.group("conversation_review", "Magister Corvin", "corvin", async key => {
    await log.record("conversation_review", "corvin", { round: 1 }, async () => ({ tool_calls: [{}] }), key);
    await log.record("conversation_review", "corvin", { round: 2 }, async () => ({ content: "done" }), key);
  }, { participants: ["corvin"] });
  const entries = Object.entries(log.runs());
  assert.equal(entries.length, 1);
  assert.match(entries[0]![0], /^conversation_review\/Magister%20Corvin\/[0-9a-f-]+$/);
  assert.equal(entries[0]![1].status, "success");
  assert.equal(entries[0]![1].calls.length, 2);
  assert.deepEqual(entries[0]![1].context, { participants: ["corvin"] });
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
  snapshot.npcActivities = { corvin: { status: "active", goal: scenario.characters.find(item => item.id === "corvin")!.currentGoal, history: [] } };
  runtime.restore(snapshot);
  const observation = courtAgentObservation(scenario, "corvin");
  const action = observation.actions.find(item => item.type === "talk" && item.target !== scenario.playerCharacterId)!;
  assert.ok(action);
  return { scenario, runtime, observation, action };
}

test("Jev receives reachable NPC talk actions, then both participants save private memories and goals", async t => {
  const { scenario, runtime, observation, action } = talkingCourt();
  assert.ok(observation.actions.some(item => item.id === "talk_player"));
  assert.ok(!observation.actions.some(item => item.id === "talk_corvin"));
  assert.throws(() => runtime.executeNpcAction("corvin", action.id, observation.revision, observation.goal), /resolution/);
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => {
    calls++;
    if (calls === 1) return modelReply({ request: "Meet me in the Treasury.", intent: "Arrange a private discussion." });
    return modelReply({ summary: "They agree to meet in the Treasury.",
      initiator: { newNotes: [], relationships: [], lore: null, goalUpdate: null },
      recipient: { newNotes: [], relationships: [], lore: null, goalUpdate: { goal: "Walk to the Treasury.", reason: "Agreed to meet." } } });
  });
  await runtime.executeNpcTalk("corvin", action.id, observation.revision, observation.goal, new AbortController().signal);
  const saved = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.equal(calls, 2);
  assert.deepEqual(runtime.snapshot().npcActivities?.corvin?.actionIds, [action.id]);
  assert.equal(runtime.snapshot().npcActivities?.corvin?.status, "idle");
  assert.equal(runtime.snapshot().npcActivities?.[action.target]?.status, "active");
  assert.deepEqual(locatedItems(saved), locatedItems(scenario));
  const events = saved.notes.filter(item => item.text === "They agree to meet in the Treasury.");
  assert.equal(events.length, 2);
  assert.ok(events.every(item => item.characterIds.length === 1 && !item.characterIds.includes("player")));
  assert.deepEqual(runtime.recentTranscripts().map(item => item.kind), ["npc_resolution", "npc_request"]);
});

test("NPC talk review ignores an unscheduled recipient objective", async t => {
  const { runtime, observation, action } = talkingCourt();
  assert.ok(runtime.hasActiveObjective(action.target));
  assert.equal(runtime.snapshot().npcActivities?.[action.target], undefined);
  const fork = runtime.forkForResourceReview(async work => work());
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async (input: ChatCompletionRequest) => {
    calls++;
    if (calls === 1) return modelReply({ request: "What news?", intent: "Complete my greeting." });
    const tool = (name: string, args: unknown): OpenRouterMessage => ({
      role: "assistant", content: null, tool_calls: [{ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    });
    if (calls === 2) {
      const worldState = input.messages.map(message => {
        try { return JSON.parse(message.content || ""); } catch { return {}; }
      }).find(value => value.world_state).world_state;
      return tool("update_character", { character_id: "corvin", generation_id: worldState["character:corvin"].generation_id,
        changes: { active_objective: { action: "complete", reason: "Corvin greeted another courtier." } } });
    }
    if (calls === 3) return tool("finish_review", { summary: "Corvin exchanged greetings with another courtier." });
    throw new Error("Review should finish without changing the recipient's objective.");
  });

  await fork.executeNpcTalk("corvin", action.id, observation.revision, observation.goal, new AbortController().signal);

  assert.equal(calls, 3);
  assert.ok(runtime.hasActiveObjective(action.target));
  assert.equal(runtime.snapshot().npcActivities?.[action.target], undefined);
});

test("NPC-initiated player conversations remain open despite a premature model ending", async t => {
  const { scenario, runtime } = talkingCourt();
  let observation = courtAgentObservation(fromJson(ScenarioSchema, runtime.snapshot().scenario), "corvin");
  let playerAction = observation.actions.find(item => item.id === `talk_${scenario.playerCharacterId}`)!;
  assert.ok(playerAction, "the player is offered as a reachable talk target");
  while (playerAction.path.length > 2) {
    runtime.stepNpcAction("corvin", playerAction.id, observation.goal);
    observation = courtAgentObservation(fromJson(ScenarioSchema, runtime.snapshot().scenario), "corvin");
    playerAction = observation.actions.find(item => item.id === `talk_${scenario.playerCharacterId}`)!;
  }
  t.mock.method(OpenRouterClient.prototype, "complete", async (_request: unknown) => modelReply({
    utterance: "Envoy, a private word about the succession.",
    replyOptions: ["Speak plainly.", "Not now."],
    endConversation: true,
  }));

  const utterance = await runtime.initiatePlayerConversation("corvin", playerAction.id, observation.revision,
    scenario.characters.find(item => item.id === "corvin")!.currentGoal, new AbortController().signal);

  assert.deepEqual(runtime.snapshot().npcActivities?.corvin?.actionIds, [playerAction.id]);
  assert.equal(utterance, "Envoy, a private word about the succession.");
  assert.deepEqual(runtime.view().conversations, { corvin: [{ role: "character", text: utterance }] });
  assert.deepEqual(runtime.view().conversationReplyOptions, { corvin: ["Speak plainly.", "Not now."] });
  assert.deepEqual(runtime.snapshot().conversationEndRequested, { corvin: false });
  assert.equal(runtime.snapshot().npcActivities?.corvin?.status, "active", "the NPC's task pauses until the conversation is reviewed");
});

test("NPC conversation validation and cancellation cannot partially update either character", async t => {
  const { runtime, observation, action } = talkingCourt();
  const before = runtime.snapshot();
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ++calls % 2 === 1
    ? modelReply({ request: "Hello", intent: "Greet them" })
    : modelReply({ summary: "A greeting", initiator: { newNotes: ["Must not persist"], relationships: [], lore: null, goalUpdate: null }, recipient: { newNotes: [], relationships: [{ characterId: "unknown", description: "Invalid" }], lore: null, goalUpdate: null } }));
  await assert.rejects(runtime.executeNpcTalk("corvin", action.id, observation.revision, observation.goal, new AbortController().signal), /relationship/);
  assert.deepEqual(runtime.snapshot(), before);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runtime.executeNpcTalk("corvin", action.id, observation.revision, observation.goal, controller.signal), /abort/i);
  assert.deepEqual(runtime.snapshot(), before);
});

test("talk availability follows closed doors and Jev gets the offered talk choice", async t => {
  const { scenario, runtime, observation, action } = talkingCourt();
  t.mock.method(JevClient.prototype, "choose", async (_state: unknown, instructions: unknown, criteria: Record<string, string>) => {
    assert.ok(action.id in criteria);
    assert.match(JSON.stringify(instructions), /Choose one offered action ID/);
    return { choice: action.id, probabilities: { [action.id]: 1 } };
  });
  const plan = await runtime.planNpc("corvin", new AbortController().signal);
  assert.equal(plan.action?.type, "talk");
  const recipient = scenario.world!.actors.find(item => item.characterId === action.target)!;
  recipient.position = create(TilePositionSchema, { x: 51, y: 5 }); recipient.roomId = "corvin_chamber";
  for (const door of scenario.world!.doors) door.open = false;
  assert.ok(!courtAgentObservation(scenario, "corvin").actions.some(item => item.id === action.id));
  for (const door of scenario.world!.doors) door.open = true;
  assert.ok(!courtAgentObservation(scenario, "corvin").actions.some(item => item.id === action.id), "Remote characters require entering their room first");
  assert.ok(observation.actions.some(item => item.id === action.id));
});

test("resetCharacters restores authored NPCs and notes, clears dialogue and tasks, and preserves player and physical world", async t => {
  const initial = load(), scenario = furnishedCourt();
  const corvin = scenario.characters.find(item => item.id === "corvin")!;
  corvin.lore = "Changed biography"; corvin.currentGoal = "Search the Treasury";
  const runtime = new BrowserGameRuntime(initial, "test", new BrowserGameRuntime(scenario, "test").snapshot());
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Goodbye", endConversation: true, replyOptions: [] }));
  await runtime.talkToCharacter("corvin", "Hello");
  const snapshot = runtime.snapshot();
  snapshot.npcActivities = { corvin: { status: "active", goal: "Search the Treasury", history: ["An old action"] } };
  const changed = fromJson(ScenarioSchema, snapshot.scenario);
  changed.notes.push(create(NoteSchema, { id: "learned", text: "A learned fact", characterIds: ["corvin"] }));
  snapshot.scenario = toJson(ScenarioSchema, changed);
  runtime.restore(snapshot);
  const before = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  runtime.resetCharacters();
  const after = runtime.snapshot(), saved = fromJson(ScenarioSchema, after.scenario);
  const authored = fromJson(ScenarioSchema, new BrowserGameRuntime(initial, "test").snapshot().scenario);
  assert.deepEqual(saved.characters.find(item => item.id === "corvin"), authored.characters.find(item => item.id === "corvin"));
  assert.deepEqual(saved.characters.find(item => item.id === "player"), before.characters.find(item => item.id === "player"));
  assert.deepEqual(saved.notes, initial.notes);
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
  const world = scenario.world!;
  const locations = new Set([...ids, ...world.fixtures.map(item => item.id), ...scenario.characters.map(item => item.id)]);
  const objects = new Set(locatedItems(scenario).map(item => item.id));
  assert.equal(objects.size, locatedItems(scenario).length, "Object IDs must be unique");
  for (const item of locatedItems(scenario)) assert.ok(locations.has(item.locationId), `${item.id} is in a nonexistent container or location ${item.locationId}`);
  for (const fixture of world.fixtures) if (fixture.requiredKeyId) assert.ok(objects.has(fixture.requiredKeyId), `${fixture.id} needs a missing key`);
  assert.doesNotMatch(JSON.stringify(scenario), /chapel/i);
});

test("each visiting delegation has a public room, private back hall and individual quarters", () => {
  const scenario = load(), world = scenario.world!;
  const delegations = [
    { publicRoom: "ironmark_salon", publicPoint: { x: 36, y: 11 }, backHall: "ironmark_back_hall",
      members: ["mara", "hadrik", "tessa"] },
    { publicRoom: "greenweald_solar", publicPoint: { x: 36, y: 26 }, backHall: "greenweald_back_hall",
      members: ["elinor", "oswin", "rowan"] },
    { publicRoom: "saltmere_drawing_room", publicPoint: { x: 87, y: 11 }, backHall: "saltmere_back_hall",
      members: ["lucan", "sabine", "rook"] },
  ];
  const openDoors = world.doors.map(door => ({ ...door, open: true }));
  for (const delegation of delegations) {
    assert.equal(courtRoomAt(delegation.publicPoint)?.id, delegation.publicRoom);
    assert.ok(courtPath({ x: 61, y: 24 }, delegation.publicPoint, world.doors, world.fixtures));
    const backHall = world.rooms.find(room => room.id === delegation.backHall)!;
    assert.equal(backHall.private, true);
    assert.deepEqual([...backHall.allowedCharacterIds].sort(), [...delegation.members].sort());
    for (const member of delegation.members) {
      const actor = world.actors.find(actor => actor.characterId === member)!;
      assert.equal(actor.homeRoomId, `${member}_chamber`);
      assert.equal(actor.roomId, actor.homeRoomId);
      assert.equal(courtRoomAt(actor.position!)?.id, actor.homeRoomId);
      assert.ok(courtPath({ x: 61, y: 24 }, actor.position!, openDoors, world.fixtures), `${member}'s room is reachable`);
    }
  }
  for (const placement of scenario.courtArrivalPlacements) assert.equal(placement.roomId, "great_hall");
});

test("the royal household has a public council chamber, private back hall and meeting-room doors", () => {
  const scenario = load(), world = scenario.world!;
  const council = world.rooms.find(room => room.id === "royal_council_chamber")!;
  const backHall = world.rooms.find(room => room.id === "north_corridor")!;
  assert.equal(council.name, "Royal Council Chamber");
  assert.equal(backHall.name, "Royal Back Hall");
  assert.equal(backHall.private, true);
  assert.deepEqual([...backHall.allowedCharacterIds].sort(), ["corvin", "garran", "king"]);
  const meetingDoors = ["royal_council_door", "ironmark_salon_door", "greenweald_solar_door", "saltmere_drawing_room_door"];
  for (const id of meetingDoors) {
    const door = world.doors.find(door => door.id === id)!;
    assert.ok(door, `${id} exists`);
    assert.equal(door.open, true, `${id} starts open`);
  }
  assert.ok(courtPath({ x: 61, y: 24 }, { x: 51, y: 17 }, world.doors, world.fixtures));
  assert.equal(courtPath({ x: 61, y: 24 }, { x: 61, y: 12 }, world.doors, world.fixtures), undefined);
  const openDoors = world.doors.map(door => door.id === "hall_door" ? { ...door, open: true } : door);
  assert.ok(courtPath({ x: 61, y: 24 }, { x: 61, y: 12 }, openDoors, world.fixtures));
});

test("GPT-6 Responses adapter preserves tool history and encrypted reasoning across DM turns", async t => {
  const output = [
    { type: "reasoning", id: "rs_test", summary: [], encrypted_content: "opaque" },
    { type: "function_call", id: "fc_test", call_id: "call_test", name: "offer_replies", arguments: '{"options":["Hello"],"compelled":false}' },
  ];
  let count = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://openrouter.ai/api/v1/responses");
    const body = JSON.parse(String(init.body));
    assert.equal(body.store, false);
    assert.deepEqual(body.reasoning, { effort: "medium" });
    assert.equal(body.max_output_tokens, 8000);
    assert.ok(!("temperature" in body));
    assert.deepEqual(body.tools[0], { type: "function", name: "offer_replies", description: "Offer choices", parameters: { type: "object" }, strict: false });
    if (++count === 2) {
      assert.deepEqual(body.input.slice(1, 3), output);
      assert.deepEqual(body.input[3], { type: "function_call_output", call_id: "call_test", output: '{"ok":true}' });
    }
    return new Response(JSON.stringify({ status: "completed", output: count === 1 ? output : [{ type: "message", content: [{ type: "output_text", text: "Welcome" }] }] }), { status: 200 });
  });
  const client = Object.assign(new OpenRouterClient("test"), { complete: originalOpenRouterComplete });
  const settings = { model: "openai/gpt-6-sol", api: "responses" as const, reasoning: { effort: "medium" as const }, max_tokens: 8000,
    tools: [{ type: "function" as const, function: { name: "offer_replies", description: "Offer choices", parameters: { type: "object" } } }] };
  const user = { role: "user" as const, content: "Hello" };
  const first = await client.complete({ ...settings, messages: [user] });
  assert.equal(first.tool_calls?.[0]?.id, "call_test");
  const second = await client.complete({ ...settings, messages: [user, first, { role: "tool", tool_call_id: "call_test", content: '{"ok":true}' }] });
  assert.equal(second.content, "Welcome");
});

test("GPT-6 Responses adapter maps structured output and rejects truncated results", async t => {
  let truncated = false;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.text.format, { type: "json_schema", name: "test", strict: true, schema: { type: "object" } });
    assert.deepEqual(body.reasoning, { effort: "none" });
    return new Response(JSON.stringify(truncated ? { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }
      : { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"utterance":"Hello"}' }] }] }), { status: 200 });
  });
  const request = { model: "openai/gpt-6-luna", api: "responses" as const, reasoning: { effort: "none" as const }, messages: [{ role: "user" as const, content: "Hello" }],
    response_format: { type: "json_schema", json_schema: { name: "test", strict: true, schema: { type: "object" } } } };
  assert.equal((await Object.assign(new OpenRouterClient("test"), { complete: originalOpenRouterComplete }).complete(request)).content, '{"utterance":"Hello"}');
  truncated = true;
  await assert.rejects(Object.assign(new OpenRouterClient("test"), { complete: originalOpenRouterComplete }).complete(request), /incomplete: max_output_tokens/);
});

test("background NPC review merges its memories without undoing concurrent player movement or items", async t => {
  const { runtime, action } = talkingCourt();
  runtime.finishNpcRun("corvin", "complete", "Arrived.");
  const before = runtime.snapshot(), fork = runtime.forkForNpc();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(OpenRouterClient.prototype, "complete", async () => {
    await waiting;
    return modelReply({ newNotes: ["I have arrived."], relationships: [], lore: null, goalUpdate: null });
  });
  const review = fork.reviewNpcOutcome("corvin");
  runtime.movePlayer({ x: 66, y: 21 });
  runtime.interactFixture("open_palace_hall_cabinet");
  runtime.interactFixture("take_palace_iron_key");
  release(); await review;
  runtime.commitCharacterFork(before, fork, ["corvin"]);
  const after = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.deepEqual(after.world!.actors.find(a => a.characterId === "player")!.position, create(TilePositionSchema, { x: 66, y: 21 }));
  assert.equal(locatedItems(after).find(o => o.id === "palace_iron_key")!.locationId, "player");
  assert.ok(after.notes.some(e => e.text === "I have arrived."));
  assert.equal(runtime.snapshot().npcActivities?.corvin?.reviewPending, false);
  assert.ok(action.target);
});

test("background character updates reject stale goals and do not overwrite newer conversations", async t => {
  const { runtime } = talkingCourt();
  const before = runtime.snapshot(), fork = runtime.forkForNpc();
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Hello", replyOptions: [], endConversation: false }));
  await fork.talkToCharacter("corvin", "First request");
  await runtime.talkToCharacter("corvin", "Newer request");
  const latest = runtime.snapshot();
  assert.throws(() => runtime.commitCharacterFork(before, fork, ["corvin"]), /changed/);
  assert.deepEqual(runtime.snapshot(), latest);
});

test("NPC movement commits one tile at a time and replans when a door closes", () => {
  const { runtime } = talkingCourt();
  const initial = runtime.snapshot();
  const scenario = fromJson(ScenarioSchema, initial.scenario);
  const actor = scenario.world!.actors.find(a => a.characterId === "corvin")!;
  actor.position = create(TilePositionSchema, { x: 51, y: 17 }); actor.roomId = "royal_council_chamber";
  scenario.world!.doors.find(d => d.id === "hall_door")!.open = true;
  initial.scenario = toJson(ScenarioSchema, scenario); runtime.restore(initial);
  const goal = scenario.characters.find(c => c.id === "corvin")!.currentGoal;
  const result = runtime.stepNpcAction("corvin", "enter_north_corridor", goal);
  assert.equal(result.done, false);
  const moved = fromJson(ScenarioSchema, runtime.snapshot().scenario).world!.actors.find(a => a.characterId === "corvin")!.position!;
  assert.equal(Math.abs(moved.x - 51) + Math.abs(moved.y - 17), 1);
  const closed = runtime.snapshot(), changed = fromJson(ScenarioSchema, closed.scenario);
  changed.world!.doors.find(d => d.id === "hall_door")!.open = false;
  closed.scenario = toJson(ScenarioSchema, changed); runtime.restore(closed);
  assert.throws(() => runtime.stepNpcAction("corvin", "enter_north_corridor", goal), /replan/);
  assert.deepEqual(fromJson(ScenarioSchema, runtime.snapshot().scenario).world!.actors.find(a => a.characterId === "corvin")!.position, moved);
});

test("centennial court has consistent actors and relationships without the possession plot", () => {
  const scenario = load(), world = scenario.world!;
  const ids = scenario.characters.map(character => character.id);
  assert.deepEqual(world.actors.map(actor => actor.characterId).sort(), [...ids].sort());
  assert.equal(new Set(scenario.courtArrivalPlacements.map(item => item.characterId)).size, ids.length + 1);
  for (const character of scenario.characters) {
    assert.ok(character.relationships.every(item => ids.includes(item.characterId) && item.characterId !== character.id));
    const actor = world.actors.find(item => item.characterId === character.id)!;
    assert.ok(world.rooms.some(room => room.id === actor.homeRoomId));
  }
  const placements = scenario.courtArrivalPlacements.map(item => ({ id: item.characterId, name: item.characterId, roomId: item.roomId, position: item.position! }));
  const markers = courtMarkers(placements, world.fixtures);
  assert.ok(markers.every(marker => marker.point), "Every delegate has a walkable tile clear of furniture");
  assert.equal(new Set(markers.map(marker => pointKey(marker.point!))).size, ids.length + 1);
  assert.doesNotMatch(toJsonString(ScenarioSchema, scenario), /Crown of Winter|solstice|merlin|lancelot|take_crown/i);
  assert.match(scenario.premise, /Every hundred years/);
  assert.match(scenario.premise, /Ordinary inheritance/);
  assert.match(scenario.premise, /Recognition by all three is required/);
  assert.match(scenario.premise, /without an accepted common sovereign/);
  assert.ok(!locatedItems(scenario).some(item => item.id === "crown"));
});

test("delegations receive shared politics without learning private debts or suspected missing pay", () => {
  const scenario = load();
  const context = (id: string) => new FullContextBuilder().build(create(DialogueRequestSchema, { scenario, characterId: id })).map(message => message.content).join("\n");
  for (const id of ["mara", "elinor", "sabine"]) {
    assert.match(context(id), /Edric the Peacemaker/);
    assert.match(context(id), /Ironmark grain convoy/);
    assert.doesNotMatch(context(id), /privately mortgaged much|unexplained gaps in garrison pay|still receives a share of illicit/);
  }
  assert.match(context("lucan"), /privately mortgaged much/);
  assert.match(context("tessa"), /unexplained gaps in garrison pay/);
  assert.match(context("rook"), /still receives a share of illicit/);
});

test("GM tool schemas follow a scenario's roster, including additional delegates", async t => {
  const scenario = load();
  scenario.characters.push(create(CharacterSchema, { id: "new_envoy", name: "New envoy" }));
  const ids = scenario.characters.map(character => character.id);
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: any) => {
    const properties = request.tools.find((tool: any) => tool.function.name === "create_player").function.parameters.properties;
    for (const key of ["relationships", "npcViews"]) {
      assert.equal(properties[key].minItems, ids.length);
      assert.equal(properties[key].maxItems, ids.length);
      assert.deepEqual(properties[key].items.properties.characterId.enum, ids);
    }
    const update = request.tools.find((tool: any) => tool.function.name === "update_character");
    assert.deepEqual(update.function.parameters.properties.characterId.enum, ids);
    return { role: "assistant", content: "What brings you to the assembly?" };
  });
  await new BrowserGameRuntime(scenario, "test").talkToGameMaster("Greetings.");
});

// Exercise the new introduction independently of network responses or browser credentials.
import { introductionHandoff, validateIdentity, characterSprites } from "../apps/web/src/introduction.js";

test("legacy introduction handoff preserves a delegation's witness role", () => {
  const handoff = introductionHandoff({ name: "Seren", delegation: "Saltmere", gender: "Non-binary", sprite: 99 });
  assert.match(handoff, /Saltmere/);
  assert.match(handoff, /not the delegation's mandated recognition bearer/);
  assert.match(handoff, /Non-binary/);
});

test("identity rejects unsupported delegations, invalid sprites and blank fields without saving partial choices", () => {
  const runtime = new BrowserGameRuntime(load(), "test");
  const identity = { name: "  Seren  ", gender: "  Non-binary  ", delegation: "Greenweald", sprite: 87 };
  assert.deepEqual(validateIdentity(identity), { ...identity, name: "Seren", gender: "Non-binary" });
  for (const invalid of [{ ...identity, delegation: "Caerwyn" }, { ...identity, sprite: -1 }, { ...identity, sprite: 999 }, { ...identity, gender: " " }, { ...identity, name: " " }]) {
    assert.throws(() => runtime.setTravellerIdentity(invalid));
    assert.equal(runtime.snapshot().travellerIdentity, undefined);
  }
  runtime.setTravellerIdentity(identity);
  runtime.reset();
  assert.equal(runtime.snapshot().travellerIdentity, undefined);
});

test("each delegation keeps its identity through a persistent editable review before court entry", async t => {
  const scenario = load(), ids = scenario.characters.map(character => character.id);
  const generated = {
    build: interviewBuild,
    name: "A name the model must not substitute", homeland: "Some other kingdom", embassyRole: "Envoy",
    lore: "A traveller with a modest history.", currentGoal: "Secure food for my home town.",
    relationships: ids.map(characterId => ({ characterId, description: "I have not met them before." })),
    npcViews: ids.map(characterId => ({ characterId, description: "A visiting witness." })),
  };
  let requests = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: any) => {
    requests++;
    assert.match(JSON.stringify(request.messages), /Chosen identity/);
    return { role: "assistant", content: null, tool_calls: [{ id: "create", type: "function", function: { name: "create_player", arguments: JSON.stringify(generated) } }] };
  });
  for (const [index, delegation] of ["Ironmark", "Greenweald", "Saltmere"].entries()) {
    const identity = { name: `Envoy ${index}`, delegation, gender: "Non-binary", sprite: characterSprites[index]! };
    const initial = new BrowserGameRuntime(scenario, "test");
    initial.setTravellerIdentity(identity);
    const runtime = new BrowserGameRuntime(scenario, "test", structuredClone(initial.snapshot()));
    assert.deepEqual(runtime.view().travellerIdentity, identity);
    await runtime.talkToGameMaster("I am ready to enter court.");
    assert.equal(runtime.view().phase, "character_review");
    assert.equal(runtime.view().day, 0);
    assert.equal(runtime.view().player, null);
    const review = new BrowserGameRuntime(scenario, "test", structuredClone(runtime.snapshot()));
    const draft = structuredClone(review.snapshot().playerDraft) as any;
    assert.equal(draft.player.name, identity.name);
    assert.equal(draft.player.gender, identity.gender);
    assert.equal(draft.player.sprite, identity.sprite);
    assert.equal(draft.player.delegation, identity.delegation);
    const invalidDraft = structuredClone(draft);
    invalidDraft.player.gender = " ";
    assert.throws(() => review.confirmPlayer(invalidDraft), /gender/);
    assert.equal(review.view().phase, "character_review");
    if (index === 2) {
      identity.name = "Corrected Envoy"; identity.gender = "Man"; identity.sprite = 99;
      draft.player.name = identity.name; draft.player.gender = identity.gender; draft.player.sprite = identity.sprite;
    }
    draft.player.lore = "My corrected background.";
    draft.player.currentGoal = "Return home safely.";
    review.confirmPlayer(draft);
    runtime.restore(review.snapshot());
    assert.equal(runtime.view().phase, "conversations");
    assert.equal(runtime.snapshot().playerDraft, null);
    const restored = new BrowserGameRuntime(scenario, "test", structuredClone(runtime.snapshot()));
    const saved = fromJson(ScenarioSchema, restored.snapshot().scenario);
    const player = saved.characters.find(character => character.id === "player")!;
    assert.equal(player.name, identity.name);
    assert.equal(player.lore, "My corrected background.");
    assert.equal(player.currentGoal, "Return home safely.");
    assert.equal(player.gender, identity.gender);
    assert.equal(player.delegation, delegation);
    assert.equal(player.sprite, identity.sprite);
    const marker = courtMarkers([restored.view().player as any], saved.world!.fixtures)[0]!;
    assert.equal(marker.sprite, identity.sprite);
    assert.ok(marker.point);
    assert.equal(saved.world!.actors.length, 13);
    assert.ok(saved.notes.filter(note => note.id.startsWith("arrival-")).every(note => note.text.includes(`from ${delegation}`)));
    assert.throws(() => restored.setTravellerIdentity(identity), /already begun/);
    const prompt = new FullContextBuilder().build(create(DialogueRequestSchema, { scenario: saved, characterId: "mara" })).map(message => message.content).join("\n");
    assert.match(prompt, /Visiting player’s public identity/);
    assert.ok(prompt.includes(identity.gender));
    assert.doesNotMatch(prompt, /My corrected background/, "Private player biography is not shared as public identity");
    restored.resetWorld(); restored.resetCharacters();
    assert.equal((restored.view().player as any).sprite, identity.sprite);
  }
  assert.equal(requests, 3);
});

test("failed Stranger calls retain saved identity and can resume after reload", async t => {
  const scenario = load(), runtime = new BrowserGameRuntime(scenario, "test");
  const identity = { name: "Maren", gender: "Woman", delegation: "Ironmark", sprite: 99 };
  runtime.setTravellerIdentity(identity);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { throw new Error("Offline"); });
  await assert.rejects(runtime.talkToGameMaster(introductionHandoff(identity)), /Offline/);
  const restored = new BrowserGameRuntime(scenario, "test", structuredClone(runtime.snapshot()));
  assert.equal(restored.view().phase, "player_creation");
  assert.deepEqual(restored.view().travellerIdentity, identity);
  assert.equal(restored.snapshot().gameMasterHistory.length, 0);
  assert.equal(restored.view().player, null);
});

test("worker saves identity and reaches the Stranger without nesting its mutation queue", { timeout: 10000 }, async t => {
  const globals = globalThis as any;
  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
  const originalDatabase = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  t.after(() => {
    if (originalSelf) Object.defineProperty(globalThis, "self", originalSelf); else delete globals.self;
    if (originalDatabase) Object.defineProperty(globalThis, "indexedDB", originalDatabase); else delete globals.indexedDB;
  });
  let listener: (event: { data: unknown }) => void = () => {};
  let sequence = 0, failNextWrite = false, modelCalls = 0;
  const pending = new Map<number, (message: any) => void>();
  const npcUpdates: any[] = [];
  const diceMessages: any[] = [];
  const records = new Map<string, any>();
  globals.self = {
    addEventListener: (_type: string, callback: typeof listener) => { listener = callback; },
    postMessage: (message: any) => { if (message.type === "npc_update") npcUpdates.push(message); if (message.type === "conversation_roll") diceMessages.push(message); pending.get(message.id)?.(message); },
  };
  // Minimal asynchronous IDB boundary: the real worker dispatch/queue and runtime
  // run unchanged, while persistence and model transport remain deterministic.
  const db = {
    close() {},
    transaction(_store: string, mode: string) {
      const fail = mode === "readwrite" && failNextWrite;
      if (fail) failNextWrite = false;
      const tx: any = { error: new Error("Test storage failure"), objectStore: () => ({
        getAll: () => ({ result: structuredClone([...records.values()]) }),
        get: (id: string) => ({ result: structuredClone(records.get(id)) }),
        put: (record: any) => { if (!fail) records.set(record.id, structuredClone(record)); return { result: record.id }; },
      }) };
      setImmediate(() => { if (fail) tx.onabort(); else tx.oncomplete(); });
      return tx;
    },
  };
  globals.indexedDB = { open: () => { const request: any = { result: db }; setImmediate(() => request.onsuccess()); return request; } };
  t.mock.method(globalThis, "fetch", async () => new Response(readFileSync(fixturePath, "utf8")));
  t.mock.method(OpenRouterClient.prototype, "complete", async () => { modelCalls++; return { role: "assistant", content: "Maren, what brings you along this road?" }; });
  await import("../apps/web/src/game.worker.js");
  let assessWorldEvent = async (_event: Event, _signal: AbortSignal) => ({ reactions: [] });
  t.mock.method(BrowserGameRuntime.prototype, "assessWorldEvent", (event: Event, signal: AbortSignal) => assessWorldEvent(event, signal));
  const request = (type: string, payload: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Worker ${type} did not settle`)); }, 1000);
    pending.set(id, message => { clearTimeout(timer); pending.delete(id); if (message.ok) resolve(message.value); else reject(new Error(message.error)); });
    listener({ data: { id, type, payload } });
  });
  await request("configure", { apiKey: "test" });
  await request("create_game");
  const identity = { name: "Maren", gender: "Woman", delegation: "Saltmere", sprite: 99 };
  failNextWrite = true;
  await assert.rejects(request("set_identity", { identity }), /Test storage failure/);
  assert.equal((await request("state")).state.travellerIdentity, null);
  const selected = await request("set_identity", { identity });
  assert.deepEqual(selected.state.travellerIdentity, identity);
  assert.deepEqual([...records.values()][0].snapshot.travellerIdentity, identity);
  assert.equal(selected.saves[0].characterName, identity.name);
  const greeting = await request("gm", { message: introductionHandoff(identity) });
  assert.match(greeting.reply, /Maren/);
  assert.equal(modelCalls, 1);
  assert.equal(greeting.state.phase, "player_creation");

  const fresh = await request("create_game");
  failNextWrite = true;
  await assert.rejects(request("start_introduction"), /Test storage failure/);
  assert.deepEqual((await request("state")).state.gmMessages, []);
  const introduction = await request("start_introduction");
  assert.equal(modelCalls, 1, "The authored opening does not use a model call");
  assert.equal(introduction.state.travellerIdentity, null);
  const resumed = await request("load_game", { saveId: fresh.activeSaveId });
  assert.deepEqual(resumed.state.gmMessages, introduction.state.gmMessages);
  assert.deepEqual((await request("start_introduction")).state.gmMessages, introduction.state.gmMessages);

  await t.test("Stranger expression classification never holds the mutation queue", async t => {
    let started!: () => void, finish!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    t.mock.method(BrowserGameRuntime.prototype, "classifyStrangerExpression", async () => {
      started(); await blocked; return "amused";
    });
    const classification = request("stranger_expression");
    try {
      await entered;
      assert.equal((await request("state")).state.phase, "player_creation");
    } finally { finish(); }
    assert.equal((await classification).expression, "amused");
  });

  await t.test("physical interactions respond before background earshot assessment finishes", async t => {
    const created = await request("create_development_game");
    let assessmentStarted!: () => void, releaseAssessment!: () => void;
    const started = new Promise<void>(resolve => { assessmentStarted = resolve; });
    const blocked = new Promise<void>(resolve => { releaseAssessment = resolve; });
    assessWorldEvent = async () => { assessmentStarted(); await blocked; return { reactions: [] }; };
    t.mock.method(BrowserGameRuntime.prototype, "setDoor", function (this: BrowserGameRuntime) {
      return this.worldEvent("using a door", "The envoy opened a door.", ["player"]);
    });
    try {
      const response = await request("set_door", { id: "test-door", open: true, generations: created.state.generations });
      assert.ok(response.state, "The physical response should arrive while assessment is still blocked");
      await started;
    } finally {
      releaseAssessment();
      assessWorldEvent = async () => ({ reactions: [] });
    }
    await new Promise(resolve => setImmediate(resolve));
  });

  await t.test("NPC plans overlap, deduplicate, and cancel independently while player commands remain available", async t => {
    const created = await request("create_development_game");
    const saved = records.get(created.activeSaveId);
    saved.snapshot.npcActivities = Object.fromEntries(["corvin", "mara"].map(id => [id, { status: "active", goal: "Wait here.", history: [] }]));
    await request("load_game", { saveId: created.activeSaveId });
    const plans: Array<{ id: string; signal: AbortSignal; release: () => void }> = [];
    t.mock.method(BrowserGameRuntime.prototype, "planNpc", async (id: string, signal: AbortSignal) => {
      await new Promise<void>(resolve => plans.push({ id, signal, release: resolve }));
      // Deliberately ignore cancellation until the transport finishes. An old
      // completion must not remove a replacement run with the same character.
      signal.throwIfAborted();
      throw new Error("Unexpected uncancelled plan");
    });
    await request("start_npc", { characterId: "corvin" });
    await request("start_npc", { characterId: "mara" });
    await request("start_npc", { characterId: "corvin" });
    assert.deepEqual(plans.map(plan => plan.id), ["corvin", "mara"]);
    assert.deepEqual(npcUpdates.at(-1).running.sort(), ["corvin", "mara"]);
    await request("move_player", { x: 61, y: 24, generations: (await request("state")).state.generations });
    await request("pause_npc", { characterId: "corvin" });
    assert.equal(plans[0]!.signal.aborted, true);
    assert.equal(plans[1]!.signal.aborted, false);
    assert.deepEqual(npcUpdates.at(-1).running, ["mara"]);
    await request("start_npc", { characterId: "corvin" });
    plans[0]!.release();
    await new Promise(resolve => setImmediate(resolve));
    await request("start_npc", { characterId: "corvin" });
    assert.equal(plans.length, 3, "Old completion must not clear the replacement run");
    await request("cancel_npc");
    assert.ok(plans.every(plan => plan.signal.aborted));
    assert.deepEqual(npcUpdates.at(-1).running, []);
    for (const plan of plans) plan.release();
    await new Promise(resolve => setImmediate(resolve));
    await request("start_npc", { characterId: "mara" });
    await request("create_development_game");
    assert.equal(plans.at(-1)!.signal.aborted, true, "Game replacement cancels every old run");
    plans.at(-1)!.release();
    await new Promise(resolve => setImmediate(resolve));
  });

  await t.test("NPC conversations reserve a pair and restart an interrupted solo run after review", async t => {
    const created = await request("create_development_game");
    const saved = records.get(created.activeSaveId);
    saved.snapshot.npcActivities = Object.fromEntries(["corvin", "mara"].map(id => [id, { status: "active", goal: "Ask for news.", history: [] }]));
    await request("load_game", { saveId: created.activeSaveId });
    const plans: Array<{ id: string; signal: AbortSignal; release: (value: any) => void }> = [];
    t.mock.method(BrowserGameRuntime.prototype, "planNpc", (id: string, signal: AbortSignal) => new Promise<any>(resolve => plans.push({ id, signal, release: resolve })));
    t.mock.method(BrowserGameRuntime.prototype, "stepNpcAction", () => ({ done: true, talkTarget: "mara", generations: {} }));
    let releaseTalk!: () => void, releaseReview!: () => void;
    let talkStarted!: () => void, reviewStarted!: () => void;
    const talking = new Promise<void>(resolve => { talkStarted = resolve; });
    const reviewing = new Promise<void>(resolve => { reviewStarted = resolve; });
    t.mock.method(BrowserGameRuntime.prototype, "executeNpcTalk", async () => {
      talkStarted(); await new Promise<void>(resolve => { releaseTalk = resolve; });
      reviewStarted(); await new Promise<void>(resolve => { releaseReview = resolve; });
      return "News exchanged.";
    });
    await request("start_npc", { characterId: "mara" });
    await request("start_npc", { characterId: "corvin" });
    plans[1]!.release({ decision: { choice: "talk_mara" }, action: { id: "talk_mara", description: "Talk to Mara" }, goal: "Ask for news.", generations: {} });
    await talking;
    assert.equal(plans[0]!.signal.aborted, true);
    await request("start_npc", { characterId: "mara" });
    assert.equal(plans.length, 2, "A reserved target cannot start another solo run");
    releaseTalk(); await reviewing;
    await request("start_npc", { characterId: "mara" });
    assert.equal(plans.length, 2, "The reservation lasts through GM publication");
    releaseReview();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(plans.slice(2).map(plan => plan.id).sort(), ["corvin", "mara"]);
    await request("cancel_npc");
    for (const plan of plans) plan.release({});
    await new Promise(resolve => setImmediate(resolve));
  });

  await t.test("active objectives continue beyond three goal reviews and stop on completion", { timeout: 4000 }, async t => {
    const created = await request("create_development_game"), saved = records.get(created.activeSaveId);
    const scenario = fromJson(ScenarioSchema, saved.snapshot.scenario);
    const character = scenario.characters.find(character => character.id === "corvin")!;
    character.currentGoal = "Step 1";
    character.activeObjective = create(ActiveObjectiveSchema, { name: "Gather delegates", status: "Four invitations remain.",
      successCriteria: "All invitations delivered.", currentGoal: "Step 1" });
    saved.snapshot.scenario = toJson(ScenarioSchema, scenario);
    saved.snapshot.npcActivities = { corvin: { status: "active", goal: "Step 1", history: [] } };
    await request("load_game", { saveId: created.activeSaveId });
    let goals = 0;
    t.mock.method(BrowserGameRuntime.prototype, "planNpc", async () => {
      assert.ok(++goals <= 4, "Must stop after the objective is completed");
      return { decision: { choice: "complete" } };
    });
    t.mock.method(OpenRouterClient.prototype, "complete", async (input: any) => {
      const tool = (name: string, args: unknown) => ({ role: "assistant", content: null, tool_calls: [
        { id: name, type: "function", function: { name, arguments: JSON.stringify(args) } },
      ] });
      if (input.messages.at(-1).role === "tool") return tool("finish_review", { summary: "Reviewed progress." });
      const resource = input.messages.map((message: any) => { try { return JSON.parse(message.content); } catch { return {}; } })
        .find((value: any) => value.world_state).world_state["character:corvin"];
      return tool("update_character", { character_id: "corvin", generation_id: resource.generation_id, changes: { active_objective:
        goals === 4 ? { action: "complete", reason: "All four invitations delivered." }
          : { action: "set", name: "Gather delegates", status: goals + " invitations delivered; continue to the next delegate.",
            success_criteria: "All invitations delivered.", current_goal: "Step " + (goals + 1), reason: "More invitations remain." } } });
    });
    await request("start_npc", { characterId: "corvin" });
    while ((await request("debug_character", { characterId: "corvin" })).character.activeObjective
      || npcUpdates.at(-1)?.running.includes("corvin")) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(goals, 4);
    assert.equal((await request("state")).state.npcActivities.corvin.status, "idle");
    await request("cancel_npc");
  });

  await t.test("busy conversation targets wait without repeated model decisions", async t => {
    const created = await request("create_development_game"), saved = records.get(created.activeSaveId);
    saved.snapshot.npcActivities = { corvin: { status: "active", goal: "Talk to Mara", history: [] } };
    await request("load_game", { saveId: created.activeSaveId });
    await request("pause_npc", { characterId: "mara" });
    let decisions = 0, conversations = 0;
    t.mock.method(BrowserGameRuntime.prototype, "planNpc", async () => {
      decisions++; return { decision: { choice: "talk_mara" }, action: { id: "talk_mara", description: "Talk to Mara" }, goal: "Talk to Mara", generations: {} };
    });
    t.mock.method(BrowserGameRuntime.prototype, "stepNpcAction", () => ({ done: true, talkTarget: "mara", generations: {} }));
    t.mock.method(BrowserGameRuntime.prototype, "executeNpcTalk", async () => { conversations++; return ""; });
    await request("start_npc", { characterId: "corvin" });
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(decisions, 1);
    assert.equal(conversations, 0);
    await request("cancel_npc");
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(conversations, 0);
  });

  await t.test("dice acknowledgement gates the turn, ignores unrelated acknowledgements and cancels on game replacement", async t => {
    await request("create_development_game");
    let resumed = false;
    t.mock.method(BrowserGameRuntime.prototype, "checkedTalkToCharacter", async (_id: string, _message: string, _thinking: unknown, present: import("../apps/web/src/conversation-rolls.js").PresentRoll) => {
      await present!({ skill: "persuasion", dc: 15, modifier: 3, roll: 12, total: 15, margin: 0, degree: "barely_passes" as any, success: true });
      resumed = true; return "Agreed.";
    });
    const talking = request("talk", { characterId: "corvin", message: "Help me." });
    while (!diceMessages.length) await new Promise(resolve => setImmediate(resolve));
    const roll = diceMessages.at(-1);
    assert.equal(resumed, false);
    listener({ data: { type: "acknowledge_roll", payload: { rollId: roll.rollId, requestId: -1, completed: true } } });
    await request("state"); assert.equal(resumed, false);
    listener({ data: { type: "acknowledge_roll", payload: { rollId: roll.rollId, requestId: roll.requestId, completed: true } } });
    await talking; assert.equal(resumed, true);
    resumed = false;
    const interrupted = request("talk", { characterId: "corvin", message: "Again." });
    const rejected = assert.rejects(interrupted, /Game changed/);
    while (diceMessages.length < 2) await new Promise(resolve => setImmediate(resolve));
    await request("create_development_game");
    await rejected; assert.equal(resumed, false);
  });

  await t.test("conversation review leaves movement and other dialogue available", async () => {
    t.mock.method(JevClient.prototype, "evaluate", async (_input: unknown, questions: Record<string, unknown>) => Object.fromEntries(Object.keys(questions).map(skill => [skill, { choice: "not_needed", probabilities: { needed: 0, not_needed: 1 } }])));
    await request("create_development_game");
    t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Farewell.", replyOptions: [], endConversation: true }));
    await request("talk", { characterId: "corvin", message: "Goodbye." });
    let release!: () => void;
    let started!: () => void;
    const reviewing = new Promise<void>(resolve => { started = resolve; });
    const waitForReview = new Promise<void>(resolve => { release = resolve; });
    const commitReview = (input: any) => {
      if (input.messages.some((m: any) => m.role === "tool")) return gmTool("finish_review", { summary: "Reviewed." });
      const initial = input.messages.map((message: any) => { try { return JSON.parse(message.content); } catch { return {}; } });
      const participant = initial.find((v: any) => v.event_type)?.participants[0];
      const resource = initial.find((v: any) => v.world_state).world_state["character:" + participant];
      return gmTool("update_character", { character_id: participant, generation_id: resource.generation_id,
        changes: { append_notes: ["The envoy said goodbye."], active_objective: {
          action: "complete", reason: "The authored greeting was completed in this conversation.",
        } } });
    };
    t.mock.method(OpenRouterClient.prototype, "complete", async (input: any) => {
      if (input.tools?.some((tool: any) => tool.function.name === "finish_review")) {
        started(); await waitForReview;
        return commitReview(input);
      }
      return modelReply({ utterance: "Hello.", replyOptions: [], endConversation: false });
    });
    const review = request("end_conversation", { characterId: "corvin" });
    await reviewing;
    for (const type of ["talk", "end_conversation", "pause_npc", "start_npc"]) {
      await assert.rejects(request(type, { characterId: "corvin", message: "Again" }), /still reviewing/);
    }
    const destination = { x: 61, y: 24 };
    await request("move_player", { ...destination, generations: (await request("state")).state.generations });
    await request("talk", { characterId: "mara", message: "Hello." });
    release();
    const result = await review;
    assert.deepEqual(result.state.player.position, create(TilePositionSchema, destination));
    assert.equal(result.state.conversations.corvin, undefined);
    assert.equal(result.state.conversations.mara.length, 2);
    const saved = records.get(result.activeSaveId).snapshot;
    assert.ok(fromJson(ScenarioSchema, saved.scenario).notes.some(note => note.text === "The envoy said goodbye."));

    t.mock.method(OpenRouterClient.prototype, "complete", async (input: any) => commitReview(input));
    failNextWrite = true;
    await assert.rejects(request("end_conversation", { characterId: "mara" }), /Test storage failure/);
    assert.equal((await request("state")).state.conversations.mara.length, 2, "Failed reviews retain their transcript for retry");
    await request("end_conversation", { characterId: "mara" });
    assert.equal((await request("state")).state.conversations.mara, undefined);
  });
});

test("dialogue UI releases the screen before review and ignores replaced-game results", async () => {
  const sent: any[] = [];
  let receive!: (event: any) => void;
  let endDialogue!: () => void;
  let finishDice!: (completed: boolean) => void;
  const context = createContext({
    URL, AlertLog, coalescedRefresh, installDicePreview() {}, showDiceRoll: () => new Promise<boolean>(resolve => { finishDice = resolve; }), window: {}, devOpenRouterApiKey: "", newTraveller: () => ({}), updateCourtMap() {},
    document: {
      querySelector: (selector: string) => selector === "[data-end-conversation]"
        ? { addEventListener: (_type: string, callback: () => void) => { endDialogue = callback; } } : null,
      querySelectorAll: () => [], addEventListener() {},
    },
    Worker: class {
      addEventListener(_type: string, callback: typeof receive) { receive = callback; }
      postMessage(message: any) { sent.push(message); }
    },
  });
  // Execute the actual UI handlers with a deferred worker transport and no DOM rendering.
  const source = readFileSync(new URL("../apps/web/src/app.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replaceAll("import.meta.url", JSON.stringify(import.meta.url))
    .replace(/if \(apiKey\) run\(\(\) => configure\(apiKey\)\);\s*else render\(\);/, "");
  runInContext(`${source}\nrender = () => {}; updateNpcPanel = () => {}; state = { revision: 1 }; activeCharacter = 'corvin'; bind();`, context);
  receive({ data: { type: "alert", level: "warning", message: "Retrying <provider>" } });
  assert.equal(runInContext("alerts.severity", context), "warning");
  assert.match(runInContext("alertsView()", context), /&lt;provider&gt;/);
  receive({ data: { type: "alert", level: "error", message: "Review failed" } });
  assert.equal(runInContext("alerts.severity", context), "error");
  assert.equal(runInContext("alerts.unread", context), 2);
  runInContext("activeCharacter = null", context);
  receive({ data: { type: "npc_update", activeSaveId: null, running: null, state: {
    revision: 2, conversations: { mara: [{ role: "character", text: "A word, envoy." }] }, conversationEndRequested: {},
  } } });
  assert.equal(runInContext("activeCharacter", context), "mara", "a persisted NPC opening line opens even if the transient handoff event was missed");
  runInContext("activeCharacter = 'corvin'; state = { revision: 2 }", context);
  endDialogue();
  assert.equal(runInContext("activeCharacter", context), null);
  assert.equal(runInContext("busy", context), false);
  assert.equal(sent[0].type, "end_conversation");
  receive({ data: { id: sent[0].id, ok: false, error: "Storage unavailable" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runInContext("conversationReviews.get('corvin').error", context), "Storage unavailable");
  runInContext("reviewConversation('corvin')", context);
  receive({ data: { id: sent[1].id, ok: true, value: { state: { revision: 2 }, saves: [] } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runInContext("conversationReviews.size", context), 0);
  assert.equal(sent[2].type, "start_npc", "NPC starts only after review succeeds");

  const talking = runInContext("activeCharacter = 'mara'; run(() => talkAndReview('mara', 'Goodbye'))", context);
  const talk = sent.at(-1);
  receive({ data: { type: "conversation_roll", requestId: talk.id, characterId: "mara", rollId: "roll-1", result: { skill: "persuasion", intent: "Win help" } } });
  assert.equal(sent.at(-1), talk, "No acknowledgement before the dice UI finishes");
  finishDice(true); await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.at(-1).type, "acknowledge_roll");
  assert.equal(sent.at(-1).payload.completed, true);
  receive({ data: { type: "dialogue_thinking", requestId: talk.id, characterId: "mara", text: "Mara considers her answer." } });
  assert.equal(runInContext("notice", context), "Mara considers her answer.");
  assert.match(runInContext("conversationNoticeView().waitingMessage", context), /class="message waiting" role="status"/);
  assert.match(runInContext("conversationNoticeView().waitingMessage", context), /Mara considers her answer<span class="waiting-dots"/);
  assert.equal(runInContext("conversationNoticeView().statusMessage", context), "", "waiting copy is omitted from the status beneath the composer");
  receive({ data: { type: "dialogue_thinking", requestId: talk.id, characterId: "corvin", text: "Wrong character." } });
  assert.equal(runInContext("notice", context), "Mara considers her answer.");
  receive({ data: { id: talk.id, ok: true, value: { state: { revision: 3, conversationEndRequested: { mara: true }, conversations: { mara: ["Farewell"] } }, saves: [] } } });
  await talking;
  receive({ data: { type: "dialogue_thinking", requestId: talk.id, characterId: "mara", text: "Late text." } });
  assert.equal(runInContext("notice", context), "");
  assert.equal(runInContext("busy", context), false, "NPC farewell does not wait for review");
  assert.equal(runInContext("closedConversation.messages[0]", context), "Farewell");
  const review = sent.at(-1);
  assert.equal(review.type, "end_conversation");
  endDialogue();
  assert.equal(runInContext("activeCharacter", context), null);
  runInContext("void rpc('load_game', { saveId: 'other' }); state = { revision: 99 };", context);
  receive({ data: { id: review.id, ok: true, value: { state: { revision: 4 }, saves: [] } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runInContext("state.revision", context), 99);
  assert.equal(sent.filter(message => message.type === "start_npc").length, 1);
});

test("dialogue composer sends on Enter and submits a final response with the leave action", () => {
  let submit!: (event: any) => void;
  let keydown!: (event: any) => void;
  let submitted = 0;
  const textarea = { addEventListener: (type: string, callback: (event: any) => void) => {
    if (type === "keydown") keydown = callback;
  } };
  const form = {
    addEventListener: (type: string, callback: (event: any) => void) => { if (type === "submit") submit = callback; },
    querySelector: (selector: string) => selector === "textarea" ? textarea : null,
    requestSubmit: () => { submitted++; },
  };
  const sent: any[] = [];
  const context = createContext({
    URL, AlertLog, coalescedRefresh, installDicePreview() {}, window: {}, devOpenRouterApiKey: "", newTraveller: () => ({}), updateCourtMap() {},
    FormData: class { get() { return "Farewell."; } },
    document: {
      querySelector: (selector: string) => selector === "[data-talk-form]" ? form : null,
      querySelectorAll: () => [], addEventListener() {},
    },
    Worker: class {
      addEventListener() {}
      postMessage(message: any) { sent.push(message); }
    },
  });
  const source = readFileSync(new URL("../apps/web/src/app.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replaceAll("import.meta.url", JSON.stringify(import.meta.url))
    .replace(/if \(apiKey\) run\(\(\) => configure\(apiKey\)\);\s*else render\(\);/, "");
  runInContext(`${source}\nrender = () => {}; updateNpcPanel = () => {}; state = { revision: 1 }; activeCharacter = 'corvin'; bind();`, context);

  let prevented = 0;
  keydown({ key: "Enter", shiftKey: false, isComposing: false, preventDefault: () => { prevented++; } });
  assert.equal(submitted, 1);
  assert.equal(prevented, 1);
  keydown({ key: "Enter", shiftKey: true, isComposing: false, preventDefault: () => { prevented++; } });
  assert.equal(submitted, 1, "Shift+Enter keeps a newline");

  submit({
    currentTarget: form,
    submitter: { hasAttribute: (name: string) => name === "data-respond-and-close" },
    preventDefault() {},
  });
  assert.equal(runInContext("activeCharacter", context), null);
  assert.equal(sent[0].type, "end_conversation");
  assert.equal(sent[0].payload.characterId, "corvin");
  assert.equal(sent[0].payload.message, "Farewell.");
});

test("court dialogue accepts fenced JSON without issuing a second model request", async t => {
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => {
    calls++;
    return { role: "assistant", content: '```json\n{"utterance":"Welcome, envoy.","replyOptions":[],"endConversation":false}\n```' };
  });
  assert.equal(await runtime.talkToCharacter("mara", "Hello."), "Welcome, envoy.");
  assert.equal(calls, 1);
  assert.equal(runtime.snapshot().conversations.mara?.length, 2);
});

test("malformed dialogue retries once and commits only one exchange", async t => {
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  const requests: any[] = [];
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: any) => {
    requests.push(structuredClone(request));
    return requests.length === 1 ? { role: "assistant", content: "Welcome to the hall." }
      : modelReply({ utterance: "Welcome to the hall.", replyOptions: [], endConversation: false });
  });
  await runtime.talkToCharacter("mara", "Hello.");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages.filter((message: any) => message.role === "user" && message.content === "Hello.").length, 1);
  assert.match(requests[1].messages.at(-1).content, /valid JSON/);
  assert.equal(runtime.snapshot().conversations.mara?.length, 2);
});

test("repeated malformed dialogue preserves existing conversation and reply options", async t => {
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ++calls === 1
    ? modelReply({ utterance: "Welcome.", replyOptions: ["Thank you."], endConversation: false })
    : { role: "assistant", content: "Not a JSON response" });
  await runtime.talkToCharacter("mara", "Hello.");
  const before = structuredClone(runtime.snapshot());
  await assert.rejects(runtime.talkToCharacter("mara", "What is your demand?"), /Court dialogue returned an unreadable response/);
  assert.equal(calls, 3);
  assert.deepEqual(runtime.snapshot(), before);
});

test("non-JSON OpenRouter errors retain HTTP status and transient dialogue failures recover", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 1
    ? new Response("<html>Upstream unavailable</html>", { status: 502 })
    : new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ utterance: "Welcome.", replyOptions: [], endConversation: false }) }] }] })));
  t.mock.method(OpenRouterClient.prototype, "complete", originalOpenRouterComplete);
  const runtime = new BrowserGameRuntime(conversationScenario(), "test");
  assert.equal(await runtime.talkToCharacter("mara", "Hello."), "Welcome.");
  assert.equal(calls, 2);
  assert.equal(runtime.snapshot().conversations.mara?.length, 2);
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Forbidden</html>", { status: 403 }));
  await assert.rejects(new OpenRouterClient("test").complete({ model: "test", messages: [] }), /HTTP 403/);
});

test("expanded hall has unobstructed routes to all delegates and its relocated entrance", () => {
  const scenario = load(), world = scenario.world!;
  const hall = palaceMap.rooms.find(room => room.id === "great_hall")!.regions[0]!;
  assert.equal(hall.width * hall.height, 156);
  const player = scenario.courtArrivalPlacements.find(item => item.characterId === "player")!.position!;
  for (const placement of scenario.courtArrivalPlacements) {
    assert.ok(courtPath(player, placement.position!, world.doors, world.fixtures), `${placement.characterId} can be reached`);
  }
  const entrance = world.doors.find(door => door.id === "entrance_door")!;
  assert.ok(courtPath(player, { x: 61, y: 35 }, world.doors, world.fixtures));
  entrance.open = false;
  assert.equal(courtPath({ x: 61, y: 24 }, { x: 61, y: 35 }, world.doors, world.fixtures), undefined);
  for (const fixture of world.fixtures.filter(item => item.roomId === "entrance_hall")) {
    assert.equal(courtRoomAt(fixture.position!)?.id, "entrance_hall");
    if (fixture.interactionSpot) assert.equal(courtRoomAt(fixture.interactionSpot)?.id, "entrance_hall");
  }
});

function gmTool(name: string, args: Record<string, unknown>) {
  return { role: "assistant" as const, content: null, tool_calls: [{ id: "gm-call", type: "function" as const, function: { name, arguments: JSON.stringify(args) } }] };
}
const idleMemory = { newNotes: [], relationships: [], lore: null, goalUpdate: null };
const missingProp = { id: "envoy_token", name: "Envoy's token", locationId: "corvin", details: "A brass token bearing the embassy's seal.", reason: "A mundane token established in the exchange makes inspection possible." };

test("DM reconciles a conversation with real inventory props and an executable inspection task", async t => {
  const runtime = new BrowserGameRuntime(furnishedCourt(), "test");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "I will inspect the token." }));
  await runtime.talkToCharacter("corvin", "Check the embassy token.");
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async (request: any) => {
    assert.ok(request.tools.some((tool: any) => tool.function.name === "create_item"));
    assert.match(JSON.stringify(request.messages), /authoritativeWorld/);
    if (calls++ === 0) return gmTool("create_item", missingProp);
    assert.match(request.messages.at(-1).content, /envoy_token/);
    return modelReply({ ...idleMemory, goalUpdate: { goal: "Inspect the envoy token in my inventory.", reason: "The token is now present." } });
  });
  await runtime.endConversation("corvin");
  const saved = runtime.snapshot(), scenario = fromJson(ScenarioSchema, saved.scenario);
  assert.equal(locatedItems(scenario).find(o => o.id === "envoy_token")?.locationId, "corvin");
  assert.ok(worldForCharacter(scenario, "corvin").objects.some(o => o.id === "envoy_token"));
  assert.ok(!worldForCharacter(scenario, "garran").objects.some(o => o.id === "envoy_token"), "Private inventory addition does not leak");
  const observation = courtAgentObservation(scenario, "corvin");
  assert.ok(observation.actions.some(a => a.id === "inspect_item_envoy_token"));
  const result = runtime.executeNpcAction("corvin", "inspect_item_envoy_token", observation.revision, observation.goal);
  assert.match(result, /brass token/);
  const restored = new BrowserGameRuntime(furnishedCourt(), "test", runtime.snapshot());
  assert.ok(locatedItems(fromJson(ScenarioSchema, restored.snapshot().scenario)).some(o => o.id === "envoy_token"));
});

test("DM cancel_task overrides a proposed goal and clobbers dead ends after failed actions", async t => {
  const { runtime } = talkingCourt();
  runtime.finishNpcRun("corvin", "unable", "No action can perform the proposed task.");
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => calls++ === 0
    ? gmTool("cancel_task", { characterId: "corvin", reason: "No supported action can advance this task." })
    : modelReply({ ...idleMemory, goalUpdate: { goal: "Try the same impossible task again.", reason: "Keep trying." } }));
  await runtime.reviewNpcOutcome("corvin");
  assert.equal(runtime.snapshot().npcActivities?.corvin?.status, "idle");
  assert.equal(runtime.snapshot().npcActivities?.corvin?.goal, "");
  assert.equal(fromJson(ScenarioSchema, runtime.snapshot().scenario).characters.find(c => c.id === "corvin")!.currentGoal, "");
  await assert.rejects(runtime.planNpc("corvin", new AbortController().signal), /idle/);
});

test("DM additions roll back on malformed final memory and bounded tool exhaustion", async t => {
  const runtime = new BrowserGameRuntime(furnishedCourt(), "test");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Perhaps." }));
  await runtime.talkToCharacter("corvin", "Inspect a token.");
  const before = runtime.snapshot();
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => calls++ === 0 ? gmTool("create_item", missingProp) : modelReply({}));
  await assert.rejects(runtime.endConversation("corvin"), /incomplete/);
  assert.deepEqual(runtime.snapshot(), before);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => gmTool("create_item", missingProp));
  await assert.rejects(runtime.endConversation("corvin"), /tool limit/);
  assert.deepEqual(runtime.snapshot(), before);
});

test("GM world additions preserve unrelated player movement and inventory changes", async t => {
  const { runtime } = talkingCourt();
  runtime.finishNpcRun("corvin", "unable", "A token is missing.");
  const before = runtime.snapshot(), fork = runtime.forkForNpc();
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => calls++ === 0 ? gmTool("create_item", missingProp) : modelReply(idleMemory));
  await fork.reviewNpcOutcome("corvin");
  runtime.movePlayer({ x: 66, y: 21 });
  runtime.commitCharacterFork(before, fork, ["corvin"]);
  const merged = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.ok(locatedItems(merged).some(o => o.id === "envoy_token"));
  assert.deepEqual(merged.world!.actors.find(a => a.characterId === "player")!.position, create(TilePositionSchema, { x: 66, y: 21 }));
  runtime.restore(before);
  runtime.movePlayer({ x: 66, y: 21 });
  runtime.interactFixture("open_palace_hall_cabinet");
  runtime.interactFixture("take_palace_iron_key");
  runtime.commitCharacterFork(before, fork, ["corvin"]);
  const changed = fromJson(ScenarioSchema, runtime.snapshot().scenario);
  assert.equal(locatedItems(changed).find(item => item.id === "palace_iron_key")?.locationId, "player");
  assert.equal(locatedItems(changed).find(item => item.id === "envoy_token")?.locationId, "corvin");
});

test("DM tools validate destinations, unique IDs, and participant scope before mutation", async () => {
  const { applyReconciliationTool } = await import("../apps/web/src/gm-reconciliation.js");
  const scenario = furnishedCourt(), before = toJson(ScenarioSchema, scenario), cancelled = new Map<string, string>();
  for (const locationId of ["missing_shelf", "great_hall"]) {
    assert.throws(() => applyReconciliationTool(scenario, ["corvin"], cancelled, "create_item", { ...missingProp, locationId }), /Location/);
  }
  assert.throws(() => applyReconciliationTool(scenario, ["corvin"], cancelled, "create_item", { ...missingProp, id: "palace_royal_key" }), /already exists/);
  assert.throws(() => applyReconciliationTool(scenario, ["corvin"], cancelled, "cancel_task", { characterId: "king", reason: "Stop" }), /participants/);
  assert.deepEqual(toJson(ScenarioSchema, scenario), before);
  assert.equal(cancelled.size, 0);
  applyReconciliationTool(scenario, ["corvin"], cancelled, "create_item", { ...missingProp, locationId: "palace_treasury_shelf" });
  assert.ok(!fixtureActions(scenario, "corvin").some(a => a.id === "inspect_item_envoy_token"));
  applyFixtureAction(scenario, "corvin", "open_palace_treasury_shelf");
  assert.match(applyFixtureAction(scenario, "corvin", "inspect_item_envoy_token"), /brass token/);
  applyFixtureAction(scenario, "corvin", "take_envoy_token");
  assert.match(applyFixtureAction(scenario, "corvin", "inspect_item_envoy_token"), /brass token/);
});

test("NPC exchanges use the same DM tools and cancellation rules for both participants", async t => {
  const { runtime, action, observation } = talkingCourt();
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => {
    if (calls++ === 0) return modelReply({ request: "Could we inspect my token?", intent: "Identify its origin." });
    if (calls === 2) return gmTool("create_item", missingProp);
    if (calls === 3) return gmTool("cancel_task", { characterId: action.target, reason: "I have no further task to perform." });
    return modelReply({ summary: "They discuss the embassy token.", initiator: idleMemory, recipient: { ...idleMemory, goalUpdate: { goal: "Keep searching for nothing.", reason: "Continue" } } });
  });
  await runtime.executeNpcTalk("corvin", action.id, observation.revision, observation.goal, new AbortController().signal);
  const saved = runtime.snapshot(), scenario = fromJson(ScenarioSchema, saved.scenario);
  assert.ok(locatedItems(scenario).some(o => o.id === "envoy_token"));
  assert.equal(saved.npcActivities?.[action.target]?.status, "idle");
  assert.equal(scenario.characters.find(c => c.id === action.target)!.currentGoal, "");
});


test("completed NPC talk IDs are recorded on the live review host", async t => {
  const { runtime, observation, action } = talkingCourt();
  const snapshot = runtime.snapshot();
  const target = fromJson(ScenarioSchema, snapshot.scenario).characters.find(item => item.id === action.target)!;
  snapshot.npcActivities![action.target] = { status: "active", goal: target.currentGoal, history: [] };
  runtime.restore(snapshot);
  let calls = 0;
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ++calls === 1
    ? modelReply({ request: "Hello.", intent: "Greet them." })
    : gmTool("finish_review", { summary: "They exchange greetings." }));
  const fork = runtime.forkForResourceReview(async work => work());
  await fork.executeNpcTalk("corvin", action.id, observation.revision, observation.goal, new AbortController().signal);
  assert.deepEqual(runtime.snapshot().npcActivities?.corvin?.actionIds, [action.id]);
  assert.equal(runtime.snapshot().npcActivities?.[action.target]?.actionIds, undefined);
});
