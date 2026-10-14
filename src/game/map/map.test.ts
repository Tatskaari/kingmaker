import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, buildWorld, damageThing, positionOf, tick, type WorldSpec } from "../../world/scene-world.ts";
import { douse, spill } from "../../world/systems.ts";
import { Effects } from "../look/effects.ts";
import { contrast, rgbOf } from "../look/color.ts";
import { hangedClerkWorld } from "../../../scenes/worlds/hanged-clerk.ts";
import { drownedRatWorld } from "../../../scenes/worlds/drowned-rat.ts";
import type { MapActor, StoryState, Tile2 } from "../types.ts";
import {
  CAST, MAPS, SCREEN_KEYS, actorsFromWorld, areaHazards, battlefield, captureScene, emptyOverlay, enterScene, feetToTile, getMap, heronWorld, dressingRoomWorld, interact, isStructure, leaveScene,
  move, newExploration, nearby, overlayActors, overlayRegionStates, overlaySurfaces, pathTo, reachable, regionForScene, render, renderExplore, screenOf, setStory, spotsNear, storyFromSession, tileAt, tileAtScreen, tileToFeet, toPlain,
  type PlaceRegion,
} from "./index.ts";

const MORNING: StoryState = { time: "morning", played: [], lead: "hanged-clerk", flags: {} };
const DUSK: StoryState = { time: "evening", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} };
const NIGHT: StoryState = { time: "night", played: ["hanged-clerk", "drowned-rat"], lead: "heron-warehouse", flags: {} };

const people = (ids: string[]) => ids.map(id => ({ id, name: CAST[id]!.name }));
const world = (scene: string, spec: WorldSpec, cast: string[]) => buildWorld(scene, spec, people(cast), { name: "Tester" });
const at = (a: MapActor | undefined) => a && `${a.at.x},${a.at.y}`;
const walkable = (mapId: string, p: Tile2) => { const t = tileAt(getMap(mapId), p); return !t.blocks && (!isStructure(t) || t.terrain === "door"); };
const width = (line: { text: string }[]) => line.reduce((n, s) => n + [...s.text].length, 0);
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const; };
/** A fire's colour: red well over green and blue. */
const fiery = (hex: string) => { const [r, g, b] = rgb(hex); return r > 110 && r > g * 1.6 && r > b * 2.5; };

test("every map is well formed: rows, regions inside, exits to real, standable tiles, unique region ids", () => {
  const ids = new Set<string>();
  for (const [id, def] of Object.entries(MAPS)) {
    const map = def.map;
    assert.equal(map.id, id);
    assert.equal(map.tiles.length, map.height);
    for (const row of map.tiles) assert.equal(row.length, map.width);
    for (const r of map.regions) {
      assert.ok(!ids.has(r.id), `region id ${r.id} is unique`);
      ids.add(r.id);
      assert.ok(r.rect.x >= 0 && r.rect.y >= 0 && r.rect.x + r.rect.w <= map.width && r.rect.y + r.rect.h <= map.height, `${id}:${r.id} inside the map`);
    }
    for (const e of map.exits) {
      assert.ok(MAPS[e.to.map], `${id} exit to a known map (${e.to.map})`);
      assert.ok(walkable(e.to.map, e.to.at), `${id} exit "${e.label}" lands on a standable tile`);
    }
  }
  for (const scene of ["hanged-clerk", "drowned-rat", "heron-warehouse", "kings-morning"]) {
    const found = regionForScene(scene);
    assert.ok(found?.region.worldOrigin, `${scene} has a place with a world origin`);
  }
});

test("feet and tiles: 5 ft to a tile from the region's origin, and back to the tile's centre", () => {
  const { region } = regionForScene("hanged-clerk")!;
  assert.deepEqual(feetToTile(region, { x: 0, y: 0 }), { x: 40, y: 9 });
  assert.deepEqual(feetToTile(region, { x: 14, y: 12 }), { x: 42, y: 11 });
  assert.deepEqual(tileToFeet(region, { x: 42, y: 11 }), { x: 12.5, y: 12.5 });
  assert.deepEqual(feetToTile(region, tileToFeet(region, { x: 47, y: 15 })), { x: 47, y: 15 });
});

test("the granary yard lines up with the hanged-clerk world", () => {
  const { map, region } = regionForScene("hanged-clerk")!;
  const actors = actorsFromWorld(region, world("hanged-clerk", hangedClerkWorld, ["kell", "cob", "moll"]));
  const byRef = (ref: string) => actors.find(a => a.ref === ref);
  assert.equal(at(byRef("gate")), "42,10", "the yard gate is the gate in the shoulder-high wall");
  assert.equal(tileAt(map, byRef("gate")!.at).terrain, "door");
  assert.equal(at(byRef("loft-door")), "47,12");
  assert.equal(at(byRef("yard-doors")), "47,15");
  assert.ok(byRef("prout")!.states!.includes("hanging"), "Prout hangs from the hoist");
  assert.equal(at(byRef("prout")), "46,13", "under the hoist beam, by the granary's back wall");
  assert.equal(at(byRef("water-butt")), "40,16", "the water butt in the yard's corner");
  assert.equal(byRef("moll")!.at.y, 10, "Moll sits on the wall");
  for (const id of ["player", "kell", "cob"]) assert.ok(walkable("caerwyn", byRef(id)!.at), `${id} stands somewhere standable`);
  const loft = (map.regions as PlaceRegion[]).find(r => r.id === "tally-loft")!;
  const desk = byRef("tally-desk")!.at;
  assert.ok(desk.x >= loft.rect.x && desk.x < loft.rect.x + loft.rect.w, "the tally desk is in the loft");
  assert.equal(byRef("elm"), undefined, "the elm is terrain until something happens to it");
  assert.equal(new Set(actors.filter(a => a.blocks && (a.kind === "person" || a.kind === "player")).map(at)).size, actors.filter(a => a.blocks && (a.kind === "person" || a.kind === "player")).length, "no two people in one square");
});

