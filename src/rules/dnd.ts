import { readFileSync } from "node:fs";
import type * as Dnd from "../../vendor/dnd-srd-engine/dnd-srd-engine.js";
import { respondJson } from "../llm/openrouter.ts";
import { describeRoll, rng, type RollResult } from "../runtime/dice.ts";
import { SKILLS, type Character, type Skill } from "../runtime/scene.ts";
import type { SessionState } from "../runtime/session.ts";
import { caughtIn, damageThing, heldBy, positionOf, type Entity, type SceneWorld } from "../world/scene-world.ts";
import { bleed, elemental, spill } from "../world/systems.ts";

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
    const E = await import(new URL("dnd-srd-engine.js", VENDOR).href) as typeof Dnd;
    loaded = { E, pack: JSON.parse(readFileSync(new URL("starter-pack.json", VENDOR), "utf8")) };
  }
  return loaded;
}

interface Ctx { E: typeof Dnd; engine: Dnd.Engine; campaign: Dnd.Campaign; apply(events: Dnd.EngineEvent[]): Dnd.EngineEvent[] }

async function engineFor(seed: number) {
  const { E, pack } = await dnd();
  return { E, engine: E.createEngine({ contentPacks: [pack], rng: E.seededRNG(seed) }) };
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
const CASTING: Record<string, { cantrips: number; prepared: (level: number) => number; maxSpell: (level: number) => number }> = {
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
}

async function chooseBuild(concept: string, level: number, content: Dnd.Content): Promise<Build> {
  const list = (m: Map<string, Dnd.Named>) => [...m.values()].map(v => `${v.id} (${v.name})`).join(", ");
  const maxSpell = Math.min(9, Math.ceil(level / 2));
  const spells = [...content.spells.values()].filter(s => s.level <= maxSpell).sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))
    .map(s => `${s.id} [${s.level ? `level ${s.level}` : "cantrip"}; ${s.classes.join(" ")}]`).join("\n");
  const feats = [...content.feats.values()].filter(f => f["category"] === "origin").map(f => f.id).join(", ");
  const build = await respondJson<Build>({
    operation: "rules.build", effort: "low",
    instructions: `You turn a tabletop character concept into a D&D (2024 rules, SRD 5.2.1) build for a level ${level} character. Choose what fits who they are and how they'd go about things, not what's strongest: a palace inspector might be a rogue (Investigation, Insight), a hedge witch a druid, a brawling ex-soldier a fighter, a silver-tongued con artist a bard. Use only ids from the lists. Spells must be on the class's list (ids marked with the class): give cantrips and levelled spells that suit the concept, including some useful outside a fight. Weapons and armour are what they'd carry; armour "none" if they wouldn't wear any.`,
    input: [{ role: "user", content: [
      `Character concept: ${concept}`,
      `Classes: ${list(content.classes)}`, `Subclasses: ${list(content.subclasses)}`, `Species: ${list(content.species)}`, `Backgrounds: ${list(content.backgrounds)}`,
      `Origin feats: ${feats}`, `Skills: ${SKILLS.map(engineSkill).join(", ")}`, `Abilities: ${ABILITIES.join(", ")}`,
      `Weapons: ${WEAPONS.join(", ")}`, `Armour: none, ${Object.values(ARMOR).flat().join(", ")}`, `Spells (id [level; classes]):\n${spells}`,
    ].join("\n\n") }],
    json: { name: "build", schema: { type: "object", additionalProperties: false, required: ["classId", "subclassId", "speciesId", "backgroundId", "abilities", "skills", "feat", "cantrips", "spells", "weapons", "armor", "shield"], properties: {
      classId: { type: "string" }, subclassId: { type: "string" }, speciesId: { type: "string" }, backgroundId: { type: "string" },
      abilities: { type: "array", items: { type: "string" }, description: "All six abilities, most important first" },
      skills: { type: "array", items: { type: "string" }, description: "Skills they'd be trained in, most characteristic first (up to 6)" },
      feat: { type: "string", description: "One origin feat" },
      cantrips: { type: "array", items: { type: "string" } }, spells: { type: "array", items: { type: "string" } },
      weapons: { type: "array", items: { type: "string" }, description: "One to three weapons, main weapon first" },
      armor: { type: "string" }, shield: { type: "boolean" },
    } } },
  });
  return build;
}

