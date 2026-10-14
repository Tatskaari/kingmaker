import type { MapActor, Tile2, TileMap } from "../../types.ts";
import { actorLook, type LookFrame } from "../../look/map.ts";
import { raiseFor } from "../looks.ts";
import { render, screenOf } from "../render.ts";
import { isStructure, tileAt } from "../tiles.ts";
import { fitView } from "./pictures.ts";

/**
 * The default camera on a map, and what it really shows. The renderer is the judge: a view is
 * drawn as render.ts draws a scene (roofs off, the rooms people are in opened up, plain text), then
 * drawn again without some of the actors, and an actor is shown if its cell changes when it's taken
 * away (src/game/map/xray.ts finds who's hidden the same way). Nothing here knows how the look layer
 * draws a thing: a brick oven, a sparrow or a crowd is seen if taking it away changes the picture.
 *
 * Actors are taken away in batches whose drawings can't touch (a thing draws on its cell, the cell
 * above it and the cells either side), so a view costs one render plus one per batch, not one per
 * actor.
 */

/** The look layer's frame for plain-text views (no motion: t is 0). */
const PLAIN: LookFrame = { t: 0, time: "afternoon", glyphs: "ascii" };

/**
 * How many rows up render.ts draws an actor above its tile's cell: the map's raise for its name and
 * states, or the look's lift (something hanging is 7 ft up, three rows), whichever is higher.
 */
export function liftOf(a: Pick<MapActor, "id" | "name" | "kind" | "states" | "ref">): number {
  return rowsOf(a)[0] ?? 0;
}

/** What render.ts heaps up (sacks, crates, grain): drawn with a second one on top. */
const STACKS = new Set(["sack", "crate", "grain"]);

/**
 * Every row above its tile's cell where render.ts paints an actor, its own cell first: the lifted
 * cell, the rope above something hanging, the top of a stack, the flame over a fire. Another actor
 * whose cell is one of these is painted over (a lantern's rope lands two squares behind it). Empty:
 * it isn't drawn at all (hidden things are faint to nothing).
 */
export function rowsOf(a: Pick<MapActor, "id" | "name" | "kind" | "states" | "ref" | "blocks">): number[] {
  const states = a.states ?? [];
  const raise = raiseFor(a.name, states);
  if (a.kind === "player") return [raise];
  const look = actorLook({ ...a, glyph: "?", map: "", at: { x: 0, y: 0 } } as MapActor, PLAIN);
  if (look.alpha < 0.35) return [];
  const lift = Math.max(raise, look.lift);
  if (states.includes("overhead")) return [lift];
  const rows = [lift];
  if (states.includes("hanging")) rows.push(lift + 1);
  const stacked = !look.look.wreck && (look.glyph === "■" || look.glyph === "▣" || (!!a.blocks && STACKS.has(look.look.role)));
  if (stacked) rows.push(lift + 1);
  if (look.above) rows.push(lift + (stacked ? 2 : 1));
  return [...new Set(rows)];
}

/** The cells an actor can be drawn on: its lifted cell, and higher when it stands on a wall top. */
export function cellsOf(map: TileMap, a: MapActor, camera: Tile2, viewport: { w: number; h: number }): Array<{ x: number; y: number }> {
  const s = screenOf(a.at, camera, viewport);
  const lift = liftOf(a);
  const t = tileAt(map, a.at);
  const standing = isStructure(t) && t.blocks ? Math.max(0, t.height ?? 0) : 0;
  return [{ x: s.x, y: s.y - lift }, ...(standing ? [{ x: s.x, y: s.y - lift - standing }] : [])];
}

export interface Camera {
  camera: Tile2;
  viewport: { w: number; h: number };
  /** The scene view focused on a square (its room opens too), as plain characters by row. */
  view(focus: Tile2): string[][];
  /** Is this actor drawn (not covered, not under a roof) in the view focused on a square? */
  seen(a: MapActor, focus: Tile2): boolean;
  /** The same for several at once (one render per batch). */
  check(focus: Tile2, actors: MapActor[]): Map<MapActor, boolean>;
  /** Renders made so far (for timing). */
  renders(): number;
}

export function sceneCamera(map: TileMap, actors: MapActor[]): Camera {
  const { camera, viewport } = fitView(map);
  // Whose rooms open is fixed by everyone there, whoever is taken away.
  const reveal = actors.filter(a => a.kind === "person" || a.kind === "creature").map(a => a.at);
  let count = 0;
  // Taken away by id: the actor asked about may be a copy of the one on the map.
  const draw = (focus: Tile2, without?: Set<string>): string[][] => {
    count++;
    const lines = render(map, without ? actors.filter(a => !without.has(a.id)) : actors, camera, viewport, { time: "afternoon", roofs: false, focus, ...(reveal.length ? { reveal } : {}), color: false });
    return lines.map(line => [...line.map(s => s.text).join("")]);
  };
  const frames = new Map<string, string[][]>();
  const known = new Map<string, Map<MapActor, boolean>>();
  const key = (p: Tile2) => `${p.x},${p.y}`;
  const view = (focus: Tile2) => {
    let f = frames.get(key(focus));
    if (!f) { f = draw(focus); frames.set(key(focus), f); }
    return f;
  };
  const check = (focus: Tile2, who: MapActor[]) => {
    let shown = known.get(key(focus));
    if (!shown) { shown = new Map(); known.set(key(focus), shown); }
    const todo = [...new Set(who)].filter(a => !shown!.has(a));
    if (!todo.length) return shown;
    const base = view(focus);
    // Batches whose drawings can't touch: each actor's cells, the three rows above them and the cells either side.
    const batches: Array<{ actors: MapActor[]; taken: Set<string> }> = [];
    for (const a of todo) {
      const foot = new Set<string>();
      for (const c of cellsOf(map, a, camera, viewport)) for (let dx = -1; dx <= 1; dx++) for (let dy = -3; dy <= 1; dy++) foot.add(`${c.x + dx},${c.y + dy}`);
      let batch = batches.find(b => ![...foot].some(f => b.taken.has(f)));
      if (!batch) { batch = { actors: [], taken: new Set() }; batches.push(batch); }
      batch.actors.push(a);
      for (const f of foot) batch.taken.add(f);
    }
    for (const b of batches) {
      const without = draw(focus, new Set(b.actors.map(a => a.id)));
      for (const a of b.actors) shown.set(a, cellsOf(map, a, camera, viewport).some(c => base[c.y]?.[c.x] !== without[c.y]?.[c.x]));
    }
    return shown;
  };
  return { camera, viewport, view, seen: (a, focus) => check(focus, [a]).get(a)!, check, renders: () => count };
}
