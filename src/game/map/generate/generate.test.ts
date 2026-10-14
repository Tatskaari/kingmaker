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
import { normalizePlan, type Problem } from "./normalize.ts";
import { chooseTurn, turnSide } from "./orient.ts";
import { PLAN_SCHEMA, castMember, type PlacePlan, type Planner } from "./plan.ts";
import { COMPACT_SCHEMA, partialPlan, readPlace, writePlace, type CompactPlan } from "./compact.ts";
import { drownedRat } from "../../../../scenes/drowned-rat.ts";
import { heronWarehouse } from "../../../../scenes/heron-warehouse.ts";
import { sceneCamera } from "./camera.ts";
import { fitView } from "./pictures.ts";
import { render } from "../render.ts";
import { castOf } from "../looks.ts";
import { actorLook } from "../../look/map.ts";
import type { MapTile } from "../tiles.ts";
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
  // A thing on something the plan forgot is put down in the room: a warning, not worth a repair round.
  assert.ok(validate(compilePlan(MUDDLED, { id: "test-muddled" })).some(p => p.severity === "warning" && /till is on something that isn't in the plan/.test(p.message)), "a missing target");
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
  visit(COMPACT_SCHEMA, "compact");
});

// ---------------------------------------------------------------------------------------------
// The second version: the look layer on the map, the scene's cast, composition, light, latency.

const allPlans = (): Array<[string, PlacePlan]> => [["TAVERN", TAVERN], ["WAREHOUSE", WAREHOUSE], ["MUDDLED_FIXED", MUDDLED_FIXED], ...Object.entries(JSON.parse(readFileSync(new URL("./model-plans.json", import.meta.url), "utf8")) as Record<string, PlacePlan>)];
const worldActors = (place: ReturnType<typeof compilePlan>) => actorsFromWorld(place.region, buildWorld(place.id, place.world, place.cast, { name: "you" }), { map: place.map });

test("the camera check asks the renderer: whatever glyph the look layer gives a thing, it's seen if taking it away changes the picture", () => {
  const place = compilePlan(TAVERN, { id: "test-camera" });
  const actors = worldActors(place);
  const cam = sceneCamera(place.map, actors);
  const fire = actors.find(a => a.ref === "fire")!;
  // The map's own glyph for a fire is Ψ; the look layer draws a flame. Either way it's seen.
  assert.notEqual(cam.view(place.furnished.start).flat().includes(fire.glyph), true, "the look layer doesn't draw the map's glyph");
  assert.equal(cam.seen(fire, place.furnished.start), true);
  // Something under a roof nobody lifted isn't.
  const outside = compilePlan(TAVERN, { id: "test-camera-2" });
  const street = outside.site.entrance!.outside;
  const outsiders = worldActors(outside);
  const stool = outsiders.find(a => a.ref === "chair")!;
  const lines = render(outside.map, worldActors(outside), fitView(outside.map).camera, fitView(outside.map).viewport, { time: "afternoon", focus: street, color: false });
  assert.ok(lines.length > 0);
  assert.equal(sceneCamera(outside.map, outsiders).seen(stool, street), true, "in the scene view the roof is off");
  assert.equal(sceneCamera(outside.map, outsiders).seen({ ...stool }, street), true, "a copy of an actor is the actor");
  // Something drawn just like the ground under it (a "~" in the shallows) is still seen.
  const shallows = outside.site.areas.get("river")!.tiles.find(p => outside.map.tiles[p.y]![p.x]!.terrain === "water")!;
  const slick: (typeof outsiders)[number] = { id: "slick", name: "some river water", kind: "item", glyph: "~", map: outside.map.id, at: shallows, ref: "slick" };
  assert.equal(actorLook(slick, { t: 0, time: "afternoon", glyphs: "ascii" }).glyph, "~");
  assert.equal(sceneCamera(outside.map, [...outsiders, slick]).seen(slick, shallows), true, "the river's own glyph, still seen");
});

