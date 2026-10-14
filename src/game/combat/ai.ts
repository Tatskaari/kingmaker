import type { Tile2 } from "../types.ts";
import { approach, clearShot, explore, FEET, feetBetween, fromKey, key, line, same, solid, steps } from "./grid.ts";
import type { Unit } from "./model.ts";
import type { Skirmish, SpellChoice } from "./skirmish.ts";

/**
 * Who does what on their turn. The Crakes close on the nearest foe and gang up on one (Pack
 * Tactics); Master Sallow fences from behind his Crakes, and when badly hurt runs for the land door
 * if it's clear or surrenders if it isn't; the lantern-boy runs; Kell backs the player, and puts the
 * irons on anyone beaten. The player's side has an AI too, for the headless demo: a fighter who
 * goes for Sallow, and a wizard who has noticed the dust.
 *
 * decide() looks at the board (read-only) and returns the next step; the controller makes it as a
 * boardgame.io move and asks again, until the step is "end".
 */

export type Step =
  | { kind: "move"; to: Tile2 }
  | { kind: "attack"; target: string; weapon?: string }
  | { kind: "cast"; spell: string; target?: string; at?: Tile2 }
  | { kind: "use"; prop: string }
  | { kind: "dash" } | { kind: "dodge" } | { kind: "disengage" }
  | { kind: "leave" } | { kind: "surrender" }
  | { kind: "arrest"; target: string }
  | { kind: "nerve"; dc: number; why: string }
  | { kind: "remark"; line: string }
  | { kind: "end" };

/** What this turn has done so far, so the AI doesn't go round in circles. */
export interface Memo { moves: number; steps: number; remarked: boolean; dashed: boolean; failed: string[] }
export const freshMemo = (): Memo => ({ moves: 0, steps: 0, remarked: false, dashed: false, failed: [] });

export type PlayerStyle = "fighter" | "wizard";

export function decide(s: Skirmish, u: Unit, memo: Memo, style?: PlayerStyle): Step {
  if (memo.steps++ > 12 || !s.able(u)) return { kind: "end" };
  switch (u.role) {
    case "player": return style === "wizard" ? wizard(s, u, memo) : fighter(s, u, memo);
    case "ally": return ally(s, u, memo);
    case "villain": return villain(s, u, memo);
    case "coward": return coward(s, u, memo);
    case "bystander": return { kind: "end" };
    default: return bruiser(s, u, memo);
  }
}

// ---------------------------------------------------------------------------------------------
// Looking around.

const foes = (s: Skirmish, u: Unit) => s.units.filter(v => s.hostile(u, v) && v.state === "fighting");
const adjacentFoes = (s: Skirmish, u: Unit) => foes(s, u).filter(v => steps(u.at, v.at) <= 1);
const meleeWeapon = (s: Skirmish, u: Unit) => u.weapons.find(w => s.t.item(w)?.attackKind !== "ranged") ?? u.weapons[0];
const rangedWeapon = (s: Skirmish, u: Unit) => u.weapons.find(w => s.t.item(w)?.attackKind === "ranged");

function canAttack(s: Skirmish, u: Unit): boolean {
  const use = s.usage(u);
  if (!use) return false;
  return !use.actionUsed || (use.attacksMadeThisTurn > 0 && use.attacksMadeThisTurn < s.attacksPerAction(u));
}

/** The best foe to hit from here: a villain first, then whoever an ally is already on (Pack Tactics), then the weakest. */
function pickTarget(s: Skirmish, u: Unit, among: Unit[]): Unit | undefined {
  const packed = (v: Unit) => s.units.some(o => o.id !== u.id && s.friendly(o, u) && s.able(o) && steps(o.at, v.at) <= 1);
  return [...among].sort((a, b) =>
    Number(b.role === "villain") - Number(a.role === "villain") ||
    Number(packed(b)) - Number(packed(a)) ||
    a.hp / a.maxHp - b.hp / b.maxHp)[0];
}

/** Walk towards a tile where `good` holds, as far as this turn's movement goes; never stopping on someone. */
function walk(s: Skirmish, u: Unit, good: (t: Tile2) => boolean, towards: Tile2, options: { avoidDust?: boolean } = {}): Tile2 | undefined {
  const rules = s.pathRules(u, { avoidDust: options.avoidDust ?? false });
  const plan = approach(s.G.map, u.at, t => good(t) && !s.occupant(t, u.id), towards, rules);
  if (!plan || !plan.path.length) return undefined;
  const budget = Math.floor(s.movementLeft(u) / FEET);
  let k = Math.min(budget, plan.path.length);
  while (k > 0 && s.occupant(plan.path[k - 1]!, u.id)) k--;
  return k > 0 ? plan.path[k - 1] : undefined;
}

