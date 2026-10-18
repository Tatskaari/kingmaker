// After the prototype's src/game/combat/skirmish.ts options() and src/game/combat/fights.ts TacticalFight.actions() at bc2ab1f: what the player can do on their turn, with the action ids the map's own moves take (attack@x,y, cast_<spell>@x,y, cast_<spell>_self, shove@x,y, grapple@x,y, walk@x,y: shared/map/moves.ts) where the prototype had its own (attack_<target>, cast_<spell>_<target>, move_<x>_<y>…), and the fight's own acts (dash, dodge, disengage, leave, auto, end_turn, and yield, new). Each says what the screen's menu and aiming show (new, M6's screen): its name, what it costs, where it's aimed, how far it reaches, an area's tiles; and the reachable tiles a walk to would draw a swing on the way. Left out with what they're for: a punch beside your weapon, Reckless Attack and a word with weight (V13's typed lines), a higher slot.
import { clearShot, destinations, FEET, feetBetween, same, steps } from "../../../shared/fight/grid.ts";
import type { FightAction, FightOptions, Unit } from "../../../shared/fight/types.ts";
import type { Tile2 } from "../../../shared/map/types.ts";
import { moveChoices, nearestExit } from "./named.ts";
import { attackBonus, type Skirmish } from "./skirmish.ts";

/**
 * What the player can do now, on their turn (docs/combat-design.md §2): the feet they have left
 * (and their full movement) and where they can go (and which of those tiles a walk to would draw a
 * swing), whether their action and bonus action are spent, and every act they could make, by its
 * action id, with what it would be: a blow at whoever a weapon reaches (and a lantern), each spell
 * at whoever it can reach, a shove or a grab beside you, closing in on each of the other side,
 * backing off, making for the way out, dash, dodge, disengage, leaving through a way out you stand
 * in, letting the dice decide, yielding, and ending the turn.
 */
export function optionsOf(s: Skirmish): FightOptions {
  const u = s.pc();
  const use = s.usage(u);
  const actionUsed = !use || use.actionUsed;
  const bonusActionUsed = !use || use.bonusActionUsed;
  const movementLeft = s.movementLeft(u);
  const moves = movementLeft >= FEET ? s.moveTargets(u) : [];
  const all: FightAction[] = [
    ...attacks(s, u),
    ...spells(s, u),
    ...wrestles(s, u),
    ...named(s, u, movementLeft),
    ...turnActs(s, u, actionUsed),
  ];
  // One choice an id: a lantern hanging over someone is the someone (the act takes whoever's there first).
  const actions = all.filter((a, i) => all.findIndex(b => b.id === a.id) === i);
  const swings = swingTiles(s, u, movementLeft);
  return { movementLeft, speed: u.speed * (use?.dashed ? 2 : 1), actionUsed, bonusActionUsed, moves, ...(swings.length ? { swings } : {}), actions };
}

/** Nothing at all left of the player's turn: no action, no movement worth a step, and no bonus-action spell they could cast. */
export function nothingLeft(s: Skirmish): boolean {
  const u = s.pc();
  const use = s.usage(u);
  if (!use) return true;
  const attacking = use.attacksMadeThisTurn > 0 && use.attacksMadeThisTurn < s.attacksPerAction(u);
  if (!use.actionUsed || attacking || s.movementLeft(u) >= FEET) return false;
  return use.bonusActionUsed || !s.spellChoices(u).some(sp => sp.bonus && !sp.hurls);
}

const at = (t: Tile2) => `${t.x},${t.y}`;
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** How far a weapon reaches, in feet: 5 (10 with reach) in melee, its long range shot. */
function reachOf(s: Skirmish, weapon: string): number {
  const item = s.t.item(weapon);
  if (item?.attackKind !== "ranged") return item?.properties?.includes("reach") ? 10 : 5;
  return Number(item["rangeLong"] ?? item["rangeNormal"] ?? 30);
}

/** Whether the action's attacks aren't all spent: an action unused, or Extra Attack's second blow still to come. */
function canAttack(s: Skirmish, u: Unit): boolean {
  const use = s.usage(u);
  if (!use) return false;
  return !use.actionUsed || (use.attacksMadeThisTurn > 0 && use.attacksMadeThisTurn < s.attacksPerAction(u));
}

