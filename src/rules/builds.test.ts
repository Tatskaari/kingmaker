import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ask } from "../llm/openrouter.ts";
import { backgroundFor, classesFor, defaultBuilds, ownBuild, speciesFor, srdLists, threeBuilds, throughEngine, type BuildOption } from "./builds.ts";
import { CASTING, settleBuild, srdContent, type Build } from "./dnd.ts";

/**
 * Character creation's choices (src/rules/builds.ts), no model calls: three builds for a concept,
 * each legal (the SRD's ids, spells on the class's list and as many as the level allows, weapons and
 * armour the class can use) and made by the engine, three different classes whatever the model
 * says; offline, the class defaults the concept's words suggest; a build of the player's own; and a
 * card's numbers, which are the sheet's.
 */

process.env.OPENROUTER_API_KEY = "offline";

/** Every way a build could fail to be legal, as a list (empty when it's legal). */
async function illegal(b: Build, level: number): Promise<string[]> {
  const content = await srdContent();
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
  if (limits && b.cantrips.length > limits.cantrips) out.push(`${b.cantrips.length} cantrips`);
  if (limits && b.spells.length > limits.prepared(level)) out.push(`${b.spells.length} spells`);
  if (!limits && (b.cantrips.length || b.spells.length)) out.push("spells for a class without them");
  for (const w of b.weapons) if (!content.items.has(w)) out.push(`weapon ${w}`);
  if (b.armor !== "none" && !content.items.has(b.armor)) out.push(`armour ${b.armor}`);
  return out;
}

const CONCEPTS = [
  "a quick-witted half-elf ranger with a longbow, a dry sense of humour and a soft spot for underdogs",
  "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier",
  "a large, gentle hedge-priest who settles arguments by sitting on them",
  "a Nine Furrows weather-witch who is never wrong about rain and rarely right about people",
  "a dwarf ex-soldier of the river watch with a bad knee and a worse temper",
  "someone",
];

test("offline: three builds from the class defaults the concept's words suggest, three different classes, each legal and made by the engine", async () => {
  for (const concept of CONCEPTS) {
    const offer = await threeBuilds("Wren Ashdown", concept, 3);
    assert.match(offer.note ?? "", /offline/, "it says why they're the defaults");
    assert.equal(offer.options.length, 3, concept);
    assert.equal(new Set(offer.options.map(o => o.build.classId)).size, 3, `three different classes for ${concept}`);
    assert.deepEqual(offer.options.map(o => o.build.classId), classesFor(concept).slice(0, 3), "the classes the words suggest, best first");
    for (const o of offer.options) {
      assert.deepEqual(await illegal(o.build, 3), [], `${o.line} is legal`);
      assert.equal(o.from, "defaults");
      assert.ok(o.card.hp > 0 && o.card.ac >= 10, `${o.line}: HP ${o.card.hp}, AC ${o.card.ac}`);
      assert.ok(o.plays.length > 20, "a line on how they'd play");
      assert.match(o.line, new RegExp(`${o.build.classId} 3`), "the engine's own line for it");
      assert.ok(o.card.attack || o.card.casting, "a main attack or spells");
      assert.ok(o.card.subclass, "level 3 has a subclass");
    }
  }
});

test("the concept's words: a ranger's concept leads with the ranger, a half-elf is an elf, a hedge-priest an acolyte", async () => {
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
  const named = defaultBuilds(CONCEPTS[0]!);
  assert.ok(named.every(b => b.build.speciesId === "elf"), "the species the concept names, for all three");
});

/** A model that answers rules.builds with what it's given. */
const answering = (builds: Record<string, unknown>): Ask => (async <T>(request: { operation: string }) => {
  assert.equal(request.operation, "rules.builds", "one call for all three");
  return builds as T;
}) as Ask;

