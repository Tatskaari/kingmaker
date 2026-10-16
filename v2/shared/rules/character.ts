// Copied from the prototype's src/rules/dnd.ts at 44c6d4a: lines 110-125 (close, refresh), 140-447 but chooseBuild, 449-560, 562-632, 635-878, 884-909, 1108-1183, 1454, 1459-1512, 1765-1772, 1870-1883, 1951-1992. SessionState is RulesSession, under the same names; each function takes the Rules its host loaded, and none awaits; createCharacter requires a build (its model half is the AI service's, ai/rules/builds.ts); sheetText reads the sheet's data, not the engine; pocketsOf takes the campaign's starting purse, and sheetData leaves it to it; sheetData takes no fight's campaign (V12); sheetRows is v2's; close takes the Rules, and keeps the campaign in the isolate's cache when it's as loaded (engine.ts Ctx.asLoaded); withTopSpell's .at(-1) made ES2021. The engine plumbing (open, the loader, event) is engine.ts's.
import type * as Dnd from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { rng, rollCheck, type RollResult } from "../dice.ts";
import { SKILLS, type Skill } from "../scene/types.ts";
import type { Entity } from "../world/scene-world.ts";
import { ABILITIES, ABILITY_NAME, changing, engineSkill, event, keep, loadWellFormed, opened, ordinal, reading, signed, SKILL_ABILITY, type Ctx } from "./engine.ts";
import { spellDetails, type Caster, type Extras, type Names } from "./spells.ts";
import type { Build, FeatureRef, GearRow, Pockets, Rules, RulesSession, SheetData, SheetRows, SlotRow, SpellRef, Uses, WeaponRef } from "./types.ts";

/**
 * D&D 5.5e mechanics (SRD 5.2.1) for the player's character, from the vendored dnd-srd-engine its
 * host hands over (v1-design §3.6): making the character from a build, its sheet (as the row the
 * game keeps, as data for the screen, and as the QA console's text), a check through the engine,
 * coming to at an opening, and the gear the story parts them from. The GM still adjudicates the
 * story (whether something needs dice at all, how hard it is, what it means); the engine decides
 * what the rules and the dice decide, and the GM narrates exactly that.
 *
 * Every function is synchronous and works on a RulesSession: the simulation builds one from the
 * rows and writes back what changed (rollCount, rules, the player's modifiers and build line), the
 * AI service makes a scratch one to see what a build comes to. The simulation runs each call pinned
 * (pin.ts withEngine), so the ids and times it writes are a pure function of the rows.
 */


// ---------------------------------------------------------------------------------------------
// Character creation: the concept picks the build, the engine makes it legal.

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const WEAPONS = ["club", "dagger", "greatclub", "handaxe", "javelin", "light-hammer", "mace", "quarterstaff", "sickle", "spear", "dart", "shortbow", "sling", "crossbow-light",
  "battleaxe", "flail", "glaive", "greataxe", "greatsword", "halberd", "lance", "longsword", "maul", "morningstar", "pike", "rapier", "scimitar", "shortsword", "trident",
  "war-pick", "warhammer", "whip", "blowgun", "crossbow-hand", "crossbow-heavy", "longbow"];
const ARMOR: Record<string, string[]> = {
  light: ["padded-armor", "leather-armor", "studded-leather"],
  medium: ["hide-armor", "chain-shirt", "scale-mail", "breastplate", "half-plate"],
  heavy: ["ring-mail", "chain-mail", "splint", "plate"],
};
/** Spellcasting at the levels we start at (2024 rules): cantrips, prepared spells, highest spell level by character level. */
export const CASTING: Record<string, { cantrips: number; prepared: (level: number) => number; maxSpell: (level: number) => number }> = {
  bard: { cantrips: 2, prepared: l => l + 3, maxSpell: l => Math.min(9, Math.ceil(l / 2)) },
  cleric: { cantrips: 3, prepared: l => l + 3, maxSpell: l => Math.min(9, Math.ceil(l / 2)) },
  druid: { cantrips: 2, prepared: l => l + 3, maxSpell: l => Math.min(9, Math.ceil(l / 2)) },
  sorcerer: { cantrips: 4, prepared: l => l + 3, maxSpell: l => Math.min(9, Math.ceil(l / 2)) },
  wizard: { cantrips: 3, prepared: l => l + 3, maxSpell: l => Math.min(9, Math.ceil(l / 2)) },
  warlock: { cantrips: 2, prepared: l => l + 1, maxSpell: l => Math.min(5, Math.ceil(l / 2)) },
  paladin: { cantrips: 0, prepared: l => l + 1, maxSpell: l => (l < 5 ? 1 : Math.min(5, Math.ceil(l / 4))) },
  ranger: { cantrips: 0, prepared: l => l + 1, maxSpell: l => (l < 5 ? 1 : Math.min(5, Math.ceil(l / 4))) },
};

/** The class's cantrips at a level (2024 rules): the count above, one more from 4th level and another from 10th. */
export function cantripsAt(classId: string, level: number): number {
  const base = CASTING[classId]?.cantrips ?? 0;
  return base ? base + (level >= 4 ? 1 : 0) + (level >= 10 ? 1 : 0) : 0;
}

/** The school a subclass is about (an evoker's evocations), when it's one. */
const SUBCLASS_SCHOOL: Record<string, string> = { evoker: "evocation" };

/**
 * Spells to add to a caster's (`count` of them, at the levels given): the ones asked for first, in
 * order; then the highest level first, in the subclass's school (or the one the spells they have
 * mostly are), in the SRD's own order (its staples first: Fireball, then Counterspell).
 */
function moreSpells(content: Dnd.Content, classId: string, have: string[], wanted: string[], levels: (l: number) => boolean, count: number, subclass = ""): string[] {
  const onList = (id: string) => { const sp = content.spells.get(id); return !!sp && sp.classes.includes(classId) && levels(sp.level); };
  const chosen = [...new Set(wanted.filter(id => onList(id) && !have.includes(id)))].slice(0, count);
  const schools = have.map(id => content.spells.get(id)?.school).filter((x): x is string => !!x);
  const most = (x: string) => schools.filter(y => y === x).length;
  const school = SUBCLASS_SCHOOL[subclass] ?? [...schools].sort((a, b) => most(b) - most(a))[0];
  const order = [...content.spells.keys()];
  const rest = [...content.spells.values()].filter(sp => onList(sp.id) && !have.includes(sp.id) && !chosen.includes(sp.id))
    .sort((a, b) => b.level - a.level || Number(b.school === school) - Number(a.school === school) || order.indexOf(a.id) - order.indexOf(b.id));
  return [...chosen, ...rest.map(sp => sp.id)].slice(0, count);
}

/**
 * A caster's spells with one at the highest level they can cast, when that's above 1st (a level 3
 * wizard's 2nd-level slots): the last ritual among them makes way for it (the least missed), or else
 * the last of them.
 */
function withTopSpell(content: Dnd.Content, classId: string, subclass: string, spells: string[], wanted: string[], top: number): string[] {
  if (top < 2 || !spells.length || spells.some(id => content.spells.get(id)?.level === top)) return spells;
  const [add] = moreSpells(content, classId, spells, wanted, l => l === top, 1, subclass);
  if (!add) return spells;
  const rituals = spells.filter(id => content.spells.get(id)?.ritual);
  const out = rituals.length ? rituals[rituals.length - 1]! : spells[spells.length - 1]!;
  return [...spells.filter(id => id !== out), add];
}
const KITS: Record<string, { weapons: string[]; armor: string; shield: boolean }> = {
  barbarian: { weapons: ["greataxe", "handaxe"], armor: "none", shield: false },
  bard: { weapons: ["rapier", "dagger"], armor: "leather-armor", shield: false },
  cleric: { weapons: ["mace"], armor: "chain-shirt", shield: true },
  druid: { weapons: ["quarterstaff", "sickle"], armor: "leather-armor", shield: false },
  fighter: { weapons: ["longsword", "longbow"], armor: "chain-mail", shield: true },
  monk: { weapons: ["quarterstaff", "dart"], armor: "none", shield: false },
  paladin: { weapons: ["longsword", "javelin"], armor: "chain-mail", shield: true },
  ranger: { weapons: ["shortsword", "longbow"], armor: "studded-leather", shield: false },
  rogue: { weapons: ["rapier", "shortbow", "dagger"], armor: "leather-armor", shield: false },
  sorcerer: { weapons: ["dagger", "quarterstaff"], armor: "none", shield: false },
  warlock: { weapons: ["dagger", "quarterstaff"], armor: "leather-armor", shield: false },
  wizard: { weapons: ["quarterstaff", "dagger"], armor: "none", shield: false },
};

/** The Fighting Styles a class chooses from (its option ids, from the class's own table), none for most. */
export function styleOptions(classId: string, content: Dnd.Content): string[] {
  const table = content.classes.get(classId)?.["levelTable"] as Record<string, { features?: Array<{ effects?: Array<Record<string, unknown>> }> }> | undefined;
  const offers = Object.values(table ?? {}).flatMap(row => row.features ?? []).flatMap(f => f.effects ?? [])
    .filter(e => e["kind"] === "OfferChoice" && String(e["choiceId"]).startsWith("fighting-style"));
  return offers.flatMap(e => ((e["options"] as Array<{ id: string }> | undefined) ?? []).map(o => o.id));
}