/** A blow at each of the other side a weapon reaches (the first that does: attack@x,y takes it), and at a hanging lantern. */
function attacks(s: Skirmish, u: Unit): FightAction[] {
  if (!canAttack(s, u)) return [];
  const sheet = s.t.sheet(u.engineId);
  const out: FightAction[] = [];
  for (const v of s.units.filter(v => v.state === "fighting" && s.hostile(u, v) && v.role !== "coward")) {
    const w = u.weapons.find(w => !s.attackCheck(u, v, w).error);
    if (!w) continue;
    const check = s.attackCheck(u, v, w);
    const notes = [check.advantage, check.cover ? "half cover" : undefined, `${feetBetween(u.at, v.at)} ft`].filter(Boolean).join(", ");
    out.push({ id: `attack@${at(v.at)}`, label: `Attack ${v.name} (${s.namer().weapon(w)} ${signed(attackBonus(sheet, w))}; ${notes})`, kind: "attack", name: "Attack", cost: "action", at: { ...v.at }, target: v.id, range: reachOf(s, w) });
  }
  for (const p of Object.values(s.G.props).filter(p => p.kind === "lantern" && p.state === "standing" && !p.carriedBy)) {
    const w = u.weapons.find(w => !s.attackCheck(u, { at: p.at, id: p.id }, w).error);
    if (w) out.push({ id: `attack@${at(p.at)}`, label: `Attack the ${p.name} (${s.namer().weapon(w)} ${signed(attackBonus(sheet, w))}${s.dustAt(p.at) ? "; it hangs over the dust" : ""})`, kind: "attack", name: "Attack", cost: "action", at: { ...p.at }, target: p.id, range: reachOf(s, w) });
  }
  return out;
}

/** Each spell they can cast now, at each target it reaches (a spot for an area: whoever's there), or on themselves. */
function spells(s: Skirmish, u: Unit): FightAction[] {
  const use = s.usage(u);
  if (!use) return [];
  const out: FightAction[] = [];
  for (const sp of s.spellChoices(u).filter(sp => (sp.bonus ? !use.bonusActionUsed && !(sp.hurls && use.actionUsed) : !use.actionUsed))) {
    const slot = sp.slot ? ` (${ordinal(sp.slot)}-level slot)` : "";
    const dust = sp.fire && s.G.dust.length ? "; fire: mind the dust" : "";
    const cost = sp.bonus ? "bonus" as const : "action" as const;
    if (sp.targeting === "self") { out.push({ id: `cast_${sp.id}_self`, label: `Cast ${sp.name}${slot}`, kind: "cast", name: sp.name, cost, at: { ...u.at }, target: u.id, range: 0 }); continue; }
    const fromSelf = /^self/i.test(sp.spell.range);
    const size = (sp.spell["targeting"] as { size: number } | undefined)?.size ?? 5;
    const reach = fromSelf ? size : Math.max(sp.range, 5);
    const targets = s.units.filter(v => v.state !== "fled" && v.state !== "dead" && (sp.heal ? s.friendly(v, u) || v.id === u.id : s.hostile(u, v) && v.state === "fighting" && v.role !== "coward"))
      .filter(v => feetBetween(u.at, v.at) <= Math.max(sp.range, 5) && (same(v.at, u.at) || clearShot(s.G.map, u.at, v.at)) && (!fromSelf || steps(u.at, v.at) * FEET <= size))
      .filter(v => !(fromSelf && same(v.at, u.at)));
    for (const v of targets) {
      const how = sp.targeting === "area" ? `at ${v.name}'s spot (a ${size}-foot ${(sp.spell["targeting"] as { shape: string }).shape})` : `${sp.heal ? "on" : "at"} ${v.id === u.id ? "yourself" : v.name}`;
      const area = sp.targeting === "area" ? { area: s.spellArea(u, sp.spell, v.at).map(t => ({ ...t })) } : {};
      out.push({ id: v.id === u.id ? `cast_${sp.id}_self` : `cast_${sp.id}@${at(v.at)}`, label: `Cast ${sp.name} ${how}${slot}${dust}`, kind: "cast", name: sp.name, cost, at: { ...v.at }, target: v.id, range: reach, ...area });
    }
  }
  return out;
}

/** A shove (over) or a grab at whoever's beside you on the other side, and a brazier or lantern beside you knocked over (shove@ at it), while the action's free. */
function wrestles(s: Skirmish, u: Unit): FightAction[] {
  if (!s.actionLeft(u)) return [];
  const out: FightAction[] = [];
  for (const v of s.units.filter(v => v.state === "fighting" && s.hostile(u, v) && steps(u.at, v.at) <= 1)) {
    out.push({ id: `shove@${at(v.at)}`, label: `Shove ${v.name} over (they save, or they're down)`, kind: "attack", name: "Shove", cost: "action", at: { ...v.at }, target: v.id, range: 5 });
    out.push({ id: `grapple@${at(v.at)}`, label: `Grab hold of ${v.name} (they save, or they're held)`, kind: "attack", name: "Grab", cost: "action", at: { ...v.at }, target: v.id, range: 5 });
  }
  for (const p of Object.values(s.G.props).filter(p => p.state === "standing" && !p.carriedBy && steps(u.at, p.at) <= 1)) {
    out.push({ id: `shove@${at(p.at)}`, label: `${p.kind === "brazier" ? "Kick over" : "Bring down"} the ${p.name}${s.G.dust.length ? " (into the dust!)" : ""}`, kind: "attack", name: "Knock over", cost: "action", at: { ...p.at }, target: p.id, range: 5 });
  }
  return out;
}