test("the model's three, made legal: unknown ids fall back, spells off the class's list go, a class it doubled is made up from the defaults", async () => {
  let calls = 0;
  const ask: Ask = async <T>(request: Parameters<Ask>[0]) => {
    calls++;
    return answering({
      first: { classId: "wizard", subclassId: "evoker", speciesId: "gnome", backgroundId: "sage", abilities: ["INT", "DEX"], skills: ["arcana"], feat: "alert", cantrips: ["fire-bolt", "eldritch-blast", "nonsense"], spells: ["magic-missile", "fireball", "cure-wounds"], weapons: ["quarterstaff"], armor: "plate", shield: true, plays: "Reads first, burns later." },
      second: { classId: "wizard", subclassId: "", speciesId: "elf", backgroundId: "sage", abilities: [], skills: [], feat: "", cantrips: [], spells: [], weapons: [], armor: "none", shield: false, plays: "A second wizard." },
      third: { classId: "bard", subclassId: "nope", speciesId: "mermaid", backgroundId: "pirate", abilities: ["CHA"], skills: ["performance"], feat: "made-up", cantrips: ["vicious-mockery"], spells: ["healing-word"], weapons: ["lute"], armor: "leather-armor", shield: false, plays: "" },
    })<T>(request);
  };
  const offer = await threeBuilds("Pell Marrow", "a hedge-wizard who has read about fire", 3, { ask });
  assert.equal(calls, 1, "one model call");
  assert.equal(offer.note, undefined, "the model's, so no note");
  const classes = offer.options.map(o => o.build.classId);
  assert.equal(new Set(classes).size, 3, `three different classes: ${classes.join(", ")}`);
  assert.deepEqual(classes.slice(0, 2), ["wizard", "bard"], "the model's two different ones, in its order");
  const [wizard, bard, filled] = offer.options as [BuildOption, BuildOption, BuildOption];
  assert.equal(wizard.from, "model");
  assert.equal(filled.from, "defaults");
  for (const o of offer.options) assert.deepEqual(await illegal(o.build, 3), [], o.line);
  assert.ok(!wizard.build.cantrips.includes("eldritch-blast") && !wizard.build.spells.includes("cure-wounds") && !wizard.build.spells.includes("fireball"), "another class's spells, and one too high, gone");
  assert.equal(wizard.build.armor, "none", "a wizard can't wear plate");
  assert.equal(wizard.plays, "Reads first, burns later.");
  assert.equal(bard.build.speciesId, "human", "an unknown species falls back");
  assert.equal(bard.build.backgroundId, "criminal", "an unknown background falls back");
  assert.ok(bard.plays.length > 20, "no line from the model: the class's own");
});

test("the model's three written as names, not ids (\"Cleric\", \"Life Domain\", \"Wisdom\"): read as the ids they are", async () => {
  const ask = answering({
    first: { classId: "Cleric", subclassId: "Life Domain", speciesId: "Goliath", backgroundId: "Acolyte", abilities: ["Wisdom", "Constitution", "Strength"], skills: ["Insight", "Medicine"], feat: "Magic Initiate (Cleric)", cantrips: ["Guidance", "Spare the Dying", "Thaumaturgy"], spells: ["Cure Wounds", "Healing Word", "Bless"], weapons: ["Mace"], armor: "Chain Shirt", shield: true, style: "none", plays: "Sits on the argument." },
    second: { classId: "Fighter", subclassId: "Champion", speciesId: "Half-Orc", backgroundId: "Soldier", abilities: ["STR"], skills: [], feat: "", cantrips: [], spells: [], weapons: ["Greatsword"], armor: "Chain Mail", shield: false, style: "Great Weapon Fighting", plays: "Hits it." },
    third: { classId: "Ranger", subclassId: "Hunter", speciesId: "Elf", backgroundId: "Sage", abilities: ["DEX"], skills: [], feat: "", cantrips: [], spells: ["Hunter's Mark"], weapons: ["Longbow"], armor: "Studded Leather", shield: false, style: "Fighting Style: Archery", plays: "Shoots it." },
  });
  const offer = await threeBuilds("Brother Odo", "a large, gentle hedge-priest who settles arguments by sitting on them", 3, { ask });
  assert.deepEqual(offer.options.map(o => o.from), ["model", "model", "model"], "all three the model's");
  const [cleric, fighter, ranger] = offer.options as [BuildOption, BuildOption, BuildOption];
  assert.deepEqual([cleric.build.classId, cleric.build.subclassId, cleric.build.speciesId, cleric.build.backgroundId, cleric.build.armor], ["cleric", "life-domain", "goliath", "acolyte", "chain-shirt"]);
  assert.deepEqual(cleric.build.abilities.slice(0, 3), ["WIS", "CON", "STR"]);
  assert.ok(cleric.build.spells.includes("cure-wounds") && cleric.build.cantrips.includes("spare-the-dying") && cleric.build.weapons[0] === "mace");
  assert.equal(cleric.build.feat, "magic-initiate-cleric", "a feat by its name");
  assert.equal(fighter.build.style, "great-weapon");
  assert.equal(ranger.build.style, "archery");
  assert.ok(ranger.build.spells.includes("hunters-mark"));
  for (const o of offer.options) assert.deepEqual(await illegal(o.build, 3), [], o.line);
});

