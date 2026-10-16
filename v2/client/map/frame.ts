// Copied from the prototype's src/game/map/explore.ts:645-754 at 44c6d4a (its drawing: renderExplore, exploreFrame, exploreCamera and their helpers; the walking half is v2/shared/map/explore.ts) and src/game/map/setup.ts:190-215 (areaHazards), whole; the map code's imports from v2/shared, and areaHazards' dust the battlefield's dust lines (setup.ts:91-103, 122-123) on the place's own map, since the battlefield is the fights' (V12).
import { areaAt, type SceneWorld } from "../../shared/world/scene-world.ts";
import { actorsHere, roamRegion, type ExploreState } from "../../shared/map/explore.ts";
import { getMap } from "../../shared/map/maps.ts";
import { regionForScene } from "../../shared/map/places.ts";
import { leadMarker } from "../../shared/map/presence.ts";
import { feetToTile, overlayRegionStates, overlaySurfaces, tileToFeet, townSurfaces } from "../../shared/map/reconcile.ts";
import { inBounds, isStructure, tileAt } from "../../shared/map/tiles.ts";
import type { MapActor, Region, Tile2, TileMap } from "../../shared/map/types.ts";
import type { StyledLine } from "../ui/types.ts";
import { render, screenOf, type RenderOptions, type Viewport } from "./render.ts";

// ---------------------------------------------------------------------------------------------
// Drawing.

/**
 * The map round the player, ready for the app: lead marker, time of day, what scenes left behind
 * (their things, and what they spilled), and in a scene its world (its people and things, its
 * puddles and smoke, its areas on fire or thick with dust).
 */
export function renderExplore(state: ExploreState, viewport: Viewport, options: RenderOptions & { world?: SceneWorld } = {}): StyledLine[] {
  const f = exploreFrame(state, viewport, options);
  return render(f.map, f.actors, f.camera, viewport, f.options);
}

/**
 * What renderExplore hands render(): the map, everyone on it, the camera and the options. X-ray
 * (xray.ts) draws the same frame its own way, so the two can't drift apart: a scene's puddles and
 * fires reach the town view whichever draws it.
 */
export function exploreFrame(state: ExploreState, viewport: Viewport, options: RenderOptions & { world?: SceneWorld } = {}): { map: TileMap; actors: MapActor[]; camera: Tile2; options: RenderOptions } {
  const map = getMap(state.map);
  const { world, ...rest } = options;
  const actors = actorsHere(state, world);
  const lead = leadMarker(state.story, state.map);
  const camera = exploreCamera(state, viewport, world, actors);
  const place = state.scene ? regionForScene(state.scene) : undefined;
  const live = place && world && place.map.id === state.map ? { region: place.region, world } : undefined;
  // A world live on the map outside the scene (a zoo's wing): its puddles, smoke and fires too.
  const roaming = state.roam?.[map.id];
  const roamed = roaming && roamRegion(map, roaming) ? { region: roamRegion(map, roaming)!, world: roaming } : undefined;
  // What the rules spilled and scorched on the town's own ground (src/game/town-world.ts) lies there too.
  const worlds = [...overlaySurfaces(state.overlay, map, state.story.time), ...townSurfaces(state.overlay, map, state.story.time), ...(roamed ? [roamed] : []), ...(live ? [live] : [])];
  const hazards = mergeHazards([live, roamed].filter((w): w is NonNullable<typeof w> => !!w).map(w => areaHazards(w.region, w.world, map)));
  // In a scene, every room with someone in it opens up, not just the player's.
  const reveal = state.scene ? actors.filter(a => a.kind === "person" || a.kind === "creature").map(a => a.at) : [];
  return {
    map, actors, camera,
    options: {
      focus: state.at,
      ...(reveal.length ? { reveal } : {}),
      time: state.story.time,
      ...(lead && !state.scene ? { lead: lead.at, leadLabel: lead.label } : {}),
      regionStates: overlayRegionStates(state.overlay, map, state.story.time),
      tick: state.steps,
      ...(state.scene ? { roofs: false } : {}),
      ...(worlds.length ? { worlds } : {}),
      ...(hazards && (hazards.fire.length || hazards.dust.length || hazards.scorched.length) ? { hazards } : {}),
      ...rest,
    },
  };
}

/**
 * Where renderExplore's camera looks (with render's screenOf and tileAtScreen, where things are on
 * screen). Exploring, it follows the player. In a scene it frames the place when it fits, or else
 * the people in it, keeping the player in view.
 */
