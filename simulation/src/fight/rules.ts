// After the prototype's src/game/combat/rules.ts at bc2ab1f: Kit, Table (its plan, event, char, sheet, encounter, itemName, item, roll), missesMiss, EngineCombatant and EngineEncounter, STATBLOCKS, STATBLOCK_WEAPON, statblockFor, createNpc, health, Namer and diceLines, as they are but at the seams: the Table works on v2's engine context (shared/rules/engine.ts changing: each event committed well-formed and as a load parses it, so the campaign it leaves can be kept in the isolate's cache), an event made by hand is stamped as engine.ts stamps one (its id's time, which the shim pins), a roll outside the engine's planners draws on the game's dice (shared/dice.ts rng, as a rest's hit dice do), and loadKit and Rules (the prototype's one engine a fight and its campaign kept between moves) give way to the simulation's pinned engine call (fight/rows.ts openTable). damageLine, signed and ABILITY_NAME are shared/rules'.
import type * as Dnd from "../../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { damageLine, type DamageRoll } from "../../../shared/rules/acts.ts";
import { ABILITY_NAME, changing, event, signed, type Ctx } from "../../../shared/rules/engine.ts";

export { signed };
import type { Unit } from "../../../shared/fight/types.ts";

/**
 * The bridge to the rules engine for a fight (docs/combat-design.md): the engine and its dice for one
 * move, the fight's campaign as the engine has it, story people built from SRD statblocks, and the
 * engine's events turned into dice lines like the scenes' ("Rapier: your attack on the quiet Crake:
 * 14 +5 = 19 vs AC 12: hit").
 */

/** The engine for one move: the bundle, the isolate's engine (its dice reseeded for this move), and its planners by name. */
export interface Kit {
  E: typeof Dnd;
  engine: Dnd.Engine;
  plan: Record<string, (state: Dnd.CampaignState, intent: Record<string, unknown>) => Dnd.PlanResult>;
}

/** The live campaign during a move: apply events, ask the engine, read the state. */
export class Table {
  readonly kit: Kit;
  private readonly ctx: Ctx;
  private readonly random: () => number;
  /** `random`: the game's dice, for a roll outside the engine's planners (a blow at a lantern). */
  constructor(kit: Kit, campaign: Dnd.Campaign, random: () => number) {
    this.kit = kit;
    this.ctx = changing(kit.E, kit.engine, campaign, true);
    this.random = random;
  }
  get campaign(): Dnd.Campaign { return this.ctx.campaign; }
  get state(): Dnd.CampaignState { return this.ctx.campaign.state; }
  apply(events: Dnd.EngineEvent[]): Dnd.EngineEvent[] {
    if (events.length) this.ctx.apply(events);
    return events;
  }
  /** Ask a planner and commit what it decided. Throws the engine's reason when it says no. */
  plan(name: string, intent: Record<string, unknown>): Dnd.EngineEvent[] {
    const planner = this.kit.plan[name];
    if (!planner) throw new Error(`The rules engine has no planner "${name}"`);
    const events = planner(this.state, intent).events;
    return this.apply(name === "castSpell" ? missesMiss(events) : events);
  }
  event(type: string, rest: Record<string, unknown>): Dnd.EngineEvent {
    return event(this.kit.E, type, rest);
  }
  char(id: string): Dnd.EngineCharacter | undefined { return this.state.characters[id]; }
  sheet(id: string): Dnd.CharacterSheet {
    const s = this.state;
    return this.kit.E.buildCharacterSheet({ character: s.characters[id]!, itemInstances: s.itemInstances, content: this.kit.engine.content, characters: s.characters, pendingChoices: s.pendingChoices });
  }
  encounter(id: string): EngineEncounter | undefined {
    return (this.state["encounters"] as Record<string, EngineEncounter> | undefined)?.[id];
  }
  itemName(instanceId: string): string {
    const def = this.state.itemInstances[instanceId]?.definitionId;
    return (def && this.kit.engine.content.items.get(def)?.name) ?? "Attack";
  }
  item(instanceId: string): Dnd.ItemDef | undefined {
    const def = this.state.itemInstances[instanceId]?.definitionId;
    return def ? this.kit.engine.content.items.get(def) : undefined;
  }
  /** A dice expression ("1d20", "2d6+1") rolled on the game's dice. */
  roll(expression: string): { total: number; text: string } {
    const m = /^(\d+)d(\d+)\s*([+-]\s*\d+)?$/.exec(expression.trim());
    if (!m) return { total: 0, text: expression };
    const rolls = Array.from({ length: Number(m[1]) }, () => 1 + Math.floor(this.random() * Number(m[2])));
    const mod = m[3] ? Number(m[3].replace(/\s/g, "")) : 0;
    return { total: rolls.reduce((a, b) => a + b, 0) + mod, text: `${expression} (${rolls.join("+")}${mod ? signed(mod) : ""})` };
  }
}

/**
 * The engine deals half damage on a spell attack that missed (a missed Fire Bolt still burns): a
 * miss is a miss, as shared/rules/acts.ts has it for scenes. Saving-throw spells keep their half.
 */