test("the model failing: the class defaults, and the note says the GM couldn't be reached", async () => {
  const ask: Ask = async () => { throw new Error("HTTP 503: the river is up"); };
  const offer = await threeBuilds("Wren", "a quick-witted ranger", 3, { ask });
  assert.match(offer.note ?? "", /couldn't be reached.*503/);
  assert.equal(offer.options.length, 3);
  assert.ok(offer.options.every(o => o.from === "defaults"));
});

test("a card's numbers are the sheet's: what's offered is what's made", async () => {
  const offer = await threeBuilds("Tamsin Vell", CONCEPTS[1]!, 3);
  const { createSession } = await import("../runtime/engine.ts");
  const { sheetData } = await import("./dnd.ts");
  for (const o of offer.options) {
    const session = await createSession({ sceneId: "hanged-clerk", approach: "v2", player: `Tamsin Vell: ${CONCEPTS[1]}`, level: 3, build: o.build, seed: 5 });
    const sheet = (await sheetData(session))!;
    assert.equal(sheet.hp.max, o.card.hp, `${o.line}: HP`);
    assert.equal(sheet.ac, o.card.ac, `${o.line}: AC`);
    assert.equal(session.player.build, o.line, "the same build line");
    const held = sheet.attacks.find(a => a.held);
    if (held) assert.equal(`${held.name} ${held.bonus} ${held.damage}`, `${o.card.attack!.name} ${o.card.attack!.bonus} ${o.card.attack!.damage}`);
  }
});

test("making their own: any species, class and background from the SRD's lists comes out legal, with the class's subclass at level 3 and none below it", async () => {
  const lists = await srdLists(3);
  assert.equal(lists.species.length, 9);
  assert.equal(lists.classes.length, 12);
  assert.equal(lists.backgrounds.length, 4);
  for (const c of lists.classes) assert.ok((lists.subclasses[c.id] ?? []).length >= 1, `${c.name} has a subclass to choose`);
  assert.ok(lists.species.every(s => s.about) && lists.classes.every(c => /hit die/.test(c.about)) && lists.backgrounds.every(b => b.about), "each with a line about it");
  // Every class, each with a species and a background round the lists.
  for (const [i, c] of lists.classes.entries()) {
    const picks = { speciesId: lists.species[i % 9]!.id, classId: c.id, subclassId: lists.subclasses[c.id]![0]!.id, backgroundId: lists.backgrounds[i % 4]!.id };
    const own = await ownBuild(picks, 3, "Grimm");
    assert.equal(own.from, "own");
    assert.deepEqual([own.build.speciesId, own.build.classId, own.build.subclassId, own.build.backgroundId], [picks.speciesId, picks.classId, picks.subclassId, picks.backgroundId]);
    assert.deepEqual(await illegal(own.build, 3), [], own.line);
    assert.equal(own.card.subclass, lists.subclasses[c.id]![0]!.name, `${own.line}: the subclass made`);
  }
  const young = await ownBuild({ speciesId: "human", classId: "fighter", subclassId: "champion", backgroundId: "soldier" }, 2, "Grimm");
  assert.equal(young.card.subclass, undefined, "no subclass before level 3");
  assert.equal(young.card.level, 2);
  // What isn't on the lists is refused, saying what is: a necromancer isn't quietly a rogue.
  await assert.rejects(ownBuild({ speciesId: "elf", classId: "necromancer", backgroundId: "soldier" }, 3), /No class "necromancer" in the SRD: one of barbarian, bard/);
  await assert.rejects(ownBuild({ speciesId: "half-giant", classId: "wizard", backgroundId: "sage" }, 3), /No species "half-giant"/);
  await assert.rejects(ownBuild({ speciesId: "elf", classId: "wizard", subclassId: "champion", backgroundId: "sage" }, 3), /No wizard subclass "champion" in the SRD: one of evoker/);
  await assert.rejects(ownBuild({ speciesId: "elf", classId: "wizard", backgroundId: "pirate" }, 3), /No background "pirate"/);
});

test("settling a build twice changes nothing: the build the card was made from is the build the game makes", async () => {
  const content = await srdContent();
  for (const o of (await threeBuilds("Wren", CONCEPTS[3]!, 3)).options) assert.deepEqual(settleBuild(o.build, 3, content), o.build);
  const made = await throughEngine({ classId: "sorcerer", spells: ["fireball"], cantrips: [] }, 5, "Vesper");
  assert.deepEqual(settleBuild(made.build, 5, content), made.build);
  assert.ok(made.build.spells.includes("fireball"), "fireball at level 5");
});

test("a Fighting Style that fits: the model's own, where its class has it; otherwise the one the weapons suggest", async () => {
  const content = await srdContent();
  const style = (o: { card: { features: string[] } }) => o.card.features.find(f => f.startsWith("Fighting Style"));
  // The model's: a duellist's Dueling.
  assert.equal(style(await throughEngine({ classId: "fighter", weapons: ["rapier"], armor: "leather-armor", shield: false, style: "dueling" }, 3, "Lucan")), "Fighting Style (Dueling)");
  // None chosen: by the weapons. A greatsword's Great Weapon Fighting, a bow's Archery, a shield's Defense, two light blades'.
  assert.equal(style(await throughEngine({ classId: "fighter", weapons: ["greatsword"], shield: false }, 3)), "Fighting Style (Great Weapon Fighting)");
  assert.equal(style(await throughEngine({ classId: "ranger", weapons: ["longbow", "shortsword"] }, 3)), "Fighting Style (Archery)");
  assert.equal(style(await throughEngine({ classId: "paladin", weapons: ["longsword"], shield: true }, 3)), "Fighting Style (Defense)");
  assert.equal(style(await throughEngine({ classId: "ranger", weapons: ["shortsword", "scimitar"], shield: false }, 3)), "Fighting Style (Two-Weapon Fighting)");
  // One the class hasn't got is dropped (a paladin has no Archery), and a class without styles has none.
  assert.equal(settleBuild({ classId: "paladin", style: "archery" }, 3, content).style, undefined);
  assert.equal(style(await throughEngine({ classId: "paladin", weapons: ["longbow"], shield: false, style: "archery" }, 3)), "Fighting Style (Defense)");
  assert.equal(settleBuild({ classId: "rogue", style: "dueling" }, 3, content).style, undefined);
  // The offline fighter (a longsword and a shield) fights with Defense.
  const offline = (await threeBuilds("Bram", "a broken-nosed ex-soldier of the watch", 3)).options.find(o => o.build.classId === "fighter")!;
  assert.equal(style(offline), "Fighting Style (Defense)");
});

test("a card says the damage the dice roll: Dueling's +2 with one melee weapon and nothing in the other hand, and only then", async () => {
  const fencer = { classId: "fighter", speciesId: "human", backgroundId: "soldier", weapons: ["rapier", "longbow"], armor: "chain-mail", shield: false, abilities: ["DEX", "CON", "STR", "WIS", "CHA", "INT"] };
  const duelling = await throughEngine({ ...fencer, style: "dueling" }, 3, "Lucan");
  const defending = await throughEngine({ ...fencer, style: "defense" }, 3, "Lucan");
  assert.equal(defending.card.attack!.damage, "1d8+3", "Dexterity's +3");
  assert.equal(duelling.card.attack!.damage, "1d8+5", "and Dueling's +2");
  assert.equal(duelling.card.attack!.bonus, defending.card.attack!.bonus, "to damage, not to hit");
  // A shield in the other hand is no weapon: still Dueling.
  assert.equal((await throughEngine({ classId: "paladin", speciesId: "human", backgroundId: "soldier", weapons: ["longsword"], armor: "chain-mail", shield: true, style: "dueling" }, 3)).card.attack!.damage, "1d8+5");
  // The rolls agree: the engine's own damage for the same character.
  const { createSession } = await import("../runtime/engine.ts");
  const { sheetData, sheetText } = await import("./dnd.ts");
  const session = await createSession({ sceneId: "hanged-clerk", approach: "v2", player: "Lucan: a duellist", level: 3, build: duelling.build, seed: 5 });
  assert.equal((await sheetData(session))!.attacks.find(a => a.held)!.damage, "1d8+5");
  assert.match(await sheetText(session), /Rapier \+5 \(1d8\+5 piercing\)/, "the QA console's sheet too");
});
