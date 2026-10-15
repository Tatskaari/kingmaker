import { readFileSync } from "node:fs";
import type * as Dnd from "../../vendor/dnd-srd-engine/dnd-srd-engine.js";
import { respondJson } from "../llm/openrouter.ts";
import { describeRoll, rng, type RollResult } from "../runtime/dice.ts";
import { SKILLS, type Character, type Skill } from "../runtime/scene.ts";
import type { SessionState } from "../runtime/session.ts";
import { startingPurse } from "../world/inventory.ts";
import { caughtIn, damageThing, heldBy, positionOf, type Entity, type SceneWorld } from "../world/scene-world.ts";
import { bleed, elemental, spill } from "../world/systems.ts";
import { RAYS, spellDetails, type Caster, type Extras, type Names, type SpellDetails } from "./spells.ts";

/**
 * D&D 5.5e mechanics (SRD 5.2.1) from the vendored dnd-srd-engine: the player's character sheet,
 * checks and saves, spells, attacks, rests and levels. The GM still adjudicates the story (whether
 * something needs dice at all, how hard it is, what it means); the engine decides what the rules
 * and the dice decide, and the GM narrates exactly that.
 */

const VENDOR = new URL("../../vendor/dnd-srd-engine/", import.meta.url);
let loaded: { E: typeof Dnd; pack: unknown } | undefined;

/** The engine and its content, loaded on first use (~70 ms; the pack is pre-validated JSON). */
export async function dnd(): Promise<{ E: typeof Dnd; pack: unknown }> {
  if (!loaded) {
    // A literal path, so a bundler (the browser build) can follow it; Node resolves it the same way.
    const E = await import("../../vendor/dnd-srd-engine/dnd-srd-engine.js") as typeof Dnd;
    loaded = { E, pack: JSON.parse(readFileSync(new URL("starter-pack.json", VENDOR), "utf8")) };
  }
  return loaded;
}

let reading: Dnd.Content | undefined;
/** The SRD's content (classes, species, backgrounds, spells...), from an engine made once just to read it. */
export async function srdContent(): Promise<Dnd.Content> {
  if (!reading) { const { E, pack } = await dnd(); reading = E.createEngine({ contentPacks: [pack], rng: E.seededRNG(1) }).content; }
  return reading;
}

interface Ctx { E: typeof Dnd; engine: Dnd.Engine; campaign: Dnd.Campaign; apply(events: Dnd.EngineEvent[]): Dnd.EngineEvent[] }

async function engineFor(seed: number) {
  const { E, pack } = await dnd();
  return { E, engine: E.createEngine({ contentPacks: [pack], rng: E.seededRNG(seed) }) };
}

/** An engine for reading only (no dice are rolled with it): menus and the like, synchronously. */
let reader: { engine: Dnd.Engine; campaign?: string; read?: RulesNow } | undefined;

/** The player's character as the rules have it this moment: the engine's character, its sheet, and the content. */
export interface RulesNow { E: typeof Dnd; content: Dnd.Content; character: Dnd.EngineCharacter; sheet: Dnd.CharacterSheet }

/**
 * The player's character now, read synchronously (what a menu needs to say what they can do): the
 * engine must have loaded once in this process (await dnd()). Undefined before that, or for a
 * session from before the rules engine. Kept until the campaign changes.
 */
export function rulesNow(state: SessionState): RulesNow | undefined {
  if (!state.rules || !loaded) return undefined;
  const { E, pack } = loaded;
  reader ??= { engine: E.createEngine({ contentPacks: [pack], rng: E.seededRNG(1) }) };
  if (reader.campaign !== state.rules.campaign || !reader.read) {
    const ctx: Ctx = { E, engine: reader.engine, campaign: loadWellFormed(E, state.rules.campaign, reader.engine), apply: e => e };
    const character = ctx.campaign.state.characters[state.rules.pc];
    if (!character) return undefined;
    reader.read = { E, content: reader.engine.content, character, sheet: sheetOf(ctx, state.rules.pc) };
    reader.campaign = state.rules.campaign;
  }
  return reader.read;
}

/** Open the session's campaign with a fresh seeded generator, so a session's dice can be replayed. */
async function open(state: SessionState): Promise<Ctx> {
  if (!state.rules) throw new Error("This session has no rules-engine character.");
  const { E, engine } = await engineFor(state.seed + 7919 * ++state.rollCount);
  const ctx: Ctx = {
    E, engine, campaign: loadWellFormed(E, state.rules.campaign, engine),
    apply(events) { ctx.campaign = E.commit(ctx.campaign, wellFormed(events)); return events; },
  };
  return ctx;
}

/**
 * The engine records a spell attack with the spell's id ("fire-bolt") where an item instance id
 * belongs, then refuses to load its own campaign ("Expected a ULID"). Nothing reads the field back,
 * so the log keeps a placeholder (the events returned to callers still name the spell).
 */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
function wellFormed(events: Dnd.EngineEvent[]): Dnd.EngineEvent[] {
  return events.map(e => typeof e["weaponInstanceId"] === "string" && !ULID.test(e["weaponInstanceId"] as string) ? { ...e, weaponInstanceId: "0".repeat(26) } : e);
}

/** Sessions saved with the bad events still load, repaired. */
function loadWellFormed(E: typeof Dnd, serialized: string, engine: Dnd.Engine): Dnd.Campaign {
  try { return E.loadCampaign(serialized, engine); }
  catch {
    const raw = JSON.parse(serialized) as { events?: Dnd.EngineEvent[] };
    raw.events = wellFormed(raw.events ?? []);
    return E.loadCampaign(JSON.stringify(raw), engine);
  }
}

/** The engine deals half damage on a spell attack that missed (a missed Fire Bolt still burns): a miss is a miss. */
function missesMiss(events: Dnd.EngineEvent[]): Dnd.EngineEvent[] {
  const missed = new Set(events.filter(e => e.type === "AttackRolled" && e["hit"] === false).map(e => String(e["targetId"])));
  if (!missed.size) return events;
  const dropped = new Set(events.filter(e => e.type === "DamageRolled" && missed.has(String(e["targetId"])) && events.some(a => a.type === "AttackRolled" && a.id === e["causedByEventId"] && a["hit"] === false)).map(e => e.id));
  return events.filter(e => !dropped.has(e.id) && !(e.type === "DamageApplied" && dropped.has(String(e["causedByEventId"]))));
}

function close(state: SessionState, ctx: Ctx): void {
  state.rules!.campaign = ctx.E.serializeCampaign(ctx.campaign);
  state.rules!.status = status(ctx, state.rules!.pc);
}

/** What a turn's decision needs from the sheet, cached on the session: spells, weapons, skills, the build line. */
function refresh(ctx: Ctx, state: SessionState): void {
  const id = state.rules!.pc;
  const sheet = sheetOf(ctx, id);
  state.rules!.spells = readySpells(sheet);
  state.rules!.weapons = weaponsOf(ctx, id).filter(w => !state.rules!.gone?.includes(w.id));
  state.rules!.features = featuresOf(ctx, id);
  state.rules!.gear = gearOf(ctx, id);
  state.player.modifiers = modifiersFrom(sheet);
  state.player.build = buildLine(ctx, id);
}

const event = (E: typeof Dnd, type: string, rest: Record<string, unknown>): Dnd.EngineEvent => ({ id: E.newEventId(), at: new Date().toISOString(), type, ...rest });

export const ABILITIES: Dnd.Ability[] = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
const ABILITY_NAME: Record<Dnd.Ability, string> = { STR: "Strength", DEX: "Dexterity", CON: "Constitution", INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma" };
const SKILL_ABILITY: Record<Skill, Dnd.Ability> = {
  athletics: "STR", acrobatics: "DEX", sleight_of_hand: "DEX", stealth: "DEX", arcana: "INT", history: "INT", investigation: "INT",
  nature: "INT", religion: "INT", animal_handling: "WIS", insight: "WIS", medicine: "WIS", perception: "WIS", survival: "WIS",
  deception: "CHA", intimidation: "CHA", performance: "CHA", persuasion: "CHA",
};
const engineSkill = (skill: Skill) => skill.replace(/_/g, "-");
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const ordinal = (n: number) => ["cantrip", "1st", "2nd", "3rd"][n] ?? `${n}th`;

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

export interface Build {
  classId: string; subclassId: string; speciesId: string; backgroundId: string;
  /** Most to least important: the standard array (15, 14, 13, 12, 10, 8) is assigned in this order. */
  abilities: string[];
  skills: string[]; feat: string; cantrips: string[]; spells: string[]; weapons: string[]; armor: string; shield: boolean;
  /** A fighter's, paladin's or ranger's Fighting Style, by the choice's option id ("dueling"); without one, the engine's first. */
  style?: string;
}

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
 * classes). One build (chooseBuild) or three (src/rules/builds.ts) are asked for with it.
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

async function chooseBuild(concept: string, level: number, content: Dnd.Content): Promise<Build> {
  const build = await respondJson<Build>({
    operation: "rules.build", effort: "low",
    instructions: `You turn a tabletop character concept into a D&D (2024 rules, SRD 5.2.1) build for a level ${level} character. ${BUILD_GUIDE}`,
    input: [{ role: "user", content: [`Character concept: ${concept}`, buildMenu(level, content)].join("\n\n") }],
    json: { name: "build", schema: { type: "object", additionalProperties: false, required: [...BUILD_FIELDS], properties: BUILD_SCHEMA } },
  });
  return build;
}

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
    cantrips: casting ? pickSpells(raw.cantrips, l => l === 0, casting.cantrips) : [],
    spells: casting ? pickSpells(raw.spells, l => l >= 1 && l <= casting.maxSpell(level), casting.prepared(level)) : [],
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
 * Make the player's D&D character from their concept (one model call for the build, then the
 * engine: level 1, its choices, levelled up to `level`, kit equipped). Sets state.rules, and the
 * skill modifiers and build line on state.player.
 */