function missesMiss(events: Dnd.EngineEvent[]): Dnd.EngineEvent[] {
  const missed = new Set(events.filter(e => e.type === "AttackRolled" && e["hit"] === false).map(e => e.id));
  if (!missed.size) return events;
  const dropped = new Set(events.filter(e => e.type === "DamageRolled" && missed.has(String(e["causedByEventId"]))).map(e => e.id));
  return events.filter(e => !dropped.has(e.id) && !(e.type === "DamageApplied" && dropped.has(String(e["causedByEventId"]))));
}

export interface EngineCombatant {
  combatantId: string;
  initiative: number;
  position?: { x: number; y: number };
  turnUsage: { actionUsed: boolean; bonusActionUsed: boolean; attacksMadeThisTurn: number; reactionUsedThisRound: boolean; feetMovedThisTurn: number; dashed: boolean; disengaged: boolean };
}
export interface EngineEncounter { id: string; status: string; round: number; activeIndex: number; combatants: EngineCombatant[] }

// ---------------------------------------------------------------------------------------------
// Story people in the rules: SRD statblocks, and a few of our own built on them.

export interface CombatStatblock {
  /** The SRD statblock it's built on (traits like Pack Tactics, saves). */
  base: string;
  hp?: number;
  ac?: number;
  abilityScores?: Partial<Record<Dnd.Ability, number>>;
  /** Fighter levels: 1 gives the +2 proficiency a statblock's attacks assume; 5 gives two attacks. */
  level?: number;
  weapon: string;
  /** What the weapon is called in the fiction. */
  weaponName?: string;
  /** A reaction: +N AC against one melee hit a round (a duellist's parry). */
  parry?: number;
  speed?: number;
}

/**
 * Statblocks the Heron needs that the SRD doesn't quite have. Master Sallow, under-purveyor for
 * grain, was the best fencer in the Purveyor's office (an office of three fencers, all over fifty,
 * which he doesn't mention), and his silver-topped cane has a blade in it.
 */
export const STATBLOCKS: Record<string, CombatStatblock> = {
  "sword-cane-duellist": { base: "bandit-captain", hp: 33, ac: 15, abilityScores: { STR: 10, DEX: 17, CON: 12, INT: 15, WIS: 12, CHA: 16 }, level: 5, weapon: "rapier", weaponName: "Sword-cane", parry: 3, speed: 25 },
  "river-bruiser": { base: "tough", hp: 22, weapon: "club", weaponName: "Cudgel" },
  "lantern-boy": { base: "commoner", hp: 4, abilityScores: { DEX: 14 }, weapon: "unarmed-strike" },
  "porter": { base: "bandit", hp: 11, weapon: "dagger", weaponName: "Sack-knife" },
};

/** The weapons the scenes give statblocks whose SRD actions the starter pack doesn't carry. */
const STATBLOCK_WEAPON: Record<string, string> = {
  commoner: "club", guard: "spear", "guard-captain": "longsword", tough: "mace", "tough-boss": "warhammer", noble: "rapier",
  spy: "shortsword", bandit: "scimitar", "bandit-captain": "scimitar", "warrior-infantry": "spear", "warrior-veteran": "longsword",
  knight: "greatsword", priest: "mace", "priest-acolyte": "club", mage: "dagger", scout: "shortsword", pirate: "dagger",
  "pirate-captain": "rapier", cultist: "ritual-sickle", "cultist-fanatic": "dagger", mastiff: "mastiff-bite", wolf: "wolf-bite",
};

export function statblockFor(id: string | undefined, weapon: string | undefined, content: Dnd.Content): CombatStatblock {
  const custom = id ? STATBLOCKS[id] : undefined;
  if (custom) return { ...custom, ...(weapon && content.items.has(weapon) && weapon !== "club" ? { weapon } : {}) };
  const base = id && content.monsters.has(id) ? id : "commoner";
  const fallback = STATBLOCK_WEAPON[base] && content.items.has(STATBLOCK_WEAPON[base]!) ? STATBLOCK_WEAPON[base]! : "club";
  return { base, weapon: weapon && content.items.has(weapon) ? weapon : fallback };
}

/** A statblock person in the engine: a creature with the statblock's scores, and their weapon in hand. */
export function createNpc(table: Table, name: string, sb: CombatStatblock): { id: string; weapon: string } {
  const { E } = table.kit;
  const base = table.kit.engine.content.monsters.get(sb.base) ?? table.kit.engine.content.monsters.get("commoner")!;
  const level = sb.level ?? 1;
  const hp = sb.hp ?? base.hp.average;
  const npc = E.CharacterSchema.parse({
    id: E.newCharacterId(), kind: "creature", statblockId: base.id, name, speciesId: "human", backgroundId: "soldier",
    classes: [{ classId: "fighter", level, hitDiceRemaining: level }],
    abilityScores: { ...base.abilityScores, ...(sb.abilityScores ?? {}) }, hp: { current: hp, max: hp, temp: 0 }, armorClass: sb.ac ?? base.ac,
  });
  const weapon = { id: E.newItemInstanceId(), definitionId: sb.weapon, quantity: 1, attuned: false, identifiedByCharacterIds: [] };
  table.apply([table.event("CharacterCreated", { snapshot: npc }), table.event("ItemAcquired", { instance: weapon, characterId: npc.id })]);
  try { table.plan("equip", { characterId: npc.id, instanceId: weapon.id, slot: "mainHand" }); } catch { /* natural weapons aren't held */ }
  return { id: npc.id, weapon: weapon.id };
}