test("the Drowned Rat lines up with its world: door, fire, bar, people on the floor", () => {
  const { region } = regionForScene("drowned-rat")!;
  const actors = actorsFromWorld(region, world("drowned-rat", drownedRatWorld, ["kell", "nan-quill", "arlo", "dilly", "hobb", "cob"]));
  const byRef = (ref: string) => actors.find(a => a.ref === ref);
  assert.equal(at(byRef("door")), "3,4");
  assert.equal(at(byRef("fire")), "11,8", "the blue fire is in the fireside corner, by the east wall");
  assert.equal(byRef("bar-counter"), undefined, "the skiff-hull bar is drawn as the bar itself");
  assert.equal(at(byRef("nan-quill")), "6,5", "Nan is behind the bar");
  for (const id of ["player", "kell", "nan-quill", "arlo", "dilly", "hobb", "cob"]) assert.ok(walkable("drowned-rat", byRef(id)!.at), `${id} is on the floor`);
  assert.ok(actors.filter(a => a.ref === "regulars").length >= 3, "the regulars are a crowd");
});

test("the Heron's world: a dusty floor, sacks inside, doors on doors, people where they can stand", () => {
  const w = world("heron-warehouse", heronWorld, ["kell", "saul", "hep", "scrope", "hobb"]);
  assert.ok(w.entities.floor!.states.includes("dusty"));
  const { map, region } = regionForScene("heron-warehouse")!;
  const actors = actorsFromWorld(region, w);
  const byRef = (ref: string) => actors.find(a => a.ref === ref);
  const floor = (map.regions as PlaceRegion[]).find(r => r.id === "heron-floor")!.rect;
  for (const id of ["wheat-ear-sacks", "heron-sacks", "floor-brazier", "trestles", "chute"]) {
    const p = byRef(id)!.at;
    assert.ok(p.x >= floor.x && p.x < floor.x + floor.w && p.y >= floor.y && p.y < floor.y + floor.h, `${id} is on the re-sacking floor`);
  }
  assert.equal(tileAt(map, byRef("land-door")!.at).terrain, "door");
  assert.equal(tileAt(map, byRef("river-door")!.at).terrain, "door");
  for (const id of ["player", "kell", "saul", "hep", "scrope", "hobb"]) assert.ok(walkable("heron", byRef(id)!.at), `${id} stands somewhere standable`);
  assert.equal(actors.filter(a => a.ref === "wheat-ear-sacks").length, 3, "a huge stack covers three tiles");
  // Fire on the floor sets the dust off.
  damageThing(w, w.entities["heron-sacks"]!, 2, "fire", 1);
  assert.ok(w.entities["heron-sacks"]!.states.includes("burning"));
});

test("the King's dressing room world places everyone in the room", () => {
  const { region } = regionForScene("kings-morning")!;
  const actors = actorsFromWorld(region, world("kings-morning", dressingRoomWorld, ["king", "holt", "kell"]));
  for (const id of ["player", "king", "holt", "kell"]) {
    const a = actors.find(x => x.ref === id)!;
    assert.ok(a.at.x >= region.rect.x && a.at.x < region.rect.x + region.rect.w && a.at.y >= region.rect.y && a.at.y < region.rect.y + region.rect.h, `${id} is in the dressing room`);
  }
});

test("walking: walls stop you, the yard opens the scene, Kell waits to be talked to", () => {
  const ex = newExploration(MORNING);
  assert.deepEqual(ex.at, { x: 42, y: 9 });
  const wall = move(ex, -1, 1);
  assert.equal(wall.moved, false, "the yard wall is in the way");
  const gate = move(ex, 0, 1);
  assert.ok(gate.moved);
  assert.equal(gate.trigger, undefined, "the gateway isn't the yard yet");
  const talk = interact(ex);
  assert.equal(talk?.interaction.kind, "scene");
  assert.equal(talk?.actor?.ref, "kell");
  const yard = move(ex, 0, 1);
  assert.equal(yard.trigger?.sceneId, "hanged-clerk");
  assert.equal(yard.trigger?.verb, "enter");
  // Walking into Kell is talking to her.
  const bump = newExploration(MORNING, { at: { x: 42, y: 10 } });
  const r = move(bump, 1, 1);
  assert.equal(r.moved, false);
  assert.equal(r.bumped?.ref, "kell");
  assert.equal(r.trigger?.verb, "talk");
});