test("the plan is terse: a line of fields per entry, about half as long, read back to the same map, and readable while it streams", () => {
  for (const [key, plan] of allPlans()) {
    const text = JSON.stringify(writePlace(plan));
    assert.ok(text.length < JSON.stringify(plan).length * 0.6, `${key} is shorter`);
    assert.equal(sketch(compilePlan(readPlace(JSON.parse(text)), { id: `rt-${key}` })), sketch(compilePlan(plan, { id: `rt-${key}` })), `${key} round-trips`);
    // Cut off anywhere after the things begin: the structure is there, then the things.
    const structure = partialPlan(text.slice(0, text.indexOf('"things"') + 9));
    assert.equal(structure?.stage, "structure");
    assert.equal(structure?.plan.rooms?.length, plan.rooms.length);
    const things = partialPlan(text.slice(0, text.indexOf('"people"') + 9));
    assert.equal(things?.stage, "things");
    assert.equal(things?.plan.things?.length, plan.things.length);
  }
  // Near misses are read as what they mean.
  const odd = readPlace({ place: "The Wick | a shop | 40 x 30 ft | 1 | wooden | wood | houses", outside: ["quay | the quay | south | 10 | boards-over-water"], rooms: ["shop | the shop | main"], doors: ["d | the door | shop -> quay | south | shut"], windows: [], things: ["lamp | a lamp | object small brass | shop | hung from the beams", "cat | the cat | creature small flesh | shop | next to lamp"], people: [], start: "quay" });
  const { plan } = normalizePlan(odd);
  assert.deepEqual([plan.walls, plan.floor, plan.surroundings, plan.outside[0]!.ground], ["timber", "boards", "buildings", "planks-over-water"]);
  assert.deepEqual([plan.things[0]!.relation, plan.things[1]!.relation, plan.things[1]!.target, plan.doors[0]!.to], ["overhead", "beside", "lamp", "quay"]);
  // Fields the model left out, or split in three, still land where they belong.
  const things = readPlace({ place: ["The Cooper's", "a workshop", "40x30"], outside: [["yard", "the yard", "south", "10", "dirt"]], rooms: [["shop", "the workshop", "main"]], doors: [], windows: [],
    things: [["bench", "a workbench", "object", "large", "wood", "shop", "against north", "4", "furniture", "A scarred bench."], ["fire", "a fire", "feature large stone", "shop", "corner north-east", "fire hearth lit", "It smokes."], ["cask", "a half-built cask", "shop", "centre"]], people: [], start: "yard" }).things;
  assert.deepEqual(things.map(t => [t.kind, t.size, t.material, t.in, t.relation, t.tiles]), [["object", "large", "wood", "shop", "against", 4], ["feature", "large", "stone", "shop", "corner", 1], ["object", "medium", "wood", "shop", "centre", 1]]);
  assert.deepEqual([things[0]!.tags, things[0]!.description, things[1]!.tags, things[1]!.states, things[1]!.description], [["furniture"], "A scarred bench.", ["fire", "hearth"], ["lit"], "It smokes."]);
});

test("real compact plans from the fast model (first rounds of the final runs, one per place, the cooper's with its kind, size and material split in three) read and pass every check", () => {
  const plans = JSON.parse(readFileSync(new URL("./model-compact-plans.json", import.meta.url), "utf8")) as Record<string, CompactPlan>;
  assert.equal(Object.keys(plans).length, 9);
  for (const [key, raw] of Object.entries(plans)) {
    const cast = key === "rat" ? drownedRat.cast.map(castMember) : key === "heron" ? heronWarehouse.cast.map(castMember) : undefined;
    const place = compilePlan(readPlace(raw), { id: `compact-${key}`, ...(cast ? { cast } : {}) });
    assert.deepEqual(errors(validate(place)), [], `${key}:\n${sketch(place)}`);
    assert.ok(place.furnished.things.size >= 5, `${key} is furnished`);
    if (cast) assert.ok(cast.every(c => place.laid.people.some(p => p.id === c.id)), `${key}: the whole cast is there, by their ids`);
  }
});

test("streaming: the building is laid out from the rooms before the things arrive, and is the one furnished", async () => {
  const text = JSON.stringify(writePlace(TAVERN));
  const streaming: Planner = async ({ onPartial }) => {
    // The model's text arriving in pieces.
    for (let i = 40; i <= text.length; i += 40) {
      const got = partialPlan(text.slice(0, i));
      if (got) onPartial?.(got.stage, readPlace(got.plan), i);
    }
    return { plan: readPlace(JSON.parse(text)), meta: fakeMeta, stages: {} };
  };
  const shells: Array<{ w: number; h: number }> = [];
  const made = await generatePlace("a tavern", { id: "test-stream", planner: streaming, onShell: shell => shells.push({ w: shell.site.building.w, h: shell.site.building.h }) });
  assert.equal(made.ok, true);
  assert.ok(shells.length >= 1, "a building before the things");
  assert.deepEqual(shells[0], { w: made.place!.site.building.w, h: made.place!.site.building.h }, "the same building as the furnished one");
  assert.ok(made.shellMs !== undefined && made.shellMs <= made.ms);
});

