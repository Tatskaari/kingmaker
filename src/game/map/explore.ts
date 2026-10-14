import type { SceneWorld } from "../../world/scene-world.ts";
import type { Interaction, MapActor, StoryState, StyledLine, Tile2, TileMap } from "../types.ts";
import { CAST } from "./looks.ts";
import { getMap } from "./maps/index.ts";
import { PLACES, regionForScene, sceneStart } from "./places.ts";
import { isLive, leadMarker, presence, regionOpen, sceneTrigger } from "./presence.ts";
import { actorsFromWorld, captureScene, emptyOverlay, feetToTile, nearestTile, nearestWalk, overlayActors, overlayRegionStates, type MapOverlay } from "./reconcile.ts";
import { render, screenOf, type RenderOptions, type Viewport } from "./render.ts";
import { direction, inBounds, inRect, isStructure, regionAt, steps, tileAt, type PlaceRegion } from "./tiles.ts";

/**
 * Walking about: the player's place on the maps, moving with collision (walls, water, locked
 * doors, people), doors and paths to other maps, and the story's triggers (step into the granary
 * yard, talk to Kell, go down the Rat's door at dusk). Everything is a plain object, so the app can
 * save it with the session.
 */

export interface Follower { id: string; name: string; glyph: string; color: string; map: string; at: Tile2 }

export interface ExploreState {
  map: string;
  at: Tile2;
  /** The way the player last stepped: what's "in front" for interact(). */
  facing: Tile2;
  story: StoryState;
  overlay: MapOverlay;
  /** Who walks with the player (Kell, after the granary). */
  followers: Follower[];
  /** The scene being played: its world, when passed in, drives its place's actors. */
  scene?: string;
  steps: number;
}

export interface MoveResult {
  moved: boolean;
  map: string;
  at: Tile2;
  /** For the log: what happened, in the house style. */
  message?: string;
  /** Walked into someone or something in the way. */
  bumped?: MapActor;
  /** Went through a door or along a path to another map. */
  travelled?: { from: string; to: string; label: string };
  /** A scene opens here: the app starts it (openScene). */
  trigger?: Extract<Interaction, { kind: "scene" }>;
}

export interface Nearby {
  at: Tile2;
  /** Steps away (diagonals count as one). */
  distance: number;
  /** A compass word from the player ("north-east"; on screen, north is up-left and east up-right). */
  direction: string;
  label: string;
  actor?: MapActor;
  interaction?: Interaction;
}

/** Where a fresh story or a reloaded one puts the player: the lane by the granary gate, or outside the last place. */
export function newExploration(story: StoryState, options: { overlay?: MapOverlay; map?: string; at?: Tile2 } = {}): ExploreState {
  const last = story.played.at(-1);
  const after = last ? PLACES[last]?.after : undefined;
  const map = options.map ?? after?.map ?? "caerwyn";
  const at = options.at ?? after?.at ?? { x: 42, y: 9 };
  const state: ExploreState = { map, at: { ...at }, facing: { x: 0, y: 1 }, story, overlay: options.overlay ?? emptyOverlay(), followers: [], steps: 0 };
  syncFollowers(state);
  return state;
}

/** The story moved on (a scene ended, the time changed): who's about changes with it. */
export function setStory(state: ExploreState, story: StoryState): void {
  state.story = story;
  syncFollowers(state);
}

/** Kell walks with the investigator once the granary's done, unless the story has parted them (flags.kell === false). */
function syncFollowers(state: ExploreState): void {
  const withKell = state.story.played.length > 0 && state.story.flags.kell !== false && state.story.flags.kell !== "absent";
  const has = state.followers.some(f => f.id === "kell");
  if (withKell && !has) {
    const at = besideSpot(state, state.map, state.at);
    state.followers.push({ id: "kell", name: CAST.kell!.name, glyph: CAST.kell!.glyph, color: CAST.kell!.color, map: state.map, at });
  }
  if (!withKell && has) state.followers = state.followers.filter(f => f.id !== "kell");
}