test("places keep their hours: the Rat is shut in the morning and opens at dusk", () => {
  const morning = newExploration(MORNING, { at: { x: 25, y: 35 } });
  const shut = move(morning, 1, 0);
  assert.equal(shut.moved, false);
  assert.match(shut.message ?? "", /OPENS AT DUSK/);
  const dusk = newExploration(DUSK, { at: { x: 25, y: 35 } });
  const door = move(dusk, 1, 0);
  assert.equal(door.travelled?.to, "drowned-rat");
  move(dusk, 0, 1);
  const inside = move(dusk, 0, 1);
  assert.equal(inside.trigger?.sceneId, "drowned-rat");
  // Once played, it's just a pub (no scene) and still open.
  const later = newExploration(NIGHT, { map: "drowned-rat", at: { x: 3, y: 3 } });
  move(later, 0, 1);
  const again = move(later, 0, 1);
  assert.ok(again.moved);
  assert.equal(again.trigger, undefined);
});

test("after its scene the yard is locked up (seen over the wall), and a scene can't strand you in a barred loft", () => {
  const ex = newExploration(DUSK, { at: { x: 42, y: 10 } });
  const refused = move(ex, 0, 1);
  assert.equal(refused.moved, false);
  assert.match(refused.message ?? "", /locked up for the Assembly/);
  const inside = newExploration(DUSK, { at: { x: 43, y: 12 } });
  assert.ok(pathTo(inside, { x: 42, y: 9 }), "but you can always get out");
  // The granary scene ends with the player up in the tally loft, the loft door still barred.
  const loft = newExploration(MORNING);
  enterScene(loft, "hanged-clerk");
  const w = world("hanged-clerk", hangedClerkWorld, ["kell", "cob", "moll"]);
  applyOps(w, [{ op: "move", what: "player", to: "tally-desk", how: "near", name: "", kind: "", text: "", add: [], remove: [] }], 3);
  leaveScene(loft, w);
  assert.deepEqual(loft.at, { x: 42, y: 9 }, "back in the lane, outside the gate");
});

test("a walk across town: the path to the Rat's door is followed step by step, Kell in tow", () => {
  const ex = newExploration(DUSK, { at: { x: 42, y: 9 } });
  assert.equal(ex.followers[0]?.id, "kell");
  const path = pathTo(ex, { x: 25, y: 35 });
  assert.ok(path && path.length > 20);
  for (const [dx, dy] of path!) assert.ok(move(ex, dx, dy).moved);
  assert.deepEqual(ex.at, { x: 25, y: 35 });
  assert.ok(Math.max(Math.abs(ex.followers[0]!.at.x - 25), Math.abs(ex.followers[0]!.at.y - 35)) <= 1, "Kell is right behind");
  assert.ok(nearby(ex, 1).some(n => n.interaction?.kind === "travel"), "the Rat's door is to hand");
});

test("the lead: a marker over the next place, and the page at the palace gate the next morning", () => {
  const ex = newExploration(DUSK);
  const lines = renderExplore(ex, { w: 80, h: 24 }, { color: false });
  assert.match(toPlain(lines), /[▼▽↓↘↙←→↑↖↗]/);
  const next: StoryState = { time: "next-morning", played: ["hanged-clerk", "drowned-rat", "heron-warehouse"], lead: "kings-morning", flags: {} };
  const morning = newExploration(next, { at: { x: 11, y: 15 } });
  const page = interact(morning);
  assert.equal(page?.interaction.kind, "scene");
  assert.equal((page?.interaction as { sceneId: string }).sceneId, "kings-morning");
});

test("render: exact viewport, the player drawn, fire and wreckage shown, plain mode has no colours", () => {
  const map = getMap("drowned-rat");
  const { region } = regionForScene("drowned-rat")!;
  const w = world("drowned-rat", drownedRatWorld, ["nan-quill", "dilly"]);
  damageThing(w, w.entities["card-table"]!, 2, "fire", 1);
  applyOps(w, [{ op: "destroy", what: "long-table", to: "", how: "", name: "", kind: "", text: "smashed", add: [], remove: [] }], 1);
  const actors = actorsFromWorld(region, w);
  for (const viewport of [{ w: 80, h: 24 }, { w: 120, h: 40 }, { w: 41, h: 13 }]) {
    const lines = render(map, actors, { x: 6, y: 7 }, viewport, { time: "evening", roofs: false });
    assert.equal(lines.length, viewport.h);
    for (const line of lines) assert.equal(width(line), viewport.w);
  }
  const lines = render(map, actors, { x: 6, y: 7 }, { w: 80, h: 24 }, { time: "evening", roofs: false, tick: 3 });
  const text = toPlain(lines);
  assert.match(text, /@/);
  assert.ok(lines.flat().some(s => !!s.bg && fiery(s.bg)), "something burns in fire colours");
  assert.match(text, /[∴%]/, "the wrecked table is rubble");
  const plain = render(map, actors, { x: 6, y: 7 }, { w: 80, h: 24 }, { color: false });
  assert.ok(plain.flat().every(s => !s.fg && !s.bg));
});

