// Copied from the prototype's src/rules/spells.test.ts:1-121 at 44c6d4a: spellCard is the engine's spell through spellDetails with the SRD handed in, as sheetData makes a spell's details; the case at 104-121 keeps its sheet's half, on builds.json's builds through createCharacter (pregenSession is the prototype's), its casting half waits for V7 with the other cases that cast a spell (castSpell).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./shim.ts";
import * as E from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { createCharacter, sheetData } from "./character.ts";
import { rulesFrom } from "./engine.ts";
import { spellDetails, srdAttribution, srdSpell, type Caster } from "./spells.ts";
import type { Build, RulesSession, SpellDetails, SrdBlock, SrdFile } from "./types.ts";

/**
 * A spell's details, as the sheet shows them when it's picked: the card and what it does in this
 * game's terms (the engine's mechanics, at the caster's numbers), and the SRD 5.2.1's description in
 * its own words (vendor/srd-spells). A level 3 wizard's numbers: save DC 13, spell attack +5.
 */

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as unknown;
const rules = rulesFrom(E, read("../../vendor/dnd-srd-engine/starter-pack.json"), read("../../vendor/srd-spells/spells.json") as SrdFile);
const names = { condition: (id: string) => rules.content.conditions.get(id)?.name, item: (id: string) => rules.content.items.get(id)?.name };
const spellCard = (id: string, caster?: Caster): SpellDetails | undefined => {
  const spell = rules.content.spells.get(id);
  return spell && spellDetails(rules.srd, spell, caster, names);
};

const WIZARD = { level: 3, saveDC: 13, attackBonus: 5 };
const words = (blocks: SrdBlock[] | undefined) => (blocks ?? []).map(b => (typeof b === "string" ? b : JSON.stringify(b))).join("\n");

test("a cantrip that grows: Fire Bolt's attack at the caster's bonus, its damage at their level, and the levels it grows at", () => {
  const d = spellCard("fire-bolt", WIZARD)!;
  assert.equal(d.levelLine, "Evocation Cantrip (Sorcerer, Wizard)");
  assert.deepEqual([d.castingTime, d.range, d.duration, d.concentration, d.ritual], ["Action", "120 feet", "Instantaneous", false, false]);
  assert.deepEqual(d.components, { verbal: true, somatic: true });
  assert.deepEqual(d.does, ["Ranged spell attack, +5 to hit: 1d10 fire on a hit"]);
  assert.deepEqual(d.scaling, ["Grows with you: 2d10 at level 5, 3d10 at 11, 4d10 at 17"]);
  assert.equal(d.area, undefined);
  // At level 11 the damage is what it's grown to.
  assert.deepEqual(spellCard("fire-bolt", { level: 11, saveDC: 16, attackBonus: 8 })!.does, ["Ranged spell attack, +8 to hit: 3d10 fire on a hit"]);
  // The SRD's words, its own upgrade line among them.
  assert.match(words(d.text), /^You hurl a mote of fire at a creature or an object within range\. Make a ranged spell attack against the target\. On a hit, the target takes 1d10 Fire damage\./);
  assert.match(words(d.text), /_Cantrip Upgrade\._ The damage increases by 1d10 when you reach levels 5 \(2d10\), 11 \(3d10\), and 17 \(4d10\)\./);
});

test("a save with an area that grows with the slot: Burning Hands, Thunderwave's push, Fireball's sphere", () => {
  const hands = spellCard("burning-hands", WIZARD)!;
  assert.equal(hands.levelLine, "Level 1 Evocation (Sorcerer, Wizard)");
  assert.deepEqual(hands.does, ["Dexterity save, DC 13: 3d6 fire, half as much on a success"]);
  assert.equal(hands.area, "a 15-foot cone from you");
  assert.deepEqual(hands.scaling, ["With a higher slot: +1d6 fire for each level above 1st"]);
  assert.match(words(hands.text), /Each creature in a 15-foot Cone makes a Dexterity saving throw, taking 3d6 Fire damage on a failed save or half as much damage on a successful one\./);
  assert.match(words(hands.text), /_Using a Higher-Level Spell Slot\._ The damage increases by 1d6 for each spell slot level above 1\./);
  const wave = spellCard("thunderwave", WIZARD)!;
  assert.deepEqual(wave.does, ["Constitution save, DC 13: 2d8 thunder and pushed 10 feet away on a failure, half the damage on a success"]);
  assert.equal(wave.area, "a 15-foot cube from you");
  const fireball = spellCard("fireball", WIZARD)!;
  assert.equal(fireball.area, "a 20-foot-radius sphere");
  assert.deepEqual(fireball.components, { verbal: true, somatic: true, material: "a ball of bat guano and sulfur" });
  assert.deepEqual(fireball.scaling, ["With a higher slot: +1d6 fire for each level above 3rd"]);
});

