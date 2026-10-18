// New (M6's screen, docs/combat-design.md §2 and §3): how a fight looks, in the look layer's terms: who's who on the board as the map's renderer draws them (their letters and colours, a fall changing their glyph, a hit lighting them up), each kind of blow, shot and spell as the look layer's effects (a blade's sweep, a club's knock, a bite, an arrow by its way across the screen, a bolt in its element's colour, a fireball, a shockwave), the numbers and words that pop up off them, the hit-point gauge and the condition tags the turn-order bar shows, and the tints the board is marked with. Procedural, Caves of Qud style, as the rest of the look layer is: no art, only characters and colour.
import type { Unit, UnitState } from "../../shared/fight/types.ts";
import { townRegion } from "../../shared/map/reconcile.ts";
import type { MapActor, Region, Tile2, TileMap } from "../../shared/map/types.ts";
import { DAMAGE_COLOR, hexMix } from "./color.ts";
import { ELEMENTS, spellElement } from "./director.ts";
import type { Effects } from "./effects.ts";
import type { GlyphSet } from "./glyphs.ts";

/**
 * A fight's look (docs/combat-design.md §3): the board is the place's own map, drawn by the map's
 * renderer, everyone on it a map actor; what happens plays as the look layer's effects, in the feet
 * of the region that is the whole map (its corner the world's origin), so a bolt lands on the tile
 * its target stands on.
 */

/** The region a fight's effects play in: the whole map, its (0, 0) the world's. */
export const fightRegion = (map: TileMap): Region => townRegion(map);

/** A tile's middle in that region's feet. */
export const feetOf = (t: Tile2) => ({ x: t.x * 5 + 2.5, y: t.y * 5 + 2.5 });

/** How someone stands at a moment of the playback: where, their hit points, how they are, their conditions. */
export interface Stance { at: Tile2; hp: number; maxHp: number; state: UnitState; conditions: string[] }

/** Somebody the look draws by kind: beasts are creatures, the rest people. */
const BEAST = /\b(wolf|wolves|dog|hound|rat|boar|bear|spider|snake|bat|cat|horse|goat|goose|swan)\b/i;

/**
 * Someone in a fight as the map's renderer draws them: the cast by their look (Kell's blue K, Sallow's
 * $, the Crakes' C, or their sprites in Kingmaker Glyphs), the rest by the fight's own letter and
 * colour; the player their @. Down, they're an x on the floor where they fell (a % if they died), and
 * the glyph tips over as they fall (`falling`, 0 to 1: their letter lit red, then / and _, then the x).
 * Surrendered, they're greyed. The fled aren't on the board.
 */
export function unitActor(u: Unit, stance: Stance, map: string, falling?: number): MapActor | undefined {
  if (stance.state === "fled") return undefined;
  const base = { id: u.id, name: u.name, map, at: { ...stance.at } };
  const fallen = stance.state === "down" || stance.state === "dead";
  if (falling !== undefined && falling < 1) {
    const glyph = falling < 0.25 ? (u.id === "player" || u.glyph === "@" ? "@" : u.glyph) : falling < 0.5 ? "/" : falling < 0.75 ? "_" : fallen ? (stance.state === "dead" ? "%" : "x") : u.glyph;
    return { ...base, kind: "person", glyph, color: falling < 0.25 ? "#ff5a4a" : hexMix(u.color, "#6a6470", Math.min(1, falling)), states: ["fallen"] };
  }
  if (fallen) return { ...base, kind: "person", glyph: stance.state === "dead" ? "%" : "x", color: hexMix(u.color, "#6a6470", 0.6), states: ["fallen"] };
  const states = [...stance.conditions.filter(c => c === "prone"), ...(stance.state === "surrendered" ? ["surrendered"] : []), ...(stance.hp * 2 < stance.maxHp ? ["bloodied"] : [])];
  if (u.glyph === "@" || u.side === "player") return { ...base, kind: "player", glyph: "@", color: u.color || "#ffffff", ...(states.length ? { states } : {}) };
  const kind = BEAST.test(u.name) ? "creature" : "person";
  const grey = stance.state === "surrendered" ? hexMix(u.color, "#6a6470", 0.55) : u.color;
  // The cast keep their look from the one cast table (their letters, colours and sprites); the rest are drawn as the fight set them out.
  return u.castId && stance.state === "fighting" ? { ...base, kind, glyph: u.glyph, color: u.color, ref: u.castId, ...(states.length ? { states } : {}) } : { ...base, kind, glyph: u.glyph, color: grey, ...(states.length ? { states } : {}) };
}