test("screen and tiles: tileAtScreen inverts screenOf", () => {
  const camera = { x: 30, y: 20 }, viewport = { w: 80, h: 24 };
  const owner = new Set<string>();
  for (let y = 12; y <= 28; y++) for (let x = 22; x <= 38; x++) {
    const t = { x, y };
    const s = screenOf(t, camera, viewport);
    for (const [cx, cy] of [[s.x - 1, s.y], [s.x, s.y], [s.x + 1, s.y], [s.x, s.y + 1]] as const) {
      assert.deepEqual(tileAtScreen(cx, cy, camera, viewport), t, `cell (${cx}, ${cy}) belongs to tile (${x}, ${y})`);
      assert.ok(!owner.has(`${cx},${cy}`), "no cell belongs to two tiles");
      owner.add(`${cx},${cy}`);
    }
  }
});

test("the overlay: what a scene did stays on the map after it, and fires burn out by a later hour", () => {
  const ex = newExploration(DUSK, { map: "drowned-rat", at: { x: 3, y: 5 } });
  enterScene(ex, "drowned-rat");
  const w = world("drowned-rat", drownedRatWorld, ["kell", "nan-quill", "dilly"]);
  damageThing(w, w.entities["card-table"]!, 2, "fire", 1);
  applyOps(w, [{ op: "destroy", what: "benches", to: "", how: "", name: "", kind: "", text: "matchwood", add: [], remove: [] }], 2);
  leaveScene(ex, w);
  assert.equal(ex.scene, undefined);
  assert.ok(walkable(ex.map, ex.at), "the player is back on their feet");
  const saved = JSON.parse(JSON.stringify(ex.overlay)) as typeof ex.overlay;
  const now = overlayActors(saved, "drowned-rat", "evening");
  assert.ok(now.find(a => a.ref === "card-table")!.states!.includes("burning"));
  assert.ok(now.find(a => a.ref === "benches")!.states!.includes("destroyed"));
  const later = overlayActors(saved, "drowned-rat", "night");
  assert.ok(later.find(a => a.ref === "card-table")!.states!.includes("burnt"));
  assert.ok(!later.find(a => a.ref === "card-table")!.states!.includes("burning"));
  assert.equal(later.some(a => a.ref === "nan-quill"), false, "people move on with the story");
  // And the town shows nothing from it unless the place itself burned.
  assert.deepEqual(captureScene(emptyOverlay(), regionForScene("drowned-rat")!.region, w).scenes["drowned-rat"]!.states, []);
});

test("the Heron goes up in smoke: ablaze from the town that night, a charred ruin the next morning", () => {
  const w = world("heron-warehouse", heronWorld, ["saul", "hep"]);
  damageThing(w, w.entities["heron-sacks"]!, 4, "fire", 1);
  tick(w, 2, 11);
  assert.ok(w.entities.floor!.states.includes("exploded"), "the dust went up");
  const overlay = captureScene(emptyOverlay(), regionForScene("heron-warehouse")!.region, w, "night");
  const town = getMap("caerwyn");
  assert.ok(overlayRegionStates(overlay, town, "night")["heron-exterior"]!.includes("burning"));
  const after = overlayRegionStates(overlay, town, "next-morning")["heron-exterior"]!;
  assert.ok(after.includes("burnt") && !after.includes("burning"));
  const lines = render(town, [], { x: 48, y: 38 }, { w: 80, h: 24 }, { time: "night", regionStates: overlayRegionStates(overlay, town, "night"), tick: 1 });
  assert.match(toPlain(lines), /[\^▲*]/, "flames over the Heron");
});

test("for combat: the battlefield, free spots for the Crakes, a move range, marks and a cursor", () => {
  const w = world("heron-warehouse", heronWorld, ["kell", "saul", "hep", "scrope", "hobb", "sallow"]);
  const field = battlefield("heron-warehouse", w)!;
  assert.equal(field.map.id, "heron");
  for (const id of ["player", "kell", "saul", "hep", "scrope", "hobb", "sallow"]) assert.ok(field.people[id], `${id} has a tile`);
  assert.ok(field.obstacles.some(o => o.id === "wheat-ear-sacks"), "the sack stacks stand in the way");
  assert.ok(!field.obstacles.some(o => o.id === "hoist"), "the hoist is overhead, not in the way");
  const crakes = spotsNear(field.map, field.people.sallow!, 2, Object.values(field.people));
  assert.equal(crakes.length, 2);
  for (const c of crakes) {
    assert.ok(walkable("heron", c));
    assert.ok(!Object.values(field.people).some(p => p.x === c.x && p.y === c.y), "nobody's already there");
  }
  const range = reachable(field.map, field.people.hep!, 6);
  assert.ok(range.length > 20 && range.every(r => r.steps <= 6 && walkable("heron", r.at)));
  assert.ok(!range.some(r => r.at.y >= 14), "nobody walks through the Heron's south wall onto the river side");
  const lines = render(field.map, [], field.people.hep!, { w: 80, h: 24 }, { roofs: false, marks: range.map(r => ({ at: r.at, color: "#3a78c8" })), cursor: field.people.sallow! });
  assert.match(toPlain(lines), /\[.\]/, "the cursor brackets its tile");
  assert.ok(lines.flat().filter(s => s.bg && s.bg !== "").length > 10);
});

