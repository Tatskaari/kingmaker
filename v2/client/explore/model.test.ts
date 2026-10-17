import assert from "node:assert/strict";
import { test } from "node:test";
import { walkPlan } from "../../shared/map/explore.ts";
import type { MapMove } from "../../shared/map/moves.ts";
import { mapMove, newGameOf, type Backend } from "../backend.ts";
import { demoBackend } from "../demo.ts";
import { setPace } from "../pace.ts";
import { ExploreModel } from "./model.ts";

/**
 * The map's model (the prototype's explore section over rows), on the demo, which plays the
 * simulation's part of each move with the same shared map code: a click walks a step at a time, a
 * move each, and a key stops it (the screen sets walking false), as the prototype's stepAlong does;
 * g walks to the lead and into the yard, whose scene opens and ends the walk.
 */

/** The demo with a new game on the map, and a model over it whose every move is kept. */
async function onTheMap(): Promise<{ game: Backend; model: ExploreModel; moves: MapMove[] }> {
  setPace({ stepMs: 1 });
  const game = demoBackend({ ms: 1 });
  assert.equal(await game.newGame(newGameOf("Wren Ashdown: a hedge wizard", "wizard", "caerwyn")), undefined);
  const moves: MapMove[] = [];
  const model = new ExploreModel(game.explore()!, { move: m => { moves.push(m); return mapMove(game, m); }, quit: () => {} }, () => game.explore());
  game.onChange(() => { const view = game.explore(); if (view) model.update(view); });
  return { game, model, moves };
}

test("a click walks there a step at a time, a move each, and a key stops it", async () => {
  const { model, moves } = await onTheMap();
  const from = { ...model.ex.at };
  const market = { x: 30, y: 22 };
  const plan = walkPlan(model.ex, market)!;
  assert.ok(plan.path.length > 6, `a long walk (${plan.path.length} steps)`);

  const walking = model.walkTo(market);
  // A few steps in, a key: the screen sets walking false, and the walk stops at the step it's on.
  while (moves.length < 3) await new Promise(resolve => setTimeout(resolve, 1));
  model.walking = false;
  await walking;
  const taken = moves.length;
  assert.ok(taken >= 3 && taken < plan.path.length, `stopped part way (${taken} of ${plan.path.length} steps)`);
  assert.ok(moves.every(m => m.move === "walk" && m.args.toward && !m.args.to), "each step is a walk toward a compass word, one tile");
  const [dx, dy] = plan.path.slice(0, taken).reduce(([x, y], [sx, sy]) => [x + sx, y + sy], [0, 0]);
  assert.deepEqual(model.ex.at, { x: from.x + dx, y: from.y + dy }, "the walker stands where the steps taken put them");
  assert.equal(model.walking, false);
});

test("g walks to the lead a step at a time and into the yard: its scene opens, and the walk ends there", async () => {
  const { game, model, moves } = await onTheMap();
  assert.equal(model.leadTarget()?.label, "the granary yard");
  await model.toLead();
  assert.ok(moves.length >= 1 && moves.every(m => m.move === "walk" && !!m.args.toward), `a step at a time (${moves.length})`);
  assert.equal(model.ex.scene, "hanged-clerk", "the scene opened from the map");
  assert.equal(game.view()?.title, "The Hanged Clerk", "and its opening is the scene's");
  assert.equal(model.walking, false);
});

test("a key's step is one move, steered along the street; a spectator's keys walk nowhere, and say so once", async () => {
  const { model, moves } = await onTheMap();
  // Up the screen is north-east on the map: steered along the lane where that would catch.
  model.walk("up");
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(moves.length, 1);
  assert.equal(moves[0]!.move, "walk");

  const watched = new ExploreModel({ ...model.view, watching: "Pell Marrow" }, { move: () => { throw new Error("a spectator's key made a move"); }, quit: () => {} });
  watched.walk("up");
  watched.walk("up");
  assert.equal(watched.messages.filter(m => m === "Pell Marrow has the lead: you're watching.").length, 1, "said once");
});

test("the town's news with no move made (the clock's: a fire burning on) is said as it comes into the log, once", async () => {
  const { model } = await onTheMap();
  const news = "The door of the watch house burns down to a smouldering wreck";
  model.update({ ...model.view, log: [...model.view.log, news] });
  model.update({ ...model.view });
  assert.deepEqual(model.messages.filter(m => m === news), [news]);
});
