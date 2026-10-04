import { commitReview } from "./fixtures.js";
import { mockJevChoice } from "./mock-jev.js";
import { loadPlayableWorld } from "./fixtures.js";
import { logPath } from "../scripts/test-logging.js";
import { inventoryOwners, locatedItems } from "../packages/core/src/inventory.js";
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
import { FullContextBuilder, FullGameMasterContextBuilder } from "../packages/core/src/context.js";
import { worldForCharacter } from "../packages/core/src/physical-view.js";
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
  assert.match(prompt, /These characters are right by you and will almost certainly hear what you say\.\n- Marshal Garran Holt \(garran\)/);
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

  const evidence = new Map(locatedItems(inventoryOwners(scenario.characters, scenario.world)).map(item => [item.id, item]));
  for (const id of [
    "palace_sealed_decree", "palace_patrol_roster", "palace_account_book", "palace_gate_ledger",
    "corvin_concord_copy", "sabine_caravan_tallies", "rook_tomas_letter", "palace_parlour_wine",
  ]) assert.ok(evidence.get(id)?.details, id);
  assert.ok(worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "rook").objects.some(item => item.id === "rook_tomas_letter"));
  assert.ok(!worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "mara").objects.some(item => item.id === "rook_tomas_letter"));
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
  const corvin = worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "corvin");
  const garran = worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "garran");
  const player = worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "player");
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
import { OpenRouterClient, type ChatCompletionRequest, type OpenRouterMessage } from "../packages/providers/src/openrouter.js";
const originalOpenRouterComplete = OpenRouterClient.prototype.complete;
import { compulsionNarration, parseReplyOptions } from "../apps/web/src/reply-options.js";

const offer = (compelled: boolean, options = ["I want to protect my family.", "I intend to earn a place at court."]): OpenRouterMessage => ({
  role: "assistant", content: "What do you want from this journey?",
  tool_calls: [{ id: "offer-1", type: "function", function: {
    name: "offer_replies", arguments: JSON.stringify({ options, compelled }),
  } }],
});

test("private crossroads framing belongs to the GM, not the shared court premise", () => {
  const scenario = load();
  assert.doesNotMatch(scenario.premise, /crossroads|stranger/i);
  assert.match(scenario.gameMasterPrompt, /crossroads/);
  assert.match(scenario.systemPrompt, /cannot compel a response/);
});

