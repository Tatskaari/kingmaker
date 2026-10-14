import { readFileSync } from "node:fs";
process.env.KM_LOOK_MODEL = "off";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorld } from "../../../world/scene-world.ts";
import type { StoryState, Tile2 } from "../../types.ts";
import { enterScene, leaveScene, newExploration, renderExplore, sceneStart, regionForScene, getMap, actorsFromWorld, feetToTile, toPlain, isStructure } from "../index.ts";
import { liftOf } from "./camera.ts";
import { compilePlan } from "./compile.ts";
import { MUDDLED, MUDDLED_FIXED, TAVERN, WAREHOUSE } from "./fixtures.ts";
import { generatePlace } from "./generate.ts";
import { installPlace, uninstallPlace } from "./install.ts";
import type { Problem } from "./normalize.ts";
import { chooseTurn, turnSide } from "./orient.ts";
import { PLAN_SCHEMA, type PlacePlan, type Planner } from "./plan.ts";
import { sketch } from "./sketch.ts";
import { errorsOf, validate } from "./validate.ts";

const at = (p: Tile2) => `${p.x},${p.y}`;
const errors = (ps: Problem[]) => errorsOf(ps).map(p => `${p.check} ${p.subject}: ${p.message}`);
const fakeMeta = { text: "", costUsd: 0.001, latencyMs: 1, firstTextMs: 1, inputTokens: 100, outputTokens: 200, reasoningTokens: 0 };

test("a plan compiles to a well-formed map, lined up with its world (5 ft to a square, (0, 0) at the corner)", () => {
  const place = compilePlan(TAVERN, { id: "test-tavern", sceneId: "test-tavern" });
  const { map } = place;
  assert.equal(map.tiles.length, map.height);
  for (const row of map.tiles) assert.equal(row.length, map.width);
  for (const r of map.regions) assert.ok(r.rect.x >= 0 && r.rect.y >= 0 && r.rect.x + r.rect.w <= map.width && r.rect.y + r.rect.h <= map.height, `${r.id} is on the map`);
  assert.deepEqual(place.region.worldOrigin, { x: 0, y: 0 });
  assert.equal(place.region.sceneId, "test-tavern");
  // Every thing the world puts somewhere is on the square the furnisher chose, and the game draws it there.
  const world = buildWorld("test-tavern", place.world, place.cast, { name: "you" });
  const actors = actorsFromWorld(place.region, world, { map });
  for (const spec of place.world.things.filter(t => t.at)) {
    const p = place.furnished.things.get(spec.id);
    if (!p?.anchor) continue;
    assert.equal(at(feetToTile(place.region, { x: spec.at![0], y: spec.at![1] })), at(p.anchor), `${spec.id} lines up`);
  }
  for (const id of ["fire", "chair", "card-table", "rules-board", "nan-quill", "hobb", "cob"]) {
    const placed = place.furnished.things.get(id) ?? place.furnished.people.get(id);
    assert.equal(at(actors.find(a => a.ref === id)!.at), at(placed!.anchor!), `${id} is drawn where it was put`);
  }
  assert.equal(at(actors.find(a => a.kind === "player")!.at), at(place.furnished.start), "the player starts by the way in");
});