/** Moves by name (where walk@x,y would take them): closer to each of the other side, away from them, to the way out. */
function named(s: Skirmish, u: Unit, left: number): FightAction[] {
  if (left < FEET) return [];
  const out: FightAction[] = [];
  const footing = { at: u.at, left };
  const walk = (to: { at: Tile2; feet: number }, name: string, label: string): FightAction => ({ id: `walk@${at(to.at)}`, label, kind: "move", name, cost: "move", at: { ...to.at }, feet: to.feet });
  for (const v of s.units.filter(v => v.state === "fighting" && s.hostile(u, v) && steps(v.at, u.at) > 1)) {
    const best = moveChoices(s, u, footing, { kind: "close", at: v.at })[0];
    if (best && !same(best.at, u.at)) out.push(walk(best, `Close in on ${v.name}`, `Close in on ${v.name} (${best.feet} ft${steps(best.at, v.at) > 1 ? ", not all the way" : ""})`));
  }
  if (s.units.some(v => v.state === "fighting" && s.hostile(u, v) && steps(v.at, u.at) <= 1)) {
    const back = moveChoices(s, u, footing, { kind: "back" })[0];
    if (back) out.push(walk(back, "Back off", `Back off (${back.feet} ft; a swing at you unless you disengage first)`));
  }
  const exit = nearestExit(s, u.at);
  const way = exit ? s.G.exits.find(e => same(e.at, exit)) : undefined;
  if (exit && way && !same(exit, u.at)) {
    const door = moveChoices(s, u, footing, { kind: "door" })[0];
    if (door && !same(door.at, u.at)) out.push(walk(door, `Make for ${way.label}`, `Make for ${way.label} (${door.feet} ft${same(door.at, exit) ? "" : ", not all the way"})`));
  }
  // Every named move is a walk to a tile: two names for one tile are one choice.
  return out.filter((a, i) => out.findIndex(b => b.id === a.id) === i);
}

/** The fight's own acts: dash, dodge and disengage while the action's free, leaving by a way out they stand in, letting the dice decide, yielding, and ending the turn. */
function turnActs(s: Skirmish, u: Unit, actionUsed: boolean): FightAction[] {
  const use = s.usage(u);
  const out: FightAction[] = [];
  const exit = s.exitAt(u.at);
  if (exit && s.movementLeft(u) >= FEET) out.push({ id: "leave", label: `Leave through ${exit.label} (you've fled the fight)`, kind: "turn", name: `Leave through ${exit.label}`, cost: "move" });
  if (!actionUsed && !use?.dashed) out.push({ id: "dash", label: `Dash (${u.speed} ft more movement this turn)`, kind: "turn", name: "Dash", cost: "action" });
  if (!actionUsed) out.push({ id: "dodge", label: "Dodge (attacks on you have disadvantage until your next turn)", kind: "turn", name: "Dodge", cost: "action" });
  if (!actionUsed && !use?.disengaged) out.push({ id: "disengage", label: "Disengage (no swings at you as you move away this turn)", kind: "turn", name: "Disengage", cost: "action" });
  out.push({ id: "auto", label: "Let the dice decide (the AI plays your turn)", kind: "turn", name: "Let the dice decide", cost: "free" });
  out.push({ id: "yield", label: "Yield (put your hands up: the fight is over)", kind: "turn", name: "Yield", cost: "free" });
  out.push({ id: "end_turn", label: "End your turn", kind: "turn", name: "End your turn", cost: "free" });
  return out;
}

/**
 * The tiles they can walk to this turn whose way there (the path a walk takes) leaves the reach of
 * someone on the other side who could swing at them for it: standing, with their reaction ready and
 * a blade in hand. None once they've disengaged.
 */
function swingTiles(s: Skirmish, u: Unit, left: number): Tile2[] {
  const use = s.usage(u);
  if (!use || use.disengaged || left < FEET) return [];
  const foes = s.units.flatMap(v => {
    if (!s.hostile(u, v) || !s.able(v) || !s.reactionReady(v)) return [];
    const blade = v.weapons.find(w => s.t.item(w)?.attackKind === "melee");
    return blade ? [{ at: v.at, reach: reachOf(s, blade) / FEET }] : [];
  });
  if (!foes.some(f => steps(f.at, u.at) <= f.reach)) return [];
  return destinations(s.G.map, u.at, Math.floor(left / FEET), s.pathRules(u, { avoidFire: false }))
    .filter(d => [u.at, ...d.path].some((p, i, path) => i > 0 && foes.some(f => steps(f.at, path[i - 1]!) <= f.reach && steps(f.at, p) > f.reach)))
    .map(d => ({ ...d.at }));
}

const ordinal = (n: number) => ["cantrip", "1st", "2nd", "3rd"][n] ?? `${n}th`;