test("a fight's fuel: flammable things that stand in the way, and flammable spills on the floor", () => {
  const w = world("heron-warehouse", heronWorld, ["kell", "saul", "hep"]);
  const { region } = regionForScene("heron-warehouse")!;
  const before = battlefield("heron-warehouse", w)!.fuel;
  assert.ok(before.length > 5, "the sack stacks burn");
  const place = w.entities[w.root]!.rect!;
  const { surface } = spill(w, "oil", { x: place.x + place.w / 2, y: place.y + place.h / 2 }, 4, 1);
  const slick = feetToTile(region, positionOf(w, surface.id)!);
  assert.ok(!before.some(p => p.x === slick.x && p.y === slick.y), "nothing burned there before");
  const after = battlefield("heron-warehouse", w)!.fuel;
  assert.ok(after.some(p => p.x === slick.x && p.y === slick.y), "an oil slick on the floor is fuel");
  spill(w, "water", { x: place.x + 4, y: place.y + 4 }, 4, 1);
  assert.equal(battlefield("heron-warehouse", w)!.fuel.length, after.length, "a puddle of water isn't");
});

test("screen keys move with the screen: up is up, right is right", () => {
  const camera = { x: 30, y: 20 }, viewport = { w: 80, h: 24 };
  const from = screenOf(camera, camera, viewport);
  const delta = (k: string) => { const [dx, dy] = SCREEN_KEYS[k]!; const s = screenOf({ x: 30 + dx, y: 20 + dy }, camera, viewport); return [s.x - from.x, s.y - from.y] as [number, number]; };
  assert.ok(delta("up")[0] === 0 && delta("up")[1] < 0);
  assert.ok(delta("down")[0] === 0 && delta("down")[1] > 0);
  assert.ok(delta("left")[0] < 0 && delta("left")[1] === 0);
  assert.ok(delta("right")[0] > 0 && delta("right")[1] === 0);
  // And they get you through a door: down the river stairs and into the Rat by screen keys alone.
  const ex = newExploration(DUSK, { map: "drowned-rat", at: { x: 2, y: 3 } });
  assert.ok(move(ex, ...SCREEN_KEYS.right!).moved, "a diagonal step onto the Rat's door");
  assert.equal(move(ex, ...SCREEN_KEYS.down!).trigger?.sceneId, "drowned-rat", "and down into the room");
});

test("the player is drawn through a wall that hides them, picked out", () => {
  const ex = newExploration(DUSK, { map: "drowned-rat", at: { x: 3, y: 3 } });
  const lines = renderExplore(ex, { w: 80, h: 24 });
  const me = lines.flat().find(s => s.text.includes("@"));
  assert.ok(me, "the player is on screen");
  assert.equal(me!.bg, "#6a3a8a", "drawn through the Rat's front wall");
});

test("the explore state saves and loads as plain JSON", () => {
  const ex = newExploration(DUSK, { at: { x: 42, y: 9 } });
  for (const [dx, dy] of pathTo(ex, { x: 30, y: 20 })!.slice(0, 8)) move(ex, dx, dy);
  const loaded = JSON.parse(JSON.stringify(ex)) as typeof ex;
  assert.deepEqual(loaded, ex);
  const a = toPlain(renderExplore(ex, { w: 60, h: 18 })), b = toPlain(renderExplore(loaded, { w: 60, h: 18 }));
  assert.equal(a, b);
});