/** A prop as the map draws it: a lantern or a brazier standing where it stands, lit while it burns. */
export function propActor(p: { id: string; name: string; at: Tile2; glyph: string; lit: boolean; state: string; carriedBy?: string | undefined }, map: string, carrier?: Tile2): MapActor | undefined {
  if (p.state !== "standing") return undefined;
  return { id: p.id, name: p.name, kind: "object", glyph: p.glyph, color: p.lit ? "#ffd27f" : "#8a8070", map, at: { ...(carrier ?? p.at) }, states: [p.lit ? "lit" : "out", ...(carrier ? ["carried"] : [])] };
}

// ---------------------------------------------------------------------------------------------
// Which way things go across the screen. The board is isometric (client/map/render.ts): a tile
// step east goes up and right on screen, a step south down and right, so a blow's or a shot's way
// on screen is the map's turned through 45 degrees.

/** The way from one tile to another as the screen shows it, in eighths of a turn: 0 right, 2 down, 4 left, 6 up. */
export function octant(from: Tile2, to: Tile2): number {
  const dx = to.x - from.x, dy = to.y - from.y;
  const vx = dx + dy, vy = dy - dx;
  if (!vx && !vy) return 0;
  return ((Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) % 8) + 8) % 8;
}

/** A line's character for a way across the screen. */
const LINE = ["-", "\\", "|", "/", "-", "\\", "|", "/"];

/** An arrow, a bolt or a stone in flight, drawn along its way. */
export const flightGlyph = (from: Tile2, to: Tile2) => LINE[octant(from, to)]!;

/** What a weapon does on screen: a blade sweeps, a club knocks, a beast bites. */
export type BlowStyle = "blade" | "blunt" | "bite";

export function blowStyle(weapon: string): BlowStyle {
  if (/bite|claw|fang|talon|jaw|maw/i.test(weapon)) return "bite";
  if (/club|mace|hammer|staff|quarterstaff|fist|unarmed|cudgel|maul|flail|grapple|shove|kick/i.test(weapon)) return "blunt";
  return "blade";
}

/**
 * A blow's flash between the one swinging and the one swung at, frame by frame: a blade sweeps
 * across the way the blow goes (three strokes of a line turning), a club lands as a knock, a bite as
 * jaws closing. One cell, so it reads at a glance and never hides who's fighting.
 */
export function blowFrames(style: BlowStyle, from: Tile2, to: Tile2): string {
  if (style === "bite") return "v∩∙";
  if (style === "blunt") return "*☼*";
  const across = (octant(from, to) + 2) % 8;
  return `${LINE[(across + 7) % 8]}${LINE[across]}${LINE[(across + 1) % 8]}`;
}

const BLOW_COLOR: Record<BlowStyle, string> = { blade: "#e8eef4", blunt: "#ffd27f", bite: "#ffb0a0" };

/** A melee blow: the flash between them, for `ms`, from `when`. */
export function swing(fx: Effects, from: Tile2, to: Tile2, weapon: string, when: number, ms: number): void {
  const style = blowStyle(weapon);
  fx.effect("slash", { from: feetOf(from), to: feetOf(to), glyph: blowFrames(style, from, to), color: BLOW_COLOR[style], ms }, when);
}

/** A shot: an arrow (or a bolt, a stone) flying the line, in `ms`. */
export function shot(fx: Effects, from: Tile2, to: Tile2, when: number, ms: number): void {
  fx.effect("throw", { from: feetOf(from), to: feetOf(to), glyph: flightGlyph(from, to), color: "#d8c8a0", arc: 0, ms }, when);
}

