import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, buildWorld, untangle, worldView, type WorldOp } from "./scene-world.ts";
import { pieStallWorld } from "../../scenes/zoo/pie-stall.ts";

const op = (o: Partial<WorldOp> & { op: WorldOp["op"] }): WorldOp => ({ what: "", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [], ...o });
const stall = () => buildWorld("zoo-pie-stall", pieStallWorld, [{ id: "crust", name: "Madam Crust" }], { name: "Wren Ashdown" });

test("an area isn't something that moves: placing the queue behind the player is refused, and the GM's view still reads", () => {
  // What the stage manager wrote in a live pie-stall run, which made the queue its own parent.
  const world = stall();
  const { changes, problems } = applyOps(world, [op({ op: "place", what: "the-queue", to: "player", how: "behind" })], 3, "stage");
  assert.deepEqual(changes, []);
  assert.match(problems[0]!, /the queue is part of the place/);
  assert.equal(world.entities["the-queue"]!.parent, world.root);
  assert.match(worldView(world), /the queue \[the-queue\] \(the player is here\)/);
  // Nor do areas change hands, leave or break.
  for (const verb of ["move", "give", "drop", "remove", "destroy", "break"] as const) {
    const r = applyOps(world, [op({ op: verb, what: "behind-the-counter", to: "player" })], 4, "stage");
    assert.match(r.problems[0] ?? "", /part of the place/, verb);
  }
});

test("nothing goes inside itself, or inside what it holds", () => {
  const world = stall();
  applyOps(world, [op({ op: "create", name: "a basket", kind: "object", to: "player" }), op({ op: "give", what: "basket", to: "player" })], 1, "stage");
  const basket = Object.values(world.entities).find(e => e.name === "a basket")!;
  assert.equal(basket.parent, "player", "the player has the basket");
  basket.tags.push("container");
  const r = applyOps(world, [op({ op: "place", what: "player", to: basket.id, how: "in" }), op({ op: "place", what: basket.id, to: basket.id, how: "on" })], 2, "stage");
  assert.equal(r.problems.length, 2, r.problems.join("; "));
  assert.notEqual(world.entities.player!.parent, basket.id);
});

test("a save with something inside itself is put right, and the view reads it", () => {
  const world = stall();
  // As a save from before the guard had it: the queue its own parent, a pie inside the stall inside the pie.
  world.entities["the-queue"]!.parent = "the-queue";
  world.entities.stall!.parent = "last-pie";
  assert.doesNotThrow(() => worldView(world));
  const fixed = untangle(world);
  assert.equal(fixed.length, 2, fixed.join("; "));
  assert.equal(world.entities["the-queue"]!.parent, world.root);
  assert.equal(world.entities.stall!.kind === "object" && world.entities.stall!.parent !== "last-pie", true);
  assert.deepEqual(untangle(world), [], "nothing left to put right");
});

test("a jump is the gap, not the walk to it: the practice yard's ditch is ten feet wherever you start", async () => {
  const { practiceYardWorld } = await import("../../scenes/zoo/practice-yard.ts");
  const { jumpGap } = await import("./scene-world.ts");
  const world = buildWorld("zoo-practice-yard", practiceYardWorld, [], { name: "Wren" });
  // From the gate (22 ft back from the ditch), to the far side: over the ditch's own feature, or just across.
  assert.equal(jumpGap(world, "far-side", "ditch-feature"), 10);
  assert.equal(jumpGap(world, "far-side"), 10);
  // Up to the edge first makes no difference.
  world.entities.player!.at = { x: 29, y: 30 };
  assert.equal(jumpGap(world, "far-side", "ditch-feature"), 10);
  // Beside a thing over there: as the crow flies, less a stride.
  world.entities.player!.at = { x: 27.5, y: 12.5 };
  assert.equal(jumpGap(world, "haystack"), 20);
  // Into the ditch from beside it: areas that touch, so the world can't say.
  assert.equal(jumpGap(world, "ditch"), undefined);
});
