// The engine's cases from the prototype's src/rules/builds.test.ts at 44c6d4a: the offline three made as threeBuilds makes them offline (defaultBuilds through the engine); a model's build made legal through throughEngine rather than threeBuilds (the model's half and the three-way pick are the AI service's: ai/rules/builds.ts); levelUp's half of the top-slot case waits for V7; and the prototype's own offers, lists and cards (recorded) as well.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./shim.ts";
import * as E from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { backgroundFor, cardText, classDefault, classesFor, defaultBuilds, ownBuild, picksOf, speciesFor, srdLists, throughEngine } from "./builds.ts";
import { CASTING, cantripsAt, createCharacter, settleBuild, sheetData, sheetText } from "./character.ts";
import { rulesFrom } from "./engine.ts";
import type { Build, BuildOption, Offer, RulesSession, SrdFile, SrdLists } from "./types.ts";

/**
 * Character creation's choices (builds.ts), through the engine and without a model: the class
 * defaults the concept's words suggest, each legal (the SRD's ids, spells on the class's list and as
 * many as the level allows, weapons and armour the class can use) and made by the engine; a build of
 * the player's own; a card's numbers, which are the sheet's; and what the prototype made of the same.
 */

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as unknown;
const rules = rulesFrom(E, read("../../vendor/dnd-srd-engine/starter-pack.json"), read("../../vendor/srd-spells/spells.json") as SrdFile);
const content = rules.content;

/** Every way a build could fail to be legal, as a list (empty when it's legal). */
function illegal(b: Build, level: number): string[] {
  const out: string[] = [];
  if (!content.classes.has(b.classId)) out.push(`class ${b.classId}`);
  if (!content.species.has(b.speciesId)) out.push(`species ${b.speciesId}`);
  if (!content.backgrounds.has(b.backgroundId)) out.push(`background ${b.backgroundId}`);
  if (b.subclassId && !content.subclasses.has(b.subclassId)) out.push(`subclass ${b.subclassId}`);
  const limits = CASTING[b.classId];
  for (const id of [...b.cantrips, ...b.spells]) {
    const s = content.spells.get(id);
    if (!s || !s.classes.includes(b.classId)) out.push(`spell ${id} isn't a ${b.classId}'s`);
    else if (limits && s.level > limits.maxSpell(level)) out.push(`spell ${id} is too high for level ${level}`);
  }
  if (limits && b.cantrips.length > cantripsAt(b.classId, level)) out.push(`${b.cantrips.length} cantrips`);
  if (limits && b.spells.length > limits.prepared(level)) out.push(`${b.spells.length} spells`);
  if (!limits && (b.cantrips.length || b.spells.length)) out.push("spells for a class without them");
  for (const w of b.weapons) if (!content.items.has(w)) out.push(`weapon ${w}`);
  if (b.armor !== "none" && !content.items.has(b.armor)) out.push(`armour ${b.armor}`);
  return out;
}

/** What threeBuilds offers offline: the class defaults the concept's words suggest, each through the engine. */
const offline = (name: string, concept: string): BuildOption[] =>
  defaultBuilds(concept).map(d => ({ ...throughEngine(rules, d.build, 3, name), plays: d.plays, from: "defaults" as const }));

const CONCEPTS = [
  "a quick-witted half-elf ranger with a longbow, a dry sense of humour and a soft spot for underdogs",
  "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier",
  "a large, gentle hedge-priest who settles arguments by sitting on them",
  "a Nine Furrows weather-witch who is never wrong about rain and rarely right about people",
  "a dwarf ex-soldier of the river watch with a bad knee and a worse temper",
  "someone",
];

test("offline: three builds from the class defaults the concept's words suggest, three different classes, each legal and made by the engine", () => {
  for (const concept of CONCEPTS) {
    const options = offline("Wren Ashdown", concept);
    assert.equal(options.length, 3, concept);
    assert.equal(new Set(options.map(o => o.build.classId)).size, 3, `three different classes for ${concept}`);
    assert.deepEqual(options.map(o => o.build.classId), classesFor(concept).slice(0, 3), "the classes the words suggest, best first");
    for (const o of options) {
      assert.deepEqual(illegal(o.build, 3), [], `${o.line} is legal`);
      assert.ok(o.card.hp > 0 && o.card.ac >= 10, `${o.line}: HP ${o.card.hp}, AC ${o.card.ac}`);
      assert.ok(o.plays.length > 20, "a line on how they'd play");
      assert.match(o.line, new RegExp(`${o.build.classId} 3`), "the engine's own line for it");
      assert.ok(o.card.attack || o.card.casting, "a main attack or spells");
      assert.ok(o.card.subclass, "level 3 has a subclass");
    }
  }
});

