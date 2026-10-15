import type { Tile2 } from "../types.ts";
import { clearShot, FEET, feetBetween, same, steps } from "./grid.ts";
import type { Unit } from "./model.ts";
import { feetTo, moveChoices, nearestExit, reachable, type Footing, type NamedMove, type Reach } from "./moves.ts";
import { EARSHOT } from "./skirmish.ts";
import type { Reading } from "./typed.ts";
import { cap, economy, slugOf, type Step, type Turn } from "./typed-turn.ts";

/**
 * A typed line's plan, walked on the board before any of it's done (typed.ts): where each move
 * would leave the player and with what movement, and whether each act could be done from there.
 * Dice aside: nobody else is taken to move, fall or give up on the way, and an opportunity attack
 * doesn't stop a move. A move before an act is made to somewhere the act can be done from (a step
 * back that keeps Sallow in line for the Fire Bolt), so the plan done is the plan checked; the first
 * step that couldn't happen is the refusal, and nothing's spent.
 */

/**
 * A plan as one turn: within the action economy (typed-turn.ts), then walked on the board, so what
 * can't be done is refused, with why, before any of it is. Done, it's the steps as they'll be made.
 */
export function planned(plan: Step[], turn: Turn, extra: Omit<Reading, "steps">): Reading {
  const spend = economy(plan, turn);
  const { warn: _warn, ...quiet } = extra;
  if ("refusal" in spend) return { ...quiet, steps: [], refusal: `${spend.refusal} Nothing's spent.` };
  const walked = walkPlan(spend.steps.map(s => s.id), turn);
  if ("refusal" in walked) return { ...quiet, steps: [], refusal: walked.refusal };
  return { ...extra, steps: walked.steps };
}

const DIRS: Record<string, Tile2> = { north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 }, northeast: { x: 1, y: -1 }, northwest: { x: -1, y: -1 }, southeast: { x: 1, y: 1 }, southwest: { x: -1, y: 1 } };

export function walkPlan(plan: string[], turn: Turn): { steps: string[] } | { refusal: string } {
  let foot: Footing = { at: turn.me.at, left: turn.o.movementLeft };
  const out: string[] = [];
  for (let i = 0; i < plan.length; i++) {
    const id = plan[i]!;
    if (id === "end_turn") { out.push(id); break; }
    const tiles = moveTiles(id, turn, foot);
    if (tiles) {
      const moved = moveFor(id, tiles, nextAct(plan, i), turn, foot);
      if ("refusal" in moved) return moved;
      out.push(moved.id);
      foot = moved.foot;
      continue;
    }
    if (id === "dash") foot = { ...foot, left: foot.left + turn.me.speed };
    const why = id === "leave" && !turn.s.exitAt(foot.at) ? outOfReach(turn, foot) : whyNotFrom(id, foot, turn);
    if (why) return { refusal: why };
    out.push(id);
  }
  return { steps: out };
}

/** Where a move step could end from a footing (best first), or undefined when the step isn't a move. */
function moveTiles(id: string, turn: Turn, foot: Footing): Reach[] | undefined {
  const named = namedMove(id, turn);
  if (named) return moveChoices(turn.s, turn.me, foot, named);
  const m = /^step_(\w+)$/.exec(id) ?? /^move_(\d+)_(\d+)$/.exec(id);
  if (!m) return undefined;
  const to = m[2] !== undefined ? { x: Number(m[1]), y: Number(m[2]) } : DIRS[m[1]!] ? { x: foot.at.x + DIRS[m[1]!]!.x, y: foot.at.y + DIRS[m[1]!]!.y } : undefined;
  if (!to) return [];
  if (same(to, foot.at)) return [{ at: to, feet: 0 }];
  return reachable(turn.s, turn.me, foot).filter(r => same(r.at, to));
}

function namedMove(id: string, turn: Turn): NamedMove | undefined {
  if (id === "back_off") return { kind: "back" };
  if (id === "make_for_the_door") return { kind: "door" };
  const m = /^close_(.+)$/.exec(id);
  const at = m ? turn.s.unit(m[1]!)?.at ?? turn.s.G.props[m[1]!]?.at : undefined;
  return at ? { kind: "close", at } : undefined;
}

/** The act a move is made for: the next step that has to be done from somewhere, before any other move. */
function nextAct(plan: string[], i: number): string | undefined {
  for (const id of plan.slice(i + 1)) {
    if (/^(?:back_off|make_for_the_door|close_|step_|move_\d)/.test(id)) return undefined;
    if (/^(?:attack_|cast_|use_|shove_|push_|grapple_|urge_|leave$)/.test(id)) return id;
  }
  return undefined;
}