/** A free spot beside a tile for someone walking with the player: standable, empty, not a way out. */
function besideSpot(state: ExploreState, mapId: string, at: Tile2): Tile2 {
  const map = getMap(mapId);
  const taken = new Set([...presence(state.story, mapId), ...overlayActors(state.overlay, mapId, state.story.time)].filter(a => a.blocks).map(a => `${a.at.x},${a.at.y}`));
  const ok = (p: Tile2) => (p.x !== at.x || p.y !== at.y) && walkable(map, p) && !taken.has(`${p.x},${p.y}`) && !map.exits.some(e => e.at.x === p.x && e.at.y === p.y);
  return nearestWalk(map, at, ok, 3) ?? nearestTile(map, at, ok, 3) ?? { ...at };
}

// ---------------------------------------------------------------------------------------------
// Who's here.

/**
 * Everyone and everything on the player's map: the town's people and decor by the story, places
 * as the story has them (waiting, or as their scenes left them), the live scene's world when one
 * is being played, the followers, and the player.
 */
export function actorsHere(state: ExploreState, world?: SceneWorld, mapId = state.map): MapActor[] {
  const map = getMap(mapId);
  let actors = [...presence(state.story, mapId), ...overlayActors(state.overlay, mapId, state.story.time)];
  const live = state.scene && world ? regionForScene(state.scene) : undefined;
  if (live && live.map.id === mapId && world) {
    // The scene's own world replaces the preview of its place, and has the player in it.
    actors = actors.filter(a => !a.id.startsWith(`${state.scene}:`));
    const fromWorld = actorsFromWorld(live.region, world, { map });
    const me = fromWorld.find(a => a.kind === "player");
    if (me) { state.at = { ...me.at }; state.map = mapId; }
    return [...actors, ...fromWorld.map(a => (a.kind === "player" ? a : { ...a, id: `${state.scene}:${a.id}` }))];
  }
  // In a scene with a world, Kell is in the world; in one without (the King's morning), she walks in with you.
  for (const f of state.followers) if (f.map === mapId) {
    actors.push({ id: f.id, name: f.name, kind: "person", glyph: f.glyph, color: f.color, map: mapId, at: f.at, ref: f.id, blocks: true,
      interaction: { kind: "examine", text: kellLine(state.story), label: `Talk to ${f.name}` } });
  }
  if (mapId === state.map) actors.push({ id: "player", name: "you", kind: "player", glyph: "@", color: "#ffffff", map: mapId, at: { ...state.at }, blocks: true });
  return actors;
}

/** Kell, between scenes, on where the case is going. */
function kellLine(story: StoryState): string {
  const lead = story.lead && !story.played.includes(story.lead) ? story.lead : undefined;
  if (lead === "drowned-rat") return "Kell taps her pencil on her notebook. 'Big man, bandaged hand, night work for a gentleman. The Drowned Rat, investigator: halfway down the river stairs. Noted.'";
  if (lead === "heron-warehouse") return "Kell, very quietly for Kell, which is not very quietly: 'The Heron. Downriver end of the wharves. The barge sails on the ebb.' She looks at the river. 'I'd rather we didn't.'";
  if (lead === "kings-morning") return "Kell straightens a uniform that hasn't been to bed. 'The King will see you before the procession. I've written it all down. All of it, investigator.'";
  return "Kell looks up from her notebook. 'Investigator.' She waits, pencil ready, as if whatever you say next will be written down. It will.";
}

// ---------------------------------------------------------------------------------------------
// Moving.

/** Somewhere a person can stand: open ground, or a doorway that isn't locked. */
function walkable(map: TileMap, p: Tile2): boolean {
  if (!inBounds(map, p)) return false;
  const t = tileAt(map, p);
  return !t.blocks && (!isStructure(t) || t.terrain === "door");
}

const BUMPS = [
  "You walk into the wall. The wall wins.",
  "The wall declines to move. It has seen off better than you.",
  "That's a wall. Caerwyn is full of them; it's how you can tell where the buildings are.",
];