test("the scene's cast: the plan's people take their ids, those it leaves out are placed by relation, and everyone else gets a letter and a colour of their own", () => {
  const cast = [
    { id: "nan-quill", name: "Nan Quill", who: "the landlady" },
    { id: "dilly", name: "Dilly Sparrow", who: "an ancient bargewoman who deals cards at her table" },
    { id: "kell", name: "Sergeant Agnes Kell", who: "in a borrowed coat" },
  ];
  const plan: PlacePlan = { ...TAVERN, people: [
    ...TAVERN.people.filter(p => p.id !== "hobb"),
    { id: "dilly-sparrow", name: "Dilly Sparrow", in: "taproom", relation: "near", target: "card-table", note: "dealing" },
    { id: "mara", name: "Mara Wick", in: "taproom", relation: "near", target: "bar", note: "a chandler, drinking" },
    { id: "kell", name: "Old Mother Gristle", in: "taproom", relation: "centre", target: "", note: "a fishwife, whose id the model got wrong" },
  ] };
  const place = compilePlan(plan, { id: "test-cast", sceneId: "test-cast", cast: cast.filter(c => c.id !== "kell") });
  const ids = place.laid.people.map(p => p.id);
  assert.ok(ids.includes("dilly") && !ids.includes("dilly-sparrow"), "Dilly Sparrow is dilly");
  assert.ok(!ids.includes("kell"), "a fishwife given the id kell isn't Sergeant Kell");
  assert.ok(ids.some(id => id.startsWith("kell-")));
  // Left out: placed by relation (the card table is what her line mentions), not dropped in the middle.
  const withNan = compilePlan({ ...plan, people: plan.people.filter(p => p.id !== "nan-quill") }, { id: "test-cast-2", cast });
  const nan = withNan.furnished.people.get("nan-quill");
  assert.ok(nan, "Nan is placed though the plan left her out");
  assert.ok(withNan.problems.some(p => p.subject === "nan-quill" && p.severity === "warning"));
  // People outside the cast table: distinct letters and colours, not all p, drawn so on the map once installed.
  const looks = Object.values(place.looks);
  assert.ok(looks.length >= 2);
  assert.equal(new Set(looks.map(l => l.glyph)).size, looks.length);
  assert.equal(new Set(looks.map(l => l.color)).size, looks.length);
  assert.ok(!looks.some(l => l.glyph === "p" || l.glyph === "P" && looks.length < 2));
  const mara = place.looks["mara"]!;
  assert.equal(mara.glyph, "M");
  installPlace(place, { time: "evening" });
  try {
    const ex = newExploration({ time: "evening", played: [], lead: "test-cast", flags: {} }, { map: place.id, at: place.furnished.start });
    enterScene(ex, "test-cast");
    const drawn = toPlain(renderExplore(ex, { w: 90, h: 40 }, { world: buildWorld("test-cast", place.world, place.cast, { name: "you" }) }));
    assert.match(drawn, /M/, "Mara Wick is an M on the map");
  } finally {
    uninstallPlace(place);
  }
  assert.equal(castOf("mara"), undefined, "and is taken out of the cast table again");
});

test("composition: a main room of five squares each way, burrows timber-walled in their bank, strips no deeper than they need, the water where the camera sees it", () => {
  for (const [key, plan] of allPlans()) {
    for (const seed of [1, 2, 3]) {
      const place = compilePlan(plan, { id: `test-comp-${key}`, seed });
      const main = place.laid.rooms.find(r => r.where === "main")!;
      const tiles = new Set(place.site.areas.get(main.id)!.tiles.map(at));
      const roomy = [...tiles].some(k => { const [x, y] = k.split(",").map(Number) as [number, number]; for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) if (!tiles.has(`${x + dx},${y + dy}`)) return false; return true; });
      assert.ok(roomy, `${key} (seed ${seed}): the main room has five squares each way\n${sketch(place)}`);
      for (const side of ["north", "east", "south", "west"] as const) {
        const depth = place.laid.outside.filter(o => o.side === side && o.ground !== "boat").reduce((n, o) => n + (place.site.areas.get(o.id)?.rect ? (side === "north" || side === "south" ? place.site.areas.get(o.id)!.rect.h : place.site.areas.get(o.id)!.rect.w) : 0), 0);
        assert.ok(depth <= 13, `${key}: ${side} side's outside is ${depth} deep`);
      }
      if (place.laid.outside.some(o => o.ground === "water")) assert.ok(place.laid.outside.some(o => o.ground === "water" && (o.side === "south" || o.side === "west")), `${key}: the water's in front`);
    }
  }
  // A burrow: timber walls, the bank all round them, never a turf wall beside a floor.
  const rat = compilePlan(TAVERN, { id: "test-burrow" });
  const t = (x: number, y: number) => (rat.map.tiles as MapTile[][])[y]?.[x];
  for (let y = 0; y < rat.map.height; y++) for (let x = 0; x < rat.map.width; x++) {
    const here = t(x, y)!;
    if (here.roof === undefined) continue;
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) assert.notEqual(t(x + dx, y + dy)?.style, "bank", `bank beside the floor at ${x},${y}`);
  }
  assert.ok((rat.map.tiles as MapTile[][]).flat().some(x => x.style === "bank"), "the bank is round it");
  // A wharf on one side and the river on the other: the river comes round to the front.
  const behind: PlacePlan = { ...WAREHOUSE, outside: WAREHOUSE.outside.map(o => (o.id === "wharf" ? o : { ...o, side: "east" as const })), doors: WAREHOUSE.doors.map(d => (d.id === "river-door" ? { ...d, wall: "east" as const } : d)) };
  const front = compilePlan(behind, { id: "test-front" });
  assert.ok(front.laid.outside.filter(o => o.ground === "water" || o.ground === "boat").every(o => o.side === "south" || o.side === "west"));
  assert.deepEqual(errors(validate(front)), []);
});

