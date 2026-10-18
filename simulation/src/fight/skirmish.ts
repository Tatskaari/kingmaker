// After the prototype's src/game/combat/skirmish.ts at bc2ab1f: the Skirmish class, its rules of the board, as they are but at the seams. It works on the fight's board (shared/fight/types.ts FightBoard, the prototype's CombatG less its campaign, kept in fight_rules) with the map beside it, and a Table over v2's engine (fight/rules.ts); the log is the moments it writes (each public act opens one: a move, an attack, a spell, a turn's start; its dice and lines go in it; its hits are what changed in it; its caption is caption.ts's), and done() hands them over; boardgame.io's turn hooks are beginTurn and advance, called by fight/turns.ts. Left out for now, as typed lines' (V13) or not yet in a fight's menu: Influence (influence, moodOf, rollInfluence, comply), Search and Study (check), Reckless Attack (reckless, whyNotReckless, recklessNow; wild keeps a blow's own advantage), understands; options is fight/options.ts's. New: yieldFight, the player putting their hands up.
import type * as Dnd from "../../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { inFights, RAYS } from "../../../shared/rules/spells.ts";
import { flavour, has as hasFlavour, hash, listing } from "../../../shared/fight/flavour.ts";
import { areaTiles, clearShot, explore, FEET, feetBetween, findPath, fromFeet, fromKey, key, line, neighbours, rangeFeet, same, solid, steps, toFeet, type PathRules } from "../../../shared/fight/grid.ts";
import type { FightBoard, FightEvent, FightEventDetail, FightEventKind, FightHit, FightOutcome, Prop, Unit, UnitState } from "../../../shared/fight/types.ts";
import type { TileMap, Tile2 } from "../../../shared/map/types.ts";
import { captionOf } from "./caption.ts";
import { diceLines, signed, type EngineCombatant, type Namer, type Table } from "./rules.ts";

/**
 * The rules of a fight on the map, as operations on the board: whose turn it is, moving a step at a
 * time (opportunity attacks as you leave someone's reach), weapon attacks (Sallow parries), spells
 * laid on tiles, dash, dodge, disengage, the grain dust (fire there explodes, for everyone in it),
 * fire that spreads along the sacks, falling, death saves, surrender, and how it ends. The dice and
 * the D&D bookkeeping are the engine's; this is the board around them.
 *
 * One Skirmish per move (a reducer's call): made over the fight's board and the move's Table, it does
 * its work and writes moments as it goes; done() keeps the projection in step with the engine and
 * hands the moments over. Every operation returns an error message, or undefined when it happened.
 */

const OFF_MAP = { x: -5000, y: -5000 };
const INCAPACITATING = /unconscious|paralyz|stunned|petrified|incapacitated|held-/;
const ordinal = (n: number) => ["cantrip", "1st", "2nd", "3rd"][n] ?? `${n}th`;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const possessive = (name: string) => (name === "you" ? "your" : name.endsWith("s") ? `${name}'` : `${name}'s`);
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/, "");
/** The engine's refusal of a cast, in the game's words: its first swing wanting the action too (Spiritual Weapon), or the rest without the engine's notes. */
function castRefused(name: string, said: string, you: boolean): string {
  if (/cannot hurl .*action already used/.test(said)) return `${name} takes ${you ? "your" : "their"} action as well as the bonus action (its first swing), and ${you ? "your" : "their"} action's spent this turn.`;
  return `${name} can't be cast like that: ${said.replace(/\s*\(RAW:[^)]*\)/g, "").replace(/^.*? cannot /, you ? "you can't " : "they can't ")}.`.replace(/\.\.$/, ".");
}
/** Buffs cast on a foe: the caster marks them. */
const FOE_MARKS = new Set(["hunters-mark", "hex"]);

/** A class feature to use in a fight (the engine's own option for it): what it's called, what it spends, whom it takes, and whether it can be used now (and why not, in words). */
export interface FeatureChoice { id: string; name: string; cost: "bonus" | "action" | "free"; target: "self" | "creature" | "none"; enabled: boolean; why?: string }

/** The engine's option lists, by the encounter (its module's own exports: bonusActions, actionOptions). */
type OptionList = (state: unknown, content: unknown, encounterId: string, characterId: string) => Array<{ id: string; label: string; target: string; enabled: boolean; reason?: string }>;

/** The engine's options the board has acts of its own for (a shove, a grab, Dash), or that it can't play yet (hiding, readying, a word with weight): not offered as features. */
const BOARD_HAS = new Set(["grapple", "shove", "help", "hide", "influence", "ready", "search", "study", "utilize", "cunning-action-hide", "nimble-escape-hide"]);

/** Words with weight in a fight: the skills a threat, a plea or a lie is (all Charisma). */
export type TalkSkill = "intimidation" | "persuasion" | "deception";
export const TALK_SKILLS: Record<TalkSkill, string> = { intimidation: "Intimidation", persuasion: "Persuasion", deception: "Deception" };

/** Why the engine says a feature can't be used now, in the game's words. */
function featureWhy(code: string, you: boolean): string {
  const them = you ? "You've" : "They've";
  switch (code) {
    case "bonus-action-used": return `${them} used ${you ? "your" : "their"} bonus action this turn.`;
    case "action-used": return `${them} used ${you ? "your" : "their"} action this turn.`;
    case "not-your-turn": return "It isn't their turn.";
    case "no-uses": return `${them} none of it left until ${you ? "you" : "they"} rest.`;
    case "no-focus": return `${them} no focus points left.`;
    case "already-dashed": return `${them} dashed this turn already.`;
    case "already-disengaged": return `${them} disengaged this turn already.`;
    default: return `Not now: ${code.replace(/-/g, " ")}.`;
  }
}
/** The sheet's attack bonus with a weapon (the engine calls the instance weaponInstanceId; the typings say instanceId). */
export function attackBonus(sheet: Dnd.CharacterSheet, weapon: string): number {
  const of = (a: Dnd.CharacterSheet["attacks"][number]) => (a as { weaponInstanceId?: string }).weaponInstanceId ?? a.instanceId;
  return sheet.attacks.find(a => of(a) === weapon)?.attackBonus ?? sheet.attacks[0]?.attackBonus ?? 0;
}

/**
 * `hurls`: a bonus-action spell that makes its attack as it's cast and lasts (Spiritual Weapon):
 * the engine wants the action unspent too, for that first swing.
 */
export interface SpellChoice { id: string; name: string; level: number; slot: number; spell: Dnd.SpellDef; targeting: "unit" | "area" | "self"; range: number; fire: boolean; heal: boolean; bonus: boolean; hurls: boolean }

/** The board with its map: what the rules read (the prototype's G). */
export type Field = FightBoard & { map: TileMap };

/** How someone stood as a moment began: its hits are what changed. */
interface Snap { hp: number; state: UnitState; conditions: string[]; at: Tile2 }

/** A moment being written. */
interface Draft {
  kind: FightEventKind;
  actor?: string;
  target?: string;
  caption?: string;
  round: number;
  turn: string;
  detail: FightEventDetail;
  before: Record<string, Snap>;
  damage: Record<string, Array<{ amount: number; type: string }>>;
  healed: Record<string, number>;
  saves: Record<string, boolean>;
}

/** A moment as the Skirmish wrote it: a FightEvent but its number, which the rows give it. */
export type Moment = Omit<FightEvent, "seq">;

/** Kinds of moment that say something even with no lines in them; the rest, with nothing in them, aren't kept. */
const ALWAYS: ReadonlySet<FightEventKind> = new Set(["start", "turn", "move", "attack", "cast", "dash", "dodge", "disengage", "wrestle", "use", "yield", "flee", "walk-off", "arrest", "pass", "over", "arrive"]);

export class Skirmish {
  readonly G: Field;
  readonly t: Table;
  private readonly moments: Moment[] = [];
  private current?: Draft;

  constructor(G: Field, t: Table) {
    this.G = G;
    this.t = t;
  }

  /** Keep the projection in step with the engine, close the moment being written, and hand over the moments. */
  done(): Moment[] {
    this.refresh();
    this.closeMoment();
    return this.moments.splice(0);
  }

  // -------------------------------------------------------------------------------------------
  // Looking at the board.

  get units(): Unit[] { return Object.values(this.G.units); }
  unit(id: string): Unit | undefined { return this.G.units[id]; }
  pc(): Unit { return this.G.units[this.G.pc]!; }
  activeUnit(): Unit | undefined { return this.G.units[this.G.order[this.G.active] ?? ""]; }
  byEngine(id: string): Unit | undefined { return this.units.find(u => u.engineId === id); }
  isYou(u: Unit): boolean { return u.id === this.G.pc; }
  you(u: Unit): { called: string; you: boolean; weapon: string } { return { called: this.isYou(u) ? "you" : u.called, you: this.isYou(u), weapon: u.weaponName ?? (u.weapons[0] ? this.t.itemName(u.weapons[0]) : "weapon") }; }