test("the concept's words: a ranger's concept leads with the ranger, a half-elf is an elf, a hedge-priest an acolyte", () => {
  assert.equal(classesFor(CONCEPTS[0]!)[0], "ranger");
  assert.equal(speciesFor(CONCEPTS[0]!), "elf");
  assert.equal(classesFor(CONCEPTS[1]!)[0], "rogue");
  assert.equal(backgroundFor(CONCEPTS[1]!), "sage", "an auditor with a ledger is a sage before a disgraced one is a criminal");
  assert.equal(classesFor(CONCEPTS[2]!)[0], "cleric");
  assert.equal(backgroundFor(CONCEPTS[2]!), "acolyte");
  assert.equal(classesFor(CONCEPTS[3]!)[0], "druid");
  assert.equal(speciesFor(CONCEPTS[4]!), "dwarf");
  assert.equal(backgroundFor(CONCEPTS[4]!), "soldier");
  // With nothing to go on: an investigator's three.
  assert.deepEqual(classesFor("someone").slice(0, 3), ["rogue", "fighter", "wizard"]);
  assert.ok(defaultBuilds(CONCEPTS[0]!).every(b => b.build.speciesId === "elf"), "the species the concept names, for all three");
  // A class's own: what the AI service fills a doubled class with, and how it plays.
  assert.deepEqual(classDefault("wizard").build.spells.slice(0, 2), ["magic-missile", "shield"]);
  assert.match(classDefault("bard").plays, /Bardic Inspiration/);
  assert.equal(classDefault("necromancer").build.classId, "necromancer", "the rogue's defaults under the asked id: settleBuild makes it a rogue");
});

test("a model's build made legal: unknown ids fall back, another class's spells and one too high go, armour the class can't wear goes, names read as ids", () => {
  const wizard = throughEngine(rules, { classId: "wizard", subclassId: "evoker", speciesId: "gnome", backgroundId: "sage", abilities: ["INT", "DEX"], skills: ["arcana"], feat: "alert", cantrips: ["fire-bolt", "eldritch-blast", "nonsense"], spells: ["magic-missile", "fireball", "cure-wounds"], weapons: ["quarterstaff"], armor: "plate", shield: true }, 3, "Pell Marrow").build;
  assert.deepEqual(illegal(wizard, 3), []);
  assert.ok(!wizard.cantrips.includes("eldritch-blast") && !wizard.spells.includes("cure-wounds") && !wizard.spells.includes("fireball"), "another class's spells, and one too high, gone");
  assert.equal(wizard.armor, "none", "a wizard can't wear plate");
  const bard = throughEngine(rules, { classId: "bard", subclassId: "nope", speciesId: "mermaid", backgroundId: "pirate", abilities: ["CHA"], skills: ["performance"], feat: "made-up", cantrips: ["vicious-mockery"], spells: ["healing-word"], weapons: ["lute"], armor: "leather-armor", shield: false }, 3).build;
  assert.deepEqual([bard.speciesId, bard.backgroundId, bard.feat, bard.subclassId], ["human", "criminal", "alert", ""], "unknown ids fall back");
  assert.deepEqual(illegal(bard, 3), []);
  const cleric = throughEngine(rules, { classId: "Cleric", subclassId: "Life Domain", speciesId: "Goliath", backgroundId: "Acolyte", abilities: ["Wisdom", "Constitution", "Strength"], skills: ["Insight", "Medicine"], feat: "Magic Initiate (Cleric)", cantrips: ["Guidance", "Spare the Dying", "Thaumaturgy"], spells: ["Cure Wounds", "Healing Word", "Bless"], weapons: ["Mace"], armor: "Chain Shirt", shield: true, style: "none" }, 3).build;
  assert.deepEqual([cleric.classId, cleric.subclassId, cleric.speciesId, cleric.backgroundId, cleric.armor], ["cleric", "life-domain", "goliath", "acolyte", "chain-shirt"]);
  assert.deepEqual(cleric.abilities.slice(0, 3), ["WIS", "CON", "STR"]);
  assert.ok(cleric.spells.includes("cure-wounds") && cleric.cantrips.includes("spare-the-dying") && cleric.weapons[0] === "mace");
  assert.equal(cleric.feat, "magic-initiate-cleric", "a feat by its name");
  assert.equal(throughEngine(rules, { classId: "Fighter", weapons: ["Greatsword"], armor: "Chain Mail", style: "Great Weapon Fighting" }, 3).build.style, "great-weapon");
  assert.equal(throughEngine(rules, { classId: "Ranger", weapons: ["Longbow"], spells: ["Hunter's Mark"], style: "Fighting Style: Archery" }, 3).build.style, "archery");
});

