import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { rowsToWorld } from "../../../shared/world/rows.ts";
import { worldView, type SceneWorld, type WorldOp } from "../../../shared/world/scene-world.ts";
import { all, openedGame } from "../host/testing.ts";
import { getGm } from "../gm/rows.ts";
import { sceneGraph } from "../scenes.ts";
import { applyStage, placeWorldOf, savePlaceWorld } from "./place.ts";
import { LOG_TAIL, placeRows } from "./rows-io.ts";

/**
 * The world's write path on the memory host (content-world B2): what the gate does to a world
 * rebuilt from the rows, written back and read again, is the world the gate made, turn after turn;
 * entities keep their ids, new ones get the next, vanished ones lose their rows.
 */

const blank = { what: "", to: "", how: "", name: "", kind: "", text: "", add: [] as string[], remove: [] as string[] };

/** The stage manager's turns, by game keys (as the AI service sends them): pc is the player's character. */
const turns = (pc: string): WorldOp[][] => [
  [{ ...blank, op: "note", what: "kell", text: "Says the porters found Prout at first light." }, { ...blank, op: "state", what: "cob", add: ["sitting"] }],
  [{ ...blank, op: "give", what: "granary-yard/wheat-crown", to: pc }, { ...blank, op: "give", what: "granary-yard/pennies", to: "cob", quantity: 2 }],
  [{ ...blank, op: "create", name: "a dead-cart", kind: "object", to: "granary-yard/gate", text: "Tull's handcart" }, { ...blank, op: "create", name: "a meat pie", kind: "item", to: "kell" }],
  [{ ...blank, op: "give", what: "granary-yard/pennies-2", to: pc }, { ...blank, op: "remove", what: "moll", text: "over the wall" }, { ...blank, op: "drop", what: "granary-yard/boots" }],
  [{ ...blank, op: "spill", name: "water", to: "granary-yard/water-butt", feet: 4 }, { ...blank, op: "destroy", what: "granary-yard/hoist-rope", text: "cut through" }, { ...blank, op: "move", what: "granary-yard/yard", to: "granary-yard/lane" }],
  [{ ...blank, op: "remove", what: pc, text: "out of the gate" }, { ...blank, op: "ignite", what: "granary-yard/satchel" }],
];

/** Worlds alike as data: the same entities in the same order, field order aside. */
const sameWorld = (a: SceneWorld, b: SceneWorld) => isDeepStrictEqual(Object.keys(a.entities), Object.keys(b.entities)) && isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

test("each turn's operations, applied to the world rebuilt from rows and written back, give the world they give applied directly", async () => {
  const { host, scene, player } = await openedGame();
  const start = host.transact(tx => placeWorldOf(tx, scene));
  const direct = start.world;
  const idsBefore = new Map([...host.db.entity.placeId.filter(scene.placeId)].map(e => [e.key, e.id]));

  for (const [i, ops] of turns(`pc:${player.id}`).entries()) {
    const turn = i + 1;
    const straight = applyStage({ ...start, world: direct }, ops, turn);
    const throughRows = host.transact(tx => {
      const place = placeWorldOf(tx, scene);
      const done = applyStage(place, ops, turn);
      savePlaceWorld(tx, scene, place, sceneGraph(tx, scene, getGm(tx, scene.id)));
      return done;
    });
    const rows = host.transact(tx => placeRows(tx, scene.placeId));

    assert.deepEqual(throughRows, straight, `turn ${turn}: changes and problems`);
    assert.ok(sameWorld(rowsToWorld(rows, start.keys), { ...direct, log: direct.log.slice(-LOG_TAIL) }), `turn ${turn}: the world`);
    assert.equal(worldView(rowsToWorld(rows, start.keys), { full: true }), worldView({ ...direct, log: direct.log.slice(-LOG_TAIL) }, { full: true }), `turn ${turn}: the view`);
  }

  const entities = [...host.db.entity.placeId.filter(scene.placeId)];
  for (const e of entities) if (idsBefore.has(e.key)) assert.equal(e.id, idsBefore.get(e.key), `${e.key} kept its id`);
  assert.ok(entities.some(e => e.key === "granary-yard/dead-cart" && e.createdTurn === 3));
  assert.equal(entities.find(e => e.key === "granary-yard/pennies-2"), undefined, "the pennies given back joined the player's own: that entity and its rows are gone");
  assert.equal([...host.db.stack.placeId.filter(scene.placeId)].some(s => !entities.some(e => e.id === s.entityId)), false);
  assert.equal(entities.find(e => e.key === "moll")!.gone, true);
  assert.equal(entities.find(e => e.key === `pc:${player.id}`)!.gone, false, "the player is never removed");
  assert.ok([...host.db.surface.placeId.filter(scene.placeId)].length >= 1, "the spilt water is a surface");

  const log = [...host.db.worldLog.placeId.filter(scene.placeId)].sort((a, b) => a.seq - b.seq);
  assert.deepEqual(log.map(l => l.seq), log.map((_, i) => i + 1));
  assert.equal(log.length, direct.log.length, "every line kept, though only the last six are read");
  assert.equal(host.db.place.id.find(scene.placeId)!.rev, 1 + turns("").length);
});

test("a place's rows read as PlaceRows: ids as strings, entities in order, empty options left out, the log's last six", async () => {
  const { host, scene } = await openedGame();
  const rows = host.transact(tx => placeRows(tx, scene.placeId));

  assert.equal(rows.place.id, String(scene.placeId));
  assert.deepEqual(rows.entity.map(e => e.ord), [...rows.entity].map(e => e.ord).sort((a, b) => a - b));
  assert.ok(rows.entity.every(e => typeof e.id === "string" && !("gameId" in e)));
  assert.ok(rows.material.every(m => Object.values(m).every(v => v !== undefined)));
  assert.deepEqual(rows.worldLog.map(l => l.text), ["Wren Ashdown now has 2 silver crowns", "Wren Ashdown now has 6 shillings", "Wren Ashdown now has 12 pennies"]);
  assert.ok(rows.worldLog.every(l => !("id" in l) && l.placeId === String(scene.placeId)));
  assert.equal(all(host.db.worldLog).length, 3, "the purse's lines, all the opening logs");
});