/**
 * The Fighting Style that fits how a build fights, where its class has one: a bow's Archery, a
 * two-handed weapon's Great Weapon Fighting, two light blades' Two-Weapon Fighting, a shield's
 * Defense, one blade alone's Dueling (what the class offers: a paladin has no Archery).
 */
export function styleFor(build: Build, content: Dnd.Content): string | undefined {
  const options = styleOptions(build.classId, content);
  if (!options.length) return undefined;
  const item = (id: string | undefined) => content.items.get(id ?? "") as Record<string, unknown> | undefined;
  const props = (id: string | undefined) => (item(id)?.["properties"] as string[] | undefined) ?? [];
  const main = build.weapons[0];
  const lightPair = props(main).includes("light") && build.weapons.slice(1).some(w => item(w)?.["attackKind"] === "melee" && props(w).includes("light"));
  const wanted = item(main)?.["attackKind"] === "ranged" ? "archery"
    : props(main).includes("two-handed") ? "great-weapon"
    : build.shield ? "defense"
    : lightPair ? "two-weapon"
    : "dueling";
  return options.includes(wanted) ? wanted : options.includes("defense") ? "defense" : options[0];
}

/**
 * What a model choosing a build may choose from, for a level: the SRD's classes, subclasses, species,
 * backgrounds, origin feats, skills, weapons, armour and spells (by id, a spell with its level and
 * classes). One build (the AI service's pickBuild) or three (its threeBuilds) are asked for with it.
 */
export function buildMenu(level: number, content: Dnd.Content): string {
  const list = (m: Map<string, Dnd.Named>) => [...m.values()].map(v => `${v.id} (${v.name})`).join(", ");
  const maxSpell = Math.min(9, Math.ceil(level / 2));
  const spells = [...content.spells.values()].filter(s => s.level <= maxSpell).sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))
    .map(s => `${s.id} [${s.level ? `level ${s.level}` : "cantrip"}; ${s.classes.join(" ")}]`).join("\n");
  const feats = [...content.feats.values()].filter(f => f["category"] === "origin").map(f => f.id).join(", ");
  return [
    `Classes: ${list(content.classes)}`, `Subclasses: ${list(content.subclasses)}`, `Species: ${list(content.species)}`, `Backgrounds: ${list(content.backgrounds)}`,
    `Origin feats: ${feats}`, `Skills: ${SKILLS.map(engineSkill).join(", ")}`, `Abilities: ${ABILITIES.join(", ")}`,
    `Weapons: ${WEAPONS.join(", ")}`, `Armour: none, ${Object.values(ARMOR).flat().join(", ")}`, `Spells (id [level; classes]):\n${spells}`,
  ].join("\n\n");
}

/** A build's fields as a JSON schema's properties (the model's answer, before settleBuild makes it legal). */
export const BUILD_FIELDS = ["classId", "subclassId", "speciesId", "backgroundId", "abilities", "skills", "feat", "cantrips", "spells", "weapons", "armor", "shield", "style"] as const;
export const BUILD_SCHEMA: Record<string, unknown> = {
  classId: { type: "string" }, subclassId: { type: "string" }, speciesId: { type: "string" }, backgroundId: { type: "string" },
  abilities: { type: "array", items: { type: "string" }, description: "All six abilities, most important first" },
  skills: { type: "array", items: { type: "string" }, description: "Skills they'd be trained in, most characteristic first (up to 6)" },
  feat: { type: "string", description: "One origin feat" },
  cantrips: { type: "array", items: { type: "string" } }, spells: { type: "array", items: { type: "string" } },
  weapons: { type: "array", items: { type: "string" }, description: "One to three weapons, main weapon first" },
  armor: { type: "string" }, shield: { type: "boolean" },
  style: { type: "string", description: "A fighter's, paladin's or ranger's Fighting Style, to fit how they fight: archery, defense, dueling, great-weapon, protection or two-weapon (a paladin has no archery or two-weapon, a ranger no great-weapon or protection). Anyone else: none" },
};

/** How a build is chosen for a concept: what fits who they are, not what's strongest, from the lists' ids. */
export const BUILD_GUIDE = `Choose what fits who they are and how they'd go about things, not what's strongest: a palace inspector might be a rogue (Investigation, Insight), a hedge witch a druid, a brawling ex-soldier a fighter, a silver-tongued con artist a bard. Use only ids from the lists. Spells must be on the class's list (ids marked with the class): give cantrips and levelled spells that suit the concept, including some useful outside a fight. Weapons and armour are what they'd carry; armour "none" if they wouldn't wear any.`;