test("a card's numbers are the sheet's: what's offered is what's made", () => {
  for (const o of offline("Tamsin Vell", CONCEPTS[1]!)) {
    const session: RulesSession = { id: "card", seed: 5, rollCount: 0, player: { name: "Tamsin Vell", concept: CONCEPTS[1]!, modifiers: {} } };
    createCharacter(rules, session, 3, o.build);
    const sheet = sheetData(rules, session)!;
    assert.equal(sheet.hp.max, o.card.hp, `${o.line}: HP`);
    assert.equal(sheet.ac, o.card.ac, `${o.line}: AC`);
    assert.equal(session.player.build, o.line, "the same build line");
    const held = sheet.attacks.find(a => a.held);
    if (held) assert.equal(`${held.name} ${held.bonus} ${held.damage}`, `${o.card.attack!.name} ${o.card.attack!.bonus} ${o.card.attack!.damage}`);
  }
});

test("making their own: any species, class and background from the SRD's lists comes out legal, with the class's subclass at level 3 and none below it", () => {
  const lists = srdLists(rules, 3);
  assert.equal(lists.species.length, 9);
  assert.equal(lists.classes.length, 12);
  assert.equal(lists.backgrounds.length, 4);
  for (const c of lists.classes) assert.ok((lists.subclasses[c.id] ?? []).length >= 1, `${c.name} has a subclass to choose`);
  assert.ok(lists.species.every(s => s.about) && lists.classes.every(c => /hit die/.test(c.about)) && lists.backgrounds.every(b => b.about), "each with a line about it");
  // Every class, each with a species and a background round the lists.
  for (const [i, c] of lists.classes.entries()) {
    const picks = { speciesId: lists.species[i % 9]!.id, classId: c.id, subclassId: lists.subclasses[c.id]![0]!.id, backgroundId: lists.backgrounds[i % 4]!.id };
    const own = ownBuild(rules, picks, 3, "Grimm");
    assert.equal(own.from, "own");
    assert.deepEqual([own.build.speciesId, own.build.classId, own.build.subclassId, own.build.backgroundId], [picks.speciesId, picks.classId, picks.subclassId, picks.backgroundId]);
    assert.deepEqual(illegal(own.build, 3), [], own.line);
    assert.equal(own.card.subclass, lists.subclasses[c.id]![0]!.name, `${own.line}: the subclass made`);
    assert.deepEqual(picksOf(own.build), picks, "the picks it was made from");
  }
  const young = ownBuild(rules, { speciesId: "human", classId: "fighter", subclassId: "champion", backgroundId: "soldier" }, 2, "Grimm");
  assert.equal(young.card.subclass, undefined, "no subclass before level 3");
  assert.equal(young.card.level, 2);
  // What isn't on the lists is refused, saying what is: a necromancer isn't quietly a rogue.
  assert.throws(() => ownBuild(rules, { speciesId: "elf", classId: "necromancer", backgroundId: "soldier" }, 3), /No class "necromancer" in the SRD: one of barbarian, bard/);
  assert.throws(() => ownBuild(rules, { speciesId: "half-giant", classId: "wizard", backgroundId: "sage" }, 3), /No species "half-giant"/);
  assert.throws(() => ownBuild(rules, { speciesId: "elf", classId: "wizard", subclassId: "champion", backgroundId: "sage" }, 3), /No wizard subclass "champion" in the SRD: one of evoker/);
  assert.throws(() => ownBuild(rules, { speciesId: "elf", classId: "wizard", backgroundId: "pirate" }, 3), /No background "pirate"/);
});

