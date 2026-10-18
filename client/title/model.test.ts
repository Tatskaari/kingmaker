import assert from "node:assert/strict";
import { test } from "node:test";
import { refusal } from "../../shared/protocol/refusals.ts";
import { AppModel } from "../app/model.ts";
import { gameRow } from "../check/rows.ts";
import { CAERWYN, StubBackend } from "../check/stub.ts";
import { ZOO_ROW } from "../check/zoo.ts";
import { ago, describe, NO_ZOO } from "./model.ts";

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

// The zoo on the title (M6): a visit kept off the list, its menu (z) a step at a time, and a visit made from it.

test("the title keeps a zoo visit off its list of games to carry on", () => {
  const backend = new StubBackend({ games: [{ ...gameRow(3n, "Tamsin Vell", "in The Hanged Clerk", 0, NOW), campaign: "caerwyn" }, { ...gameRow(4n, "Wren Ashdown", "in the zoo", 0, NOW), campaign: "zoo" }] });
  const app = new AppModel(backend, { campaign: "caerwyn" });
  assert.deepEqual(app.title.saves.map(s => s.gameId), [3n]);
});

test("the zoo's menu: z opens its exhibits, an exhibit opens who to be, Esc goes back a step; with the zoo not installed it says so", () => {
  const app = new AppModel(new StubBackend({ campaigns: [CAERWYN, ZOO_ROW] }), { campaign: "caerwyn" });
  app.title.openZoo();
  assert.deepEqual([app.title.zooMenu, app.title.zooNote], [{ step: "exhibits" }, undefined]);
  assert.deepEqual(app.title.zoo?.exhibits.map(e => e.id), ["ring", "toll"]);
  app.title.pickExhibit("ring");
  assert.deepEqual(app.title.zooMenu, { step: "builds", exhibit: "ring" });
  app.title.zooBack();
  assert.deepEqual(app.title.zooMenu, { step: "exhibits" });
  app.title.zooBack();
  assert.equal(app.title.zooMenu, undefined, "back to the title");

  const bare = new AppModel(new StubBackend(), { campaign: "caerwyn" });
  bare.title.openZoo();
  assert.equal(bare.title.zooNote, NO_ZOO);
});

test("a visit from the zoo's menu: visit_zoo as the build picked, then the game's screen; refused, the menu says why", async () => {
  const backend = new StubBackend({ campaigns: [CAERWYN, ZOO_ROW] });
  const app = new AppModel(backend, { campaign: "caerwyn" });
  app.title.openZoo();
  app.title.pickExhibit("ring");
  backend.answers.visitZoo = () => refusal("no_line_up", { exhibit: "The combat ring", foes: "wolves", lineUps: "sallow, crakes and dogs" });
  assert.equal(await app.title.visit({ exhibit: "ring", build: "rogue", foes: "wolves" }), false);
  assert.deepEqual([app.intent, app.title.zooNote], ["title", "(The combat ring has no line-up called wolves: there's sallow, crakes and dogs.)"]);
  delete backend.answers.visitZoo;
  assert.equal(await app.title.visit({ exhibit: "ring", build: "rogue" }), true);
  assert.deepEqual([app.intent, app.title.zooMenu, app.title.zooNote], ["game", undefined, undefined]);
  assert.deepEqual(backend.moves.map(m => m.name), ["visitZoo", "visitZoo"]);
});