/** A door's state from the actors on it (a scene opened it, or barred it): open, shut, or the tile's own. */
function doorState(actors: MapActor[], at: Tile2): "open" | "locked" | undefined {
  const door = actors.find(a => a.at.x === at.x && a.at.y === at.y && a.kind === "object" && (a.states ?? []).some(s => ["open", "closed", "locked", "barred", "bolted"].includes(s)));
  if (!door) return undefined;
  const s = door.states ?? [];
  if (s.includes("destroyed") || s.includes("open")) return "open";
  if (s.includes("locked") || s.includes("barred") || s.includes("bolted")) return "locked";
  return undefined;
}

/**
 * Take a step (dx, dy each -1, 0 or 1; north is -y; for arrow keys see SCREEN_KEYS). Walking into
 * someone whose scene is waiting (Kell, the palace page) opens it, as talking to them would.
 */
export function move(state: ExploreState, dx: number, dy: number, world?: SceneWorld): MoveResult {
  dx = Math.sign(dx); dy = Math.sign(dy);
  const map = getMap(state.map);
  const here = { ...state.at };
  const result = (r: Partial<MoveResult>): MoveResult => ({ moved: false, map: state.map, at: { ...state.at }, ...r });
  if (!dx && !dy) return result({});
  state.facing = { x: dx, y: dy };
  if (state.scene) return result({ message: "You're in the middle of something." });
  const to = { x: here.x + dx, y: here.y + dy };
  if (!inBounds(map, to)) return result({ message: "That's the edge of the map. The council keeps meaning to put a fence up." });
  const actors = actorsHere(state, world);
  const t = tileAt(map, to);
  const region = regionAt(map, to);
  // Doors and paths to other maps.
  const exit = map.exits.find(e => e.at.x === to.x && e.at.y === to.y);
  if (exit) {
    if (!regionOpen(state.story, gatingRegion(map, to))) return result({ message: gatingRegion(map, to)!.shut! });
    return travel(state, exit.to, exit.label);
  }
  // Squeezing diagonally between two walls isn't a thing people can do.
  if (dx && dy && !walkable(map, { x: here.x + dx, y: here.y }) && !walkable(map, { x: here.x, y: here.y + dy })) return result({ message: "Too tight a squeeze, even for an investigator." });
  const door = doorState(actors, to);
  if (t.terrain === "door") {
    if (!regionOpen(state.story, gatingRegion(map, to))) return result({ message: gatingRegion(map, to)!.shut! });
    if ((t.blocks && door !== "open") || door === "locked") return result({ message: lockedLine(map, to) });
  } else if (t.terrain === "deep-water") {
    return result({ message: "The river is high, fast and freezing. You decide to stay the investigator rather than become evidence." });
  } else if (t.blocks || isStructure(t) || t.terrain === "tree" || t.terrain === "void") {
    return result({ message: t.terrain === "tree" ? "A tree. It was here first." : BUMPS[state.steps % BUMPS.length]! });
  }
  if (!regionOpen(state.story, region)) return result({ message: region!.shut! });
  const locked = lockedFrom(state.story, map, here, to);
  if (locked) return result({ message: locked });
  const inTheWay = actors.find(a => a.at.x === to.x && a.at.y === to.y && a.kind !== "player" && a.blocks && !(a.states ?? []).includes("overhead") && !(a.states ?? []).includes("hanging"));
  const follower = inTheWay && state.followers.find(f => f.id === inTheWay.id);
  if (inTheWay && !follower) {
    if (inTheWay.interaction?.kind === "scene") return result({ bumped: inTheWay, trigger: inTheWay.interaction, message: inTheWay.interaction.label });
    return result({ bumped: inTheWay, message: `${capital(inTheWay.name)} ${inTheWay.kind === "person" ? "is in the way" : "is in the way, and doesn't care"}.` });
  }
  // Step, and whoever follows takes the place you left (or swaps with you, if they were in front).
  state.at = to;
  state.steps++;
  for (const f of state.followers) if (f.map === state.map) {
    if (f.at.x === to.x && f.at.y === to.y) f.at = here;
    else if (steps(f.at, to) > 1) f.at = here;
  }
  const before = regionAt(map, here);
  const r = result({ moved: true });
  const trigger = triggerAt(state, map, to, here);
  if (trigger) r.trigger = trigger;
  if (region && region.id !== before?.id) r.message = `You come into ${region.name}.`;
  return r;
}

