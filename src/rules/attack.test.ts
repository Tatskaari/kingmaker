import { test } from "node:test";
import assert from "node:assert/strict";
import { pregenSession } from "../game/combat/pregen.ts";
import { buildWorld, applyOps } from "../world/scene-world.ts";
import { hangedClerkWorld } from "../../scenes/worlds/hanged-clerk.ts";
import { attack } from "./dnd.ts";

const yard = async () => {
  const state = await pregenSession({ pregen: "fighter", seed: 3, sceneId: "hanged-clerk" });
  state.world = buildWorld("hanged-clerk", hangedClerkWorld, [{ id: "cob", name: "Cob" }, { id: "kell", name: "Sergeant Agnes Kell" }], { name: state.player.name });
  return state;
};
const blank = { to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] };

test("something thrown that isn't a weapon is an improvised attack, not the main weapon", async () => {
  const state = await yard();
  const out = await attack(state, [], "loft-door", "improvised");
  assert.match(out.lines[0]!, /^Improvised weapon: your attack on the loft door/);
  assert.doesNotMatch(out.lines.join("\n"), /Longsword|Spear/);
});

test("a fixed thing stays where it is, however it's described: it comes down by being cut", async () => {
  const state = await yard();
  const done = applyOps(state.world!, [{ ...blank, op: "place", what: "hoist-rope", to: "loft", how: "in" }], 1, "stage");
  assert.equal(done.problems.length, 1);
  assert.equal(state.world!.entities["hoist-rope"]!.parent, "hoist-beam");
  const beam = applyOps(state.world!, [{ ...blank, op: "move", what: "hoist-beam", to: "yard" }], 1, "stage");
  assert.equal(beam.problems.length, 1);
});