test("the whole arc through the API, as the app drives it: granary, Rat, Heron, the page, the King", () => {
  // A stand-in for the scene session: the runtime's createSession/openScene/chainScene would do this.
  const session = { sceneId: "hanged-clerk", history: [] as Array<{ sceneId: string }> };
  const casts: Record<string, [WorldSpec, string[]]> = {
    "hanged-clerk": [hangedClerkWorld, ["kell", "cob", "moll"]], "drowned-rat": [drownedRatWorld, ["kell", "nan-quill", "arlo", "dilly", "hobb", "cob"]],
    "heron-warehouse": [heronWorld, ["kell", "saul", "hep", "scrope", "hobb"]], "kings-morning": [dressingRoomWorld, ["kell", "king", "holt"]],
  };
  const ex = newExploration(storyFromSession(session));
  const mapNow = (): string => ex.map;
  /** Walk to a tile, stopping if a scene opens on the way. */
  const walkTo = (to: Tile2) => {
    for (const [dx, dy] of pathTo(ex, to) ?? []) { const r = move(ex, dx, dy); if (r.trigger) return r.trigger; }
    return undefined;
  };
  /** Play a scene: open its place, build its world, end it, and move the story on. */
  const play = (sceneId: string, next: string | undefined) => {
    enterScene(ex, sceneId);
    const [spec, cast] = casts[sceneId]!;
    const w = world(sceneId, spec, cast);
    const lines = renderExplore(ex, { w: 80, h: 24 }, { world: w });
    assert.match(toPlain(lines), /@/, `${sceneId}: the player is in the scene view`);
    leaveScene(ex, w);
    session.history.push({ sceneId });
    if (next) session.sceneId = next;
    setStory(ex, storyFromSession(session));
  };

  // Morning: through the gate into the yard.
  let trigger = walkTo({ x: 42, y: 12 });
  assert.equal(trigger?.sceneId, "hanged-clerk");
  play("hanged-clerk", "drowned-rat");
  assert.equal(ex.story.time, "evening");
  assert.equal(ex.followers[0]?.id, "kell");

  // Dusk: down the river stairs to the Rat's door, and in.
  assert.equal(walkTo({ x: 25, y: 35 }), undefined);
  const r = move(ex, 1, 0);
  assert.equal(r.travelled?.to, "drowned-rat");
  trigger = walkTo({ x: 3, y: 6 });
  assert.equal(trigger?.sceneId, "drowned-rat");
  play("drowned-rat", "heron-warehouse");
  assert.equal(ex.story.time, "night");

  // Night: out of the Rat (the scene leaves you where its world did), down to the wharves, along to the Heron.
  if (mapNow() === "drowned-rat") walkTo({ x: 12, y: 3 });
  assert.equal(mapNow(), "caerwyn", "out of the Rat and back in the town");
  trigger = walkTo({ x: 47, y: 38 });
  assert.equal(trigger?.sceneId, "heron-warehouse");
  play("heron-warehouse", "kings-morning");
  assert.equal(ex.story.time, "next-morning");

  // The next morning: back along the wharf from the Heron, up through the town to the page at the palace gate.
  if (mapNow() === "heron") walkTo({ x: 0, y: 5 });
  assert.equal(mapNow(), "caerwyn");
  walkTo({ x: 11, y: 15 });
  const page = interact(ex);
  assert.equal(page?.interaction.kind, "scene");
  play("kings-morning", undefined);
  assert.deepEqual(ex.story.played, ["hanged-clerk", "drowned-rat", "heron-warehouse", "kings-morning"]);
  assert.equal(ex.story.lead, undefined, "the end of the story: nowhere left to go");
});

test("storyFromSession: played scenes, the lead and the time of day", () => {
  assert.deepEqual(storyFromSession({ sceneId: "hanged-clerk", history: [] }), { time: "morning", played: [], lead: "hanged-clerk", flags: {} });
  const afterRat = storyFromSession({ sceneId: "heron-warehouse", history: [{ sceneId: "hanged-clerk" }, { sceneId: "drowned-rat" }] });
  assert.equal(afterRat.lead, "heron-warehouse");
  assert.equal(afterRat.time, "night");
  const interlude = storyFromSession({ sceneId: "caerwyn-afternoon", history: [{ sceneId: "hanged-clerk" }] });
  assert.equal(interlude.lead, "drowned-rat", "an interlude points on to where it leads");
  assert.equal(interlude.time, "afternoon");
  const ex = newExploration(storyFromSession({ sceneId: "drowned-rat", history: [{ sceneId: "hanged-clerk" }] }));
  assert.deepEqual(ex.at, { x: 42, y: 9 }, "after the granary, back in the lane");
  setStory(ex, { ...ex.story, flags: { kell: false } });
  assert.equal(ex.followers.length, 0, "the story can part the player and Kell");
});

// ---------------------------------------------------------------------------------------------
// The look on the map (src/game/look): things, ground, surfaces, light and effects, alive.

/** The character and colours at a viewport cell. */
function cellAt(lines: Array<Array<{ text: string; fg?: string; bg?: string }>>, x: number, y: number): { ch: string; fg?: string; bg?: string } {
  let n = 0;
  for (const span of lines[y]!) {
    const chars = [...span.text];
    if (x < n + chars.length) return { ch: chars[x - n]!, ...(span.fg ? { fg: span.fg } : {}), ...(span.bg ? { bg: span.bg } : {}) };
    n += chars.length;
  }
  return { ch: " " };
}

test("the look on the map: a burning thing flickers, the Rat's driftwood fire lights it blue, and walls stop the light", () => {
  const map = getMap("drowned-rat");
  const { region } = regionForScene("drowned-rat")!;
  const w = world("drowned-rat", drownedRatWorld, ["nan-quill", "dilly", "hobb"]);
  damageThing(w, w.entities["long-table"]!, 3, "fire", 1);
  const actors = actorsFromWorld(region, w);
  const camera = { x: 6, y: 7 }, size = { w: 80, h: 24 };
  const frame = (t: number) => render(map, actors, camera, size, { time: "night", roofs: false, t, worlds: [{ region, world: w }] });
  const table = screenOf(actors.find(a => a.ref === "long-table")!.at, camera, size);
  const a = frame(1000), b = frame(1500);
  assert.notDeepEqual(cellAt(a, table.x, table.y), cellAt(b, table.x, table.y), "half a second later the burning table looks different");
  assert.ok([-1, 0, 1].some(dx => fiery(cellAt(a, table.x + dx, table.y).bg!)), "and it's in fire colours");
  // The blue driftwood fire (11, 8): the floor beside it is lit blue; the floor across the room isn't.
  const bg = (p: Tile2) => { const s = screenOf(p, camera, size); return rgb(cellAt(a, s.x, s.y).bg!); };
  const lit = bg({ x: 10, y: 8 }), far = bg({ x: 3, y: 9 });
  assert.ok(lit[2] > lit[0] && lit[2] > far[2] + 20, `the fireside is blue (${lit}) and brighter than the far wall's floor (${far})`);
  // Put the fire out: the floor beside it goes dark, the river outside the east wall doesn't change.
  const out = structuredClone(w);
  out.entities.fire!.states = ["unlit"];
  const dark = render(map, actorsFromWorld(region, out), camera, size, { time: "night", roofs: false, t: 1000, worlds: [{ region, world: out }] });
  const at = (lines: typeof a, p: Tile2) => { const s = screenOf(p, camera, size); return cellAt(lines, s.x, s.y); };
  assert.notDeepEqual(at(a, { x: 10, y: 8 }), at(dark, { x: 10, y: 8 }), "the fire lights the floor beside it");
  assert.deepEqual(at(a, { x: 13, y: 10 }), at(dark, { x: 13, y: 10 }), "the wall keeps its light in");
});

