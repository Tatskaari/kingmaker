// New (M6, docs/combat-design.md §3): how long each part of a fight's moment takes on screen, which the screen plays by and the simulation spaces the other side's turns by. The parts are laid out here (partsOf), so the screen's playback and the simulation's spacing agree by construction.
import type { FightEvent } from "./types.ts";

/**
 * How long each part of a moment plays, in milliseconds (docs/combat-design.md §3): one table, so
 * the screen that plays the events and the simulation that schedules the other side's turns agree,
 * and a spectator sees the same pace as the player.
 */
export const PACE = {
  /** A caption's least time up, whatever plays under it. */
  caption: 500,
  /** The fight's start: the order coming up. */
  start: 1200,
  /** The short beat between one combatant's turn and the next: nothing moves. */
  beat: 250,
  /** A turn's start: the bar moving on, their tile lit. */
  turn: 400,
  /** A tile walked. */
  tile: 110,
  /** A melee swing (or a shove, a kick): the blow's flash between them. */
  swing: 350,
  /** A shot or a bolt crossing the floor. */
  projectile: 350,
  /** An area lighting up before the blast. */
  area: 450,
  /** What it did to them: a hit's flash and the damage popping up, a miss, a save, a condition. */
  hit: 450,
  /** Someone going down. */
  fall: 450,
} as const;

/** The parts a moment plays in, in order. */
export type PacePart = "start" | "beat" | "turn" | "steps" | "swing" | "projectile" | "area" | "hit" | "fall" | "hold";

/** A part of a moment on screen: what it is, when it starts (ms into the moment) and how long it plays. */
export interface Timed { part: PacePart; t: number; ms: number }

/**
 * A moment's parts, in the order they play (docs/combat-design.md §3): the start's order coming up;
 * a turn's beat, then its start; the path walked, a tile at a time; the act (a swing, a shot or a
 * bolt, an area lighting up); what it did to anyone (hits, misses, saves, conditions); each fall in
 * turn; and the caption held up to its least time. `t` is when each starts, in milliseconds.
 */
export function partsOf(event: Pick<FightEvent, "kind" | "detail">): Timed[] {
  const d = event.detail;
  const out: Timed[] = [];
  let t = 0;
  const add = (part: PacePart, ms: number) => {
    if (ms <= 0) return;
    out.push({ part, t, ms });
    t += ms;
  };
  if (event.kind === "start") add("start", PACE.start);
  if (event.kind === "turn") { add("beat", PACE.beat); add("turn", PACE.turn); }
  add("steps", (d.path?.length ?? 0) * PACE.tile);
  if (event.kind === "attack") { const shot = d.rolls.some(r => !r.opportunity && isShot(r.with)); add(shot ? "projectile" : "swing", shot ? PACE.projectile : PACE.swing); }
  if (event.kind === "cast") add(d.area?.length ? "area" : "projectile", d.area?.length ? PACE.area : PACE.projectile);
  if (event.kind === "wrestle" || event.kind === "use") add("swing", PACE.swing);
  if (d.hits.length || d.rolls.length) add("hit", PACE.hit);
  for (const _ of d.hits.filter(h => h.fell)) add("fall", PACE.fall);
  add("hold", PACE.caption - t);
  return out;
}

/** How long one moment takes to play. */
export function playMs(event: Pick<FightEvent, "kind" | "detail">): number {
  const parts = partsOf(event);
  const last = parts[parts.length - 1];
  return last ? last.t + last.ms : PACE.caption;
}

/** The most the simulation waits between the other side's turns, however much a turn had in it. */
export const MOST_MS = 5000;

/** How long the simulation waits before the next of the other side's turns: the moments just written, played. */
export function stepDelayMs(events: ReadonlyArray<Pick<FightEvent, "kind" | "detail">>): number {
  return Math.min(MOST_MS, events.reduce((ms, e) => ms + playMs(e), 0));
}

/** A ranged weapon by its name, for a shot's flight rather than a swing. */
export const isShot = (weapon: string) => /bow|crossbow|sling|dart|javelin/i.test(weapon);
