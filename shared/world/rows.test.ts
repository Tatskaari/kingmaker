import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { SceneDocument } from "../scene/document.ts";
import type { CampaignFile, PlaceFile } from "../scene/files.ts";
import { loadPlace, loadScenario, placePath, scenarioPath } from "../scene/scenario.ts";
import { inventory } from "./inventory.ts";
import { fullKey, isNewId, keysFor, localKey, opToGame, opToLocal, pcKey, rowsToWorld, worldToRows, type Keys, type PlaceRows } from "./rows.ts";
import { applyOps, buildWorld, joinWorld, worldView, type SceneWorld, type WorldOp } from "./scene-world.ts";

/**
 * The world contract (content-world B2): the hanged clerk's opening world goes to rows and back
 * exactly, and seven turns of every kind of operation, applied the simulation's way (rows → world
 * → applyOps → rows) and directly, give the same changes, problems, worlds and views. The check
 * script's own turns (tools/world-rows-check.mts), with the player's gear added.
 */

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const read = <T>(path: string) => JSON.parse(readFileSync(join(CAERWYN, path), "utf8")) as T;
const keys: Keys = keysFor("granary-yard", "hanged-clerk", pcKey(1n));

/** The world as the simulation opens the scene: the place, the cast present, the purse, the gear. */
function openingWorld(): SceneWorld {
  const campaign: CampaignFile = loadScenario(readFileSync(join(CAERWYN, scenarioPath("caerwyn")), "utf8"));
  const scene = read<SceneDocument>("scenes/hanged-clerk.kmscene");
  const present = scene.cast.filter(c => !c.enters).map(c => ({ id: c.id, name: c.name }));
  const world = buildWorld("hanged-clerk", loadPlace(readFileSync(join(CAERWYN, placePath("granary-yard")), "utf8")), present, { name: "Tamsin Vell" });
  joinWorld(world, present, 0);
  for (const coin of campaign.startingPurse) inventory(world, 0).add("player", coin);
  world.entities["tamsin-longbow"] = { id: "tamsin-longbow", name: "Tamsin's longbow", kind: "item", parent: "player", tags: ["weapon"], states: ["in hand"], notes: [], gear: "longbow-1" };
  world.entities["tamsin-studded-leather"] = { id: "tamsin-studded-leather", name: "Tamsin's studded leather", kind: "item", parent: "player", tags: ["armor"], states: ["worn"], notes: [], gear: "studded-leather-1" };
  return world;
}

/** Through JSON, as rows travel. */
const viaJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** Field order differs between built and rebuilt entities; compare as data, entities in the same order. */
const sameWorld = (a: SceneWorld, b: SceneWorld) => isDeepStrictEqual(Object.keys(a.entities), Object.keys(b.entities)) && isDeepStrictEqual(viaJson(a), viaJson(b));
/** The stage manager's id list (src/world/stage.ts:47). */
const ids = (w: SceneWorld) => Object.keys(w.entities).filter(id => id !== w.root);

const blank = { what: "", to: "", how: "", name: "", kind: "", text: "", add: [] as string[], remove: [] as string[] };
const TURNS: WorldOp[][] = [
  [{ ...blank, op: "note", what: "kell", text: "Says the porters found Prout at first light when they came to open the yard; they ran for the watch. She says the doors were padlocked and the loft door barred from inside." }],
  [{ ...blank, op: "state", what: "cob", add: ["sitting"] }, { ...blank, op: "forget", what: "cob", text: "lobbing" }, { ...blank, op: "move", what: "cob", to: "water-butt" }],
  [{ ...blank, op: "place", what: "moll", to: "gate", how: "behind" }, { ...blank, op: "give", what: "wheat-crown", to: "player" }, { ...blank, op: "give", what: "pennies", to: "cob", quantity: 2 }],
  [{ ...blank, op: "create", name: "a dead-cart", kind: "object", to: "gate", text: "Tull's handcart, a long ladder lashed on top" }, { ...blank, op: "create", name: "a meat pie", kind: "item", to: "kell" }],
  [{ ...blank, op: "remove", what: "moll", text: "over the wall into the lane" }, { ...blank, op: "drop", what: "boots" }, { ...blank, op: "state", what: "loft-door", add: ["open"], remove: ["closed", "barred"] }],
  [{ ...blank, op: "spill", name: "water", to: "water-butt", feet: 4 }, { ...blank, op: "destroy", what: "hoist-rope", text: "cut through" }, { ...blank, op: "ignite", what: "satchel" }],
  [{ ...blank, op: "move", what: "yard", to: "lane" }, { ...blank, op: "move", what: "elm", to: "yard" }, { ...blank, op: "give", what: "boots", to: "ledger-page" }, { ...blank, op: "place", what: "player", to: "elm", how: "away", feet: 20 }, { ...blank, op: "break", what: "smashed-lantern" }],
];

