import type * as Dnd from "../../../vendor/dnd-srd-engine/dnd-srd-engine.js";
import { inFights } from "../../rules/spells.ts";
import type { CombatResult, Tile2 } from "../types.ts";
import { flavour, has as hasFlavour, hash, listing } from "./flavour.ts";
import { areaTiles, clearShot, explore, FEET, feetBetween, findPath, fromFeet, fromKey, key, line, neighbours, rangeFeet, same, solid, steps, toFeet, type PathRules } from "./grid.ts";
import type { CombatG, PlayerOptions, Prop, Unit } from "./model.ts";
import { diceLines, signed, type EngineCombatant, type Namer, type Rules, type Table } from "./rules.ts";

/**
 * The rules of a fight on the map, as operations on G: whose turn it is, moving a step at a time
 * (opportunity attacks as you leave someone's reach), weapon attacks (Sallow parries), spells laid
 * on tiles, dash, dodge, disengage, the grain dust (fire there explodes, for everyone in it), fire
 * that spreads along the sacks, falling, death saves, surrender, and how it ends. The dice and the
 * D&D bookkeeping are the engine's; this is the board around them.
 *
 * One Skirmish per move: made over the move's draft G, it opens the live campaign, does its work
 * and, on done(), writes the projection and the campaign back into G. Every operation returns an
 * error message, or undefined when it happened.
 */

const OFF_MAP = { x: -5000, y: -5000 };
const INCAPACITATING = /unconscious|paralyz|stunned|petrified|incapacitated|held-/;
const ordinal = (n: number) => ["cantrip", "1st", "2nd", "3rd"][n] ?? `${n}th`;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const possessive = (name: string) => (name === "you" ? "your" : name.endsWith("s") ? `${name}'` : `${name}'s`);
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/, "");
/** The spell effects a fight on the map can play out (summons, zones and teleports aren't here yet). */
/** Buffs cast on a foe: the caster marks them. */
const FOE_MARKS = new Set(["hunters-mark", "hex"]);
/** The sheet's attack bonus with a weapon (the engine calls the instance weaponInstanceId; the typings say instanceId). */
export function attackBonus(sheet: Dnd.CharacterSheet, weapon: string): number {
  const of = (a: Dnd.CharacterSheet["attacks"][number]) => (a as { weaponInstanceId?: string }).weaponInstanceId ?? a.instanceId;
  return sheet.attacks.find(a => of(a) === weapon)?.attackBonus ?? sheet.attacks[0]?.attackBonus ?? 0;
}

export interface SpellChoice { id: string; name: string; level: number; slot: number; spell: Dnd.SpellDef; targeting: "unit" | "area" | "self"; range: number; fire: boolean; heal: boolean; bonus: boolean }

export class Skirmish {
  readonly G: CombatG;
  readonly rules: Rules;
  readonly t: Table;
  constructor(G: CombatG, rules: Rules) {
    this.G = G;
    this.rules = rules;
    this.t = rules.open(G);
  }