test("surfaces lie on the ground, not as actors: a douse leaves a puddle the map draws, kept after the scene", () => {
  const { map, region } = regionForScene("drowned-rat")!;
  const w = world("drowned-rat", drownedRatWorld, ["nan-quill"]);
  const table = w.entities["long-table"]!;
  damageThing(w, table, 3, "fire", 1);
  douse(w, table, 2);
  const surfaces = Object.values(w.entities).filter(e => e.kind === "surface");
  assert.ok(surfaces.some(e => e.tags.includes("water")) && surfaces.some(e => e.tags.includes("steam")), "a puddle and a puff of steam");
  const actors = actorsFromWorld(region, w);
  assert.ok(!actors.some(a => w.entities[a.ref ?? ""]?.kind === "surface"), "surfaces aren't actors");
  const camera = { x: 6, y: 7 }, size = { w: 80, h: 24 };
  const wet = render(map, actors, camera, size, { time: "evening", roofs: false, t: 2000, worlds: [{ region, world: w }] });
  const dry = render(map, actors, camera, size, { time: "evening", roofs: false, t: 2000 });
  const s = screenOf(feetToTile(region, surfaces.find(e => e.tags.includes("water"))!.at!), camera, size);
  const changed = [-3, -2, -1, 1, 2, 3].filter(dx => JSON.stringify(cellAt(wet, s.x + dx, s.y)) !== JSON.stringify(cellAt(dry, s.x + dx, s.y)));
  assert.ok(changed.length >= 2, "the puddle lies on the floor round the table");
  // The scene ends: the place keeps its puddle (the steam has gone by a later hour).
  const ex = newExploration(DUSK, { map: "drowned-rat", at: { x: 3, y: 5 } });
  enterScene(ex, "drowned-rat");
  leaveScene(ex, w);
  const kept = overlaySurfaces(JSON.parse(JSON.stringify(ex.overlay)), map, "night")[0]!;
  const patches = Object.values(kept.world.entities).filter(e => e.kind === "surface");
  assert.ok(patches.some(e => e.tags.includes("water")) && !patches.some(e => e.tags.includes("cloud")), "the puddle stays, the steam doesn't");
});

test("effects play on the map: a fireball bursts over its aim, Kell's bark floats over her, plain text stays quiet", () => {
  const { map, region } = regionForScene("drowned-rat")!;
  const w = world("drowned-rat", drownedRatWorld, ["kell", "dilly"]);
  const actors = actorsFromWorld(region, w);
  const fx = new Effects({ now: () => 0, seed: 2 });
  const aim = positionOf(w, "card-table")!;
  fx.effect("fireball", { from: positionOf(w, "player")!, at: aim, radius: 15 }, 0);
  fx.bark("kell", "Was that strictly necessary?", {}, 0);
  const camera = { x: 6, y: 7 }, size = { w: 80, h: 24 };
  const effects = { region, frame: fx.frame(900, id => positionOf(w, id)) };
  const quiet = render(map, actors, camera, size, { time: "evening", roofs: false, t: 900 });
  const loud = render(map, actors, camera, size, { time: "evening", roofs: false, t: 900, effects });
  assert.match(toPlain(loud), /strictly/, "the bark is drawn over the map");
  const s = screenOf(feetToTile(region, aim), camera, size);
  let burst = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -5; dx <= 5; dx++) if (JSON.stringify(cellAt(loud, s.x + dx, s.y + dy)) !== JSON.stringify(cellAt(quiet, s.x + dx, s.y + dy))) burst++;
  assert.ok(burst > 15, `the fireball's burst covers the cells round its aim (${burst} changed)`);
  const plain = (extra: object) => toPlain(render(map, actors, camera, size, { time: "evening", roofs: false, t: 900, color: false, ...extra }));
  assert.equal(plain({ effects }), plain({}), "plain text has no effects in it");
});

