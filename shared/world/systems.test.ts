// Copied from the prototype's src/world/systems.test.ts at 44c6d4a, on the hanged clerk's granary yard (campaigns/caerwyn's place file) where it played in the Drowned Rat, which v2 doesn't have yet: the tally desk for the long table and the card table (wood), the rope cleat for the iron pots, Kell and Moll for Hobb and Nan Quill. The yard has no gin jar, so the jar broken by fire isn't here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadPlace } from "../scene/scenario.ts";
import { applyOps, buildWorld, caughtIn, positionOf, tick } from "./scene-world.ts";
import { douse, elemental, ignite, spill, surfacesAt } from "./systems.ts";

const yard = () => buildWorld("hanged-clerk", loadPlace(readFileSync(new URL("../../campaigns/caerwyn/places/granary-yard.kmplace", import.meta.url), "utf8")), [{ id: "moll", name: "Moll" }, { id: "kell", name: "Sergeant Agnes Kell" }], { name: "Odo" });

test("a bucket of water over a burning desk: out, scorched, wet, in a puddle, with steam", () => {
  const world = yard();
  const desk = world.entities["tally-desk"]!;
  ignite(world, desk, 1);
  assert.ok(desk.states.includes("burning"));
  douse(world, desk, 2);
  assert.ok(!desk.states.includes("burning"));
  assert.ok(desk.states.includes("scorched") && desk.states.includes("wet"));
  const here = surfacesAt(world, positionOf(world, desk.id)!);
  assert.ok(here.some(s => s.tags.includes("water")), "a puddle under it");
  assert.ok(here.some(s => s.tags.includes("steam")), "a puff of steam");
  // Wet, it won't catch again.
  assert.match(ignite(world, desk, 3)[0]!, /too wet/);
});

test("metal only scorches; wood burns", () => {
  const world = yard();
  const cleat = world.entities.cleat!; // iron
  assert.match(ignite(world, cleat, 1)[0]!, /scorched, not burning/);
  assert.ok(!cleat.states.includes("burning") && cleat.states.includes("scorched"));
});

test("Fireball on an oil slick: a burning puddle that burns what's in it, then burns out", () => {
  const world = yard();
  const at = positionOf(world, "tally-desk")!;
  const { surface: oil } = spill(world, "oil", at, 4, 1);
  const caught = caughtIn(world, "sphere", 20, positionOf(world, "player")!, at);
  assert.ok(caught.includes(oil));
  elemental(world, caught, "fire", 2);
  assert.ok(oil.states.includes("burning"));
  for (let t = 3; t < 9; t++) tick(world, t, 7 + t);
  assert.ok(world.entities["tally-desk"]!.states.some(s => s === "burning" || s === "destroyed"), "the desk in the slick caught");
  assert.ok(oil.states.includes("gone"), "the slick burned itself out");
  assert.ok(Object.values(world.entities).some(e => e.kind === "surface" && e.tags.includes("ash")), "a scorch mark");
});

test("water on burning oil spreads it", () => {
  const world = yard();
  const { surface: oil } = spill(world, "oil", positionOf(world, "tally-desk")!, 3, 1);
  ignite(world, oil, 1);
  douse(world, oil, 2);
  assert.ok(oil.states.includes("burning") && (oil.radius ?? 0) > 3);
});

test("the stage manager's physics verbs", () => {
  const world = yard();
  ignite(world, world.entities["tally-desk"]!, 1);
  const out = applyOps(world, [
    { op: "douse", what: "tally-desk", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] },
    { op: "bleed", what: "kell", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] },
    { op: "spill", what: "ale", to: "moll", how: "", name: "", kind: "", text: "", add: [], remove: [], quantity: 3 },
    { op: "state", what: "cleat", to: "", how: "", name: "", kind: "", text: "", add: ["burning"], remove: [] },
  ], 2);
  assert.equal(out.problems.length, 0);
  assert.ok(!world.entities["tally-desk"]!.states.includes("burning"));
  assert.ok(world.entities.kell!.states.includes("bloodied"));
  assert.ok(Object.values(world.entities).some(e => e.kind === "surface" && e.tags.includes("blood")));
  assert.ok(Object.values(world.entities).some(e => e.kind === "surface" && e.tags.includes("ale")));
  assert.ok(!world.entities.cleat!.states.includes("burning"), "state +burning goes through the physics: iron only scorches");
});