test("the documented Stranger conversation stages are the runtime prompt", () => {
  const documented = readFileSync(new URL("../content/prompts/game-master.md", import.meta.url), "utf8")
    .replace(/^# The Laughing Stranger\s+/, "").trim();
  assert.equal(load().gameMasterPrompt, documented);
});

const interviewBuild = { classId: "rogue", abilityPriority: ["dexterity", "charisma", "constitution", "intelligence", "wisdom", "strength"], skills: ["persuasion", "deception", "insight", "stealth"] };

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

test("authored world rooms and connections match the palace map", () => {
  const scenario = load(), rooms = scenario.world!.rooms;
  const ids = new Set(rooms.map(room => room.id));
  assert.deepEqual([...ids].sort(), palaceMap.rooms.map(room => room.id).sort());
  for (const room of rooms) for (const exit of room.exitRoomIds) assert.ok(ids.has(exit), `${room.id} exits to missing room ${exit}`);
  for (const fixture of scenario.world!.fixtures) assert.ok(ids.has(fixture.roomId), `${fixture.id} belongs to missing room ${fixture.roomId}`);
  const world = scenario.world!;
  const locations = new Set([...ids, ...world.fixtures.map(item => item.id), ...scenario.characters.map(item => item.id)]);
  const objects = new Set(locatedItems(inventoryOwners(scenario.characters, scenario.world)).map(item => item.id));
  assert.equal(objects.size, locatedItems(inventoryOwners(scenario.characters, scenario.world)).length, "Object IDs must be unique");
  for (const item of locatedItems(inventoryOwners(scenario.characters, scenario.world))) assert.ok(locations.has(item.locationId), `${item.id} is in a nonexistent container or location ${item.locationId}`);
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
  assert.ok(!locatedItems(inventoryOwners(scenario.characters, scenario.world)).some(item => item.id === "crown"));
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

// Exercise the new introduction independently of network responses or browser credentials.
import { introductionHandoff, validateIdentity, characterSprites } from "../apps/web/src/introduction.js";

test("legacy introduction handoff preserves a delegation's witness role", () => {
  const handoff = introductionHandoff({ name: "Seren", delegation: "Saltmere", gender: "Non-binary", sprite: 99 });
  assert.match(handoff, /Saltmere/);
  assert.match(handoff, /not the delegation's mandated recognition bearer/);
  assert.match(handoff, /Non-binary/);
});

test("v2 worker persists one world and keeps scheduling, review and dice outside its mutation queue", { timeout: 90000 }, async t => {
  const { WorldGameRuntime: BrowserGameRuntime } = await import("../apps/web/src/world-runtime.js");
  type BrowserGameRuntime = import("../apps/web/src/world-runtime.js").WorldGameRuntime;
  const { playableWorld } = await import("../apps/web/src/playable-world.js");
  const { readVault } = await import("../scripts/lib/lore-access.js");
  const world = loadPlayableWorld();
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
  const alerts: any[] = [];
  const records = new Map<string, any>();
  globals.self = {
    addEventListener: (_type: string, callback: typeof listener) => { listener = callback; },
    postMessage: (message: any) => { if (message.type === "alert") alerts.push(message); if (message.type === "npc_update") npcUpdates.push(message); if (message.type === "conversation_roll") diceMessages.push(message); pending.get(message.id)?.(message); },
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
  const { startGameWorker } = await import("../apps/web/src/game-worker.js");
  startGameWorker(globals.self, Promise.resolve(world));
  let assessWorldEvent = async (_event: Event, _signal: AbortSignal) => ({ reactions: [] });
  t.mock.method(BrowserGameRuntime.prototype, "assessWorldEvent", (event: Event, signal: AbortSignal) => assessWorldEvent(event, signal));
  const request = (type: string, payload: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++sequence;
    // Full-vault creation performs many document writes; allow for parallel suite load.
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Worker ${type} did not settle`)); }, 10000);
    pending.set(id, message => { clearTimeout(timer); pending.delete(id); if (message.ok) resolve(message.value); else reject(new Error(message.error)); });
    if (type === "load_game") {
      const saved = records.get(payload.saveId as string);
      for (const [characterId, activity] of Object.entries(saved.snapshot.npcActivities ?? {}) as Array<[string, { goal: string }]>) {
        const path = `Scenarios/Centennial Assembly/Characters/${characterId}/character.md`;
        if (saved.snapshot.world.docs[path] && saved.snapshot.world.runtimeCharacters[characterId]) {
          const task = path.replace("character.md", "task.md");
          saved.snapshot.world.docs[task] = { frontmatter: { visibility: "private", readers: [`character:${characterId}`],
            name: activity.goal, status: "Assigned", success_criteria: activity.goal, current_goal: activity.goal }, body: "" };
          if (activity.goal) saved.snapshot.world.runtimeCharacters[characterId].activity = task;
          else delete saved.snapshot.world.runtimeCharacters[characterId].activity;
        }
      }
    }
    listener({ data: { id, type, payload } });
  });
  await request("configure", { apiKey: "test" });
  const fresh = await request("create_game");
  assert.equal(fresh.state.phase, "player_creation");
  assert.equal(records.get(fresh.activeSaveId).snapshot.version, 5);
  assert.equal(records.get(fresh.activeSaveId).snapshot.scenario, undefined);
  await request("start_introduction");
  const resumed = await request("load_game", { saveId: fresh.activeSaveId });
  assert.equal(resumed.state.player, null);
  assert.equal(resumed.state.gmMessages.length, 1);

  await t.test("creation storage failures retain the resumable interview and draft", async t => {
    t.mock.method(JevClient.prototype, "evaluate", async (_state: unknown, questions: Record<string, unknown>) =>
      Object.fromEntries(Object.keys(questions).map(id => [id, { choice: "skip", probabilities: { [id]: 0, skip: 1 } }])));
    failNextWrite = true;
    await assert.rejects(request("gm", { message: "Alex" }), /Test storage failure/);
    assert.equal((await request("state")).state.gmMessages.length, 1);
    const ids = world.characters.map(path => /\/Characters\/([^/]+)\//.exec(path)![1]!);
    const input = { name: "Alex", gender: "nonbinary", homeland: "Independent", embassyRole: "Visiting scholar",
      lore: "You serve the Stranger.", currentGoal: "Explore court",
      relationships: ids.map(characterId => ({ characterId, description: "No prior acquaintance." })),
      npcViews: ids.map(characterId => ({ characterId, description: "A newly arrived scholar." })),
      build: { classId: "rogue", abilityPriority: ["dexterity", "charisma", "intelligence", "constitution", "wisdom", "strength"], skills: ["persuasion", "deception", "insight", "stealth"] } };
    t.mock.method(OpenRouterClient.prototype, "complete", async () => ({ role: "assistant", content: null, tool_calls: [
      { id: "draft", type: "function", function: { name: "create_player", arguments: JSON.stringify(input) } },
    ] }));
    const review = await request("gm", { message: "Ready" });
    assert.equal(review.state.phase, "character_review");
    failNextWrite = true;
    await assert.rejects(request("save_character", { draft: review.state.playerDraft }), /Test storage failure/);
    const pendingReview = await request("state");
    assert.equal(pendingReview.state.phase, "character_review");
    assert.equal(pendingReview.state.player, null);
    assert.equal(records.get(fresh.activeSaveId).snapshot.world.player, undefined);
    await request("save_character", { draft: review.state.playerDraft });
    const reloaded = await request("load_game", { saveId: fresh.activeSaveId });
    assert.equal(reloaded.state.player.name, "Alex");
    assert.equal(reloaded.state.phase, "conversations");
  });

  await t.test("jail release settles outside the worker queue and rolls back failed saves", async () => {
    const created = await request("create_development_game");
    records.get(created.activeSaveId).snapshot.jail = { characterId: "palace-guard", message: "You're nicked." };
    const loaded = await request("load_game", { saveId: created.activeSaveId });
    assert.equal(loaded.state.jail.characterId, "palace-guard");
    failNextWrite = true;
    await assert.rejects(request("release_from_jail"), /Test storage failure/);
    assert.equal((await request("state")).state.jail.characterId, "palace-guard");
    assert.equal((await request("release_from_jail")).state.jail, null);
    assert.equal(records.get(created.activeSaveId).snapshot.jail, undefined);
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
    saved.snapshot.npcActivities = Object.fromEntries(["corvin", "gurt"].map(id => [id, { status: "active", goal: "Wait here.", history: [] }]));
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
    await request("start_npc", { characterId: "gurt" });
    await request("start_npc", { characterId: "corvin" });
    assert.deepEqual(plans.map(plan => plan.id), ["corvin", "gurt"]);
    assert.deepEqual(npcUpdates.at(-1).running.sort(), ["corvin", "gurt"]);
    await request("move_player", { x: 61, y: 24 });
    await request("pause_npc", { characterId: "corvin" });
    assert.equal(plans[0]!.signal.aborted, true);
    assert.equal(plans[1]!.signal.aborted, false);
    assert.deepEqual(npcUpdates.at(-1).running, ["gurt"]);
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
    await request("start_npc", { characterId: "gurt" });
    await request("create_development_game");
    assert.equal(plans.at(-1)!.signal.aborted, true, "Game replacement cancels every old run");
    plans.at(-1)!.release();
    await new Promise(resolve => setImmediate(resolve));
  });

  await t.test("NPC conversations reserve a pair and restart an interrupted solo run after review", async t => {
    const created = await request("create_development_game");
    const saved = records.get(created.activeSaveId);
    saved.snapshot.npcActivities = Object.fromEntries(["corvin", "gurt"].map(id => [id, { status: "active", goal: "Ask for news.", history: [] }]));
    await request("load_game", { saveId: created.activeSaveId });
    const plans: Array<{ id: string; signal: AbortSignal; release: (value: any) => void }> = [];
    t.mock.method(BrowserGameRuntime.prototype, "planNpc", (id: string, signal: AbortSignal) => new Promise<any>(resolve => plans.push({ id, signal, release: resolve })));
    t.mock.method(BrowserGameRuntime.prototype, "stepNpcAction", () => ({ done: true, talkTarget: "gurt" }));
    let releaseTalk!: () => void, releaseReview!: () => void;
    let talkStarted!: () => void, reviewStarted!: () => void;
    const talking = new Promise<void>(resolve => { talkStarted = resolve; });
    const reviewing = new Promise<void>(resolve => { reviewStarted = resolve; });
    t.mock.method(BrowserGameRuntime.prototype, "executeNpcTalk", async () => {
      talkStarted(); await new Promise<void>(resolve => { releaseTalk = resolve; });
      reviewStarted(); await new Promise<void>(resolve => { releaseReview = resolve; });
      return { ok: true, text: "News exchanged." };
    });
    await request("start_npc", { characterId: "gurt" });
    await request("start_npc", { characterId: "corvin" });
    plans[1]!.release({ decision: { choice: "talk_gurt" }, action: { id: "talk_gurt", description: "Talk to Gurt" }, goal: "Ask for news." });
    await talking;
    assert.equal(plans[0]!.signal.aborted, true);
    await request("start_npc", { characterId: "gurt" });
    assert.equal(plans.length, 2, "A reserved target cannot start another solo run");
    releaseTalk(); await reviewing;
    await request("start_npc", { characterId: "gurt" });
    assert.equal(plans.length, 2, "The reservation lasts through GM publication");
    releaseReview();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(plans.slice(2).map(plan => plan.id).sort(), ["corvin", "gurt"]);
    await request("cancel_npc");
    for (const plan of plans) plan.release({});
    await new Promise(resolve => setImmediate(resolve));
  });

  for (const target of ["gurt", "player"]) await t.test(`stale ${target} conversation returns feedback to planning without an alert`, async t => {
    const created = await request("create_development_game"), saved = records.get(created.activeSaveId);
    saved.snapshot.npcActivities = { corvin: { status: "active", goal: "Ask for news.", history: [] } };
    await request("load_game", { saveId: created.activeSaveId });
    const feedback = { ok: false as const, error: "conversation_changed", instruction: "Inspect the fresh observation." };
    let replanned!: () => void;
    const planningAgain = new Promise<void>(resolve => { replanned = resolve; });
    let decisions = 0;
    t.mock.method(BrowserGameRuntime.prototype, "planNpc", async (_id: string, signal: AbortSignal, conflict: unknown) => {
      if (++decisions === 2) {
        assert.deepEqual(conflict, feedback);
        replanned();
        await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
        signal.throwIfAborted();
      }
      return { decision: { choice: `talk_${target}` }, action: { id: `talk_${target}`, description: "Ask for news" }, goal: "Ask for news." };
    });
    t.mock.method(BrowserGameRuntime.prototype, "stepNpcAction", () => ({ done: true, talkTarget: target }));
    t.mock.method(BrowserGameRuntime.prototype, target === "player" ? "initiatePlayerConversation" : "executeNpcTalk", async () => feedback);
    const alertCount = alerts.length;
    await request("start_npc", { characterId: "corvin" });
    await planningAgain;
    assert.equal(alerts.length, alertCount);
    assert.equal((await request("state")).state.npcActivities.corvin.status, "active");
    assert.equal(decisions, 2);
    await request("cancel_npc");
    await new Promise(resolve => setImmediate(resolve));
  });

  await t.test("active objectives continue beyond three goal reviews and stop on completion", { timeout: 15000 }, async t => {
    t.mock.method(JevClient.prototype, "evaluate", async (_state: unknown, questions: Record<string, unknown>) =>
      Object.fromEntries(Object.keys(questions).map(id => [id, { choice: "skip", probabilities: { [id]: 0, skip: 1 } }])));
    const created = await request("create_development_game"), saved = records.get(created.activeSaveId);
    saved.snapshot.npcActivities = { corvin: { status: "active", goal: "Step 1", history: [] } };
    await request("load_game", { saveId: created.activeSaveId });
    let goals = 0;
    t.mock.method(BrowserGameRuntime.prototype, "planNpc", async () => {
      assert.ok(++goals <= 4, "Must stop after the objective is completed");
      return { decision: { choice: goals === 4 ? "complete" : "unable" } };
    });
    t.mock.method(OpenRouterClient.prototype, "complete", async () => (commitReview({
      summary: "Reviewed progress", newNotes: ["Step completed"], activeGoal: goals === 4 ? null : "Step " + (goals + 1),
    })));
    await request("start_npc", { characterId: "corvin" });
    while ((await request("state")).state.npcActivities.corvin.status === "active"
      || npcUpdates.at(-1)?.running.includes("corvin")) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(goals, 4);
    assert.equal((await request("state")).state.npcActivities.corvin.status, "idle");
    await request("cancel_npc");
  });

  await t.test("busy conversation targets wait without repeated model decisions", async t => {
    const created = await request("create_development_game"), saved = records.get(created.activeSaveId);
    saved.snapshot.npcActivities = { corvin: { status: "active", goal: "Talk to Gurt", history: [] } };
    await request("load_game", { saveId: created.activeSaveId });
    await request("pause_npc", { characterId: "gurt" });
    let decisions = 0, conversations = 0;
    t.mock.method(BrowserGameRuntime.prototype, "planNpc", async () => {
      decisions++; return { decision: { choice: "talk_gurt" }, action: { id: "talk_gurt", description: "Talk to Gurt" }, goal: "Talk to Gurt" };
    });
    t.mock.method(BrowserGameRuntime.prototype, "stepNpcAction", () => ({ done: true, talkTarget: "gurt" }));
    t.mock.method(BrowserGameRuntime.prototype, "executeNpcTalk", async () => { conversations++; return { ok: true, text: "" }; });
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
    t.mock.method(BrowserGameRuntime.prototype, "checkedTalkToCharacter", async (_id: string, _message: string, _thinking: unknown, options: import("../packages/conversation/src/runtime.js").ConversationRuntimeOptions) => {
      await options.services!.presentation!.showRoll!({ characterId: "player", skill: "persuasion", difficulty: "normal", dc: 15, modifier: 3, natural: 12, total: 15, outcome: "barely_passes" as any, success: true }, new AbortController().signal);
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
    t.mock.method(JevClient.prototype, "evaluate", async (_input: unknown, questions: Record<string, unknown>) => Object.fromEntries(Object.keys(questions).map(skill => [skill, skill.startsWith("open_") ? { choice: "skip", probabilities: { [skill]: 0, skip: 1 } } : { choice: "not_needed", probabilities: { needed: 0, not_needed: 1 } }])));
    await request("create_development_game");
    t.mock.method(OpenRouterClient.prototype, "complete", async () => ({ role: "assistant", content: "Farewell." }));
    await request("talk", { characterId: "corvin", message: "Goodbye." });
    let release!: () => void;
    let started!: () => void;
    const reviewing = new Promise<void>(resolve => { started = resolve; });
    const waitForReview = new Promise<void>(resolve => { release = resolve; });
    const reviewResponse = (_input: any) => (commitReview({
      summary: "Reviewed", newNotes: ["The envoy said goodbye."], activeGoal: null,
    }));
    t.mock.method(OpenRouterClient.prototype, "complete", async (input: any) => {
      if (input.tools?.some((tool: any) => tool.function.name === "commit_review")) {
        started(); await waitForReview;
        return reviewResponse(input);
      }
      return { role: "assistant", content: "Hello." };
    });
    const review = request("end_conversation", { characterId: "corvin" });

    await reviewing;
    for (const type of ["talk", "end_conversation", "pause_npc", "start_npc"]) {
      await assert.rejects(request(type, { characterId: "corvin", message: "Again" }), /still reviewing/);
    }
    const destination = { x: 61, y: 24 };
    await request("move_player", { ...destination });
    await request("talk", { characterId: "gurt", message: "Hello." });
    release();
    const result = await review;
    assert.deepEqual(result.state.player.position, create(TilePositionSchema, destination));
    assert.equal(result.state.conversations.corvin, undefined);
    assert.equal(result.state.conversations.gurt.length, 2);
    const saved = records.get(result.activeSaveId).snapshot;
    assert.match(saved.world.docs["Scenarios/Centennial Assembly/Characters/corvin/character.md"].body, /envoy said goodbye/);

    t.mock.method(OpenRouterClient.prototype, "complete", async (input: any) => reviewResponse(input));
    failNextWrite = true;
    await assert.rejects(request("end_conversation", { characterId: "gurt" }), /Test storage failure/);
    assert.equal((await request("state")).state.conversations.gurt.length, 2, "Failed reviews retain their transcript for retry");
    await request("end_conversation", { characterId: "gurt" });
    assert.equal((await request("state")).state.conversations.gurt, undefined);
  });
});

test("dialogue UI releases the screen before review and ignores replaced-game results", async () => {
  const sent: any[] = [];
  let receive!: (event: any) => void;
  let endDialogue!: () => void;
  let finishDice!: (completed: boolean) => void;
  let diceSignal: AbortSignal | undefined;
  const context = createContext({
    URL, AbortController, AlertLog, coalescedRefresh, installDicePreview() {}, showDiceRoll: ({ signal }: { signal: AbortSignal }) => new Promise<boolean>(resolve => { diceSignal = signal; finishDice = resolve; }), window: {}, devOpenRouterApiKey: "", newTraveller: () => ({}), updateCourtMap() {},
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
  receive({ data: { type: "conversation_roll", requestId: talk.id, characterId: "mara", rollId: "roll-2", result: { skill: "persuasion" } } });
  receive({ data: { type: "cancel_conversation_roll", rollId: "unrelated" } });
  assert.equal(diceSignal?.aborted, false);
  receive({ data: { type: "cancel_conversation_roll", rollId: "roll-2" } });
  assert.equal(diceSignal?.aborted, true);
  finishDice(false); await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.at(-1).payload.completed, false);
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
  assert.ok(!fixtureActions(scenario.world?.fixtures, inventoryOwners(scenario.characters, scenario.world), "corvin").some(a => a.id === "inspect_item_envoy_token"));
  applyFixtureAction(scenario.world?.fixtures, inventoryOwners(scenario.characters, scenario.world), "corvin", "open_palace_treasury_shelf");
  assert.match(applyFixtureAction(scenario.world?.fixtures, inventoryOwners(scenario.characters, scenario.world), "corvin", "inspect_item_envoy_token"), /brass token/);
  applyFixtureAction(scenario.world?.fixtures, inventoryOwners(scenario.characters, scenario.world), "corvin", "take_envoy_token");
  assert.match(applyFixtureAction(scenario.world?.fixtures, inventoryOwners(scenario.characters, scenario.world), "corvin", "inspect_item_envoy_token"), /brass token/);
});