test("settling a build twice changes nothing: the build the card was made from is the build the game makes", () => {
  for (const o of offline("Wren", CONCEPTS[3]!)) assert.deepEqual(settleBuild(o.build, 3, content), o.build);
  const made = throughEngine(rules, { classId: "sorcerer", spells: ["fireball"], cantrips: [] }, 5, "Vesper");
  assert.deepEqual(settleBuild(made.build, 5, content), made.build);
  assert.ok(made.build.spells.includes("fireball"), "fireball at level 5");
});

test("a Fighting Style that fits: the model's own, where its class has it; otherwise the one the weapons suggest", () => {
  const style = (o: { card: { features: string[] } }) => o.card.features.find(f => f.startsWith("Fighting Style"));
  // The model's: a duellist's Dueling.
  assert.equal(style(throughEngine(rules, { classId: "fighter", weapons: ["rapier"], armor: "leather-armor", shield: false, style: "dueling" }, 3, "Lucan")), "Fighting Style (Dueling)");
  // None chosen: by the weapons. A greatsword's Great Weapon Fighting, a bow's Archery, a shield's Defense, two light blades'.
  assert.equal(style(throughEngine(rules, { classId: "fighter", weapons: ["greatsword"], shield: false }, 3)), "Fighting Style (Great Weapon Fighting)");
  assert.equal(style(throughEngine(rules, { classId: "ranger", weapons: ["longbow", "shortsword"] }, 3)), "Fighting Style (Archery)");
  assert.equal(style(throughEngine(rules, { classId: "paladin", weapons: ["longsword"], shield: true }, 3)), "Fighting Style (Defense)");
  assert.equal(style(throughEngine(rules, { classId: "ranger", weapons: ["shortsword", "scimitar"], shield: false }, 3)), "Fighting Style (Two-Weapon Fighting)");
  // One the class hasn't got is dropped (a paladin has no Archery), and a class without styles has none.
  assert.equal(settleBuild({ classId: "paladin", style: "archery" }, 3, content).style, undefined);
  assert.equal(style(throughEngine(rules, { classId: "paladin", weapons: ["longbow"], shield: false, style: "archery" }, 3)), "Fighting Style (Defense)");
  assert.equal(settleBuild({ classId: "rogue", style: "dueling" }, 3, content).style, undefined);
  // The offline fighter (a longsword and a shield) fights with Defense.
  const fighter = offline("Bram", "a broken-nosed ex-soldier of the watch").find(o => o.build.classId === "fighter")!;
  assert.equal(style(fighter), "Fighting Style (Defense)");
});

test("a card says the damage the dice roll: Dueling's +2 with one melee weapon and nothing in the other hand, and only then", () => {
  const fencer = { classId: "fighter", speciesId: "human", backgroundId: "soldier", weapons: ["rapier", "longbow"], armor: "chain-mail", shield: false, abilities: ["DEX", "CON", "STR", "WIS", "CHA", "INT"] };
  const duelling = throughEngine(rules, { ...fencer, style: "dueling" }, 3, "Lucan");
  const defending = throughEngine(rules, { ...fencer, style: "defense" }, 3, "Lucan");
  assert.equal(defending.card.attack!.damage, "1d8+3", "Dexterity's +3");
  assert.equal(duelling.card.attack!.damage, "1d8+5", "and Dueling's +2");
  assert.equal(duelling.card.attack!.bonus, defending.card.attack!.bonus, "to damage, not to hit");
  // A shield in the other hand is no weapon: still Dueling.
  assert.equal(throughEngine(rules, { classId: "paladin", speciesId: "human", backgroundId: "soldier", weapons: ["longsword"], armor: "chain-mail", shield: true, style: "dueling" }, 3).card.attack!.damage, "1d8+5");
  // The rolls agree: the engine's own damage for the same character, on the sheet and the QA console's.
  const session: RulesSession = { id: "dueling", seed: 5, rollCount: 0, player: { name: "Lucan", concept: "a duellist", modifiers: {} } };
  createCharacter(rules, session, 3, duelling.build);
  const sheet = sheetData(rules, session)!;
  assert.equal(sheet.attacks.find(a => a.held)!.damage, "1d8+5");
  assert.match(sheetText(sheet), /Rapier \+5 \(1d8\+5 piercing\)/, "the QA console's sheet too");
});

