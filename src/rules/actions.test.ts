import { test } from "node:test";
import assert from "node:assert/strict";
import { PREGENS } from "../game/combat/pregen.ts";
import { createSession } from "../runtime/engine.ts";
import type { SessionState } from "../runtime/session.ts";
import { catalogue, spellAim, type Catalogue, type Entry } from "./actions.ts";
import { buildWorld } from "../world/scene-world.ts";
import { hangedClerkWorld } from "../../scenes/worlds/hanged-clerk.ts";
import { casterChoice, castSpell, hazard, rulesNow, spellInfo, useFeature, type Build } from "./dnd.ts";

/**
 * The action menu's catalogue (src/rules/actions.ts): what a character can do out of a fight, by
 * kind, from their rules state; what can't be done now, and why; and what each entry needs aiming
 * at, and how far it reaches. Characters are made by the engine from ready builds (no model calls).
 */

process.env.KM_RUNS_DIR ??= "runs/test";
const made = new Map<string, SessionState>();
async function character(name: string, build: Partial<Build>, level = 3): Promise<SessionState> {
  const key = `${name}:${level}:${JSON.stringify(build)}`;
  if (!made.has(key)) made.set(key, await createSession({ sceneId: "hanged-clerk", approach: "v2", player: `${name}: a test`, seed: 5, build, level }));
  return structuredClone(made.get(key)!);
}

const entry = (c: Catalogue, key: string): Entry => { const e = c.entries.find(x => x.key === key); assert.ok(e, `${key} in ${c.entries.map(x => x.key).join(", ")}`); return e; };
const titles = (c: Catalogue) => c.sections.map(s => `${s.title}${s.note ? ` (${s.note})` : ""}`);

test("a wizard: cantrips, spells by level with the slots left, Arcane Recovery, and what anyone can do", async () => {
  const c = catalogue(await character("Wiz", PREGENS.wizard!.build))!;
  assert.deepEqual(titles(c), ["Cantrips", "1st level (4/4 slots)", "2nd level (2/2 slots)", "Class features", "Actions"]);
  const bolt = entry(c, "spell:fire-bolt");
  assert.equal(bolt.group, "cantrips");
  assert.deepEqual(bolt.aim, { kind: "target", range: 120, self: false });
  assert.equal(bolt.effect, "harm");
  assert.match(bolt.summary, /^1d10 fire, 120 ft/);
  assert.equal(bolt.why, undefined);
  // An area from you: a direction, as far as the cone goes.
  assert.deepEqual(entry(c, "spell:burning-hands").aim, { kind: "area", range: 15, shape: "cone", size: 15, fromSelf: true });
  // A reaction's moment is a fight's.
  assert.match(entry(c, "spell:shield").why!, /reaction: only in a fight/);
  // Fresh: nothing to recover, nothing to rest off.
  assert.match(entry(c, "feature:arcane-recovery").why!, /no spell slots spent/);
  assert.match(entry(c, "rest:long").why!, /whole and fresh/);
  for (const key of ["attack", "jump", "hide", "throw", "shove", "grapple"]) assert.equal(entry(c, key).why, undefined, key);
  for (const key of ["dash", "dodge", "disengage"]) assert.match(entry(c, key).why!, /only in a fight/);
  assert.match(entry(c, "help").why!, /a fight, or a scene/);
});

test("a wizard of five: Fireball, a 20-ft sphere 150 ft off, and cantrips that hit harder", async () => {
  const c = catalogue(await character("Wiz", PREGENS.wizard!.build, 5))!;
  assert.ok(titles(c).includes("3rd level (2/2 slots)"), titles(c).join(" | "));
  const fireball = entry(c, "spell:fireball");
  assert.deepEqual(fireball.aim, { kind: "area", range: 150, shape: "sphere", size: 20, fromSelf: false });
  assert.equal(fireball.spell?.slot, 3);
  assert.equal(fireball.spell?.element, "fire");
  assert.match(entry(c, "spell:fire-bolt").summary, /^2d10 fire/);
  assert.deepEqual(entry(c, "spell:misty-step").aim, { kind: "tile", range: 30 });
});