  private team(u: Unit): number { return u.side === "player" || u.side === "ally" ? 1 : u.side === "enemy" ? 2 : 0; }
  friendly(a: Unit, b: Unit): boolean { return this.team(a) !== 0 && this.team(a) === this.team(b); }
  hostile(a: Unit, b: Unit): boolean { return this.team(a) !== 0 && this.team(b) !== 0 && this.team(a) !== this.team(b); }
  /** On neither side: keeping out of it, or running from it. */
  neutral(u: Unit): boolean { return this.team(u) === 0 && u.id !== this.G.pc; }
  /**
   * Whom someone's menu turns their weapons on: the other side, but not a child running for the door.
   * The player's, anyone up who isn't on theirs (smoke4-1018: Cob kept clear of the fight Krug
   * started by swinging at him, and the board gave no blow at him at all): the running and those
   * keeping out of it too.
   */
  targetable(u: Unit, v: Unit): boolean {
    if (v.id === u.id || v.state !== "fighting") return false;
    return this.isYou(u) ? this.hostile(u, v) || this.neutral(v) : this.hostile(u, v) && v.role !== "coward";
  }
  /**
   * Someone keeping out of it whom the player attacks, shoves, grabs or casts at is in it now,
   * against them, with whatever's to hand (a brawler). One running keeps running.
   */
  private provoked(u: Unit, target: Unit): void {
    if (!this.isYou(u) || target.role !== "bystander" || !this.neutral(target)) return;
    target.side = "enemy";
    target.role = "brawler";
    this.log("narration", `${cap(target.called)} isn't keeping out of it any more.`, target.id);
  }
  /** On the map at all (the fled are gone; the fallen lie where they fell). */
  onBoard(u: Unit): boolean { return u.state !== "fled" && u.state !== "coming"; }
  /** Standing, in the fight, and able to do something about it. */
  able(u: Unit): boolean { return u.state === "fighting" && !u.conditions.some(c => INCAPACITATING.test(c)); }
  occupant(t: Tile2, except?: string): Unit | undefined { return this.units.find(u => u.id !== except && this.onBoard(u) && same(u.at, t)); }
  fireAt(t: Tile2): boolean { return this.G.fire.includes(key(t)); }
  dustAt(t: Tile2): boolean { return this.G.dust.includes(key(t)); }
  hotAt(t: Tile2): boolean { return this.G.fire.some(k => steps(fromKey(k), t) <= 1); }
  exitAt(t: Tile2): { at: Tile2; label: string } | undefined { return this.G.exits.find(e => same(e.at, t)); }
  /** In the place's own tiles (all the map's, when the place is the map). */
  inArea(t: Tile2): boolean { const a = this.G.area; return !a || (t.x >= a.x && t.y >= a.y && t.x < a.x + a.w && t.y < a.y + a.h); }
  isTurnOf(u: Unit): boolean { return this.activeUnit()?.id === u.id; }

  combatant(u: Unit): EngineCombatant | undefined {
    return this.t.encounter(this.G.encounterId)?.combatants.find(c => c.combatantId === u.engineId);
  }
  usage(u: Unit): EngineCombatant["turnUsage"] | undefined { return this.combatant(u)?.turnUsage; }
  reactionReady(u: Unit): boolean { return this.usage(u)?.reactionUsedThisRound === false; }
  actionLeft(u: Unit): boolean { const use = this.usage(u); return !!use && !use.actionUsed; }

  /**
   * Feet of movement left this turn (dashing doubles it; getting up off the floor this turn cost
   * half, and so does lying there; held in a grip, there's none).
   */
  movementLeft(u: Unit): number {
    const use = this.usage(u);
    if (!use || !this.isTurnOf(u) || !this.able(u) || u.conditions.includes("grappled")) return 0;
    const standUp = u.conditions.includes("prone") || this.G.flags[`stood:${u.id}`] === this.turnToken() ? Math.floor(u.speed / 2) : 0;
    return Math.max(0, u.speed * (use.dashed ? 2 : 1) - use.feetMovedThisTurn - standUp);
  }

  /** This turn, as "round:index" (whose turn it is, and when). */
  turnToken(): string { return `${this.G.round}:${this.G.active}`; }

  /** Walls and standing enemies block; friends and the fallen can be passed but not stopped on; fire is avoided. */
  pathRules(u: Unit, options: { avoidFire?: boolean; avoidDust?: boolean } = {}): PathRules {
    return {
      blocked: t => { if (!this.inArea(t) && !this.exitAt(t)) return true; const o = this.occupant(t, u.id); return !!o && o.state === "fighting" && this.hostile(u, o); },
      noStop: t => !!this.occupant(t, u.id),
      penalty: t => (options.avoidFire !== false && this.hotAt(t) ? 6 : 0) + (options.avoidDust && this.dustAt(t) ? 3 : 0),
    };
  }

  /** Tiles u can end a move on this turn. */
  moveTargets(u: Unit): Tile2[] {
    const left = Math.floor(this.movementLeft(u) / FEET);
    if (!left) return [];
    const seen = explore(this.G.map, u.at, { ...this.pathRules(u, { avoidFire: false }), maxSteps: left });
    return [...seen.keys()].map(fromKey).filter(t => !same(t, u.at) && !this.occupant(t, u.id));
  }

  namer(): Namer {
    return {
      called: id => { const u = this.byEngine(id); return u ? (this.isYou(u) ? "you" : u.called) : this.t.char(id)?.name ?? "someone"; },
      isPc: id => id === this.pc().engineId,
      weapon: instanceId => this.units.find(u => u.weapons[0] === instanceId && u.weaponName)?.weaponName ?? this.t.itemName(instanceId),
      hp: id => this.byEngine(id),
    };
  }

  // -------------------------------------------------------------------------------------------
  // The moments (docs/combat-design.md §3): each act writes one, the screen plays them in order.

  /** A new moment: whatever was being written is closed first. How everyone stands now is kept, so its hits are what changes in it. */
  moment(kind: FightEventKind, actor?: Unit, detail: Partial<FightEventDetail> = {}, caption?: string): void {
    this.closeMoment();
    this.refresh();
    const before: Record<string, Snap> = {};
    for (const u of this.units) before[u.id] = { hp: u.hp, state: u.state, conditions: [...u.conditions], at: { ...u.at } };
    this.current = {
      kind, round: this.G.round, turn: this.activeUnit()?.id ?? "",
      ...(actor ? { actor: actor.id } : {}), ...(detail.target ? { target: detail.target } : {}), ...(caption ? { caption } : {}),
      detail: { rolls: [], hits: [], lines: [], ...detail }, before, damage: {}, healed: {}, saves: {},
    };
  }

  /** The moment being written, closed: what changed in it as its hits, its caption, and kept (unless there was nothing in it). */
  closeMoment(): void {
    const d = this.current;
    if (!d) return;
    this.current = undefined;
    this.refresh();
    d.detail.hits = this.hitsOf(d);
    if (!ALWAYS.has(d.kind) && !d.detail.lines.length && !d.detail.hits.length) return;
    const moment: Moment = { round: d.round, turn: d.turn, kind: d.kind, ...(d.actor ? { actor: d.actor } : {}), ...(d.target ? { target: d.target } : {}), caption: "", detail: d.detail };
    moment.caption = d.caption ?? captionOf(moment, this.G);
    this.moments.push(moment);
  }

  /** A moment's details so far (one is opened for lines said outside any). */
  private draft(who?: string): Draft {
    if (!this.current) this.moment("say", who ? this.unit(who) : undefined);
    return this.current!;
  }

  /** Who changed in a moment: their damage, healing and saves as the engine reported them, their hit points and state now, a fall, conditions gained and lost, a push. */
  private hitsOf(d: Draft): FightHit[] {
    const hits: FightHit[] = [];
    for (const u of this.units) {
      const was = d.before[u.id];
      if (!was) continue;
      const damage = d.damage[u.id] ?? [];
      const healed = d.healed[u.id] ?? 0;
      const gained = u.conditions.filter(c => !was.conditions.includes(c) && shown(c));
      const lost = was.conditions.filter(c => !u.conditions.includes(c) && shown(c));
      const moved = !same(was.at, u.at) && u.id !== d.actor;
      const changed = damage.length || healed || was.hp !== u.hp || was.state !== u.state || gained.length || lost.length || moved || d.saves[u.id] !== undefined;
      if (!changed) continue;
      hits.push({
        unit: u.id, damage, healed, ...(d.saves[u.id] !== undefined ? { saved: d.saves[u.id]! } : {}), hp: u.hp, maxHp: u.maxHp, state: u.state,
        fell: was.state === "fighting" && (u.state === "down" || u.state === "dead"), gained, lost, ...(moved ? { movedTo: { ...u.at } } : {}),
        was: { hp: was.hp, state: was.state, at: { ...was.at } },
      });
    }
    return hits;
  }

  log(_kind: "dice" | "narration" | "turn" | "system", text: string, who?: string): void {
    this.draft(who).detail.lines.push(text);
  }

  /** The engine's events: their dice lines in the moment, and what they did (the rolls, the damage, the saves, the healing) in its details. */
  dice(events: Dnd.EngineEvent[], label?: string, why?: { advantage?: string; disadvantage?: string }): void {
    const d = this.draft();
    for (const e of events) this.note(d, e, label);
    for (const line of diceLines(this.t, events, this.namer(), label, why)) this.log("dice", line);
  }

  /**
   * Why a blow from u at the target would have advantage or disadvantage, as far as the fight can
   * tell (the engine says only which it had): for advantage, a pack's friend beside the target (Pack
   * Tactics, the Crakes' and the wolves'), the target on the floor or out cold within reach; for
   * disadvantage, a shot at long range or with someone beside the shooter, at someone on the floor,
   * at someone dodging, or from the floor. Each undefined when it knows of nothing.
   */
  attackWhy(u: Unit, target: Unit, check: { melee: boolean; packed: boolean; advantage?: "advantage" | "disadvantage" }): { advantage?: string; disadvantage?: string } {
    const they = target.id === this.G.pc ? "you're" : "they're";
    const up: string[] = [], down: string[] = [];
    const me = this.t.char(u.engineId);
    const traits = ((me?.statblockId ? this.t.kit.engine.content.monsters.get(me.statblockId)?.traits : undefined) ?? []) as unknown[];
    if (check.packed && traits.some(tr => JSON.stringify(tr).includes("attackerHasAllyAdjacentToTarget"))) up.push("Pack Tactics, a friend beside them");
    const close = check.melee && steps(u.at, target.at) <= 1;
    if (close && target.conditions.includes("unconscious")) up.push(`${they} out cold`);
    else if (close && target.conditions.includes("prone")) up.push(`${they} on the floor`);
    if (!check.melee && check.advantage === "disadvantage") down.push("long range");
    if (!check.melee && this.units.some(v => this.hostile(u, v) && this.able(v) && steps(v.at, u.at) <= 1)) down.push(`${u.id === this.G.pc ? "someone's" : "a foe's"} beside ${u.id === this.G.pc ? "you" : "them"}`);
    if (!check.melee && target.conditions.includes("prone")) down.push(`${they} on the floor`);
    if (target.conditions.some(c => c === "dodged" || c === "dodging")) down.push(`${they} dodging`);
    if (u.conditions.includes("prone")) down.push(`${check.melee ? "swinging" : "shooting"} from the floor`);
    return { ...(up.length ? { advantage: up.join("; ") } : {}), ...(down.length ? { disadvantage: down.join("; ") } : {}) };
  }

