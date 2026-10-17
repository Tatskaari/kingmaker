import { test } from "node:test";
import assert from "node:assert/strict";
import { actionId, moveOf } from "../../../shared/map/moves.ts";
import { all, hostWithCampaign, identity } from "../host/testing.ts";

/**
 * K's contracts for the town unit (v2/docs/town-design.md §3.1, §3.2, §3.5), on the memory host:
 * the action menu's seven moves are a caller's, each made from the prototype's id, and stand in
 * refusing not_built until package S makes them (S replaces this file's first test with its own);
 * tick_place runs over the place_tick rows, of which there are none yet; and a new game's rows have
 * the new columns at their defaults.
 */

function onMap() {
  const { host } = hostWithCampaign(7, { map: true });
  const wren = identity(1);
  assert.equal(host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "wizard" }), undefined);
  return { host, wren, game: all(host.db.game)[0]! };
}

test("the action menu's seven moves stand in: each, made from the prototype's id, refuses not_built", () => {
  const { host, wren } = onMap();
  const as = host.as(wren);
  const ids = ["cast_fire-bolt@25,6", "attack@25,6", "feature_second-wind_self", "jump@44,9", "hide", "rest_short", "use_01JPOTION"];
  for (const id of ids) {
    const m = moveOf(id)!;
    assert.equal(actionId(m), id);
    const made = m.move === "cast" ? as.cast(m.args) : m.move === "attack" ? as.attack(m.args) : m.move === "useFeature" ? as.useFeature(m.args)
      : m.move === "leap" ? as.leap(m.args) : m.move === "hide" ? as.hide() : m.move === "rest" ? as.rest(m.args) : m.move === "useItem" ? as.useItem(m.args) : undefined;
    assert.equal(made?.code, "not_built", id);
  }
});

test("tick_place runs over the place_tick rows: none until a seat comes onto the map in package S's moves", () => {
  const { host } = onMap();
  assert.deepEqual(all(host.db.placeTick), []);
  host.tickPlaces();
  assert.deepEqual(host.logs.filter(l => l.startsWith("[tick_place]")), []);
});

test("a new game on the map has the town's columns at their defaults", () => {
  const { host, game } = onMap();
  const town = all(host.db.place).find(p => p.key === "map:caerwyn")!;
  const row = host.db.explore.playerId.find(game.hostId)!;
  const sheet = host.db.sheet.playerId.find(game.hostId)!;

  assert.deepEqual([town.town, town.tickedAt], ["", undefined]);
  assert.deepEqual([row.rested, row.spotted, row.lifted, row.fight], [undefined, undefined, undefined, undefined]);
  assert.equal(sheet.actions, "", "the catalogue is package S's: sheetRows writes it");
  assert.deepEqual([all(host.db.talkRecord), all(host.db.lookInvention)], [[], []]);
});
