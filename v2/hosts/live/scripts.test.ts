import { test } from "node:test";
import assert from "node:assert/strict";
import { picked, SCRIPTS, stepName } from "./scripts.ts";

const offered = [{ kind: "say", text: "Who found him?" }, { kind: "say", text: "Cob, a good arm." }, { kind: "do", text: "(I look up)" }];

test("v5's script is the blueprint's twelve lines, the fourth and the eighth a suggested line picked", () => {
  const v5 = SCRIPTS.v5!;

  assert.equal(v5.steps.length, 12);
  assert.equal(v5.lines, 12);
  assert.deepEqual(v5.steps.map((s, i) => ("act" in s ? i + 1 : 0)).filter(Boolean), [4, 8]);
  assert.equal(stepName(v5.steps[3]!), "act say_1");
  assert.equal(stepName(v5.steps[7]!), "act the try line, else say_2");
  assert.equal(stepName(v5.steps[11]!), "Kell, I think he was killed. Let's look at the loft.");
  assert.deepEqual([SCRIPTS.v0!.steps.length, SCRIPTS.v0!.lines], [6, 4]);
});

test("act picks say_N by its place, or the first of a kind, else its next pick", () => {
  const withTry = [...offered, { kind: "try", text: "(I try to win the boy round)" }];

  assert.equal(picked([{ id: "say_1" }], offered)?.text, "Who found him?");
  assert.equal(picked([{ kind: "try" }, { id: "say_2" }], withTry)?.text, "(I try to win the boy round)");
  assert.equal(picked([{ kind: "try" }, { id: "say_2" }], offered)?.text, "Cob, a good arm.");
  assert.equal(picked([{ id: "say_4" }], offered), undefined);
  assert.equal(picked([{ id: "say_1" }], []), undefined);
});

test("gm's script is full-gm-design §1.2's eight lines as Wren the hedge wizard: the fourth and the eighth said once the background jobs are done, and the GM's side recorded", () => {
  const gm = SCRIPTS.gm!;

  assert.deepEqual([gm.steps.length, gm.lines, gm.who, gm.build, gm.gmSide], [8, 8, "Wren Ashdown: a hedge wizard from the fens", "wizard", true]);
  assert.deepEqual(gm.steps.map((s, i) => ("say" in s && s.wait === "background" ? i + 1 : 0)).filter(Boolean), [4, 8]);
  assert.equal(stepName(gm.steps[2]!), "(I try to lift the folded paper out of the boy's boot while he watches the sergeant)");
  assert.equal(stepName(gm.steps[7]!), "(I nod to the sergeant and walk out of the yard, back towards the palace)");
  assert.ok(gm.steps.every(s => "say" in s));
});

test("world's script is world-bridge-design §1.2's spells and blows as the hedge-wizard keen on fire, the world's side recorded", () => {
  const world = SCRIPTS.world!;

  assert.deepEqual([world.steps.length, world.lines, world.build, world.worldSide], [8, 5, "wizard", true]);
  assert.equal(stepName(world.steps[0]!), "(I cast Magic Missile at the hoist rope)");
  assert.equal(stepName(world.steps[5]!), "(I cast Fire Bolt at the old elm)");
  assert.ok(world.steps.every(s => "say" in s && !s.wait));
});
