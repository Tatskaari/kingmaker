import type { SessionState } from "../runtime/session.ts";
import { positionOf, type Point } from "../world/scene-world.ts";
import type { CombatController } from "./combat/index.ts";
import type { Canvas } from "./look/canvas.ts";
import { dressingFor } from "./look/dressings.ts";
import { ELEMENTS, spellElement } from "./look/director.ts";
import { CAST_LOOKS } from "./look/people.ts";
import type { Effects } from "./look/effects.ts";
import { glyphSet, type GlyphSet } from "./look/glyphs.ts";
import { renderStage, type StagePicks } from "./look/stage.ts";
import { battlefield, regionForScene, render, tileToFeet, toPlain, type Picks, type RenderOptions, type Viewport } from "./map/index.ts";
import { castOf } from "./map/looks.ts";
import type { GameState } from "./play.ts";
import { exploreState } from "./town.ts";
import { xrayExplore } from "./map/xray.ts";
import type { MapActor, StoryState, StyledLine, Tile2 } from "./types.ts";

/**
 * Every picture of the world the game draws, in one place: the town as you walk it, a scene's place
 * with its world (on the map, or from above as the look layer's stage), and a fight on its
 * battlefield. The app shows these as live views, the QA console as plain text. The look layer
 * (src/game/look) decides how everything in them looks, alive, by one clock: `t`, in milliseconds.
 */

export interface ViewOptions {
  /** The animation clock in milliseconds: water runs, fire flickers, effects play. */
  t?: number;
  /** The clock in the map's old 100 ms ticks, when there's no `t`. */
  tick?: number;
  /** false: plain characters only (logs, tests): no motion, no effects, no icons. */
  color?: boolean;
  /** The glyph set (default: KM_GLYPHS, or what the terminal suggests). */
  glyphs?: GlyphSet;
  /** What's playing (the scene's or the fight's Effects), drawn over the place. */
  effects?: Effects;
  /** The tile under the pointer, lit up. */
  hover?: Tile2;
  /** Filled in with what's drawn where, for the mouse: pick.at(x, y) is the tile (and who) in a cell. */
  pick?: Picks;
}

/**
 * The town round the player; in a scene, the scene's place with its world (where everyone is now)
 * and its effects. With `pick`, what's drawn where, for the mouse; `hover` lights up a tile.
 */
export function townView(game: GameState, session: SessionState | undefined, size: Viewport, options: ViewOptions = {}): StyledLine[] {
  const ex = exploreState(game);
  const world = ex.scene && session?.world && session.world.scene === ex.scene ? session.world : undefined;
  const place = world ? regionForScene(world.scene) : undefined;
  const effects = place && world && options.effects ? { region: place.region, frame: options.effects.frame(options.t ?? 0, id => positionOf(world, id)) } : undefined;
  // Whoever's behind a building shows through it, a little greyer (the user's call): see map/xray.ts.
  return xrayExplore(ex, size, { ...(world ? { world } : {}), ...(effects ? { effects } : {}), ...pick(options) });
}

export const townText = (game: GameState, session: SessionState | undefined, size: Viewport) => toPlain(townView(game, session, size, { color: false }));

export interface StageOptions {
  /** The animation clock in milliseconds. */
  t: number;
  time: StoryState["time"];
  glyphs?: GlyphSet;
  /** The scene's effects: fireballs, splashes, barks, damage numbers. */
  effects?: Effects;
  /** Where people are drawn mid-walk (the director's tweens), in the world's feet. */
  positions?: (id: string) => Point | undefined;
  /** Filled in with what's drawn where, for the mouse: pick.at(x, y) is who or what is in a cell, and the floor there. */
  pick?: StagePicks;
  /** What the pointer is on, lit up: someone or something by world id, or a cell of floor. */
  hover?: string | { x: number; y: number };
}

/**
 * A scene's place from above, Caves of Qud style: its world on the look layer's stage, dressed
 * with what the place is built of (src/game/look/dressings.ts), its people walking where the
 * director has them, its effects, barks and damage numbers. A Canvas, for a live view to paint.
 * With `pick`, what's drawn where, for the mouse; `hover` lights up what the pointer is on.
 */
export function stageView(session: SessionState | undefined, size: Viewport, options: StageOptions): Canvas | undefined {
  const world = session?.world;
  if (!world) return undefined;
  return renderStage(world, dressingFor(world.scene), {
    w: size.w, h: size.h, t: options.t, time: options.time, glyphs: options.glyphs ?? glyphSet(),
    ...(options.effects ? { effects: options.effects } : {}), ...(options.positions ? { positions: options.positions } : {}),
    ...(options.pick ? { pick: options.pick } : {}), ...(options.hover !== undefined ? { hover: options.hover } : {}),
  });
}

