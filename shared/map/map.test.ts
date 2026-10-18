// Copied from the prototype's src/game/map/map.test.ts at 44c6d4a: its walking tests (29-198, 321-334, 343-350), each as it was but where it drew (the drawing is the client's: client/map). The maps are the campaign's files (useMaps), the yard's world its place file (usePlaces), and the lead's place waits as the prototype's presence built it (ExploreState.waiting: the simulation keeps it as rows). The other places' worlds come with their scenes (V3, V4), so their tests (80-120) wait for them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyOps, buildWorld, type WorldSpec } from "../world/scene-world.ts";
import type { PlaceFile } from "../scene/files.ts";
import type { MapActor, StoryState, Tile2 } from "./types.ts";
import { enterScene, interact, leaveScene, move, nearby, newExploration as fresh, pathTo, SCREEN_KEYS, type ExploreState } from "./explore.ts";
import { CAST } from "./looks.ts";
import { getMap, MAPS, useMaps } from "./maps.ts";
import { regionForScene, usePlaces } from "./places.ts";
import { leadMarker } from "./presence.ts";
import { actorsFromWorld, feetToTile, tileToFeet } from "./reconcile.ts";
import { isStructure, tileAt, type PlaceRegion } from "./tiles.ts";

const CAMPAIGN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const read = (path: string) => JSON.parse(readFileSync(join(CAMPAIGN, path), "utf8"));
useMaps((read("campaign.json").maps as string[]).map(key => read(`maps/${key}.json`)));
const hangedClerkWorld = read("places/granary-yard.json") as PlaceFile;
usePlaces([hangedClerkWorld]);

const MORNING: StoryState = { time: "morning", played: [], lead: "hanged-clerk", flags: {} };
const DUSK: StoryState = { time: "evening", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} };
const NIGHT: StoryState = { time: "night", played: ["hanged-clerk", "drowned-rat"], lead: "heron-warehouse", flags: {} };

const people = (ids: string[]) => ids.map(id => ({ id, name: CAST[id]!.name }));
const world = (scene: string, spec: WorldSpec, cast: string[]) => buildWorld(scene, spec, people(cast), { name: "Tester" });
const at = (a: MapActor | undefined) => a && `${a.at.x},${a.at.y}`;
const walkable = (mapId: string, p: Tile2) => { const t = tileAt(getMap(mapId), p); return !t.blocks && (!isStructure(t) || t.terrain === "door"); };

/** A fresh exploration, the granary yard waiting with its people in it while its scene is the lead (presence.ts: v2 draws it from its rows). */
function newExploration(story: StoryState, options: { map?: string; at?: Tile2 } = {}): ExploreState {
  const ex = fresh(story, options);
  if (story.lead === "hanged-clerk" && !story.played.includes("hanged-clerk")) ex.waiting = { "hanged-clerk": buildWorld("hanged-clerk", hangedClerkWorld, people(["kell", "cob", "moll"]), { name: "you" }) };
  return ex;
}

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
  // (The prototype's draws the marker: here, where it stands.)
  assert.deepEqual(leadMarker(DUSK, "caerwyn"), { at: { x: 26, y: 35 }, label: "the Drowned Rat" });
  const next: StoryState = { time: "next-morning", played: ["hanged-clerk", "drowned-rat", "heron-warehouse"], lead: "kings-morning", flags: {} };
  const morning = newExploration(next, { at: { x: 11, y: 15 } });
  const page = interact(morning);
  assert.equal(page?.interaction.kind, "scene");
  assert.equal((page?.interaction as { sceneId: string }).sceneId, "kings-morning");
});

test("screen keys get you through a door: down the river stairs and into the Rat by screen keys alone", () => {
  const ex = newExploration(DUSK, { map: "drowned-rat", at: { x: 2, y: 3 } });
  assert.ok(move(ex, ...SCREEN_KEYS.right!).moved, "a diagonal step onto the Rat's door");
  assert.equal(move(ex, ...SCREEN_KEYS.down!).trigger?.sceneId, "drowned-rat", "and down into the room");
});

test("the explore state saves and loads as plain JSON", () => {
  const ex = newExploration(DUSK, { at: { x: 42, y: 9 } });
  for (const [dx, dy] of pathTo(ex, { x: 30, y: 20 })!.slice(0, 8)) move(ex, dx, dy);
  const loaded = JSON.parse(JSON.stringify(ex)) as typeof ex;
  assert.deepEqual(loaded, ex);
});