/**
 * The move's tile: its best, or the best the act after it can be done from (then as a move to that
 * tile, so it's done where it was checked). None, and it says why.
 */
function moveFor(id: string, tiles: Reach[], act: string | undefined, turn: Turn, foot: Footing): { id: string; foot: Footing } | { refusal: string } {
  if (!tiles.length) return { refusal: noMove(id, turn, foot) };
  const from = (r: Reach): Footing => ({ at: r.at, left: foot.left - r.feet });
  const fits = act ? tiles.filter(r => !whyNotFrom(act, from(r), turn, false)) : tiles;
  const pick = fits[0];
  if (!pick && act === "leave") return { refusal: outOfReach(turn, foot) };
  if (!pick) return { refusal: `${cap(moveWords(id, turn))} would leave you nowhere to ${actWords(act!, turn)} from: ${lowerLead(whyNotFrom(act!, from(tiles[0]!), turn, false) ?? "")} Nothing's spent.` };
  return { id: pick === tiles[0] ? id : `move_${pick.at.x}_${pick.at.y}`, foot: from(pick) };
}

/** Why a move can't be made at all. */
function noMove(id: string, turn: Turn, foot: Footing): string {
  if (foot.left < FEET) return `You'd have no movement left for ${moveWords(id, turn)}. Nothing's spent.`;
  if (id === "back_off") return "There's nowhere to back off to that's further from them. Nothing's spent.";
  if (id === "make_for_the_door") return "There's no way out to make for. Nothing's spent.";
  return `You can't get there from where you'd be. Nothing's spent.`;
}

/** The way out too far to go out through this turn: how far, and what would do it. */
function outOfReach(turn: Turn, foot: Footing): string {
  const exit = nearestExit(turn.s, foot.at);
  const label = turn.s.G.exits.find(e => exit && same(e.at, exit))?.label ?? "the way out";
  const feet = exit ? feetTo(turn.s, turn.me, foot.at, exit) : undefined;
  if (feet === undefined) return `There's no getting to ${label} from here. Nothing's spent.`;
  const dash = turn.o.dash && feet + FEET <= foot.left + turn.me.speed;
  return `${cap(label)} is ${feet} ft off, and going out through it takes 5 ft more: you've ${foot.left} ft of movement. ${dash ? `A Dash would get you out ("dash and leave"), or` : "You could"} make for it ("make for the door") and go out next turn. Nothing's spent.`;
}

/**
 * Why an act can't be done from a footing (undefined: it can, as far as the board goes), said from
 * where the plan would have the player by then when it's moved them (`where`).
 */
function whyNotFrom(id: string, foot: Footing, turn: Turn, where = true): string | undefined {
  const s = turn.s;
  const there = { ...turn.me, at: foot.at };
  const moved = where && !same(foot.at, turn.me.at);
  const from = (why: string) => `${moved ? `From where you'd be by then, ${lowerLead(why)}` : why}${where ? " Nothing's spent." : ""}`;
  if (id === "leave") {
    if (!s.exitAt(foot.at)) return from("You'd not be in the way out.");
    return foot.left < FEET ? from("You'd need 5 ft of movement left to go out.") : undefined;
  }
  let m = /^attack_(.+?)(?:_with_(.+))?$/.exec(id);
  if (m) return attackFrom(m[1]!, m[2], there, turn, from);
  m = /^(?:use|shove|push|grapple)_(.+)$/.exec(id);
  if (m) {
    const at = s.unit(m[1]!)?.at ?? s.G.props[m[1]!]?.at;
    const name = s.unit(m[1]!)?.called ?? `the ${s.G.props[m[1]!]?.name ?? "thing"}`;
    return at && steps(foot.at, at) > 1 ? from(`${cap(name)} is out of reach (${feetBetween(foot.at, at)} ft): you need to be right beside ${id.startsWith("use_") ? "it" : "them"}.`) : undefined;
  }
  m = /^urge_(?:intimidation|persuasion|deception|performance)_(?:yield|go|hold)_(?:(?:willing|wavering|hostile)_)?(.+)$/.exec(id);
  if (m) {
    const u = s.unit(m[1]!);
    return u && feetBetween(foot.at, u.at) > EARSHOT ? from(`${cap(u.called)} would be too far off to hear it (${feetBetween(foot.at, u.at)} ft).`) : undefined;
  }
  if (id.startsWith("cast_")) return castFrom(id.replace(/_slot\d$/, ""), foot, turn, from);
  return undefined;
}

