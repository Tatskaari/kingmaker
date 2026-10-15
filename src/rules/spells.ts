import { readFileSync } from "node:fs";
import type * as Dnd from "../../vendor/dnd-srd-engine/dnd-srd-engine.js";

/**
 * A spell, the way the sheet shows it when it's picked: the card (level and school, casting time,
 * range, components, duration, concentration, ritual), what it does in this game's terms (the
 * attack or save at the caster's own numbers, the damage and how it grows, the area), and the SRD's
 * description in its own words. The card and the terms are the rules engine's (its starter pack's
 * mechanics are what the game plays); the words are the SRD 5.2.1's, vendored by spell id in
 * vendor/srd-spells (CC BY 4.0). Nothing is made up: a spell the engine has no mechanics for says
 * so, and one the SRD file doesn't have gets no description at all.
 */

/** A block of the SRD's description: a paragraph, a list item, a heading in a stat block, or a table. Emphasis as _italic_ and **bold**. */
export type SrdBlock = string | { item: string } | { heading: string } | { table: string[][]; head?: boolean; caption?: string };

/** A spell as the SRD prints it: its header lines and its description. */
export interface SrdSpell { name: string; castingTime: string; range: string; components: string; duration: string; text: SrdBlock[] }

interface SrdFile { attribution: string; license: string; spells: Record<string, SrdSpell> }

const SRD_FILE = new URL("../../vendor/srd-spells/spells.json", import.meta.url);
let srd: SrdFile | undefined;

function loadSrd(): SrdFile {
  if (!srd) {
    try { srd = JSON.parse(readFileSync(SRD_FILE, "utf8")) as SrdFile; }
    catch { srd = { attribution: "", license: "", spells: {} }; }
  }
  return srd;
}

/** The SRD's entry for a spell, by the engine's spell id ("fire-bolt"). */
export const srdSpell = (id: string): SrdSpell | undefined => loadSrd().spells[id];

/** The SRD 5.2.1's attribution statement, word for word as it asks for it. */
export const srdAttribution = (): string => loadSrd().attribution;

/** Whoever's casting, for the numbers: their character level (cantrips grow with it), spell save DC and spell attack bonus, and what the engine adds for them. */
export interface Caster { level: number; saveDC: number; attackBonus: number; extras?: Extras }

/** A part of a roll the engine adds for the caster, and where it's from: 2, "Agonizing Blast". */
export interface Bonus { amount: number; from: string }

/**
 * What the engine adds to a caster's spells when they're cast, beyond the spells' own numbers
 * (sheetData works it out from the engine's effect stack for the character):
 */
export interface Extras {
  /** To the damage of a spell's attack or save: a feature (Agonizing Blast's Charisma on Eldritch Blast), a feat, a condition. Primary is the spell's first damage; the rest gets only what goes by damage type. */
  damage(spell: Dnd.SpellDef, type: string | undefined, primary: boolean): Bonus[];
  /** To every heal with dice: the engine adds the caster's Wisdom modifier, whatever their class. */
  heal?: Bonus;
  /** To a heal from a slot: Disciple of Life's 2 + the slot's level. */
  healBoost?: { flat: number; perLevel: number; from: string };
  /** Potent Cantrip, by its name, when they have it: a damaging cantrip saved against still does half (a missed one does nothing: the game drops the engine's half damage on a miss). */
  potentCantrip?: string;
}

/** Names for what the mechanics refer to by id (the engine's content): conditions and items. */
export interface Names { condition(id: string): string | undefined; item(id: string): string | undefined }

