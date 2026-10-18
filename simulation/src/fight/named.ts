// Copied from the prototype's src/game/combat/moves.ts at bc2ab1f, whole but at its seams (shared/fight's grid and types, the ported Skirmish): where a move by name takes someone, which the player's options name their moves by (fight/options.ts: close in on someone, back off, make for the way out).
import type { Tile2 } from "../../../shared/map/types.ts";
import { explore, FEET, fromKey, key, same, steps } from "../../../shared/fight/grid.ts";
import type { Unit } from "../../../shared/fight/types.ts";
import type { Skirmish } from "./skirmish.ts";

/**
 * Where a move by name takes someone: next to someone or something, away from the other side, or
 * onto the nearest way out. From where they stand with the movement they have, or from where a
 * plan would leave them (a typed line's move after its shot: typed-plan.ts), so a plan is checked
 * against the same tiles it's then done on (TacticalFight.parse).
 */

/** Where someone stands, and the feet of movement they have left. */
export interface Footing { at: Tile2; left: number }

/** A tile someone can end a move on, and the feet it takes to get there. */
export interface Reach { at: Tile2; feet: number }

export type NamedMove = { kind: "close"; at: Tile2 } | { kind: "door" } | { kind: "back" };

/** The tiles u can end a move on from a footing (not where they are: that's no move). */
export function reachable(s: Skirmish, u: Unit, from: Footing): Reach[] {
  const most = Math.floor(from.left / FEET);
  if (!most) return [];
  const seen = explore(s.G.map, from.at, { ...s.pathRules(u, { avoidFire: false }), maxSteps: most });
  return [...seen].map(([k, r]) => ({ at: fromKey(k), feet: r.steps * FEET })).filter(r => !same(r.at, from.at) && !s.occupant(r.at, u.id));
}

/**
 * Where a named move could end, best first; an empty list when it can't be made. Already where it
 * would take them (beside who they'd close on, on the way out), it's no move: the tile they're on.
 */
export function moveChoices(s: Skirmish, u: Unit, from: Footing, move: NamedMove): Reach[] {
  const here: Reach = { at: from.at, feet: 0 };
  const tiles = reachable(s, u, from);
  switch (move.kind) {
    case "close": {
      if (steps(from.at, move.at) <= 1) return [here];
      return tiles.sort((a, b) => Math.abs(steps(a.at, move.at) - 1) - Math.abs(steps(b.at, move.at) - 1) || steps(a.at, from.at) - steps(b.at, from.at));
    }
    case "door": {
      const exit = nearestExit(s, from.at);
      if (!exit) return [];
      if (same(exit, from.at)) return [here];
      return tiles.sort((a, b) => steps(a.at, exit) - steps(b.at, exit) || steps(a.at, from.at) - steps(b.at, from.at));
    }
    case "back": return backChoices(s, from, tiles);
  }
}

/** The nearest way out (by tiles, as the crow flies), the one they stand on if they do. */
export function nearestExit(s: Skirmish, from: Tile2): Tile2 | undefined {
  return [...s.G.exits].sort((a, b) => steps(a.at, from) - steps(b.at, from))[0]?.at;
}

/**
 * Backing off: out of the fire first, then as far from the other side as the turn takes them, the
 * shortest way there first. Only tiles further from them than where they stand.
 */
function backChoices(s: Skirmish, from: Footing, tiles: Reach[]): Reach[] {
  const foes = s.units.filter(v => v.state === "fighting" && v.side === "enemy");
  const threat = (t: Tile2) => Math.min(99, ...foes.map(f => steps(f.at, t)));
  const hot = (t: Tile2) => s.G.fire.some(k => steps(fromKey(k), t) <= 1);
  const now = threat(from.at);
  return tiles.filter(r => threat(r.at) > now)
    .sort((a, b) => Number(hot(a.at)) - Number(hot(b.at)) || threat(b.at) - threat(a.at) || steps(from.at, a.at) - steps(from.at, b.at));
}

/** The feet from a footing to a tile, by the shortest way round (undefined when there's none). */
export function feetTo(s: Skirmish, u: Unit, from: Tile2, to: Tile2): number | undefined {
  const seen = explore(s.G.map, from, s.pathRules(u, { avoidFire: false }));
  const r = seen.get(key(to));
  return r ? r.steps * FEET : undefined;
}