test("a spell the rules roll nothing for: Mage Hand has no terms, only the card and the SRD's words", () => {
  const d = spellCard("mage-hand", WIZARD)!;
  assert.deepEqual([d.does, d.scaling, d.area], [[], [], undefined]);
  assert.deepEqual([d.castingTime, d.range, d.duration], ["Action", "30 feet", "1 minute"]);
  assert.match(words(d.text), /^A spectral, floating hand appears at a point you choose within range\./);
  assert.match(words(d.text), /The hand can't attack, activate magic items, or carry more than 10 pounds\./);
});

test("a ritual: Detect Magic (and Find Familiar's summons, an hour to cast)", () => {
  const d = spellCard("detect-magic", WIZARD)!;
  assert.equal(d.ritual, true);
  assert.equal(d.castingTime, "Action", "the SRD's 'Action or Ritual' is the ritual flag here");
  assert.match(words(d.text), /^For the duration, you sense the presence of magical effects within 30 feet of yourself\./);
  const familiar = spellCard("find-familiar", WIZARD)!;
  assert.deepEqual([familiar.ritual, familiar.castingTime], [true, "1 hour"]);
  assert.deepEqual(familiar.does, ["Summons a Familiar: AC 13, 10 hit points, speed 30 feet"]);
  assert.match(familiar.components.material ?? "", /burning incense worth 10\+ GP, which the spell consumes/);
});

test("concentration: Sleep (its pool, as the engine plays it, beside the SRD's saves), Bless, Hold Person", () => {
  const sleep = spellCard("sleep", WIZARD)!;
  assert.deepEqual([sleep.concentration, sleep.duration], [true, "Concentration, up to 1 minute"]);
  assert.deepEqual(sleep.does, ["Rolls 5d8: that many hit points of creatures, the weakest first, are Unconscious"]);
  assert.equal(sleep.area, "a 5-foot-radius sphere");
  assert.deepEqual(sleep.scaling, ["With a higher slot: +2d8 to the roll for each level above 1st"]);
  assert.match(words(sleep.text), /must succeed on a Wisdom saving throw or have the Incapacitated condition/);
  const bless = spellCard("bless", WIZARD)!;
  assert.deepEqual([bless.concentration, bless.does], [true, ["On the target: Blessed"]]);
  const hold = spellCard("hold-person", WIZARD)!;
  assert.deepEqual([hold.concentration, hold.does], [true, ["Wisdom save, DC 13, or Held (Paralyzed)"]]);
});

test("a reaction says when it's taken, in the SRD's words; without a caster there are no numbers", () => {
  assert.equal(spellCard("shield")!.castingTime, "Reaction, which you take when you are hit by an attack roll or targeted by the Magic Missile spell");
  assert.deepEqual(spellCard("fire-bolt")!.does, ["Ranged spell attack: 1d10 fire on a hit"]);
  assert.deepEqual(spellCard("magic-missile")!.does, ["Three darts of 1d4+1 force, each a sure hit"]);
});

test("the SRD's text: every spell the engine has, by id, under the SRD 5.2.1's own attribution", () => {
  const spells = (rules.pack as { spells: Array<{ id: string; name: string }> }).spells;
  assert.equal(spells.length, 339);
  for (const s of spells) {
    const srd = srdSpell(rules.srd, s.id);
    assert.ok(srd && srd.text.length, `${s.id}: the SRD's description`);
    assert.equal(srd.name.replace(/’/g, "'"), s.name, `${s.id}: the same spell`);
  }
  assert.match(srdAttribution(rules.srd), /^This work includes material from the System Reference Document 5\.2\.1 \(“SRD 5\.2\.1”\) by Wizards of the Coast LLC, available at https:\/\/www\.dndbeyond\.com\/srd\. The SRD 5\.2\.1 is licensed under the Creative Commons Attribution 4\.0 International License/);
  // Tables, lists and a stat block come through as such.
  assert.ok(srdSpell(rules.srd, "augury")!.text.some(b => typeof b === "object" && "table" in b && b.caption === "Omens"));
  assert.ok(srdSpell(rules.srd, "bestow-curse")!.text.filter(b => typeof b === "object" && "item" in b).length === 4);
  assert.ok(srdSpell(rules.srd, "find-steed")!.text.some(b => typeof b === "object" && "heading" in b && b.heading === "Otherworldly Steed"));
  assert.equal(srdSpell(rules.srd, "not-a-spell"), undefined);
  // Without the SRD's file, the card and the terms still, and no words.
  const bare = spellDetails({ attribution: "", license: "", spells: {} }, rules.content.spells.get("fire-bolt")!, WIZARD, names);
  assert.deepEqual([bare.text, bare.credit, bare.does], [undefined, undefined, ["Ranged spell attack, +5 to hit: 1d10 fire on a hit"]]);
});

test("a caster's sheet gives each spell's card their own save DC and attack bonus, before and after the level 4 Ability Score Improvement", () => {
  const builds = read("../../campaigns/caerwyn/builds.json") as Record<string, { build: Build }>;
  for (const [id, level, dc, bonus, attack, save] of [
    ["wizard", 3, 13, 5, "fire-bolt", "burning-hands"], ["wizard", 4, 14, 6, "fire-bolt", "burning-hands"], ["wizard", 5, 15, 7, "scorching-ray", "fireball"],
    ["cleric", 5, 15, 7, "guiding-bolt", "sacred-flame"],
  ] as const) {
    const session: RulesSession = { id: `${id}-${level}`, seed: 4, rollCount: 0, turn: 0, player: { name: "Pell Marrow", concept: "", modifiers: {} } };
    createCharacter(rules, session, level, builds[id]!.build);
    const sc = sheetData(rules, session)!.spellcasting!;
    assert.deepEqual([sc.saveDC, sc.attackBonus], [dc, bonus], `${id} ${level}: the sheet`);
    const cards = sc.spells.flatMap(g => g.spells);
    assert.match(cards.find(s => s.id === attack)!.details!.does[0]!, new RegExp(`\\+${bonus} to hit`), `${id} ${level}: ${attack}'s card`);
    assert.match(cards.find(s => s.id === save)!.details!.does[0]!, new RegExp(`DC ${dc}\\b`), `${id} ${level}: ${save}'s card`);
  }
});