/** Follow a travel interaction (or an exit): the player, and whoever walks with them, arrive on the other map. */
export function travel(state: ExploreState, to: { map: string; at: Tile2 }, label = "On you go"): MoveResult {
  const from = state.map;
  const map = getMap(to.map);
  state.map = to.map;
  state.at = { ...to.at };
  state.steps++;
  for (const f of state.followers) {
    f.map = to.map;
    f.at = besideSpot(state, to.map, to.at);
  }
  const r: MoveResult = { moved: true, map: state.map, at: { ...state.at }, travelled: { from, to: to.map, label }, message: `${label}: ${map.name}.` };
  const trigger = triggerAt(state, map, to.at, undefined);
  if (trigger) r.trigger = trigger;
  return r;
}

/** Stepping into a live scene's place opens it. */
function triggerAt(state: ExploreState, map: TileMap, to: Tile2, from: Tile2 | undefined): MoveResult["trigger"] {
  for (const r of map.regions as PlaceRegion[]) {
    if (r.trigger !== "enter" || !r.sceneId || !inRect(r.rect, to) || (from && inRect(r.rect, from))) continue;
    if (isLive(state.story, r.sceneId)) return sceneTrigger(r.sceneId, "enter", r.label ?? `Go into ${r.name}`);
  }
  return undefined;
}

/** A place locked up after its scene: no way in from outside it (you can always get out). */
function lockedFrom(story: StoryState, map: TileMap, from: Tile2, to: Tile2): string | undefined {
  for (const r of map.regions as PlaceRegion[]) {
    if (r.lockedAfter && r.sceneId && story.played.includes(r.sceneId) && inRect(r.rect, to) && !inRect(r.rect, from)) return r.lockedAfter;
  }
  return undefined;
}

/** The region whose time opens a door here (a one-tile door region, or the place behind it). */
function gatingRegion(map: TileMap, at: Tile2): PlaceRegion | undefined {
  return (map.regions as PlaceRegion[]).filter(r => r.shut && inRect(r.rect, at)).sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
}

const LOCKED: Record<string, string> = {
  "the-granary": "Padlocked. The warden has the key, and the warden is at the palace counting Assembly provisions.",
  "corn-exchange": "The Corn Exchange is shut for the Assembly. A notice on the door says so, at length, with footnotes.",
  "watch-house": "Locked. A note on the door: ALL OUT ON THE PROCESSION ROUTE. CRIMES AFTER THE ASSEMBLY, PLEASE.",
  "porters-lodgings": "Locked. Behind it someone is snoring, in shifts.",
  "heron-wharf-end": "Barred from the inside. Somebody in there doesn't want visitors, which is interesting in itself.",
  "plank-walk": "Bolted, with a grille in it and a smell of grain behind. The gang get in by holding something up to the grille.",
};

function lockedLine(map: TileMap, at: Tile2): string {
  const near = (map.regions as PlaceRegion[]).filter(r => inRect({ x: r.rect.x - 1, y: r.rect.y - 1, w: r.rect.w + 2, h: r.rect.h + 2 }, at) && LOCKED[r.id]);
  const region = regionAt(map, at);
  if (region && LOCKED[region.id]) return LOCKED[region.id]!;
  if (near[0]) return LOCKED[near[0].id]!;
  if (map.id === "drowned-rat") return "The slop hatch. It opens straight onto the river, it's Cob-sized, and the river under it is fast and cold.";
  if (map.id === "heron") return LOCKED["heron-wharf-end"]!;
  if (map.id === "caerwyn" && at.y >= 33 && at.y <= 36) return "A warehouse door, locked, with a notice: NO LOITERING. NO HOOKS. NO QUESTIONS.";
  return "Locked. Everyone's out hanging bunting.";
}

