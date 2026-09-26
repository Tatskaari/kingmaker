import { ModelTranscripts } from "../apps/web/src/model-transcripts.js";
import { courtAgentObservation } from "../apps/web/src/court-agent.js";
import { doorActionLegality } from "../packages/core/src/access.js";
import { actionsAtTile, type CourtInteractionLayer } from "../apps/web/src/court-interactions.js";
import { courtMarkers, courtPath, courtRoomAt, courtWalkPoint, redirectCourtPath, courtInteractionPoint, nearestDoorSpot } from "../apps/web/src/court-map.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { create, fromBinary, fromJson, fromJsonString, toBinary, toJson, toJsonString } from "@bufbuild/protobuf";
import {
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
import { FullContextBuilder, FullGameMasterContextBuilder, worldForCharacter } from "../packages/core/src/context.js";
import { MemoryGame } from "../packages/core/src/game.js";
import { palaceMap } from "../apps/web/src/palace-map.js";

import { canWalk, findPath, pointKey } from "../apps/web/src/navigation.js";
import { palaceNodes } from "../apps/web/src/palace-navigation.js";


import { JevClient } from "../packages/providers/src/jev.js";


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

test("character knowledge refers to live fixtures and conceals other characters' secrets", () => {
  const scenario = load();
  const merlin = worldForCharacter(scenario.world!, "merlin");
  const lancelot = worldForCharacter(scenario.world!, "lancelot");
  const player = worldForCharacter(scenario.world!, "player");
  assert.ok(merlin.objects.some(item => item.id === "palace_royal_key"));
  assert.ok(!merlin.objects.some(item => item.id === "crown"));
  assert.ok(lancelot.objects.some(item => item.id === "crown" && item.locationId === "palace_coffer_03"));
  assert.ok(!lancelot.objects.some(item => item.id === "palace_royal_key"));
  assert.ok(!player.objects.some(item => ["crown", "palace_royal_key"].includes(item.id)));
  assert.equal(player.fixtures.find(item => item.id === "palace_coffer_03")!.revealedName, "");
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
const originalOpenRouterComplete = OpenRouterClient.prototype.complete;
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
  assert.equal(new Set(markers.map(marker => pointKey(marker.point!))).size, 4);
  assert.ok(markers.every(marker => courtRoomAt(marker.point!)?.id === "great_hall"));
  assert.ok(markers.every(marker => courtPath(markers[0]!.point!, marker.point!)));
  const merlin = courtMarkers([{ id: "merlin", name: "Merlin", roomId: "merlin_chamber", position: { x: 5, y: 5 } }])[0]!;
  assert.equal(courtRoomAt(merlin.point!)?.id, "merlin_chamber");
  assert.equal(courtMarkers([{ id: "king", name: "King", roomId: "nonexistent_room" }])[0]!.point, undefined);
});

test("main palace movement validates routes and survives saving and restoring", () => {
  const scenario = load(); scenario.characters.push(create(CharacterSchema, { id: "player", name: "Envoy" })); scenario.playerCharacterId = "player";
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
  const scenario = load(); scenario.characters.push(create(CharacterSchema, { id: "player", name: "Envoy" })); scenario.playerCharacterId = "player";
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
  runtime.interactFixture("take_crown");
  const restored = new BrowserGameRuntime(scenario, "test", structuredClone(runtime.snapshot()));
  saved = fromJson(ScenarioSchema, restored.snapshot().scenario);
  assert.equal(saved.world!.objects.find(item => item.id === "palace_royal_seal")!.locationId, "player");
  assert.equal(saved.world!.objects.find(item => item.id === "palace_royal_key")!.locationId, "player", "Key is not consumed");
  assert.equal(saved.world!.fixtures.find(item => item.id === "palace_coffer_03")!.open, true);
  assert.equal(saved.world!.objects.find(item => item.id === "crown")!.locationId, "player");
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
  await assert.rejects(runtime.planNpc("merlin", new AbortController().signal), /review first/);
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
    const plan = await runtime.planNpc("merlin", new AbortController().signal);
    assert.ok(plan.action);
    runtime.executeNpcAction("merlin", plan.action.id, plan.revision, plan.goal);
  }
  const finished = await runtime.planNpc("merlin", new AbortController().signal);
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
  execute("open_palace_merlin_drawers"); execute("take_palace_royal_key"); execute("move_royal"); execute("open_palace_coffer_03"); execute("take_palace_royal_seal"); execute("take_crown");
  const snapshot = runtime.snapshot(), saved = fromJson(ScenarioSchema, snapshot.scenario);
  assert.equal(saved.world!.objects.find(item => item.id === "palace_royal_key")!.locationId, "merlin");
  assert.equal(saved.world!.objects.find(item => item.id === "palace_royal_seal")!.locationId, "merlin");
  assert.equal(saved.world!.objects.find(item => item.id === "crown")!.locationId, "merlin");
  assert.deepEqual(runtime.view().inventory, []);
  const observation = courtAgentObservation(saved, "merlin");
  runtime.resetWorld();
  assert.throws(() => runtime.executeNpcAction("merlin", observation.actions[0]!.id, observation.revision, observation.goal), /World changed|not accepting actions/);
  assert.throws(() => courtAgentObservation(saved, "player"), /NPC/);
});

test("greeting goal is idle until the LLM explicitly assigns a task", async t => {
  const runtime = new BrowserGameRuntime(furnishedCourt(), "test");
  assert.ok(Object.values(runtime.view().npcActivities as Record<string, {status: string}>).every(activity => activity.status === "idle"));
  await assert.rejects(runtime.planNpc("merlin", new AbortController().signal), /idle/);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ utterance: "Welcome." }));
  await runtime.talkToCharacter("merlin", "Hello.");
  t.mock.method(OpenRouterClient.prototype, "complete", async () => modelReply({ newEvents: [], relationships: [], goalUpdate: null, lore: null }));
  await runtime.endConversation("merlin");
  assert.equal(runtime.snapshot().npcActivities?.merlin?.status, "idle");
  assert.match(fromJson(ScenarioSchema, runtime.snapshot().scenario).characters[0]!.currentGoal, /greet the visiting player/);
  await assert.rejects(runtime.planNpc("merlin", new AbortController().signal), /idle/);
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
  await assert.rejects(runtime.planNpc("merlin", new AbortController().signal), /idle/);
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
  await assert.rejects(restored.planNpc("merlin", new AbortController().signal), /idle/);
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
  await assert.rejects(runtime.planNpc("merlin", new AbortController().signal), /Rejected/);
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
  const plan = await runtime.planNpc("merlin", new AbortController().signal);
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
  const world = scenario.world!;
  const locations = new Set([...ids, ...world.fixtures.map(item => item.id), ...scenario.characters.map(item => item.id)]);
  const objects = new Set(world.objects.map(item => item.id));
  assert.equal(objects.size, world.objects.length, "Object IDs must be unique");
  for (const item of world.objects) assert.ok(locations.has(item.locationId), `${item.id} is in a nonexistent container or location ${item.locationId}`);
  for (const fixture of world.fixtures) if (fixture.requiredKeyId) assert.ok(objects.has(fixture.requiredKeyId), `${fixture.id} needs a missing key`);
  assert.doesNotMatch(JSON.stringify(scenario), /chapel/i);
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