/** A legal build from whatever the model suggested: unknown ids fall back to the class's defaults. */
function settleBuild(raw: Partial<Build>, level: number, content: Dnd.Content): Build {
  const classId = raw.classId && content.classes.has(raw.classId) ? raw.classId : "rogue";
  const cls = content.classes.get(classId)!;
  const kit = KITS[classId] ?? KITS.rogue!;
  const casting = CASTING[classId];
  const onList = (id: string, levels: (l: number) => boolean) => { const s = content.spells.get(id); return !!s && s.classes.includes(classId) && levels(s.level); };
  const pickSpells = (wanted: string[] | undefined, levels: (l: number) => boolean, count: number) => {
    const chosen = [...new Set((wanted ?? []).filter(id => onList(id, levels)))].slice(0, count);
    for (const s of [...content.spells.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (chosen.length >= count) break;
      if (onList(s.id, levels) && !chosen.includes(s.id)) chosen.push(s.id);
    }
    return chosen;
  };
  const armorProf = (cls["armorProficiencies"] as string[] | undefined) ?? [];
  const armorOk = (id: string) => Object.entries(ARMOR).some(([kind, ids]) => ids.includes(id) && armorProf.some(p => p.toLowerCase().includes(kind)));
  const abilities = [...new Set([...(raw.abilities ?? []).map(a => a.toUpperCase()).filter(a => ABILITIES.includes(a as Dnd.Ability)), ...ABILITIES])];
  return {
    classId,
    subclassId: raw.subclassId && content.subclasses.has(raw.subclassId) ? raw.subclassId : "",
    speciesId: raw.speciesId && content.species.has(raw.speciesId) ? raw.speciesId : "human",
    backgroundId: raw.backgroundId && content.backgrounds.has(raw.backgroundId) ? raw.backgroundId : "criminal",
    abilities,
    skills: (raw.skills ?? []).map(s => s.toLowerCase().replace(/[ _]/g, "-")),
    feat: raw.feat && content.feats.has(raw.feat) ? raw.feat : "alert",
    cantrips: casting ? pickSpells(raw.cantrips, l => l === 0, casting.cantrips) : [],
    spells: casting ? pickSpells(raw.spells, l => l >= 1 && l <= casting.maxSpell(level), casting.prepared(level)) : [],
    weapons: [...new Set((raw.weapons ?? []).filter(w => WEAPONS.includes(w)))].slice(0, 3).concat(raw.weapons?.some(w => WEAPONS.includes(w)) ? [] : kit.weapons),
    armor: raw.armor && raw.armor !== "none" && armorOk(raw.armor) ? raw.armor : raw.armor === "none" ? "none" : kit.armor,
    shield: (raw.shield ?? kit.shield) && armorProf.some(p => p.toLowerCase().includes("shield")),
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
  const build = settleBuild(raw, level, content);
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
  const prefer = [...build.skills, build.feat, build.subclassId, ...build.cantrips, ...build.spells, "medium", "ability-score-improvement",
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
  return [`HP ${c.hp.current}/${sheet.effectiveHpMax}${c.hp.temp ? ` (+${c.hp.temp} temp)` : ""}`, slots ? `spell slots ${slots}` : "", ...conditions].filter(Boolean).join(", ");
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
  return lines.join("\n");
}

const titleSkill = (id: string) => id.replace(/-/g, " ").replace(/\b\w/g, ch => ch.toUpperCase()).replace(/ Of /g, " of ");

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
        const rolls = (e["rolls"] as Array<{ expression: string; rolls: number[]; modifier: number; type: string }>);
        lines.push(`Damage: ${rolls.map(r => `${r.expression}${r.modifier ? signed(r.modifier) : ""} (${r.rolls.join("+")}${r.modifier ? signed(r.modifier) : ""}) ${r.type}`).join(" + ")}`);
        break;
      }
      case "DamageApplied": {
        const amount = (e["components"] as Array<{ amount: number; type: string }>).map(c => `${c.amount} ${c.type}`).join(" and ");
        const target = chars()[String(e["targetId"])];
        const isPc = String(e["targetId"]) === state.rules!.pc;
        lines.push(`${isPc ? "You take" : `${target ? who("targetId") : "They"} takes`} ${amount} damage${isPc && target ? ` (HP ${target.hp.current}/${target.hp.max})` : target ? ` (${hurt(target)})` : ""}`);
        account.push(`${isPc ? "the player" : target ? who("targetId") : "the target"} took ${amount} damage${target ? `, now ${isPc ? `${target.hp.current}/${target.hp.max} HP` : hurt(target)}` : ""}`);
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
        lines.push(`${who("targetId") === "you" ? "You are" : `${who("targetId")} is`} ${condition.toLowerCase()}`);
        account.push(`${who("targetId") === "you" ? "the player" : who("targetId")} is now ${condition.toLowerCase()}`);
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

/** Cantrips plus prepared spells (class, feat and always-prepared), from the derived sheet. */
function readySpells(sheet: Dnd.CharacterSheet): SpellChoice[] {
  return (sheet.spellcasting?.spellsByLevel ?? []).flatMap(g => g.spells.filter(sp => g.level === 0 || sp.prepared || sp.alwaysPrepared)).map(sp => ({ id: sp.spellId, name: sp.name, level: sp.level }));
}

export async function spellInfo(spellId: string): Promise<Dnd.SpellDef | undefined> {
  const { engine } = await engineFor(0);
  return engine.content.spells.get(spellId);
}

/** Cast one of the player's spells at story characters (or themselves, or nobody in particular). */
export async function castSpell(state: SessionState, cast: Character[], spellId: string, targetIds: string[], options: { ritual?: boolean } = {}): Promise<Outcome> {
  const ctx = await open(state);
  const pcId = state.rules!.pc;
  const spell = ctx.engine.content.spells.get(spellId);
  const me = ctx.campaign.state.characters[pcId]!;
  const ready = spell && readySpells(sheetOf(ctx, pcId)).some(sp => sp.id === spellId);
  if (!spell || !ready) {
    close(state, ctx);
    const what = spell?.name ?? "that spell";
    return { lines: [`(${what === "that spell" ? "That isn't a spell" : `${what} isn't a spell`} ${state.player.name} has ready: #sheet shows what they have.)`], directive: `The player reached for magic their character doesn't have ready (${what}). It doesn't come: nothing happens beyond a gesture, maybe a fizzle. Say so in a few words, in the fiction, without inventing any effect, and let them choose something else.` };
  }
  // A ritual takes ten minutes longer and no slot (if the spell is one).
  const ritual = options.ritual === true && spell.ritual;
  let slotLevel = ritual ? spell.level : 0;
  if (spell.level > 0 && !ritual) {
    const sheet = sheetOf(ctx, pcId);
    const free = (l: number) => (sheet.spellSlots.slotsByLevel[l - 1] ?? 0) - (me.spellSlotsUsed[String(l)] ?? 0);
    slotLevel = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(l => l >= spell.level && free(l) > 0) ?? 0;
    if (!slotLevel) {
      close(state, ctx);
      return { lines: [`(No spell slots left for ${spell.name}: a long rest restores them.)`], directive: `The player tried to cast ${spell.name}, but their character has no spell slots left for it. The magic doesn't come; show that in a few words and let them do something else.` };
    }
  }
  // Who and what it reaches: an area spell catches everything in its shape (the world knows where
  // things are); otherwise its targets. People go to the engine; things take the rules here.
  const world = state.world;
  let beings = targetIds.filter(t => t === "self" || t === "player" || cast.some(c => c.id === t) || (world?.entities[t]?.kind === "person" && !world.entities[t]!.player));
  let things: Entity[] = world ? targetIds.map(t => world.entities[t]).filter((e): e is Entity => !!e && isThingEntity(e)) : [];
  let surfaces: Entity[] = world ? targetIds.map(t => world.entities[t]).filter((e): e is Entity => !!e && e.kind === "surface") : [];
  let area: string | undefined;
  const shape = spell["targeting"] as { shape: string; size: number } | undefined;
  if (world && shape) {
    const origin = positionOf(world, "player")!;
    const aimId = targetIds.find(t => t !== "self" && t !== "player" && world.entities[t]);
    const aim = aimId ? positionOf(world, aimId)! : origin;
    // A cube from the caster sits in front of them, towards where they aim.
    const fromCaster = /^self/i.test(spell.range);
    const centre = fromCaster && shape.shape === "cube" ? towards(origin, aim, shape.size / 2) : aim;
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
  try {
    events = ctx.apply(missesMiss(ctx.engine.plan.castSpell(ctx.campaign.state, { characterId: pcId, spellId, slotLevel, targetIds: people.map(p => p.engine), ...(ritual ? { asRitual: true } : {}), ...((spell.mechanicalEffects ?? []).some(m => /zone/i.test(String(m["kind"]))) || /zone|silence|darkness|fog/i.test(spell.id) ? { targetPosition } : {}) }).events));
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
    const hit = objectDamage(ctx, state, world, spell, slotLevel, things);
    lines.push(...hit.lines);
    account.push(...hit.account);
  }
  // The world's physics: the spell's element meets the surfaces it reached, and some spells make one.
  if (world) {
    const element = String((spell.mechanicalEffects ?? []).find(m => m["damageType"])?.["damageType"] ?? "");
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

/** Spells that make a surface: water from nowhere, a patch of grease. */
function spellSurface(world: SceneWorld, spellId: string, targetIds: string[], turn: number): string[] {
  const aim = targetIds.find(t => world.entities[t]) ?? "player";
  const at = positionOf(world, aim);
  if (!at) return [];
  if (spellId === "create-or-destroy-water") return ["Water pours out of the air", ...spill(world, "water", at, 6, turn).lines];
  if (spellId === "grease") return ["A slick of grease spreads over the floor", ...spill(world, "grease", at, 5, turn).lines];
  return [];
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

/** A spell's damage to things: they fail their saves; an attack still rolls against the thing's AC. */
function objectDamage(ctx: Ctx, state: SessionState, world: SceneWorld, spell: Dnd.SpellDef, slotLevel: number, things: Entity[]): { lines: string[]; account: string[] } {
  const lines: string[] = [];
  const account: string[] = [];
  const random = rng(state.seed + 9973 * state.rollCount);
  const effect = (spell.mechanicalEffects ?? []).find(m => m["damageDice"] || m["damageDicePerDart"]);
  if (!effect) return { lines, account };
  const type = String(effect["damageType"] ?? "force");
  const sheet = sheetOf(ctx, state.rules!.pc);
  const level = sheet.totalLevel;
  let dice = String(effect["damageDice"] ?? effect["damageDicePerDart"]);
  const extra = Number(effect["extraDicePerSlotLevel"] ?? 0) * Math.max(0, slotLevel - spell.level);
  const cantripTier = spell.level === 0 && effect["cantripScalingDice"] ? (level >= 17 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0) : 0;
  const m = /^(\d+)d(\d+)(.*)$/.exec(dice);
  if (m && (extra || cantripTier)) dice = `${Number(m[1]) + extra + cantripTier}d${m[2]}${m[3]}`;
  // One roll for an area (as the rules have it); darts and single targets roll per thing.
  const shared = rollDice(dice, random);
  const attackBonus = sheet.spellcasting?.classes[0]?.attackBonus ?? 0;
  for (const t of things) {
    if (effect["kind"] === "attack") {
      const d20 = 1 + Math.floor(random() * 20);
      const total = d20 + attackBonus;
      const hits = d20 === 20 || (d20 !== 1 && total >= (t.ac ?? 10));
      lines.push(`${spell.name} at ${t.name}: ${d20} ${signed(attackBonus)} = ${total} vs AC ${t.ac ?? 10}: ${hits ? "hit" : "miss"}`);
      if (!hits) { account.push(`it missed ${t.name}`); continue; }
      const dmg = rollDice(dice, random);
      lines.push(`Damage: ${dmg.text} ${type}`);
      const out = damageThing(world, t, dmg.total, type, state.turn);
      lines.push(...out);
      account.push(...out.map(o => o.toLowerCase()));
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
  const weapon = weaponId && me.inventory.includes(weaponId) ? weaponId : me.equipped.mainHand ?? me.inventory.find(i => ctx.campaign.state.itemInstances[i]?.definitionId === "unarmed-strike");
  const thing = state.world?.entities[targetId];
  if (thing && isThingEntity(thing)) {
    // A blow at a thing: the weapon's attack against its armour class, damage to its hit points.
    const name = ctx.engine.content.items.get(ctx.campaign.state.itemInstances[weapon ?? ""]?.definitionId ?? "")?.name ?? "Unarmed Strike";
    const sheet = sheetOf(ctx, pcId);
    const atk = sheet.attacks.find(a => a.name === name) ?? sheet.attacks[0]!;
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
  const target = cast.find(c => c.id === targetId) ?? (state.world?.entities[targetId]?.kind === "person" ? bystander(state.world.entities[targetId]!) : undefined);
  if (!target) { close(state, ctx); return { lines: [], directive: "" }; }
  const npc = ensureNpc(ctx, state, target);
  const events = ctx.apply(ctx.engine.plan.attack(ctx.campaign.state, { attackerId: pcId, targetId: npc, weaponInstanceId: weapon! }).events);
  const weaponName = (id: string) => ctx.engine.content.items.get(ctx.campaign.state.itemInstances[id]?.definitionId ?? id)?.name ?? "Attack";
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
  const target = cast.find(c => c.id === targetId) ?? (state.world?.entities[targetId]?.kind === "person" ? bystander(state.world.entities[targetId]!) : undefined);
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

/** A dropped player comes to with 1 HP at the next scene. */
export async function comeTo(state: SessionState): Promise<string | undefined> {
  if (!state.rules) return undefined;
  const ctx = await open(state);
  const me = ctx.campaign.state.characters[state.rules.pc]!;
  if (me.hp.current > 0) { close(state, ctx); return undefined; }
  ctx.apply([event(ctx.E, "Healed", { targetId: me.id, amount: 1, source: "came-to" })]);
  for (const a of ctx.campaign.state.characters[me.id]!.appliedConditions.filter(a => a.conditionId === "unconscious")) ctx.apply([event(ctx.E, "ConditionRemoved", { targetId: me.id, conditionId: a.conditionId })]);
  const line = `You come to: ${status(ctx, me.id)}`;
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
// Class features: what a fighter, barbarian, bard or sorcerer can do outside a fight too.

const FEATURES: Array<{ id: string; name: string; classId: string; target: "self" | "creature" }> = [
  { id: "second-wind", name: "Second Wind", classId: "fighter", target: "self" },
  { id: "rage", name: "Rage", classId: "barbarian", target: "self" },
  { id: "bardic-inspiration", name: "Bardic Inspiration", classId: "bard", target: "creature" },
  { id: "innate-sorcery", name: "Innate Sorcery", classId: "sorcerer", target: "self" },
];

function featuresOf(ctx: Ctx, id: string): NonNullable<NonNullable<SessionState["rules"]>["features"]> {
  const c = ctx.campaign.state.characters[id]!;
  return FEATURES.filter(f => c.classes.some(k => k.classId === f.classId)).map(({ id, name, target }) => ({ id, name, target }));
}

/** A class feature, through the engine's own intent for it (uses, rests and all). */
export async function useFeature(state: SessionState, cast: Character[], featureId: string, targetId?: string): Promise<Outcome> {
  const feature = FEATURES.find(f => f.id === featureId);
  if (!feature) return { lines: [], directive: "" };
  const ctx = await open(state);
  const pcId = state.rules!.pc;
  const who = feature.target === "creature" ? cast.find(c => c.id === targetId) ?? (targetId && state.world?.entities[targetId]?.kind === "person" ? bystander(state.world.entities[targetId]!) : undefined) : undefined;
  if (feature.target === "creature" && !who) { close(state, ctx); return { lines: [`(${feature.name} needs someone to give it to.)`], directive: "" }; }
  let events: Dnd.EngineEvent[];
  try {
    const intent = ctx.E.bonusActionIntent(feature.id, pcId, who ? { targetId: ensureNpc(ctx, state, who) } : {});
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
  close(state, ctx);
  return {
    lines: [`${feature.name}${who ? ` for ${calledBy(state, who)}` : ""}`, ...lines, `${state.player.name}: ${statusText}`],
    directive: `Rules: the player used ${feature.name}${who ? ` on ${calledBy(state, who)}` : ""}. ${account.length ? `${capitalise(account.join("; "))}.` : "It takes effect as the feature describes."} Narrate exactly that, in the fiction, briefly.`,
    status: statusText,
  };
}

export { ABILITY_NAME };
