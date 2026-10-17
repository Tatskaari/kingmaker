// Copied from the prototype's src/rules/actions.ts at 44c6d4a, lines 23-98 (the catalogue's types, ORDINAL and rangeFeet) and 596-599 (entryLabel), and src/rules/dnd.ts 1357-1366 (areaPlacement and towards, which shared/rules/acts.ts held and now re-exports): what the map's action menu (shared/map/menu.ts) needs of the rules, with no rules code, so the client aims as the simulation does without loading the acts or the engine. Catalogue gains `you` (the player's hurt and conditions, which the prototype's menu read from the engine: menu.ts youHurt and cureFor). The catalogue itself is shared/rules/actions.ts's.
import { positionOf, type SceneWorld } from "../world/scene-world.ts";
import type { JumpReach } from "./acts.ts";

/**
 * What the player's character can do outside a fight, by kind (town-design §3.3): the action menu's
 * catalogue, as the simulation makes it (shared/rules/actions.ts catalogue, with the engine) and
 * keeps it on the sheet row (`actions`, JSON), and as the client reads it there. Each entry's aim says
 * what it needs (someone, someone or something, a spot for an area, a direction from you, a place to
 * land, or nothing) and how far it reaches; where, and at whom, is the map's to say.
 */

export type Group = "cantrips" | "spells" | "features" | "actions" | "items";

export type Aim =
  /** Just do it (hide, a rest). */
  | { kind: "none" }
  /** On yourself (Second Wind, Shield of Faith on you). */
  | { kind: "self" }
  /** Someone (people and creatures), within range in feet; yourself too when `self`. */
  | { kind: "creature"; range: number; self: boolean }
  /** Someone or something (a door, a cart): within range; yourself too when `self`. */
  | { kind: "target"; range: number; self: boolean }
  /** A spot for an area (a 20-ft sphere 150 ft off), or, from yourself, a direction (a cone, a line). */
  | { kind: "area"; range: number; shape: string; size: number; fromSelf: boolean }
  /**
   * Somewhere to land or to step to (a leap, Misty Step), within range. A leap's `jump`: how far it
   * goes easily with a run-up and standing (half as far again takes Athletics; `range` is the most).
   */
  | { kind: "tile"; range: number; jump?: { long: number; standing: number } };

/** What it does to whoever it's aimed at: who reacts to it, and what's a scene's to play (charming someone). */
export type Effect = "harm" | "social" | "help" | "none";

export interface Entry {
  /** Stable in a menu: "spell:fire-bolt", "feature:second-wind", "jump", "rest:short". */
  key: string;
  group: Group;
  name: string;
  /** One line: what it does, how far. */
  summary: string;
  aim: Aim;
  effect: Effect;
  /** Why it can't be done now; undefined when it can. */
  why?: string;
  /** It heals: no use on someone who isn't hurt. */
  heals?: boolean;
  /** The conditions it ends (Lesser Restoration: blinded, deafened, paralysed, poisoned): no use on someone who has none of them. */
  cures?: string[];
  /** The game core's action id, or its stem for an aimed one: "cast_fire-bolt" (+ "@x,y" or "_self"), "rest_short". */
  act: string;
  spell?: { id: string; level: number; slot: number; pact?: boolean; ritual?: boolean; concentration: boolean; bonus?: boolean; element?: string };
  uses?: { current: number; max: number; recharge?: string };
}

export interface Section {
  key: string;
  group: Group;
  /** "Cantrips", "1st level", "Class features", "Actions", "To hand". */
  title: string;
  /** What's left: "3/4 slots", "pact slots 2/2". */
  note?: string;
  entries: Entry[];
}

export interface Catalogue {
  sections: Section[];
  /** Every entry, in the order the sections list them. */
  entries: Entry[];
  /** How far they jump (feet), for aiming a leap. */
  reach: JumpReach;
  /** Their main weapon, for attacks. */
  weapon?: { name: string; range: number; long?: number; dice: string; type: string };
  /**
   * v2: the player as the menu's checks read them (the prototype's menu asked the engine): hurt, as
   * the rules heal (below the engine's own maximum), and the conditions they have now.
   */
  you: { hurt: boolean; conditions: string[] };
}

export interface Context {
  /** Rested already since the story's clock last moved: once each a time of day. */
  rested?: { short?: boolean; long?: boolean };
}

export const ORDINAL = ["cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

/** "120 feet" → 120, "Touch" → 5, "Self" or "Self (15-foot cone)" → 0, a mile in feet. */
export function rangeFeet(range: string): number {
  if (/^touch/i.test(range)) return 5;
  if (/^self/i.test(range)) return 0;
  const m = /(\d+)\s*(feet|foot|ft)/i.exec(range);
  if (m) return Number(m[1]);
  const miles = /(\d+)\s*mile/i.exec(range);
  return miles ? Number(miles[1]) * 5280 : /unlimited/i.test(range) ? 5280 : 0;
}

/** "Fire Bolt (cantrip)", "Fireball (3rd-level slot)", for a line that says what was chosen. */
export function entryLabel(e: Entry): string {
  if (!e.spell) return e.name;
  return `${e.name} (${e.spell.ritual ? "a ritual" : e.spell.level ? `${ORDINAL[e.spell.slot || e.spell.level]}-level${e.spell.pact ? " pact" : ""} slot` : "cantrip"})`;
}

/**
 * Where a spell's area sits in a world, as castSpell puts it: it goes out from the caster (the
 * player) towards the aim, a cube from the caster sitting in front of them; anything else centres on
 * the aim (or on the caster, aimed at nothing). The map's aim works it out the same way.
 */
export function areaPlacement(world: SceneWorld, shape: { shape: string; size: number }, fromCaster: boolean, aim?: { x: number; y: number }): { origin: { x: number; y: number }; centre: { x: number; y: number } } {
  const origin = positionOf(world, "player")!;
  const at = aim ?? origin;
  return { origin, centre: fromCaster && shape.shape === "cube" ? towards(origin, at, shape.size / 2) : at };
}

function towards(from: { x: number; y: number }, to: { x: number; y: number }, feet: number) {
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) / d) * feet, y: from.y + ((to.y - from.y) / d) * feet };
}