  private note(d: Draft, e: Dnd.EngineEvent, label?: string): void {
    const unit = (k: string) => this.byEngine(String(e[k]))?.id;
    switch (e.type) {
      case "AttackRolled": {
        const by = unit("attackerId"), target = unit("targetId");
        if (!by || !target) return;
        const used = e["used"] === "advantage" || e["used"] === "disadvantage" ? { advantage: e["used"] as "advantage" | "disadvantage" } : {};
        d.detail.rolls.push({
          by, target, with: label ?? this.namer().weapon(String(e["weaponInstanceId"])), d20: (e["d20"] as number[]) ?? [], bonus: Number(e["attackBonus"] ?? 0),
          total: Number(e["total"] ?? 0), ac: Number(e["targetAC"] ?? 0), hit: e["hit"] === true, critical: e["critical"] === true, ...used,
          ...(e["isOpportunityAttack"] ? { opportunity: true } : {}),
        });
        return;
      }
      case "DamageApplied": {
        const target = unit("targetId");
        if (target) (d.damage[target] ??= []).push(...(e["components"] as Array<{ amount: number; type: string }>).map(c => ({ amount: Number(c.amount), type: String(c.type) })));
        return;
      }
      case "Healed": {
        const target = unit("targetId");
        if (target) d.healed[target] = (d.healed[target] ?? 0) + Number(e["amount"] ?? 0);
        return;
      }
      case "SaveRolled": {
        const target = unit("targetId");
        if (target) d.saves[target] = e["success"] === true;
        return;
      }
    }
  }

  say(kind: string, who?: Unit, salt: string | number = ""): void {
    // Its lines are the fight's place's: the map's own where it has them (Caerwyn's street), and named for where it is (the Arena).
    const line = flavour(kind, hash(this.G.round, this.lineCount(), kind, who?.id ?? "", salt), who ? this.you(who) : undefined, { map: this.G.map.id, place: this.G.place });
    if (line) this.log("narration", line, who?.id);
  }
  /** How many lines the fight has said so far this move: a flavour line's salt, as the prototype's log length was. */
  private lineCount(): number { return this.moments.reduce((n, m) => n + m.detail.lines.length, this.current?.detail.lines.length ?? 0) + this.G.round * 101; }
  event(type: string, rest: Record<string, unknown>): Dnd.EngineEvent { return this.t.event(type, rest); }

  // -------------------------------------------------------------------------------------------
  // Keeping the projection in step with the engine.

  refresh(): void {
    for (const u of this.units) {
      const c = this.t.char(u.engineId);
      if (!c) continue;
      const hp = Math.max(0, c.hp.current);
      if (hp < u.hp) u.wounded = true;
      u.hp = hp;
      u.maxHp = c.hp.max;
      u.conditions = c.appliedConditions.map(a => a.conditionId);
      if (this.isYou(u)) u.deathSaves = { successes: c.deathSaves.successes, failures: c.deathSaves.failures, stable: c.deathSaves.stable };
      const pos = this.combatant(u)?.position;
      if (pos && (u.state === "fighting" || u.state === "down") && pos.x > OFF_MAP.x / 2) {
        const tile = fromFeet(pos);
        if (!same(tile, u.at)) this.settlePosition(u, tile);
      }
    }
  }

  /** Something moved them (a push): keep them on the map and out of the walls. */
  private settlePosition(u: Unit, tile: Tile2): void {
    let at = tile;
    if (solid(this.G.map, at) || this.occupant(at, u.id)) {
      const back = line(at, u.at).find(t => !solid(this.G.map, t) && !this.occupant(t, u.id));
      at = back ?? u.at;
    }
    u.at = at;
    const pos = this.combatant(u)?.position;
    if (pos && !same(fromFeet(pos), at)) {
      try { this.t.plan("placeCombatant", { encounterId: this.G.encounterId, combatantId: u.engineId, position: toFeet(at) }); } catch { /* it stays where the engine has it */ }
    }
  }

  /** After anything that can hurt: who fell, who got up, what was dropped, and is it over. */
  settle(): void {
    const before = new Map(this.units.map(u => [u.id, u.hp]));
    this.refresh();
    for (const u of this.units) {
      const c = this.t.char(u.engineId);
      if (!c || !this.onBoard(u)) continue;
      if ((before.get(u.id) ?? 0) > u.hp) for (const p of Object.values(this.G.props).filter(p => p.carriedBy === u.id)) this.dropLantern(p, u);
      if (c.hp.current <= 0 && u.state === "fighting") this.fall(u, c);
      else if (u.state === "down" && c.hp.current > 0) this.rise(u);
      else if (this.isYou(u) && u.state === "down") this.pcDeathState(c);
    }
    this.loosen();
    this.checkOutcome();
  }

  /**
   * A grip lasts while whoever holds it can and is beside them: someone down, gone or stepped away
   * lets go (the engine keeps the grappled condition; who holds it is the fight's to know).
   */
  private loosen(): void {
    for (const u of this.units) {
      const by = this.G.flags[`grappler:${u.id}`];
      if (typeof by !== "string") continue;
      const holder = this.unit(by);
      if (holder && this.able(holder) && u.state === "fighting" && steps(holder.at, u.at) <= 1) continue;
      delete this.G.flags[`grappler:${u.id}`];
      if (!this.t.char(u.engineId)?.appliedConditions.some(a => a.conditionId === "grappled")) continue;
      this.t.apply([this.event("ConditionRemoved", { targetId: u.engineId, conditionId: "grappled" })]);
      if (u.state === "fighting") this.log("narration", `${cap(this.you(u).called)} ${this.isYou(u) ? "are" : "is"} free of the grip.`, u.id);
      this.refresh();
    }
  }

  private fall(u: Unit, c: Dnd.EngineCharacter): void {
    // Massive damage kills a grown combatant outright; the player can't die in this fight (the story
    // needs them), and nobody kills the lantern-boy: he's knocked flat.
    const dead = c.deathSaves.failures >= 3 && !this.isYou(u) && u.role !== "coward" && u.role !== "bystander";
    u.state = dead ? "dead" : "down";
    if (u.side === "enemy") this.G.flags["last_out"] = "beaten";
    if (!c.appliedConditions.some(a => a.conditionId === "unconscious")) this.t.apply([this.event("ConditionApplied", { targetId: u.engineId, conditionId: "unconscious", appliedConditionId: (this.t.kit.E as unknown as { newAppliedConditionId(): string }).newAppliedConditionId() })]);
    // Everyone but the player is out cold, not dying: no death saves for them.
    if (!this.isYou(u) && !dead) this.t.apply([this.event("Stabilized", { targetId: u.engineId })]);
    if (dead) this.log("narration", `${cap(u.called)} is dead.`, u.id);
    else this.say(this.isYou(u) ? (this.G.dust.length ? "down:player" : "down:player:clean") : u.castId && hasFlavour(`down:${u.castId}`) ? `down:${u.castId}` : "down:any", u);
    if (this.isYou(u)) {
      this.log("system", "You're down. At the start of each of your turns you make a death save: three successes and you're stable, a natural 20 and you're back up. (In this story you can't die in the fight, but it can come close.)", u.id);
      if (c.deathSaves.failures >= 3) this.pcDeathState(c);
    }
    this.refresh();
  }

  private rise(u: Unit): void {
    u.state = "fighting";
    if (u.conditions.includes("unconscious")) this.t.apply([this.event("ConditionRemoved", { targetId: u.engineId, conditionId: "unconscious" })]);
    if (this.isYou(u)) this.say("rise:player", u);
    else this.log("narration", `${cap(u.called)} is back on ${u.side === "enemy" ? "their" : "her"} feet.`, u.id);
    this.refresh();
  }

  private pcDeathState(c: Dnd.EngineCharacter): void {
    if (c.deathSaves.failures >= 3 && !this.G.flags["pc_dying"]) { this.G.flags["pc_dying"] = true; this.say("dying:player", this.pc()); }
    else if (c.deathSaves.stable && !this.G.flags["pc_stable"]) { this.G.flags["pc_stable"] = true; this.say("stable:player", this.pc()); }
  }

  // -------------------------------------------------------------------------------------------
  // Turns.

  /** A turn's end: the engine's turn moves on, past anyone who can't take one. What the round's end brings (the fire spreading) is a moment of its own. */
  advance(): void {
    for (let guard = 0; guard < this.G.order.length * 2 + 2; guard++) {
      let events: Dnd.EngineEvent[];
      try { events = this.t.plan("advanceTurn", { encounterId: this.G.encounterId }); } catch (e) { this.log("system", `(The turn wouldn't pass: ${reason(e)})`); return; }
      const enc = this.t.encounter(this.G.encounterId)!;
      const now = this.byEngine(enc.combatants[enc.activeIndex]!.combatantId);
      if (now) this.G.active = this.G.order.indexOf(now.id);
      if (events.some(e => e.type === "RoundEnded")) { this.G.round = enc.round; this.endOfRound(); }
      this.G.round = enc.round;
      // A death save belongs to the turn it starts: shown in that turn's moment, and what it leads to
      // (back up, stable, dying) is settled there too (beginTurn).
      const saves = diceLines(this.t, events.filter(e => e.type === "DeathSaveRolled"), this.namer());
      if (saves.length) this.G.queued = [...(this.G.queued ?? []), ...saves];
      if (this.G.outcome) return;
      if (now && this.takesTurn(now)) return;
    }
  }

  takesTurn(u: Unit): boolean { return u.state === "fighting" || (this.isYou(u) && u.state === "down"); }