test("a caster's highest slots have a spell of their own (wizard#34)", () => {
  // The elf wizard's build as the model chose it: six 1st-level spells at level 3, with 2nd-level slots.
  const asked: Partial<Build> = { classId: "wizard", subclassId: "evoker", speciesId: "elf", backgroundId: "sage", abilities: ["INT", "CON", "DEX", "WIS", "CHA", "STR"], skills: ["arcana", "investigation"], feat: "skilled",
    cantrips: ["fire-bolt", "mage-hand", "message"], spells: ["find-familiar", "identify", "detect-magic", "comprehend-languages", "shield", "magic-missile"], weapons: ["quarterstaff", "dagger"], armor: "none", shield: false };
  const build = settleBuild(asked, 3, content);
  assert.equal(build.spells.length, 6);
  assert.ok(build.spells.some(id => content.spells.get(id)?.level === 2), build.spells.join(", "));
  // The last ritual of the model's (Comprehend Languages) makes way: Shield and Magic Missile stay.
  assert.deepEqual(asked.spells!.filter(id => !build.spells.includes(id)), ["comprehend-languages"]);
});

// ---------------------------------------------------------------------------------------------
// The prototype's own, recorded (tools/v2/record-v1-golden.mts).

test("the prototype's offline offer, the SRD's lists and an own build (the client's fixtures) are v2's", () => {
  const offer = read("../../client/check/fixtures/offer-tamsin.json") as Offer;
  assert.match(offer.note ?? "", /offline/);
  assert.deepEqual(offline("Tamsin Vell", CONCEPTS[1]!), offer.options);
  assert.deepEqual(srdLists(rules, 3), read("../../client/check/fixtures/srd-lists.json") as SrdLists);
  assert.deepEqual(ownBuild(rules, { speciesId: "orc", classId: "rogue", subclassId: "thief", backgroundId: "criminal" }, 3, "Tamsin Vell"), read("../../client/check/fixtures/own-option.json") as BuildOption);
});

test("the cards the prototype made of the model's three, and of the defaults it filled with, are the cards v2 makes of the same builds", () => {
  for (const file of ["builds-tamsin", "builds-odo", "builds-pell"]) {
    const { args, result } = read(`../../ai/rules/golden/${file}.json`) as { args: { name: string }; result: Offer };
    for (const o of result.options) assert.deepEqual({ ...throughEngine(rules, o.build, 3, args.name), plays: o.plays, from: o.from }, o, `${file}: ${o.line}`);
  }
});

test("cardText: the QA console's card, a caster's with the spells it comes with", () => {
  const [rogue, bard] = (read("../../client/check/fixtures/offer-tamsin.json") as Offer).options as [BuildOption, BuildOption];
  assert.equal(cardText(rogue), [
    "Halfling Rogue 3 · Thief · Sage",
    "Soft shoes and a sharp eye: you notice what others miss, open what's locked, and Sneak Attack when it counts.",
    "HP 27 · AC 13 · 30 ft · Rapier +4 1d8+2 piercing · Sneak Attack (2d6) · Expertise (Insight, Investigation) · Cunning Action",
    "Skills: Investigation, Insight, Stealth, Perception, Arcana, History",
  ].join("\n"));
  assert.equal(cardText(bard).split("\n")[2], "HP 24 · AC 13 · 30 ft · Rapier +2 1d8+2 piercing · spells DC 12, +4 (Fire Bolt, Minor Illusion, Vicious Mockery, Charm Person, Dissonant Whispers, Faerie Fire, Healing Word, Shatter, Suggestion) · Bardic Inspiration ×2 · Expertise");
});
