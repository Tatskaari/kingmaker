import { create, fromBinary, fromJsonString, toBinary } from "@bufbuild/protobuf";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import { AlertLog } from "../apps/web/src/alerts.js";
import { actionsAtTile, type CourtInteractionLayer } from "../apps/web/src/court-interactions.js";
import { courtCameraScroll, courtInteractionPoint, courtMarkers, courtPath, courtRoomAt, courtWalkPoint, nearestDoorSpot, redirectCourtPath } from "../apps/web/src/court-map.js";
import { coalescedRefresh } from "../apps/web/src/debug-live.js";
import { ModelTranscripts } from "../apps/web/src/model-transcripts.js";
import { palaceMap } from "../apps/web/src/palace-map.js";
import { TilePositionSchema, WorldMapSchema, WorldStateSchema, type Event } from "../packages/contracts/src/index.js";
import { doorActionLegality } from "../packages/core/src/access.js";
import { inventoryOwners, locatedItems } from "../packages/core/src/inventory.js";
import { worldForCharacter } from "../packages/core/src/physical-view.js";
import { commitReview, loadPlayableWorld, physicalFixture } from "./fixtures.js";

import { charactersWithinEarshot, courtCharactersWithinEarshot, EARSHOT_DISTANCE } from "../apps/web/src/earshot.js";
import { canWalk, findPath, pointKey } from "../apps/web/src/navigation.js";
import { palaceNodes } from "../apps/web/src/palace-navigation.js";


import { JevClient } from "../packages/providers/src/jev.js";
import { OpenRouterClient, type OpenRouterMessage } from "../packages/providers/src/openrouter.js";


const load = physicalFixture;

test("earshot uses tile distance and excludes the conversation partner", () => {
  const speaker = { id: "aldren", name: "The King", position: { x: 10, y: 10 } };
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

test("character knowledge refers to live fixtures and conceals other characters' secrets", () => {
  const scenario = load();
  const corvin = worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "corvin");
  const garran = worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "holt");
  const player = worldForCharacter(scenario.world!, inventoryOwners(scenario.characters, scenario.world), "player");
  assert.ok(corvin.objects.some(item => item.id === "palace_royal_key"));
  assert.ok(!corvin.objects.some(item => item.id === "palace_sealed_decree"));
  assert.ok(garran.objects.some(item => item.id === "palace_sealed_decree" && item.locationId === "palace_coffer_03"));
  assert.ok(!garran.objects.some(item => item.id === "palace_royal_key"));
  assert.ok(!player.objects.some(item => ["palace_sealed_decree", "palace_royal_key"].includes(item.id)));
  assert.equal(player.fixtures.find(item => item.id === "palace_coffer_03")!.revealedName, "");
});

test("unknown fixture fields remain schema errors", () => {
  assert.throws(() => fromJsonString(WorldStateSchema, '{"quests":[]}'));
});
const originalOpenRouterComplete = OpenRouterClient.prototype.complete;

const offer = (compelled: boolean, options = ["I want to protect my family.", "I intend to earn a place at court."]): OpenRouterMessage => ({
  role: "assistant", content: "What do you want from this journey?",
  tool_calls: [{ id: "offer-1", type: "function", function: {
    name: "offer_replies", arguments: JSON.stringify({ options, compelled }),
  } }],
});





const interviewBuild = { classId: "rogue", abilityPriority: ["dexterity", "charisma", "constitution", "intelligence", "wisdom", "strength"], skills: ["persuasion", "deception", "insight", "stealth"] };