const adjacentTo = (s: Skirmish, v: Unit) => (t: Tile2) => steps(t, v.at) === 1 && !solid(s.G.map, t);

/** Steps it takes to get next to v (Infinity when there's no way). */
function reachCost(s: Skirmish, u: Unit, v: Unit): number {
  const seen = explore(s.G.map, u.at, s.pathRules(u));
  let best = Infinity;
  for (const [k, r] of seen) { const t = fromKey(k); if (steps(t, v.at) === 1 && !s.occupant(t, u.id)) best = Math.min(best, r.steps); }
  return steps(u.at, v.at) === 1 ? 0 : best;
}

/** Close in and hit: the core of every melee AI. */
function closeAndHit(s: Skirmish, u: Unit, memo: Memo, target?: Unit): Step {
  const near = adjacentFoes(s, u);
  if (near.length && canAttack(s, u)) {
    const t = pickTarget(s, u, near)!;
    return { kind: "attack", target: t.id, weapon: meleeWeapon(s, u) };
  }
  const goal = target ?? [...foes(s, u)].sort((a, b) => reachCost(s, u, a) - reachCost(s, u, b))[0];
  if (!goal) return { kind: "end" };
  if (!near.length && memo.moves < 2 && s.movementLeft(u) >= FEET) {
    const cost = reachCost(s, u, goal);
    // Too far to reach and hit this turn: dash, if there's nothing better to do with the action.
    if (cost > s.movementLeft(u) / FEET && !memo.dashed && s.actionLeft(u)) {
      const shot = rangedWeapon(s, u);
      if (shot && !s.attackCheck(u, goal, shot).error && canAttack(s, u)) return { kind: "attack", target: goal.id, weapon: shot };
      memo.dashed = true;
      return { kind: "dash" };
    }
    const to = walk(s, u, adjacentTo(s, goal), goal.at);
    if (to) { memo.moves++; return { kind: "move", to }; }
  }
  const shot = rangedWeapon(s, u);
  if (shot && canAttack(s, u)) {
    const t = foes(s, u).find(v => !s.attackCheck(u, v, shot).error);
    if (t) return { kind: "attack", target: t.id, weapon: shot };
  }
  return { kind: "end" };
}

/** Out through the nearest door, dashing. */
function run(s: Skirmish, u: Unit, memo: Memo): Step {
  if (s.exitAt(u.at)) return { kind: "leave" };
  const exits = s.G.exits.map(e => e.at).filter(t => !s.occupant(t, u.id));
  const door = [...exits].sort((a, b) => steps(u.at, a) - steps(u.at, b))[0];
  if (!door) return { kind: "end" };
  if (s.actionLeft(u) && !memo.dashed && steps(u.at, door) * FEET > s.movementLeft(u)) { memo.dashed = true; return { kind: "dash" }; }
  if (memo.moves < 3 && s.movementLeft(u) >= FEET) {
    const to = walk(s, u, t => same(t, door), door);
    if (to && !same(to, u.at)) { memo.moves++; return { kind: "move", to }; }
  }
  return { kind: "end" };
}

/** Is there a door this unit could reach without a foe in the way, within two turns of dashing? */
function clearRun(s: Skirmish, u: Unit): boolean {
  const seen = explore(s.G.map, u.at, s.pathRules(u));
  return s.G.exits.some(e => {
    const r = seen.get(key(e.at));
    return !!r && r.steps <= (u.speed * 2 / FEET) * 2 && !foes(s, u).some(f => steps(f.at, e.at) <= 2);
  });
}

// ---------------------------------------------------------------------------------------------
// The other side.

