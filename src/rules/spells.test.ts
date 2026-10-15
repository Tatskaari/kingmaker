import assert from "node:assert/strict";
import { test } from "node:test";
import { pregenSession, PREGENS } from "../game/combat/pregen.ts";
import type { Character } from "../runtime/scene.ts";
import { castSpell, dnd, sheetData, spellCard, type Build } from "./dnd.ts";
import { srdAttribution, srdSpell, type SrdBlock } from "./spells.ts";

/**
 * A spell's details, as the sheet shows them when it's picked: the card and what it does in this
 * game's terms (the engine's mechanics, at the caster's numbers), and the SRD 5.2.1's description in
 * its own words (vendor/srd-spells). A level 3 wizard's numbers: save DC 13, spell attack +5.
 */

const WIZARD = { level: 3, saveDC: 13, attackBonus: 5 };
const words = (blocks: SrdBlock[] | undefined) => (blocks ?? []).map(b => (typeof b === "string" ? b : JSON.stringify(b))).join("\n");

test("a cantrip that grows: Fire Bolt's attack at the caster's bonus, its damage at their level, and the levels it grows at", async () => {
  const d = (await spellCard("fire-bolt", WIZARD))!;
  assert.equal(d.levelLine, "Evocation Cantrip (Sorcerer, Wizard)");
  assert.deepEqual([d.castingTime, d.range, d.duration, d.concentration, d.ritual], ["Action", "120 feet", "Instantaneous", false, false]);
  assert.deepEqual(d.components, { verbal: true, somatic: true });
  assert.deepEqual(d.does, ["Ranged spell attack, +5 to hit: 1d10 fire on a hit"]);
  assert.deepEqual(d.scaling, ["Grows with you: 2d10 at level 5, 3d10 at 11, 4d10 at 17"]);
  assert.equal(d.area, undefined);
  // At level 11 the damage is what it's grown to.
  assert.deepEqual((await spellCard("fire-bolt", { level: 11, saveDC: 16, attackBonus: 8 }))!.does, ["Ranged spell attack, +8 to hit: 3d10 fire on a hit"]);
  // The SRD's words, its own upgrade line among them.
  assert.match(words(d.text), /^You hurl a mote of fire at a creature or an object within range\. Make a ranged spell attack against the target\. On a hit, the target takes 1d10 Fire damage\./);
  assert.match(words(d.text), /_Cantrip Upgrade\._ The damage increases by 1d10 when you reach levels 5 \(2d10\), 11 \(3d10\), and 17 \(4d10\)\./);
});

test("a save with an area that grows with the slot: Burning Hands, Thunderwave's push, Fireball's sphere", async () => {
  const hands = (await spellCard("burning-hands", WIZARD))!;
  assert.equal(hands.levelLine, "Level 1 Evocation (Sorcerer, Wizard)");
  assert.deepEqual(hands.does, ["Dexterity save, DC 13: 3d6 fire, half as much on a success"]);
  assert.equal(hands.area, "a 15-foot cone from you");
  assert.deepEqual(hands.scaling, ["With a higher slot: +1d6 fire for each level above 1st"]);
  assert.match(words(hands.text), /Each creature in a 15-foot Cone makes a Dexterity saving throw, taking 3d6 Fire damage on a failed save or half as much damage on a successful one\./);
  assert.match(words(hands.text), /_Using a Higher-Level Spell Slot\._ The damage increases by 1d6 for each spell slot level above 1\./);
  const wave = (await spellCard("thunderwave", WIZARD))!;
  assert.deepEqual(wave.does, ["Constitution save, DC 13: 2d8 thunder and pushed 10 feet away on a failure, half the damage on a success"]);
  assert.equal(wave.area, "a 15-foot cube from you");
  const fireball = (await spellCard("fireball", WIZARD))!;
  assert.equal(fireball.area, "a 20-foot-radius sphere");
  assert.deepEqual(fireball.components, { verbal: true, somatic: true, material: "a ball of bat guano and sulfur" });
  assert.deepEqual(fireball.scaling, ["With a higher slot: +1d6 fire for each level above 3rd"]);
});

