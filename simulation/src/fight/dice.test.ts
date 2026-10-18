import { test } from "node:test";
import assert from "node:assert/strict";
import type * as Dnd from "../../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { diceLines, type Namer, type Table } from "./rules.ts";

/**
 * A fight's dice lines (M6's first play): each hit's line says the hit points it left, not the
 * fight's end's; a feature's extra damage says whose it is (Sneak Attack), which the engine gives as
 * damage alone; a Constitution save after a caster is hurt says it's to keep concentrating, and a
 * broken one says the spell ends; and an attack's advantage says why when the fight knows.
 */

const people: Record<string, { name: string; hp: number; max: number; concentrating?: boolean }> = {
  rogue: { name: "you", hp: 24, max: 24 },
  bandit: { name: "a bandit", hp: 0, max: 11 },
  wizard: { name: "Master Quill", hp: 9, max: 20, concentrating: true },
};
/** The engine as diceLines reads it: everyone's hit points after the events, and whether they're still concentrating. */
const table = {
  char: (id: string) => (people[id] ? { name: people[id].name, hp: { current: people[id].hp, max: people[id].max }, deathSaves: { successes: 0, failures: 0 }, ...(people[id].concentrating ? { concentrationEffectId: "e1" } : {}) } : undefined),
  kit: { engine: { content: { conditions: new Map() } } },
} as unknown as Table;
/** Names, and how everyone stood before the events (the fight's own count). */
const before: Record<string, number> = { rogue: 24, bandit: 11, wizard: 20 };
const names: Namer = {
  called: id => people[id]?.name ?? id,
  isPc: id => id === "rogue",
  weapon: () => "Rapier",
  hp: id => (before[id] !== undefined ? { hp: before[id], maxHp: people[id]!.max, state: "fighting" } : undefined),
};
let n = 0;
const event = (type: string, rest: Record<string, unknown>): Dnd.EngineEvent => ({ id: `ev${++n}`, at: "2026-10-18T09:00:00.000Z", type, ...rest }) as unknown as Dnd.EngineEvent;

test("a rogue's blow with Sneak Attack: the attack, the feature's damage by name, then the weapon's, each line's hit points what it left", () => {
  const attack = event("AttackRolled", { attackerId: "rogue", targetId: "bandit", weaponInstanceId: "w", d20: [15], used: "none", attackBonus: 5, total: 20, targetAC: 12, hit: true, critical: false });
  const fired = event("TriggerFired", { characterId: "rogue", triggerId: "rogue-1:sneak-attack", cadence: "turn" });
  const lines = diceLines(table, [
    attack, fired,
    event("DamageApplied", { targetId: "bandit", components: [{ amount: 4, type: "piercing" }], causedByEventId: fired.id }),
    event("DamageRolled", { rolls: [{ expression: "1d8", rolls: [6], modifier: 3, type: "piercing" }] }),
    event("DamageApplied", { targetId: "bandit", components: [{ amount: 9, type: "piercing" }] }),
  ], names);
  assert.deepEqual(lines, [
    "Rapier: your attack on a bandit: 15 +5 = 20 vs AC 12: hit",
    "Sneak Attack: a bandit takes 4 piercing damage (HP 7/11)",
    "Damage: 1d8+3 (6+3) piercing",
    "A bandit takes 9 piercing damage (HP 0/11)",
  ]);
});

test("a caster hurt makes a Constitution save to keep concentrating; failed, the spell ends", () => {
  const hurt = event("DamageApplied", { targetId: "wizard", components: [{ amount: 11, type: "bludgeoning" }] });
  const kept = diceLines(table, [hurt, event("SaveRolled", { targetId: "wizard", ability: "CON", dc: 10, d20: [13], used: "none", bonus: 2, total: 15, success: true })], names);
  assert.deepEqual(kept, ["Master Quill takes 11 bludgeoning damage (HP 9/20)", "Master Quill's Constitution save to keep concentrating: 13 +2 = 15 vs DC 10: saved"]);
  const save = event("SaveRolled", { targetId: "wizard", ability: "CON", dc: 10, d20: [4], used: "none", bonus: 2, total: 6, success: false });
  const broke = diceLines(table, [hurt, save, event("ConcentrationBroken", { casterId: "wizard", reason: "failedSave", causedByEventId: save.id })], names);
  assert.deepEqual(broke.slice(1), ["Master Quill's Constitution save to keep concentrating: 4 +2 = 6 vs DC 10: failed", "Master Quill's concentration breaks: the spell ends"]);
  // A Constitution save nobody was hurt before (a spell's) is only a save.
  assert.deepEqual(diceLines(table, [event("SaveRolled", { targetId: "bandit", ability: "CON", dc: 13, d20: [15], used: "none", bonus: 4, total: 19, success: true })], names), ["A bandit's Constitution save: 15 +4 = 19 vs DC 13: saved"]);
});

test("an attack's advantage or disadvantage says why when the fight knows (Pack Tactics; someone beside the shooter), each its own", () => {
  const roll = (used: string) => event("AttackRolled", { attackerId: "bandit", targetId: "rogue", weaponInstanceId: "w", d20: [4, 17], used, attackBonus: 4, total: 21, targetAC: 14, hit: true, critical: false });
  const why = { advantage: "Pack Tactics, a friend beside them" };
  assert.deepEqual(diceLines(table, [roll("advantage")], names, "Cudgel", why), ["Cudgel: a bandit's attack on you: 4/17 (advantage: Pack Tactics, a friend beside them) +4 = 21 vs AC 14: hit"]);
  assert.deepEqual(diceLines(table, [roll("disadvantage")], names, "Cudgel", why), ["Cudgel: a bandit's attack on you: 4/17 (disadvantage) +4 = 21 vs AC 14: hit"], "the reason the fight knew was for advantage");
  assert.deepEqual(diceLines(table, [roll("disadvantage")], names, "Shortbow", { disadvantage: "a foe's beside them" }), ["Shortbow: a bandit's attack on you: 4/17 (disadvantage: a foe's beside them) +4 = 21 vs AC 14: hit"]);
});

test("Sleep's sleeper falls asleep (not the engine's \"is unconscious\"), and a blow wakes them", () => {
  const before2 = { ...names, hp: (id: string) => (id === "bandit" ? { hp: 11, maxHp: 11, state: "fighting" as const } : names.hp(id)) };
  assert.deepEqual(diceLines(table, [event("ConditionApplied", { targetId: "bandit", conditionId: "unconscious" })], before2), ["A bandit falls asleep"]);
  assert.deepEqual(diceLines(table, [event("DamageApplied", { targetId: "bandit", components: [{ amount: 3, type: "slashing" }] }), event("ConditionRemoved", { targetId: "bandit", conditionId: "unconscious" })], before2), ["A bandit takes 3 slashing damage (HP 8/11)", "A bandit wakes up"]);
});
