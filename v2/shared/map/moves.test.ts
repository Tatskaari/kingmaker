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
  for (const id of ["say_2", "say_goodbye", "attack_crake_1", "attack@3", "walk_upwards", "continue"]) assert.equal(moveOf(id), undefined, id);
});

test("the action menu's ids (src/game/menu.ts's header) are made with its seven moves, and name them again; walk_on walks out of a talk (town-design §3.2)", () => {
  const ids = [
    "cast_fire-bolt", "cast_cure-wounds_self", "cast_fire-bolt@25,6", "feature_second-wind", "feature_lay-on-hands_self", "feature_divine-spark@40,9",
    "attack@25,6", "throw@25,6", "shove@41,9", "grapple@41,9", "lift@41,9", "jump@44,9",
    "hide", "rest_short", "rest_short_recover", "rest_long", "use_01JPOTION",
  ];
  for (const id of ids) {
    const move = moveOf(id);
    assert.ok(move, id);
    assert.equal(actionId(move), id, id);
  }
  assert.deepEqual(moveOf("cast_fire-bolt@25,6"), { move: "cast", args: { spell: "fire-bolt", at: { x: 25, y: 6 } } });
  assert.deepEqual(moveOf("cast_cure-wounds_self"), { move: "cast", args: { spell: "cure-wounds", self: true } });
  assert.deepEqual(moveOf("shove@41,9"), { move: "attack", args: { how: "shove", at: { x: 41, y: 9 } } });
  assert.deepEqual(moveOf("jump@44,9"), { move: "leap", args: { at: { x: 44, y: 9 } } });
  assert.deepEqual(moveOf("rest_short_recover"), { move: "rest", args: { length: "short", recover: true } });
  assert.deepEqual(moveOf("use_01JPOTION"), { move: "useItem", args: { item: "01JPOTION" } });
  assert.deepEqual(moveOf("walk_on"), { move: "walk", args: { toward: OUT } });
});