/**
 * The shortest walk from the player to a tile on this map, round walls, water, shut doors and people
 * (diagonal steps allowed, but no squeezing between two walls), as steps for move(). If the tile
 * itself can't be stood on (someone's there, it's a door that's shut), the walk ends beside it.
 */
export function pathTo(state: ExploreState, target: Tile2, world?: SceneWorld): Array<[number, number]> | undefined {
  const map = getMap(state.map);
  const actors = actorsHere(state, world);
  const occupied = new Set(actors.filter(a => a.blocks && a.kind !== "player" && !state.followers.some(f => f.id === a.id) && !(a.states ?? []).some(s => s === "overhead" || s === "hanging")).map(a => `${a.at.x},${a.at.y}`));
  const exits = new Set(map.exits.map(e => `${e.at.x},${e.at.y}`));
  const ok = (p: Tile2) => {
    const k = `${p.x},${p.y}`;
    if (!walkable(map, p) || occupied.has(k) || (exits.has(k) && !(p.x === target.x && p.y === target.y))) return false;
    const t = tileAt(map, p);
    if (t.terrain === "door" && (doorState(actors, p) === "locked" || (t.blocks && doorState(actors, p) !== "open"))) return false;
    return regionOpen(state.story, regionAt(map, p)) && regionOpen(state.story, gatingRegion(map, p));
  };
  const goal = (p: Tile2) => (p.x === target.x && p.y === target.y) || (!ok(target) && steps(p, target) === 1);
  const start = `${state.at.x},${state.at.y}`;
  const came = new Map<string, string | null>([[start, null]]);
  const queue: Tile2[] = [{ ...state.at }];
  let end: Tile2 | undefined;
  while (queue.length) {
    const p = queue.shift()!;
    if (goal(p)) { end = p; break; }
    for (const d of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const) {
      const n = { x: p.x + d[0], y: p.y + d[1] };
      const k = `${n.x},${n.y}`;
      if (came.has(k) || !inBounds(map, n) || !ok(n) || lockedFrom(state.story, map, p, n)) continue;
      if (d[0] && d[1] && !walkable(map, { x: p.x + d[0], y: p.y }) && !walkable(map, { x: p.x, y: p.y + d[1] })) continue;
      came.set(k, `${p.x},${p.y}`);
      queue.push(n);
    }
  }
  if (!end) return undefined;
  const path: Array<[number, number]> = [];
  for (let k: string | null = `${end.x},${end.y}`; k && came.get(k) !== null; k = came.get(k) ?? null) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    const [px, py] = came.get(k)!.split(",").map(Number) as [number, number];
    path.unshift([x - px, y - py]);
  }
  return path;
}

// ---------------------------------------------------------------------------------------------
// Looking and touching.

const GROUND: Record<string, string> = {
  cobbles: "on the cobbles", grass: "on the grass", dirt: "on beaten earth", boards: "on the boards", floor: "on the floor", stairs: "on the steps",
  water: "up to your ankles in the river", bridge: "on the planks", door: "in the doorway",
};