/** A spell on the sheet, picked. */
export interface SpellDetails {
  id: string;
  name: string;
  level: number;
  school: string;
  /** The SRD's line for it: "Level 3 Evocation (Sorcerer, Wizard)", "Evocation Cantrip (Sorcerer, Wizard)". */
  levelLine: string;
  /** The engine's casting time, with a reaction's or bonus action's trigger where the SRD gives one. */
  castingTime: string;
  /** The SRD's, where the game's is another (Barkskin: the game's an Action, the SRD's a Bonus Action). */
  srdCastingTime?: string;
  range: string;
  components: { verbal: boolean; somatic: boolean; material?: string };
  duration: string;
  concentration: boolean;
  ritual: boolean;
  /** What it does in this game's terms, a line each: the attack or save and what comes of it. Empty when the rules roll nothing for it. */
  does: string[];
  /** The area it fills: "a 20-foot-radius sphere". */
  area?: string;
  /** How it grows: a cantrip with the caster's level, a spell with a higher slot (or nothing more, where the SRD's grows and the game's doesn't). */
  scaling: string[];
  /** Whether a fight on the map offers it (inFights). */
  inFights: boolean;
  /** The SRD's description, in its own words; undefined when there isn't one. */
  text?: SrdBlock[];
  /** With the SRD's words, its attribution statement, as it asks for it wherever they're used. */
  credit?: string;
}

/** The kinds of mechanics a fight on the map plays out (src/game/combat/skirmish.ts). */
const FIGHT_KINDS = new Set(["attack", "save", "auto-hit", "heal", "hp-pool-knockout", "buff"]);

/**
 * Whether a fight on the map offers a spell (when it's ready, and there's a slot): one cast as an
 * action or a bonus action, all of whose mechanics the fight plays out. A reaction, a spell that
 * takes a minute or more, or one the rules roll nothing for is for a scene.
 */
export function inFights(spell: Dnd.SpellDef): boolean {
  const effects = spell.mechanicalEffects ?? [];
  return !/reaction|minute|hour/i.test(spell.castingTime) && effects.length > 0 && effects.every(m => FIGHT_KINDS.has(String(m.kind)));
}

type Effect = { kind: string; [key: string]: unknown };
type Variants = { variants: Array<{ key: string; conditionId: string }> };

