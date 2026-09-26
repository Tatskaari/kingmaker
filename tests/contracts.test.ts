import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { create, fromBinary, fromJson, fromJsonString, toBinary, toJsonString } from "@bufbuild/protobuf";
import {
  AvailableActionSchema,
  DecisionRequestSchema,
  DialogueRequestSchema,
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
  type Scenario,
} from "../packages/contracts/src/index.js";
import { FullContextBuilder, FullGameMasterContextBuilder, worldForCharacter } from "../packages/core/src/context.js";
import { MemoryGame } from "../packages/core/src/game.js";
import { palaceMap } from "../apps/web/src/palace-map.js";

import { canWalk, findPath, pointKey, reachableRoutes } from "../apps/web/src/navigation.js";
import { palaceNodes, palaceEdges } from "../apps/web/src/palace-navigation.js";

import { createDoors, doorBlockers, doorGraph, toggleDoor } from "../apps/web/src/palace-doors.js";

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
  assert.ok(!world.rooms.flatMap(room => room.searchSpots).some(spot => spot.id === "chapel_altar"));
  assert.doesNotMatch(prompt, /ordinary banter|unexpectedly took offence/);
});

test("Lancelot sees the crown box while an uninformed king sees neither hiding place", () => {
  const scenario = load();
  assert.ok(scenario.world);
  const lancelot = worldForCharacter(scenario.world, "lancelot");
  const king = worldForCharacter(scenario.world, "king");
  assert.ok(lancelot.rooms.flatMap(room => room.searchSpots).some(spot => spot.id === "chapel_altar"));
  assert.ok(lancelot.objects.some(object => object.id === "crown_box"));
  assert.ok(!lancelot.objects.some(object => object.id === "brass_key"));
  assert.ok(!lancelot.rooms.flatMap(room => room.searchSpots).some(spot => spot.id === "merlin_desk"));
  assert.ok(!king.objects.some(object => object.id === "brass_key" || object.id === "crown_box"));
  assert.ok(!king.rooms.flatMap(room => room.searchSpots).some(spot =>
    spot.id === "merlin_desk" || spot.id === "chapel_altar",
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
  assert.match(request.character?.currentGoal ?? "", /Prevent the king/);
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