/** What the player sees: where they are, what's around them, and where the story's heading. */
export function look(state: ExploreState, world?: SceneWorld): string {
  const map = getMap(state.map);
  const region = regionAt(map, state.at);
  const t = tileAt(map, state.at);
  const lines: string[] = [];
  const where_ = region?.name ?? map.name;
  const on = /stairs|wharf|wharves|landing|plank walk|barge|Patience|wall\b/i.test(where_) ? "on" : "in";
  lines.push(`You're ${on} ${where_}, ${GROUND[t.terrain] ?? "standing about"}.${region?.description ? ` ${region.description}` : ""}`);
  const near = nearby(state, 3, world).filter(n => n.actor);
  const people = near.filter(n => n.actor!.kind === "person" || n.actor!.kind === "creature");
  const things = near.filter(n => n.actor!.kind === "object" || n.actor!.kind === "item").filter(n => !(n.actor!.states ?? []).includes("overhead"));
  if (people.length) lines.push(`About: ${people.map(n => `${n.actor!.name} (${where(n)})`).join(", ")}.`);
  if (things.length) lines.push(`Here: ${dedupe(things.map(n => `${n.actor!.name}${state_(n.actor!)} (${where(n)})`)).join(", ")}.`);
  // A way out that's several tiles wide (the stairs, the wharf) is one way: its nearest tile.
  const exits = [...map.exits].filter(e => steps(e.at, state.at) <= 3).sort((a, b) => steps(a.at, state.at) - steps(b.at, state.at)).filter((e, i, all) => all.findIndex(o => o.label === e.label) === i);
  if (exits.length) lines.push(`${exits.map(e => `${e.label} (${where({ distance: steps(e.at, state.at), direction: direction(state.at, e.at) })})`).join("; ")}.`);
  const lead = leadMarker(state.story, state.map);
  if (lead) {
    const d = steps(lead.at, state.at);
    lines.push(`The lead: ${lead.label}, ${d === 0 ? "right here" : d === 1 ? `just ${direction(state.at, lead.at)}` : `${direction(state.at, lead.at)}, ${d} steps`}.`);
  }
  const time = TIME_LINES[state.story.time];
  if (time && map.id === "caerwyn") lines.push(time);
  return lines.join("\n");
}

const TIME_LINES: Record<StoryState["time"], string> = {
  morning: "Morning on the eve of the Assembly: bunting going up on every rope that will hold it, and the smell of wet grain and river mud.",
  afternoon: "Afternoon: sweepers, delegations' servants, bread dearer than last week, and everybody too busy for a hanged clerk.",
  evening: "Dusk: the lamps are being lit, the bunting's gone grey, and the night shift is going down to the river.",
  night: "Night: the river high and black, fog coming off it, lanterns on the barges, and the town gone quiet behind you.",
  "next-morning": "The morning of the Assembly: bells, a band tuning up, crowds, banners, and bunting on everything that stood still.",
};

const where = (n: { distance: number; direction: string }) => (n.distance === 0 ? "here" : n.distance === 1 ? `just ${n.direction}` : `${n.distance} ${n.direction}`);
const state_ = (a: MapActor) => { const s = (a.states ?? []).filter(x => ["burning", "destroyed", "smouldering", "open", "locked", "barred", "hanging", "lit", "down", "unconscious"].includes(x)); return s.length ? `, ${s.join(", ")}` : ""; };
const dedupe = (xs: string[]) => [...new Set(xs)];
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** For a status line: the map, the place on it, and the time of day ("Caerwyn", "the granary lane", "morning"). */
export function whereabouts(state: ExploreState): { map: string; place: string; time: StoryState["time"] } {
  const map = getMap(state.map);
  return { map: map.name, place: regionAt(map, state.at)?.name ?? map.name, time: state.story.time };
}