const ABILITY: Record<string, string> = { STR: "Strength", DEX: "Dexterity", CON: "Constitution", INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma" };
const NUMBER = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const ordinal = (n: number) => ["0th", "1st", "2nd", "3rd"][n] ?? `${n}th`;
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
/** Dice and a number added to them: plus("1d10", 2) is "1d10 + 2". */
const plus = (dice: string, n: number) => (!n ? dice : !dice ? String(n) : `${dice} ${n > 0 ? "+" : "-"} ${Math.abs(n)}`);
const unmarked = (t: string) => t.replace(/\*\*|_/g, "");
const article = (name: string) => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
/** "a, b or c". */
const either = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items.at(-1)}` : items[0] ?? "");

/** A dice expression grown by n dice of its own kind: more("1d10", 2) is 3d10. */
function more(dice: string, n: number): string {
  const m = /^(\d+)d(\d+)(.*)$/.exec(dice.trim());
  return m && n ? `${Number(m[1]) + n}d${m[2]}${m[3]}` : dice;
}
const count = (dice: string) => Number(/^(\d+)d/.exec(dice.trim())?.[1] ?? 1);
const die = (dice: string) => /d(\d+)/.exec(dice)?.[1] ?? "";
/** Cantrips grow at character levels 5, 11 and 17. */
const tier = (level: number) => (level >= 17 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0);

/**
 * Spells that are several attacks at once, a ray or a beam each, and how many by the slot they're
 * cast with and the caster's level: Scorching Ray's three, one more for each slot level above 2nd;
 * Eldritch Blast's beams, more at levels 5, 11 and 17. The engine rolls one attack for each target
 * it's handed, so the game hands it one for each ray (castSpell in dnd.ts, a fight's cast), and
 * rolls each ray at a thing itself.
 */
export const RAYS: Record<string, (slot: number, level: number) => number> = {
  "scorching-ray": slot => 3 + Math.max(0, slot - 2),
  "eldritch-blast": (_, level) => 1 + tier(level),
};

/** The details of a spell for whoever's casting it (without a caster: no numbers, and a cantrip as it starts). */
export function spellDetails(spell: Dnd.SpellDef, caster?: Caster, names?: Names): SpellDetails {
  const c = (spell.components ?? {}) as { verbal?: boolean; somatic?: boolean; material?: string };
  const srd = srdSpell(spell.id);
  const area = areaOf(spell);
  const terms = new Terms(spell, caster, names, !!area);
  for (const e of (spell.mechanicalEffects ?? []) as Effect[]) terms.effect(e);
  // The SRD's grows with a higher slot ("Using a Higher-Level Spell Slot."), and the game's doesn't: say so.
  const upcasts = srd?.text.some(b => typeof b === "string" && /^_Using a Higher-Level Spell Slot\._/.test(b));
  if (spell.level > 0 && upcasts && !terms.scaling.some(t => t.startsWith("With a higher slot"))) terms.scaling.push("With a higher slot: nothing more in this game");
  const time = castingTime(spell, srd);
  return {
    id: spell.id, name: spell.name, level: spell.level, school: spell.school,
    levelLine: `${spell.level ? `Level ${spell.level} ${capital(spell.school)}` : `${capital(spell.school)} Cantrip`} (${spell.classes.map(capital).sort().join(", ")})`,
    castingTime: time.game,
    ...(time.srd ? { srdCastingTime: time.srd } : {}),
    range: spell.range,
    components: { verbal: !!c.verbal, somatic: !!c.somatic, ...(c.material ? { material: c.material } : {}) },
    duration: spell.duration, concentration: spell.concentration, ritual: spell.ritual,
    does: terms.does,
    ...(area ? { area } : {}),
    scaling: terms.scaling,
    inFights: inFights(spell),
    ...(srd ? { text: srd.text, credit: srdAttribution() } : {}),
  };
}

/**
 * The engine's casting time, or the SRD's where it only adds to it: a trigger ("Reaction, which you
 * take when..."), names for the ways ("Action (Overgrowth) or 8 hours (Enrichment)"). Where the SRD's
 * is another (Barkskin's Bonus Action, the game's Action), that too: the game plays its own.
 */
function castingTime(spell: Dnd.SpellDef, srd: SrdSpell | undefined): { game: string; srd?: string } {
  const said = unmarked(srd?.castingTime ?? "").replace(/ or Ritual$/, "");
  if (!said || said === spell.castingTime) return { game: spell.castingTime };
  if (said.startsWith(`${spell.castingTime}, which`) || said.replace(/ \([^)]*\)/g, "") === spell.castingTime) return { game: said };
  return { game: spell.castingTime, srd: said };
}

/** The area, as the game catches things in it (caughtIn in src/world/scene-world.ts): a sphere's size is its radius, a cube's its side. */
function areaOf(spell: Dnd.SpellDef): string | undefined {
  const t = spell["targeting"] as { shape: string; size: number } | undefined;
  if (!t) return undefined;
  const self = /^self/i.test(spell.range);
  switch (t.shape) {
    case "sphere": return `a ${t.size}-foot-radius sphere${self ? " around you" : ""}`;
    case "cylinder": return `a ${t.size}-foot-radius cylinder${self ? " around you" : ""}`;
    case "cube": return `a ${t.size}-foot cube${self ? " from you" : ""}`;
    case "cone": return `a ${t.size}-foot cone${self ? " from you" : ""}`;
    case "line": return `a ${t.size}-foot line, 5 feet wide${self ? ", from you" : ""}`;
    default: return `a ${t.size}-foot ${t.shape}`;
  }
}

/** The engine's mechanics for a spell, a sentence each, at the caster's numbers. */
class Terms {
  does: string[] = [];
  scaling: string[] = [];
  private readonly spell: Dnd.SpellDef;
  private readonly caster: Caster | undefined;
  private readonly names: Names | undefined;
  private readonly area: boolean;
  constructor(spell: Dnd.SpellDef, caster: Caster | undefined, names: Names | undefined, area: boolean) {
    this.spell = spell;
    this.caster = caster;
    this.names = names;
    this.area = area;
  }

  /** A higher slot's gain: "With a higher slot: +1d6 fire for each level above 1st". */
  private higher(gain: string) { this.scaling.push(`With a higher slot: ${gain} for each level above ${ordinal(this.spell.level)}`); }
  private dc() { return this.caster ? `, DC ${this.caster.saveDC}` : ""; }

  private condition(id: string): string {
    const name = this.names?.condition(id) ?? capital(id.replace(/-active$/, "").replace(/-/g, " "));
    return name.replace(/\s*\(active\)$|\s+Active$/, "");
  }

  /** Conditions to choose between, a shared head said once: "Hexed (STR, DEX or CON: your choice)". */
  private choices(v: Variants): string {
    const all = v.variants.map(x => this.condition(x.conditionId));
    const head = /^(.+?)(?:: | \()/.exec(all[0] ?? "")?.[1];
    if (head && all.every(n => n.startsWith(`${head}: `) || n.startsWith(`${head} (`))) return `${head} (${either(all.map(n => n.slice(head.length).replace(/^: | \(|\)$/g, "")))}: your choice)`;
    return `${either(all)} (your choice)`;
  }

  /** What the engine adds to a line's numbers for the caster, and where from ("+2 Agonizing Blast"), said after it. */
  private notes: string[] = [];
  /** A line, with what the engine added to it: "... 1d10 + 2 force on a hit (+2 Agonizing Blast)". */
  private say(line: string) {
    this.does.push(this.notes.length ? `${line} (${this.notes.join(", ")})` : line);
    this.notes = [];
  }
  private added(bonus: Bonus[]): number {
    this.notes.push(...bonus.map(b => `${signed(b.amount)} ${b.from}`));
    return bonus.reduce((n, b) => n + b.amount, 0);
  }

  /**
   * Dice of a type ("1d10 fire"): a cantrip's as they are at the caster's level, and how they grow;
   * with what the engine adds to them for the caster when it's a spell's attack or save that rolls
   * them ("1d10 + 2 force"), the first damage everything, any more only what goes by damage type.
   */
  private damage(e: Effect, adds?: { primary: boolean }): string {
    const dice = String(e["damageDice"] ?? "");
    const types = (e["casterChoosesDamageType"] as { allowed?: string[] } | undefined)?.allowed;
    const type = types ? `${either(types)} (your choice)` : String(e["damageType"] ?? "");
    const grows = e["cantripScalingDice"] as string | undefined;
    if (this.spell.level === 0 && grows) {
      const at = (n: number) => more(dice, count(grows) * n);
      this.scaling.push(`Grows with you: ${at(1)} at level 5, ${at(2)} at 11, ${at(3)} at 17`);
    }
    const extra = Number(e["extraDicePerSlotLevel"] ?? 0);
    if (extra && this.spell.level > 0) this.higher(`+${extra}d${die(dice)} ${types ? "damage" : type}`);
    const now = this.spell.level === 0 && grows ? more(dice, count(grows) * tier(this.caster?.level ?? 1)) : dice;
    // A chosen type gets only what doesn't go by type: which type it'll be isn't known yet.
    const bonus = adds ? (this.caster?.extras?.damage(this.spell, types ? undefined : String(e["damageType"] ?? ""), adds.primary) ?? []).filter(b => b.amount) : [];
    return `${plus(now, this.added(bonus))} ${type}`.trim();
  }

  effect(e: Effect): void {
    switch (e.kind) {
      case "attack": {
        const hit = [...(e["damageDice"] ? [this.damage(e, { primary: true })] : []), ...(e["conditionOnHit"] ? [this.condition(String(e["conditionOnHit"]))] : [])];
        const bonus = this.caster ? `, ${signed(this.caster.attackBonus)} to hit` : "";
        // A miss is a miss, Potent Cantrip or not: the game drops the engine's half damage on one (missesMiss in dnd.ts).
        this.say(`${e["attackKind"] === "melee" ? "Melee" : "Ranged"} spell attack${bonus}${hit.length ? `: ${hit.join(" and ")} on a hit` : ""}`);
        if (e["explodeOnMaxDie"]) this.does.push("A damage die that rolls its highest rolls another");
        if (e["cantripBeamScaling"]) {
          const beams = 1 + tier(this.caster?.level ?? 1);
          if (beams > 1) this.does.push(`${capital(NUMBER[beams]!)} beams, each its own attack`);
          this.scaling.push("Grows with you: two beams at level 5, three at 11, four at 17");
        } else if (RAYS[this.spell.id]) {
          const rays = RAYS[this.spell.id]!;
          const n = rays(this.spell.level, this.caster?.level ?? 1);
          this.does.push(`${capital(NUMBER[n] ?? String(n))} rays, each its own attack`);
          const gain = rays(this.spell.level + 1, this.caster?.level ?? 1) - n;
          if (gain > 0) this.higher(gain === 1 ? "one more ray" : `${NUMBER[gain] ?? gain} more rays`);
        }
        return;
      }
      case "save": case "aura-damage": case "trap": {
        const ability = String(e[e.kind === "save" ? "ability" : "saveAbility"]);
        // The engine adds the caster's damage riders to a save spell's damage, not to an aura's or a trap's.
        const adds = e.kind === "save";
        const dmg = [
          ...(e["damageDice"] ? [this.damage(e, adds ? { primary: true } : undefined)] : []),
          ...((e["additionalDamage"] as Effect[] | undefined) ?? []).map(x => this.damage(x, adds ? { primary: false } : undefined)),
        ].join(" and ");
        const fail = [
          ...(e["conditionOnFail"] ? [`${this.condition(String(e["conditionOnFail"]))}${e["conditionEndsOnDamage"] ? " until it's hurt" : ""}`] : []),
          ...(e["pushedFeetOnFail"] ? [`pushed ${e["pushedFeetOnFail"]} feet away`] : []),
          ...(e["casterChoosesVariant"] ? [this.choices(e["casterChoosesVariant"] as Variants)] : []),
        ];
        // Potent Cantrip: a damaging cantrip saved against still does half.
        const potent = adds && dmg && this.spell.level === 0 && e["halfOnSuccess"] !== true ? this.caster?.extras?.potentCantrip : undefined;
        if (potent) this.notes.push(potent);
        const half = e["halfOnSuccess"] === true || !!potent;
        const head = `${ABILITY[ability] ?? ability} save${this.dc()}`;
        let line = dmg && !fail.length ? `${head}: ${dmg}${half ? ", half as much on a success" : " on a failure"}`
          : dmg ? `${head}: ${dmg} and ${fail.join(" and ")} on a failure${half ? ", half the damage on a success" : ""}`
          : fail.length ? `${head}, or ${fail.join(" and ")}` : head;
        if (e["targetCreatureType"]) line += ` (${e["targetCreatureType"]}s only)`;
        if (e["largeCreatureAdvantage"]) line += " (a Large or bigger creature has Advantage)";
        if (e.kind === "aura-damage") line = `In it${this.area ? "" : ` (within ${e["rangeFeet"]} feet)`}: ${line}`;
        if (e.kind === "trap") line = `${e["label"] ?? "The trap"}, when it's set off: ${line}`;
        this.say(line);
        return;
      }
      case "auto-hit": {
        const darts = Number(e["dartsAtBaseSlot"] ?? 1);
        this.does.push(`${capital(NUMBER[darts] ?? String(darts))} darts of ${e["damageDicePerDart"]} ${e["damageType"] ?? ""}`.trim() + ", each a sure hit");
        const extra = Number(e["extraDartsPerSlotLevel"] ?? 0);
        if (extra) this.higher(extra === 1 ? "one more dart" : `${NUMBER[extra] ?? extra} more darts`);
        return;
      }
      case "heal": {
        // The engine adds the caster's Wisdom modifier to a heal with dice, and a healing boost (Disciple of Life) to one from a slot.
        const dice = e["amountDice"] as string | undefined;
        const flat = Number(e["flatAmount"] ?? 0);
        const x = this.caster?.extras;
        const boost = x?.healBoost && this.spell.level > 0 ? x.healBoost : undefined;
        const adds = [...(dice && x?.heal ? [x.heal] : []), ...(boost ? [{ amount: boost.flat + boost.perLevel * this.spell.level, from: boost.from }] : [])].filter(b => b.amount);
        this.say(`Heals ${plus([dice, flat ? String(flat) : ""].filter(Boolean).join(" + "), this.added(adds))} hit points`);
        const extra = Number(e["extraDicePerSlotLevel"] ?? 0);
        const gains = [...(extra && dice ? [`+${extra}d${die(dice)} healing`] : []), ...(boost?.perLevel ? [`+${boost.perLevel} from ${boost.from}`] : [])];
        if (gains.length) this.higher(gains.join(" and "));
        return;
      }
      case "buff": {
        const variants = e["casterChoosesVariant"] as Variants | undefined;
        this.does.push(`${/^self/i.test(this.spell.range) ? "On you" : "On the target"}: ${variants ? this.choices(variants) : this.condition(String(e["conditionId"]))}`);
        return;
      }
      case "summon":
        this.does.push(`Summons ${article(String(e["name"]))}: AC ${e["ac"]}, ${e["hpBase"]} hit points, speed ${e["speedFeet"]} feet`);
        if (Number(e["hpPerSlotAbove"] ?? 0)) this.higher(`+${e["hpPerSlotAbove"]} hit points for it`);
        return;
      case "zone":
        this.does.push("Makes a zone where it's cast, which the rules keep track of");
        return;
      case "remove-condition":
        this.does.push(`Ends one condition: ${either(((e["eligibleConditionIds"] as string[] | undefined) ?? []).map(c => this.condition(c)))}`);
        return;
      case "recurring": {
        const dice = e["amountDice"] as string | undefined;
        const mod = e["addCasterAbilityMod"] ? `your ${ABILITY[String(e["addCasterAbilityMod"])]} modifier` : "";
        const what = e["effect"] === "temp-hp" ? "temporary hit points" : e["effect"] === "heal" ? "hit points back" : String(e["damageType"] ?? "damage");
        this.does.push(`At the start of each of its turns: ${dice ? `${[dice, mod].filter(Boolean).join(" + ")} ${what}` : `${what} equal to ${mod}`}`);
        const extra = Number(e["extraDicePerSlotLevel"] ?? 0);
        if (extra && dice) this.higher(`+${extra}d${die(dice)} each turn`);
        return;
      }
      case "hp-threshold": {
        const outcome = (o: Effect | undefined) => !o ? "nothing" : o.kind === "destroy" ? "it dies" : o.kind === "condition" ? this.condition(String(o["conditionId"]))
          : o.kind === "damage" ? `${o["damageDice"]} ${o["damageType"] ?? ""}`.trim() : o.kind;
        this.does.push(`${e["threshold"]} hit points or fewer: ${outcome(e["atOrBelow"] as Effect | undefined)}; more: ${outcome(e["above"] as Effect | undefined)}`);
        return;
      }
      case "hp-pool-knockout":
        this.does.push(`Rolls ${e["poolDice"]}: that many hit points of creatures, the weakest first, are ${this.condition(String(e["conditionId"]))}`);
        if (e["extraPoolDicePerSlotLevel"]) this.higher(`+${e["extraPoolDicePerSlotLevel"]} to the roll`);
        return;
      case "temp-hp": {
        const flat = Number(e["flatAmount"] ?? 0);
        this.does.push(`${[e["amountDice"] as string | undefined, flat ? String(flat) : ""].filter(Boolean).join(" + ")} temporary hit points`);
        if (Number(e["extraPerSlotLevel"] ?? 0)) this.higher(`+${e["extraPerSlotLevel"]} temporary hit points`);
        return;
      }
      case "weapon-buff": {
        const types = (e["damageTypeChoice"] as { allowed?: string[] } | undefined)?.allowed;
        this.does.push(`Your weapon${e["useSpellcastingAbility"] ? " uses your spellcasting ability and" : ""} deals ${e["damageDieOverride"] ?? "its damage"}${types?.length ? `, ${either(types)} if you like` : ""}`);
        return;
      }
      case "weaponAttack":
        this.does.push("An attack with your weapon, as part of the spell");
        return;
      case "stabilize":
        this.does.push("Stabilizes a creature at 0 hit points");
        return;
      case "create-item":
        this.does.push(`Makes ${this.names?.item(String(e["itemDefinitionId"])) ?? String(e["itemDefinitionId"])} ×${e["quantity"] ?? 1}`);
        return;
      case "movement-damage":
        this.does.push(`${e["damageDicePerFiveFeet"]} ${e["damageType"] ?? "damage"} for every 5 feet a creature moves in it`);
        return;
    }
  }
}