test("a spell the rules roll nothing for: Mage Hand has no terms, only the card and the SRD's words", async () => {
  const d = (await spellCard("mage-hand", WIZARD))!;
  assert.deepEqual([d.does, d.scaling, d.area], [[], [], undefined]);
  assert.deepEqual([d.castingTime, d.range, d.duration], ["Action", "30 feet", "1 minute"]);
  assert.match(words(d.text), /^A spectral, floating hand appears at a point you choose within range\./);
  assert.match(words(d.text), /The hand can't attack, activate magic items, or carry more than 10 pounds\./);
});

test("a ritual: Detect Magic (and Find Familiar's summons, an hour to cast)", async () => {
  const d = (await spellCard("detect-magic", WIZARD))!;
  assert.equal(d.ritual, true);
  assert.equal(d.castingTime, "Action", "the SRD's 'Action or Ritual' is the ritual flag here");
  assert.match(words(d.text), /^For the duration, you sense the presence of magical effects within 30 feet of yourself\./);
  const familiar = (await spellCard("find-familiar", WIZARD))!;
  assert.deepEqual([familiar.ritual, familiar.castingTime], [true, "1 hour"]);
  assert.deepEqual(familiar.does, ["Summons a Familiar: AC 13, 10 hit points, speed 30 feet"]);
  assert.match(familiar.components.material ?? "", /burning incense worth 10\+ GP, which the spell consumes/);
});

test("concentration: Sleep (its pool, as the engine plays it, beside the SRD's saves), Bless, Hold Person", async () => {
  const sleep = (await spellCard("sleep", WIZARD))!;
  assert.deepEqual([sleep.concentration, sleep.duration], [true, "Concentration, up to 1 minute"]);
  assert.deepEqual(sleep.does, ["Rolls 5d8: that many hit points of creatures, the weakest first, are Unconscious"]);
  assert.equal(sleep.area, "a 5-foot-radius sphere");
  assert.deepEqual(sleep.scaling, ["With a higher slot: +2d8 to the roll for each level above 1st"]);
  assert.match(words(sleep.text), /must succeed on a Wisdom saving throw or have the Incapacitated condition/);
  const bless = (await spellCard("bless", WIZARD))!;
  assert.deepEqual([bless.concentration, bless.does], [true, ["On the target: Blessed"]]);
  const hold = (await spellCard("hold-person", WIZARD))!;
  assert.deepEqual([hold.concentration, hold.does], [true, ["Wisdom save, DC 13, or Held (Paralyzed)"]]);
});

test("a reaction says when it's taken, in the SRD's words; without a caster there are no numbers", async () => {
  assert.equal((await spellCard("shield"))!.castingTime, "Reaction, which you take when you are hit by an attack roll or targeted by the Magic Missile spell");
  assert.deepEqual((await spellCard("fire-bolt"))!.does, ["Ranged spell attack: 1d10 fire on a hit"]);
  assert.deepEqual((await spellCard("magic-missile"))!.does, ["Three darts of 1d4+1 force, each a sure hit"]);
});

test("the SRD's text: every spell the engine has, by id, under the SRD 5.2.1's own attribution", async () => {
  const { pack } = await dnd();
  const spells = (pack as { spells: Array<{ id: string; name: string }> }).spells;
  assert.equal(spells.length, 339);
  for (const s of spells) {
    const srd = srdSpell(s.id);
    assert.ok(srd && srd.text.length, `${s.id}: the SRD's description`);
    assert.equal(srd.name.replace(/’/g, "'"), s.name, `${s.id}: the same spell`);
  }
  assert.match(srdAttribution(), /^This work includes material from the System Reference Document 5\.2\.1 \(“SRD 5\.2\.1”\) by Wizards of the Coast LLC, available at https:\/\/www\.dndbeyond\.com\/srd\. The SRD 5\.2\.1 is licensed under the Creative Commons Attribution 4\.0 International License/);
  // Tables, lists and a stat block come through as such.
  assert.ok(srdSpell("augury")!.text.some(b => typeof b === "object" && "table" in b && b.caption === "Omens"));
  assert.ok(srdSpell("bestow-curse")!.text.filter(b => typeof b === "object" && "item" in b).length === 4);
  assert.ok(srdSpell("find-steed")!.text.some(b => typeof b === "object" && "heading" in b && b.heading === "Otherworldly Steed"));
  assert.equal(srdSpell("not-a-spell"), undefined);
});

test("a spell rolls the save DC and attack bonus the sheet and its card show, before and after the level 4 Ability Score Improvement", async () => {
  const dummy = [{ id: "dummy", name: "the straw man", statblock: "commoner" }] as unknown as Character[];
  for (const [pregen, level, dc, bonus, attack, save] of [
    ["wizard", 3, 13, 5, "fire-bolt", "burning-hands"], ["wizard", 4, 14, 6, "fire-bolt", "burning-hands"], ["wizard", 5, 15, 7, "scorching-ray", "fireball"],
    ["cleric", 5, 15, 7, "guiding-bolt", "sacred-flame"],
  ] as const) {
    const at = `${pregen} ${level}`;
    const sc = (await sheetData(await pregenSession({ pregen, level, seed: 4 })))!.spellcasting!;
    assert.deepEqual([sc.saveDC, sc.attackBonus], [dc, bonus], `${at}: the sheet`);
    const cards = sc.spells.flatMap(g => g.spells);
    assert.match(cards.find(s => s.id === attack)!.details!.does[0]!, new RegExp(`\\+${bonus} to hit`), `${at}: ${attack}'s card`);
    assert.match(cards.find(s => s.id === save)!.details!.does[0]!, new RegExp(`DC ${dc}\\b`), `${at}: ${save}'s card`);
    const hit = (await castSpell(await pregenSession({ pregen, level, seed: 4 }), dummy, attack, ["dummy"])).lines.join("\n");
    assert.match(hit, new RegExp(`your attack on the straw man: \\d+ \\+${bonus} = `), `${at}: ${attack} as it's cast`);
    const saved = (await castSpell(await pregenSession({ pregen, level, seed: 4 }), dummy, save, ["dummy"])).lines.join("\n");
    assert.match(saved, new RegExp(`save: \\d+ [+-]\\d+ = \\d+ vs DC ${dc}:`), `${at}: ${save} as it's cast`);
  }
});

test("rays and beams are an attack each, at a person as at a thing: Scorching Ray's three (four from a 3rd-level slot), Eldritch Blast's two at level 5", async () => {
  const dummy = [{ id: "dummy", name: "the straw man", statblock: "commoner" }] as unknown as Character[];
  const attacks = (lines: string[]) => lines.filter(l => /your attack on the straw man/.test(l)).length;
  const wizard = await pregenSession({ pregen: "wizard", level: 5, seed: 6 });
  const ray = await castSpell(wizard, dummy, "scorching-ray", ["dummy"]);
  assert.match(ray.lines[0]!, /^Cast Scorching Ray \(2nd-level slot\) on the straw man/);
  assert.equal(attacks(ray.lines), 3, ray.lines.join("\n"));
  // With the 2nd-level slots spent, the next comes from a 3rd-level one: a ray more.
  await castSpell(wizard, dummy, "scorching-ray", ["dummy"]);
  await castSpell(wizard, dummy, "scorching-ray", ["dummy"]);
  const fourth = await castSpell(wizard, dummy, "scorching-ray", ["dummy"]);
  assert.match(fourth.lines[0]!, /\(3rd-level slot\)/);
  assert.equal(attacks(fourth.lines), 4, fourth.lines.join("\n"));
  const warlock: Build = { classId: "warlock", subclassId: "fiend-patron", speciesId: "tiefling", backgroundId: "criminal", abilities: ["CHA", "CON", "DEX", "WIS", "INT", "STR"],
    skills: ["deception", "intimidation", "arcana"], feat: "alert", cantrips: ["eldritch-blast", "minor-illusion"], spells: ["hex", "charm-person", "misty-step"],
    weapons: ["dagger"], armor: "leather-armor", shield: false };
  const blast = await castSpell(await pregenSession({ build: warlock, level: 5, seed: 6 }), dummy, "eldritch-blast", ["dummy"]);
  assert.equal(attacks(blast.lines), 2, blast.lines.join("\n"));
  assert.equal(attacks((await castSpell(await pregenSession({ build: warlock, level: 3, seed: 6 }), dummy, "eldritch-blast", ["dummy"])).lines), 1);
});

test("what the engine adds for the caster is on their card, as a cast rolls it: a Life cleric's heals, Agonizing Blast, Potent Cantrip", async () => {
  const card = async (build: Build, id: string, name: string) => {
    const d = await sheetData(await pregenSession({ build, name, seed: 1 }));
    return d!.spellcasting!.spells.flatMap(g => g.spells).find(s => s.id === id)!.details!;
  };
  /** The lines of the spell cast once by each of these characters (seeds), at the straw man or themselves. */
  const casts = async (build: Build, id: string, target: string, seeds: number) => {
    const dummy = [{ id: "dummy", name: "the straw man", statblock: "commoner" }] as unknown as Character[];
    const out: string[] = [];
    for (let seed = 1; seed <= seeds; seed++) out.push((await castSpell(await pregenSession({ build, seed }), dummy, id, [target])).lines.join("\n"));
    return out;
  };

  // Heals: the engine adds the caster's Wisdom modifier, and the Life cleric's Disciple of Life (2 + the slot's level).
  const cleric = PREGENS.cleric!.build;
  const cure = await card(cleric, "cure-wounds", "Brother Odo");
  assert.deepEqual(cure.does, ["Heals 2d8 + 6 hit points (+3 your Wisdom modifier, +3 Disciple of Life)"]);
  assert.deepEqual(cure.scaling, ["With a higher slot: +2d8 healing and +1 from Disciple of Life for each level above 1st"]);
  const healed = (await casts(cleric, "cure-wounds", "player", 12)).map(l => Number(/You regain (\d+) HP/.exec(l)?.[1]));
  assert.ok(healed.every(n => n >= 8 && n <= 22), `2d8 + 6 each time: ${healed.join(", ")}`);
  assert.ok(healed.some(n => n > 16), `more than 2d8 alone: ${healed.join(", ")}`);

  // Agonizing Blast: the warlock's Charisma modifier on every Eldritch Blast that hits.
  const warlock: Build = { classId: "warlock", subclassId: "fiend-patron", speciesId: "tiefling", backgroundId: "criminal", abilities: ["CHA", "CON", "DEX", "WIS", "INT", "STR"],
    skills: ["deception", "intimidation", "arcana"], feat: "alert", cantrips: ["eldritch-blast", "minor-illusion"], spells: ["hex", "hellish-rebuke", "charm-person", "misty-step"],
    weapons: ["dagger", "crossbow-light"], armor: "leather-armor", shield: false };
  assert.deepEqual((await card(warlock, "eldritch-blast", "Vesna Coil")).does, ["Ranged spell attack, +4 to hit: 1d10 + 2 force on a hit (+2 Agonizing Blast)"]);
  const blasts = (await casts(warlock, "eldritch-blast", "dummy", 6)).filter(l => /: hit/.test(l));
  assert.ok(blasts.length, "a hit to see");
  for (const l of blasts) assert.match(l, /Damage: 1d10\+2 \(\d+\+2\) force/);

  // Potent Cantrip (the Evoker's): a damaging cantrip saved against still does half; a missed one does nothing (the game's way).
  const evoker = { ...PREGENS.wizard!.build, cantrips: ["acid-splash", "fire-bolt", "light"] };
  assert.deepEqual((await card(evoker, "acid-splash", "Pell Marrow")).does, ["Dexterity save, DC 13: 1d6 acid, half as much on a success (Potent Cantrip)"]);
  assert.deepEqual((await card(evoker, "fire-bolt", "Pell Marrow")).does, ["Ranged spell attack, +5 to hit: 1d10 fire on a hit"]);
  const saved = (await casts(evoker, "acid-splash", "dummy", 8)).filter(l => /Dexterity save: .*: saved/.test(l));
  assert.ok(saved.length && saved.every(l => /takes \d+ acid damage/.test(l)), `half on a success:\n${saved.join("\n")}`);
  for (const l of (await casts(evoker, "fire-bolt", "dummy", 6)).filter(l => /: miss/.test(l))) assert.doesNotMatch(l, /damage/);
});

test("a spell from the slot the player's words ask for, an aim nobody could make out asked about, and a Rage that ends (wizard#17, barbarian#44)", async () => {
  const { castSpell: cast, createCharacter, passTime, rest, useFeature, comeTo } = await import("./dnd.ts");
  const crake = [{ id: "crake-1", name: "the talking Crake", statblock: "thug" }] as unknown as Character[];
  // "Magic Missile at second level": four darts, from a 2nd-level slot.
  const wizard = await pregenSession({ pregen: "wizard", seed: 6 });
  const up = await cast(wizard, crake, "magic-missile", ["crake-1"], { said: "*I cast Magic Missile at second level: four darts into the Crake's back*" });
  assert.match(up.lines[0]!, /^Cast Magic Missile \(2nd-level slot\) on /);
  assert.equal(up.lines.filter(l => /takes \d+ force damage/.test(l)).length, 4, up.lines.join("\n"));
  assert.match(wizard.rules!.status!, /2nd 1\/2/);
  // "My strongest slot" is the highest free; no word of it is the lowest.
  const plain = await cast(wizard, crake, "magic-missile", ["crake-1"], { said: "Magic Missile at the Crake" });
  assert.match(plain.lines[0]!, /\(1st-level slot\)/);
  // Aimed at a thing nobody could make out: asked, and nothing spent.
  const before = wizard.rules!.status;
  const asked = await cast(wizard, [], "fire-bolt", [], { said: "Fire Bolt up there", unclear: true });
  assert.match(asked.lines[0]!, /^\(Fire Bolt: at what\?/);
  assert.equal(wizard.rules!.status, before);
  // A Rage: ten minutes, or until a rest or a knock-out (it had outlasted both).
  const state = { id: "rage-ends", sceneId: "hanged-clerk", approach: "v2", seed: 3, rollCount: 0, player: { name: "Grukka", concept: "a half-orc barbarian", modifiers: {} },
    turn: 0, beat: "yard", turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null, patches: [], repairs: [], transcript: [], metrics: [], history: [] } as import("../runtime/session.ts").SessionState;
  await createCharacter(state, 3, { classId: "barbarian", subclassId: "path-of-the-berserker", speciesId: "orc", backgroundId: "soldier", abilities: ["STR", "CON", "DEX", "WIS", "CHA", "INT"], skills: ["athletics", "intimidation"], feat: "savage-attacker", cantrips: [], spells: [], weapons: ["greataxe", "handaxe"], armor: "none", shield: false } as Build);
  await useFeature(state, [], "rage");
  assert.match(state.rules!.status!, /raging/);
  assert.deepEqual(await passTime(state, 5), []);
  assert.deepEqual(await passTime(state, 5), ["Your rage burns out"]);
  assert.doesNotMatch(state.rules!.status!, /raging/);
  await rest(state, "short");
  await useFeature(state, [], "rage");
  assert.doesNotMatch((await rest(state, "long")).lines.join("\n"), /raging/);
  await useFeature(state, [], "rage");
  await comeTo(state);
  assert.doesNotMatch(state.rules!.status!, /raging/);
});

test("Detect Magic says what it senses: on the map there's no GM to (wizard#34)", async () => {
  const { buildWorld } = await import("../world/scene-world.ts");
  const { hangedClerkWorld } = await import("../../scenes/worlds/hanged-clerk.ts");
  const build = { ...PREGENS.wizard!.build, spells: ["detect-magic", ...PREGENS.wizard!.build.spells] } as Build;
  const state = await pregenSession({ build, seed: 4, sceneId: "hanged-clerk" });
  state.world = buildWorld("hanged-clerk", hangedClerkWorld, [], { name: state.player.name });
  assert.ok((await castSpell(state, [], "detect-magic", [], { ritual: true })).lines.includes("You sense no magic within 30 feet"));
  state.world.entities.satchel!.tags.push("magic");
  assert.ok((await castSpell(state, [], "detect-magic", [], { ritual: true })).lines.includes("You sense magic within 30 feet: Prout's satchel"));
});

test("what a spell conjured goes when the spell does, and with the scene: the lights and the hand don't stay on the map (wizard#34)", async () => {
  const { buildWorld, applyOps } = await import("../world/scene-world.ts");
  const { hangedClerkWorld } = await import("../../scenes/worlds/hanged-clerk.ts");
  const { markConjured, dispelConjured } = await import("./dnd.ts");
  const world = buildWorld("hanged-clerk", hangedClerkWorld, [], { name: "Pell" });
  const blank = { what: "", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] };
  // As the stage manager wrote the wizard's turns: the lights, then the hand, each the turn it was cast.
  applyOps(world, [{ ...blank, op: "create", name: "four pigeon-shaped lights", kind: "object", to: "yard" }], 5, "stage");
  applyOps(world, [{ ...blank, op: "create", name: "a spectral hand", kind: "object", to: "yard" }, { ...blank, op: "create", name: "a basket of eels", kind: "object", to: "yard" }], 6, "stage");
  markConjured(world, "dancing-lights", 5);
  markConjured(world, "mage-hand", 6);
  const lights = Object.values(world.entities).find(e => e.name === "four pigeon-shaped lights")!;
  const hand = Object.values(world.entities).find(e => e.name === "a spectral hand")!;
  const eels = Object.values(world.entities).find(e => e.name === "a basket of eels")!;
  assert.ok(lights.tags.includes("conjured:dancing-lights") && hand.tags.includes("conjured:mage-hand") && !eels.tags.includes("conjured"));
  // Dancing Lights runs out: the lights go, the hand stays.
  dispelConjured(world, ["dancing-lights"], 7);
  assert.deepEqual([lights.states.includes("gone"), hand.states.includes("gone")], [true, false]);
  // The scene ends: whatever a spell conjured goes; the eels stay.
  dispelConjured(world, undefined, 8);
  assert.deepEqual([hand.states.includes("gone"), eels.states.includes("gone")], [true, false]);
});
