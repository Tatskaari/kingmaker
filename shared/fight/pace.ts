// New (M6, docs/combat-design.md §3): how long each part of a fight's moment takes on screen, which the screen plays by and the simulation spaces the other side's turns by.
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
  /** A turn's start: the bar moving on, the camera easing over. */
  turn: 400,
  /** A tile walked. */
  tile: 110,
  /** A melee swing: the lunge and back. */
  swing: 350,
  /** A shot or a bolt crossing the floor. */
  projectile: 350,
  /** An area lighting up before the blast. */
  area: 450,
  /** A hit's flash, and the damage popping up. */
  hit: 450,
  /** Someone going down. */
  fall: 450,
} as const;

/** How long one moment takes to play. */
export function playMs(event: Pick<FightEvent, "kind" | "detail">): number {
  const d = event.detail;
  const hits = d.hits.filter(h => h.damage.length || h.healed || h.fell).length;
  const falls = d.hits.filter(h => h.fell).length;
  const parts = [
    event.kind === "start" ? PACE.start : 0,
    event.kind === "turn" ? PACE.turn : 0,
    (d.path?.length ?? 0) * PACE.tile,
    event.kind === "attack" ? (d.rolls.some(r => !r.opportunity && isShot(r.with)) ? PACE.projectile : PACE.swing) : 0,
    event.kind === "cast" ? (d.area?.length ? PACE.area : PACE.projectile) : 0,
    hits ? PACE.hit : 0,
    falls * PACE.fall,
  ];
  return Math.max(PACE.caption, parts.reduce((a, b) => a + b, 0));
}

/** The most the simulation waits between the other side's turns, however much a turn had in it. */
export const MOST_MS = 5000;

/** How long the simulation waits before the next of the other side's turns: the moments just written, played. */
export function stepDelayMs(events: ReadonlyArray<Pick<FightEvent, "kind" | "detail">>): number {
  return Math.min(MOST_MS, events.reduce((ms, e) => ms + playMs(e), 0));
}

/** A ranged weapon by its name, for a shot's flight rather than a swing. */
const isShot = (weapon: string) => /bow|crossbow|sling|dart|javelin/i.test(weapon);