  /** Write the projection and the campaign back into G. */
  done(): void {
    this.refresh();
    this.rules.close(this.G, this.t);
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
  /** On the map at all (the fled are gone; the fallen lie where they fell). */
  onBoard(u: Unit): boolean { return u.state !== "fled"; }
  /** Standing, in the fight, and able to do something about it. */
  able(u: Unit): boolean { return u.state === "fighting" && !u.conditions.some(c => INCAPACITATING.test(c)); }
  occupant(t: Tile2, except?: string): Unit | undefined { return this.units.find(u => u.id !== except && this.onBoard(u) && same(u.at, t)); }
  fireAt(t: Tile2): boolean { return this.G.fire.includes(key(t)); }
  dustAt(t: Tile2): boolean { return this.G.dust.includes(key(t)); }
  hotAt(t: Tile2): boolean { return this.G.fire.some(k => steps(fromKey(k), t) <= 1); }
  exitAt(t: Tile2): { at: Tile2; label: string } | undefined { return this.G.exits.find(e => same(e.at, t)); }
  isTurnOf(u: Unit): boolean { return this.activeUnit()?.id === u.id; }

  combatant(u: Unit): EngineCombatant | undefined {
    return this.t.encounter(this.G.encounterId)?.combatants.find(c => c.combatantId === u.engineId);
  }
  usage(u: Unit): EngineCombatant["turnUsage"] | undefined { return this.combatant(u)?.turnUsage; }
  reactionReady(u: Unit): boolean { return this.usage(u)?.reactionUsedThisRound === false; }
  actionLeft(u: Unit): boolean { const use = this.usage(u); return !!use && !use.actionUsed; }

  /** Feet of movement left this turn (dashing doubles it; standing up from prone costs half). */
  movementLeft(u: Unit): number {
    const use = this.usage(u);
    if (!use || !this.isTurnOf(u) || !this.able(u)) return 0;
    const standUp = u.conditions.includes("prone") ? Math.floor(u.speed / 2) : 0;
    return Math.max(0, u.speed * (use.dashed ? 2 : 1) - use.feetMovedThisTurn - standUp);
  }

  /** Walls and standing enemies block; friends and the fallen can be passed but not stopped on; fire is avoided. */
  pathRules(u: Unit, options: { avoidFire?: boolean; avoidDust?: boolean } = {}): PathRules {
    return {
      blocked: t => { const o = this.occupant(t, u.id); return !!o && o.state === "fighting" && this.hostile(u, o); },
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
  // The log.

  log(kind: "dice" | "narration" | "turn" | "system", text: string, who?: string): void {
    this.G.log.push({ round: this.G.round, kind, text, ...(who ? { who } : {}) });
    this.G.seq++;
  }
  dice(events: Dnd.EngineEvent[], label?: string): void {
    for (const line of diceLines(this.t, events, this.namer(), label)) this.log("dice", line);
  }
  say(kind: string, who?: Unit, salt: string | number = ""): void {
    const line = flavour(kind, hash(this.G.round, this.G.log.length, kind, who?.id ?? "", salt), who ? this.you(who) : undefined, this.G.place);
    if (line) this.log("narration", line, who?.id);
  }
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
    this.checkOutcome();
  }

  private fall(u: Unit, c: Dnd.EngineCharacter): void {
    // Massive damage kills a grown combatant outright; the player can't die in this fight (the story
    // needs them), and nobody kills the lantern-boy: he's knocked flat.
    const dead = c.deathSaves.failures >= 3 && !this.isYou(u) && u.role !== "coward" && u.role !== "bystander";
    u.state = dead ? "dead" : "down";
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

  /** turn.onEnd: the engine's turn moves on, past anyone who can't take one. */
  advance(): void {
    for (let guard = 0; guard < this.G.order.length * 2 + 2; guard++) {
      let events: Dnd.EngineEvent[];
      try { events = this.t.plan("advanceTurn", { encounterId: this.G.encounterId }); } catch (e) { this.log("system", `(The turn wouldn't pass: ${reason(e)})`); return; }
      const enc = this.t.encounter(this.G.encounterId)!;
      const now = this.byEngine(enc.combatants[enc.activeIndex]!.combatantId);
      if (now) this.G.active = this.G.order.indexOf(now.id);
      if (events.some(e => e.type === "RoundEnded")) { this.G.round = enc.round; this.endOfRound(); }
      this.G.round = enc.round;
      // A death save belongs to the turn it starts: shown after that turn's header, and what it
      // leads to (back up, stable, dying) is settled there too (beginTurn).
      const saves = diceLines(this.t, events.filter(e => e.type === "DeathSaveRolled"), this.namer());
      if (saves.length) this.G.queued = [...(this.G.queued ?? []), ...saves];
      if (this.G.outcome) return;
      if (now && this.takesTurn(now)) return;
    }
  }

  takesTurn(u: Unit): boolean { return u.state === "fighting" || (this.isYou(u) && u.state === "down"); }

  /** turn.onBegin: whose turn, and what the fire does to them. Once per turn, even across a save and load. */
  beginTurn(): void {
    const u = this.activeUnit();
    if (!u || this.G.outcome) return;
    const token = `${this.G.round}:${this.G.active}`;
    if (this.G.begun === token) return;
    this.G.begun = token;
    this.log("turn", `Round ${this.G.round}: ${this.isYou(u) ? "your turn" : `${possessive(u.called)} turn`}`, u.id);
    for (const line of this.G.queued ?? []) this.log("dice", line, u.id);
    delete this.G.queued;
    // Dodging lasts until the start of your next turn (the engine's condition never ends by itself).
    const dodging = this.t.char(u.engineId)?.appliedConditions.filter(a => a.conditionId === "dodged") ?? [];
    if (dodging.length) this.t.apply(dodging.map(() => this.event("ConditionRemoved", { targetId: u.engineId, conditionId: "dodged" })));
    if (this.onBoard(u) && this.hotAt(u.at)) this.scorch(u);
    this.settle();
    if (this.isYou(u) && u.state === "down" && !this.G.flags["pc_dying"] && !u.deathSaves?.stable) this.log("system", "You're on the floor, fighting for breath.", u.id);
  }

  private endOfRound(): void {
    this.spreadFire();
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
    for (let i = 0; i < path.length; ) {
      // Through a friend's space (or over a body) in one hop: you can pass, not stop.
      let j = i;
      while (j < path.length - 1 && this.occupant(path[j]!, u.id)) j++;
      const step = path[j]!;
      let events: Dnd.EngineEvent[];
      try { events = this.t.plan("move", { combatantId: u.engineId, to: toFeet(step) }); } catch (e) { this.log("system", `(${cap(this.you(u).called)} stop${this.isYou(u) ? "" : "s"}: ${reason(e)})`); break; }
      u.at = step;
      for (const oa of events.filter(e => e.type === "OpportunityAvailable")) {
        const reactor = this.byEngine(String(oa["reactorId"]));
        if (reactor && this.hostile(reactor, u) && this.able(reactor)) this.opportunity(reactor, u);
        if (u.state !== "fighting") break;
      }
      if (u.state !== "fighting") break;
      i = j + 1;
    }
    if (this.isYou(u) && !same(start, u.at)) this.log("system", `You move ${steps(start, u.at) * FEET} ft (${this.movementLeft(u)} ft left).`, u.id);
    this.settle();
    return undefined;
  }

  private opportunity(reactor: Unit, target: Unit): void {
    const weapon = reactor.weapons.find(w => this.t.item(w)?.attackKind === "melee");
    if (!weapon || !this.reactionReady(reactor)) return;
    try {
      const events = this.t.plan("opportunityAttack", { reactorId: reactor.engineId, targetId: target.engineId, weaponInstanceId: weapon });
      this.log("narration", `${cap(this.you(reactor).called)} take${this.isYou(reactor) ? "" : "s"} a swing as ${this.you(target).called} go${this.isYou(target) ? "" : "es"} past.`, reactor.id);
      this.dice(events);
      this.settle();
    } catch { /* no reaction to spend after all */ }
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

  attack(u: Unit, targetId: string, weaponId?: string): string | undefined {
    if (!this.isTurnOf(u)) return "It isn't their turn.";
    if (!this.able(u)) return `${cap(this.you(u).called)} can't attack.`;
    const weapon = weaponId && u.weapons.includes(weaponId) ? weaponId : u.weapons[0];
    if (!weapon) return "Nothing to attack with.";
    const prop = this.G.props[targetId];
    if (prop) return this.attackProp(u, prop, weapon);
    const target = this.unit(targetId);
    if (!target || !this.onBoard(target) || target.state === "dead") return "There's nobody there to attack.";
    if (target.id === u.id) return "Attacking yourself is a matter for the Assizes.";
    const check = this.attackCheck(u, target, weapon);
    if (check.error) return check.error;
    const intent: Record<string, unknown> = {
      attackerId: u.engineId, targetId: target.engineId, weaponInstanceId: weapon, attackerHasAllyAdjacentToTarget: check.packed,
      ...(check.advantage ? { advantage: check.advantage } : {}), ...(check.cover ? { cover: check.cover } : {}),
    };
    const say = this.isYou(u) ? undefined : `attack:${u.castId ?? u.role}`;
    if (say && hash(this.G.round, u.id, this.G.log.length) % 3 === 0) this.say(say, u);
    // A duellist's parry: the blade turns a hit that only just landed (his reaction, once a round).
    if (target.parry && check.melee && this.able(target) && this.reactionReady(target)) {
      let rolled: { events: Dnd.EngineEvent[]; roll: { hit: boolean } };
      try { rolled = (this.t.kit.plan["attackRoll"] as unknown as (s: Dnd.CampaignState, i: Record<string, unknown>) => typeof rolled)(this.t.state, intent); } catch (e) { return reason(e); }
      this.t.apply(rolled.events);
      const ev = rolled.events.find(e => e.type === "AttackRolled");
      const parried = rolled.roll.hit && !!ev && !ev["critical"] && Number(ev["total"]) < Number(ev["targetAC"]) + target.parry.bonus;
      if (parried) {
        this.t.apply([this.event("ActionEconomyConsumed", { encounterId: this.G.encounterId, combatantId: target.engineId, kind: "reaction" })]);
        const [first, ...rest] = diceLines(this.t, rolled.events, this.namer());
        this.log("dice", `${(first ?? "").replace(/: hit$/, "")}: parried! (the ${(target.weaponName ?? "blade").toLowerCase()} makes it AC ${Number(ev["targetAC"]) + target.parry.bonus})`);
        for (const l of rest) this.log("dice", l);
        this.log("narration", `${cap(target.called)} turns the blow aside with a flick of the ${(target.weaponName ?? "blade").toLowerCase()}, and looks faintly bored about it.`, target.id);
      } else {
        this.dice(rolled.events);
        const dmg = (this.t.kit.plan["attackDamage"] as unknown as (r: unknown) => { events: Dnd.EngineEvent[] })(rolled.roll);
        this.t.apply(dmg.events);
        this.dice(dmg.events);
      }
    } else {
      let events: Dnd.EngineEvent[];
      try { events = this.t.plan("attack", intent); } catch (e) { return reason(e); }
      this.dice(events);
    }
    this.settle();
    return undefined;
  }

  /** A blow or a shot at a thing (a lantern): the weapon's attack against its armour class. */
  private attackProp(u: Unit, prop: Prop, weapon: string): string | undefined {
    if (prop.state !== "standing" || prop.carriedBy) return `The ${prop.name} isn't something you can hit now.`;
    const check = this.attackCheck(u, { at: prop.at, id: prop.id }, weapon);
    if (check.error) return check.error;
    const use = this.usage(u);
    if (use?.actionUsed && use.attacksMadeThisTurn === 0) return "You've already used your action this turn.";
    if (use && use.attacksMadeThisTurn >= this.attacksPerAction(u)) return "You've no attacks left this turn.";
    this.t.apply([
      ...(use?.actionUsed ? [] : [this.event("ActionEconomyConsumed", { encounterId: this.G.encounterId, combatantId: u.engineId, kind: "action" })]),
      this.event("ActionEconomyConsumed", { encounterId: this.G.encounterId, combatantId: u.engineId, kind: "attack" }),
    ]);
    const bonus = attackBonus(this.t.sheet(u.engineId), weapon);
    const d20 = this.t.roll("1d20").total;
    const total = d20 + bonus;
    const hit = d20 === 20 || (d20 !== 1 && total >= prop.ac);
    this.log("dice", `${this.namer().weapon(weapon)}: ${this.isYou(u) ? "your" : `${u.called}'s`} attack on the ${prop.name}: ${d20} ${signed(bonus)} = ${total} vs AC ${prop.ac}: ${hit ? "hit" : "miss"}`);
    if (hit) this.breakProp(prop, u);
    this.settle();
    return undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Spells.

  /** The spells u can cast in this fight right now: ready, with a slot, and of a kind the map plays out. */
  spellChoices(u: Unit): SpellChoice[] {
    const sheet = this.t.sheet(u.engineId);
    const me = this.t.char(u.engineId)!;
    const free = (l: number) => (sheet.spellSlots.slotsByLevel[l - 1] ?? 0) - (me.spellSlotsUsed[String(l)] ?? 0);
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

  cast(u: Unit, spellId: string, targetId?: string, at?: Tile2): string | undefined {
    if (!this.isTurnOf(u)) return "It isn't their turn.";
    if (!this.able(u)) return `${cap(this.you(u).called)} can't cast anything just now.`;
    const choice = this.spellChoices(u).find(s => s.id === spellId);
    const known = this.t.kit.engine.content.spells.get(spellId);
    if (!choice) return known ? `${known.name} isn't a spell ${this.isYou(u) ? "you have" : "they have"} ready to cast here (or there's no slot left for it).` : "That isn't a spell.";
    const { spell, slot } = choice;
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
    let events: Dnd.EngineEvent[] = [];
    if (targets.length) {
      try { events = this.t.plan("castSpell", { characterId: u.engineId, spellId, slotLevel: slot, targetIds: targets.map(v => v.engineId) }); } catch (e) { return `${spell.name} can't be cast like that: ${reason(e)}`; }
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
    try { this.t.plan(kind, { combatantId: u.engineId }); } catch (e) { return reason(e); }
    const rule = { dash: `${u.speed} ft more movement this turn`, dodge: "attacks on you have disadvantage until your next turn", disengage: "no opportunity attacks as you move away this turn" }[kind];
    if (this.isYou(u)) { this.say(kind, u); this.log("system", `${cap(kind)}: ${rule}.`, u.id); }
    else if (kind !== "dash") this.log("narration", `${cap(u.called)} ${kind === "dodge" ? "keeps on the move, hard to pin down" : "backs off carefully"}.`, u.id);
    this.settle();
    return undefined;
  }

  /**
   * Nerve: when the people paying for (or standing beside) them are gone, the engine's morale roll
   * (a d20 plus Wisdom against a DC) says whether they fight on like a cornered rat or give it up.
   */
  nerve(u: Unit, dc: number, why: string, test = "alone"): string | undefined {
    const flag = `nerve:${test}:${u.id}`;
    if (this.G.flags[flag] !== undefined) return "Their nerve has already been tested.";
    let events: Dnd.EngineEvent[];
    try { events = this.t.plan("moraleCheck", { npcId: u.engineId, dc }); } catch (e) { return reason(e); }
    const roll = events.find(e => e.type === "MoraleCheckRolled");
    const held = roll?.["success"] === true;
    this.G.flags[flag] = held ? "held" : "broke";
    this.log("narration", `${cap(why)}.`, u.id);
    this.log("dice", `${cap(possessive(u.called))} nerve: ${roll?.["d20"]} ${signed(Number(roll?.["bonus"] ?? 0))} = ${roll?.["total"]} vs DC ${dc}: ${held ? "it holds" : "it breaks"}`, u.id);
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
    this.offMap(u, "fled");
    this.log("narration", this.isYou(u) ? `You go out through ${exit.label}.` : `${cap(u.called)} goes out through ${exit.label} and is gone.`, u.id);
    this.settle();
    return undefined;
  }

  private offMap(u: Unit, state: "fled" | "surrendered"): void {
    u.state = state;
    try { this.t.plan("placeCombatant", { encounterId: this.G.encounterId, combatantId: u.engineId, position: { x: OFF_MAP.x - this.G.order.indexOf(u.id) * 10, y: OFF_MAP.y } }); } catch { /* already gone */ }
    if (state === "fled") for (const p of Object.values(this.G.props).filter(p => p.carriedBy === u.id)) delete this.G.props[p.id];
  }

  /** Hands up: out of the fight, standing where they were. A villain who yields loses his hirelings with it. */
  surrender(u: Unit): string | undefined {
    if (u.state !== "fighting") return "They're not fighting.";
    this.offMap(u, "surrendered");
    this.say(u.role === "villain" ? "surrender:sallow" : u.castId && hasFlavour(`surrender:${u.castId}`) ? `surrender:${u.castId}` : "surrender:any", u);
    if (u.role === "villain") this.walkOff(this.hiredBy(u));
    this.settle();
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
    this.t.apply([this.event("ActionEconomyConsumed", { encounterId: this.G.encounterId, combatantId: u.engineId, kind: "action" })]);
    target.arrested = true;
    this.say(target.role === "villain" ? "arrest:sallow" : "arrest:any", target);
    this.settle();
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
      const villain = enemies.find(u => u.role === "villain");
      return this.end(villain?.state === "surrendered" ? "surrender" : "victory");
    }
    if (!this.units.some(u => (u.side === "player" || u.side === "ally") && this.able(u))) return this.end("defeat");
  }

  private end(outcome: NonNullable<CombatResult["outcome"]>): void {
    this.G.outcome = outcome;
    // Beaten by Hep's gang before the Master came, there are no good shoes to see.
    // Beaten: by the master (his shoes), by a gang of porters (their boots), or by whoever else.
    const gang = this.units.some(u => u.side === "enemy" && (u.castId === "hep" || /porter/i.test(u.id)));
    this.say(outcome === "defeat" && !this.units.some(u => u.role === "villain") ? (gang ? "defeat:gang" : "defeat:any") : outcome);
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

  // -------------------------------------------------------------------------------------------
  // The player's menu.

  options(): PlayerOptions {
    const u = this.pc();
    const ready = this.isTurnOf(u) && this.able(u) && !this.G.outcome;
    const use = this.usage(u);
    const empty: PlayerOptions = { ready: false, movementLeft: 0, actionUsed: true, moves: [], attacks: [], spells: [], props: [], dash: false, dodge: false, disengage: false };
    if (!ready || !use) return empty;
    const canAttack = !use.actionUsed || (use.attacksMadeThisTurn > 0 && use.attacksMadeThisTurn < this.attacksPerAction(u));
    const targets = this.units.filter(v => v.state === "fighting" && this.hostile(u, v) && v.role !== "coward");
    const attacks: PlayerOptions["attacks"] = [];
    if (canAttack) {
      const sheet = this.t.sheet(u.engineId);
      for (const v of targets) for (const w of u.weapons) {
        const check = this.attackCheck(u, v, w);
        if (check.error) continue;
        attacks.push({ target: v.id, name: v.name, weapon: w, weaponName: this.namer().weapon(w), bonus: attackBonus(sheet, w),
          ...(check.advantage ? { advantage: check.advantage } : {}), ...(check.cover ? { note: "half cover" } : {}) });
      }
      for (const p of Object.values(this.G.props).filter(p => p.kind === "lantern" && p.state === "standing" && !p.carriedBy)) {
        const w = u.weapons.find(w => !this.attackCheck(u, { at: p.at, id: p.id }, w).error);
        if (w) attacks.push({ target: p.id, name: `the ${p.name}`, weapon: w, weaponName: this.namer().weapon(w), bonus: attackBonus(this.t.sheet(u.engineId), w), note: this.dustAt(p.at) ? "it hangs over the dust" : "" });
      }
    }
    const spells = this.spellChoices(u).filter(s => (s.bonus ? !use.bonusActionUsed : !use.actionUsed)).map(s => ({
      id: s.id, name: s.name, level: s.level, slot: s.slot, targeting: s.targeting, range: s.range, fire: s.fire,
      ...(s.spell["targeting"] ? { area: s.spell["targeting"] as { shape: string; size: number } } : {}),
      targets: s.targeting === "self" ? [] : this.units.filter(v => v.state !== "fled" && v.state !== "dead" && (s.heal ? this.friendly(v, u) || v.id === u.id : this.hostile(u, v) && v.state === "fighting" && v.role !== "coward"))
        .filter(v => feetBetween(u.at, v.at) <= Math.max(s.range, 5) && (same(v.at, u.at) || clearShot(this.G.map, u.at, v.at)) && (!/^self/i.test(s.spell.range) || steps(u.at, v.at) * FEET <= ((s.spell["targeting"] as { size: number } | undefined)?.size ?? 5)))
        .map(v => ({ id: v.id, name: v.name })),
    }));
    const props = use.actionUsed ? [] : Object.values(this.G.props).filter(p => p.state === "standing" && !p.carriedBy && steps(u.at, p.at) <= 1)
      .map(p => ({ id: p.id, name: p.name, how: p.kind === "brazier" ? "kick it over" : "bring it down" }));
    const exit = this.exitAt(u.at);
    return {
      ready, movementLeft: this.movementLeft(u), actionUsed: use.actionUsed, moves: this.moveTargets(u), attacks, spells, props,
      dash: !use.actionUsed && !use.dashed, dodge: !use.actionUsed, disengage: !use.actionUsed && !use.disengaged,
      ...(exit ? { leave: exit.label } : {}),
    };
  }

  attacksPerAction(u: Unit): number {
    const level = this.t.char(u.engineId)?.classes.find(c => ["fighter", "barbarian", "paladin", "ranger", "monk"].includes(c.classId))?.level ?? 0;
    return level >= 11 && this.t.char(u.engineId)?.classes.some(c => c.classId === "fighter" && c.level >= 11) ? 3 : level >= 5 ? 2 : 1;
  }
}