test("the hand-written plans pass every check; the muddled one doesn't, and says why in words a model can act on", () => {
  for (const [name, plan] of Object.entries({ TAVERN, WAREHOUSE, MUDDLED_FIXED })) {
    const place = compilePlan(plan, { id: `test-${name}` });
    assert.deepEqual(errors(validate(place)), [], `${name}:\n${sketch(place)}`);
  }
  const muddled = errors(validate(compilePlan(MUDDLED, { id: "test-muddled" })));
  assert.ok(muddled.some(e => /Only one room can be "main"/.test(e)), "two main rooms");
  assert.ok(muddled.some(e => /store's back door can't open from the store onto the street: the store doesn't touch the building's south wall/.test(e)), "a door on the wrong side");
  assert.ok(muddled.some(e => /till is on something that isn't in the plan/.test(e)), "a missing target");
  assert.ok(!muddled.some(e => /counter/.test(e)), "a room referred to by name is found");
});

test("the place is turned so its street faces the camera, and problems are told in the plan's own compass", () => {
  // The street on the north: turned half round, so it's in front (south) of the building.
  const north: PlacePlan = { ...TAVERN, outside: TAVERN.outside.map(o => ({ ...o, side: "north" as const })), doors: TAVERN.doors.map(d => (d.id === "front-door" ? { ...d, wall: "north" as const } : d)) };
  const turn = chooseTurn(north, "landing");
  assert.ok(["south", "west"].includes(turnSide(turn, "north")), "the street ends up in front");
  const place = compilePlan(north, { id: "test-north" });
  const door = place.site.doors.find(d => d.id === "front-door")!;
  assert.ok(door.at.y === place.site.building.y + place.site.building.h - 1 || door.at.x === place.site.building.x, "the street door is on a front wall");
  // A room on the street's side that can't reach it is reported against the plan's own walls.
  const wrong: PlacePlan = { ...north, doors: [...north.doors, { id: "back", name: "the back door", description: "", from: "scullery", to: "landing", wall: "north", states: ["closed"] }],
    rooms: north.rooms.map(r => (r.id === "scullery" ? { ...r, where: "south-east" as const } : r)) };
  const messages = validate(compilePlan(wrong, { id: "test-wrong" })).map(p => p.message);
  assert.ok(messages.some(m => /doesn't touch the building's north wall, where the landing on the river stairs is/.test(m)), messages.join("\n"));
  assert.ok(!messages.some(m => /@@/.test(m)), "no markers left in messages");
});

test("a bar stands a square off its wall with room behind it; huge stacks take the three squares the map draws them on", () => {
  const place = compilePlan(TAVERN, { id: "test-tavern-bar" });
  const bar = place.furnished.things.get("bar")!;
  assert.equal(bar.tiles.length, 4);
  assert.ok(bar.tiles.every(p => place.map.tiles[p.y]![p.x]!.terrain === "fence"), "the bar is a run of low wall, like the Rat's skiff");
  const behind = bar.tiles.map(p => ({ x: p.x, y: p.y - 1 }));
  assert.ok(behind.every(p => !isStructure(place.map.tiles[p.y]![p.x]!)), "a row to serve from behind it");
  assert.ok(behind.every(p => isStructure(place.map.tiles[p.y - 1]![p.x]!)), "and the wall behind that");
  const nan = place.furnished.people.get("nan-quill")!.anchor!;
  assert.ok(behind.some(p => at(p) === at(nan)), "Nan is behind the bar");

  const heron = compilePlan(WAREHOUSE, { id: "test-heron" });
  const world = buildWorld("test-heron", heron.world, heron.cast, { name: "you" });
  const actors = actorsFromWorld(heron.region, world, { map: heron.map });
  for (const id of ["wheat-sacks", "heron-sacks"]) {
    const drawn = actors.filter(a => (a.ref ?? a.id).split("#")[0] === id).map(a => at(a.at)).sort();
    assert.deepEqual(drawn, heron.furnished.things.get(id)!.tiles.map(at).sort(), `${id}: the map spreads it where the furnisher put it`);
  }
});

test("one actor to a screen cell: nothing hung up is drawn over anyone, and crowds land where the furnisher put them", () => {
  for (const plan of [TAVERN, WAREHOUSE]) {
    const place = compilePlan(plan, { id: "test-cells" });
    const world = buildWorld("test-cells", place.world, place.cast, { name: "you" });
    const actors = actorsFromWorld(place.region, world, { map: place.map }).filter(a => !place.site.doors.some(d => d.id === a.ref));
    const cells = new Map<string, string>();
    for (const a of actors) {
      const k = `${a.at.x + a.at.y},${a.at.y - a.at.x - liftOf(a)}`;
      assert.ok(!cells.has(k), `${a.name} and ${cells.get(k)} share a cell`);
      cells.set(k, a.name);
    }
    for (const crowd of plan.things.filter(t => t.kind === "crowd")) {
      const drawn = actors.filter(a => (a.ref ?? a.id).split("#")[0] === crowd.id).map(a => at(a.at)).sort();
      assert.deepEqual(drawn, place.furnished.things.get(crowd.id)!.tiles.map(at).sort(), `${crowd.id} spread as predicted`);
    }
  }
});

test("the camera check is the real renderer: the furnisher keeps out of a building's shadow, and what's put there is reported", () => {
  const yard: PlacePlan = {
    ...MUDDLED_FIXED,
    outside: [...MUDDLED_FIXED.outside, { id: "yard", name: "the back yard", description: "", side: "north", depth: 5, ground: "dirt" }],
    things: [...MUDDLED_FIXED.things, { id: "butt", name: "a water butt", kind: "object", size: "medium", material: "wood", tags: [], states: [], description: "", in: "yard", relation: "against", wall: "south", corner: "none", target: "", target2: "", tiles: 1 }],
  };
  const place = compilePlan(yard, { id: "test-yard" });
  assert.deepEqual(errors(validate(place)), [], "the butt went where the camera can see it (past the building's corner)");
  // Put it right behind the north wall, where the wall stands in front of it on screen.
  const b = place.site.building;
  const behind = { x: b.x + Math.floor(b.w / 2), y: b.y - 1 };
  const spec = place.world.things.find(t => t.id === "butt")!;
  spec.at = [behind.x * 5 + 2, behind.y * 5 + 2];
  const placed = place.furnished.things.get("butt")!;
  placed.tiles = [behind]; placed.anchor = behind;
  const hidden = validate(place).find(p => p.check === "hidden" && p.subject === "butt");
  assert.ok(hidden, "reported hidden");
  assert.match(hidden!.message, /the building's north wall is in front of it/);
});

test("the repair loop sends the problems back, and keeps the best round when repairs don't help", async () => {
  const asked: Array<{ previous?: PlacePlan; problems?: string[] }> = [];
  const fixing: Planner = async request => { asked.push(request); return { plan: asked.length === 1 ? MUDDLED : MUDDLED_FIXED, meta: fakeMeta }; };
  const fixed = await generatePlace("a shop planned in a hurry", { id: "test-repair", planner: fixing });
  assert.equal(fixed.ok, true);
  assert.equal(fixed.repairs, 1);
  assert.equal(asked.length, 2);
  assert.ok(asked[1]!.problems!.some(p => /Only one room can be "main"/.test(p)), "the problems went back to the model");
  assert.equal(asked[1]!.previous!.rooms.length, 3, "with the plan as the compiler understood it");
  assert.ok(Math.abs(fixed.costUsd - 0.002) < 1e-9);

  let calls = 0;
  const stubborn: Planner = async () => { calls++; return { plan: MUDDLED, meta: fakeMeta }; };
  const failed = await generatePlace("a shop planned in a hurry", { id: "test-stubborn", planner: stubborn });
  assert.equal(calls, 3, "two repairs at most");
  assert.equal(failed.ok, false);
  assert.ok(failed.place, "there's still a map to play on");
  assert.ok(failed.problems.length > 0);
});

test("installed, the game uses a generated place like a hand-made one: its scene opens there and draws it", () => {
  const place = compilePlan(TAVERN, { id: "generated-test-tavern", sceneId: "generated-test-tavern" });
  installPlace(place, { present: ["nan-quill", "hobb", "cob"], time: "evening" });
  try {
    assert.equal(getMap("generated-test-tavern"), place.map);
    const found = regionForScene("generated-test-tavern")!;
    assert.equal(found.map, place.map);
    assert.deepEqual(found.region.worldOrigin, { x: 0, y: 0 });
    assert.deepEqual(sceneStart("generated-test-tavern"), { map: place.id, at: place.furnished.start });
    // Draw it the way the app does in a scene: the world on the map, the roof off.
    const story: StoryState = { time: "evening", played: [], lead: "generated-test-tavern", flags: {} };
    const ex = newExploration(story, { map: place.id, at: place.furnished.start });
    enterScene(ex, "generated-test-tavern");
    const world = buildWorld("generated-test-tavern", place.world, place.cast, { name: "you" });
    const screen = toPlain(renderExplore(ex, { w: 80, h: 30 }, { world }));
    assert.match(screen, /@/);
    assert.match(screen, /N/, "Nan is drawn");
    // Without passing the map, reconcile finds it by its region.
    assert.ok(actorsFromWorld(found.region, world).length > 5);
    leaveScene(ex, world);
  } finally {
    uninstallPlace(place);
  }
  assert.equal(regionForScene("generated-test-tavern"), undefined, "and it can be taken out again");
});

test("real plans from the fast model (first rounds, one per place measured) compile and pass every check", () => {
  const plans = JSON.parse(readFileSync(new URL("./model-plans.json", import.meta.url), "utf8")) as Record<string, PlacePlan>;
  assert.equal(Object.keys(plans).length, 9);
  for (const [key, plan] of Object.entries(plans)) {
    const place = compilePlan(plan, { id: `model-${key}` });
    assert.deepEqual(errors(validate(place)), [], `${key}:\n${sketch(place)}`);
    assert.ok(place.furnished.things.size >= 5, `${key} is furnished`);
  }
});

test("the model's plan schema is strict (every property required, nothing extra), as the API demands", () => {
  const visit = (node: unknown, path: string): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; items?: unknown };
    if (n.type === "object") {
      assert.equal(n.additionalProperties, false, `${path}: no extra properties`);
      assert.deepEqual([...(n.required ?? [])].sort(), Object.keys(n.properties ?? {}).sort(), `${path}: all required`);
      for (const [k, v] of Object.entries(n.properties ?? {})) visit(v, `${path}.${k}`);
    }
    if (n.type === "array") visit(n.items, `${path}[]`);
  };
  visit(PLAN_SCHEMA, "plan");
});