export interface FightViewOptions extends ViewOptions {
  /** Where the camera looks (default: whoever's turn it is, or the player). */
  centre?: Tile2;
  /** Tinted tiles: where the player can move, a spell's area. */
  marks?: RenderOptions["marks"];
  /** The selected tile (a target), bracketed. */
  cursor?: Tile2;
  /** The time of day (the light). */
  time?: StoryState["time"];
}

/**
 * A fight on its battlefield, drawn by the map's renderer: the fighters and the lights from the
 * fight, its grain dust hanging in the air and its fire burning, what the scene's world has spilled,
 * and the rest of the scene's place as its world has it (the people not in the fight stand back,
 * the furniture stays put). The roof is off: you need to see.
 */
export function fightView(fight: CombatController, session: SessionState | undefined, size: Viewport, options: FightViewOptions = {}): StyledLine[] {
  const view = fight.view();
  const G = fight.state();
  const fighters = new Set(Object.values(G.units).flatMap(u => [u.id, u.castId ?? u.id]));
  const field = session?.world ? battlefield(session.sceneId, session.world) : undefined;
  // The place round the fight: everything the world has but the fighters and the lights the fight now owns.
  const scenery: MapActor[] = (field?.actors ?? []).filter(a => a.map === G.map.id && a.kind !== "player" && !fighters.has(a.ref ?? a.id) && !G.props[a.ref ?? a.id] && !G.props[a.id]);
  const active = view.turn ? G.units[view.turn.id]?.at : undefined;
  const centre = options.centre ?? active ?? G.units[G.pc]?.at ?? { x: Math.floor(G.map.width / 2), y: Math.floor(G.map.height / 2) };
  // The badly hurt are bloodied; the lanterns and braziers are the world's own (the look knows them by it).
  const looks = fightLooks(G.units);
  const actors = [...scenery, ...view.actors.map(a => ({
    ...a, map: G.map.id, ...(a.kind !== "object" ? looks[a.id] ?? fightLook({ castId: a.ref, glyph: a.glyph, color: a.color ?? "" }) : session?.world?.entities[a.id] ? { ref: a.id } : {}),
    ...(a.states?.includes("badly hurt") ? { states: [...a.states, "bloodied"] } : {}),
  }))];
  // The scene's world lines up with the fight's map: its surfaces lie on the floor, and effects land where the fighters stand.
  const region = session?.world ? G.map.regions.find(r => r.sceneId === session.world!.scene && r.worldOrigin) : undefined;
  const world = region && session?.world ? { region, world: session.world } : undefined;
  const effects = region && options.effects ? { region, frame: options.effects.frame(options.t ?? 0, id => { const u = G.units[id] ?? G.props[id]; return u ? tileToFeet(region, u.at) : undefined; }) } : undefined;
  // Where the dust went up, the floor is scorched.
  const hazards = { dust: view.hazards.dust, fire: view.hazards.fire, ...(G.flags["dust_exploded"] && field ? { scorched: field.dust } : {}) };
  return render(G.map, actors, centre, size, {
    roofs: false, time: options.time ?? "night", focus: centre, reveal: view.units.map(u => u.at), hazards,
    ...(world ? { worlds: [world] } : {}), ...(effects ? { effects } : {}),
    ...(options.marks?.length ? { marks: options.marks } : {}), ...(options.cursor ? { cursor: options.cursor } : {}), ...pick(options),
  });
}

/**
 * A fight's log as it happens, shown on its map (for fightView's effects): a bolt from whoever cast
 * to whoever they aimed at (a ball of fire for fire in an area), sparks where a blow lands, damage
 * numbers over the hurt, and the grain dust going up over where it hung (`dust`: the tiles it hung
 * over before these lines). Lines it doesn't know pass. Returns how many it showed.
 */