export async function createCharacter(state: SessionState, level = 3, given?: Partial<Build>): Promise<string> {
  const { E, engine } = await engineFor(state.seed);
  const content = engine.content;
  // A ready-made build (a pregenerated character) skips the model; otherwise it's asked for one.
  let raw: Partial<Build> = given ?? {};
  if (!given) try { raw = await chooseBuild(`${state.player.name}: ${state.player.concept}`, level, content); } catch { /* the class defaults stand in */ }
  const settled = settleBuild(raw, level, content);
  // A chosen build without a Fighting Style gets the one that fits its weapons (a ready-made build keeps the engine's first).
  const style = given || settled.style ? undefined : styleFor(settled, content);
  const build = style ? { ...settled, style } : settled;
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
  const ctx: Ctx = { E, engine, campaign: engine.createCampaign({ name: state.id }), apply(events) { ctx.campaign = E.commit(ctx.campaign, wellFormed(events)); return events; } };
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
  close(state, ctx);
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

/** A short live status: "HP 13/24, spell slots 1st 2/4, 2nd 2/2, poisoned". */
export async function statusLine(state: SessionState): Promise<string> {
  if (!state.rules) return "";
  const { E, engine } = await engineFor(state.seed);
  const ctx: Ctx = { E, engine, campaign: E.loadCampaign(state.rules.campaign, engine), apply: e => e };
  return status(ctx, state.rules.pc);
}

function status(ctx: Ctx, id: string): string {
  const c = ctx.campaign.state.characters[id]!;
  const sheet = sheetOf(ctx, id);
  const slots = slotsLine(sheet, c);
  const conditions = c.appliedConditions.map(a => a.conditionId).filter(id => !id.endsWith("-active"));
  return [`HP ${Math.max(0, c.hp.current)}/${sheet.effectiveHpMax}${c.hp.temp ? ` (+${c.hp.temp} temp)` : ""}`, slots ? `spell slots ${slots}` : "", ...conditions].filter(Boolean).join(", ");
}

export async function sheetText(state: SessionState): Promise<string> {
  if (!state.rules) return `${state.player.name}: ${state.player.concept}\n(No D&D character sheet: this session predates the rules engine.)`;
  const { E, engine } = await engineFor(state.seed);
  const ctx: Ctx = { E, engine, campaign: E.loadCampaign(state.rules.campaign, engine), apply: e => e };
  const id = state.rules.pc;
  const c = ctx.campaign.state.characters[id]!;
  const s = sheetOf(ctx, id);
  const content = engine.content;
  // Gear the story has parted them from: off the sheet (a second one of the same kind would stay, but that's rare).
  const goneNames = new Set((state.rules.gone ?? []).map(g => content.items.get(ctx.campaign.state.itemInstances[g]?.definitionId ?? "")?.name).filter((n): n is string => !!n));
  const lines = [
    `${c.name}: ${buildLine(ctx, id)}`,
    `AC ${s.ac.total} · HP ${c.hp.current}/${s.effectiveHpMax}${c.hp.temp ? ` (+${c.hp.temp} temp)` : ""} · Speed ${s.speeds["walk"] ?? 30} ft · Initiative ${signed(s.initiative.modifier)} · Proficiency ${signed(s.proficiencyBonus)} · Hit Dice ${c.classes.map(k => `${k.hitDiceRemaining}/${k.level} d${content.classes.get(k.classId)?.hitDie ?? "?"}`).join(", ")}`,
    ABILITIES.map(a => `${a} ${s.abilityScores[a]} (${signed(s.abilityModifiers[a])})`).join("  "),
    `Saving throws: ${ABILITIES.map(a => `${a} ${signed(s.savingThrows[a].total)}`).join(", ")}`,
    `Skills: ${s.skills.filter(k => k.proficiency !== "none").map(k => `${titleSkill(k.skill)} ${signed(k.modifier)}${k.proficiency === "expertise" ? " (expertise)" : ""}`).join(", ") || "none trained"}`,
    `Other skills: ${s.skills.filter(k => k.proficiency === "none").map(k => `${titleSkill(k.skill)} ${signed(k.modifier)}`).join(", ")}`,
    `Passive: ${Object.entries(s.passiveScores).map(([k, v]) => `${titleSkill(k)} ${v}`).join(", ")}`,
    `Attacks: ${s.attacks.filter((a, i) => s.attacks.findIndex(b => b.name === a.name) === i).filter(a => !goneNames.has(a.name)).map(a => `${a.name} ${signed(a.attackBonus)} (${a.damage.dice}${a.damage.modifier ? signed(a.damage.modifier) : ""} ${a.damage.type})`).join("; ")}`,
  ];
  if (s.spellcasting?.classes.length) {
    const sc = s.spellcasting.classes[0]!;
    lines.push(`Spellcasting (${sc.className}, ${ABILITY_NAME[sc.ability]}): save DC ${sc.saveDC}, spell attack ${signed(sc.attackBonus)}; slots ${slotsLine(s, c) || "none"}`);
    for (const group of s.spellcasting.spellsByLevel) {
      const ready = group.spells.filter(sp => group.level === 0 || sp.prepared || sp.alwaysPrepared);
      if (ready.length) lines.push(`  ${group.level ? `${ordinal(group.level)} level` : "Cantrips"}: ${ready.map(sp => sp.name).join(", ")}`);
    }
  }
  const feats = c.featsTaken.map(f => content.feats.get(f)?.name ?? f);
  if (feats.length) lines.push(`Feats: ${feats.join(", ")}`);
  const conditions = c.appliedConditions.map(a => content.conditions.get(a.conditionId)?.name ?? a.conditionId).filter(n => !/active$/i.test(n));
  lines.push(`Conditions: ${conditions.join(", ") || "none"}${c.heroicInspiration ? " · Heroic Inspiration" : ""}`);
  lines.push(`Equipment: ${s.inventory.items.filter(i => !state.rules!.gone?.includes(i.instanceId)).map(i => `${i.name}${i.equippedSlot ? ` (${i.equippedSlot === "mainHand" ? "in hand" : "worn"})` : ""}`).filter(n => !/^Unarmed/.test(n)).join(", ") || "nothing"}`);
  lines.push(`Languages: ${s.knownLanguages.map(l => l[0]!.toUpperCase() + l.slice(1)).join(", ")}`);
  const story = storyOf(state).story;
  if (story) {
    const traits = ([["Personality", story.personality], ["Ideals", story.ideals], ["Bonds", story.bonds], ["Flaws", story.flaws]] as const).filter(([, v]) => v.length);
    lines.push(...traits.map(([k, v]) => `${k}: ${v.join("; ")}`), `Backstory:\n${story.backstory.split(/\n+/).map(p => `  ${p.trim()}`).filter(p => p.trim()).join("\n")}`);
  }
  return lines.join("\n");
}

const titleSkill = (id: string) => id.replace(/-/g, " ").replace(/\b\w/g, ch => ch.toUpperCase()).replace(/ Of /g, " of ");

/** Uses of a feature (the engine's class resources): Second Wind 2/2, back on a short rest. */
export interface Uses {
  current: number;
  max: number;
  /** "short rest", "long rest", "one back per short rest" (Channel Divinity). */
  recharge?: string;
}

/**
 * The character sheet as data, for a laid-out sheet (src/app/ui/sheet-layout.ts): everything sheetText
 * says, in fields, and what it leaves out (save proficiencies, features and their uses, spell slots
 * spent, what they carry and their purse).
 */
export interface SheetData {
  name: string;
  concept: string;
  species: string;
  background: string;
  classes: Array<{ id: string; name: string; level: number; subclass?: string }>;
  level: number;
  hp: { current: number; max: number; temp: number };
  ac: number;
  /** In feet: walk, and climb or swim if they have them. */
  speeds: Record<string, number>;
  initiative: number;
  proficiency: number;
  hitDice: Array<{ die: number; left: number; total: number }>;
  inspiration: boolean;
  /** Only while they're down. */
  deathSaves?: { successes: number; failures: number; stable: boolean };
  abilities: Array<{ id: Dnd.Ability; name: string; score: number; modifier: number; save: number; proficient: boolean }>;
  skills: Array<{ id: string; name: string; ability: Dnd.Ability; modifier: number; proficiency: string; advantage: boolean; disadvantage: boolean }>;
  /** Passive Perception, Insight and Investigation. */
  passive: Record<string, number>;
  attacks: Array<{ name: string; kind: string; bonus: number; damage: string; type: string; versatile?: string; range?: { normal: number; long: number }; properties: string[]; mastery?: string; held: boolean }>;
  spellcasting?: {
    className: string; ability: Dnd.Ability; saveDC: number; attackBonus: number;
    slots: Array<{ level: number; max: number; used: number }>;
    /** A warlock's: all of one level, back on a short rest. */
    pact?: { level: number; max: number; used: number };
    /** Each with its details, for when it's picked on the sheet: the card, the game's terms at their numbers, the SRD's words (src/rules/spells.ts). */
    spells: Array<{ level: number; spells: Array<{ id: string; name: string; ready: boolean; always: boolean; concentration: boolean; ritual: boolean; details?: SpellDetails }> }>;
  };
  /** Class and subclass features to their level, with what was chosen for them and their uses. */
  features: Array<{ name: string; from: string; level: number; choice?: string; uses?: Uses }>;
  feats: string[];
  /** The species' gifts: darkvision, resistances, a lineage. */
  traits: string[];
  conditions: string[];
  equipment: Array<{ name: string; kind: string; slot?: "in hand" | "off hand" | "worn"; quantity: number }>;
  /** Anything else on them in the story's world (a letter, a key), and what it's in. */
  carrying: Array<{ name: string; quantity: number; in?: string }>;
  purse: Array<{ name: string; quantity: number }>;
  languages: string[];
  proficiencies: { armor: string[]; weapons: string[]; tools: string[] };
  /** Their backstory from character creation, and what it says of them (personality, ideals, bonds, flaws). */
  story?: { backstory: string; personality: string[]; ideals: string[]; bonds: string[]; flaws: string[] };
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
 * The sheet as data (undefined for a session from before the rules engine). In a fight, pass the
 * fight's campaign (its G.campaign) to see the player as the fight has left them so far.
 */
export async function sheetData(state: SessionState, options: { campaign?: string } = {}): Promise<SheetData | undefined> {
  if (!state.rules) return undefined;
  const { E, engine } = await engineFor(state.seed);
  const ctx: Ctx = { E, engine, campaign: loadWellFormed(E, options.campaign ?? state.rules.campaign, engine), apply: e => e };
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

  // What they carry in the story's world (or carried out of the last one), apart from their gear: coins go in the purse.
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
  if (!state.world && !state.carried && !state.history.length) purse.push(...startingPurse().map(p => ({ name: p.name, quantity: p.quantity })));

  const held = new Set([c.equipped.mainHand, c.equipped.offHand].filter(Boolean));
  const attacks = (s.attacks as Array<Dnd.CharacterSheet["attacks"][number] & { weaponInstanceId?: string; versatileDamage?: { dice: string; modifier: number }; range?: { normal: number; long: number }; properties?: string[]; mastery?: string }>)
    .filter((a, i, all) => all.findIndex(b => b.name === a.name) === i)
    .filter(a => (a.weaponInstanceId ? !gone.has(a.weaponInstanceId) : !goneNames.has(a.name)))
    .map(a => ({
      name: a.name, kind: a.attackKind, bonus: a.attackBonus, damage: `${a.damage.dice}${a.damage.modifier ? signed(a.damage.modifier) : ""}`, type: a.damage.type,
      ...(a.versatileDamage ? { versatile: `${a.versatileDamage.dice}${a.versatileDamage.modifier ? signed(a.versatileDamage.modifier) : ""}` } : {}),
      ...(a.range ? { range: a.range } : {}), properties: a.properties ?? [], ...(a.mastery ? { mastery: a.mastery } : {}),
      held: !!a.weaponInstanceId && held.has(a.weaponInstanceId),
    }));

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
          ...(def ? { details: spellDetails(def, caster, namesIn(content)) } : {}),
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
function storyOf(state: SessionState): Pick<SheetData, "story"> {
  const b = state.player.backstory;
  return b?.text.trim() ? { story: { backstory: b.text.trim(), personality: b.personality, ideals: b.ideals, bonds: b.bonds, flaws: b.flaws } } : {};
}

// ---------------------------------------------------------------------------------------------
// Checks and saves.

/** A skill check through the engine (conditions, expertise, Bardic Inspiration and so on apply). */
export async function skillCheck(state: SessionState, skill: Skill, dc: number, advantage?: "advantage" | "disadvantage"): Promise<RollResult> {
  const ctx = await open(state);
  const [rolled] = ctx.apply(ctx.engine.plan.abilityCheck(ctx.campaign.state, { type: "AbilityCheck", characterId: state.rules!.pc, ability: SKILL_ABILITY[skill], skill: engineSkill(skill), dc, ...(advantage ? { advantage } : {}) }).events);
  close(state, ctx);
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

/** A check: through the engine when the session has a sheet, else the concept's modifiers. */
export async function rollFor(state: SessionState, skill: Skill, dc: number): Promise<RollResult> {
  if (state.rules) return skillCheck(state, skill, dc);
  const { rollCheck } = await import("../runtime/dice.ts");
  return rollCheck(rng(state.seed + 7919 * ++state.rollCount), skill, dc, state.player.modifiers[skill] ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Story characters in the rules: stats from an SRD statblock, made the first time they're needed.

/** Default weapons for statblocks whose SRD actions the starter pack doesn't carry as items. */
const STATBLOCK_WEAPON: Record<string, string> = {
  commoner: "club", guard: "spear", "guard-captain": "longsword", tough: "mace", "tough-boss": "warhammer", noble: "rapier",
  spy: "shortsword", bandit: "scimitar", "bandit-captain": "scimitar", "warrior-infantry": "spear", "warrior-veteran": "longsword",
  knight: "greatsword", priest: "mace", "priest-acolyte": "club", mage: "dagger", scout: "shortsword", pirate: "dagger",
  "pirate-captain": "rapier", cultist: "ritual-sickle", "cultist-fanatic": "dagger", mastiff: "mastiff-bite", wolf: "wolf-bite",
};

export interface Outcome {
  /** Dice lines for the player (🎲). */
  lines: string[];
  /** What happened, for the GM to narrate. */
  directive: string;
  /** The player's status after it, when it changed. */
  status?: string;
}

function ensureNpc(ctx: Ctx, state: SessionState, who: Character): string {
  const known = state.rules!.npcs[who.id];
  if (known && ctx.campaign.state.characters[known.id]) return known.id;
  const content = ctx.engine.content;
  const statblockId = who.statblock && content.monsters.has(who.statblock) ? who.statblock : "commoner";
  const sb = content.monsters.get(statblockId)!;
  const weaponId = who.weapon && content.items.has(who.weapon) ? who.weapon : STATBLOCK_WEAPON[statblockId] && content.items.has(STATBLOCK_WEAPON[statblockId]!) ? STATBLOCK_WEAPON[statblockId]! : "club";
  const { E } = ctx;
  const npc = E.CharacterSchema.parse({
    id: E.newCharacterId(), kind: "creature", statblockId, name: who.name, speciesId: "human", backgroundId: "soldier",
    // A level-1 fighter enrolment gives humanoid NPCs the +2 proficiency their statblock attacks assume.
    classes: [{ classId: "fighter", level: 1, hitDiceRemaining: 1 }],
    abilityScores: sb.abilityScores, hp: { current: sb.hp.average, max: sb.hp.average, temp: 0 }, armorClass: sb.ac,
  });
  const weapon = { id: E.newItemInstanceId(), definitionId: weaponId, quantity: 1, attuned: false, identifiedByCharacterIds: [] };
  ctx.apply([event(E, "CharacterCreated", { snapshot: npc }), event(E, "ItemAcquired", { instance: weapon, characterId: npc.id })]);
  try { ctx.apply(ctx.engine.plan.equip(ctx.campaign.state, { characterId: npc.id, instanceId: weapon.id, slot: "mainHand" }).events); } catch { /* natural weapons aren't held */ }
  state.rules!.npcs[who.id] = { id: npc.id, weapon: weapon.id };
  return npc.id;
}

/** The SRD's conditions, which someone is (prone, grappled), as against what a feature gives them (Bardic Inspiration). */
const SRD_CONDITIONS = new Set(["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious", "dodged", "dodging", "raging", "concentrating"]);

/** How someone looks after a hit, in words: the GM narrates it, the player never sees NPC hit points. */
function hurt(c: Dnd.EngineCharacter): string {
  if (c.hp.current <= 0) return "down";
  if (c.hp.current >= c.hp.max) return "unhurt";
  return c.hp.current * 2 <= c.hp.max ? "badly hurt" : "hurt";
}

const possessive = (name: string) => /s$/.test(name) ? `${name}'` : `${name}'s`;

/** A story character as the player knows them: by name once they've heard it, else what they call them. */
const calledBy = (state: SessionState, c: Character) => state.rules?.aliases?.[c.id] ?? c.name;

function nameOf(ctx: Ctx, state: SessionState, id: string): string {
  if (id === state.rules!.pc) return "you";
  // Someone whose name the player hasn't heard goes by what they call them.
  const castId = Object.entries(state.rules!.npcs).find(([, v]) => v.id === id)?.[0];
  return (castId && state.rules!.aliases?.[castId]) || (ctx.campaign.state.characters[id]?.name ?? "someone");
}

/** A damage roll in the engine's DamageRolled: its expression is the base dice ("2d6"), its rolls every die rolled. */
export interface DamageRoll { expression: string; rolls: number[]; modifier: number; type: string }

/**
 * "Damage: 4d6 (3+1+1+6) fire": the dice as many as were rolled, which is more than the expression
 * says on a critical hit (doubled) and for a cantrip that's grown with the caster's level.
 */
export function damageLine(rolls: DamageRoll[]): string {
  const dice = (r: DamageRoll) => {
    const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(r.expression.replace(/\s/g, ""));
    return m && r.rolls.length > Number(m[1]) ? `${r.rolls.length}d${m[2]}${m[3] ?? ""}` : r.expression;
  };
  return `Damage: ${rolls.map(r => `${dice(r)}${r.modifier ? signed(r.modifier) : ""} (${r.rolls.join("+")}${r.modifier ? signed(r.modifier) : ""}) ${r.type}`).join(" + ")}`;
}

/** Dice lines and a plain account of a planner's events. */
function describe(ctx: Ctx, state: SessionState, events: Dnd.EngineEvent[], weaponName: (id: string) => string): { lines: string[]; account: string[] } {
  const lines: string[] = [];
  const account: string[] = [];
  const chars = () => ctx.campaign.state.characters;
  for (const e of events) {
    const who = (k: string) => nameOf(ctx, state, String(e[k]));
    switch (e.type) {
      case "AttackRolled": {
        const d20 = (e["d20"] as number[]).join("/");
        const adv = e["used"] && e["used"] !== "none" ? ` (${e["used"]})` : "";
        const verdict = e["critical"] ? "critical hit!" : e["hit"] ? "hit" : "miss";
        lines.push(`${weaponName(String(e["weaponInstanceId"]))}: ${who("attackerId") === "you" ? "your attack on" : `${possessive(who("attackerId"))} attack on`} ${who("targetId")}: ${d20}${adv} ${signed(Number(e["attackBonus"]))} = ${e["total"]} vs AC ${e["targetAC"]}: ${verdict}`);
        account.push(`${who("attackerId")} ${e["hit"] ? (e["critical"] ? "landed a critical hit on" : "hit") : "missed"} ${who("targetId")} (${weaponName(String(e["weaponInstanceId"]))})`);
        break;
      }
      case "DamageRolled": {
        lines.push(damageLine(e["rolls"] as DamageRoll[]));
        break;
      }
      case "DamageApplied": {
        const amount = (e["components"] as Array<{ amount: number; type: string }>).map(c => `${c.amount} ${c.type}`).join(" and ");
        const target = chars()[String(e["targetId"])];
        const isPc = String(e["targetId"]) === state.rules!.pc;
        // The engine lets hit points run below zero; the story reads 0.
        lines.push(`${isPc ? "You take" : `${target ? who("targetId") : "They"} takes`} ${amount} damage${isPc && target ? ` (HP ${Math.max(0, target.hp.current)}/${target.hp.max})` : target ? ` (${hurt(target)})` : ""}`);
        account.push(`${isPc ? "the player" : target ? who("targetId") : "the target"} took ${amount} damage${target ? `, now ${isPc ? `${Math.max(0, target.hp.current)}/${target.hp.max} HP` : hurt(target)}` : ""}`);
        break;
      }
      case "SaveRolled": {
        const d20 = (e["d20"] as number[]).join("/");
        const target = String(e["targetId"]) === state.rules!.pc ? "Your" : chars()[String(e["targetId"])] ? possessive(who("targetId")) : "Their";
        const ability = ABILITY_NAME[e["ability"] as Dnd.Ability] ?? String(e["ability"]);
        lines.push(`${target} ${ability} save: ${d20} ${signed(Number(e["bonus"]))} = ${e["total"]} vs DC ${e["dc"]}: ${e["success"] ? "saved" : "failed"}`);
        account.push(`${target === "Your" ? "the player's" : target} ${ability} save ${e["success"] ? "succeeded" : "failed"}`);
        break;
      }
      case "ConditionApplied": {
        const condition = ctx.engine.content.conditions.get(String(e["conditionId"]))?.name ?? String(e["conditionId"]);
        if (/active$/i.test(condition)) break;
        const you = who("targetId") === "you";
        // The SRD's conditions are states (prone, grappled), and so are the likes of Blessed and Hasted;
        // the rest are what a feature or a spell gives (Bardic Inspiration, Innate Sorcery, Hunter's Mark).
        if (SRD_CONDITIONS.has(String(e["conditionId"])) || /^\w+(ed|ing)\b|^heroic$/i.test(condition)) {
          lines.push(`${you ? "You are" : `${who("targetId")} is`} ${condition.toLowerCase()}`);
          account.push(`${you ? "the player" : who("targetId")} is now ${condition.toLowerCase()}`);
        } else {
          lines.push(`${you ? "You have" : `${who("targetId")} has`} ${condition}`);
          account.push(`${you ? "the player" : who("targetId")} now has ${condition}`);
        }
        break;
      }
      case "Healed": {
        const target = chars()[String(e["targetId"])];
        lines.push(`${who("targetId") === "you" ? "You regain" : `${who("targetId")} regains`} ${e["amount"]} HP${target && who("targetId") === "you" ? ` (HP ${target.hp.current}/${target.hp.max})` : ""}`);
        account.push(`${who("targetId")} regained ${e["amount"]} HP`);
        break;
      }
      case "ConcentrationStarted":
        account.push("the caster is concentrating on the spell");
        break;
    }
  }
  return { lines: lines.map(l => l.charAt(0).toUpperCase() + l.slice(1)), account };
}

// ---------------------------------------------------------------------------------------------
// Spells.

export interface SpellChoice { id: string; name: string; level: number }

/** What the player can cast right now: cantrips and prepared spells, with a slot to cast them from. */
export async function castable(state: SessionState): Promise<SpellChoice[]> {
  if (!state.rules) return [];
  const { E, engine } = await engineFor(state.seed);
  const ctx: Ctx = { E, engine, campaign: E.loadCampaign(state.rules.campaign, engine), apply: e => e };
  return readySpells(sheetOf(ctx, state.rules.pc));
}

/** A warlock's pact slots (all of one level, back on a short rest), when the sheet has them. */
export function pactOf(sheet: Dnd.CharacterSheet): { level: number; count: number } | undefined {
  const pact = (sheet.spellSlots as { pactSlots?: { level: number; count: number } }).pactSlots;
  return pact?.count ? pact : undefined;
}

/**
 * The slot a spell of this level would be cast from: the lowest free slot at its level or above,
 * else a warlock's pact slot (cast at the pact's level). 0 when there's none left.
 */
export function slotFor(sheet: Dnd.CharacterSheet, me: Dnd.EngineCharacter, level: number): number {
  const free = (l: number) => (sheet.spellSlots.slotsByLevel[l - 1] ?? 0) - (me.spellSlotsUsed[String(l)] ?? 0);
  const slot = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(l => l >= level && free(l) > 0);
  if (slot) return slot;
  const pact = pactOf(sheet);
  return pact && pact.level >= level && pact.count - Number(me["pactSlotsUsed"] ?? 0) > 0 ? pact.level : 0;
}

/** Cantrips plus prepared spells (class, feat and always-prepared), from the derived sheet. */
function readySpells(sheet: Dnd.CharacterSheet): SpellChoice[] {
  return (sheet.spellcasting?.spellsByLevel ?? []).flatMap(g => g.spells.filter(sp => g.level === 0 || sp.prepared || sp.alwaysPrepared)).map(sp => ({ id: sp.spellId, name: sp.name, level: sp.level }));
}

export async function spellInfo(spellId: string): Promise<Dnd.SpellDef | undefined> {
  const { engine } = await engineFor(0);
  return engine.content.spells.get(spellId);
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

/** A spell's details as the sheet shows them when it's picked (src/rules/spells.ts), for a caster at their numbers. */
export async function spellCard(spellId: string, caster?: Caster): Promise<SpellDetails | undefined> {
  const { engine } = await engineFor(0);
  const spell = engine.content.spells.get(spellId);
  return spell && spellDetails(spell, caster, namesIn(engine.content));
}

/**
 * What a spell asks its caster to choose, which the engine won't cast it without: the element
 * (Chromatic Orb, Sorcerous Burst) or the way it works (Command's word, Hex's ability). The one the
 * player's words name (`said`), when they name one; else an element is fire where fire's allowed
 * (it's what the world's things feel), else the first on offer. A way isn't guessed: that would
 * cast it a way the player didn't say (see spellVariants).
 */
export function casterChoice(spell: Dnd.SpellDef, said = ""): { kind: "damageType" | "variant"; value: string } | undefined {
  const named = (keys: string[]) => keys.find(k => [k, ABILITY_NAME[k as Dnd.Ability]].some(w => w && new RegExp(`\\b${w.replace(/-/g, "[- ]").replace(/s\b/g, "'?s")}\\b`, "i").test(said)));
  for (const m of spell.mechanicalEffects ?? []) {
    const allowed = ((m["casterChoosesDamageType"] ?? m["damageTypeChoice"]) as { allowed?: string[] } | undefined)?.allowed;
    if (allowed?.length) return { kind: "damageType", value: named(allowed) ?? (allowed.includes("fire") ? "fire" : allowed[0]!) };
    const way = named(spellVariants(spell) ?? []);
    if (way) return { kind: "variant", value: way };
  }
  return undefined;
}

/** The ways a spell can be cast that its caster must choose between (Command's word, Hex's ability), when it has them. */
export function spellVariants(spell: Dnd.SpellDef): string[] | undefined {
  for (const m of spell.mechanicalEffects ?? []) {
    const variants = (m["casterChoosesVariant"] as { variants?: Array<{ key: string }> } | undefined)?.variants;
    if (variants?.length) return variants.map(v => v.key);
  }
  return undefined;
}

/**
 * Cast one of the player's spells at story characters (or themselves, or nobody in particular).
 * `said`: the player's words, for what the spell asks them to choose (an element, which way).
 */
export async function castSpell(state: SessionState, cast: Character[], spellId: string, targetIds: string[], options: { ritual?: boolean; said?: string } = {}): Promise<Outcome> {
  const ctx = await open(state);
  const pcId = state.rules!.pc;
  const spell = ctx.engine.content.spells.get(spellId);
  const me = ctx.campaign.state.characters[pcId]!;
  const ready = spell && readySpells(sheetOf(ctx, pcId)).some(sp => sp.id === spellId);
  if (!spell || !ready) {
    close(state, ctx);
    const what = spell?.name ?? "that spell";
    return { lines: [`(${what === "that spell" ? "That isn't a spell" : `${what} isn't a spell`} ${state.player.name} has ready: /sheet shows what they have.)`], directive: `The player reached for magic their character doesn't have ready (${what}). It doesn't come: nothing happens beyond a gesture, maybe a fizzle. Say so in a few words, in the fiction, without inventing any effect, and let them choose something else.` };
  }
  // A ritual takes ten minutes longer and no slot (if the spell is one).
  const ritual = options.ritual === true && spell.ritual;
  // What the spell asks its caster to choose (an element, which way), when it asks.
  const choice = casterChoice(spell, options.said);
  const ways = spellVariants(spell);
  if (ways && !choice) {
    close(state, ctx);
    const list = ways.map(w => ABILITY_NAME[w as Dnd.Ability] ?? w.replace(/-/g, " ")).join(", ");
    return { lines: [`(${spell.name} is cast one of ${ways.length} ways: ${list}. Say which.)`], directive: `The player cast ${spell.name} without saying which way it works (${list}). Nothing happens yet and nothing is spent: ask them which, in a few words.` };
  }
  let slotLevel = ritual ? spell.level : 0;
  if (spell.level > 0 && !ritual) {
    slotLevel = slotFor(sheetOf(ctx, pcId), me, spell.level);
    if (!slotLevel) {
      close(state, ctx);
      const pact = !!pactOf(sheetOf(ctx, pcId));
      return { lines: [`(No spell slots left for ${spell.name}: ${pact ? "a short rest restores pact slots" : "a long rest restores them"}.)`], directive: `The player tried to cast ${spell.name}, but their character has no spell slots left for it. The magic doesn't come; show that in a few words and let them do something else.` };
    }
  }
  // Who and what it reaches: an area spell catches everything in its shape (the world knows where
  // things are); otherwise its targets. People go to the engine; things take the rules here.
  const world = state.world;
  let beings = targetIds.filter(t => t === "self" || t === "player" || cast.some(c => c.id === t) || isBeingEntity(world?.entities[t]));
  let things: Entity[] = world ? targetIds.map(t => world.entities[t]).filter((e): e is Entity => !!e && isThingEntity(e)) : [];
  let surfaces: Entity[] = world ? targetIds.map(t => world.entities[t]).filter((e): e is Entity => !!e && e.kind === "surface") : [];
  let area: string | undefined;
  const shape = spell["targeting"] as { shape: string; size: number } | undefined;
  if (world && shape) {
    const aimId = targetIds.find(t => t !== "self" && t !== "player" && world.entities[t]);
    const fromCaster = /^self/i.test(spell.range);
    const { origin, centre } = areaPlacement(world, shape, fromCaster, aimId ? positionOf(world, aimId) : undefined);
    const caught = caughtIn(world, shape.shape, shape.size, origin, centre);
    beings = caught.filter(e => e.kind === "person" || e.kind === "creature").map(e => e.player ? "player" : e.id);
    if (fromCaster) beings = beings.filter(b => b !== "player");
    things = caught.filter(isThingEntity);
    surfaces = caught.filter(e => e.kind === "surface");
    area = `a ${shape.size}-foot ${shape.shape}${aimId ? ` ${fromCaster ? "towards" : "on"} ${state.rules!.aliases?.[aimId] ?? world.entities[aimId]!.name}` : ""}`;
  }
  const people = beings.map(b => b === "self" || b === "player" ? { id: "player", engine: pcId } : (() => {
    const c = cast.find(x => x.id === b) ?? (world?.entities[b] ? bystander(world.entities[b]!) : undefined);
    return c ? { id: b, engine: ensureNpc(ctx, state, c) } : undefined;
  })()).filter((x): x is { id: string; engine: string } => !!x);
  let events: Dnd.EngineEvent[] = [];
  // A zone (Zone of Truth, Silence...) sits somewhere: where it's aimed, or where the caster stands (in 5-foot squares).
  const aimAt = world ? positionOf(world, targetIds.find(t => world.entities[t]) ?? "player") : undefined;
  const targetPosition = aimAt ? { x: Math.round(aimAt.x / 5), y: Math.round(aimAt.y / 5) } : { x: 0, y: 0 };
  // Rays and beams (Scorching Ray, Eldritch Blast) are an attack each, shared out among whoever's aimed at.
  const rays = RAYS[spell.id]?.(slotLevel, sheetOf(ctx, pcId).totalLevel);
  const aimed = rays && people.length ? Array.from({ length: rays }, (_, i) => people[i % people.length]!.engine) : people.map(p => p.engine);
  try {
    events = ctx.apply(missesMiss(ctx.engine.plan.castSpell(ctx.campaign.state, { characterId: pcId, spellId, slotLevel, targetIds: aimed, ...(ritual ? { asRitual: true } : {}), ...((spell.mechanicalEffects ?? []).some(m => /zone/i.test(String(m["kind"]))) || /zone|silence|darkness|fog/i.test(spell.id) ? { targetPosition } : {}), ...(choice ? { casterChoice: choice } : {}) }).events));
  } catch (error) {
    // Aimed only at things: the engine wants a creature, so spend the slot ourselves.
    if (!things.length) {
      close(state, ctx);
      const why = error instanceof Error ? error.message : String(error);
      return { lines: [`(${spell.name} can't be cast like that: ${why})`], directive: `The player tried to cast ${spell.name}, but it can't work that way (${why}). Nothing happens; say so briefly in the fiction.` };
    }
    if (slotLevel) ctx.apply([event(ctx.E, "SpellSlotConsumed", { characterId: pcId, slotLevel })]);
  }
  const { lines, account } = describe(ctx, state, events, () => spell.name);
  // Things: they don't dodge or save; an attack spell still has to hit.
  if (world && things.length) {
    const hit = objectDamage(ctx, state, world, spell, slotLevel, things, choice?.kind === "damageType" ? choice.value : undefined);
    lines.push(...hit.lines);
    account.push(...hit.account);
  }
  // The world's physics: the spell's element meets the surfaces it reached, and some spells make one.
  if (world) {
    const element = String((spell.mechanicalEffects ?? []).find(m => m["damageType"])?.["damageType"] ?? (choice?.kind === "damageType" ? choice.value : ""));
    const physics = [...(element ? elemental(world, surfaces, element, state.turn) : []), ...spellSurface(world, spell.id, targetIds, state.turn)];
    lines.push(...physics);
    account.push(...physics.map(p => p.toLowerCase()));
  }
  if (world) syncBeings(ctx, state, world, people);
  if (events.some(e => /^(ConcentrationStarted|SpellEffectStarted|ConditionApplied)$/.test(e.type))) state.rules!.timed = true;
  const statusText = status(ctx, pcId);
  close(state, ctx);
  const named = [...people.map(p => nameOf(ctx, state, p.engine)), ...things.map(t => t.name)];
  const head = `${spell.name}${ritual ? " (as a ritual: ten minutes, no slot)" : slotLevel ? ` (${ordinal(slotLevel)}-level slot)` : " (cantrip)"}${area ? `: ${area}` : named.length ? ` on ${named.join(", ")}` : ""}`;
  const facts = `${spell.name}: ${spell.level ? `${ordinal(spell.level)}-level` : "cantrip"} ${spell.school}; casting time ${spell.castingTime}; range ${spell.range}; duration ${spell.duration}${spell.concentration ? " (concentration)" : ""}`;
  return {
    lines: [`Cast ${head}${area && named.length ? `, catching ${named.join(", ")}` : ""}`, ...lines, ...(slotLevel && !ritual ? [`${state.player.name}: ${statusText}`] : [])],
    directive: `Rules: the player cast ${head}${area ? `, which caught ${named.join(", ") || "nobody and nothing"}` : ""}. ${account.length ? `${capitalise(account.join("; "))}.` : "It has no roll: it simply takes effect as the spell describes."} Narrate exactly this, in the fiction: what working the spell looks and sounds like here, its effect as the rules describe it (${facts}), and how the people present react to someone casting a spell at all. The world already shows what it burned or broke. Don't add effects the spell doesn't have.`,
    status: statusText,
  };
}

const isThingEntity = (e: Entity) => e.kind === "object" || e.kind === "item" || e.kind === "feature";
/** Someone in the world who isn't the player: a person, or a creature (a goose has hit points too). */
const isBeingEntity = (e: Entity | undefined): e is Entity => !!e && (e.kind === "person" || e.kind === "creature") && !e.player;

/** Spells that make a surface: water from nowhere, a patch of grease. */
function spellSurface(world: SceneWorld, spellId: string, targetIds: string[], turn: number): string[] {
  const aim = targetIds.find(t => world.entities[t]) ?? "player";
  const at = positionOf(world, aim);
  if (!at) return [];
  if (spellId === "create-or-destroy-water") return ["Water pours out of the air", ...spill(world, "water", at, 6, turn).lines];
  if (spellId === "grease") return ["A slick of grease spreads over the floor", ...spill(world, "grease", at, 5, turn).lines];
  return [];
}

/**
 * Where a spell's area sits in a world, as castSpell puts it: it goes out from the caster (the
 * player) towards the aim, a cube from the caster sitting in front of them; anything else centres on
 * the aim (or on the caster, aimed at nothing). The map's aim works it out the same way.
 */
export function areaPlacement(world: SceneWorld, shape: { shape: string; size: number }, fromCaster: boolean, aim?: { x: number; y: number }): { origin: { x: number; y: number }; centre: { x: number; y: number } } {
  const origin = positionOf(world, "player")!;
  const at = aim ?? origin;
  return { origin, centre: fromCaster && shape.shape === "cube" ? towards(origin, at, shape.size / 2) : at };
}

function towards(from: { x: number; y: number }, to: { x: number; y: number }, feet: number) {
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) / d) * feet, y: from.y + ((to.y - from.y) / d) * feet };
}

/** Someone the story brought in who isn't in the cast (a crowd, a passer-by): a commoner, for the rules. */
export function bystander(e: Entity): Character {
  return { id: e.id, name: e.name, look: e.description ?? "", voice: "", wants: "", knows: [], attitude: "", statblock: e.stats?.statblock ?? (e.kind === "creature" ? "mastiff" : "commoner"), ...(e.stats?.weapon ? { weapon: e.stats.weapon } : {}) };
}

/** People's state in the world follows the rules: hurt, badly hurt, down. */
function syncBeings(ctx: Ctx, state: SessionState, world: SceneWorld, people: Array<{ id: string; engine: string }>): void {
  for (const p of people) {
    const e = world.entities[p.id];
    const c = ctx.campaign.state.characters[p.engine];
    if (!e || !c) continue;
    const now = hurt(c);
    const wasDown = e.states.includes("down");
    e.states = [...e.states.filter(s => !["hurt", "badly hurt", "down", "unhurt"].includes(s)), ...(now === "unhurt" ? [] : [now])];
    // Going down leaves blood on the floor; a bad wound bloodies them.
    if (now === "down" && !wasDown) bleed(world, e, state.turn, true);
    else if (now === "badly hurt" && !e.states.includes("bloodied")) bleed(world, e, state.turn, false);
  }
}

function rollDice(expr: string, random: () => number): { total: number; text: string } {
  const m = /^(\d+)d(\d+)\s*([+-]\s*\d+)?$/.exec(expr.trim());
  if (!m) return { total: 0, text: expr };
  const rolls = Array.from({ length: Number(m[1]) }, () => 1 + Math.floor(random() * Number(m[2])));
  const mod = m[3] ? Number(m[3].replace(/\s/g, "")) : 0;
  return { total: Math.max(0, rolls.reduce((a, b) => a + b, 0) + mod), text: `${expr} (${rolls.join("+")}${mod ? signed(mod) : ""})` };
}

/** Spells whose damage adds the caster's spellcasting modifier. */
const ADDS_MODIFIER = new Set(["spiritual-weapon"]);

/** A spell's damage to things: they fail their saves; an attack still rolls against the thing's AC. */
function objectDamage(ctx: Ctx, state: SessionState, world: SceneWorld, spell: Dnd.SpellDef, slotLevel: number, things: Entity[], chosen?: string): { lines: string[]; account: string[] } {
  const lines: string[] = [];
  const account: string[] = [];
  const random = rng(state.seed + 9973 * state.rollCount);
  const effect = (spell.mechanicalEffects ?? []).find(m => m["damageDice"] || m["damageDicePerDart"]);
  if (!effect) return { lines, account };
  const type = String(effect["damageType"] ?? chosen ?? "force");
  const sheet = sheetOf(ctx, state.rules!.pc);
  const level = sheet.totalLevel;
  let dice = String(effect["damageDice"] ?? effect["damageDicePerDart"]);
  const extra = Number(effect["extraDicePerSlotLevel"] ?? 0) * Math.max(0, slotLevel - spell.level);
  const cantripTier = spell.level === 0 && effect["cantripScalingDice"] ? (level >= 17 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0) : 0;
  const m = /^(\d+)d(\d+)(.*)$/.exec(dice);
  if (m && (extra || cantripTier)) dice = `${Number(m[1]) + extra + cantripTier}d${m[2]}${m[3]}`;
  // A spell that adds its caster's modifier to the damage (Spiritual Weapon: 1d8 + it).
  const sc = sheet.spellcasting?.classes[0];
  if (ADDS_MODIFIER.has(spell.id) && sc) { const mod = sheet.abilityModifiers[sc.ability]; if (mod) dice = `${dice}${signed(mod)}`; }
  // One roll for an area (as the rules have it); darts and single targets roll per thing.
  const shared = rollDice(dice, random);
  const attackBonus = sc?.attackBonus ?? 0;
  // Rays and beams are an attack each (Scorching Ray's three, one more a slot above 2nd; Eldritch Blast's by level).
  const rays = RAYS[spell.id]?.(slotLevel, level) ?? 1;
  for (const t of things) {
    if (effect["kind"] === "attack") {
      for (let ray = 1; ray <= rays; ray++) {
        const d20 = 1 + Math.floor(random() * 20);
        const total = d20 + attackBonus;
        const hits = d20 === 20 || (d20 !== 1 && total >= (t.ac ?? 10));
        lines.push(`${spell.name}${rays > 1 ? ` (${ray} of ${rays})` : ""} at ${t.name}: ${d20} ${signed(attackBonus)} = ${total} vs AC ${t.ac ?? 10}: ${hits ? "hit" : "miss"}`);
        if (!hits) { account.push(`${rays > 1 ? `ray ${ray} ` : "it "}missed ${t.name}`); continue; }
        const dmg = rollDice(dice, random);
        lines.push(`Damage: ${dmg.text} ${type}`);
        const out = damageThing(world, t, dmg.total, type, state.turn);
        lines.push(...out);
        account.push(...out.map(o => o.toLowerCase()));
        if (t.states.includes("destroyed")) break;
      }
    } else if (effect["kind"] === "auto-hit") {
      const darts = Number(effect["dartsAtBaseSlot"] ?? 3) + Number(effect["extraDartsPerSlotLevel"] ?? 0) * Math.max(0, slotLevel - spell.level);
      const total = Array.from({ length: darts }, () => rollDice(dice, random).total).reduce((a, b) => a + b, 0);
      lines.push(`${darts} darts at ${t.name}: ${total} ${type}`);
      const out = damageThing(world, t, total, type, state.turn);
      lines.push(...out);
      account.push(...out.map(o => o.toLowerCase()));
    } else {
      const out = damageThing(world, t, shared.total, type, state.turn);
      lines.push(...out);
      account.push(...out.map(o => o.toLowerCase()));
    }
  }
  if (effect["kind"] !== "attack" && effect["kind"] !== "auto-hit") lines.unshift(`Damage to things in it: ${shared.text} ${type} (things don't dodge)`);
  return { lines, account };
}

const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------------------------------------------------------------------------------------------
// Blows: one attack at a time outside a fight on the map.

export interface WeaponChoice { id: string; name: string }

function gearOf(ctx: Ctx, id: string): NonNullable<NonNullable<SessionState["rules"]>["gear"]> {
  const c = ctx.campaign.state.characters[id]!;
  const slotOf = (instance: string) => (Object.entries(c.equipped).find(([slot, v]) => slot !== "attuned" && v === instance)?.[0]) as "mainHand" | "offHand" | "armor" | "shield" | undefined;
  return c.inventory.map(i => ctx.campaign.state.itemInstances[i]).filter((i): i is Dnd.ItemInstance => !!i && i.definitionId !== "unarmed-strike").map(i => {
    const def = ctx.engine.content.items.get(i.definitionId);
    const kind = def?.itemKind === "weapon" ? "weapon" : def?.itemKind === "armor" ? (i.definitionId === "shield" || def?.["armorCategory"] === "shield" ? "shield" : "armor") : "item";
    const slot = slotOf(i.id);
    return { id: i.id, name: def?.name ?? i.definitionId, kind, ...(slot ? { slot } : {}) };
  });
}

/** The story has parted the player from a piece of gear (given, dropped, left behind), or given it back. */
export async function carryGear(state: SessionState, instanceId: string, carried: boolean): Promise<string | undefined> {
  if (!state.rules) return undefined;
  const gone = new Set(state.rules.gone ?? []);
  if (carried === !gone.has(instanceId)) return undefined;
  const ctx = await open(state);
  const pcId = state.rules.pc;
  const me = ctx.campaign.state.characters[pcId]!;
  const name = ctx.engine.content.items.get(ctx.campaign.state.itemInstances[instanceId]?.definitionId ?? "")?.name ?? "that";
  let slot: string | undefined;
  if (carried) gone.delete(instanceId);
  else {
    gone.add(instanceId);
    slot = (Object.entries(me.equipped).find(([s, v]) => s !== "attuned" && v === instanceId)?.[0]);
    if (slot) ctx.apply([event(ctx.E, "ItemUnequipped", { characterId: pcId, slot })]);
  }
  state.rules.gone = [...gone];
  refresh(ctx, state);
  const ac = sheetOf(ctx, pcId).ac.total;
  close(state, ctx);
  // Armour coming off changes your AC; say so.
  const acNote = slot === "armor" || slot === "shield" ? ` (AC now ${ac})` : "";
  return carried ? `You have your ${name.toLowerCase()} again` : `You no longer have your ${name.toLowerCase()}${acNote}`;
}

function weaponsOf(ctx: Ctx, id: string): WeaponChoice[] {
  const state = ctx.campaign.state;
  return state.characters[id]!.inventory.map(i => state.itemInstances[i]).filter((i): i is Dnd.ItemInstance => !!i)
    .filter(i => ctx.engine.content.items.get(i.definitionId)?.itemKind === "weapon")
    .map(i => ({ id: i.id, name: ctx.engine.content.items.get(i.definitionId)?.name ?? i.definitionId }));
}

export async function weapons(state: SessionState): Promise<WeaponChoice[]> {
  if (!state.rules) return [];
  const { E, engine } = await engineFor(state.seed);
  return weaponsOf({ E, engine, campaign: E.loadCampaign(state.rules.campaign, engine), apply: e => e }, state.rules.pc);
}

/** The player attacks a story character with a weapon (instance id; their main weapon when omitted). */
export async function attack(state: SessionState, cast: Character[], targetId: string, weaponId?: string): Promise<Outcome> {
  const ctx = await open(state);
  const pcId = state.rules!.pc;
  const me = ctx.campaign.state.characters[pcId]!;
  // An improvised weapon (a thrown stone, a bottle) isn't their main one: SRD, 1d4 and no proficiency.
  const improvised = weaponId === "improvised";
  const unarmed = me.inventory.find(i => ctx.campaign.state.itemInstances[i]?.definitionId === "unarmed-strike");
  const weapon = improvised ? unarmed : weaponId && me.inventory.includes(weaponId) ? weaponId : me.equipped.mainHand ?? unarmed;
  const thing = state.world?.entities[targetId];
  if (thing && isThingEntity(thing)) {
    // A blow at a thing: the weapon's attack against its armour class, damage to its hit points.
    const name = improvised ? "Improvised weapon" : ctx.engine.content.items.get(ctx.campaign.state.itemInstances[weapon ?? ""]?.definitionId ?? "")?.name ?? "Unarmed Strike";
    const sheet = sheetOf(ctx, pcId);
    const str = sheet.abilityModifiers.STR;
    const atk = improvised ? { attackBonus: str, damage: { dice: "1d4", modifier: str, type: "bludgeoning" } } : sheet.attacks.find(a => a.name === name) ?? sheet.attacks[0]!;
    const random = rng(state.seed + 9973 * state.rollCount);
    const d20 = 1 + Math.floor(random() * 20);
    const total = d20 + atk.attackBonus;
    const hits = d20 === 20 || (d20 !== 1 && total >= (thing.ac ?? 10));
    const lines = [`${name}: your attack on ${thing.name}: ${d20} ${signed(atk.attackBonus)} = ${total} vs AC ${thing.ac ?? 10}: ${hits ? "hit" : "miss"}`];
    const account = [hits ? `the blow lands on ${thing.name}` : `the blow misses ${thing.name}`];
    if (hits) {
      const dmg = rollDice(`${atk.damage.dice}${atk.damage.modifier ? signed(atk.damage.modifier) : ""}`, random);
      lines.push(`Damage: ${dmg.text} ${atk.damage.type}`);
      const out = damageThing(state.world!, thing, dmg.total, atk.damage.type, state.turn);
      lines.push(...out);
      account.push(...out.map(o => o.toLowerCase()));
    }
    close(state, ctx);
    return { lines, directive: `Rules: the player struck at ${thing.name} with ${name.toLowerCase()}. ${capitalise(account.join("; "))}. Narrate exactly that, and let the people present react.` };
  }
  const target = cast.find(c => c.id === targetId) ?? (isBeingEntity(state.world?.entities[targetId]) ? bystander(state.world!.entities[targetId]!) : undefined);
  if (!target) { close(state, ctx); return { lines: [], directive: "" }; }
  const npc = ensureNpc(ctx, state, target);
  const events = ctx.apply(ctx.engine.plan.attack(ctx.campaign.state, { attackerId: pcId, targetId: npc, weaponInstanceId: weapon! }).events);
  const weaponName = (id: string) => improvised ? "Improvised weapon" : ctx.engine.content.items.get(ctx.campaign.state.itemInstances[id]?.definitionId ?? id)?.name ?? "Attack";
  const { lines, account } = describe(ctx, state, events, weaponName);
  const after = ctx.campaign.state.characters[npc]!;
  if (state.world) syncBeings(ctx, state, state.world, [{ id: target.id, engine: npc }]);
  close(state, ctx);
  const down = after.hp.current <= 0 ? ` ${calledBy(state, target)} drops: at 0 hit points they fall, unconscious or dying. If the player plainly meant to kill, they may die; most people here would be knocked senseless. Nobody else in the scene shrugs that off.` : "";
  return {
    lines,
    directive: `Rules: the player attacked ${calledBy(state, target)}. ${capitalise(account.join("; "))}.${down} Narrate exactly this blow and its effect, then let the world answer it: whoever it touches reacts as they truly would. A single blow, not a whole fight: if this becomes a real fight, it will move to the map.`,
  };
}

/** A grab or a shove (2024 rules: the target saves against the player's Strength DC, or is grappled, knocked prone or pushed away). */
export async function wrestle(state: SessionState, cast: Character[], targetId: string, how: "grapple" | "prone" | "push"): Promise<Outcome> {
  const ctx = await open(state);
  const pcId = state.rules!.pc;
  const target = cast.find(c => c.id === targetId) ?? (isBeingEntity(state.world?.entities[targetId]) ? bystander(state.world!.entities[targetId]!) : undefined);
  if (!target) { close(state, ctx); return { lines: [], directive: "" }; }
  const npc = ensureNpc(ctx, state, target);
  let events: Dnd.EngineEvent[];
  try {
    events = ctx.apply(how === "grapple"
      ? ctx.engine.plan.grapple(ctx.campaign.state, { type: "Grapple", attackerId: pcId, targetId: npc }).events
      : ctx.engine.plan.shove(ctx.campaign.state, { type: "Shove", attackerId: pcId, targetId: npc, mode: how }).events);
  } catch (error) {
    close(state, ctx);
    return { lines: [`(${how === "grapple" ? "A grapple" : "A shove"} can't be done like that: ${error instanceof Error ? error.message : String(error)})`], directive: "" };
  }
  const { lines, account } = describe(ctx, state, events, () => "");
  const held = events.some(e => e.type === "ConditionApplied") || events.some(e => e.type === "CreaturePushed");
  if (state.world?.entities[target.id]) {
    const e = state.world.entities[target.id]!;
    if (held && how === "grapple") e.states = [...e.states.filter(s => s !== "grappled"), "grappled"];
    if (held && how === "prone") e.states = [...e.states.filter(s => s !== "prone"), "prone"];
  }
  close(state, ctx);
  const verb = how === "grapple" ? "grab hold of" : how === "prone" ? "shove to the ground" : "shove away";
  return {
    lines: [`${how === "grapple" ? "Grapple" : "Shove"}: you try to ${verb} ${calledBy(state, target)}`, ...lines],
    directive: `Rules: the player tried to ${verb} ${calledBy(state, target)}. ${account.length ? `${capitalise(account.join("; "))}.` : ""} ${held ? (how === "grapple" ? `${calledBy(state, target)} is held fast (grappled) until they break free.` : how === "prone" ? `${calledBy(state, target)} goes down.` : `${calledBy(state, target)} is pushed back five feet.`) : `${calledBy(state, target)} resists it.`} Narrate exactly that, and let the people present react.`,
  };
}

/** Someone the last reply left swinging at the player gets their attack (start of the player's next turn). */
export async function attackOnPlayer(state: SessionState, attacker: Character): Promise<Outcome> {
  const ctx = await open(state);
  const pcId = state.rules!.pc;
  const npc = ensureNpc(ctx, state, attacker);
  const weapon = state.rules!.npcs[attacker.id]!.weapon;
  const events = ctx.apply(ctx.engine.plan.attack(ctx.campaign.state, { attackerId: npc, targetId: pcId, weaponInstanceId: weapon }).events);
  const weaponName = (id: string) => ctx.engine.content.items.get(ctx.campaign.state.itemInstances[id]?.definitionId ?? id)?.name ?? "Attack";
  const { lines, account } = describe(ctx, state, events, weaponName);
  const down = knockedDown(ctx, state);
  const statusText = status(ctx, pcId);
  close(state, ctx);
  return {
    lines: [...lines, ...(events.some(e => e.type === "DamageApplied") ? [`${state.player.name}: ${statusText}`] : [])],
    directive: `Rules, before the player's turn: ${calledBy(state, attacker)}'s attack resolved. ${capitalise(account.join("; "))}.${down} Narrate that first, briefly, then what the player does.`,
    status: statusText,
  };
}

/** Outside a fight on the map, dropping to 0 HP knocks the player out; it doesn't kill them. */
function knockedDown(ctx: Ctx, state: SessionState): string {
  const me = ctx.campaign.state.characters[state.rules!.pc]!;
  if (me.hp.current > 0) return "";
  ctx.apply([event(ctx.E, "Stabilized", { targetId: me.id })]);
  return " The player drops to 0 hit points: they're knocked senseless (unconscious, but stable). The story goes on around them for a moment: someone drags them clear, takes them, or leaves them; they come to soon after with 1 hit point.";
}

const HAZARDS: Record<string, { ability: Dnd.Ability; damage?: string; text: string }> = {
  fall_or_blow: { ability: "DEX", damage: "bludgeoning", text: "a fall, a falling weight or a crushing blow" },
  fire: { ability: "DEX", damage: "fire", text: "fire, scalding or burning" },
  poison: { ability: "CON", damage: "poison", text: "poison, rot or bad air" },
  cold_or_drowning: { ability: "CON", damage: "cold", text: "cold water, drowning or freezing" },
  grab_or_shove: { ability: "STR", text: "being grabbed, pinned, dragged or shoved" },
  mind: { ability: "WIS", text: "fear, a charm, an illusion or something working on the mind" },
};
export const HAZARD_KINDS = Object.fromEntries(Object.entries(HAZARDS).map(([k, v]) => [k, v.text]));

/** A danger the last reply left hanging over the player: a saving throw, with damage on a failure. */
export async function hazard(state: SessionState, kind: string, severity: "glancing" | "serious"): Promise<Outcome> {
  const h = HAZARDS[kind] ?? HAZARDS.fall_or_blow!;
  const dc = severity === "serious" ? 15 : 12;
  const ctx = await open(state);
  const pcId = state.rules!.pc;
  const saved = ctx.apply(ctx.engine.plan.save(ctx.campaign.state, { type: "Save", characterId: pcId, ability: h.ability, dc }).events);
  const { lines, account } = describe(ctx, state, saved, () => "");
  const success = saved.some(e => e.type === "SaveRolled" && e["success"] === true);
  if (!success && h.damage) {
    const dice = severity === "serious" ? 3 : 1;
    const random = rng(state.seed + 104729 * state.rollCount);
    const rolls = Array.from({ length: dice }, () => 1 + Math.floor(random() * 6));
    const amount = rolls.reduce((a, b) => a + b, 0);
    const applied = ctx.apply([event(ctx.E, "DamageApplied", { targetId: pcId, components: [{ amount, type: h.damage }], source: kind })]);
    lines.push(`Damage: ${dice}d6 (${rolls.join("+")}) ${h.damage}`);
    const more = describe(ctx, state, applied, () => "");
    lines.push(...more.lines);
    account.push(...more.account);
  }
  const down = knockedDown(ctx, state);
  const statusText = status(ctx, pcId);
  close(state, ctx);
  return {
    lines,
    directive: `Rules, before the player's turn: the danger hanging over them (${h.text}) resolved with a saving throw: ${account.join("; ")}.${success ? " They avoid the worst of it." : " It catches them."}${down} Narrate that first, briefly, then what the player does.`,
    status: statusText,
  };
}

// ---------------------------------------------------------------------------------------------
// Story time: spells run out.

type EffectInstance = { spellId?: string; durationMinutes?: number };

/** Time passes in the story (about a minute an exchange, longer between scenes): spells with a listed duration end. */
export async function passTime(state: SessionState, minutes: number): Promise<string[]> {
  if (!state.rules?.timed) return [];
  const ctx = await open(state);
  ctx.apply([event(ctx.E, "InGameTimeAdvanced", { minutes, reason: "story time" })]);
  const effects = () => (ctx.campaign.state["effectInstances"] ?? {}) as Record<string, EffectInstance>;
  const before = effects();
  const planned = ctx.engine.plan.expireSpellDurations(ctx.campaign.state, { type: "ExpireSpellDurations" });
  const ended = ctx.apply(Array.isArray(planned) ? planned : planned.events);
  const names = ended.map(e => before[String(e["effectInstanceId"])]?.spellId).filter((id): id is string => !!id).map(id => ctx.engine.content.spells.get(id)?.name ?? id);
  state.rules!.timed = Object.values(effects()).some(e => e.durationMinutes !== undefined);
  close(state, ctx);
  return names.length ? [`${[...new Set(names)].join(", ")} ${names.length === 1 ? "has" : "have"} run out`] : [];
}

// ---------------------------------------------------------------------------------------------
// Rests and levels.

export async function rest(state: SessionState, kind: "short" | "long"): Promise<Outcome> {
  const ctx = await open(state);
  const pcId = state.rules!.pc;
  const lines: string[] = [];
  if (kind === "short") {
    // Spend Hit Dice while they'd still heal most of a die.
    const random = rng(state.seed + 15485863 * state.rollCount);
    for (let i = 0; i < 20; i++) {
      const me = ctx.campaign.state.characters[pcId]!;
      const enrolment = me.classes.find(c => c.hitDiceRemaining > 0);
      const die = Number(ctx.engine.content.classes.get(enrolment?.classId ?? "")?.hitDie ?? 8);
      if (!enrolment || me.hp.max - me.hp.current < die / 2) break;
      const rolled = 1 + Math.floor(random() * die);
      const conMod = Math.floor((me.abilityScores.CON - 10) / 2);
      const healed = Math.max(0, rolled + conMod);
      ctx.apply([event(ctx.E, "HitDieSpent", { characterId: pcId, die, rolled, conMod, healed })]);
      lines.push(`Hit Die: d${die} (${rolled}) ${signed(conMod)} = ${healed} HP`);
    }
    ctx.apply(ctx.engine.plan.shortRest(ctx.campaign.state, { participantIds: [pcId] }).events);
  } else {
    ctx.apply(ctx.engine.plan.longRest(ctx.campaign.state, { participantIds: [pcId] }).events);
  }
  // After a rest you're up and about: nobody rests an hour, or sleeps the night, and stays where they fell.
  const me = ctx.campaign.state.characters[pcId]!;
  for (const a of me.appliedConditions.filter(a => a.conditionId === "prone" || (a.conditionId === "unconscious" && me.hp.current > 0))) ctx.apply([event(ctx.E, "ConditionRemoved", { targetId: pcId, conditionId: a.conditionId })]);
  // The rest takes time: spells with a listed duration run out (Aid doesn't outlast a night).
  ctx.apply([event(ctx.E, "InGameTimeAdvanced", { minutes: kind === "short" ? 60 : 480, reason: `${kind} rest` })]);
  const planned = ctx.engine.plan.expireSpellDurations(ctx.campaign.state, { type: "ExpireSpellDurations" });
  ctx.apply(Array.isArray(planned) ? planned : planned.events);
  state.rules!.timed = Object.values((ctx.campaign.state["effectInstances"] ?? {}) as Record<string, EffectInstance>).some(e => e.durationMinutes !== undefined);
  const statusText = status(ctx, pcId);
  close(state, ctx);
  lines.unshift(`${kind === "short" ? "Short rest (an hour)" : "Long rest (a night)"}: ${statusText}`);
  return {
    lines,
    directive: `Rules: the player takes a ${kind} rest (${kind === "short" ? "an hour or so" : "a night's sleep"}). Afterwards: ${statusText}. Let the time pass in the fiction, briefly, and show what the world did meanwhile.`,
    status: statusText,
  };
}

/** A milestone: one level in the player's main class, choices made by the engine's defaults. */
export async function levelUp(state: SessionState): Promise<string[]> {
  if (!state.rules) return [];
  const ctx = await open(state);
  const pcId = state.rules.pc;
  const before = ctx.campaign.state.characters[pcId]!;
  const main = [...before.classes].sort((a, b) => b.level - a.level)[0]!;
  const maxBefore = sheetOf(ctx, pcId).effectiveHpMax;
  try {
    ctx.apply(ctx.engine.plan.levelUp(ctx.campaign.state, { characterId: pcId, classId: main.classId, hpStrategy: "average" }).events);
    const picked = resolveChoices(ctx, pcId, state.rules.prefer ?? []);
    grantResources(ctx, pcId);
    const sheet = sheetOf(ctx, pcId);
    refresh(ctx, state);
    close(state, ctx);
    return [`Level up! ${state.player.name} is now ${state.player.build}. HP max ${maxBefore} → ${sheet.effectiveHpMax}.${picked.length ? ` Choices: ${picked.join("; ")}.` : ""}`];
  } catch (error) {
    close(state, ctx);
    return [`(Level up failed: ${error instanceof Error ? error.message : String(error)})`];
  }
}

/**
 * A dropped player comes to with 1 HP at the next scene (or the smelling salts): out cold, and
 * lying where they fell, are both over. Someone merely knocked over is back on their feet by then,
 * without a word about it.
 */
export async function comeTo(state: SessionState): Promise<string | undefined> {
  if (!state.rules) return undefined;
  const ctx = await open(state);
  const me = ctx.campaign.state.characters[state.rules.pc]!;
  const down = me.hp.current <= 0;
  // (The engine lets hit points run below zero, and healing starts from 0: this is 1 HP.)
  if (down) ctx.apply([event(ctx.E, "Healed", { targetId: me.id, amount: 1, source: "came-to" })]);
  for (const a of ctx.campaign.state.characters[me.id]!.appliedConditions.filter(a => a.conditionId === "prone" || (down && a.conditionId === "unconscious"))) ctx.apply([event(ctx.E, "ConditionRemoved", { targetId: me.id, conditionId: a.conditionId })]);
  const line = down ? `You come to: ${status(ctx, me.id)}` : undefined;
  close(state, ctx);
  return line;
}

// ---------------------------------------------------------------------------------------------
// Moving: one jump, the same in a scene, on the map and in a fight.

export interface JumpReach { long: number; standingLong: number; high: number; standingHigh: number }

/** SRD jumping: a long jump covers your Strength score in feet after a 10-foot run-up, half that standing; a high jump 3 + your Strength modifier, half standing. */
export function jumpReachFor(strength: number): JumpReach {
  const high = Math.max(0, 3 + Math.floor((strength - 10) / 2));
  return { long: strength, standingLong: Math.floor(strength / 2), high, standingHigh: Math.floor(high / 2) };
}

export async function jumpReach(state: SessionState): Promise<JumpReach> {
  if (!state.rules) return jumpReachFor(10);
  const { E, engine } = await engineFor(state.seed);
  const ctx: Ctx = { E, engine, campaign: E.loadCampaign(state.rules.campaign, engine), apply: e => e };
  return jumpReachFor(sheetOf(ctx, state.rules.pc).abilityScores.STR);
}

export interface Jump {
  feet: number;
  high?: boolean;
  /** At least 10 feet on foot first. */
  runUp?: boolean;
  /** What falling short means: the drop into whatever is between, in feet (0 for a puddle, a table). */
  drop?: number;
}
export interface JumpOutcome { made: boolean; reach: number; roll?: RollResult; lines: string[]; account: string; status?: string }

/**
 * A jump: within reach it simply happens (no dice); up to half as far again takes Strength
 * (Athletics) at DC 10 plus a point for every foot over; farther than that falls short. Falling
 * short with a drop beneath is a fall (1d6 bludgeoning per 10 feet, prone).
 */
export async function jump(state: SessionState, j: Jump): Promise<JumpOutcome> {
  const reachOf = await jumpReach(state);
  const reach = j.high ? (j.runUp ? reachOf.high : reachOf.standingHigh) : (j.runUp ? reachOf.long : reachOf.standingLong);
  const what = `${j.high ? "a high jump" : "a long jump"} of ${j.feet} ft (${j.runUp ? "with a run-up" : "standing"}: ${reach} ft is easy)`;
  if (j.feet <= reach) return { made: true, reach, lines: [`Jump: ${what}: made`], account: `the jump was within their reach (${reach} ft), so they make it` };
  const over = j.feet - reach;
  let roll: RollResult | undefined;
  let made = false;
  if (over * 2 <= reach) {
    roll = await rollFor(state, "athletics", 10 + over);
    made = roll.success;
  }
  const lines = [`Jump: ${what}${roll ? "" : ": too far"}`, ...(roll ? [describeRoll(roll)] : [])];
  if (made) return { made, reach, ...(roll ? { roll } : {}), lines, account: `they make it, just (Athletics ${roll!.total} against DC ${roll!.dc})` };
  const short = roll ? `they fall short (Athletics ${roll.total} against DC ${roll.dc})` : `it was beyond them (${j.feet} ft against a reach of ${reach} ft), and they fall short`;
  if (!state.rules || !j.drop) return { made, reach, ...(roll ? { roll } : {}), lines, account: short };
  const ctx = await open(state);
  const pcId = state.rules.pc;
  // The engine's own fall: 1d6 bludgeoning per 10 feet (at most 20d6), landing prone.
  const events = ctx.apply((ctx.engine.plan["falling"] as (s: Dnd.CampaignState, i: unknown) => Dnd.PlanResult)(ctx.campaign.state, { type: "Falling", characterId: pcId, distanceFeet: j.drop }).events);
  // A fall that hurts lands you prone (the engine's fall leaves that to us).
  if (events.some(e => e.type === "DamageApplied") && !events.some(e => e.type === "ConditionApplied" && e["conditionId"] === "prone"))
    events.push(...ctx.apply([event(ctx.E, "ConditionApplied", { targetId: pcId, conditionId: "prone", appliedConditionId: ctx.E.newEventId() })]));
  const { lines: more, account } = describe(ctx, state, events, () => "");
  const statusText = status(ctx, pcId);
  const down = knockedDown(ctx, state);
  close(state, ctx);
  return { made, reach, ...(roll ? { roll } : {}), lines: [...lines, `Fall: ${j.drop} ft`, ...more], account: `${short}, and fall ${j.drop} ft${account.length ? `: ${account.join("; ")}` : " unhurt"}${down}`, status: statusText };
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

function featuresOf(ctx: Ctx, id: string): NonNullable<NonNullable<SessionState["rules"]>["features"]> {
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

/** The class features with uses that the rules can resolve, in the order a menu lists them. */
export const FEATURE_IDS = FEATURES.map(f => f.id);

/** A class feature, through the engine's own intent for it (uses, rests and all). */
export async function useFeature(state: SessionState, cast: Character[], featureId: string, targetId?: string): Promise<Outcome> {
  const feature = FEATURES.find(f => f.id === featureId);
  if (!feature) return { lines: [], directive: "" };
  const ctx = await open(state);
  const pcId = state.rules!.pc;
  const onSelf = !targetId || targetId === "self" || targetId === "player";
  const who = feature.target === "creature" && !onSelf ? cast.find(c => c.id === targetId) ?? (isBeingEntity(state.world?.entities[targetId!]) ? bystander(state.world!.entities[targetId!]!) : undefined) : undefined;
  if (feature.target === "creature" && !who && !feature.self) { close(state, ctx); return { lines: [`(${feature.name} needs someone to give it to.)`], directive: "" }; }
  let events: Dnd.EngineEvent[];
  try {
    const intent = feature.intent(ctx.E, pcId, who ? ensureNpc(ctx, state, who) : undefined, ctx.campaign.state);
    const method = intent.type.charAt(0).toLowerCase() + intent.type.slice(1);
    events = ctx.apply((ctx.engine.plan[method] as (s: Dnd.CampaignState, i: unknown) => Dnd.PlanResult)(ctx.campaign.state, intent).events);
  } catch (error) {
    close(state, ctx);
    const why = error instanceof Error ? error.message : String(error);
    return { lines: [`(${feature.name}: ${why})`], directive: `The player reached for ${feature.name}, but it isn't there to use (${why}). Nothing comes of it; say so in a few words, in the fiction.` };
  }
  const { lines, account } = describe(ctx, state, events, () => feature.name);
  const statusText = status(ctx, pcId);
  if (events.some(e => /^(ConditionApplied|EffectStarted)$/.test(e.type))) state.rules!.timed = true;
  if (who && state.world && state.rules!.npcs[who.id]) syncBeings(ctx, state, state.world, [{ id: who.id, engine: state.rules!.npcs[who.id]!.id }]);
  close(state, ctx);
  return {
    lines: [`${feature.name}${who ? ` for ${calledBy(state, who)}` : ""}`, ...lines, `${state.player.name}: ${statusText}`],
    directive: `Rules: the player used ${feature.name}${who ? ` on ${calledBy(state, who)}` : ""}. ${account.length ? `${capitalise(account.join("; "))}.` : "It takes effect as the feature describes."} Narrate exactly that, in the fiction, briefly.`,
    status: statusText,
  };
}

/**
 * Arcane Recovery (a wizard, with a short rest, once a day): spent slots back, as many levels'
 * worth as the feature has points left (half the wizard's level, rounded up), the highest first and
 * none above 5th. The rest itself is rest()'s.
 */
export async function arcaneRecovery(state: SessionState): Promise<Outcome> {
  const ctx = await open(state);
  const pcId = state.rules!.pc;
  const me = ctx.campaign.state.characters[pcId]!;
  const points = resourceLeft(ctx.campaign.state, pcId, "arcane-recovery-points");
  const spent = Object.entries(me.spellSlotsUsed).map(([l, n]) => ({ level: Number(l), n })).filter(s => s.n > 0 && s.level <= 5).sort((a, b) => b.level - a.level);
  const regained: Array<{ level: number; count: number }> = [];
  let left = points;
  for (const s of spent) {
    const count = Math.min(s.n, Math.floor(left / s.level));
    if (count > 0) { regained.push({ level: s.level, count }); left -= count * s.level; }
  }
  if (!regained.length) {
    close(state, ctx);
    return { lines: [points ? "(Arcane Recovery: no spent slot it could bring back.)" : "(Arcane Recovery is used: it comes back with a long rest.)"], directive: "" };
  }
  ctx.apply([event(ctx.E, "ResourceSpent", { characterId: pcId, resourceId: "arcane-recovery-points", amount: points - left }),
    ...regained.map(r => event(ctx.E, "SpellSlotsRegained", { characterId: pcId, slotLevel: r.level, count: r.count, source: "arcane-recovery" }))]);
  const statusText = status(ctx, pcId);
  close(state, ctx);
  const what = regained.map(r => `${r.count} ${ordinal(r.level)}-level slot${r.count > 1 ? "s" : ""}`).join(" and ");
  return { lines: [`Arcane Recovery: ${what} back`, `${state.player.name}: ${statusText}`], directive: `Rules: the player used Arcane Recovery and got back ${what}. Narrate it briefly.`, status: statusText };
}

/** Something the player carries that's used up (a potion), by the engine's own rule for it. */
export async function useItem(state: SessionState, instanceId: string): Promise<Outcome> {
  const ctx = await open(state);
  const pcId = state.rules!.pc;
  const def = ctx.engine.content.items.get(ctx.campaign.state.itemInstances[instanceId]?.definitionId ?? "");
  let events: Dnd.EngineEvent[];
  try {
    events = ctx.apply((ctx.engine.plan["consumeItem"] as (s: Dnd.CampaignState, i: unknown) => Dnd.PlanResult)(ctx.campaign.state, { characterId: pcId, instanceId }).events);
  } catch (error) {
    close(state, ctx);
    return { lines: [`(${def?.name ?? "That"}: ${error instanceof Error ? error.message : String(error)})`], directive: "" };
  }
  const { lines, account } = describe(ctx, state, events, () => def?.name ?? "it");
  refresh(ctx, state);
  const statusText = status(ctx, pcId);
  close(state, ctx);
  return {
    lines: [`${def?.name ?? "It"}: used`, ...lines, `${state.player.name}: ${statusText}`],
    directive: `Rules: the player used ${def?.name ?? "something they carry"}. ${account.length ? `${capitalise(account.join("; "))}.` : "It takes effect as it says."} Narrate it briefly.`,
    status: statusText,
  };
}

export { ABILITY_NAME };
