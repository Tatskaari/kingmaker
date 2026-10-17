// The model's cases of the prototype's src/rules/builds.test.ts:84-143 at 44c6d4a (the model's three made legal, as names not ids, the model failing), with its offline three (:49-66) and the offline fighter's style (:208-210): threeBuilds handed the engine and an ask (null offline); legality read as settleBuild's fixed point, since CASTING and cantripsAt are the engine half's own. pickBuild's cases are v2's.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ask } from "../llm/openrouter.ts";
import { classesFor, settleBuild, type Build, type BuildOption, type Rules } from "../../shared/rules/index.ts";
import { pickBuild, threeBuilds } from "./builds.ts";
import { rulesEngine } from "./load.ts";

/**
 * Character creation's builds, the model's half (ai/rules/builds.ts), with a stand-in for the model:
 * three for a concept, each legal and made by the engine, three different classes whatever the model
 * says; offline, the class defaults the concept's words suggest; the model failing; and the model's
 * one build, a Fighting Style fitted where it gave none.
 */

/** Every way a build could fail to be legal: ids off the SRD's lists, or a build settleBuild would change (a spell off the class's list, too many, armour it can't wear). */
function illegal(rules: Rules, b: Build, level: number): string[] {
  const content = rules.content;
  const out: string[] = [];
  if (!content.classes.has(b.classId)) out.push(`class ${b.classId}`);
  if (!content.species.has(b.speciesId)) out.push(`species ${b.speciesId}`);
  if (!content.backgrounds.has(b.backgroundId)) out.push(`background ${b.backgroundId}`);
  if (b.subclassId && !content.subclasses.has(b.subclassId)) out.push(`subclass ${b.subclassId}`);
  for (const id of [...b.cantrips, ...b.spells]) if (!content.spells.get(id)?.classes.includes(b.classId)) out.push(`spell ${id} isn't a ${b.classId}'s`);
  if (JSON.stringify(settleBuild(b, level, content)) !== JSON.stringify(b)) out.push("settleBuild would change it");
  return out;
}

const CONCEPTS = [
  "a quick-witted half-elf ranger with a longbow, a dry sense of humour and a soft spot for underdogs",
  "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier",
  "a large, gentle hedge-priest who settles arguments by sitting on them",
  "someone",
];

/** A model that answers rules.builds with what it's given. */
const answering = (builds: Record<string, unknown>): Ask => (async <T>(request: { operation: string }) => {
  assert.equal(request.operation, "rules.builds", "one call for all three");
  return builds as T;
}) as Ask;

test("offline (ask null): three builds from the class defaults the concept's words suggest, three different classes, each legal and made by the engine", async () => {
  const rules = await rulesEngine();
  for (const concept of CONCEPTS) {
    const offer = await threeBuilds(rules, "Wren Ashdown", concept, 3, { ask: null });
    assert.equal(offer.note, "The GM is offline: three from the class defaults that best match your words.");
    assert.deepEqual(offer.options.map(o => o.build.classId), classesFor(concept).slice(0, 3), "the classes the words suggest, best first");
    for (const o of offer.options) {
      assert.deepEqual(illegal(rules, o.build, 3), [], `${o.line} is legal`);
      assert.equal(o.from, "defaults");
      assert.ok(o.card.hp > 0 && o.card.ac >= 10, `${o.line}: HP ${o.card.hp}, AC ${o.card.ac}`);
      assert.ok(o.plays.length > 20, "a line on how they'd play");
      assert.match(o.line, new RegExp(`${o.build.classId} 3`), "the engine's own line for it");
      assert.ok(o.card.attack || o.card.casting, "a main attack or spells");
      assert.ok(o.card.subclass, "level 3 has a subclass");
    }
  }
});