test("variety: the seed moves doors off the middle, picks a side room's end, and sometimes leaves a back corner out (an L)", () => {
  const doors = new Set<string>(), notches = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) {
    const place = compilePlan(MUDDLED_FIXED, { id: "test-variety", seed });
    assert.deepEqual(errors(validate(place)), [], `seed ${seed}:\n${sketch(place)}`);
    const d = place.site.doors.find(x => x.id === "street-door")!;
    doors.add(at({ x: d.at.x - place.site.building.x, y: d.at.y - place.site.building.y }));
    const big = compilePlan({ ...MUDDLED_FIXED, rooms: MUDDLED_FIXED.rooms.filter(r => r.where === "main"), doors: MUDDLED_FIXED.doors.filter(x => x.id === "street-door"), width: 60, depth: 55 }, { id: "test-variety-l", seed });
    if (big.site.notch) notches.add(`${big.site.notch.x - big.site.building.x},${big.site.notch.y - big.site.building.y}`);
    assert.deepEqual(errors(validate(big)), [], `seed ${seed} (L):\n${sketch(big)}`);
  }
  assert.ok(doors.size >= 3, `the street door in ${doors.size} places`);
  assert.ok(notches.size >= 1, "some buildings are an L");
});

test("light from inside stays inside: no fire or lamp in a room reaches the turf outside (as render.ts walks a light's line, walls stop it)", () => {
  for (const [key, plan] of [...allPlans(), ["TAVERN-L", { ...TAVERN, width: 80, depth: 60 }] as [string, PlacePlan]]) {
    for (const seed of [1, 2]) {
      const place = compilePlan(plan, { id: `test-light-${key}`, seed });
      const tiles = place.map.tiles as MapTile[][];
      const open = new Set(place.world.things.filter(t => t.tags?.includes("door") && t.states?.includes("open")).map(t => `${Math.floor(t.at![0] / 5)},${Math.floor(t.at![1] / 5)}`));
      const passes = (x: number, y: number) => { const t = tiles[y]?.[x]; return !!t && (!t.opaque || open.has(`${x},${y}`)); };
      const room = (x: number, y: number) => { const a = place.site.area[y * place.map.width + x]; return !!a && !!place.site.areas.get(a)?.room; };
      for (const a of worldActors(place)) {
        const light = actorLook(a, { t: 0, time: "night", glyphs: "ascii" }).light;
        if (!light || !room(a.at.x, a.at.y)) continue;
        const r = light.radius;
        for (let y = Math.floor(a.at.y - r); y <= a.at.y + r; y++) for (let x = Math.floor(a.at.x - r); x <= a.at.x + r; x++) {
          const t = tiles[y]?.[x];
          const turf = t && (t.style === "bank" || t.terrain === "grass");
          if (!turf || Math.hypot(x - a.at.x, y - a.at.y) >= r) continue;
          // render.ts: every tile between the light and this one must let it through.
          const steps = Math.max(Math.abs(x - a.at.x), Math.abs(y - a.at.y));
          let clear = true;
          for (let i = 1; i < steps && clear; i++) clear = passes(Math.round(a.at.x + ((x - a.at.x) * i) / steps), Math.round(a.at.y + ((y - a.at.y) * i) / steps));
          assert.ok(!clear, `${key} (seed ${seed}): ${a.name} at ${at(a.at)} lights the turf at ${x},${y}\n${sketch(place)}`);
        }
      }
    }
  }
});

test("light: a big room by one fire gets lanterns where it's darkest; a small room doesn't", () => {
  const big = compilePlan({ ...TAVERN, width: 80, depth: 60 }, { id: "test-lamps" });
  const lamps = big.furnished.added.filter(t => /lantern/.test(t.name));
  assert.ok(lamps.length >= 1, `lanterns hung:\n${sketch(big)}`);
  assert.ok(big.world.things.some(t => t.id === lamps[0]!.id && t.states?.includes("lit")), "the world has them, lit");
  assert.deepEqual(errors(validate(big)), []);
  const small = compilePlan({ ...MUDDLED_FIXED, things: MUDDLED_FIXED.things.slice(0, 3) }, { id: "test-no-lamps" });
  assert.equal(small.furnished.added.filter(t => t.in === "workshop").length, 0);
});
