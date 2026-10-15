import type * as Dnd from "../../../vendor/dnd-srd-engine/dnd-srd-engine.js";
import { damageLine, dnd, type DamageRoll } from "../../rules/dnd.ts";
import type { CombatG, Unit } from "./model.ts";

/**
 * The bridge to the rules engine for a fight: one engine and one dice stream per fight, the live
 * campaign kept in memory between moves (G holds its serialized form, so the fight is still all in
 * G), story people built from SRD statblocks, and the engine's events turned into dice lines like
 * the scene runtime's ("Rapier: your attack on the quiet Crake: 14 +5 = 19 vs AC 12: hit").
 */

export interface Kit {
  E: typeof Dnd;
  engine: Dnd.Engine;
  /** The engine's dice: a mutable state the engine advances as it rolls. */
  rng: { state: number };
  plan: Record<string, (state: Dnd.CampaignState, intent: Record<string, unknown>) => Dnd.PlanResult>;
}

export async function loadKit(seed: number): Promise<Kit> {
  const { E, pack } = await dnd();
  const rng = E.seededRNG(seed) as unknown as { state: number };
  const engine = E.createEngine({ contentPacks: [pack], rng: rng as unknown as Dnd.RNG });
  return { E, engine, rng, plan: engine.plan as unknown as Kit["plan"] };
}

/** The live campaign during a move: apply events, ask the engine, read the state. */
export class Table {
  readonly kit: Kit;
  campaign: Dnd.Campaign;
  constructor(kit: Kit, campaign: Dnd.Campaign) { this.kit = kit; this.campaign = campaign; }
  get state(): Dnd.CampaignState { return this.campaign.state; }
  apply(events: Dnd.EngineEvent[]): Dnd.EngineEvent[] {
    const fixed = wellFormed(events);
    if (fixed.length) this.campaign = this.kit.E.commit(this.campaign, fixed);
    return fixed;
  }
  /** Ask a planner and commit what it decided. Throws the engine's reason when it says no. */
  plan(name: string, intent: Record<string, unknown>): Dnd.EngineEvent[] {
    const planner = this.kit.plan[name];
    if (!planner) throw new Error(`The rules engine has no planner "${name}"`);
    const events = planner(this.state, intent).events;
    return this.apply(name === "castSpell" ? missesMiss(events) : events);
  }
  event(type: string, rest: Record<string, unknown>): Dnd.EngineEvent {
    return { id: this.kit.E.newEventId(), at: new Date().toISOString(), type, ...rest };
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
  roll(expression: string): { total: number; text: string } {
    const r = (this.kit.E as unknown as { rollExpression(e: string, rng: unknown): { rolls: Array<{ value: number }>; modifier: number; total: number } }).rollExpression(expression, this.kit.rng);
    const mod = r.modifier ? signed(r.modifier) : "";
    return { total: r.total, text: `${expression} (${r.rolls.map(x => x.value).join("+")}${mod})` };
  }
}

/**
 * The engine deals half damage on a spell attack that missed (a missed Fire Bolt still burns): a
 * miss is a miss, as src/rules/dnd.ts has it for scenes. Saving-throw spells keep their half.
 */
function missesMiss(events: Dnd.EngineEvent[]): Dnd.EngineEvent[] {
  const missed = new Set(events.filter(e => e.type === "AttackRolled" && e["hit"] === false).map(e => e.id));
  if (!missed.size) return events;
  const dropped = new Set(events.filter(e => e.type === "DamageRolled" && missed.has(String(e["causedByEventId"]))).map(e => e.id));
  return events.filter(e => !dropped.has(e.id) && !(e.type === "DamageApplied" && dropped.has(String(e["causedByEventId"]))));
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const NO_ITEM = "00000000000000000000000000";

/**
 * The engine records a spell attack with the spell's id ("fire-bolt") where an item instance id
 * belongs, and then refuses to load its own campaign ("Expected a ULID"). Nothing reads that field
 * back (the events change no state), so it gets a well-formed placeholder before it's committed.
 * (src/rules/dnd.ts has the same problem: see the combat module's integration notes.)
 */
export function wellFormed(events: Dnd.EngineEvent[]): Dnd.EngineEvent[] {
  return events.map(e => (e.type === "AttackRolled" || e.type === "DamageRolled") && typeof e["weaponInstanceId"] === "string" && !ULID.test(e["weaponInstanceId"] as string)
    ? { ...e, weaponInstanceId: NO_ITEM } : e);
}

export interface EngineCombatant {
  combatantId: string;
  initiative: number;
  position?: { x: number; y: number };
  turnUsage: { actionUsed: boolean; bonusActionUsed: boolean; attacksMadeThisTurn: number; reactionUsedThisRound: boolean; feetMovedThisTurn: number; dashed: boolean; disengaged: boolean };
}
export interface EngineEncounter { id: string; status: string; round: number; activeIndex: number; combatants: EngineCombatant[] }

/**
 * One live campaign per fight, kept beside G: a move loads the campaign from G only when G has
 * moved on without it (a restored save), and serializes it back when it changed.
 */
export class Rules {
  readonly kit: Kit;
  private live?: { serialized: string; campaign: Dnd.Campaign };
  constructor(kit: Kit) { this.kit = kit; }
  open(G: CombatG): Table {
    this.kit.rng.state = G.rng;
    const campaign = this.live && this.live.serialized === G.campaign ? this.live.campaign : this.kit.E.loadCampaign(G.campaign, this.kit.engine);
    if (!this.live || this.live.campaign !== campaign) this.live = { serialized: G.campaign, campaign };
    return new Table(this.kit, campaign);
  }
  close(G: CombatG, table: Table): void {
    G.rng = this.kit.rng.state;
    if (this.live?.campaign === table.campaign && this.live.serialized === G.campaign) return;
    const serialized = this.kit.E.serializeCampaign(table.campaign);
    G.campaign = serialized;
    G.rev++;
    this.live = { serialized, campaign: table.campaign };
  }
}

export const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
export const ABILITY_NAME: Record<string, string> = { STR: "Strength", DEX: "Dexterity", CON: "Constitution", INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma" };

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

/** The weapons the scene runtime gives statblocks whose SRD actions the starter pack doesn't carry. */
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

/** How someone looks: the player never sees an enemy's hit points. */
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
        const hp = names.hp(target);
        const c = table.char(target);
        if (names.isPc(target)) lines.push(`You take ${amount} damage (HP ${Math.max(0, c?.hp.current ?? 0)}/${c?.hp.max ?? "?"})`);
        else lines.push(`${cap(who("targetId"))} takes ${amount} damage (${c ? health({ hp: c.hp.current, maxHp: c.hp.max, state: hp?.state ?? "fighting" }) : "hurt"})`);
        break;
      }
      case "SaveRolled": {
        const d20 = (e["d20"] as number[]).join("/");
        const ability = ABILITY_NAME[String(e["ability"])] ?? String(e["ability"]);
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
        lines.push(`${cap(who("targetId"))} regain${names.isPc(target) ? "" : "s"} ${e["amount"]} HP${names.isPc(target) && c ? ` (HP ${c.hp.current}/${c.hp.max})` : ""}`);
        break;
      }
      case "CreaturePushed":
        lines.push(`${cap(who("targetId"))} ${who("targetId") === "you" ? "are" : "is"} pushed back`);
        break;
    }
  }
  return lines;
}
