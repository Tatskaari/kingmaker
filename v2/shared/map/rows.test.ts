import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExploreState } from "./explore.ts";
import { exploreRowOf, LOG_LINES, type ExploreRow } from "./rows.ts";

/** The explore row a move leaves (map-design §3.1, §3.4): the state's fields, what it said, the log's last five, and `acts` moved on. */

const row: ExploreRow = {
  playerId: "1", gameId: "1", map: "caerwyn", at: { x: 42, y: 9 }, facing: { x: 0, y: 1 }, steps: 0, hidden: false,
  followers: [], quips: 0, styles: [], acts: 0, said: "", log: ["one", "two", "three", "four", "five"],
};
const state: ExploreState = {
  map: "caerwyn", at: { x: 41, y: 8 }, facing: { x: -1, y: -1 }, steps: 1, story: { time: "morning", played: [], lead: "hanged-clerk", flags: {} },
  overlay: { scenes: {} }, followers: [], quips: 1, lastQuip: "The wall wins.", styles: ["brick"],
};

test("a move that said something keeps it, and the last five; one that said nothing leaves the log", () => {
  const moved = exploreRowOf(state, row, "You come into Granary Street.");
  assert.deepEqual([moved.at, moved.facing, moved.steps, moved.quips, moved.lastQuip, moved.styles], [{ x: 41, y: 8 }, { x: -1, y: -1 }, 1, 1, "The wall wins.", ["brick"]]);
  assert.deepEqual([moved.acts, moved.said, moved.log.length, moved.log[LOG_LINES - 1]], [1, "You come into Granary Street.", LOG_LINES, "You come into Granary Street."]);

  const quiet = exploreRowOf(state, moved, "");
  assert.deepEqual([quiet.acts, quiet.said, quiet.log], [2, "", moved.log]);
  assert.equal(quiet.scene, undefined);
  assert.equal(exploreRowOf({ ...state, scene: "hanged-clerk" }, quiet, "").scene, "hanged-clerk");
});
