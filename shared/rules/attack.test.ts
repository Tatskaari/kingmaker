// Copied from the prototype's src/rules/attack.test.ts at 44c6d4a, whole: builds.json's builds (the prototype's pregens) made by createCharacter, the yard's world from campaigns/caerwyn's place file, each call synchronous on the host's Rules; the weapons are the rules state's (refresh keeps them), as the prototype's weapons() read them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./shim.ts";
import * as E from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import type { BuildsFile, PlaceFile } from "../scene/files.ts";
import { loadPlace } from "../scene/scenario.ts";
import type { Character } from "../scene/types.ts";
import { applyOps, buildWorld } from "../world/scene-world.ts";
import { attack, damageLine } from "./acts.ts";
import { createCharacter, sheetData } from "./character.ts";
import { rulesFrom } from "./engine.ts";
import { withEngine } from "./pin.ts";
import type { RulesSession } from "./types.ts";

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;
const rules = rulesFrom(E, read("../../vendor/dnd-srd-engine/starter-pack.json"), read("../../vendor/srd-spells/spells.json"));
const BUILDS = read<BuildsFile>("../../campaigns/caerwyn/builds.json");
const T = Date.UTC(2026, 9, 16, 9, 30);

const pregenSession = (options: { pregen: string; level?: number; seed?: number }): RulesSession => {
  const state: RulesSession = { id: `pregen-${options.pregen}-${options.seed ?? 1}`, seed: options.seed ?? 1, rollCount: 0, turn: 0, player: { name: "Wren Ashdown", concept: BUILDS[options.pregen]!.concept, modifiers: {} } };
  withEngine({ seed: 1, nowMs: T }, () => createCharacter(rules, state, options.level ?? 3, BUILDS[options.pregen]!.build));
  return state;
};
const yard = () => {
  const state = pregenSession({ pregen: "fighter", seed: 3 });
  state.world = buildWorld("hanged-clerk", loadPlace(readFileSync(new URL("../../campaigns/caerwyn/places/granary-yard.kmplace", import.meta.url), "utf8")), [{ id: "cob", name: "Cob" }, { id: "kell", name: "Sergeant Agnes Kell" }], { name: state.player.name });
  return state;
};
const blank = { to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] };

test("something thrown that isn't a weapon is an improvised attack, not the main weapon", () => {
  const state = yard();
  const out = attack(rules, state, [], "loft-door", "improvised");
  assert.match(out.lines[0]!, /^Improvised weapon: your attack on the loft door/);
  assert.doesNotMatch(out.lines.join("\n"), /Longsword|Spear/);
});

test("a blow rolls the bonus the sheet shows: with the level 4 Ability Score Improvement, and Archery on the bow alone", () => {
  const dummy = [{ id: "dummy", name: "the straw man", statblock: "commoner" }] as unknown as Character[];
  /** The bonus on the sheet, and the one a blow at the straw man rolls, for a weapon by name. */
  const both = (pregen: string, level: number, weapon: string) => {
    const state = pregenSession({ pregen, level, seed: 2 });
    const sheet = sheetData(rules, state)!.attacks.find(a => a.name === weapon)!.bonus;
    const id = state.rules!.weapons!.find(w => w.name === weapon)!.id;
    const line = attack(rules, state, dummy, "dummy", id).lines[0]!;
    return [sheet, Number(/: \d+ ([+-]\d+) = /.exec(line)?.[1])];
  };
  // A rogue's Dexterity 17 is 19 from level 4: +4, and +3 proficiency at level 5.
  assert.deepEqual(both("rogue", 3, "Rapier"), [5, 5]);
  assert.deepEqual(both("rogue", 5, "Rapier"), [7, 7]);
  // A fighter's Strength the same; their fighting style (Archery) is +2 with a bow, not a sword.
  assert.deepEqual(both("fighter", 3, "Longsword"), [5, 5]);
  assert.deepEqual(both("fighter", 3, "Longbow"), [5, 5]);
  assert.deepEqual(both("fighter", 5, "Longsword"), [7, 7]);
});

test("a damage line says the dice rolled: twice as many on a critical hit, more for a cantrip that's grown", () => {
  assert.equal(damageLine([{ expression: "1d10", rolls: [8, 8, 9, 7], modifier: 0, type: "fire" }]), "Damage: 4d10 (8+8+9+7) fire");
  assert.equal(damageLine([{ expression: "1d4", rolls: [1, 2], modifier: -1, type: "bludgeoning" }]), "Damage: 2d4-1 (1+2-1) bludgeoning");
  assert.equal(damageLine([{ expression: "2d6", rolls: [3, 4], modifier: 0, type: "fire" }, { expression: "1d6", rolls: [5], modifier: 0, type: "radiant" }]), "Damage: 2d6 (3+4) fire + 1d6 (5) radiant");
});

test("a fixed thing stays where it is, however it's described: it comes down by being cut", () => {
  const state = yard();
  const done = applyOps(state.world!, [{ ...blank, op: "place", what: "hoist-rope", to: "loft", how: "in" }], 1, "stage");
  assert.equal(done.problems.length, 1);
  assert.equal(state.world!.entities["hoist-rope"]!.parent, "hoist-beam");
  const beam = applyOps(state.world!, [{ ...blank, op: "move", what: "hoist-beam", to: "yard" }], 1, "stage");
  assert.equal(beam.problems.length, 1);
});