function bruiser(s: Skirmish, u: Unit, memo: Memo): Step {
  const villain = s.units.find(v => v.side === u.side && v.role === "villain");
  const paid = !villain || villain.state === "fighting";
  const brothers = s.units.filter(v => v.side === u.side && v.id !== u.id && (v.role === "bruiser" || v.role === "brawler"));
  const alone = brothers.length > 0 && brothers.every(b => b.state !== "fighting");
  const nerve = s.G.flags[`nerve:${u.id}`];
  // The last one standing of the hired hands: do they fancy it on their own?
  if (alone && nerve === undefined && u.role === "bruiser") {
    const fallen = brothers.find(b => b.state === "down" || b.state === "dead");
    return { kind: "nerve", dc: 10, why: fallen ? `${u.called} looks at ${fallen.called} on the floor` : `${u.called} finds himself on his own` };
  }
  const breaking = nerve === "broke" || (u.role === "brawler" ? u.hp * 2 <= u.maxHp : u.hp * 4 <= u.maxHp && !paid);
  if (breaking) {
    if (adjacentFoes(s, u).length) return { kind: "surrender" };
    if (!memo.remarked) { memo.remarked = true; return { kind: "remark", line: "flee:bruiser" }; }
    return run(s, u, memo);
  }
  return closeAndHit(s, u, memo);
}

function villain(s: Skirmish, u: Unit, memo: Memo): Step {
  const near = adjacentFoes(s, u);
  const hired = s.units.filter(v => v.side === u.side && v.id !== u.id && (v.role === "bruiser" || v.role === "brawler"));
  const nerve = s.G.flags[`nerve:${u.id}`];
  // His last Crake is down or gone: a coward's nerve, tested once.
  if (hired.length && hired.every(v => v.state !== "fighting") && nerve === undefined) {
    return { kind: "nerve", dc: 12, why: `${u.called} looks at his Crakes, and then at you` };
  }
  if (u.hp * 2 <= u.maxHp || nerve === "broke") {
    // Badly hurt: run if the door's clear, otherwise yield (very politely).
    if (!near.length && clearRun(s, u)) {
      if (!memo.remarked) { memo.remarked = true; return { kind: "remark", line: "flee:sallow" }; }
      return run(s, u, memo);
    }
    return { kind: "surrender" };
  }
  if (near.length && canAttack(s, u)) return { kind: "attack", target: pickTarget(s, u, near)!.id, weapon: meleeWeapon(s, u) };
  const guards = s.units.filter(v => v.side === u.side && v.id !== u.id && v.state === "fighting" && (v.role === "bruiser" || v.role === "brawler"));
  if (!guards.length) return closeAndHit(s, u, memo);
  if (near.length) return { kind: "end" };
  // Behind the Crakes: no foe in reach, a Crake nearer the trouble than he is, and no fire.
  const threat = (t: Tile2) => Math.min(...foes(s, u).map(f => steps(f.at, t)));
  const safe = (t: Tile2) => threat(t) >= 3 && guards.some(g => threat(g.at) < threat(t)) && !s.hotAt(t);
  if (!safe(u.at) && memo.moves < 1 && s.movementLeft(u) >= FEET) {
    const seen = explore(s.G.map, u.at, { ...s.pathRules(u), maxSteps: Math.floor(s.movementLeft(u) / FEET) });
    const spots = [...seen.keys()].map(fromKey).filter(t => !s.occupant(t, u.id) && safe(t));
    const best = spots.sort((a, b) => Math.abs(threat(a) - 3) - Math.abs(threat(b) - 3) || steps(u.at, a) - steps(u.at, b))[0];
    if (best) { memo.moves++; return { kind: "move", to: best }; }
  }
  if (!memo.remarked && s.G.round % 2 === 1) { memo.remarked = true; return { kind: "remark", line: "hide:sallow" }; }
  // Somebody could get at him next turn: he keeps moving (Dodge). Otherwise he consults his watch.
  const reachable = foes(s, u).some(f => steps(f.at, u.at) <= f.speed / FEET + 1);
  if (reachable && s.actionLeft(u)) return { kind: "dodge" };
  return { kind: "end" };
}

function coward(s: Skirmish, u: Unit, memo: Memo): Step {
  if (!memo.remarked && !s.G.log.some(l => l.who === u.id && l.kind === "narration")) { memo.remarked = true; return { kind: "remark", line: "flee:coward" }; }
  return run(s, u, memo);
}

// ---------------------------------------------------------------------------------------------
// The player's side.