test("the opening world goes to rows and back exactly, and renders the same", () => {
  const world = openingWorld();
  const rows = viaJson(worldToRows(world, keys));
  const rebuilt = rowsToWorld(rows, keys);

  assert.ok(sameWorld(world, rebuilt));
  assert.equal(worldView(rebuilt), worldView(world));
  assert.equal(worldView(rebuilt, { full: true }), worldView(world, { full: true }));
  assert.deepEqual(ids(rebuilt), ids(world));
  assert.deepEqual(rows.entity.map(e => e.ord), rows.entity.map((_, i) => i + 1));
  assert.deepEqual(rows.entity.slice(0, 5).map(e => e.key), ["granary-yard", "granary-yard/lane", "granary-yard/yard", "granary-yard/loft", "pc:1"]);
  assert.ok(rows.entity.every(e => isNewId(e.id)));
  assert.deepEqual(rows.playerCharacter.map(p => p.playerId), ["1"]);
  assert.equal(rows.gear.length, 2);
});

test("seven turns of operations through rows give the same changes, problems, worlds and views as applied directly", () => {
  const direct = openingWorld();
  let rows = settled(viaJson(worldToRows(direct, keys)));

  for (const [i, ops] of TURNS.entries()) {
    const turn = i + 1;
    const straight = applyOps(direct, viaJson(ops), turn, "stage");
    const world = rowsToWorld(rows, keys);
    const throughRows = applyOps(world, viaJson(ops), turn, "stage");
    rows = settled(viaJson(worldToRows(world, keys, rows)));

    assert.deepEqual(throughRows, straight, `turn ${turn}: changes and problems`);
    assert.ok(sameWorld(direct, rowsToWorld(rows, keys)), `turn ${turn}: worlds`);
    assert.equal(worldView(rowsToWorld(rows, keys), { full: true }), worldView(direct, { full: true }), `turn ${turn}: views`);
  }

  assert.equal(rows.place.rev, 1 + TURNS.length);
  assert.deepEqual(rows.worldLog.map(l => l.seq), rows.worldLog.map((_, i) => i + 1));
});

test("entities keep their ids and order by key; new ones come after, with provisional ids", () => {
  const world = openingWorld();
  const rows = settled(viaJson(worldToRows(world, keys)));
  const before = new Map(rows.entity.map(e => [e.key, e]));
  const next = rowsToWorld(rows, keys);
  applyOps(next, [{ ...blank, op: "create", name: "a dead-cart", kind: "object", to: "gate" }], 4, "stage");
  const after = worldToRows(next, keys, rows);

  const kept = after.entity.filter(e => before.has(e.key));
  assert.ok(kept.every(e => e.id === before.get(e.key)!.id && e.ord === before.get(e.key)!.ord));
  assert.deepEqual(after.entity.filter(e => !before.has(e.key)).map(e => [e.key, e.id, e.ord]), [["granary-yard/dead-cart", `new:${rows.entity.length + 1}`, rows.entity.length + 1]]);
});

test("game keys and local ids convert both ways, and so do the stage manager's operations", () => {
  const world = openingWorld();

  assert.deepEqual(keys, { placeKey: "granary-yard", sceneKey: "hanged-clerk", players: { "pc:1": "1" }, controller: "pc:1" });

  assert.deepEqual(["player", "hanged-clerk:place", "kell", "elm"].map(l => fullKey(l, world.entities[l], keys)), ["pc:1", "granary-yard", "kell", "granary-yard/elm"]);
  assert.deepEqual(["pc:1", "granary-yard", "kell", "granary-yard/elm"].map(k => localKey(k, keys)), ["player", "hanged-clerk:place", "kell", "elm"]);

  const op: WorldOp = { ...blank, op: "give", what: "wheat-crown", to: "player" };
  const game = opToGame(op, world, keys);
  assert.deepEqual([game.what, game.to], ["granary-yard/wheat-crown", "pc:1"]);
  assert.deepEqual(opToLocal(game, keys), op);
  assert.equal(opToGame({ ...op, what: "all tag:flammable" }, world, keys).what, "all tag:flammable");
});

/** The rows as the simulation would write them: the provisional ids swapped for numbered ones (here, their order). */
function settled(rows: PlaceRows): PlaceRows {
  const real = new Map(rows.entity.map(e => [e.id, isNewId(e.id) ? String(e.ord) : e.id]));
  const id = (x: string) => real.get(x) ?? x;
  const swap = <T extends { entityId: string }>(list: T[]) => list.map(r => ({ ...r, entityId: id(r.entityId), placeId: "1" }));
  return {
    ...rows,
    place: { ...rows.place, id: "1", rootId: id(rows.place.rootId) },
    entity: rows.entity.map(e => ({ ...e, id: id(e.id), placeId: "1", ...(e.parentId !== undefined ? { parentId: id(e.parentId) } : {}) })),
    position: swap(rows.position), area: swap(rows.area), material: swap(rows.material), health: swap(rows.health), stack: swap(rows.stack), surface: swap(rows.surface),
    creature: swap(rows.creature), playerCharacter: swap(rows.playerCharacter), gear: swap(rows.gear), narrative: swap(rows.narrative), gmNote: swap(rows.gmNote),
    worldLog: rows.worldLog.map(l => ({ ...l, placeId: "1" })),
  };
}
