import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, buildWorld, damageThing, type WorldSpec } from "../../world/scene-world.ts";
import { hangedClerkWorld } from "../../../scenes/worlds/hanged-clerk.ts";
import { drownedRatWorld } from "../../../scenes/worlds/drowned-rat.ts";
import type { MapActor, StoryState, Tile2 } from "../types.ts";
import {
  CAST, MAPS, actorsFromWorld, battlefield, captureScene, emptyOverlay, enterScene, feetToTile, getMap, heronWorld, dressingRoomWorld, interact, isStructure, leaveScene,
  move, newExploration, nearby, overlayActors, pathTo, reachable, regionForScene, render, renderExplore, screenOf, setStory, spotsNear, storyFromSession, tileAt, tileAtScreen, tileToFeet, toPlain,
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
  assert.ok(lines.flat().some(s => s.bg === "#ff4500" || s.bg === "#ff8c00" || s.bg === "#ffd000" || s.bg === "#ff6a00"), "something burns in fire colours");
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