  /** A turn's start: its moment, and what the fire does to them. Once per turn, even when it's asked twice. */
  beginTurn(): void {
    const u = this.activeUnit();
    if (!u || this.G.outcome) return;
    const token = `${this.G.round}:${this.G.active}`;
    if (this.G.begun === token) return;
    this.G.begun = token;
    this.moment("turn", u);
    for (const line of this.G.queued ?? []) this.log("dice", line, u.id);
    delete this.G.queued;
    // Dodging lasts until the start of your next turn (the engine's condition never ends by itself).
    const dodging = this.t.char(u.engineId)?.appliedConditions.filter(a => a.conditionId === "dodged") ?? [];
    if (dodging.length) this.t.apply(dodging.map(() => this.event("ConditionRemoved", { targetId: u.engineId, conditionId: "dodged" })));
    if (this.onBoard(u) && this.hotAt(u.at)) this.scorch(u);
    this.settle();
    this.standUp(u);
    this.holdBack(u);
    if (this.isYou(u) && u.state === "down" && !this.G.flags["pc_dying"] && !u.deathSaves?.stable) this.log("system", "You're on the floor, fighting for breath.", u.id);
  }

  /**
   * Knocked flat (a shove, Grease), they get up as their turn starts, for half their movement (the
   * engine leaves standing up to the board).
   */
  private standUp(u: Unit): void {
    if (!this.able(u) || !this.t.char(u.engineId)?.appliedConditions.some(a => a.conditionId === "prone")) return;
    this.t.apply([this.event("ConditionRemoved", { targetId: u.engineId, conditionId: "prone" })]);
    this.G.flags[`stood:${u.id}`] = this.turnToken();
    this.refresh();
    if (this.isYou(u)) this.log("system", "You get up off the floor: that's half your movement.", u.id);
    else this.log("narration", `${cap(u.called)} gets up off the floor.`, u.id);
  }

  /** Urged to hold back (V13's Influence, when it comes), and the dice agreed: this turn goes by. */
  private holdBack(u: Unit): void {
    if (this.G.flags[`urged:${u.id}`] !== "hold" || !this.able(u)) return;
    delete this.G.flags[`urged:${u.id}`];
    this.G.flags[`holding:${u.id}`] = this.turnToken();
    this.log("narration", `${cap(u.called)} hangs back, in two minds about the whole thing.`, u.id);
  }

  /** Holding back this turn (holdBack): the AI lets it go by. */
  holding(u: Unit): boolean { return this.G.flags[`holding:${u.id}`] === this.turnToken(); }

  private endOfRound(): void {
    this.moment("hazard");
    this.spreadFire();
    this.closeMoment();
    this.arrivals();
  }

  /**
   * The scene's reinforcements whose round it is (docs/combat-gm.md; the user: "the guards come after a
   * few turns or a round"): each in at the way in (on its tile, or the nearest free one to it), on
   * the board and in the fight from now on, their turns their place in the order; one moment for
   * everyone coming in together, with why they came.
   */
  private arrivals(): void {
    const due = this.units.filter(u => u.state === "coming" && (u.due ?? 0) <= this.G.round);
    if (!due.length) return;
    const way = this.G.exits.find(e => same(e.at, due[0]!.at)) ?? this.G.exits[0];
    this.moment("arrive", undefined, { with: way?.label ?? "the way in" });
    for (const u of due) {
      const at = this.freeNear(u.at);
      u.state = "fighting";
      u.at = at;
      try { this.t.plan("placeCombatant", { encounterId: this.G.encounterId, combatantId: u.engineId, position: toFeet(at) }); } catch { /* the board's own place stands */ }
    }
    for (const why of [...new Set(due.map(u => u.why).filter((w): w is string => !!w))]) this.log("narration", why);
    this.closeMoment();
  }

  /**
   * The nearest tile to `t` someone can stand on and nobody's on (t itself, if it is), a walk away
   * (never through a wall), in the place's area or on a way out of it (smoke7-1018: the gate taken,
   * Old Wat came in in the lane, out of everyone's reach).
   */
  private freeNear(t: Tile2): Tile2 {
    const queue: Tile2[] = [t];
    const seen = new Set<string>([key(t)]);
    for (let i = 0; i < queue.length && i < 400; i++) {
      const at = queue[i]!;
      if (solid(this.G.map, at)) continue;
      if (!this.occupant(at) && (this.inArea(at) || this.exitAt(at))) return at;
      for (const n of neighbours(this.G.map, at)) if (!seen.has(key(n))) { seen.add(key(n)); queue.push(n); }
    }
    return t;
  }

  // -------------------------------------------------------------------------------------------
  // Moving.

  move(u: Unit, to: Tile2): string | undefined {
    if (!this.isTurnOf(u)) return `It isn't ${this.isYou(u) ? "your" : `${u.called}'s`} turn.`;
    if (!this.able(u)) return `${cap(this.you(u).called)} can't move.`;
    if (same(u.at, to)) return undefined;
    if (solid(this.G.map, to)) return "Nobody can stand there.";
    if (this.occupant(to, u.id)) return "Someone's already standing there.";
    const path = findPath(this.G.map, u.at, to, { ...this.pathRules(u, { avoidFire: false }) });
    if (!path) return "There's no way through.";
    const left = this.movementLeft(u);
    if (path.length * FEET > left) return `That's ${path.length * FEET} ft, and ${this.isYou(u) ? "you have" : "they have"} ${left} ft of movement left.`;
    const start = u.at;
    this.moment("move", u, { from: { ...u.at }, path: [] });
    for (let i = 0; i < path.length; ) {
      // Through a friend's space (or over a body) in one hop: you can pass, not stop.
      let j = i;
      while (j < path.length - 1 && this.occupant(path[j]!, u.id)) j++;
      const step = path[j]!;
      let events: Dnd.EngineEvent[];
      try { events = this.t.plan("move", { combatantId: u.engineId, to: toFeet(step) }); } catch (e) { this.log("system", `(${cap(this.you(u).called)} stop${this.isYou(u) ? "" : "s"}: ${reason(e)})`); break; }
      for (let k = i; k <= j; k++) this.draft().detail.path!.push({ ...path[k]! });
      u.at = step;
      const swings = events.filter(e => e.type === "OpportunityAvailable");
      for (const oa of swings) {
        const reactor = this.byEngine(String(oa["reactorId"]));
        if (reactor && this.hostile(reactor, u) && this.able(reactor)) this.opportunity(reactor, u);
        if (u.state !== "fighting") break;
      }
      if (u.state !== "fighting") break;
      // The swings were moments of their own: what's left of the move is another.
      if (swings.length && j < path.length - 1 && this.current?.kind !== "move") this.moment("move", u, { from: { ...u.at }, path: [] });
      i = j + 1;
    }
    if (this.isYou(u) && !same(start, u.at) && this.current?.kind === "move") this.log("system", `You move ${steps(start, u.at) * FEET} ft (${this.movementLeft(u)} ft left).`, u.id);
    this.settle();
    return undefined;
  }

  private opportunity(reactor: Unit, target: Unit): void {
    const weapon = reactor.weapons.find(w => this.t.item(w)?.attackKind === "melee");
    if (!weapon || !this.reactionReady(reactor)) return;
    this.moment("attack", reactor, { target: target.id, at: { ...target.at }, with: this.namer().weapon(weapon) });
    try {
      const events = this.t.plan("opportunityAttack", { reactorId: reactor.engineId, targetId: target.engineId, weaponInstanceId: weapon });
      this.log("narration", `${cap(this.you(reactor).called)} take${this.isYou(reactor) ? "" : "s"} a swing as ${this.you(target).called} go${this.isYou(target) ? "" : "es"} past.`, reactor.id);
      this.dice(events);
      this.settle();
      this.closeMoment();
    } catch { this.current = undefined; /* no reaction to spend after all */ }
  }

  // -------------------------------------------------------------------------------------------
  // Weapons.

  /** Can u hit target with weapon from here, and on what terms? */
  attackCheck(u: Unit, target: { at: Tile2; id: string }, weapon: string): { error?: string; melee: boolean; advantage?: "advantage" | "disadvantage"; cover?: "half"; packed: boolean } {
    const item = this.t.item(weapon);
    const melee = item?.attackKind !== "ranged";
    const dist = feetBetween(u.at, target.at);
    const name = this.unit(target.id)?.called ?? this.G.props[target.id]?.name ?? "that";
    if (melee) {
      const reach = item?.properties?.includes("reach") ? 10 : 5;
      if (dist > reach) return { error: `${cap(name)} is out of reach (${dist} ft; ${item?.name ?? "it"} reaches ${reach} ft).`, melee, packed: false };
    } else {
      const normal = Number(item?.["rangeNormal"] ?? 30), long = Number(item?.["rangeLong"] ?? normal);
      if (dist > long) return { error: `${cap(name)} is out of range (${dist} ft).`, melee, packed: false };
      if (!clearShot(this.G.map, u.at, target.at)) return { error: `There's no clear shot at ${name} from here.`, melee, packed: false };
    }
    const between = melee ? [] : line(u.at, target.at).slice(1, -1).filter(t => { const o = this.occupant(t); return !!o && o.state === "fighting"; });
    const packed = this.units.some(o => o.id !== u.id && o.id !== target.id && this.friendly(o, u) && this.able(o) && steps(o.at, target.at) <= 1);
    const far = !melee && dist > Number(item?.["rangeNormal"] ?? 30);
    return { melee, packed, ...(far ? { advantage: "disadvantage" as const } : {}), ...(between.length ? { cover: "half" as const } : {}) };
  }

  /**
   * What u can pick up and swing that isn't a weapon (a bottle, a chair leg): the rules' unarmed
   * strike (1d4 bludgeoning), called what it is.
   */
  improvised(u: Unit): string | undefined {
    const me = this.t.char(u.engineId);
    return me?.inventory.find(i => this.t.state.itemInstances[i]?.definitionId === "unarmed-strike");
  }