/** An id as the SRD's lists have it, however a model wrote it ("Cleric", "Life Domain", "hunter's mark"). */
export const srdId = (s: string): string => s.trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A legal build from whatever the model suggested: ids as the lists have them, and unknown ones fall back to the class's defaults. */
export function settleBuild(raw: Partial<Build>, level: number, content: Dnd.Content): Build {
  /** The id, as the list has it, if it's on the list. */
  const known = (list: { has(id: string): boolean }, s: unknown): string | undefined => { const id = typeof s === "string" ? srdId(s) : ""; return id && list.has(id) ? id : undefined; };
  const ids = (list: unknown): string[] => (Array.isArray(list) ? list.filter((s): s is string => typeof s === "string").map(srdId) : []);
  const classId = known(content.classes, raw.classId) ?? "rogue";
  const cls = content.classes.get(classId)!;
  const kit = KITS[classId] ?? KITS.rogue!;
  const casting = CASTING[classId];
  const weapons = ids(raw.weapons).filter(w => WEAPONS.includes(w));
  const armor = typeof raw.armor === "string" ? srdId(raw.armor) : undefined;
  // "Great Weapon Fighting" and "Fighting Style: Defense" are the choice's "great-weapon" and "defense".
  const style = typeof raw.style === "string" ? srdId(raw.style).replace(/^fighting-style\W*/, "").replace(/-fighting$/, "") : undefined;
  const onList = (id: string, levels: (l: number) => boolean) => { const s = content.spells.get(id); return !!s && s.classes.includes(classId) && levels(s.level); };
  const pickSpells = (wanted: string[] | undefined, levels: (l: number) => boolean, count: number) => {
    const chosen = [...new Set(ids(wanted).filter(id => onList(id, levels)))].slice(0, count);
    for (const s of [...content.spells.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (chosen.length >= count) break;
      if (onList(s.id, levels) && !chosen.includes(s.id)) chosen.push(s.id);
    }
    return chosen;
  };
  const armorProf = (cls["armorProficiencies"] as string[] | undefined) ?? [];
  const armorOk = (id: string) => Object.entries(ARMOR).some(([kind, ids]) => ids.includes(id) && armorProf.some(p => p.toLowerCase().includes(kind)));
  // "WIS" or "Wisdom": the first three letters are the ability's.
  const abilities = [...new Set([...ids(raw.abilities).map(a => a.toUpperCase().slice(0, 3)).filter(a => ABILITIES.includes(a as Dnd.Ability)), ...ABILITIES])];
  return {
    classId,
    subclassId: known(content.subclasses, raw.subclassId) ?? "",
    speciesId: known(content.species, raw.speciesId) ?? "human",
    backgroundId: known(content.backgrounds, raw.backgroundId) ?? "criminal",
    abilities,
    skills: ids(raw.skills),
    feat: known(content.feats, raw.feat) ?? "alert",
    cantrips: casting ? pickSpells(raw.cantrips, l => l === 0, cantripsAt(classId, level)) : [],
    spells: casting ? withTopSpell(content, classId, srdId(String(raw.subclassId ?? "")), pickSpells(raw.spells, l => l >= 1 && l <= casting.maxSpell(level), casting.prepared(level)), ids(raw.spells), casting.maxSpell(level)) : [],
    weapons: weapons.length ? [...new Set(weapons)].slice(0, 3) : kit.weapons,
    armor: armor && armor !== "none" && armorOk(armor) ? armor : armor === "none" ? "none" : kit.armor,
    shield: (raw.shield ?? kit.shield) && armorProf.some(p => p.toLowerCase().includes("shield")),
    ...(style && styleOptions(classId, content).includes(style) ? { style } : {}),
  };
}

/** Resolve the engine's pending choices for a character, preferring (in order) what the build asked for. */
function resolveChoices(ctx: Ctx, characterId: string, prefer: string[]): string[] {
  const rank = (o: Dnd.ChoiceOption) => {
    const i = Math.min(...[o.id, o.label].map(k => prefer.indexOf(k.toLowerCase())).map(i => (i < 0 ? Infinity : i)));
    return i;
  };
  const picked: string[] = [];
  for (let guard = 0; guard < 40; guard++) {
    const open = Object.values(ctx.campaign.state.pendingChoices).filter(c => c.forCharacterId === characterId && c.resolution === undefined);
    const choice = open[0];
    if (!choice) break;
    const n = Math.max(1, Math.min(choice.oneOf ?? 1, choice.options.length));
    const ranked = choice.options.map((o, i) => ({ o, r: rank(o), i })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.o);
    const selected = ranked.slice(0, n);
    try {
      ctx.apply(ctx.engine.plan.resolveChoice(ctx.campaign.state, { characterId, choiceId: choice.id, selectedOptionIds: selected.map(o => o.id) }).events);
      picked.push(...selected.map(o => o.label));
    } catch {
      // A choice the engine won't take as ranked: fall back to its own first options.
      ctx.apply(ctx.engine.plan.resolveChoice(ctx.campaign.state, { characterId, choiceId: choice.id, selectedOptionIds: choice.options.slice(0, n).map(o => o.id) }).events);
      picked.push(...choice.options.slice(0, n).map(o => o.label));
    }
  }
  return picked;
}

/** The class's own skill picks (the engine leaves these to the app): offered as a choice, then resolved with the rest. */
function offerClassSkills(ctx: Ctx, characterId: string, classId: string, backgroundId: string): void {
  const cls = ctx.engine.content.classes.get(classId);
  const choices = cls?.["skillChoices"] as { choices: number; from: string[] } | undefined;
  const background = ctx.engine.content.backgrounds.get(backgroundId)?.["skillProficiencies"] as string[] | undefined ?? [];
  const from = (choices?.from ?? []).filter(k => !background.includes(k));
  if (!choices || !from.length) return;
  ctx.apply([event(ctx.E, "ChoiceRequired", {
    choiceId: ctx.E.newEventId(), characterId, promptKey: `${classId}-skills`, prompt: `Choose ${choices.choices} ${cls!.name} skills.`,
    oneOf: Math.min(choices.choices, from.length),
    options: from.map(k => ({ id: k, label: titleSkill(k), effects: [{ kind: "GrantProficiency", target: "skill", id: k, level: "proficient" }] })),
  })]);
}

/**
 * Make the player's D&D character from a build (the engine: level 1, its choices, levelled up to
 * `level`, kit equipped; hit points are the average, so no die is drawn). The build is settled as
 * the prototype settles a given one: a chosen build's Fighting Style was fitted when it was chosen
 * (the AI service's pickBuild, builds.ts throughEngine). Sets state.rules, and the skill modifiers
 * and build line on state.player.
 */
export function createCharacter(rules: Rules, state: RulesSession, level: number, given: Build): string {
  const { E } = rules;
  const engine = rules.engine(state.seed);
  const content = engine.content;
  const build = settleBuild(given, level, content);
  const cls = content.classes.get(build.classId)!;
  const scores = Object.fromEntries(ABILITIES.map(a => [a, STANDARD_ARRAY[build.abilities.indexOf(a)] ?? 10])) as Record<Dnd.Ability, number>;
  // Background ability increases (2024): +2 and +1 among the background's three, to the ones that matter most.
  const bgOptions = (content.backgrounds.get(build.backgroundId)?.["abilityScoreIncreases"] as { options?: string[] } | undefined)?.options ?? ABILITIES;
  const [plusTwo, plusOne] = build.abilities.filter(a => bgOptions.includes(a));
  if (plusTwo) scores[plusTwo as Dnd.Ability] += 2;
  if (plusOne) scores[plusOne as Dnd.Ability] += 1;
  const conMod = Math.floor((scores.CON - 10) / 2);
  const hitDie = Number(cls.hitDie ?? 8);
  const pc = E.CharacterSchema.parse({
    id: E.newCharacterId(), name: state.player.name, speciesId: build.speciesId, backgroundId: build.backgroundId,
    classes: [{ classId: build.classId, level: 1, hitDiceRemaining: 1 }], abilityScores: scores,
    hp: { current: hitDie + conMod, max: hitDie + conMod, temp: 0 },
    knownSpells: [...build.cantrips, ...build.spells], preparedSpells: build.spells,
  });
  const ctx = changing(E, engine, engine.createCampaign({ name: state.id }), false);
  ctx.apply([event(E, "CharacterCreated", { snapshot: pc })]);
  const item = (definitionId: string) => ({ id: E.newItemInstanceId(), definitionId, quantity: 1, attuned: false, identifiedByCharacterIds: [] });
  const gear = [...build.weapons, "unarmed-strike", ...(build.armor !== "none" ? [build.armor] : []), ...(build.shield ? ["shield"] : [])].filter(id => content.items.has(id)).map(item);
  ctx.apply(gear.map(instance => event(E, "ItemAcquired", { instance, characterId: pc.id })));
  const equip = (instanceId: string, slot: "mainHand" | "armor" | "shield") => {
    try { ctx.apply(engine.plan.equip(ctx.campaign.state, { characterId: pc.id, instanceId, slot }).events); } catch { /* the engine says no (two hands, no proficiency): carried, not worn */ }
  };
  const main = gear.find(g => g.definitionId === build.weapons[0]);
  if (main) equip(main.id, "mainHand");
  const armor = gear.find(g => g.definitionId === build.armor);
  if (armor) equip(armor.id, "armor");
  const shield = gear.find(g => g.definitionId === "shield");
  if (shield) equip(shield.id, "shield");
  // Preferences in order: what the build asked for, then its abilities for any score increases.
  const prefer = [...build.skills, build.feat, build.subclassId, ...(build.style ? [build.style] : []), ...build.cantrips, ...build.spells, "medium", "ability-score-improvement",
    ...build.abilities.flatMap(a => [a.toLowerCase(), ABILITY_NAME[a as Dnd.Ability].toLowerCase()])].filter(Boolean).map(k => k.toLowerCase());
  offerClassSkills(ctx, pc.id, build.classId, build.backgroundId);
  ctx.apply(engine.plan.offerCharacterChoices(ctx.campaign.state, { characterId: pc.id }).events);
  resolveChoices(ctx, pc.id, prefer);
  for (let l = 2; l <= level; l++) {
    try {
      ctx.apply(engine.plan.levelUp(ctx.campaign.state, { characterId: pc.id, classId: build.classId, hpStrategy: "average" }).events);
      resolveChoices(ctx, pc.id, prefer);
    } catch { break; }
  }
  grantResources(ctx, pc.id);
  state.rules = { campaign: "", pc: pc.id, npcs: {}, prefer };
  refresh(ctx, state);
  close(rules, state, ctx);
  const sheet = sheetOf(ctx, pc.id);
  return `${state.player.name}: ${state.player.build}. AC ${sheet.ac.total}, HP ${sheet.hp.current}/${sheet.effectiveHpMax}.`;
}

type Formula = number | { kind: string; value?: number; classId?: string; ability?: Dnd.Ability; term?: Formula; terms?: Formula[] };
type Resource = { resourceId: string; current: number; max: number; recharge?: string };

function formula(f: Formula, levels: Record<string, number>, scores: Record<Dnd.Ability, number>): number {
  if (typeof f === "number") return f;
  const terms = (f.terms ?? []).map(t => formula(t, levels, scores));
  switch (f.kind) {
    case "const": return f.value ?? 0;
    case "level": return f.classId ? levels[f.classId] ?? 0 : Object.values(levels).reduce((a, b) => a + b, 0);
    case "abilityMod": return Math.floor(((f.ability ? scores[f.ability] : 10) - 10) / 2);
    case "multiply": return terms.reduce((a, b) => a * b, 1);
    case "add": case "sum": return terms.reduce((a, b) => a + b, 0);
    case "max": return Math.max(...terms);
    case "min": return Math.min(...terms);
    case "ceil": return Math.ceil(formula(f.term ?? 0, levels, scores));
    case "floor": return Math.floor(formula(f.term ?? 0, levels, scores));
    default: return 0;
  }
}

/**
 * Class resources (Second Wind's uses, Rage, Bardic Inspiration...): the engine reads them off the
 * character as created and has no event that grants one, so they go into the character's creation
 * snapshot, worked out from the class and subclass tables at the levels they have now (on creation
 * and on every level-up). What was spent since still counts.
 */
function grantResources(ctx: Ctx, pcId: string): void {
  const c = ctx.campaign.state.characters[pcId]!;
  const content = ctx.engine.content as unknown as { classes: Map<string, { levelTable?: Record<string, { features?: Array<{ effects?: Array<Record<string, unknown>> }> }> }>; subclasses: Map<string, { levelTable?: Record<string, { features?: Array<{ effects?: Array<Record<string, unknown>> }> }> }> };
  const levels = Object.fromEntries(c.classes.map(k => [k.classId, k.level]));
  const granted = new Map<string, Resource>();
  const walk = (table: Record<string, { features?: Array<{ effects?: Array<Record<string, unknown>> }> }> | undefined, upTo: number) => {
    for (const [lvl, row] of Object.entries(table ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      if (Number(lvl) > upTo) continue;
      for (const e of (row.features ?? []).flatMap(f => f.effects ?? [])) {
        if (e["kind"] !== "GrantResource") continue;
        const max = Math.max(0, formula(e["max"] as Formula, levels, sheetOf(ctx, pcId).abilityScores));
        granted.set(String(e["resourceId"]), { resourceId: String(e["resourceId"]), current: max, max, ...(e["recharge"] ? { recharge: String(e["recharge"]) } : {}) });
      }
    }
  };
  for (const k of c.classes) {
    walk(content.classes.get(k.classId)?.levelTable, k.level);
    if (k.subclassId) walk(content.subclasses.get(k.subclassId)?.levelTable, k.level);
  }
  const have = (c as unknown as { resources?: Resource[] }).resources ?? [];
  const want = [...granted.values()];
  if (want.every(r => have.some(h => h.resourceId === r.resourceId && h.max === r.max)) && have.length === want.length) return;
  const raw = JSON.parse(ctx.E.serializeCampaign(ctx.campaign)) as { events: Array<Record<string, unknown>> };
  const created = raw.events.find(e => e["type"] === "CharacterCreated" && (e["snapshot"] as { id?: string } | undefined)?.id === pcId);
  if (!created) return;
  (created["snapshot"] as { resources?: Resource[] }).resources = want;
  ctx.campaign = loadWellFormed(ctx.E, JSON.stringify(raw), ctx.engine);
  // Loaded, and nothing committed since: the campaign close writes can be kept, so the sheet's load is skipped.
  ctx.asLoaded = true;
}

/**
 * What the dice add to a weapon attack's damage that the engine's sheet leaves out: its effect
 * stack's damage modifiers, asked as its attack planner asks them (Dueling's +2 with a melee weapon
 * and no weapon in the other hand, a magic bow's), so the sheet and a build's card say what lands.
 */
function damageAdded(ctx: Ctx, c: Dnd.EngineCharacter, s: Dnd.CharacterSheet): (a: { attackKind: string; weaponInstanceId?: string; instanceId?: string; properties?: string[]; damage: { type: string } }) => number {
  const campaign = ctx.campaign.state, content = ctx.engine.content;
  const stack = ctx.E.buildEffectStack({ character: c, content, itemInstances: campaign.itemInstances, pendingChoices: campaign.pendingChoices, characters: campaign.characters });
  const offHand = c.equipped.offHand ? content.items.get(campaign.itemInstances[c.equipped.offHand]?.definitionId ?? "") as { itemKind?: string } | undefined : undefined;
  return a => {
    const instance = a.weaponInstanceId ?? a.instanceId;
    const props = a.properties ?? [];
    // The ability its damage is with, as the engine picks it: Dexterity for a bow, or for a finesse weapon when it's the better.
    const ability = (a.attackKind === "ranged" && !props.includes("thrown")) || (props.includes("finesse") && s.abilityModifiers.DEX >= s.abilityModifiers.STR) ? "DEX" : "STR";
    return stack.modifierSum("damage", new Map<string, unknown>([["event.attackKind", a.attackKind], ["bearer.offHandHasWeapon", offHand?.itemKind === "weapon"],
      ["event.damageType", a.damage.type], ["event.weaponId", instance ? campaign.itemInstances[instance]?.definitionId ?? "" : ""], ["event.damageAbility", ability]]));
  };
}

function sheetOf(ctx: Ctx, id: string): Dnd.CharacterSheet {
  const s = ctx.campaign.state;
  return ctx.E.buildCharacterSheet({ character: s.characters[id]!, itemInstances: s.itemInstances, content: ctx.engine.content, characters: s.characters, pendingChoices: s.pendingChoices });
}

function modifiersFrom(sheet: Dnd.CharacterSheet): Partial<Record<Skill, number>> {
  return Object.fromEntries(SKILLS.map(skill => [skill, sheet.skills.find(s => s.skill === engineSkill(skill))?.modifier ?? 0]));
}

function buildLine(ctx: Ctx, id: string): string {
  const c = ctx.campaign.state.characters[id]!;
  const content = ctx.engine.content;
  const classes = c.classes.map(k => `${content.classes.get(k.classId)?.name.toLowerCase() ?? k.classId} ${k.level}${k.subclassId ? ` (${content.subclasses.get(k.subclassId)?.name ?? k.subclassId})` : ""}`).join(" / ");
  return `${(content.species.get(c.speciesId)?.name ?? c.speciesId).toLowerCase()} ${classes}, ${(content.backgrounds.get(c.backgroundId)?.name ?? c.backgroundId).toLowerCase()} background`;
}

// ---------------------------------------------------------------------------------------------
// The sheet.

function slotsLine(sheet: Dnd.CharacterSheet, c: Dnd.EngineCharacter): string {
  return sheet.spellSlots.slotsByLevel.map((max, i) => max ? `${ordinal(i + 1)} ${max - (c.spellSlotsUsed[String(i + 1)] ?? 0)}/${max}` : "").filter(Boolean).join(", ");
}

function status(ctx: Ctx, id: string): string {
  const c = ctx.campaign.state.characters[id]!;
  const sheet = sheetOf(ctx, id);
  const slots = slotsLine(sheet, c);
  const conditions = c.appliedConditions.map(a => a.conditionId).filter(id => !id.endsWith("-active"));
  return [`HP ${Math.max(0, c.hp.current)}/${sheet.effectiveHpMax}${c.hp.temp ? ` (+${c.hp.temp} temp)` : ""}`, slots ? `spell slots ${slots}` : "", ...conditions].filter(Boolean).join(", ");
}

/**
 * The sheet row's columns the engine makes (v1-design §3.6), from the session's character as it is
 * now: the GM's numbers, the status line, what they can do in a scene, and the whole sheet as data
 * for the screen. The purse and pockets are pocketsOf's, kept apart: they change with the world,
 * without the engine.
 */
export function sheetRows(rules: Rules, state: RulesSession): SheetRows {
  const ctx = reading(rules, state);
  const id = state.rules!.pc;
  const c = ctx.campaign.state.characters[id]!;
  const sheet = sheetOf(ctx, id);
  const { purse: _purse, carrying: _carrying, ...data } = sheetData(rules, state)!;
  return {
    build: buildLine(ctx, id),
    skills: JSON.stringify(modifiersFrom(sheet)),
    statusLine: status(ctx, id),
    level: sheet.totalLevel,
    hp: Math.max(0, c.hp.current),
    maxHp: sheet.effectiveHpMax,
    ac: sheet.ac.total,
    slots: slotsOf(sheet, c),
    // As the status line names them: the engine's ids, its own markers ("raging-active") left out.
    conditions: c.appliedConditions.map(a => a.conditionId).filter(id => !id.endsWith("-active")),
    spells: readySpells(sheet),
    weapons: weaponsOf(ctx, id).filter(w => !state.rules!.gone?.includes(w.id)),
    features: featuresOf(ctx, id),
    data: JSON.stringify(data),
    backstory: storyOf(state).story ? JSON.stringify(state.player.backstory) : undefined,
  };
}

/** Each spell slot level they have: how many, and how many spent (a warlock's pact slots are the sheet's data's). */
function slotsOf(sheet: Dnd.CharacterSheet, c: Dnd.EngineCharacter): SlotRow[] {
  return sheet.spellSlots.slotsByLevel.map((max, i) => ({ level: i + 1, max, used: c.spellSlotsUsed[String(i + 1)] ?? 0 })).filter(s => s.max > 0);
}

/**
 * The sheet as the QA console prints it (the prototype's sheetText, a line each), from its data with
 * the pockets laid over it: what the screen shows, so no engine. Where the prototype read the engine
 * for a line, the data's words stand: the feats are the sheet's (the background's too), and the
 * languages are named as the sheet names them ("Thieves' Cant", where the prototype printed
 * "Thieves-cant"). sheet.test.ts pins both against the prototype's.
 */
export function sheetText(s: SheetData): string {
  const lines = [
    `${s.name}: ${lineOf(s)}`,
    `AC ${s.ac} · HP ${s.hp.current}/${s.hp.max}${s.hp.temp ? ` (+${s.hp.temp} temp)` : ""} · Speed ${s.speeds["walk"] ?? 30} ft · Initiative ${signed(s.initiative)} · Proficiency ${signed(s.proficiency)} · Hit Dice ${s.hitDice.map(h => `${h.left}/${h.total} d${h.die}`).join(", ")}`,
    s.abilities.map(a => `${a.id} ${a.score} (${signed(a.modifier)})`).join("  "),
    `Saving throws: ${s.abilities.map(a => `${a.id} ${signed(a.save)}`).join(", ")}`,
    `Skills: ${s.skills.filter(k => k.proficiency !== "none").map(k => `${k.name} ${signed(k.modifier)}${k.proficiency === "expertise" ? " (expertise)" : ""}`).join(", ") || "none trained"}`,
    `Other skills: ${s.skills.filter(k => k.proficiency === "none").map(k => `${k.name} ${signed(k.modifier)}`).join(", ")}`,
    `Passive: ${Object.entries(s.passive).map(([k, v]) => `${titleSkill(k)} ${v}`).join(", ")}`,
    `Attacks: ${s.attacks.map(a => `${a.name} ${signed(a.bonus)} (${a.damage} ${a.type})`).join("; ")}`,
  ];
  const sc = s.spellcasting;
  if (sc) {
    lines.push(`Spellcasting (${sc.className}, ${ABILITY_NAME[sc.ability]}): save DC ${sc.saveDC}, spell attack ${signed(sc.attackBonus)}; slots ${sc.slots.map(x => `${ordinal(x.level)} ${x.max - x.used}/${x.max}`).join(", ") || "none"}`);
    for (const group of sc.spells) {
      const ready = group.spells.filter(sp => sp.ready);
      if (ready.length) lines.push(`  ${group.level ? `${ordinal(group.level)} level` : "Cantrips"}: ${ready.map(sp => sp.name).join(", ")}`);
    }
  }
  if (s.feats.length) lines.push(`Feats: ${s.feats.join(", ")}`);
  lines.push(`Conditions: ${s.conditions.join(", ") || "none"}${s.inspiration ? " · Heroic Inspiration" : ""}`);
  // The prototype said "worn" for anything equipped but the weapon in hand.
  lines.push(`Equipment: ${s.equipment.map(i => `${i.name}${i.slot ? ` (${i.slot === "in hand" ? "in hand" : "worn"})` : ""}`).join(", ") || "nothing"}`);
  lines.push(`Purse: ${s.purse.map(p => countOfCoins(p.name, p.quantity)).join(", ") || "empty"}`);
  if (s.carrying.length) lines.push(`Carrying: ${s.carrying.map(c => `${c.quantity > 1 ? `${c.quantity} ` : ""}${c.name}${c.in ? ` (in ${c.in})` : ""}`).join(", ")}`);
  lines.push(`Languages: ${s.languages.join(", ")}`);
  const story = s.story;
  if (story) {
    const traits = ([["Personality", story.personality], ["Ideals", story.ideals], ["Bonds", story.bonds], ["Flaws", story.flaws]] as const).filter(([, v]) => v.length);
    lines.push(...traits.map(([k, v]) => `${k}: ${v.join("; ")}`), `Backstory:\n${story.backstory.split(/\n+/).map(p => `  ${p.trim()}`).filter(p => p.trim()).join("\n")}`);
  }
  return lines.join("\n");
}

/** The build in a line, from the sheet's names, as buildLine writes it from the engine's: "halfling rogue 3 (Thief), criminal background". */
const lineOf = (s: SheetData) =>
  `${s.species.toLowerCase()} ${s.classes.map(k => `${k.name.toLowerCase()} ${k.level}${k.subclass ? ` (${k.subclass})` : ""}`).join(" / ")}, ${s.background.toLowerCase()} background`;

const titleSkill = (id: string) => id.replace(/-/g, " ").replace(/\b\w/g, ch => ch.toUpperCase()).replace(/ Of /g, " of ");

/** "2 silver crowns", "a shilling": a coin stack in words. */
const countOfCoins = (name: string, n: number) => (n === 1 ? `1 ${name.replace(/^(the|some) /i, "")}` : `${n} ${name.replace(/^(the|some) /i, "")}`);

/**
 * What they carry in the story's world (or carried out of the last one), apart from their gear: coins
 * go in the purse. Before the story begins, the purse the campaign starts them with. No engine.
 */
export function pocketsOf(state: RulesSession, startingPurse: ReadonlyArray<{ name: string; quantity: number }>): Pockets {
  const entities = state.world?.entities ?? Object.fromEntries((state.carried ?? []).map(e => [e.id, e]));
  const onPlayer = (e: Entity) => {
    for (let p = e.parent, n = 0; p && n < 20; p = entities[p]?.parent ?? null, n++) {
      if (p === "player") return true;
      // In someone else's hands, or put down somewhere: not theirs to carry.
      const up = entities[p];
      if (!up || up.kind === "person" || up.kind === "area" || up.kind === "place") return false;
    }
    return false;
  };
  const things = Object.values(entities).filter(e => e.id !== "player" && !e.gear && !e.states.includes("gone") && onPlayer(e));
  const purse = things.filter(e => COIN.test(e.name)).map(e => ({ name: e.name, quantity: e.quantity ?? 1 }));
  const carrying = things.filter(e => !COIN.test(e.name)).map(e => ({ name: e.name, quantity: e.quantity ?? 1, ...(e.parent && e.parent !== "player" ? { in: entities[e.parent]?.name ?? e.parent } : {}) }));
  // Before the story begins, the purse it starts them with.
  if (!state.world && !state.carried && !state.history?.length) purse.push(...startingPurse.map(p => ({ name: p.name, quantity: p.quantity })));
  return { purse, carrying };
}

type Feature = { id: string; name: string; effects?: Array<Record<string, unknown>> };
type Grants = Record<string, Feature[] | { features?: Feature[] }>;
const RECHARGE: Record<string, string> = { shortRest: "short rest", longRest: "long rest", partialShortFullLong: "one back per short rest" };
const COIN = /\b(crowns?|shillings?|penn(y|ies)|coins?|groats?|farthings?|marks?)$/i;
/** Proficiencies in a kind of tool rather than a tool (a class's "musical"). */
const TOOL_KIND: Record<string, string> = { musical: "A musical instrument", gaming: "A gaming set", herbalism: "Herbalism Kit" };
const ARMOR_ORDER = ["light", "medium", "heavy", "shield"];
const capitalWords = (t: string) => t.replace(/-/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());

/**
 * The sheet as data (undefined without a character). Its purse and pockets are what the session's
 * world has on them: before the story begins that's nothing, and the campaign's starting purse is
 * pocketsOf's to add (the sheet row keeps them apart, refreshed without the engine).
 */
export function sheetData(rules: Rules, state: RulesSession): SheetData | undefined {
  if (!state.rules) return undefined;
  const ctx = reading(rules, state);
  const { engine } = ctx;
  const id = state.rules.pc;
  const c = ctx.campaign.state.characters[id]!;
  const s = sheetOf(ctx, id);
  const content = engine.content;
  const gone = new Set(state.rules.gone ?? []);
  const goneNames = new Set([...gone].map(g => content.items.get(ctx.campaign.state.itemInstances[g]?.definitionId ?? "")?.name).filter((n): n is string => !!n));
  // What the character chose along the way, by the prompt's key ("fighting-style-fighter": Archery).
  const chosen = new Map<string, Dnd.ChoiceOption[]>();
  for (const p of Object.values(ctx.campaign.state.pendingChoices)) {
    if (p.forCharacterId !== id || !p.resolution || !p.promptKey) continue;
    const picked = (p.resolution as { selectedOptionIds?: string[] }).selectedOptionIds ?? [];
    chosen.set(p.promptKey, p.options.filter(o => picked.includes(o.id)));
  }
  const isFeat = (o: Dnd.ChoiceOption) => content.feats.has(o.id) || ((o["effects"] as Array<Record<string, unknown>> | undefined) ?? []).some(e => e["kind"] === "GrantFeat");
  const choiceOf = (effects: Array<Record<string, unknown>> | undefined) => effects?.filter(e => e["kind"] === "OfferChoice").flatMap(e => chosen.get(String(e["choiceId"])) ?? []);

  // Features from the class and subclass tables, to the levels they have; one of the same name from
  // a later level ("Sneak Attack (2d6)") replaces the earlier, and one that grants a resource carries its uses.
  const resources = ((c as unknown as { resources?: Array<{ resourceId: string; current: number; max: number; recharge?: string }> }).resources ?? []);
  const usesOf = (r: (typeof resources)[number]): Uses => ({ current: r.current, max: r.max, ...(r.recharge ? { recharge: RECHARGE[r.recharge] ?? r.recharge } : {}) });
  const features: SheetData["features"] = [];
  const shown = new Set<string>();
  // Choices shown on their feature (an invocation the engine models as a feat) stay off the feats list.
  const onFeatures = new Set<string>();
  const base = (name: string) => name.replace(/\s*\(.*\)$/, "");
  const addFeatures = (grants: Grants | undefined, upTo: number, from: string) => {
    for (const [lvl, row] of Object.entries(grants ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      if (Number(lvl) > upTo) continue;
      for (const f of Array.isArray(row) ? row : row.features ?? []) {
        const granted = f.effects?.find(e => e["kind"] === "GrantResource");
        const r = granted ? resources.find(x => x.resourceId === String(granted["resourceId"])) : undefined;
        if (r) shown.add(r.resourceId);
        const picks = choiceOf(f.effects) ?? [];
        if (!/^ability-score-improvement/.test(f.id)) for (const o of picks) onFeatures.add(o.id);
        const entry = {
          // Uses show as pips, so "(3/long rest)" and "(3 uses)" say nothing more.
          name: r ? f.name.replace(/\s*\(\d[^)]*\)$/, "") : f.name, from, level: Number(lvl),
          ...(picks.length ? { choice: picks.map(o => o.label.replace(/\s*\(.*\)$/, "")).join(", ") } : {}),
          ...(r ? { uses: usesOf(r) } : {}),
        };
        // Two parts of one feature at the same level ("Draconic Resilience (HP)", "(Unarmored AC)") are both kept.
        const before = features.findIndex(x => x.from === from && x.level < entry.level && base(x.name) === base(f.name));
        if (before < 0) { features.push(entry); continue; }
        const was = features[before]!;
        features[before] = { ...entry, ...(!entry.uses && was.uses ? { uses: was.uses, name: was.name } : {}), ...(!entry.choice && was.choice ? { choice: was.choice } : {}) };
      }
    }
  };
  for (const k of c.classes) {
    const cls = content.classes.get(k.classId);
    addFeatures(cls?.["levelTable"] as Grants | undefined, k.level, cls?.name ?? capitalWords(k.classId));
    if (k.subclassId) addFeatures(content.subclasses.get(k.subclassId)?.["levelGrants"] as Grants | undefined, k.level, content.subclasses.get(k.subclassId)?.name ?? capitalWords(k.subclassId));
  }
  // Resources no feature above grants (a species' own): under their own names.
  for (const r of resources.filter(r => !shown.has(r.resourceId))) features.push({ name: capitalWords(r.resourceId.replace(/-points$/, "")), from: "", level: 0, uses: usesOf(r) });

  // Feats: the background's, and any chosen (a human's Versatile, an Ability Score Improvement).
  const background = content.backgrounds.get(c.backgroundId);
  const featIds = [String(background?.["originFeatId"] ?? ""), ...c.featsTaken, ...[...chosen.values()].flat().filter(o => isFeat(o) && !onFeatures.has(o.id)).map(o => {
    const grant = ((o["effects"] as Array<Record<string, unknown>> | undefined) ?? []).find(e => e["kind"] === "GrantFeat");
    return grant ? String(grant["featId"]) : o.id;
  })].filter(Boolean);
  const feats = [...new Set(featIds.map(f => content.feats.get(f)?.name ?? capitalWords(f)))];

  // The species' traits: senses, resistances, its own resources, and what was chosen (not the size, not a feat).
  const species = content.species.get(c.speciesId);
  const traits: string[] = [];
  for (const t of (species?.["traits"] as Array<Record<string, unknown>> | undefined) ?? []) {
    if (t["kind"] === "GrantSense") traits.push(`${capitalWords(String(t["sense"]))} ${t["range"]} ft`);
    else if (t["kind"] === "GrantResistance") traits.push(`${capitalWords(String(t["damageType"]))} resistance`);
    else if (t["kind"] === "GrantHeroicInspirationOnLongRest") traits.push("Resourceful");
    else if (t["kind"] === "GrantHalflingLuck") traits.push("Luck");
    else if (t["kind"] === "GrantResource") traits.push(capitalWords(String(t["resourceId"]).replace(/^dragonborn-/, "")));
    else if (t["kind"] === "OfferChoice") {
      const key = String(t["choiceId"]);
      const picks = (chosen.get(key) ?? []).filter(o => !isFeat(o));
      if (/-size$/.test(key) || !picks.length) continue;
      traits.push(`${capitalWords(key.replace(new RegExp(`^${c.speciesId}-`), ""))}: ${picks.map(o => o.label.replace(/\s*\(.*\)$/, "")).join(", ")}`);
    }
  }

  // Proficiencies: the class's (the first class's armour and weapons), the background's tools, and any chosen or granted since.
  const first = content.classes.get(c.classes[0]?.classId ?? "");
  const prof = {
    armor: [...((first?.["armorProficiencies"] as string[] | undefined) ?? [])],
    weapons: [...((first?.["weaponProficiencies"] as string[] | undefined) ?? [])],
    tools: [...((first?.["toolProficiencies"] as string[] | undefined) ?? []), ...((background?.["toolProficiencies"] as string[] | undefined) ?? [])],
  };
  const granted = [...[...chosen.values()].flat().flatMap(o => (o["effects"] as Array<Record<string, unknown>> | undefined) ?? []),
    ...c.classes.flatMap(k => Object.entries((content.subclasses.get(k.subclassId ?? "")?.["levelGrants"] as Grants | undefined) ?? {}).filter(([l]) => Number(l) <= k.level)
      .flatMap(([, row]) => (Array.isArray(row) ? row : row.features ?? []).flatMap(f => f.effects ?? [])))];
  for (const e of granted.filter(e => e["kind"] === "GrantProficiency")) {
    const list = e["target"] === "armor" ? prof.armor : e["target"] === "weapon" ? prof.weapons : e["target"] === "tool" ? prof.tools : undefined;
    if (list && !list.includes(String(e["id"]))) list.push(String(e["id"]));
  }
  const toolName = (t: string) => content.items.get(t)?.name ?? TOOL_KIND[t] ?? capitalWords(t);

  const { purse, carrying } = pocketsOf(state, []);

  const held = new Set([c.equipped.mainHand, c.equipped.offHand].filter(Boolean));
  const added = damageAdded(ctx, c, s);
  const dice = (d: { dice: string; modifier: number }, plus: number) => `${d.dice}${d.modifier + plus ? signed(d.modifier + plus) : ""}`;
  const attacks = (s.attacks as Array<Dnd.CharacterSheet["attacks"][number] & { weaponInstanceId?: string; versatileDamage?: { dice: string; modifier: number }; range?: { normal: number; long: number }; properties?: string[]; mastery?: string }>)
    .filter((a, i, all) => all.findIndex(b => b.name === a.name) === i)
    .filter(a => (a.weaponInstanceId ? !gone.has(a.weaponInstanceId) : !goneNames.has(a.name)))
    .map(a => {
      const plus = added(a);
      return {
        name: a.name, kind: a.attackKind, bonus: a.attackBonus, damage: dice(a.damage, plus), type: a.damage.type,
        ...(a.versatileDamage ? { versatile: dice(a.versatileDamage, plus) } : {}),
        ...(a.range ? { range: a.range } : {}), properties: a.properties ?? [], ...(a.mastery ? { mastery: a.mastery } : {}),
        held: !!a.weaponInstanceId && held.has(a.weaponInstanceId),
      };
    });

  const sc = s.spellcasting?.classes[0];
  // Their numbers for a spell's details, and what the engine adds to their spells.
  const caster: Caster | undefined = sc && { level: s.totalLevel, saveDC: sc.saveDC, attackBonus: sc.attackBonus, extras: spellExtras(ctx.E, content, ctx.campaign.state, c) };
  const pact = (s.spellSlots as { pactSlots?: { level: number; count: number } }).pactSlots;
  const saves = s.savingThrows as Record<Dnd.Ability, { total: number; breakdown?: Array<{ source: string }> }>;
  const conditions = [
    ...c.appliedConditions.filter(a => !/-active$/.test(a.conditionId)).map(a => content.conditions.get(a.conditionId)?.name ?? capitalWords(a.conditionId)).filter(n => !/active$/i.test(n)),
    ...(Number(c["exhaustion"] ?? 0) > 0 ? [`Exhaustion ${c["exhaustion"]}`] : []),
  ];
  const slotOf = (instance: string) => c.equipped.mainHand === instance ? "in hand" as const : c.equipped.offHand === instance ? "off hand" as const : c.equipped.armor === instance || c.equipped.shield === instance ? "worn" as const : undefined;
  return {
    name: c.name, concept: state.player.concept,
    species: species?.name ?? capitalWords(c.speciesId), background: background?.name ?? capitalWords(c.backgroundId),
    classes: c.classes.map(k => ({ id: k.classId, name: content.classes.get(k.classId)?.name ?? capitalWords(k.classId), level: k.level, ...(k.subclassId ? { subclass: content.subclasses.get(k.subclassId)?.name ?? capitalWords(k.subclassId) } : {}) })),
    level: s.totalLevel,
    hp: { current: Math.max(0, c.hp.current), max: s.effectiveHpMax, temp: c.hp.temp },
    ac: s.ac.total, speeds: s.speeds, initiative: s.initiative.modifier, proficiency: s.proficiencyBonus,
    hitDice: c.classes.map(k => ({ die: Number(content.classes.get(k.classId)?.hitDie ?? 8), left: k.hitDiceRemaining, total: k.level })),
    inspiration: c.heroicInspiration,
    ...(c.hp.current <= 0 ? { deathSaves: c.deathSaves } : {}),
    abilities: ABILITIES.map(a => ({ id: a, name: ABILITY_NAME[a], score: s.abilityScores[a], modifier: s.abilityModifiers[a], save: saves[a].total, proficient: !!saves[a].breakdown?.some(b => b.source === "proficiency") })),
    skills: s.skills.map(k => ({ id: k.skill, name: titleSkill(k.skill), ability: k.ability, modifier: k.modifier, proficiency: k.proficiency, advantage: k.hasAdvantage, disadvantage: k.hasDisadvantage })),
    passive: s.passiveScores,
    attacks,
    ...(sc ? { spellcasting: {
      className: sc.className, ability: sc.ability, saveDC: sc.saveDC, attackBonus: sc.attackBonus,
      slots: s.spellSlots.slotsByLevel.map((max, i) => ({ level: i + 1, max, used: c.spellSlotsUsed[String(i + 1)] ?? 0 })).filter(x => x.max > 0),
      ...(pact?.count ? { pact: { level: pact.level, max: pact.count, used: Number(c["pactSlotsUsed"] ?? 0) } } : {}),
      spells: s.spellcasting!.spellsByLevel.filter(g => g.spells.length).map(g => ({ level: g.level, spells: g.spells.map(sp => {
        const def = content.spells.get(sp.spellId);
        return {
          id: sp.spellId, name: sp.name, ready: g.level === 0 || sp.prepared || sp.alwaysPrepared, always: sp.alwaysPrepared && g.level > 0, concentration: !!def?.concentration, ritual: !!def?.ritual,
          ...(def ? { details: spellDetails(rules.srd, def, caster, namesIn(content)) } : {}),
        };
      }) })),
    } } : {}),
    features, feats, traits, conditions,
    equipment: s.inventory.items.filter(i => !gone.has(i.instanceId) && i.definitionId !== "unarmed-strike").map(i => ({ name: i.name, kind: i.itemKind, ...(slotOf(i.instanceId) ? { slot: slotOf(i.instanceId)! } : {}), quantity: i.quantity })),
    carrying, purse,
    languages: s.knownLanguages.map(l => (l === "thieves-cant" ? "Thieves' Cant" : capitalWords(l))),
    proficiencies: {
      armor: [...ARMOR_ORDER.filter(a => prof.armor.includes(a)), ...prof.armor.filter(a => !ARMOR_ORDER.includes(a))].map(a => (a === "shield" ? "Shields" : capitalWords(a))),
      weapons: prof.weapons.map(w => capitalise(w.replace(/^martial-(\w+)$/, "martial ($1)"))),
      tools: [...new Set(prof.tools.map(toolName))],
    },
    ...storyOf(state),
  };
}

/** The backstory part of the sheet, when there is one. */
function storyOf(state: RulesSession): Pick<SheetData, "story"> {
  const b = state.player.backstory;
  return b?.text.trim() ? { story: { backstory: b.text.trim(), personality: b.personality, ideals: b.ideals, bonds: b.bonds, flaws: b.flaws } } : {};
}

// ---------------------------------------------------------------------------------------------
// Checks and saves.

/** A skill check through the engine (conditions, expertise, Bardic Inspiration and so on apply). */
function skillCheck(rules: Rules, state: RulesSession, skill: Skill, dc: number, advantage?: "advantage" | "disadvantage"): RollResult {
  const ctx = opened(rules, state);
  const [rolled] = ctx.apply(ctx.engine.plan.abilityCheck(ctx.campaign.state, { type: "AbilityCheck", characterId: state.rules!.pc, ability: SKILL_ABILITY[skill], skill: engineSkill(skill), dc, ...(advantage ? { advantage } : {}) }).events);
  close(rules, state, ctx);
  return rollResult(rolled!, skill, dc);
}

function rollResult(e: Dnd.EngineEvent, label: string, dc: number): RollResult {
  const total = Number(e["total"]);
  const modifier = Number(e["bonus"] ?? 0);
  const die = total - modifier;
  const success = e["success"] === true;
  const used = e["used"];
  return {
    skill: label, dc, die, modifier, total, success,
    critical: die === 20 && success ? "success" : die === 1 && !success ? "failure" : null,
    ...(used === "advantage" || used === "disadvantage" ? { advantage: used } : {}),
  };
}

/**
 * A check: through the engine when the session has a sheet (on the cached campaign, which the roll
 * is committed to), else the concept's modifiers. Either way the game's dice roll once more.
 */
export function rollFor(rules: Rules, state: RulesSession, skill: Skill, dc: number): RollResult {
  if (state.rules) return skillCheck(rules, state, skill, dc);
  return rollCheck(rng(state.seed + 7919 * ++state.rollCount), skill, dc, state.player.modifiers[skill] ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Spells.

/** Cantrips plus prepared spells (class, feat and always-prepared), from the derived sheet. */
function readySpells(sheet: Dnd.CharacterSheet): SpellRef[] {
  return (sheet.spellcasting?.spellsByLevel ?? []).flatMap(g => g.spells.filter(sp => g.level === 0 || sp.prepared || sp.alwaysPrepared)).map(sp => ({ id: sp.spellId, name: sp.name, level: sp.level }));
}

/** What the mechanics name by id, by the engine's names for them. */
const namesIn = (content: Dnd.Content): Names => ({ condition: id => content.conditions.get(id)?.name, item: id => content.items.get(id)?.name });

type Effect = Record<string, unknown>;

/**
 * The character's effects by where they come from, named, as the engine gathers them for its effect
 * stack: their class and subclass features to their level, the options chosen for them, their feats
 * (the background's too), their species' traits and what's on them now. A feat any of these grants
 * comes under its own name.
 */
function effectSources(content: Dnd.Content, campaign: Dnd.CampaignState, c: Dnd.EngineCharacter): Array<{ name: string; effect: Effect }> {
  const out: Array<{ name: string; effect: Effect }> = [];
  const add = (name: string, effects: unknown) => {
    for (const e of (effects as Effect[] | undefined) ?? []) {
      const feat = e["kind"] === "GrantFeat" ? content.feats.get(String(e["featId"])) : undefined;
      if (feat) add(feat.name, feat["effects"]);
      else out.push({ name, effect: e });
    }
  };
  for (const k of c.classes) {
    const tables = [content.classes.get(k.classId)?.["levelTable"], k.subclassId ? content.subclasses.get(k.subclassId)?.["levelGrants"] : undefined] as Array<Grants | undefined>;
    for (const table of tables) {
      for (const [level, row] of Object.entries(table ?? {})) if (Number(level) <= k.level) for (const f of Array.isArray(row) ? row : row.features ?? []) add(f.name, f.effects);
    }
  }
  for (const p of Object.values(campaign.pendingChoices)) {
    if (p.forCharacterId !== c.id || !p.resolution) continue;
    const picked = (p.resolution as { selectedOptionIds?: string[] }).selectedOptionIds ?? [];
    for (const o of p.options.filter(o => picked.includes(o.id))) add(o.label, o["effects"]);
  }
  const origin = content.backgrounds.get(c.backgroundId)?.["originFeatId"];
  for (const id of new Set([...c.featsTaken, ...(origin ? [String(origin)] : [])])) { const feat = content.feats.get(id); if (feat) add(feat.name, feat["effects"]); }
  const species = content.species.get(c.speciesId);
  if (species) add(species.name, species["traits"]);
  for (const a of c.appliedConditions) { const cond = content.conditions.get(a.conditionId); if (cond) add(cond.name, cond["effects"]); }
  return out;
}

/**
 * What the engine adds to the character's spells when they're cast (Extras in src/rules/spells.ts),
 * from its own effect stack for them, as its cast-spell planner asks it: the damage modifiers for a
 * spell (by its id, school, level and damage type), the Wisdom modifier it adds to every heal with
 * dice, the healing boost of a heal from a slot, and Potent Cantrip. Each is named for the feature,
 * feat, choice or condition it comes from.
 */
function spellExtras(E: typeof Dnd, content: Dnd.Content, campaign: Dnd.CampaignState, c: Dnd.EngineCharacter): Extras {
  const stack = E.buildEffectStack({ character: c, content, itemInstances: campaign.itemInstances, pendingChoices: campaign.pendingChoices });
  const sources = effectSources(content, campaign, c);
  const nameOf = (test: (e: Effect) => boolean) => sources.find(s => test(s.effect))?.name;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const boost = stack.healingBoostFor(1), perLevel = stack.healingBoostFor(2) - boost;
  return {
    damage(spell, type, primary) {
      const facts = new Map<string, unknown>([["event.damageType", type], ...(primary ? [["event.spellSchool", spell.school], ["event.spellId", spell.id], ["event.spellLevel", spell.level]] as const : [])]);
      return stack.modifierBreakdown("damage", facts).filter(m => m.value).map(m => {
        const from = nameOf(e => e["kind"] === "AddModifier" && e["target"] === "damage" && same(e["condition"], m.predicate)) ?? (m.source === "condition" ? "what's on you" : "your features");
        // "Agonizing Blast (Eldritch Blast)" on Eldritch Blast's own card is Agonizing Blast.
        return { amount: m.value, from: from.endsWith(` (${spell.name})`) ? from.slice(0, -(spell.name.length + 3)) : from };
      });
    },
    heal: { amount: Math.floor((c.abilityScores.WIS - 10) / 2), from: "your Wisdom modifier" },
    ...(boost ? { healBoost: { flat: boost - perLevel, perLevel, from: nameOf(e => e["kind"] === "BoostHealing") ?? "your features" } } : {}),
    ...(stack.hasPotentCantrip() ? { potentCantrip: nameOf(e => e["kind"] === "GrantPotentCantrip") ?? "Potent Cantrip" } : {}),
  };
}


const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------------------------------------------------------------------------------------------
// Gear: what they carry, and what the story parts them from.

function gearOf(ctx: Ctx, id: string): GearRow[] {
  const c = ctx.campaign.state.characters[id]!;
  const slotOf = (instance: string) => (Object.entries(c.equipped).find(([slot, v]) => slot !== "attuned" && v === instance)?.[0]) as "mainHand" | "offHand" | "armor" | "shield" | undefined;
  return c.inventory.map(i => ctx.campaign.state.itemInstances[i]).filter((i): i is Dnd.ItemInstance => !!i && i.definitionId !== "unarmed-strike").map(i => {
    const def = ctx.engine.content.items.get(i.definitionId);
    const kind = def?.itemKind === "weapon" ? "weapon" : def?.itemKind === "armor" ? (i.definitionId === "shield" || def?.["armorCategory"] === "shield" ? "shield" : "armor") : "item";
    const slot = slotOf(i.id);
    return { id: i.id, name: def?.name ?? i.definitionId, kind, ...(slot ? { slot } : {}) };
  });
}

/**
 * The story has parted the player from a piece of gear (given, dropped, left behind), or given it
 * back: its dice line, or undefined when nothing changed (and then the dice don't roll).
 */
export function carryGear(rules: Rules, state: RulesSession, instanceId: string, carried: boolean): string | undefined {
  if (!state.rules) return undefined;
  const gone = new Set(state.rules.gone ?? []);
  if (carried === !gone.has(instanceId)) return undefined;
  const ctx = opened(rules, state);
  const pcId = state.rules.pc;
  const me = ctx.campaign.state.characters[pcId]!;
  const name = ctx.engine.content.items.get(ctx.campaign.state.itemInstances[instanceId]?.definitionId ?? "")?.name ?? "that";
  let slot: string | undefined;
  if (carried) {
    gone.delete(instanceId);
    rewear(ctx, me, pcId, state.rules.gear?.find(g => g.id === instanceId)?.kind, instanceId);
  } else {
    gone.add(instanceId);
    slot = (Object.entries(me.equipped).find(([s, v]) => s !== "attuned" && v === instanceId)?.[0]);
    if (slot) ctx.apply([event(ctx.E, "ItemUnequipped", { characterId: pcId, slot })]);
  }
  state.rules.gone = [...gone];
  refresh(ctx, state);
  const ac = sheetOf(ctx, pcId).ac.total;
  close(rules, state, ctx);
  // Armour coming off changes your AC; say so.
  const acNote = slot === "armor" || slot === "shield" ? ` (AC now ${ac})` : "";
  return carried ? `You have your ${name.toLowerCase()} again` : `You no longer have your ${name.toLowerCase()}${acNote}`;
}

/** Gear back in the player's hands is wielded or worn again, where nothing else has taken its place (a weapon in hand, armour on). */
function rewear(ctx: Ctx, me: Dnd.EngineCharacter, pcId: string, kind: string | undefined, instanceId: string): void {
  const slot = kind === "weapon" ? "mainHand" : kind === "armor" ? "armor" : kind === "shield" ? "shield" : undefined;
  if (!slot || me.equipped[slot]) return;
  try { ctx.apply(ctx.engine.plan.equip(ctx.campaign.state, { characterId: pcId, instanceId, slot }).events); }
  catch { /* The engine says no (a shield with a two-handed weapon): carried, not worn. */ }
}

function weaponsOf(ctx: Ctx, id: string): WeaponRef[] {
  const state = ctx.campaign.state;
  return state.characters[id]!.inventory.map(i => state.itemInstances[i]).filter((i): i is Dnd.ItemInstance => !!i)
    .filter(i => ctx.engine.content.items.get(i.definitionId)?.itemKind === "weapon")
    .map(i => ({ id: i.id, name: ctx.engine.content.items.get(i.definitionId)?.name ?? i.definitionId }));
}

/** The player's Rage ends (knocked out, rested, or its time up). True if they were raging. */
function endRage(ctx: Ctx, state: RulesSession): boolean {
  const pcId = state.rules!.pc;
  const raging = ctx.campaign.state.characters[pcId]!.appliedConditions.filter(a => a.conditionId === "raging");
  if (raging.length) ctx.apply(raging.map(() => event(ctx.E, "ConditionRemoved", { targetId: pcId, conditionId: "raging" })));
  delete state.rules!.rage;
  return raging.length > 0;
}

/**
 * A dropped player comes to with 1 HP at the next scene (or the smelling salts): out cold, and
 * lying where they fell, are both over. Someone merely knocked over is back on their feet by then,
 * without a word about it.
 */
export function comeTo(rules: Rules, state: RulesSession): string | undefined {
  if (!state.rules) return undefined;
  const ctx = opened(rules, state);
  const me = ctx.campaign.state.characters[state.rules.pc]!;
  const down = me.hp.current <= 0;
  // (The engine lets hit points run below zero, and healing starts from 0: this is 1 HP.)
  if (down) ctx.apply([event(ctx.E, "Healed", { targetId: me.id, amount: 1, source: "came-to" })]);
  for (const a of ctx.campaign.state.characters[me.id]!.appliedConditions.filter(a => a.conditionId === "prone" || (down && a.conditionId === "unconscious"))) ctx.apply([event(ctx.E, "ConditionRemoved", { targetId: me.id, conditionId: a.conditionId })]);
  // Coming to (from a knock-out, or at the next scene), any Rage is long over.
  endRage(ctx, state);
  const line = down ? `You come to: ${status(ctx, me.id)}` : undefined;
  close(rules, state, ctx);
  return line;
}

// ---------------------------------------------------------------------------------------------
// Class features: what a fighter, barbarian, bard, sorcerer, paladin or cleric can do outside a fight too.

/**
 * A class feature with uses (an engine resource), and the engine's intent for it. `target`: the
 * user, or someone (yourself too, when `self`: Lay on Hands, Divine Spark). The intent gets the
 * engine ids of the user and of whoever it's for, and the engine's state (for how much to heal).
 */
interface FeatureRule {
  id: string; name: string; classId: string; subclassId?: string; resource: string;
  target: "self" | "creature"; self?: boolean;
  intent: (E: typeof Dnd, me: string, to: string | undefined, state: Dnd.CampaignState) => { type: string; [key: string]: unknown };
}

/** How many hit points someone is short of their maximum (as the engine has them). */
const missingHp = (state: Dnd.CampaignState, id: string) => { const c = state.characters[id]; return c ? Math.max(0, c.hp.max - Math.max(0, c.hp.current)) : 0; };
const resourceLeft = (state: Dnd.CampaignState, id: string, resource: string) => (state.characters[id] as unknown as { resources?: Resource[] } | undefined)?.resources?.find(r => r.resourceId === resource)?.current ?? 0;

const FEATURES: FeatureRule[] = [
  { id: "second-wind", name: "Second Wind", classId: "fighter", resource: "second-wind", target: "self", intent: (E, me) => E.bonusActionIntent("second-wind", me) },
  { id: "rage", name: "Rage", classId: "barbarian", resource: "rage", target: "self", intent: (E, me) => E.bonusActionIntent("rage", me) },
  { id: "bardic-inspiration", name: "Bardic Inspiration", classId: "bard", resource: "bardic-inspiration", target: "creature", intent: (_E, me, to) => ({ type: "BardicInspiration", bardId: me, recipientId: to }) },
  { id: "innate-sorcery", name: "Innate Sorcery", classId: "sorcerer", resource: "innate-sorcery", target: "self", intent: (E, me) => E.bonusActionIntent("innate-sorcery", me) },
  // As much as the hurt needs, out of what's left in the pool.
  { id: "lay-on-hands", name: "Lay on Hands", classId: "paladin", resource: "lay-on-hands", target: "creature", self: true,
    intent: (_E, me, to, s) => ({ type: "LayOnHands", paladinId: me, targetId: to ?? me, mode: "heal", amount: Math.max(1, Math.min(resourceLeft(s, me, "lay-on-hands"), missingHp(s, to ?? me))) }) },
  { id: "divine-spark", name: "Divine Spark", classId: "cleric", resource: "channel-divinity", target: "creature", self: true, intent: (_E, me, to) => ({ type: "DivineSpark", clericId: me, targetId: to ?? me, mode: "heal" }) },
  { id: "preserve-life", name: "Preserve Life", classId: "cleric", subclassId: "life-domain", resource: "channel-divinity", target: "self",
    intent: (_E, me, _to, s) => ({ type: "PreserveLife", clericId: me, allocations: [{ targetId: me, amount: Math.max(1, Math.min(5 * (s.characters[me]?.classes.find(k => k.classId === "cleric")?.level ?? 1), missingHp(s, me))) }] }) },
  { id: "sacred-weapon", name: "Sacred Weapon", classId: "paladin", subclassId: "oath-of-devotion", resource: "channel-divinity", target: "self", intent: (_E, me) => ({ type: "SacredWeapon", paladinId: me }) },
  { id: "magical-cunning", name: "Magical Cunning", classId: "warlock", resource: "magical-cunning", target: "self", intent: (_E, me) => ({ type: "MagicalCunning", warlockId: me }) },
];

function featuresOf(ctx: Ctx, id: string): Array<FeatureRef & { target: "self" | "creature" }> {
  const c = ctx.campaign.state.characters[id]!;
  return FEATURES.filter(f => c.classes.some(k => k.classId === f.classId && (!f.subclassId || k.subclassId === f.subclassId))).map(({ id, name, target }) => ({ id, name, target }));
}

/** A class feature's rule, for a menu: whose it is, what it spends, and whether it takes someone. */
export function featureRule(id: string): Omit<FeatureRule, "intent"> | undefined {
  const f = FEATURES.find(x => x.id === id);
  if (!f) return undefined;
  const { intent: _intent, ...rule } = f;
  return rule;
}

// ---------------------------------------------------------------------------------------------
// What the rules keep on the session as the engine changes the character.

/** The campaign as it now is, and the status line from it, back on the session; kept in the isolate's cache when it's as a load of that string would give it. */
function close(rules: Rules, state: RulesSession, ctx: Ctx): void {
  state.rules!.campaign = ctx.E.serializeCampaign(ctx.campaign);
  state.rules!.status = status(ctx, state.rules!.pc);
  if (ctx.asLoaded) keep(rules, state.rules!.campaign, ctx.campaign);
}

/** What a turn's decision needs from the sheet, cached on the session: spells, weapons, skills, the build line. */
function refresh(ctx: Ctx, state: RulesSession): void {
  const id = state.rules!.pc;
  const sheet = sheetOf(ctx, id);
  state.rules!.spells = readySpells(sheet);
  state.rules!.weapons = weaponsOf(ctx, id).filter(w => !state.rules!.gone?.includes(w.id));
  state.rules!.features = featuresOf(ctx, id);
  state.rules!.gear = gearOf(ctx, id);
  state.player.modifiers = modifiersFrom(sheet);
  state.player.build = buildLine(ctx, id);
}
