import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, buildWorld, caughtIn, damageThing, positionOf, tick } from "./scene-world.ts";
import { douse, elemental, ignite, spill, surfacesAt } from "./systems.ts";
import { drownedRatWorld } from "../../scenes/worlds/drowned-rat.ts";

const rat = () => buildWorld("drowned-rat", drownedRatWorld, [{ id: "nan-quill", name: "Nan Quill" }, { id: "hobb", name: "Big Hobb Mallory" }], { name: "Odo" });

test("a bucket of water over a burning table: out, scorched, wet, in a puddle, with steam", () => {
  const world = rat();
  const table = world.entities["long-table"]!;
  ignite(world, table, 1);
  assert.ok(table.states.includes("burning"));
  douse(world, table, 2);
  assert.ok(!table.states.includes("burning"));
  assert.ok(table.states.includes("scorched") && table.states.includes("wet"));
  const here = surfacesAt(world, positionOf(world, table.id)!);
  assert.ok(here.some(s => s.tags.includes("water")), "a puddle under it");
  assert.ok(here.some(s => s.tags.includes("steam")), "a puff of steam");
  // Wet, it won't catch again.
  assert.match(ignite(world, table, 3)[0]!, /too wet/);
});

test("metal only scorches; wood burns", () => {
  const world = rat();
  const pots = world.entities.pots!; // iron
  assert.match(ignite(world, pots, 1)[0]!, /scorched, not burning/);
  assert.ok(!pots.states.includes("burning") && pots.states.includes("scorched"));
});

test("Fireball on an oil slick: a burning puddle that burns what's in it, then burns out", () => {
  const world = rat();
  const at = positionOf(world, "card-table")!;
  const { surface: oil } = spill(world, "oil", at, 4, 1);
  const caught = caughtIn(world, "sphere", 20, positionOf(world, "player")!, at);
  assert.ok(caught.includes(oil));
  elemental(world, caught, "fire", 2);
  assert.ok(oil.states.includes("burning"));
  let lines: string[] = [];
  for (let t = 3; t < 9; t++) lines = lines.concat(tick(world, t, 7 + t));
  assert.ok(world.entities["card-table"]!.states.some(s => s === "burning" || s === "destroyed"), "the table in the slick caught");
  assert.ok(oil.states.includes("gone"), "the slick burned itself out");
  assert.ok(Object.values(world.entities).some(e => e.kind === "surface" && e.tags.includes("ash")), "a scorch mark");
});

test("water on burning oil spreads it", () => {
  const world = rat();
  const { surface: oil } = spill(world, "oil", positionOf(world, "card-table")!, 3, 1);
  ignite(world, oil, 1);
  douse(world, oil, 2);
  assert.ok(oil.states.includes("burning") && (oil.radius ?? 0) > 3);
});

test("the gin jar broken by fire: a pool of burning spirits", () => {
  const world = rat();
  const jar = world.entities["gin-jar"]!;
  const lines = damageThing(world, jar, 20, "fire", 1);
  assert.ok(lines.some(l => /breaks open/.test(l)));
  assert.ok(Object.values(world.entities).some(e => e.kind === "surface" && e.tags.includes("spirits") && e.states.includes("burning")));
});

test("the stage manager's physics verbs", () => {
  const world = rat();
  ignite(world, world.entities["arlos-table"]!, 1);
  const out = applyOps(world, [
    { op: "douse", what: "arlos-table", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] },
    { op: "bleed", what: "hobb", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] },
    { op: "spill", what: "ale", to: "nan-quill", how: "", name: "", kind: "", text: "", add: [], remove: [], quantity: 3 },
    { op: "state", what: "pots", to: "", how: "", name: "", kind: "", text: "", add: ["burning"], remove: [] },
  ], 2);
  assert.equal(out.problems.length, 0);
  assert.ok(!world.entities["arlos-table"]!.states.includes("burning"));
  assert.ok(world.entities.hobb!.states.includes("bloodied"));
  assert.ok(Object.values(world.entities).some(e => e.kind === "surface" && e.tags.includes("blood")));
  assert.ok(Object.values(world.entities).some(e => e.kind === "surface" && e.tags.includes("ale")));
  assert.ok(!world.entities.pots!.states.includes("burning"), "state +burning goes through the physics: iron only scorches");
});