function ally(s: Skirmish, u: Unit, memo: Memo): Step {
  const pc = s.pc();
  const beaten = s.units.filter(v => s.hostile(u, v) && (v.state === "down" || v.state === "surrendered") && !v.arrested);
  const near = adjacentFoes(s, u);
  // The irons come out once nobody's fighting: the investigator first, the paperwork after.
  if (!foes(s, u).length && s.actionLeft(u)) {
    const cuff = beaten.find(v => steps(u.at, v.at) <= 1);
    if (cuff) return { kind: "arrest", target: cuff.id };
  }
  if (near.length && canAttack(s, u)) return { kind: "attack", target: pickTarget(s, u, near.filter(v => steps(v.at, pc.at) <= 1).length ? near.filter(v => steps(v.at, pc.at) <= 1) : near)!.id, weapon: meleeWeapon(s, u) };
  const fighting = foes(s, u);
  if (!fighting.length) {
    const next = [...beaten].sort((a, b) => Number(b.role === "villain") - Number(a.role === "villain") || steps(u.at, a.at) - steps(u.at, b.at))[0];
    if (next && memo.moves < 2 && s.movementLeft(u) >= FEET) {
      const to = walk(s, u, adjacentTo(s, next), next.at);
      if (to) { memo.moves++; return { kind: "move", to }; }
    }
    return { kind: "end" };
  }
  // Back the investigator: whoever is on them, else whoever is nearest them.
  const onPc = fighting.filter(v => steps(v.at, pc.at) <= 1);
  const target = pickTarget(s, u, onPc.length ? onPc : [...fighting].sort((a, b) => steps(a.at, pc.at) - steps(b.at, pc.at)).slice(0, 2));
  if (!near.length && target && memo.moves < 2 && s.movementLeft(u) >= FEET) {
    const to = walk(s, u, adjacentTo(s, target), target.at, { avoidDust: true });
    if (to) { memo.moves++; return { kind: "move", to }; }
  }
  return closeAndHit(s, u, memo, target);
}

/** Enemies standing in the dust, and friends who'd go up with them. */
function dustOdds(s: Skirmish, u: Unit): { enemies: Unit[]; friends: Unit[] } {
  const inDust = s.units.filter(v => v.state !== "fled" && v.state !== "dead" && s.dustAt(v.at));
  return { enemies: inDust.filter(v => s.hostile(u, v) && v.state === "fighting"), friends: inDust.filter(v => !s.hostile(u, v)) };
}

/** Worth blowing up the floor? A good haul of enemies (or Sallow himself), and nobody of ours in it. */
function dustWorthIt(s: Skirmish, u: Unit): boolean {
  if (!s.G.dust.length) return false;
  const { enemies, friends } = dustOdds(s, u);
  return friends.length === 0 && (enemies.length >= 2 || enemies.some(e => e.role === "villain"));
}

function fighter(s: Skirmish, u: Unit, memo: Memo): Step {
  // The brazier: kick it over into the dust while they're standing in it (and we aren't).
  const brazier = Object.values(s.G.props).find(p => p.kind === "brazier" && p.state === "standing" && p.lit);
  if (brazier && dustWorthIt(s, u) && s.actionLeft(u) && !memo.failed.includes("brazier")) {
    if (steps(u.at, brazier.at) <= 1 && !s.dustAt(u.at)) { memo.failed.push("brazier"); return { kind: "use", prop: brazier.id }; }
    // A step to the brazier is worth a swing at your back while you're still on your feet.
    if (memo.moves < 1 && (!adjacentFoes(s, u).length || u.hp * 2 > u.maxHp)) {
      const to = walk(s, u, t => steps(t, brazier.at) === 1 && !s.dustAt(t) && !s.G.dust.includes(key(t)), brazier.at);
      if (to && steps(to, brazier.at) <= 1) { memo.moves++; return { kind: "move", to }; }
    }
  }
  const villainNear = foes(s, u).find(v => v.role === "villain" && reachCost(s, u, v) * FEET <= s.movementLeft(u));
  return closeAndHit(s, u, memo, villainNear);
}

/**
 * The wizard has read about grain dust. From outside the cloud, with enemies in it and no friends:
 * Fireball if they have it, else a Fire Bolt through the dust (or Burning Hands into it). Otherwise
 * Magic Missile at Sallow, or a cantrip down a line that doesn't cross the dust.
 */