export function exploreCamera(state: ExploreState, viewport: Viewport, world?: SceneWorld, actors = actorsHere(state, world)): Tile2 {
  const place = state.scene ? regionForScene(state.scene) : undefined;
  // A map with a world of its own about (a zoo's wing) is framed, not followed: see framed.
  if (!place || place.map.id !== state.map) return state.roam?.[state.map] ? framed(getMap(state.map), state.at, viewport) : { ...state.at };
  const r = place.region.rect;
  const fits = (w: number, h: number) => 2 * (w + h) + 6 <= viewport.w && w + h + 6 <= viewport.h;
  if (fits(r.w, r.h)) return { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
  const people = actors.filter(a => a.kind === "person" || a.kind === "creature" || a.kind === "player");
  return people.length ? keepInView({ x: Math.round(mean(people.map(a => a.at.x))), y: Math.round(mean(people.map(a => a.at.y))) }, state.at, viewport) : { ...state.at };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The hazards of the worlds on a map (a scene's, a wing's), as one; undefined when there are none. */
function mergeHazards(all: Array<{ fire: Tile2[]; dust: Tile2[]; scorched: Tile2[] }>): { fire: Tile2[]; dust: Tile2[]; scorched: Tile2[] } | undefined {
  if (!all.length) return undefined;
  if (all.length === 1) return all[0];
  return { fire: all.flatMap(h => h.fire), dust: all.flatMap(h => h.dust), scorched: all.flatMap(h => h.scorched) };
}

/**
 * The camera on a small map, all of whose corners matter (a zoo's wing, its exhibits round its
 * walls): the whole of it when it fits, centred; otherwise following the player, but never leaving
 * a half-screen of nothing past the map's edge (you come in at a corner, and what's to see is the
 * other way). The player stays comfortably on screen.
 */
function framed(map: TileMap, at: Tile2, viewport: Viewport): Tile2 {
  const corners = [{ x: 0, y: 0 }, { x: map.width - 1, y: 0 }, { x: 0, y: map.height - 1 }, { x: map.width - 1, y: map.height - 1 }].map(t => ({ col: 2 * (t.x + t.y), row: t.y - t.x }));
  const me = { col: 2 * (at.x + at.y), row: at.y - at.x };
  const cx = Math.floor(viewport.w / 2), cy = Math.floor(viewport.h * 0.56);
  // Where the window starts on the projected plane, along one axis: on the player, then held inside
  // the map's extent (with room for walls standing up at the far edge), or centred on it if it fits.
  const axis = (want: number, size: number, lo: number, hi: number) => {
    const start = want, span = hi - lo;
    if (span <= size) return lo - Math.floor((size - span) / 2);
    return Math.max(lo, Math.min(hi - size, start));
  };
  const col = axis(me.col - cx, viewport.w, Math.min(...corners.map(c => c.col)) - 2, Math.max(...corners.map(c => c.col)) + 3) + cx;
  const row = axis(me.row - cy, viewport.h, Math.min(...corners.map(c => c.row)) - 5, Math.max(...corners.map(c => c.row)) + 2) + cy;
  // Back to a tile (the camera's): the nearest whose projection is that point.
  const camera = { x: Math.round((col / 2 - row) / 2), y: Math.round((col / 2 + row) / 2) };
  return keepInView(camera, at, viewport);
}

/** Move a camera towards someone until they're comfortably on screen. */
function keepInView(camera: Tile2, who: Tile2, viewport: Viewport): Tile2 {
  let c = { ...camera };
  for (let i = 0; i < 40; i++) {
    const s = screenOf(who, c, viewport);
    if (s.x >= 6 && s.x < viewport.w - 6 && s.y >= 3 && s.y < viewport.h - 3) break;
    c = { x: c.x + Math.sign(who.x - c.x), y: c.y + Math.sign(who.y - c.y) };
  }
  return c;
}

/**
 * A world's areas on its map, for drawing the scene's place: the tiles of areas on fire or scorched
 * (where the dust went up), each tile by the area its middle is in, and the dust where a fight here
 * would find it (the battlefield's own dust: so #map shows the dust the fight will use). Only open
 * ground: walls and water are the map's.
 */
export function areaHazards(region: Region, world: SceneWorld, map: TileMap): { fire: Tile2[]; dust: Tile2[]; scorched: Tile2[] } {
  const out = { fire: [] as Tile2[], dust: [] as Tile2[], scorched: [] as Tile2[] };
  const marked = Object.values(world.entities).some(e => (e.kind === "area" || e.kind === "place") && e.states.some(s => s === "burning" || s === "dusty" || s === "exploded" || s === "scorched" || s === "burnt"));
  const place = world.entities[world.root]?.rect;
  if (!marked || !place) return out;
  let dusty = false;
  const a = feetToTile(region, { x: place.x, y: place.y }), b = feetToTile(region, { x: place.x + place.w - 0.01, y: place.y + place.h - 0.01 });
  for (let y = a.y; y <= b.y; y++) for (let x = a.x; x <= b.x; x++) {
    const p = { x, y };
    const t = tileAt(map, p);
    if (!inBounds(map, p) || t.blocks || isStructure(t) || t.terrain === "void" || t.terrain === "water" || t.terrain === "deep-water") continue;
    const states = areaAt(world, tileToFeet(region, p)).states;
    if (states.includes("burning")) out.fire.push(p);
    if (states.includes("dusty") && !states.includes("exploded")) dusty = true;
    if (states.includes("exploded") || states.includes("scorched") || states.includes("burnt")) out.scorched.push(p);
  }
  if (dusty) out.dust = dustOf(region, world, map);
  return out;
}

/**
 * The battlefield's dust (setup.ts:91-103): tiles of the place whose area (the smallest one round
 * the tile's middle) is dusty, except by the doors, where the draught keeps the air clear.
 */
function dustOf(region: Region, world: SceneWorld, map: TileMap): Tile2[] {
  const dust: Tile2[] = [];
  const r = region.rect;
  const doors: Tile2[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (tileAt(map, { x, y }).terrain === "door") doors.push({ x, y });
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const p = { x, y };
    const t = tileAt(map, p);
    if (!inBounds(map, p) || t.blocks || isStructure(t) || t.terrain === "void" || t.terrain === "water" || t.terrain === "deep-water") continue;
    if (doors.some(d => Math.max(Math.abs(d.x - x), Math.abs(d.y - y)) <= DRAUGHT)) continue;
    if (areaAt(world, tileToFeet(region, p)).states.includes("dusty")) dust.push(p);
  }
  return dust;
}

/** How far, in steps, a door's draught keeps the dust off the floor. */
const DRAUGHT = 2;
