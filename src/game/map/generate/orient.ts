import { CORNERS, SIDES, type Corner, type PlacePlan, type Side } from "./plan.ts";

/**
 * Turning a plan to face the camera. The viewer stands to the south-west, so the south and west
 * sides of a building are its front: what stands there is seen, and what stands to the north and
 * east is behind the building, hidden by it. A generated place has no fixed geography, so the
 * compiler picks one of the eight turns and mirrorings of the plan's compass that puts the street
 * (and as much of the outside as it can) in front, and relabels every direction in the plan.
 *
 * A turn is `quarter` clockwise quarter turns after an optional east-west mirror. Problems found
 * after compiling are told back to the model in its own compass (`back`).
 */

export interface Turn { quarter: number; mirror: boolean }

export const IDENTITY: Turn = { quarter: 0, mirror: false };

const index = (s: Side) => SIDES.indexOf(s);

/** Where a side of the plan ends up on the map. */
export function turnSide(turn: Turn, side: Side): Side {
  const i = turn.mirror ? (4 - index(side)) % 4 : index(side);
  return SIDES[(i + turn.quarter) % 4]!;
}

/** The side of the plan that ended up on this side of the map. */
export function backSide(turn: Turn, side: Side): Side {
  for (const s of SIDES) if (turnSide(turn, s) === side) return s;
  return side;
}

const cornerSides = (c: Corner) => c.split("-") as [Side, Side];
function cornerOf(a: Side, b: Side): Corner {
  const found = CORNERS.find(c => { const [x, y] = cornerSides(c); return (x === a && y === b) || (x === b && y === a); });
  if (!found) throw new Error(`no corner between ${a} and ${b}`);
  return found;
}

export const turnCorner = (turn: Turn, c: Corner) => { const [a, b] = cornerSides(c); return cornerOf(turnSide(turn, a), turnSide(turn, b)); };
export const backCorner = (turn: Turn, c: Corner) => { const [a, b] = cornerSides(c); return cornerOf(backSide(turn, a), backSide(turn, b)); };

/** Odd quarter turns swap east-west and north-south extents. */
export const swaps = (turn: Turn) => turn.quarter % 2 === 1;

const FRONT: Record<Side, number> = { south: 4, west: 3, north: 0, east: 0 };

/**
 * The turn that puts the plan's front where the camera sees it: the entrance's outside on the south
 * (or west), then every other outside area in front too. Ties keep the plan as written.
 */
export function chooseTurn(plan: PlacePlan, entrance?: string): Turn {
  const turns: Turn[] = [];
  for (const mirror of [false, true]) for (let quarter = 0; quarter < 4; quarter++) turns.push({ quarter, mirror });
  const score = (turn: Turn) => {
    let s = 0;
    for (const o of plan.outside) {
      const side = turnSide(turn, o.side);
      const front = FRONT[side];
      s += o.id === entrance ? 3 * front : front > 0 ? 2 : 0;
    }
    return s;
  };
  let best = IDENTITY, bestScore = score(IDENTITY);
  for (const t of turns) { const s = score(t); if (s > bestScore) { best = t; bestScore = s; } }
  return best;
}

const isSide = (s: string): s is Side => (SIDES as readonly string[]).includes(s);
const isCorner = (s: string): s is Corner => (CORNERS as readonly string[]).includes(s);

/** The plan with every direction turned (a copy). */
export function turnPlan(plan: PlacePlan, turn: Turn): PlacePlan {
  if (turn.quarter === 0 && !turn.mirror) return structuredClone(plan);
  const swap = swaps(turn);
  const where = (w: string) => (isSide(w) ? turnSide(turn, w) : isCorner(w) ? turnCorner(turn, w) : w);
  return {
    ...structuredClone(plan),
    width: swap ? plan.depth : plan.width,
    depth: swap ? plan.width : plan.depth,
    outside: plan.outside.map(o => ({ ...o, side: turnSide(turn, o.side) })),
    rooms: plan.rooms.map(r => ({ ...r, where: where(r.where) as typeof r.where, width: swap ? r.depth : r.width, depth: swap ? r.width : r.depth })),
    doors: plan.doors.map(d => ({ ...d, states: [...d.states], wall: isSide(d.wall) ? turnSide(turn, d.wall) : d.wall })),
    windows: plan.windows.map(w => ({ ...w, wall: isSide(w.wall) ? turnSide(turn, w.wall) : w.wall })),
    things: plan.things.map(t => ({
      ...t, tags: [...t.tags], states: [...t.states],
      wall: isSide(t.wall) ? turnSide(turn, t.wall) : t.wall,
      corner: isCorner(t.corner) ? turnCorner(turn, t.corner) : t.corner,
    })),
    people: plan.people.map(p => ({ ...p })),
  };
}

/**
 * The water where the camera can see it. A wharf on one side and the river on the other (the Heron
 * "half on the wharf and half on piles over the river") can't both face the camera, and the turn
 * puts the way in in front; so the river, with its plank walk and its boats, goes round to the other
 * front side, as the hand-made Heron has it (the wharf to the west, the river to the south). What's
 * in it turns with it, and the doors to it open on its new side. Left as it is if a side room has a
 * door onto it (the room may not reach the new side).
 */
export function frontWater(laid: PlacePlan): { plan: PlacePlan; moved?: { from: Side; to: Side } } {
  const watery = (g: string) => g === "water" || g === "boat";
  const front: Side[] = ["south", "west"];
  if (laid.outside.some(o => watery(o.ground) && front.includes(o.side))) return { plan: laid };
  const from = laid.outside.find(o => watery(o.ground))?.side;
  if (!from) return { plan: laid };
  const group = laid.outside.filter(o => o.side === from);
  const ids = new Set(group.map(o => o.id));
  const main = laid.rooms.find(r => r.where === "main")?.id;
  if (laid.doors.some(d => ids.has(d.to) && d.from !== main)) return { plan: laid };
  // The free front side, else the front side the way in is on (the river beyond the street).
  const busy = (s: Side) => laid.outside.some(o => o.side === s && !ids.has(o.id));
  const to = front.find(s => !busy(s)) ?? front[0]!;
  const turn: Turn = { quarter: (SIDES.indexOf(to) - SIDES.indexOf(from) + 4) % 4, mirror: false };
  const plan = structuredClone(laid);
  plan.outside = [...plan.outside.filter(o => !ids.has(o.id)), ...plan.outside.filter(o => ids.has(o.id)).map(o => ({ ...o, side: to }))];
  for (const d of plan.doors) if (ids.has(d.to) && d.wall !== "any") d.wall = to;
  for (const t of plan.things) {
    if (!ids.has(t.in)) continue;
    if (isSide(t.wall)) t.wall = turnSide(turn, t.wall);
    if (isCorner(t.corner)) t.corner = turnCorner(turn, t.corner);
  }
  return { plan, moved: { from, to } };
}

/**
 * A compass word in a message about the laid-out map, marked so it can be said back in the plan's
 * own compass (ids and names that happen to contain "north" are left alone).
 */
export const dir = (s: string) => `@@${s}@@`;

/** A message's marked compass words, in the plan's own compass. */
export function sayBack(turn: Turn, text: string): string {
  return text.replace(/@@([a-z-]+)@@/g, (_, w: string) => (isCorner(w) ? backCorner(turn, w) : isSide(w) ? backSide(turn, w) : w));
}