  attack(u: Unit, targetId: string, weaponId?: string): string | undefined {
    if (!this.isTurnOf(u)) return "It isn't their turn.";
    if (!this.able(u)) return `${cap(this.you(u).called)} can't attack.`;
    // A fist or a boot is the rules' Unarmed Strike; a bottle or a stool, the same blow called what it is.
    const improvised = weaponId === "improvised" || weaponId === "unarmed";
    const weapon = improvised ? this.improvised(u) : weaponId && u.weapons.includes(weaponId) ? weaponId : u.weapons[0];
    if (!weapon) return improvised ? "There's nothing to hand to swing." : "Nothing to attack with.";
    const label = weaponId === "unarmed" ? "Unarmed Strike" : improvised ? "Improvised weapon" : undefined;
    const prop = this.G.props[targetId];
    if (prop) return this.attackProp(u, prop, weapon, label);
    const target = this.unit(targetId);
    if (!target || !this.onBoard(target) || target.state === "dead") return "There's nobody there to attack.";
    if (target.id === u.id) return "Attacking yourself is a matter for the Assizes.";
    const check = this.attackCheck(u, target, weapon);
    if (check.error) return check.error;
    const advantage = check.advantage;
    const why = this.attackWhy(u, target, check);
    const intent: Record<string, unknown> = {
      attackerId: u.engineId, targetId: target.engineId, weaponInstanceId: weapon, attackerHasAllyAdjacentToTarget: check.packed,
      ...(advantage ? { advantage } : {}), ...(check.cover ? { cover: check.cover } : {}),
    };
    this.moment("attack", u, { target: target.id, at: { ...target.at }, with: label ?? this.namer().weapon(weapon) });
    this.provoked(u, target);
    const say = this.isYou(u) ? undefined : `attack:${u.castId ?? u.role}`;
    if (say && hash(this.G.round, u.id, this.lineCount()) % 3 === 0) this.say(say, u);
    // A duellist's parry: the blade turns a hit that only just landed (his reaction, once a round).
    if (target.parry && check.melee && this.able(target) && this.reactionReady(target)) {
      let rolled: { events: Dnd.EngineEvent[]; roll: { hit: boolean } };
      try { rolled = (this.t.kit.plan["attackRoll"] as unknown as (s: Dnd.CampaignState, i: Record<string, unknown>) => typeof rolled)(this.t.state, intent); } catch (e) { this.current = undefined; return reason(e); }
      this.t.apply(rolled.events);
      const ev = rolled.events.find(e => e.type === "AttackRolled");
      const parried = rolled.roll.hit && !!ev && !ev["critical"] && Number(ev["total"]) < Number(ev["targetAC"]) + target.parry.bonus;
      if (parried) {
        this.t.apply([this.event("ActionEconomyConsumed", { encounterId: this.G.encounterId, combatantId: target.engineId, kind: "reaction" })]);
        const d = this.draft();
        for (const e of rolled.events) this.note(d, e, label);
        const roll = d.detail.rolls[d.detail.rolls.length - 1];
        if (roll) { roll.hit = false; roll.parried = true; }
        const [first, ...rest] = diceLines(this.t, rolled.events, this.namer(), label);
        this.log("dice", `${(first ?? "").replace(/: hit$/, "")}: parried! (the ${(target.weaponName ?? "blade").toLowerCase()} makes it AC ${Number(ev["targetAC"]) + target.parry.bonus})`);
        for (const l of rest) this.log("dice", l);
        this.log("narration", `${cap(target.called)} turns the blow aside with a flick of the ${(target.weaponName ?? "blade").toLowerCase()}, and looks faintly bored about it.`, target.id);
      } else {
        this.dice(rolled.events, label, why);
        const dmg = (this.t.kit.plan["attackDamage"] as unknown as (r: unknown) => { events: Dnd.EngineEvent[] })(rolled.roll);
        this.t.apply(dmg.events);
        this.dice(dmg.events);
      }
    } else {
      let events: Dnd.EngineEvent[];
      try { events = this.t.plan("attack", intent); } catch (e) { this.current = undefined; return reason(e); }
      this.dice(events, label, why);
    }
    this.settle();
    return undefined;
  }

