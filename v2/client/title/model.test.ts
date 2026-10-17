import assert from "node:assert/strict";
import { test } from "node:test";
import { gameRow } from "../check/rows.ts";
import { ago, describe } from "./model.ts";

const NOW = Date.UTC(2026, 9, 16, 9, 0);

test("a game as the title lists it: who, the time of day in the story's words, where, and when it was last played", () => {
  assert.equal(describe(gameRow(3n, "Tamsin Vell", "in The Hanged Clerk", 0, NOW), NOW), "Tamsin Vell: Morning, in The Hanged Clerk (just now)");
  assert.equal(describe(gameRow(4n, "Wren Ashdown", "heading for The Hanged Clerk", 5, NOW), NOW), "Wren Ashdown: Morning, heading for The Hanged Clerk (5 min ago)");
  assert.equal(describe({ ...gameRow(5n, "Pell Marrow", "The Hanged Clerk, over", 0, NOW), time: "night" }, NOW), "Pell Marrow: Night, The Hanged Clerk, over (just now)");
});

test("how long ago, in a few words", () => {
  const minutes = (n: number) => NOW - n * 60_000;
  assert.deepEqual([0, 0.4, 1, 59, 60, 90, 47 * 60, 48 * 60, 24 * 60 * 9].map(n => ago(minutes(n), NOW)), [
    "just now", "just now", "1 min ago", "59 min ago", "1 h ago", "2 h ago", "47 h ago", "2 days ago", "9 days ago",
  ]);
});
