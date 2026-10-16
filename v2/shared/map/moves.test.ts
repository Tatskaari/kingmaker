import { test } from "node:test";
import assert from "node:assert/strict";
import { actionId, LEAD, moveOf, OUT } from "./moves.ts";

/** The map's moves and the prototype's action ids (src/game/town.ts's header at 44c6d4a), both ways (map-design §3.2). */

test("every kind of the prototype's action id is made with one move, and that move names it again", () => {
  const ids = [
    "walk_north", "walk_southwest", "go_to_lead", "go_to_market_square", "walk@30,22",
    "interact", "look", "look@29,21", "talk_kell", "talk_palace_guard_2", "examine_the_old_elm", "enter_granary_yard", "take_pennies", "open_door_north",
    "talk@42,11", "enter@42,11", "door@27,3",
    "travel_up_the_river_stairs", "travel@26,35",
  ];
  for (const id of ids) {
    const move = moveOf(id);
    assert.ok(move, id);
    assert.equal(actionId(move), id, id);
  }
  assert.deepEqual(moveOf("walk_north"), { move: "walk", args: { toward: "north" } });
  assert.deepEqual(moveOf("go_to_lead"), { move: "walk", args: { toward: LEAD } });
  assert.deepEqual(moveOf("talk_kell"), { move: "interact", args: { verb: "talk", target: "kell" } });
  assert.deepEqual(moveOf("door@27,3"), { move: "interact", args: { verb: "open", at: { x: 27, y: 3 } } });
  assert.deepEqual(moveOf("travel_up_the_river_stairs"), { move: "travel", args: { way: "up_the_river_stairs" } });
});

test("walking out of an ended scene has no id of the prototype's, and an id that's no map action's has no move", () => {
  assert.equal(actionId({ move: "walk", args: { toward: OUT } }), undefined);
  assert.equal(actionId({ move: "interact", args: { verb: "take" } }), undefined);
  for (const id of ["say_2", "attack@3,4", "cast_fire-bolt", "walk_upwards", "continue"]) assert.equal(moveOf(id), undefined, id);
});