test("the model's three, made legal: unknown ids fall back, spells off the class's list go, a class it doubled is made up from the defaults", async () => {
  const rules = await rulesEngine();
  let calls = 0;
  const ask: Ask = async <T>(request: Parameters<Ask>[0]) => {
    calls++;
    return answering({
      first: { classId: "wizard", subclassId: "evoker", speciesId: "gnome", backgroundId: "sage", abilities: ["INT", "DEX"], skills: ["arcana"], feat: "alert", cantrips: ["fire-bolt", "eldritch-blast", "nonsense"], spells: ["magic-missile", "fireball", "cure-wounds"], weapons: ["quarterstaff"], armor: "plate", shield: true, plays: "Reads first, burns later." },
      second: { classId: "wizard", subclassId: "", speciesId: "elf", backgroundId: "sage", abilities: [], skills: [], feat: "", cantrips: [], spells: [], weapons: [], armor: "none", shield: false, plays: "A second wizard." },
      third: { classId: "bard", subclassId: "nope", speciesId: "mermaid", backgroundId: "pirate", abilities: ["CHA"], skills: ["performance"], feat: "made-up", cantrips: ["vicious-mockery"], spells: ["healing-word"], weapons: ["lute"], armor: "leather-armor", shield: false, plays: "" },
    })<T>(request);
  };
  const offer = await threeBuilds(rules, "Pell Marrow", "a hedge-wizard who has read about fire", 3, { ask });

  assert.equal(calls, 1, "one model call");
  assert.equal(offer.note, undefined, "the model's, so no note");
  const classes = offer.options.map(o => o.build.classId);
  assert.equal(new Set(classes).size, 3, `three different classes: ${classes.join(", ")}`);
  assert.deepEqual(classes.slice(0, 2), ["wizard", "bard"], "the model's two different ones, in its order");
  const [wizard, bard, filled] = offer.options as [BuildOption, BuildOption, BuildOption];
  assert.equal(wizard.from, "model");
  assert.equal(filled.from, "defaults");
  for (const o of offer.options) assert.deepEqual(illegal(rules, o.build, 3), [], o.line);
  assert.ok(!wizard.build.cantrips.includes("eldritch-blast") && !wizard.build.spells.includes("cure-wounds") && !wizard.build.spells.includes("fireball"), "another class's spells, and one too high, gone");
  assert.equal(wizard.build.armor, "none", "a wizard can't wear plate");
  assert.equal(wizard.plays, "Reads first, burns later.");
  assert.equal(bard.build.speciesId, "human", "an unknown species falls back");
  assert.equal(bard.build.backgroundId, "criminal", "an unknown background falls back");
  assert.ok(bard.plays.length > 20, "no line from the model: the class's own");
});

test("the model's three written as names, not ids (\"Cleric\", \"Life Domain\", \"Wisdom\"): read as the ids they are", async () => {
  const rules = await rulesEngine();
  const ask = answering({
    first: { classId: "Cleric", subclassId: "Life Domain", speciesId: "Goliath", backgroundId: "Acolyte", abilities: ["Wisdom", "Constitution", "Strength"], skills: ["Insight", "Medicine"], feat: "Magic Initiate (Cleric)", cantrips: ["Guidance", "Spare the Dying", "Thaumaturgy"], spells: ["Cure Wounds", "Healing Word", "Bless"], weapons: ["Mace"], armor: "Chain Shirt", shield: true, style: "none", plays: "Sits on the argument." },
    second: { classId: "Fighter", subclassId: "Champion", speciesId: "Half-Orc", backgroundId: "Soldier", abilities: ["STR"], skills: [], feat: "", cantrips: [], spells: [], weapons: ["Greatsword"], armor: "Chain Mail", shield: false, style: "Great Weapon Fighting", plays: "Hits it." },
    third: { classId: "Ranger", subclassId: "Hunter", speciesId: "Elf", backgroundId: "Sage", abilities: ["DEX"], skills: [], feat: "", cantrips: [], spells: ["Hunter's Mark"], weapons: ["Longbow"], armor: "Studded Leather", shield: false, style: "Fighting Style: Archery", plays: "Shoots it." },
  });
  const offer = await threeBuilds(rules, "Brother Odo", CONCEPTS[2]!, 3, { ask });

  assert.deepEqual(offer.options.map(o => o.from), ["model", "model", "model"], "all three the model's");
  const [cleric, fighter, ranger] = offer.options as [BuildOption, BuildOption, BuildOption];
  assert.deepEqual([cleric.build.classId, cleric.build.subclassId, cleric.build.speciesId, cleric.build.backgroundId, cleric.build.armor], ["cleric", "life-domain", "goliath", "acolyte", "chain-shirt"]);
  assert.deepEqual(cleric.build.abilities.slice(0, 3), ["WIS", "CON", "STR"]);
  assert.ok(cleric.build.spells.includes("cure-wounds") && cleric.build.cantrips.includes("spare-the-dying") && cleric.build.weapons[0] === "mace");
  assert.equal(cleric.build.feat, "magic-initiate-cleric", "a feat by its name");
  assert.equal(fighter.build.style, "great-weapon");
  assert.equal(ranger.build.style, "archery");
  assert.ok(ranger.build.spells.includes("hunters-mark"));
  for (const o of offer.options) assert.deepEqual(illegal(rules, o.build, 3), [], o.line);
});