test("a world's areas on its map: the Heron's floor hangs with dust; when it goes up, it's scorched and on fire", () => {
  const { map, region } = regionForScene("heron-warehouse")!;
  const w = world("heron-warehouse", heronWorld, ["saul", "hep"]);
  const before = areaHazards(region, w, map);
  assert.ok(before.dust.length > 40 && !before.fire.length && !before.scorched.length, "the re-sacking floor is thick with dust");
  assert.ok(before.dust.every(p => p.x >= 9 && p.x <= 18 && p.y >= 3 && p.y <= 12), "and only the floor");
  assert.deepEqual(before.dust, battlefield("heron-warehouse", w)!.dust, "the dust a fight here will use, no more (none under the stacks)");
  damageThing(w, w.entities["heron-sacks"]!, 4, "fire", 1);
  tick(w, 2, 11);
  const after = areaHazards(region, w, map);
  assert.ok(!after.dust.length && after.scorched.length > 40 && after.fire.length > 40, "the dust went up: scorched, and burning");
  const ex = newExploration(NIGHT);
  enterScene(ex, "heron-warehouse");
  const lines = renderExplore(ex, { w: 80, h: 24 }, { world: w, t: 500 });
  assert.ok(lines.flat().filter(s => !!s.bg && fiery(s.bg)).length > 20, "the Heron's floor burns on the map");
});

test("glyph sets on the map: plain is seven-bit; plain text stays single-width whatever the set", () => {
  const ex = newExploration(DUSK, { at: { x: 30, y: 30 } });
  const plain = toPlain(renderExplore(ex, { w: 100, h: 30 }, { glyphs: "plain", t: 700 }));
  assert.deepEqual([...plain].filter(ch => ch !== "\n" && ch.charCodeAt(0) >= 128), [], "seven-bit only");
  assert.match(plain, /@/);
  // Every glyph has a stand-in (the Corn Exchange's price board), and a bark in the GM's punctuation is seven-bit too.
  const board = toPlain(renderExplore(newExploration(MORNING, { at: { x: 35, y: 22 } }), { w: 120, h: 40 }, { glyphs: "plain", t: 1000 }));
  assert.doesNotMatch(board, /\?/, "no glyph without a stand-in");
  const w = world("drowned-rat", drownedRatWorld, ["kell", "nan-quill"]);
  const rat = newExploration(DUSK);
  enterScene(rat, "drowned-rat");
  const fx = new Effects({ now: () => 0 });
  fx.bark("nan-quill", "No credit—not for bluebottles… “not ever”", {}, 0);
  const barked = toPlain(renderExplore(rat, { w: 100, h: 30 }, { world: w, glyphs: "plain", t: 400, effects: { region: regionForScene("drowned-rat")!.region, frame: fx.frame(400, id => positionOf(w, id)) } }));
  assert.match(barked, /No credit-not for/);
  assert.deepEqual([...barked].filter(ch => ch !== "\n" && (ch.charCodeAt(0) >= 128 || ch === "?")), [], "the bark is seven-bit, no ?");
  const icons = /[-]|[\u{f0000}-\u{fffff}]/u;
  assert.ok(icons.test(toPlain(renderExplore(ex, { w: 100, h: 30 }, { glyphs: "nerd", t: 700 }))), "the nerd set draws icons in colour (the lamp posts)");
  assert.ok(!icons.test(toPlain(renderExplore(ex, { w: 100, h: 30 }, { glyphs: "nerd", color: false }))), "but plain text never does");
});

test("the fallen have a mark at their feet, in plain text and in colour; the hanged clerk hangs under his beam", () => {
  const w = world("drowned-rat", drownedRatWorld, ["kell", "hobb"]);
  const ex = newExploration(DUSK);
  enterScene(ex, "drowned-rat");
  const size = { w: 80, h: 24 }, glyphs = "ascii" as const;
  assert.doesNotMatch(toPlain(renderExplore(ex, size, { world: w, color: false, glyphs })), /K_/, "standing, Kell is a K");
  w.entities.kell!.states.push("unconscious");
  assert.match(toPlain(renderExplore(ex, size, { world: w, color: false, glyphs })), /K_/, "knocked out, she has a mark at her feet");
  const lines = renderExplore(ex, size, { world: w, t: 500, glyphs });
  const y = lines.findIndex(l => l.map(s => s.text).join("").includes("K_"));
  const x = [...lines[y]!.map(s => s.text).join("")].indexOf("K") + 1;
  const mark = cellAt(lines, x, y);
  assert.ok(contrast(rgbOf(mark.fg!), rgbOf(mark.bg!)) >= 3, `and in colour the mark shows in the dusk (${mark.fg} on ${mark.bg})`);
  // The hoist in the granary lane: the beam, the rope down from it, Prout's body on the end of it.
  const lane = newExploration(MORNING, { at: { x: 44, y: 14 } });
  const rows = toPlain(renderExplore(lane, { w: 60, h: 24 }, { color: false, glyphs: "ascii" })).split("\n");
  const s = screenOf({ x: 46, y: 13 }, lane.at, { w: 60, h: 24 });
  assert.deepEqual([-4, -3].map(dy => [...rows[s.y + dy]!][s.x]), ["╤", "│"], "the beam above, the rope from it");
});