// ---------------------------------------------------------------------------------------------
// Dice lines.

/** How someone looks, in a word: the summary's and the log's (the screen shows everyone's hit points). */
export function health(u: Pick<Unit, "hp" | "maxHp" | "state">): string {
  if (u.state === "dead") return "dead";
  if (u.state === "fled") return "gone";
  if (u.state === "surrendered") return "surrendered";
  if (u.hp <= 0) return "down";
  if (u.hp >= u.maxHp) return "unhurt";
  return u.hp * 2 <= u.maxHp ? "badly hurt" : "hurt";
}

export interface Namer {
  /** "you" for the player, "the quiet Crake", "Master Sallow". */
  called(engineId: string): string;
  isPc(engineId: string): boolean;
  weapon(instanceId: string): string;
  hp(engineId: string): { hp: number; maxHp: number; state: Unit["state"] } | undefined;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const possessive = (name: string) => (name === "you" ? "your" : name.endsWith("s") ? `${name}'` : `${name}'s`);

/** The engine's events as the player sees them. */
export function diceLines(table: Table, events: Dnd.EngineEvent[], names: Namer, label?: string): string[] {
  const lines: string[] = [];
  for (const e of events) {
    const who = (k: string) => names.called(String(e[k]));
    switch (e.type) {
      case "AttackRolled": {
        const d20 = (e["d20"] as number[]).join("/");
        const adv = e["used"] && e["used"] !== "none" ? ` (${e["used"]})` : "";
        const verdict = e["critical"] ? "critical hit!" : e["hit"] ? "hit" : "miss";
        const what = label ?? names.weapon(String(e["weaponInstanceId"]));
        const oa = e["isOpportunityAttack"] ? " (opportunity attack)" : "";
        lines.push(`${what}: ${possessive(who("attackerId"))} attack on ${who("targetId")}${oa}: ${d20}${adv} ${signed(Number(e["attackBonus"]))} = ${e["total"]} vs AC ${e["targetAC"]}: ${verdict}`);
        break;
      }
      case "DamageRolled": {
        lines.push(damageLine(e["rolls"] as DamageRoll[]));
        break;
      }
      case "DamageApplied": {
        const amount = (e["components"] as Array<{ amount: number; type: string }>).map(c => `${c.amount} ${c.type}`).join(" and ");
        const target = String(e["targetId"]);
        const c = table.char(target);
        if (names.isPc(target)) lines.push(`You take ${amount} damage (HP ${Math.max(0, c?.hp.current ?? 0)}/${c?.hp.max ?? "?"})`);
        else lines.push(`${cap(who("targetId"))} takes ${amount} damage (HP ${Math.max(0, c?.hp.current ?? 0)}/${c?.hp.max ?? "?"})`);
        break;
      }
      case "SaveRolled": {
        const d20 = (e["d20"] as number[]).join("/");
        const ability = ABILITY_NAME[String(e["ability"]) as Dnd.Ability] ?? String(e["ability"]);
        lines.push(`${cap(possessive(who("targetId")))} ${ability} save: ${d20} ${signed(Number(e["bonus"]))} = ${e["total"]} vs DC ${e["dc"]}: ${e["success"] ? "saved" : "failed"}`);
        break;
      }
      case "DeathSaveRolled": {
        const target = String(e["targetId"]);
        const c = table.char(target);
        const tally = c ? ` (${c.deathSaves.successes} success${c.deathSaves.successes === 1 ? "" : "es"}, ${c.deathSaves.failures} failure${c.deathSaves.failures === 1 ? "" : "s"})` : "";
        lines.push(`${cap(possessive(who("targetId")))} death save: ${e["d20"]}: ${e["critical"] ? "natural 20!" : e["success"] ? "success" : "failure"}${tally}`);
        break;
      }
      case "ConditionApplied": {
        const condition = table.kit.engine.content.conditions.get(String(e["conditionId"]))?.name ?? String(e["conditionId"]);
        if (/active$/i.test(condition) || e["conditionId"] === "dodged") break;
        lines.push(`${cap(who("targetId"))} ${who("targetId") === "you" ? "are" : "is"} ${condition.toLowerCase()}`);
        break;
      }
      case "Healed": {
        const target = String(e["targetId"]);
        const c = table.char(target);
        lines.push(`${cap(who("targetId"))} regain${names.isPc(target) ? "" : "s"} ${e["amount"]} HP${c ? ` (HP ${c.hp.current}/${c.hp.max})` : ""}`);
        break;
      }
      case "CreaturePushed":
        lines.push(`${cap(who("targetId"))} ${who("targetId") === "you" ? "are" : "is"} pushed back`);
        break;
    }
  }
  return lines;
}