/** A blow or a shot from a footing, as the rules check it (TacticalFight.parse picks the weapon the same way). */
function attackFrom(targetId: string, with_: string | undefined, there: Unit, turn: Turn, from: (why: string) => string): string | undefined {
  const s = turn.s;
  const t = s.unit(targetId) ?? (s.G.props[targetId] ? { at: s.G.props[targetId]!.at, id: targetId, called: `the ${s.G.props[targetId]!.name}` } : undefined);
  if (!t) return undefined;
  if (with_ === "improvised") return steps(there.at, t.at) > 1 ? from(`${cap(t.called)} is out of reach for a blow with something to hand (${feetBetween(there.at, t.at)} ft).`) : undefined;
  const weapons = with_ ? turn.me.weapons.filter(w => slugOf(s.namer().weapon(w)) === with_) : turn.me.weapons;
  if (!weapons.length) return undefined;
  if (weapons.some(w => !s.attackCheck(there, t, w).error)) return undefined;
  return from(s.attackCheck(there, t, weapons[0]!).error ?? `${cap(t.called)} is out of reach.`);
}

/** A spell from a footing, as Skirmish.cast checks it: in range, and a clear line (an area going out from you just needs a way to point). */
function castFrom(id: string, foot: Footing, turn: Turn, from: (why: string) => string): string | undefined {
  const s = turn.s;
  const choice = [...turn.o.spells].sort((a, b) => b.id.length - a.id.length).find(sp => id === `cast_${sp.id}` || id.startsWith(`cast_${sp.id}_`));
  if (!choice || choice.targeting === "self") return undefined;
  const rest = id.slice(`cast_${choice.id}`.length).replace(/^_/, "");
  const tile = /^at_(\d+)_(\d+)$/.exec(rest);
  const who = rest.replace(/^at_/, "");
  const aim = tile ? { x: Number(tile[1]), y: Number(tile[2]) } : (who === s.G.pc ? foot.at : s.unit(who)?.at ?? s.G.props[who]?.at);
  if (!aim) return undefined;
  const name = s.unit(who)?.called ?? (s.G.props[who] ? `the ${s.G.props[who]!.name}` : "there");
  const fromSelf = !!choice.area && choice.range === 0;
  if (fromSelf) return same(aim, foot.at) ? from(`${choice.name} goes out from you: it needs somewhere to point.`) : undefined;
  const reach = choice.targeting === "area" ? choice.range : Math.max(choice.range, FEET);
  const far = feetBetween(foot.at, aim);
  if (far > reach) return from(`${cap(name)} would be ${far} ft away; ${choice.name} reaches ${reach} ft.`);
  return !same(aim, foot.at) && !clearShot(s.G.map, foot.at, aim) ? from(`There's no clear line to ${name}.`) : undefined;
}

/** A move step in words, for a refusal ("backing off", "making for the way out"). */
function moveWords(id: string, turn: Turn): string {
  if (id === "back_off") return "backing off";
  if (id === "make_for_the_door") return "making for the way out";
  const m = /^close_(.+)$/.exec(id);
  if (m) return `getting next to ${turn.s.unit(m[1]!)?.called ?? `the ${turn.s.G.props[m[1]!]?.name ?? "it"}`}`;
  return "that move";
}

/** An act in words, for a refusal ("cast Fire Bolt at Master Sallow", "hit the talking Crake"). */
function actWords(id: string, turn: Turn): string {
  const s = turn.s;
  const name = (x: string) => s.unit(x)?.called ?? (s.G.props[x] ? `the ${s.G.props[x]!.name}` : x);
  let m = /^attack_(.+?)(?:_with_(.+))?$/.exec(id);
  if (m) return `${m[2] === "improvised" ? "hit" : "attack"} ${name(m[1]!)}`;
  m = /^use_(.+)$/.exec(id);
  if (m) return `knock over ${name(m[1]!)}`;
  m = /^(shove|push|grapple)_(.+)$/.exec(id);
  if (m) return `${m[1] === "grapple" ? "grab" : "shove"} ${name(m[2]!)}`;
  m = /^urge_(?:[a-z]+)_(?:yield|go|hold)_(?:(?:willing|wavering|hostile)_)?(.+)$/.exec(id);
  if (m) return `talk to ${name(m[1]!)}`;
  if (id === "leave") return "go out";
  const spell = turn.o.spells.find(sp => id === `cast_${sp.id}` || id.startsWith(`cast_${sp.id}_`));
  if (spell) {
    const who = id.replace(/_slot\d$/, "").slice(`cast_${spell.id}`.length).replace(/^_(?:at_)?/, "");
    return `cast ${spell.name}${who && !/^\d+_\d+$/.test(who) ? ` at ${who === s.G.pc ? "yourself" : name(who)}` : ""}`;
  }
  return "do that";
}

/** "There's no clear line" in the middle of a sentence: a leading common word lowered, never a name. */
const lowerLead = (t: string) => (/^(?:There|The|You|It|A|An|That|This)\b/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