test("the model failing: the class defaults, and the note says the GM couldn't be reached, and why", async () => {
  const rules = await rulesEngine();
  const ask: Ask = async () => { throw new Error("HTTP 503: the river is up"); };
  const offer = await threeBuilds(rules, "Wren", "a quick-witted ranger", 3, { ask });

  assert.equal(offer.note, "The GM couldn't be reached, so here are three from the class defaults that best match your words (HTTP 503: the river is up).");
  assert.equal(offer.options.length, 3);
  assert.ok(offer.options.every(o => o.from === "defaults"));
});

test("the three are made one at a time, the event loop turning between them: the engine is synchronous, and other games' replies stream meanwhile", async () => {
  const rules = await rulesEngine();
  let turns = 0, made = false;
  const tick = () => { if (made) return; turns++; setImmediate(tick); };
  setImmediate(tick);
  await threeBuilds(rules, "Wren Ashdown", "a dwarf ex-soldier of the river watch", 3, { ask: null });
  made = true;

  assert.ok(turns >= 3, `the loop turned ${turns} times while the three were made`);
});

test("the offline fighter (a longsword and a shield) fights with Defense", async () => {
  const rules = await rulesEngine();
  const offline = (await threeBuilds(rules, "Bram", "a broken-nosed ex-soldier of the watch", 3, { ask: null })).options.find(o => o.build.classId === "fighter")!;

  assert.equal(offline.card.features.find(f => f.startsWith("Fighting Style")), "Fighting Style (Defense)");
});

test("pickBuild: the model's one build for the concept (one call, its name and concept as the prototype's createCharacter asks), made legal, a style fitted to its weapons", async () => {
  const rules = await rulesEngine();
  const asked: Array<Parameters<Ask>[0]> = [];
  const ask: Ask = async <T>(request: Parameters<Ask>[0]) => {
    asked.push(request);
    return { classId: "Fighter", subclassId: "Champion", speciesId: "Goliath", backgroundId: "Soldier", abilities: ["STR", "CON"], skills: ["athletics", "intimidation"], feat: "alert", cantrips: [], spells: [], weapons: ["greatsword"], armor: "chain-mail", shield: false, style: "" } as T;
  };
  const option = await pickBuild(rules, "Brother Odo", CONCEPTS[2]!, 3, { ask });

  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.operation, "rules.build");
  assert.match(asked[0]!.input[0]!.content, /^Character concept: Brother Odo: a large, gentle hedge-priest who settles arguments by sitting on them\n\nClasses: /);
  assert.deepEqual([option.build.classId, option.build.speciesId, option.build.style, option.from], ["fighter", "goliath", "great-weapon", "model"]);
  assert.deepEqual(illegal(rules, option.build, 3), []);
  assert.match(option.line, /^goliath fighter 3 \(Champion\), soldier background$/i);
  assert.ok(option.plays.length > 20, "how a fighter plays");
});

test("pickBuild with no model, or one that fails: settleBuild's own fallbacks, as the prototype's createCharacter makes them with no build", async () => {
  const rules = await rulesEngine();
  const offline = await pickBuild(rules, "Brother Odo", CONCEPTS[2]!, 3, { ask: null });
  const failed = await pickBuild(rules, "Brother Odo", CONCEPTS[2]!, 3, { ask: async () => { throw new Error("HTTP 502"); } });

  assert.deepEqual(offline.build, settleBuild({}, 3, rules.content));
  assert.equal(offline.from, "defaults");
  assert.deepEqual(failed.build, offline.build);
  assert.deepEqual(failed.card, offline.card);
});