test("slots run out: the spells that need one say so, and a ritual needs none", async () => {
  const state = await character("Wiz", { ...PREGENS.wizard!.build, spells: ["magic-missile", "detect-magic", "sleep", "shield", "scorching-ray"] });
  for (let i = 0; i < 4; i++) assert.doesNotMatch((await castSpell(state, [], "sleep", [])).lines[0]!, /^\(/);
  let c = catalogue(state)!;
  assert.ok(titles(c).includes("1st level (0/4 slots)"), titles(c).join(" | "));
  // With the 1st-level slots gone, a 1st-level spell goes up into a 2nd-level one.
  assert.equal(entry(c, "spell:magic-missile").why, undefined);
  assert.equal(entry(c, "spell:magic-missile").spell?.slot, 2);
  // The 2nd-level slots too: now it's done until a rest.
  for (let i = 0; i < 2; i++) assert.doesNotMatch((await castSpell(state, [], "scorching-ray", [])).lines[0]!, /^\(/);
  c = catalogue(state)!;
  assert.match(entry(c, "spell:magic-missile").why!, /no 1st-level slots left \(a long rest\)/);
  assert.match(entry(c, "spell:scorching-ray").why!, /no 2nd-level slots left/);
  // Detect Magic is a ritual: ten minutes, and no slot.
  const detect = entry(c, "spell:detect-magic");
  assert.equal(detect.why, undefined);
  assert.equal(detect.spell?.ritual, true);
  assert.match(detect.summary, /a ritual: no slot/);
  // A short rest's Arcane Recovery would bring some back; a long rest all of them.
  assert.equal(entry(c, "feature:arcane-recovery").why, undefined);
  assert.equal(entry(c, "rest:long").why, undefined);
});

test("a cleric: healing on someone or yourself, Channel Divinity with its uses, Turn Undead with nobody to turn", async () => {
  const c = catalogue(await character("Cleric", PREGENS.cleric!.build))!;
  assert.deepEqual(titles(c).slice(0, 3), ["Cantrips", "1st level (4/4 slots)", "2nd level (2/2 slots)"]);
  const cure = entry(c, "spell:cure-wounds");
  assert.deepEqual(cure.aim, { kind: "creature", range: 5, self: true });
  assert.equal(cure.effect, "help");
  assert.match(cure.summary, /^heals 2d8 \+ \d, by touch$/);
  assert.deepEqual(entry(c, "spell:healing-word").aim, { kind: "creature", range: 60, self: true });
  const spark = entry(c, "feature:divine-spark");
  assert.deepEqual(spark.uses, { current: 2, max: 2, recharge: "one back each short rest" });
  assert.deepEqual(spark.aim, { kind: "creature", range: 30, self: true });
  assert.match(entry(c, "feature:turn-undead").why!, /no undead about/);
  assert.equal(entry(c, "feature:preserve-life").uses?.max, 2);
  // A dwarf's toughness is on the sheet's maximum, which healing never reaches: fresh is fresh.
  assert.match(entry(c, "rest:short").why!, /whole and fresh/);
  assert.match(entry(c, "rest:long").why!, /whole and fresh/);
});

test("a fighter: no spells; Second Wind waits for a hurt, Action Surge for a fight; used, its uses go down", async () => {
  const state = await character("Fighter", PREGENS.fighter!.build);
  let c = catalogue(state)!;
  assert.ok(!c.sections.some(s => s.group === "cantrips" || s.group === "spells"), titles(c).join(" | "));
  assert.match(entry(c, "feature:second-wind").why!, /not hurt/);
  assert.match(entry(c, "feature:action-surge").why!, /only in a fight/);
  assert.match(entry(c, "attack").name, /Longsword/i);
  assert.deepEqual(entry(c, "attack").aim, { kind: "target", range: 5, self: false });
  // Hurt (a fall, until one lands), Second Wind is there, and spends a use.
  for (let i = 0; i < 12 && rulesNow(state)!.character.hp.current >= rulesNow(state)!.sheet.effectiveHpMax; i++) await hazard(state, "fall_or_blow", "serious");
  c = catalogue(state)!;
  assert.equal(entry(c, "feature:second-wind").why, undefined);
  assert.equal(entry(c, "rest:short").why, undefined, "hurt: a short rest helps");
  const used = await useFeature(state, [], "second-wind");
  assert.match(used.lines.join("\n"), /You regain \d+ HP/);
  assert.deepEqual(entry(catalogue(state)!, "feature:second-wind").uses, { current: 1, max: 2, recharge: "short rest" });
});

test("a rogue: Cunning Action and Steady Aim are a fight's, Hide is a Stealth check with their expertise", async () => {
  const state = await character("Rogue", PREGENS.rogue!.build);
  const c = catalogue(state)!;
  assert.match(entry(c, "feature:cunning-action").why!, /only in a fight/);
  assert.match(entry(c, "feature:steady-aim").why!, /only in a fight/);
  const stealth = rulesNow(state)!.sheet.skills.find(k => k.skill === "stealth")!.modifier;
  assert.ok(stealth >= 5, `stealth ${stealth}`);
  assert.equal(entry(c, "hide").summary, `slip out of sight: a Stealth check (+${stealth})`);
  assert.deepEqual(entry(c, "throw").aim, { kind: "target", range: 60, self: false });
  assert.deepEqual(entry(c, "shove").aim, { kind: "creature", range: 5, self: false });
});

test("a paladin: Lay on Hands from its pool, by touch, on someone or on themselves", async () => {
  const c = catalogue(await character("Paladin", { classId: "paladin" }))!;
  const hands = entry(c, "feature:lay-on-hands");
  assert.deepEqual(hands.uses, { current: 15, max: 15, recharge: "long rest" });
  assert.deepEqual(hands.aim, { kind: "creature", range: 5, self: true });
  assert.match(hands.summary, /15 left/);
});

test("a warlock's spells come out of pact slots, and a short rest gives them back", async () => {
  const state = await character("Warlock", { classId: "warlock", spells: ["charm-person", "suggestion", "scorching-ray", "hex"] });
  let c = catalogue(state)!;
  assert.ok(titles(c).some(t => /^1st level \(pact slots 2\/2 \(2nd\)\)$/.test(t)), titles(c).join(" | "));
  const out = await castSpell(state, [], "scorching-ray", []);
  assert.match(out.lines[0]!, /^Cast Scorching Ray \(2nd-level slot\)/);
  c = catalogue(state)!;
  assert.ok(titles(c).some(t => /pact slots 1\/2/.test(t)), titles(c).join(" | "));
  assert.equal(entry(c, "rest:short").why, undefined, "a pact slot to get back");
  // Charm Person is for working on someone: a scene's.
  assert.equal(entry(c, "spell:charm-person").effect, "social");
});

test("a rest once a time of day: the clock has to move before the next", async () => {
  const state = await character("Cleric", PREGENS.cleric!.build);
  const c = catalogue(state, { rested: { short: true, long: true } })!;
  assert.match(entry(c, "rest:short").why!, /had a short rest/);
  assert.match(entry(c, "rest:long").why!, /slept once/);
});

test("aims from the spell's own range and shape", async () => {
  const { dnd } = await import("./dnd.ts");
  const { pack } = await dnd();
  const spells = new Map((pack as { spells: Array<{ id: string }> }).spells.map(s => [s.id, s]));
  const aim = (id: string) => spellAim(spells.get(id) as Parameters<typeof spellAim>[0]);
  assert.deepEqual(aim("thunderwave"), { kind: "area", range: 15, shape: "cube", size: 15, fromSelf: true });
  assert.deepEqual(aim("shatter"), { kind: "area", range: 60, shape: "sphere", size: 10, fromSelf: false });
  assert.deepEqual(aim("spirit-guardians"), { kind: "self" });
  assert.deepEqual(aim("knock"), { kind: "target", range: 60, self: false });
  assert.deepEqual(aim("charm-person"), { kind: "creature", range: 30, self: false });
  assert.deepEqual(aim("light"), { kind: "target", range: 5, self: true });
  assert.deepEqual(aim("detect-magic"), { kind: "self" });
});

test("a spell cast one of several ways: dimmed on the map; in a scene the player's words pick the way, or they're asked", async () => {
  const state = await character("Cleric", { ...PREGENS.cleric!.build, spells: ["cure-wounds", "healing-word", "guiding-bolt", "bless", "command", "spiritual-weapon"] });
  assert.match(entry(catalogue(state)!, "spell:command").why!, /cast one of 5 ways, and the menu can't ask which yet/);
  state.world = buildWorld("hanged-clerk", hangedClerkWorld, [{ id: "cob", name: "Cob" }], { name: state.player.name });
  // Not said: asked, and nothing's spent.
  assert.equal((await castSpell(state, [], "command", ["cob"])).lines[0], "(Command is cast one of 5 ways: approach, drop, flee, grovel, halt. Say which.)");
  assert.ok(titles(catalogue(state)!).includes("1st level (4/4 slots)"), titles(catalogue(state)!).join(" | "));
  // Said: cast that way, and the slot goes.
  assert.doesNotMatch((await castSpell(state, [], "command", ["cob"], { said: "I command Cob to flee!" })).lines[0]!, /^\(/);
  assert.ok(titles(catalogue(state)!).includes("1st level (3/4 slots)"), titles(catalogue(state)!).join(" | "));
  // An element: the one named, else fire; a way by its name (Hex's ability, Enhance Ability's animal).
  const orb = (await spellInfo("chromatic-orb"))!;
  assert.deepEqual(casterChoice(orb, "an orb of crackling acid"), { kind: "damageType", value: "acid" });
  assert.deepEqual(casterChoice(orb), { kind: "damageType", value: "fire" });
  assert.deepEqual(casterChoice((await spellInfo("hex"))!, "I hex his wisdom"), { kind: "variant", value: "WIS" });
  assert.deepEqual(casterChoice((await spellInfo("enhance-ability"))!, "bull's strength on Cob"), { kind: "variant", value: "bulls-strength" });
  assert.equal(casterChoice((await spellInfo("command"))!, "I command him"), undefined);
});