// Script model responses to verify the complete conversation lifecycle offline.



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
  const listener = { id: "holt", name: "Garran", position: door.interactionSpots[1]! };
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
  const markers = courtMarkers(load().world.actors.filter(actor => actor.roomId === "great_hall").map(item => ({ id: item.characterId, name: item.characterId, roomId: item.roomId, position: item.position! })));
  assert.equal(new Set(markers.map(marker => pointKey(marker.point!))).size, load().world.actors.filter(actor => actor.roomId === "great_hall").length);
  assert.ok(markers.every(marker => courtRoomAt(marker.point!)?.id === "great_hall"));
  assert.ok(markers.every(marker => courtPath(markers[0]!.point!, marker.point!)));
  const corvin = courtMarkers([{ id: "corvin", name: "Corvin", roomId: "corvin_chamber", position: { x: 51, y: 5 } }])[0]!;
  assert.equal(courtRoomAt(corvin.point!)?.id, "corvin_chamber");
  assert.equal(courtMarkers([{ id: "aldren", name: "King", roomId: "nonexistent_room" }])[0]!.point, undefined);
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
  const restored = { world: fromBinary(WorldStateSchema, toBinary(WorldStateSchema, scenario.world)) };
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
  for (const [id, resident] of [["corvin_door", "corvin"], ["garran_door", "holt"], ["royal_door", "aldren"], ["guest_door", "player"]]) {
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
  assert.equal(doorActionLegality(hall, world.rooms, "aldren"), "normal");
  const restored = fromBinary(WorldStateSchema, toBinary(WorldStateSchema, load().world));
  assert.equal(doorActionLegality(restored.doors.find(door => door.id === "royal_door")!, restored.rooms, "player"), "illegal");
});

test("the nobles' parlour admits every court character but remains restricted to outsiders", () => {
  const scenario = load();
  const world = scenario.world!;
  const parlour = world.rooms.find(room => room.id === "guest_chamber")!;
  const door = world.doors.find(door => door.id === "guest_door")!;
  assert.equal(parlour.name, "Nobles' Parlour");
  assert.ok(parlour.private);
  for (const character of scenario.characters.filter(character => character.id !== "palace-guard")) {
    assert.equal(doorActionLegality(door, world.rooms, character.id), "normal", character.name);
  }
  assert.equal(doorActionLegality(door, world.rooms, "player"), "normal");
  assert.equal(doorActionLegality(door, world.rooms, "stranger"), "illegal");
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
  const resident = (slot: string) => ({ mara: "gurt", hadrik: "klog", tessa: "bran", lucan: "peregrine", sabine: "cressida", rook: "abel" } as Record<string, string>)[slot] ?? slot;
  for (const delegation of delegations) {
    assert.equal(courtRoomAt(delegation.publicPoint)?.id, delegation.publicRoom);
    assert.ok(courtPath({ x: 61, y: 24 }, delegation.publicPoint, world.doors, world.fixtures));
    const backHall = world.rooms.find(room => room.id === delegation.backHall)!;
    assert.equal(backHall.private, true);
    assert.deepEqual([...backHall.allowedCharacterIds].sort(), [...delegation.members.map(resident), ...world.actors.filter(actor => actor.characterId.startsWith("palace-guard-")).map(actor => actor.characterId)].sort());
    for (const member of delegation.members) {
      const actor = world.actors.find(actor => actor.characterId === resident(member))!;
      assert.equal(actor.homeRoomId, `${member}_chamber`);
      assert.equal(courtRoomAt(actor.position!)?.id, actor.roomId);
      assert.ok(courtPath({ x: 61, y: 24 }, actor.position!, openDoors, world.fixtures), `${member}'s room is reachable`);
    }
  }
});