/** A spell's element: what its damage says, else what its name does (Fire Bolt is fire). */
export const elementOf = (element: string | undefined, spell: string) => element ?? spellElement(spell);

/** A spell at someone: a bolt in its element's colour (Magic Missile three darts, lightning a stroke), in `ms`. */
export function bolt(fx: Effects, from: Tile2, to: Tile2, element: string | undefined, spell: string, when: number, ms: number): void {
  const color = ELEMENTS[element ?? ""] ?? "#c79bf2";
  if (element === "lightning") { fx.effect("lightning", { from: feetOf(from), to: feetOf(to) }, when + ms * 0.6); return; }
  const darts = /missile/i.test(spell) ? 3 : 1;
  for (let k = 0; k < darts; k++) fx.effect("bolt", { from: feetOf(from), to: feetOf(to), color, ms: Math.max(140, ms - k * 90), delay: k * 90 }, when);
}

/** A spell laid on an area: its tiles lit, then the blast (a fireball for fire, a shockwave and a flash for the rest), in `ms`. */
export function blast(fx: Effects, from: Tile2, at: Tile2, tiles: Tile2[], element: string | undefined, when: number, ms: number): void {
  const color = ELEMENTS[element ?? ""] ?? "#c79bf2";
  const far = tiles.reduce((m, t) => Math.max(m, Math.hypot(t.x - at.x, t.y - at.y)), 0);
  const radius = Math.max(5, (far + 0.5) * 5);
  if (element === "fire") fx.effect("fireball", { from: feetOf(from), at: feetOf(at), radius }, when + Math.max(0, ms - 300));
  else { fx.effect("shockwave", { at: feetOf(at), radius, color }, when + ms * 0.5); fx.effect("flash", { at: feetOf(at), radius: radius / 2, color }, when + ms * 0.5); }
}

/** A hit landing: sparks in the damage's colour and the number popping up and drifting off them (a critical's with a !, and more sparks); the one hit flickers as it lands (hitFlash). */
export function struck(fx: Effects, unit: string, at: Tile2, amount: number, type: string | undefined, critical: boolean, when: number): void {
  const color = DAMAGE_COLOR[type ?? ""] ?? "#ff5a4a";
  fx.effect("sparks", { at: feetOf(at), color, amount: critical ? 2.5 : 1 }, when);
  fx.float({ id: unit }, `${amount}${critical ? "!" : ""}`, { damage: type ?? "bludgeoning" }, when);
}

/** Healing: green sparks, and the hit points back popping up. */
export function healed(fx: Effects, unit: string, at: Tile2, amount: number, when: number): void {
  fx.effect("sparks", { at: feetOf(at), color: ELEMENTS.heal! }, when);
  fx.float({ id: unit }, `+${amount}`, { damage: "heal" }, when);
}

/** A word off someone, pale: "miss", "parried", "saved". */
export function said(fx: Effects, unit: string, word: string, when: number, color = "#c8c0b0"): void {
  fx.float({ id: unit }, word, { style: "info", color, life: 1100 }, when);
}

// ---------------------------------------------------------------------------------------------
// A hit's flash on the one hit, and the board's tints.

/** The one hit lit up as it lands, flickering twice (`k`: how far into the hit, 0 to 1): white on red, then their own. */
export function hitFlash(k: number): { fg: string; bg: string } | undefined {
  if (k < 0 || k >= 0.45) return undefined;
  return Math.floor(k / 0.15) % 2 === 0 ? { fg: "#ffffff", bg: "#b8261e" } : { fg: "#1a0c0c", bg: "#ffd0c0" };
}

/** The board's tints (the map's renderer mixes each with the floor under it). */
export const TINT = {
  /** A tile the player can walk to this turn. */
  reach: "#2f6fb0",
  /** One a walk to would draw a swing on the way. */
  swing: "#9a4a20",
  /** How far what's being aimed reaches. */
  ring: "#4a4128",
  /** Who or what it could be aimed at. */
  target: "#8a6a1c",
  /** An area aimed there that can't be done. */
  wrong: "#5a2424",
} as const;