function wizard(s: Skirmish, u: Unit, memo: Memo): Step {
  const spells = s.spellChoices(u);
  const use = s.usage(u);
  const fire = spells.filter(sp => sp.fire && !sp.bonus && !use?.actionUsed);
  if (dustWorthIt(s, u) && fire.length) {
    const plan = dustPlan(s, u, fire);
    if (plan) {
      if (!same(plan.from, u.at)) {
        if (memo.moves < 2 && s.movementLeft(u) >= steps(u.at, plan.from) * FEET) { memo.moves++; return { kind: "move", to: plan.from }; }
      } else return { kind: "cast", spell: plan.spell.id, ...(plan.target ? { target: plan.target } : { at: plan.at }) };
    }
  }
  if (use?.actionUsed) return backOff(s, u, memo);
  const enemies = foes(s, u);
  const near = adjacentFoes(s, u);
  const ranked = [...enemies].sort((a, b) => Number(b.role === "villain") - Number(a.role === "villain") || a.hp - b.hp);
  // Shoved up close: Thunderwave them off (no fire, so no dust).
  const wave = spells.find(sp => sp.id === "thunderwave");
  if (near.length >= 1 && wave) return { kind: "cast", spell: wave.id, at: near[0]!.at };
  const missile = spells.find(sp => sp.id === "magic-missile");
  const inRange = (sp: SpellChoice, v: Unit) => feetBetween(u.at, v.at) <= sp.range && clearShot(s.G.map, u.at, v.at);
  if (missile) { const t = ranked.find(v => inRange(missile, v)); if (t) return { kind: "cast", spell: missile.id, target: t.id }; }
  const bolt = spells.find(sp => sp.id === "fire-bolt");
  const frost = spells.find(sp => sp.id === "ray-of-frost");
  for (const v of ranked) {
    const safeBolt = bolt && inRange(bolt, v) && !line(u.at, v.at).some(t => s.dustAt(t)) && (!s.G.dust.length || dustWorthIt(s, u));
    if (safeBolt) return { kind: "cast", spell: bolt.id, target: v.id };
    if (frost && inRange(frost, v)) return { kind: "cast", spell: frost.id, target: v.id };
  }
  return closeAndHit(s, u, memo);
}

/** After casting: step away from anyone in reach, if it's free to (no opportunity attacks from nobody). */
function backOff(s: Skirmish, u: Unit, memo: Memo): Step {
  if (adjacentFoes(s, u).length || memo.moves >= 2 || s.movementLeft(u) < FEET) return { kind: "end" };
  const threat = (t: Tile2) => Math.min(99, ...foes(s, u).map(f => steps(f.at, t)));
  if (threat(u.at) >= 3) return { kind: "end" };
  const seen = explore(s.G.map, u.at, { ...s.pathRules(u, { avoidDust: true }), maxSteps: Math.floor(s.movementLeft(u) / FEET) });
  const best = [...seen.keys()].map(fromKey).filter(t => !s.occupant(t, u.id) && !s.hotAt(t)).sort((a, b) => threat(b) - threat(a))[0];
  if (best && threat(best) > threat(u.at)) { memo.moves++; return { kind: "move", to: best }; }
  return { kind: "end" };
}

/** Where to stand (outside the dust) and what to cast so that the fire reaches it. */
function dustPlan(s: Skirmish, u: Unit, fire: SpellChoice[]): { from: Tile2; spell: SpellChoice; target?: string; at?: Tile2 } | undefined {
  const budget = Math.floor(s.movementLeft(u) / FEET);
  const seen = explore(s.G.map, u.at, { ...s.pathRules(u), maxSteps: budget });
  const spots = [u.at, ...[...seen.keys()].map(fromKey).filter(t => !s.occupant(t, u.id))]
    .filter(t => !s.dustAt(t) && !s.hotAt(t))
    .sort((a, b) => steps(u.at, a) - steps(u.at, b));
  const { enemies } = dustOdds(s, u);
  const order = [...fire].sort((a, b) => b.level - a.level);
  for (const from of spots.slice(0, 40)) {
    for (const sp of order) {
      if (sp.targeting === "area") {
        const shape = sp.spell["targeting"] as { shape: string; size: number };
        const self = /^self/i.test(sp.spell.range);
        const aims = self ? enemies.map(e => e.at) : [...enemies.map(e => e.at), ...s.G.dust.map(fromKey)].slice(0, 60);
        for (const at of aims) {
          if (!self && (feetBetween(from, at) > sp.range || !clearShot(s.G.map, from, at))) continue;
          if (self && steps(from, at) * FEET > shape.size) continue;
          const area = s.spellArea({ ...u, at: from }, sp.spell, at);
          if (!area.some(t => s.dustAt(t)) || area.some(t => same(t, from))) continue;
          return { from, spell: sp, at };
        }
      } else {
        const target = enemies.find(e => feetBetween(from, e.at) <= sp.range && clearShot(s.G.map, from, e.at));
        if (target) return { from, spell: sp, target: target.id };
        const dust = s.G.dust.map(fromKey).find(t => feetBetween(from, t) <= sp.range && clearShot(s.G.map, from, t));
        if (dust) return { from, spell: sp, at: dust };
      }
    }
  }
  return undefined;
}