test("the royal household has a public council chamber, private back hall and meeting-room doors", () => {
  const scenario = load(), world = scenario.world!;
  const council = world.rooms.find(room => room.id === "royal_council_chamber")!;
  const backHall = world.rooms.find(room => room.id === "north_corridor")!;
  assert.equal(council.name, "Royal Council Chamber");
  assert.equal(backHall.name, "Royal Back Hall");
  assert.equal(backHall.private, true);
  assert.deepEqual([...backHall.allowedCharacterIds].sort(), ["aldren", "corvin", "holt", ...world.actors.filter(actor => actor.characterId.startsWith("palace-guard-")).map(actor => actor.characterId)].sort());
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



// Exercise the new introduction independently of network responses or browser credentials.
import { introductionHandoff } from "../apps/web/src/introduction.js";

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
  let sequence = 0, failNextWrite = false, failNextRead = false, modelCalls = 0;
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
      const fail = mode === "readwrite" ? failNextWrite : failNextRead;
      if (mode === "readwrite") failNextWrite = false; else failNextRead = false;
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
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request in worker test"); });
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

  await t.test("creation autosave failures retain accepted changes in memory", async t => {
    t.mock.method(JevClient.prototype, "evaluate", async (_state: unknown, questions: Record<string, unknown>) =>
      Object.fromEntries(Object.keys(questions).map(id => [id, { choice: "skip", probabilities: { [id]: 0, skip: 1 } }])));
    failNextWrite = true;
    await request("gm", { message: "Alex" });
    assert.equal((await request("state")).state.gmMessages.length, 3);
    assert.match(alerts.at(-1).message, /autosave failed/);
    const ids = world.characters.map(path => /\/Characters\/([^/]+)\//.exec(path)![1]!);
    const input = { presentation: "A scholar in travel-worn clothes.", name: "Alex", gender: "nonbinary", homeland: "Independent", embassyRole: "Visiting scholar",
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
    await request("save_character", { draft: review.state.playerDraft });
    const pendingReview = await request("state");
    assert.equal(pendingReview.state.phase, "conversations");
    assert.equal(pendingReview.state.player.name, "Alex");
    assert.equal(records.get(fresh.activeSaveId).snapshot.world.player, undefined);
    await request("release_from_jail"); // Next successful autosave includes the accepted player.
    const reloaded = await request("load_game", { saveId: fresh.activeSaveId });
    assert.equal(reloaded.state.player.name, "Alex");
    assert.equal(reloaded.state.phase, "conversations");
  });

  await t.test("jail release settles outside the worker queue and survives failed autosave", async () => {
    const created = await request("create_development_game");
    records.get(created.activeSaveId).snapshot.jail = { characterId: "palace-guard", message: "You're nicked." };
    const loaded = await request("load_game", { saveId: created.activeSaveId });
    assert.equal(loaded.state.jail.characterId, "palace-guard");
    failNextWrite = true;
    await request("release_from_jail");
    assert.equal((await request("state")).state.jail, null);
    assert.equal(records.get(created.activeSaveId).snapshot.jail.characterId, "palace-guard");
    assert.equal((await request("release_from_jail")).state.jail, null);
    assert.equal(records.get(created.activeSaveId).snapshot.jail, undefined);
  });

  await t.test("movement takes only the save snapshot, rejects invalid writes, and survives failed autosave", async t => {
    const created = await request("create_development_game");
    const before = structuredClone(records.get(created.activeSaveId).snapshot);
    const snapshot = BrowserGameRuntime.prototype.snapshot;
    let snapshots = 0;
    t.mock.method(BrowserGameRuntime.prototype, "snapshot", function (this: BrowserGameRuntime) { snapshots++; return snapshot.call(this); });
    t.mock.method(BrowserGameRuntime.prototype, "restore", () => { throw new Error("Unexpected world rollback"); });
    await assert.rejects(request("move_player", { x: -1, y: -1 }), /not reachable/);
    assert.equal(snapshots, 0, "Rejected writes do not take a rollback or save snapshot");
    failNextWrite = true; failNextRead = true;
    const moved = await request("move_player", { x: 61, y: 24 });
    assert.deepEqual(moved.state.player.position, create(TilePositionSchema, { x: 61, y: 24 }));
    assert.equal(snapshots, 1, "Only the actual autosave serializes a snapshot");
    assert.equal(moved.saves, undefined, "Unavailable save metadata does not reject an accepted move");
    assert.deepEqual(records.get(created.activeSaveId).snapshot, before);
    assert.match(alerts.at(-1).message, /only in memory/);
    await request("move_player", { x: 61, y: 25 });
    const saved = records.get(created.activeSaveId).snapshot;
    assert.equal(saved.world.map.actors.find((actor: any) => actor.characterId === "player").position.y, 25);
    assert.equal(snapshots, 2);
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
    t.mock.method(OpenRouterClient.prototype, "complete", async (_input: any) => (commitReview({
      summary: "Reviewed progress", newNotes: ["Step completed"], activeGoal: goals === 4 ? null : "Step " + (goals + 1),
    }, _input)));
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
    }, _input));
    t.mock.method(OpenRouterClient.prototype, "complete", async (input: any) => {
      if (input.tools?.some((tool: any) => tool.function.name === "set_activity")) {
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
    await request("end_conversation", { characterId: "gurt" });
    assert.match(alerts.at(-1).message, /autosave failed/);
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
  const player = world.actors.filter(actor => actor.roomId === "great_hall").find(item => item.characterId === "player")!.position!;
  for (const placement of world.actors.filter(actor => actor.roomId === "great_hall")) {
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