/** Whose turn it is: their tile, lit gold, breathing (`t` the clock, ms; brighter as their turn begins, `fresh` 0 to 1). */
export function activeTint(t: number, fresh = 0): string {
  const breath = 0.5 + 0.5 * Math.sin(t / 260);
  return hexMix("#5a4600", "#e8c170", Math.min(1, 0.25 + 0.35 * breath + 0.4 * fresh));
}

/** An area's tiles aimed, in its element's colour. */
export const areaTint = (element: string | undefined, ok: boolean) => (ok ? hexMix(ELEMENTS[element ?? ""] ?? "#c79bf2", "#201010", 0.45) : TINT.wrong);

// ---------------------------------------------------------------------------------------------
// The turn-order bar's pieces.

/** A hit-point gauge, `width` cells: filled and empty, in its colour by how much is left. */
export function hpGauge(hp: number, maxHp: number, width: number, set: GlyphSet): { filled: string; empty: string; color: string } {
  const share = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  const n = hp > 0 ? Math.max(1, Math.round(share * width)) : 0;
  const [on, off] = set === "plain" ? ["#", "-"] : ["█", "░"];
  return { filled: on!.repeat(n), empty: off!.repeat(Math.max(0, width - n)), color: share > 0.5 ? "#7bd389" : share > 0.25 ? "#f4a259" : "#ff6b6b" };
}

/** A condition as a tag on someone: short, in a colour of its own. The engine's bookkeeping ("…-active") isn't one. */
const TAGS: Record<string, { text: string; color: string }> = {
  prone: { text: "prone", color: "#c8a060" }, grappled: { text: "held", color: "#f4a259" }, restrained: { text: "bound", color: "#f4a259" },
  dodged: { text: "dodging", color: "#8fc7ff" }, dodging: { text: "dodging", color: "#8fc7ff" }, frightened: { text: "afraid", color: "#c79bf2" },
  poisoned: { text: "poisoned", color: "#8fdc3a" }, blinded: { text: "blind", color: "#a8a49c" }, stunned: { text: "stunned", color: "#ffe680" },
  incapacitated: { text: "reeling", color: "#ffe680" }, paralyzed: { text: "frozen", color: "#bfefff" }, charmed: { text: "charmed", color: "#f08ad0" },
  invisible: { text: "unseen", color: "#9aa4ae" }, unconscious: { text: "out cold", color: "#8a8273" }, deafened: { text: "deaf", color: "#a8a49c" },
};

/** Someone's tags: their conditions worth showing, then how they are when they're out of it (down, gave up, gone). */
export function tagsOf(conditions: string[], state: UnitState, arrested = false): Array<{ text: string; color: string }> {
  const shown = conditions.filter(c => !/active$/.test(c) && !(c === "unconscious" && state !== "fighting")).map(c => TAGS[c] ?? { text: c.replace(/-/g, " "), color: "#a89bc4" });
  const how = state === "down" ? [{ text: "down", color: "#ff6b6b" }] : state === "dead" ? [{ text: "dead", color: "#ff6b6b" }] : state === "surrendered" ? [{ text: "gave up", color: "#c9c2b0" }] : state === "fled" ? [{ text: "gone", color: "#8a8273" }] : [];
  return [...how, ...(arrested ? [{ text: "in irons", color: "#c8ccd4" }] : []), ...shown.filter((t, i) => shown.findIndex(o => o.text === t.text) === i)];
}

/** A condition's tag as it pops up off someone gaining it ("prone"), or going ("no longer held"). */
export function tagWord(condition: string, gained: boolean): { text: string; color: string } {
  const tag = TAGS[condition] ?? { text: condition.replace(/-/g, " "), color: "#a89bc4" };
  return gained ? tag : { text: `not ${tag.text}`, color: "#a8a49c" };
}
