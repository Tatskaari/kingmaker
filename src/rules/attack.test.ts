import { test } from "node:test";
import assert from "node:assert/strict";
import { pregenSession } from "../game/combat/pregen.ts";
import type { Character } from "../runtime/scene.ts";
import { buildWorld, applyOps } from "../world/scene-world.ts";
import { hangedClerkWorld } from "../../scenes/worlds/hanged-clerk.ts";
import { attack, damageLine, sheetData, weapons } from "./dnd.ts";

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

test("a blow rolls the bonus the sheet shows: with the level 4 Ability Score Improvement, and Archery on the bow alone", async () => {
  const dummy = [{ id: "dummy", name: "the straw man", statblock: "commoner" }] as unknown as Character[];
  /** The bonus on the sheet, and the one a blow at the straw man rolls, for a weapon by name. */
  const both = async (pregen: string, level: number, weapon: string) => {
    const state = await pregenSession({ pregen, level, seed: 2 });
    const sheet = (await sheetData(state))!.attacks.find(a => a.name === weapon)!.bonus;
    const id = (await weapons(state)).find(w => w.name === weapon)!.id;
    const line = (await attack(state, dummy, "dummy", id)).lines[0]!;
    return [sheet, Number(/: \d+ ([+-]\d+) = /.exec(line)?.[1])];
  };
  // A rogue's Dexterity 17 is 19 from level 4: +4, and +3 proficiency at level 5.
  assert.deepEqual(await both("rogue", 3, "Rapier"), [5, 5]);
  assert.deepEqual(await both("rogue", 5, "Rapier"), [7, 7]);
  // A fighter's Strength the same; their fighting style (Archery) is +2 with a bow, not a sword.
  assert.deepEqual(await both("fighter", 3, "Longsword"), [5, 5]);
  assert.deepEqual(await both("fighter", 3, "Longbow"), [5, 5]);
  assert.deepEqual(await both("fighter", 5, "Longsword"), [7, 7]);
});

test("a damage line says the dice rolled: twice as many on a critical hit, more for a cantrip that's grown", () => {
  assert.equal(damageLine([{ expression: "1d10", rolls: [8, 8, 9, 7], modifier: 0, type: "fire" }]), "Damage: 4d10 (8+8+9+7) fire");
  assert.equal(damageLine([{ expression: "1d4", rolls: [1, 2], modifier: -1, type: "bludgeoning" }]), "Damage: 2d4-1 (1+2-1) bludgeoning");
  assert.equal(damageLine([{ expression: "2d6", rolls: [3, 4], modifier: 0, type: "fire" }, { expression: "1d6", rolls: [5], modifier: 0, type: "radiant" }]), "Damage: 2d6 (3+4) fire + 1d6 (5) radiant");
});

test("a fixed thing stays where it is, however it's described: it comes down by being cut", async () => {
  const state = await yard();
  const done = applyOps(state.world!, [{ ...blank, op: "place", what: "hoist-rope", to: "loft", how: "in" }], 1, "stage");
  assert.equal(done.problems.length, 1);
  assert.equal(state.world!.entities["hoist-rope"]!.parent, "hoist-beam");
  const beam = applyOps(state.world!, [{ ...blank, op: "move", what: "hoist-beam", to: "yard" }], 1, "stage");
  assert.equal(beam.problems.length, 1);
});