  /** A blow or a shot at a thing (a lantern): the weapon's attack against its armour class. */
  private attackProp(u: Unit, prop: Prop, weapon: string, label?: string): string | undefined {
    if (prop.state !== "standing" || prop.carriedBy) return `The ${prop.name} isn't something you can hit now.`;
    const check = this.attackCheck(u, { at: prop.at, id: prop.id }, weapon);
    if (check.error) return check.error;
    const use = this.usage(u);
    if (use?.actionUsed && use.attacksMadeThisTurn === 0) return "You've already used your action this turn.";
    if (use && use.attacksMadeThisTurn >= this.attacksPerAction(u)) return "You've no attacks left this turn.";
    this.moment("attack", u, { target: prop.id, at: { ...prop.at }, with: label ?? this.namer().weapon(weapon) });
    this.t.apply([
      ...(use?.actionUsed ? [] : [this.event("ActionEconomyConsumed", { encounterId: this.G.encounterId, combatantId: u.engineId, kind: "action" })]),
      this.event("ActionEconomyConsumed", { encounterId: this.G.encounterId, combatantId: u.engineId, kind: "attack" }),
    ]);
    const bonus = attackBonus(this.t.sheet(u.engineId), weapon);
    const d20 = this.t.roll("1d20").total;
    const total = d20 + bonus;
    const hit = d20 === 20 || (d20 !== 1 && total >= prop.ac);
    this.draft().detail.rolls.push({ by: u.id, target: prop.id, with: label ?? this.namer().weapon(weapon), d20: [d20], bonus, total, ac: prop.ac, hit, critical: d20 === 20 });
    this.log("dice", `${label ?? this.namer().weapon(weapon)}: ${this.isYou(u) ? "your" : `${u.called}'s`} attack on the ${prop.name}: ${d20} ${signed(bonus)} = ${total} vs AC ${prop.ac}: ${hit ? "hit" : "miss"}`);
    if (hit) this.breakProp(prop, u);
    this.settle();
    return undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Spells.

  /** Slots of a level u has left. */
  freeSlots(u: Unit, level: number): number {
    const sheet = this.t.sheet(u.engineId);
    return (sheet.spellSlots.slotsByLevel[level - 1] ?? 0) - (this.t.char(u.engineId)?.spellSlotsUsed[String(level)] ?? 0);
  }

  /** The spells u can cast in this fight right now: ready, with a slot, and of a kind the map plays out. */
  spellChoices(u: Unit): SpellChoice[] {
    const sheet = this.t.sheet(u.engineId);
    const free = (l: number) => this.freeSlots(u, l);
    const out: SpellChoice[] = [];
    for (const group of sheet.spellcasting?.spellsByLevel ?? []) {
      for (const sp of group.spells) {
        if (group.level > 0 && !sp.prepared && !sp.alwaysPrepared) continue;
        const spell = this.t.kit.engine.content.spells.get(sp.spellId);
        // An action or bonus action the map plays out (the spell's card on the sheet says the same).
        if (!spell || !inFights(spell)) continue;
        const effects = spell.mechanicalEffects ?? [];
        const slot = spell.level === 0 ? 0 : [1, 2, 3, 4, 5, 6, 7, 8, 9].find(l => l >= spell.level && free(l) > 0) ?? -1;
        if (slot < 0) continue;
        const heal = effects.some(m => m.kind === "heal");
        // Marks are "buffs" the engine puts on the foe (Hunter's Mark, Hex): aimed at enemies, not friends.
        const buff = effects.some(m => m.kind === "buff") && !FOE_MARKS.has(spell.id);
        const range = rangeFeet(spell.range);
        out.push({
          id: spell.id, name: spell.name, level: spell.level, slot, spell, range,
          targeting: spell["targeting"] ? "area" : range === 0 && (heal || buff) ? "self" : "unit",
          fire: effects.some(m => m["damageType"] === "fire"), heal: heal || buff, bonus: /bonus/i.test(spell.castingTime),
          hurls: /bonus/i.test(spell.castingTime) && effects.some(m => m.kind === "attack") && spell.duration.trim().toLowerCase() !== "instantaneous",
        });
      }
    }
    return out;
  }

  /** The tiles a spell would cover if aimed at `at`. */
  spellArea(u: Unit, spell: Dnd.SpellDef, at: Tile2): Tile2[] {
    const shape = spell["targeting"] as { shape: string; size: number } | undefined;
    if (!shape) return line(u.at, at);
    return areaTiles(this.G.map, shape.shape, shape.size, u.at, at, /^self/i.test(spell.range));
  }

  /** `upcast`: a slot higher than the lowest the spell takes, when one's asked for. */
  cast(u: Unit, spellId: string, targetId?: string, at?: Tile2, upcast?: number): string | undefined {
    if (!this.isTurnOf(u)) return "It isn't their turn.";
    if (!this.able(u)) return `${cap(this.you(u).called)} can't cast anything just now.`;
    const choice = this.spellChoices(u).find(s => s.id === spellId);
    const known = this.t.kit.engine.content.spells.get(spellId);
    if (!choice) return known ? `${known.name} isn't a spell ${this.isYou(u) ? "you have" : "they have"} ready to cast here (or there's no slot left for it).` : "That isn't a spell.";
    const { spell } = choice;
    let slot = choice.slot;
    if (upcast !== undefined && spell.level > 0 && upcast !== slot) {
      if (upcast < spell.level) return `${spell.name} takes a ${ordinal(spell.level)}-level slot at the least.`;
      if (this.freeSlots(u, upcast) <= 0) return `${this.isYou(u) ? "You've" : "They've"} no ${ordinal(upcast)}-level slot left.`;
      slot = upcast;
    }
    const use = this.usage(u);
    if (choice.bonus ? use?.bonusActionUsed : use?.actionUsed) return `${this.isYou(u) ? "You've" : "They've"} already used ${choice.bonus ? "a bonus action" : "your action"} this turn.`;
    const targetUnit = targetId ? this.unit(targetId) : undefined;
    const targetProp = targetId ? this.G.props[targetId] : undefined;
    const fromSelf = /^self/i.test(spell.range);
    let targets: Unit[] = [];
    let tiles: Tile2[];
    let aim: Tile2 | undefined;
    if (choice.targeting === "area") {
      aim = at ?? targetUnit?.at ?? targetProp?.at;
      if (!aim) return `Where? (${spell.name} needs a spot to aim at.)`;
      if (!fromSelf) {
        if (feetBetween(u.at, aim) > choice.range) return `That's ${feetBetween(u.at, aim)} ft away; ${spell.name} reaches ${choice.range} ft.`;
        if (!clearShot(this.G.map, u.at, aim)) return "There's no clear line to there.";
      } else if (same(aim, u.at)) return `Which way? (${spell.name} goes out from you.)`;
      tiles = this.spellArea(u, spell, aim);
      targets = this.units.filter(v => this.onBoard(v) && v.state !== "dead" && tiles.some(t => same(t, v.at)) && !(fromSelf && v.id === u.id));
    } else {
      const target = choice.targeting === "self" ? u : targetUnit;
      aim = target?.at ?? targetProp?.at ?? at;
      if (!aim) return `Who at? (${spell.name} needs a target.)`;
      if (choice.heal && target && !this.friendly(target, u) && target.id !== u.id) return `${spell.name} is for friends.`;
      const reach = Math.max(choice.range, 5);
      if (feetBetween(u.at, aim) > reach) return `That's ${feetBetween(u.at, aim)} ft away; ${spell.name} reaches ${reach} ft.`;
      if (!same(aim, u.at) && !clearShot(this.G.map, u.at, aim)) return "There's no clear line to there.";
      if (target && (!this.onBoard(target) || target.state === "dead")) return "There's nobody there.";
      targets = target ? [target] : [];
      tiles = line(u.at, aim);
    }
    const element = (spell.mechanicalEffects ?? []).map(m => m["damageType"]).find((t): t is string => typeof t === "string");
    this.moment("cast", u, {
      ...(targetId ? { target: targetId } : {}), at: { ...aim }, with: spell.name, spell: spell.id, ...(element ? { element } : {}),
      ...(choice.targeting === "area" ? { area: tiles.map(t => ({ ...t })) } : {}),
    });
    if (!choice.heal) for (const v of targets) this.provoked(u, v);
    let events: Dnd.EngineEvent[] = [];
    if (targets.length) {
      // Rays and beams (Scorching Ray, Eldritch Blast) are an attack each, at whoever's aimed at.
      const rays = RAYS[spellId]?.(slot, this.t.sheet(u.engineId).totalLevel);
      const aimed = rays ? Array.from({ length: rays }, (_, i) => targets[i % targets.length]!.engineId) : targets.map(v => v.engineId);
      try { events = this.t.plan("castSpell", { characterId: u.engineId, spellId, slotLevel: slot, targetIds: aimed }); } catch (e) { this.current = undefined; return castRefused(spell.name, reason(e), this.isYou(u)); }
    } else {
      // At the dust, a lantern or bare boards: it goes off, but the engine wants a creature, so spend it here.
      this.t.apply([
        this.event("ActionEconomyConsumed", { encounterId: this.G.encounterId, combatantId: u.engineId, kind: choice.bonus ? "bonusAction" : "action" }),
        ...(slot ? [this.event("SpellSlotConsumed", { characterId: u.engineId, slotLevel: slot })] : []),
      ]);
    }
    const shape = spell["targeting"] as { shape: string; size: number } | undefined;
    const caught = targets.map(v => this.you(v).called);
    const where = shape ? `: a ${shape.size}-foot ${shape.shape}${caught.length ? `, catching ${caught.join(", ")}` : ", catching nobody"}` : targets.length ? ` at ${caught.join(", ")}` : targetProp ? ` at the ${targetProp.name}` : " at the floor";
    this.log("dice", `${this.isYou(u) ? "You cast" : `${cap(u.called)} casts`} ${spell.name}${slot ? ` (${ordinal(slot)}-level slot)` : " (cantrip)"}${where}`, u.id);
    this.dice(events, spell.name);
    if (targetProp && choice.fire) this.breakProp(targetProp, u);
    if (choice.fire) this.ignite(tiles, spell.name, u);
    this.settle();
    return undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Dash, dodge, disengage, leaving, giving up.

  simple(u: Unit, kind: "dash" | "dodge" | "disengage"): string | undefined {
    if (!this.isTurnOf(u)) return "It isn't their turn.";
    if (!this.able(u)) return `${cap(this.you(u).called)} can't.`;
    this.moment(kind, u);
    try { this.t.plan(kind, { combatantId: u.engineId }); } catch (e) { this.current = undefined; return reason(e); }
    const rule = { dash: `${u.speed} ft more movement this turn`, dodge: "attacks on you have disadvantage until your next turn", disengage: "no opportunity attacks as you move away this turn" }[kind];
    if (this.isYou(u)) { this.say(kind, u); this.log("system", `${cap(kind)}: ${rule}.`, u.id); }
    else if (kind !== "dash") this.log("narration", `${cap(u.called)} ${kind === "dodge" ? "keeps on the move, hard to pin down" : "backs off carefully"}.`, u.id);
    this.settle();
    return undefined;
  }

  /**
   * Words with weight on the player's turn (a threat, a plea, a lie: the GM's talk_down on a typed
   * turn, docs/combat-gm.md), for their action: their skill against the DC, by the engine's own check.
   * Made, the one they spoke to gives up, as the board's surrender has it (a leader's people walk off
   * with him); missed, the words were only words. A moment of its own, with the dice.
   */
  talkDown(u: Unit, targetId: string, skill: TalkSkill, dc: number): string | undefined {
    if (!this.isTurnOf(u)) return "It isn't their turn.";
    if (!this.able(u)) return `${cap(this.you(u).called)} can't just now.`;
    if (!this.actionLeft(u)) return `${this.isYou(u) ? "You've" : "They've"} used ${this.isYou(u) ? "your" : "their"} action this turn: words with weight take it.`;
    const target = this.unit(targetId) ?? this.units.find(v => v.castId === targetId);
    if (!target || target.state !== "fighting" || !this.hostile(u, target)) return "There's nobody of the other side by that to talk down.";
    this.moment("say", u, { target: target.id, with: TALK_SKILLS[skill] });
    let events: Dnd.EngineEvent[];
    try {
      events = this.t.plan("abilityCheck", { type: "AbilityCheck", characterId: u.engineId, ability: "CHA", skill, dc });
      this.t.apply([this.event("ActionEconomyConsumed", { encounterId: this.G.encounterId, combatantId: u.engineId, kind: "action" })]);
    } catch (e) {
      this.current = undefined;
      return reason(e);
    }
    const roll = events.find(e => e.type === "AbilityCheckRolled");
    const made = roll?.["success"] === true;
    const d20 = (roll?.["d20"] as number[] | undefined)?.join("/") ?? "?";
    this.log("dice", `${TALK_SKILLS[skill]}: ${possessive(this.you(u).called)} check at ${target.called}: ${d20} ${signed(Number(roll?.["bonus"] ?? 0))} = ${roll?.["total"]} vs DC ${dc}: ${made ? "success" : "failure"}`, u.id);
    const how = skill === "intimidation" ? "threaten" : skill === "persuasion" ? "talk to" : "lie to";
    this.current!.caption = `${cap(this.you(u).called)} ${this.isYou(u) ? how : `${how}s`} ${target.called}: ${made ? "it works" : "it doesn't"}.`;
    if (made) this.surrender(target);
    this.settle();
    return undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Class features (the user: "how do I use a bonus action? I think I have second wind which is one
  // but I can't cast it"): the engine's own options, the bonus actions (Second Wind, Cunning Action,
  // Rage, Bardic Inspiration…) and those that take the action or nothing (Action Surge, Lay on Hands).

  /** u's class features in this fight, as the engine lists them on its encounter: what each spends, and whether it can be used now (and why not). */
  features(u: Unit): FeatureChoice[] {
    const E = this.t.kit.E as unknown as { bonusActions?: OptionList; actionOptions?: OptionList };
    const listed = (list: OptionList | undefined, cost: "bonus" | "action") => {
      try { return (list?.(this.t.state, this.t.kit.engine.content, this.G.encounterId, u.engineId) ?? []).map(o => ({ ...o, cost })); } catch { return []; }
    };
    return [...listed(E.bonusActions, "bonus"), ...listed(E.actionOptions, "action")]
      .filter(o => !BOARD_HAS.has(o.id))
      .map(o => ({
        id: o.id, name: o.label, cost: o.id === "action-surge" ? "free" as const : o.cost, target: o.target === "creature" ? "creature" as const : o.target === "self" ? "self" as const : "none" as const,
        enabled: o.enabled, ...(o.reason ? { why: featureWhy(o.reason, this.isYou(u)) } : {}),
      }));
  }

  /**
   * A class feature used, through the engine's own option for it (its uses and rests, the turn's
   * bonus action or action), as a moment of its own: its dice, and what it did (a heal's hit points,
   * a dash's feet, a rage's condition). One aimed at someone (Bardic Inspiration, Lay on Hands) is at
   * whoever's on `targetId`, or u themselves when it can be.
   */
  feature(u: Unit, id: string, targetId?: string): string | undefined {
    if (!this.isTurnOf(u)) return "It isn't their turn.";
    if (!this.able(u)) return `${cap(this.you(u).called)} can't just now.`;
    const f = this.features(u).find(x => x.id === id);
    if (!f) return `${this.isYou(u) ? "You haven't" : "They haven't"} got that to use here.`;
    if (!f.enabled) return f.why ?? "Not now.";
    const target = f.target === "creature" ? (targetId !== undefined ? this.unit(targetId) : u) : undefined;
    if (f.target === "creature" && !target) return `${f.name} needs someone to use it on.`;
    this.moment("feature", u, { with: f.name, ...(target && target !== u ? { target: target.id } : {}) });
    let events: Dnd.EngineEvent[];
    try {
      events = this.t.plan(f.cost === "bonus" ? "useOption" : "useActionOption", { optionId: id, combatantId: u.engineId, ...(target ? { targetId: target.engineId } : {}) });
    } catch (e) {
      this.current = undefined;
      return `${f.name}: ${reason(e)}`;
    }
    this.dice(events, f.name);
    this.log("system", `${f.name}${target && target !== u ? ` for ${target.called}` : ""}${f.cost === "bonus" ? " (a bonus action)" : f.cost === "action" ? " (your action)" : ""}.`, u.id);
    this.settle();
    return undefined;
  }

  /**
   * A grab or a shove (2024: the target makes a Strength or Dexterity save against u's Strength DC,
   * through the engine's own Grapple and Shove, which take the action): held fast (grappled, so they
   * can't move until they're let go), knocked over (prone, until they get up as their turn starts),
   * or pushed 5 ft away.
   */
  wrestle(u: Unit, targetId: string, how: "grapple" | "prone" | "push"): string | undefined {
    if (!this.isTurnOf(u)) return "It isn't their turn.";
    if (!this.able(u)) return `${cap(this.you(u).called)} can't.`;
    const target = this.unit(targetId);
    if (!target || target.state !== "fighting") return "There's nobody there to get hold of.";
    if (target.id === u.id) return "You can't get a grip on yourself, whatever Kell says.";
    if (steps(u.at, target.at) > 1) return `${cap(target.called)} is out of reach (${feetBetween(u.at, target.at)} ft): you need to be right beside them.`;
    if (!this.actionLeft(u)) return `${this.isYou(u) ? "You've" : "They've"} already used ${this.isYou(u) ? "your" : "their"} action this turn.`;
    const from = target.at;
    this.moment("wrestle", u, { target: target.id, at: { ...target.at }, with: how === "grapple" ? "Grapple" : "Shove" });
    this.provoked(u, target);
    let events: Dnd.EngineEvent[];
    try {
      events = how === "grapple"
        ? this.t.plan("grapple", { type: "Grapple", attackerId: u.engineId, targetId: target.engineId })
        : this.t.plan("shove", { type: "Shove", attackerId: u.engineId, targetId: target.engineId, mode: how });
    } catch (e) { this.current = undefined; return reason(e); }
    const verb = how === "grapple" ? "grab hold of" : how === "prone" ? "shove over" : "shove away";
    this.log("dice", `${how === "grapple" ? "Grapple" : "Shove"}: ${this.isYou(u) ? "you try" : `${u.called} tries`} to ${verb} ${this.you(target).called}`, u.id);
    this.dice(events);
    if (how === "grapple" && events.some(e => e.type === "ConditionApplied")) this.G.flags[`grappler:${target.id}`] = u.id;
    if (how === "push" && events.some(e => e.type === "CombatantMoved")) this.pushAway(target, u, from);
    this.settle();
    return undefined;
  }

  /**
   * The push itself, on the board: a tile straight away from whoever shoved (the engine moves them
   * by its own measure, which isn't the board's feet), if there's floor there and nobody on it.
   */
  private pushAway(target: Unit, by: Unit, from: Tile2): void {
    const to = { x: from.x + Math.sign(from.x - by.at.x), y: from.y + Math.sign(from.y - by.at.y) };
    const room = !solid(this.G.map, to) && !this.occupant(to, target.id);
    const at = room ? to : from;
    try { this.t.plan("placeCombatant", { encounterId: this.G.encounterId, combatantId: target.engineId, position: toFeet(at) }); } catch { /* it stays where the engine has it */ }
    target.at = at;
    this.log("dice", room ? `${cap(this.you(target).called)} ${this.isYou(target) ? "are" : "is"} pushed back 5 ft` : `${cap(this.you(target).called)} ${this.isYou(target) ? "have" : "has"} nowhere to go: there's no room behind`, target.id);
    if (room && this.hotAt(at)) this.log("narration", `Straight into the heat of the fire, which is nobody's idea of a good place to stand.`, target.id);
  }

  /**
   * Nerve: when the people paying for (or standing beside) them are gone, the engine's morale roll
   * (a d20 plus Wisdom against a DC) says whether they fight on like a cornered rat or give it up.
   */
  nerve(u: Unit, dc: number, why: string, test = "alone"): string | undefined {
    const flag = `nerve:${test}:${u.id}`;
    if (this.G.flags[flag] !== undefined) return "Their nerve has already been tested.";
    this.moment("nerve", u);
    let events: Dnd.EngineEvent[];
    try { events = this.t.plan("moraleCheck", { npcId: u.engineId, dc }); } catch (e) { this.current = undefined; return reason(e); }
    const roll = events.find(e => e.type === "MoraleCheckRolled");
    const held = roll?.["success"] === true;
    this.G.flags[flag] = held ? "held" : "broke";
    this.log("narration", `${cap(why)}.`, u.id);
    this.log("dice", `${cap(possessive(u.called))} nerve: ${roll?.["d20"]} ${signed(Number(roll?.["bonus"] ?? 0))} = ${roll?.["total"]} vs DC ${dc}: ${held ? "it holds" : "it breaks"}`, u.id);
    this.current!.caption = `${cap(why)}: ${held ? "the nerve holds" : "the nerve breaks"}.`;
    return undefined;
  }

  /** Off the map through a door: gone from the fight. */
  leave(u: Unit): string | undefined {
    if (!this.isTurnOf(u)) return "It isn't their turn.";
    if (!this.able(u)) return `${cap(this.you(u).called)} can't go anywhere.`;
    const exit = this.exitAt(u.at);
    if (!exit) return "There's no way out here: stand in a doorway first.";
    // Going out is one more step, through the door.
    if (this.movementLeft(u) < FEET) return `${this.isYou(u) ? "You need" : "They need"} 5 ft of movement left to go out through ${exit.label}.`;
    this.moment("flee", u, { at: { ...exit.at }, with: exit.label });
    this.offMap(u, "fled");
    this.log("narration", this.isYou(u) ? `You go out through ${exit.label}.` : `${cap(u.called)} goes out through ${exit.label} and is gone.`, u.id);
    this.settle();
    return undefined;
  }

  private offMap(u: Unit, state: "fled" | "surrendered"): void {
    u.state = state;
    if (u.side === "enemy") this.G.flags["last_out"] = state === "surrendered" ? "yielded" : "fled";
    try { this.t.plan("placeCombatant", { encounterId: this.G.encounterId, combatantId: u.engineId, position: { x: OFF_MAP.x - this.G.order.indexOf(u.id) * 10, y: OFF_MAP.y } }); } catch { /* already gone */ }
    if (state === "fled") for (const p of Object.values(this.G.props).filter(p => p.carriedBy === u.id)) delete this.G.props[p.id];
  }

  /** Hands up: out of the fight, standing where they were. A villain who yields loses his hirelings with it. */
  surrender(u: Unit): string | undefined {
    if (u.state !== "fighting") return "They're not fighting.";
    this.moment("yield", u);
    this.offMap(u, "surrendered");
    const kell = this.units.some(v => v.castId === "kell" && v.side === "ally" && v.state === "fighting");
    this.say(u.role === "villain" ? "surrender:sallow" : u.castId && hasFlavour(`surrender:${u.castId}`) ? `surrender:${u.castId}` : kell ? "surrender:any:kell" : "surrender:any", u);
    if (u.role === "villain") this.walkOff(this.hiredBy(u));
    this.settle();
    return undefined;
  }

  /** The player puts their hands up: the fight is over, and it's theirs that ended it (new). */
  yieldFight(u: Unit): string | undefined {
    if (!this.isTurnOf(u) || !this.isYou(u)) return "It isn't your turn.";
    if (!this.able(u)) return "You can't do anything just now.";
    this.moment("yield", u);
    this.log("narration", "You put your hands up and step back. Nobody's getting paid for this.", u.id);
    this.end("yielded");
    return undefined;
  }

  /**
   * Hired hands whose paymaster is down, yielding, taken or gone: nobody pays the second half of a
   * lost fight, so they put their cudgels down and walk out, leaving the gentleman to it (the Crakes'
   * notes, lore/Cast/The Crake Brothers/gm.md). All of them at once, on one of their turns.
   */
  standDown(u: Unit): string | undefined {
    const villain = this.units.find(v => v.side === u.side && v.role === "villain");
    if (!villain || villain.state === "fighting") return "Somebody's still paying them.";
    const hired = this.hiredBy(villain);
    if (!hired.includes(u)) return "They're not fighting.";
    this.walkOff(hired);
    this.settle();
    return undefined;
  }

  /** The villain's hired hands still in the fight (the Crakes; Hep's porters, were they his). */
  private hiredBy(villain: Unit): Unit[] {
    return this.units.filter(v => v.side === villain.side && v.id !== villain.id && v.state === "fighting" && (v.role === "bruiser" || v.role === "brawler"));
  }

  /** Out of the fight and off the map, the way they came: not beaten, so not Kell's to arrest. */
  private walkOff(hired: Unit[]): void {
    if (!hired.length) return;
    this.moment("walk-off", hired[0]);
    const ids = hired.map(v => v.castId ?? v.id).sort().join("+");
    this.say(hasFlavour(`walkoff:${ids}`) ? `walkoff:${ids}` : hired.length > 1 ? "walkoff:many" : "walkoff:any", hired[0]);
    for (const v of hired) {
      this.offMap(v, "fled");
      this.G.flags[`walked:${v.id}`] = true;
    }
  }

  /** Kell's proper words: someone beaten or yielded is under arrest. */
  arrest(u: Unit, targetId: string): string | undefined {
    const target = this.unit(targetId);
    if (!this.isTurnOf(u) || !this.able(u)) return "Not now.";
    if (!target || !(target.state === "down" || target.state === "surrendered") || target.arrested) return "There's nobody to arrest there.";
    if (steps(u.at, target.at) > 1) return `${cap(target.called)} is out of reach.`;
    if (!this.actionLeft(u)) return "No action left this turn.";
    this.moment("arrest", u, { target: target.id, at: { ...target.at } });
    this.t.apply([this.event("ActionEconomyConsumed", { encounterId: this.G.encounterId, combatantId: u.engineId, kind: "action" })]);
    target.arrested = true;
    this.say(target.role === "villain" ? "arrest:sallow" : "arrest:any", target);
    this.settle();
    return undefined;
  }

  /** A line the AI wants said (Sallow keeping a Crake between himself and the sharp end): a moment of its own, its caption the line. */
  remark(u: Unit, kind: string): string | undefined {
    this.moment("say", u);
    this.say(kind, u);
    this.G.flags[`said:${kind}:${u.id}`] = true;
    const said = this.current?.detail.lines[0];
    if (said) this.current!.caption = said;
    return undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Things: lanterns, the brazier, fire and the dust.

  /** Knock over the brazier or bring down a lantern within reach. */
  use(u: Unit, propId: string): string | undefined {
    const prop = this.G.props[propId];
    if (!this.isTurnOf(u) || !this.able(u)) return "Not now.";
    if (!prop || prop.state !== "standing" || prop.carriedBy) return "There's nothing like that to hand.";
    if (steps(u.at, prop.at) > 1) return `The ${prop.name} is out of reach.`;
    if (!this.actionLeft(u)) return `${this.isYou(u) ? "You've" : "They've"} already used ${this.isYou(u) ? "your" : "their"} action this turn.`;
    this.moment("use", u, { target: prop.id, at: { ...prop.at }, with: prop.name });
    this.t.apply([this.event("ActionEconomyConsumed", { encounterId: this.G.encounterId, combatantId: u.engineId, kind: "action" })]);
    if (prop.kind === "brazier") this.say("brazier", u);
    this.breakProp(prop, u);
    this.settle();
    return undefined;
  }

  private breakProp(prop: Prop, by?: Unit): void {
    if (prop.state !== "standing") return;
    prop.state = prop.kind === "brazier" ? "fallen" : "broken";
    if (!prop.lit) { this.log("narration", `The ${prop.name} comes down with a crash.`); return; }
    if (prop.kind === "lantern") this.say("lantern:break");
    const spill = prop.kind === "brazier" ? [prop.at, ...neighbours(this.G.map, prop.at)] : [prop.at];
    this.ignite(spill, `the ${prop.name}`, by);
  }

  private dropLantern(prop: Prop, carrier: Unit): void {
    delete prop.carriedBy;
    prop.at = carrier.at;
    prop.state = "standing";
    this.say("lantern:drop", carrier);
    this.breakProp(prop, carrier);
  }

  /** Fire touches these tiles: dust explodes, anything that burns catches. */
  ignite(tiles: Tile2[], cause: string, by?: Unit): void {
    if (tiles.some(t => this.dustAt(t))) this.explode(cause, by);
    const fuel = tiles.filter(t => this.G.fuel.includes(key(t)) && !this.fireAt(t));
    const near = this.G.fuel.map(fromKey).filter(f => !this.fireAt(f) && tiles.some(t => steps(t, f) <= 1));
    const catching = [...fuel, ...near].filter((t, i, all) => all.findIndex(o => same(o, t)) === i);
    if (catching.length) {
      this.G.fire.push(...catching.map(key));
      this.G.flags["fire"] = true;
      this.log("narration", `${cause.charAt(0).toUpperCase() + cause.slice(1)} sets the sacks alight.`);
    } else if (!this.G.flags["dust_exploded"] && !tiles.some(t => this.dustAt(t)) && /brazier|lantern/.test(cause)) this.say("coals:fizzle");
  }

  /**
   * The grain dust explodes: 5d6 fire for everyone standing (or lying) in the cloud,
   * a Dexterity save (DC 13) for half, through the engine's trap rules (so resistances, temporary hit
   * points and dropping to 0 work as they do for a spell). Then the sacks around it burn.
   */
  explode(cause: string, by?: Unit): void {
    if (!this.G.dust.length) return;
    const cloud = new Set(this.G.dust);
    this.G.dust = [];
    this.G.flags["dust_exploded"] = true;
    this.G.flags["fire"] = true;
    this.G.flags["lit_by"] = by ? (this.isYou(by) ? "player" : by.castId ?? by.id) : cause;
    this.say("explode", by);
    this.log("dice", `Grain dust explosion (${cause}): 5d6 fire to everyone in the dust, Dexterity save DC 13 for half`);
    const caught = this.units.filter(v => this.onBoard(v) && v.state !== "dead" && cloud.has(key(v.at)));
    if (caught.length) {
      // The engine's trap rules: a save and 5d6 each (they won't take a fixed sum), through resistances and all.
      const trapId = this.t.kit.E.newEventId();
      this.t.apply([this.event("TrapArmed", {
        trapId, label: "the grain dust", sourceCharacterId: (by ?? this.pc()).engineId, sourceSpellId: "grain-dust",
        payload: { saveAbility: "DEX", saveDC: 13, damageDice: "5d6", damageType: "fire", halfOnSuccess: true }, chargesRemaining: caught.length,
      })]);
      for (const v of caught) {
        try { this.dice(this.t.plan("triggerTrap", { trapId, triggeringCharacterId: v.engineId })); } catch (e) { this.log("system", `(The blast missed ${v.called}: ${reason(e)})`); }
      }
    } else this.log("narration", "By some miracle nobody is standing in it.");
    for (const p of Object.values(this.G.props)) if (p.kind === "lantern" && p.state === "standing" && !p.carriedBy && cloud.has(key(p.at))) p.state = "broken";
    const burning = this.G.fuel.filter(f => !this.G.fire.includes(f) && [...cloud].some(c => steps(fromKey(c), fromKey(f)) <= 1));
    this.G.fire.push(...burning);
    this.settle();
  }

  /** The end of a round: fire runs along the sacks, and fire next to the dust sets it off. */
  private spreadFire(): void {
    if (!this.G.fire.length) return;
    const burning = new Set(this.G.fire);
    const added = this.G.fuel.filter(f => !burning.has(f) && this.G.fire.some(k => steps(fromKey(k), fromKey(f)) <= 1));
    if (added.length) {
      this.G.fire.push(...added);
      this.say("fire:spread", undefined, this.G.fire.length);
    }
    if (this.G.dust.some(d => this.G.fire.some(k => steps(fromKey(k), fromKey(d)) <= 1))) this.explode("the fire reaching the dust");
  }

  /** Heat: starting a turn on or beside burning sacks costs 1d6 fire (Dexterity save DC 10 for half). */
  private scorch(u: Unit): void {
    this.say("heat", u);
    const trapId = this.t.kit.E.newEventId();
    this.t.apply([this.event("TrapArmed", {
      trapId, label: "the burning sacks", sourceCharacterId: u.engineId, sourceSpellId: "burning-sacks",
      payload: { saveAbility: "DEX", saveDC: 10, damageDice: "1d6", damageType: "fire", halfOnSuccess: true }, chargesRemaining: 1,
    })]);
    try { this.dice(this.t.plan("triggerTrap", { trapId, triggeringCharacterId: u.engineId })); } catch { /* the heat passes */ }
  }

  // -------------------------------------------------------------------------------------------
  // The end.

  checkOutcome(): void {
    if (this.G.outcome) return;
    const pc = this.pc();
    if (pc.state === "fled") return this.end("fled");
    const enemies = this.units.filter(u => u.side === "enemy");
    if (!enemies.some(u => this.able(u) && u.role !== "coward")) {
      // They gave up: the villain yielded, or (with nobody in charge) the last of them put their hands up.
      const villain = enemies.find(u => u.role === "villain");
      const yielded = villain ? villain.state === "surrendered" : this.G.flags["last_out"] === "yielded";
      return this.end(yielded ? "surrender" : "victory");
    }
    if (!this.units.some(u => (u.side === "player" || u.side === "ally") && this.able(u))) return this.end("defeat");
  }

  private end(outcome: FightOutcome): void {
    this.G.outcome = outcome;
    this.moment("over", undefined, { outcome });
    // Beaten: by the master (his shoes), by a gang of porters (their boots), or by whoever else.
    const gang = this.units.some(u => u.side === "enemy" && (u.castId === "hep" || /porter/i.test(u.id)));
    const villainless = !this.units.some(u => u.role === "villain");
    if (outcome !== "yielded") this.say(outcome === "defeat" && villainless ? (gang ? "defeat:gang" : "defeat:any") : outcome === "surrender" && villainless ? "surrender:yielded" : outcome);
    // Won: the sergeant (on her feet, or come round with a lump like a hen's egg) puts the irons on the beaten.
    const sergeant = this.units.find(u => u.side === "ally" && u.castId === "kell" && u.state !== "fled");
    if (sergeant && (outcome === "victory" || outcome === "surrender")) {
      const beaten = this.units.filter(v => v.side === "enemy" && (v.state === "down" || v.state === "surrendered") && !v.arrested && v.role !== "coward");
      if (beaten.length && sergeant.state !== "fighting") this.log("narration", "Kell comes round, sits up, finds her notebook, and gets on with it.", sergeant.id);
      const villain = beaten.find(v => v.role === "villain");
      for (const v of beaten) v.arrested = true;
      if (villain) this.say("arrest:sallow", villain);
      const rest = beaten.filter(v => v !== villain);
      if (rest.length) this.log("narration", `Kell puts the irons on ${listing(rest.map(v => v.called))}, by the book and out loud.`, sergeant.id);
    }
    // Whoever's still dying on the floor when it ends is seen to (Kell, the gang, or the Crakes' indifference).
    for (const u of this.units) if (u.state === "down" && !this.t.char(u.engineId)?.deathSaves.stable) this.t.apply([this.event("Stabilized", { targetId: u.engineId })]);
  }

  attacksPerAction(u: Unit): number {
    const level = this.t.char(u.engineId)?.classes.find(c => ["fighter", "barbarian", "paladin", "ranger", "monk"].includes(c.classId))?.level ?? 0;
    return level >= 11 && this.t.char(u.engineId)?.classes.some(c => c.classId === "fighter" && c.level >= 11) ? 3 : level >= 5 ? 2 : 1;
  }
}

/** Conditions worth a moment's tag on screen: not the engine's bookkeeping ("…-active"). */
const shown = (condition: string) => !/active$/.test(condition);