export function fightEffects(fx: Effects, fight: CombatController, lines: Array<{ text: string }>, t: number, dust: Tile2[] = []): number {
  const G = fight.state();
  const region = G.map.regions.find(r => r.worldOrigin);
  if (!region) return 0;
  const bare = (s: string) => s.trim().toLowerCase().replace(/^the /, "");
  const unit = (name: string) => { const n = bare(name); return n === "you" ? G.units[G.pc] : Object.values(G.units).find(u => bare(u.called) === n || bare(u.name) === n); };
  const feet = (u: { at: Tile2 } | undefined) => (u ? tileToFeet(region, u.at) : undefined);
  const middle = (ps: Point[]) => ({ x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length });
  let shown = 0;
  lines.forEach(({ text }, i) => {
    const cast = /^(?:You cast|(.+?) casts) (.+?) \([^)]*\)(?:: a (\d+)-foot \w+(?:, catching (.+))?| at (.+))?$/.exec(text);
    if (cast) {
      const [, who, spell = "", size, caught, aim] = cast;
      const from = feet(who ? unit(who) : G.units[G.pc]);
      const element = lines.slice(i + 1).map(l => /^Damage: .* (\w+)$/.exec(l.text)?.[1]?.toLowerCase()).find(Boolean) ?? spellElement(spell);
      const hit = (caught && caught !== "nobody" ? caught.split(", ") : aim ? [aim] : []).map(n => feet(unit(n))).filter((p): p is Point => !!p);
      const to = hit.length ? middle(hit) : undefined;
      const color = ELEMENTS[element ?? ""] ?? "#c79bf2";
      if (!from) return;
      if (size && element === "fire") fx.effect("fireball", { from, at: to ?? from, radius: Number(size) }, t);
      else if (size) fx.effect("shockwave", { at: to ?? from, radius: Number(size), color }, t);
      else if (to && element === "lightning") fx.effect("lightning", { from, to }, t);
      else if (to) fx.effect("bolt", { from, to, color }, t);
      else fx.effect("sparks", { at: from, color }, t);
      shown++;
      return;
    }
    const hit = /attack on (.+?)(?: \(opportunity attack\))?: .* vs AC \d+: (critical hit!|hit)$/.exec(text);
    const hurt = /^(.+?) takes? (\d+) (\w+)(?: and \d+ \w+)* damage/.exec(text);
    const at = feet(hit ? unit(hit[1]!) : hurt ? unit(hurt[1]!) : undefined);
    if (hit && at) { fx.effect("sparks", { at, ...(hit[2]!.startsWith("critical") ? { amount: 2 } : {}) }, t); shown++; }
    else if (hurt && at) { fx.float(at, hurt[2]!, { damage: hurt[3]!.toLowerCase() }, t + 150); shown++; }
    else if (/^Grain dust explosion/.test(text) && dust.length) { fx.effect("explosion", { at: middle(dust.map(d => tileToFeet(region, d))), radius: 30 }, t); shown++; }
  });
  return shown;
}

/**
 * How someone in a fight looks: as they do in the town and in their scene (Kell's blue K, Hep's G,
 * Sallow's $, the Crakes' C), from the one cast table; and as the fight has them otherwise (the
 * lantern-boy, the porters).
 */
export function fightLook(u: { castId?: string | undefined; glyph: string; color: string }): { glyph: string; color: string } {
  const look = u.castId ? castOf(u.castId) : undefined;
  return look ? { glyph: look.glyph, color: look.color } : { glyph: u.glyph, color: u.color };
}

/**
 * How everyone in a fight looks, by unit id (fightLook), with no letter twice on the map: someone
 * the cast table doesn't know keeps the fight's letter unless a cast member has it (a porter's S is
 * Saul's, and Saul's standing by), and then takes the first letter of their name, or failing that
 * of the alphabet, that nobody has (in the fight's case: allies small, the other side capitals).
 */
export function fightLooks(units: Record<string, { name: string; castId?: string | undefined; glyph: string; color: string }>): Record<string, { glyph: string; color: string }> {
  const out: Record<string, { glyph: string; color: string }> = {};
  const taken = new Set(Object.values(CAST_LOOKS).map(c => c.glyph));
  for (const [id, u] of Object.entries(units)) if (u.castId || u.glyph === "@" || !taken.has(u.glyph)) out[id] = fightLook(u);
  for (const look of Object.values(out)) taken.add(look.glyph);
  for (const [id, u] of Object.entries(units)) {
    if (out[id]) continue;
    const small = u.glyph !== u.glyph.toUpperCase();
    const letters = [...u.name.replace(/^(the|a|an) /i, "").replace(/[^A-Za-z]/g, ""), ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(l => (small ? l.toLowerCase() : l.toUpperCase()));
    const glyph = letters.find(l => !taken.has(l)) ?? u.glyph;
    taken.add(glyph);
    out[id] = { glyph, color: u.color };
  }
  return out;
}

function pick(options: ViewOptions): Pick<RenderOptions, "t" | "tick" | "color" | "glyphs" | "hover" | "pick"> {
  return {
    ...(options.t !== undefined ? { t: options.t } : {}), ...(options.tick !== undefined ? { tick: options.tick } : {}),
    ...(options.color !== undefined ? { color: options.color } : {}), ...(options.glyphs ? { glyphs: options.glyphs } : {}),
    ...(options.hover ? { hover: options.hover } : {}), ...(options.pick ? { pick: options.pick } : {}),
  };
}