/** People, things and ways out within a few steps, nearest first. */
export function nearby(state: ExploreState, radius = 2, world?: SceneWorld): Nearby[] {
  const map = getMap(state.map);
  const out: Nearby[] = [];
  const seen = new Set<string>();
  for (const a of actorsHere(state, world)) {
    if (a.kind === "player" || (a.states ?? []).includes("overhead")) continue;
    const d = steps(a.at, state.at);
    if (d > radius) continue;
    const id = a.id.split("#")[0]!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ at: a.at, distance: d, direction: direction(state.at, a.at), label: a.name, actor: a, ...(a.interaction ? { interaction: a.interaction } : {}) });
  }
  for (const e of map.exits) {
    const d = steps(e.at, state.at);
    if (d > radius || out.some(n => n.label === e.label)) continue;
    out.push({ at: e.at, distance: d, direction: direction(state.at, e.at), label: e.label, interaction: { kind: "travel", to: e.to, label: e.label } });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * What the player can do with what's in front of them (or, failing that, beside them): talk to
 * someone (a scene, if theirs is live), go through a door, or look at a thing.
 */
export function interact(state: ExploreState, world?: SceneWorld): { interaction: Interaction; actor?: MapActor; at: Tile2 } | undefined {
  const map = getMap(state.map);
  const actors = actorsHere(state, world).filter(a => a.kind !== "player" && !(a.states ?? []).includes("overhead"));
  const front = { x: state.at.x + state.facing.x, y: state.at.y + state.facing.y };
  const isFront = (a: MapActor) => a.at.x === front.x && a.at.y === front.y;
  const reach = actors.filter(a => a.interaction && steps(a.at, state.at) <= 1);
  const person = (a: MapActor) => a.kind === "person" || a.kind === "creature";
  const pick = (test: (a: MapActor) => boolean) => reach.filter(test).sort((a, b) => Number(isFront(b)) - Number(isFront(a)))[0];
  const found = (a: MapActor | undefined) => (a ? { interaction: a.interaction!, actor: a, at: a.at } : undefined);
  // Someone whose scene is waiting comes first, then whoever you're facing, then doors and places
  // ahead, then things ahead, then whoever's beside you, then things beside you.
  const scene = found(pick(a => a.interaction!.kind === "scene"));
  if (scene) return scene;
  const faced = found(pick(a => isFront(a) && person(a)));
  if (faced) return faced;
  const exitAhead = map.exits.find(e => e.at.x === front.x && e.at.y === front.y);
  if (exitAhead) return { interaction: { kind: "travel", to: exitAhead.to, label: exitAhead.label }, at: front };
  // A live scene's place right in front of you (the yard through its gate).
  const region = (map.regions as PlaceRegion[]).find(r => r.trigger === "enter" && r.sceneId && inRect(r.rect, front) && !inRect(r.rect, state.at) && isLive(state.story, r.sceneId));
  if (region) return { interaction: sceneTrigger(region.sceneId!, "enter", region.label ?? `Go into ${region.name}`), at: front };
  const ahead = found(pick(a => isFront(a)));
  if (ahead) return ahead;
  const beside = found(pick(person)) ?? found(pick(() => true));
  if (beside) return beside;
  const t = tileAt(map, front);
  if (t.terrain === "door") return { interaction: { kind: "examine", text: gatingRegion(map, front)?.shut ?? lockedLine(map, front), label: "Try the door" }, at: front };
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Scenes: in and out of the place a scene is played in.

/** A scene opens: the player stands where its world starts them (the app then shows the place). */
export function enterScene(state: ExploreState, sceneId: string): { map: string; at: Tile2 } | undefined {
  const start = sceneStart(sceneId);
  if (!start) return undefined;
  state.scene = sceneId;
  state.map = start.map;
  state.at = { ...start.at };
  // Whoever walks with you comes in too (drawn when the scene has no world of its own to put them in).
  for (const f of state.followers) { f.map = start.map; f.at = besideSpot(state, start.map, start.at); }
  return start;
}

/**
 * The scene is over: keep what it did to its place (pass its world before chainScene drops it),
 * and put the player back on their feet where the world left them, or outside the place.
 */
export function leaveScene(state: ExploreState, world?: SceneWorld): void {
  const sceneId = state.scene;
  delete state.scene;
  if (!sceneId) return;
  const found = regionForScene(sceneId);
  if (found && world) {
    captureScene(state.overlay, found.region, world, state.story.time);
    const me = world.entities.player;
    const feet = me?.at;
    if (feet) {
      const at = feetToTile(found.region, feet);
      const ok = nearestWalk(found.map, at, p => walkable(found.map, p), 3);
      if (ok) { state.map = found.map.id; state.at = ok; }
    }
  }
  const after = PLACES[sceneId]?.after;
  if (after && (!found || !world || state.map !== found.map.id || !inBounds(getMap(state.map), state.at))) { state.map = after.map; state.at = { ...after.at }; }
  // A scene can end somewhere you can't walk out of (up in a barred loft): then you're outside its door.
  if (after && !canWalkOut(state, after)) { state.map = after.map; state.at = { ...after.at }; }
  // Followers catch up.
  for (const f of state.followers) {
    f.map = state.map;
    f.at = besideSpot(state, state.map, state.at);
  }
}

/** From where the player stands, is there a walk to where they'd come out (or any way off this map)? */
function canWalkOut(state: ExploreState, after: { map: string; at: Tile2 }): boolean {
  if (state.map === after.map && state.at.x === after.at.x && state.at.y === after.at.y) return true;
  const goals = state.map === after.map ? [after.at] : getMap(state.map).exits.map(e => e.at);
  return goals.some(g => pathTo(state, g) !== undefined);
}

// ---------------------------------------------------------------------------------------------
// Drawing.

/** The map round the player, ready for the app: lead marker, time of day, what scenes left behind. */
export function renderExplore(state: ExploreState, viewport: Viewport, options: RenderOptions & { world?: SceneWorld } = {}): StyledLine[] {
  const map = getMap(state.map);
  const { world, ...rest } = options;
  const actors = actorsHere(state, world);
  const lead = leadMarker(state.story, state.map);
  // Exploring, the camera follows the player. In a scene it frames the place when it fits, or else
  // the people in it, keeping the player in view.
  let camera = state.at;
  const place = state.scene ? regionForScene(state.scene) : undefined;
  if (place && place.map.id === state.map) {
    const r = place.region.rect;
    const fits = (w: number, h: number) => 2 * (w + h) + 6 <= viewport.w && w + h + 6 <= viewport.h;
    if (fits(r.w, r.h)) camera = { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
    else {
      const people = actors.filter(a => a.kind === "person" || a.kind === "creature" || a.kind === "player");
      if (people.length) camera = keepInView({ x: Math.round(mean(people.map(a => a.at.x))), y: Math.round(mean(people.map(a => a.at.y))) }, state.at, viewport);
    }
  }
  // In a scene, every room with someone in it opens up, not just the player's.
  const reveal = state.scene ? actors.filter(a => a.kind === "person" || a.kind === "creature").map(a => a.at) : [];
  return render(map, actors, camera, viewport, {
    focus: state.at,
    ...(reveal.length ? { reveal } : {}),
    time: state.story.time,
    ...(lead && !state.scene ? { lead: lead.at, leadLabel: lead.label } : {}),
    regionStates: overlayRegionStates(state.overlay, map, state.story.time),
    tick: state.steps,
    ...(state.scene ? { roofs: false } : {}),
    ...rest,
  });
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

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
 * Arrow keys by the screen (recommended): up goes straight up the screen, which on the map is a
 * diagonal step (north-east), right is south-east, and so on. Doors and streets all take diagonal
 * steps, so this gets everywhere.
 */
export const SCREEN_KEYS: Record<string, [number, number]> = {
  up: [1, -1], w: [1, -1], down: [-1, 1], s: [-1, 1], left: [-1, -1], a: [-1, -1], right: [1, 1], d: [1, 1],
};

/** Keys by the compass, for an app that prefers them: WASD and arrows north/south/west/east, QEZC diagonally. */
export const KEYS: Record<string, [number, number]> = {
  up: [0, -1], w: [0, -1], k: [0, -1], down: [0, 1], s: [0, 1], j: [0, 1], left: [-1, 0], a: [-1, 0], h: [-1, 0], right: [1, 0], d: [1, 0], l: [1, 0],
  q: [-1, -1], home: [-1, -1], e: [1, -1], pageup: [1, -1], z: [-1, 1], end: [-1, 1], c: [1, 1], pagedown: [1, 1],
};
