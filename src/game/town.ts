import { sceneById } from "../../scenes/index.ts";
import { talkable } from "../../scenes/talk.ts";
import type { SessionState } from "../runtime/session.ts";
import {
  actorsAt, actorsHere, direction, enterScene, exitLabel, getMap, inRect, interact, isDoorway, isLive, leadMarker, leaveScene, look, lookAt, move, newExploration, pathTo, PLACES, regionAt, regionForScene, regionOpen,
  setStory, steps, tileAt, tileName, isStructure, travel, walkPlan, whereabouts, type ExploreState, type PlaceRegion,
} from "./map/index.ts";
import { catalogue } from "../rules/actions.ts";
import { aimView, checkAim, doMenuAct, isMenuAct, menuOf, menuText, storyRoute, type AimAt, type AimView, type Ctx, type Done as MenuDone, type MenuView, type Rested, type Spotted } from "./menu.ts";
import type { Action, Explorer, GameState } from "./play.ts";
import { townWorld } from "./town-world.ts";
import type { Interaction, MapActor, Tile2, TileMap } from "./types.ts";
import { townText } from "./views.ts";

/**
 * Caerwyn on the map, as the game core (src/game/play.ts) explores it: the map module's
 * exploration (src/game/map) behind the Explorer interface, for the terminal app and the headless
 * QA console alike. The map module's ExploreState lives in the game's explore state (plain JSON), with
 * the last few things that happened; the game's story is the truth about the time of day and the
 * lead, and the map follows it.
 *
 * Action ids are readable and stable between an observation and the act that follows it:
 *   walk_north … walk_northwest            one step (north is up-left on the map, east up-right)
 *   go_to_lead                              walk towards where the story is heading (into it, if it opens by stepping in)
 *   go_to_<someone or somewhere>            walk over to a person, a thing, a way out or a place in sight
 *   talk_<id>, examine_<id>                 talk to someone, look at something (walking over first if need be);
 *                                           someone walking with you (Kell, after the granary) stops for a talk
 *                                           (src/runtime/talk.ts)
 *   enter_<place>                           step into the lead's place (the granary yard, the Heron)
 *   travel_<way>                            go through a door or along a path to another map
 *   open_door_<direction>                   try a door beside you
 *   interact                                whatever's in front of you (the app's e key)
 *   look                                    what's around you
 *
 * And by the tile, for a click on the map (actionsAt says which a tile offers; things in sight go
 * by the ids above):
 *   walk@<x>,<y>                            walk there (through it, if it's a door; as near as you can get, if you can't)
 *   look@<x>,<y>                            look at what's there, from where you stand
 *   talk@<x>,<y>, enter@<x>,<y>             talk to whoever's there, step into the place there (walking over first)
 *   travel@<x>,<y>, door@<x>,<y>            go through the way out or the door there (walking up to it first)
 *
 * And the action menu's (src/game/menu.ts: spells, class features, a leap, hiding, a rest):
 *   cast_<spell>[_self|@<x>,<y>], feature_<id>[_self|@<x>,<y>], attack@<x>,<y>, throw@<x>,<y>,
 *   shove@<x>,<y>, grapple@<x>,<y>, jump@<x>,<y>, hide, rest_short, rest_short_recover, rest_long, use_<item>
 */

export interface TownState {
  ex: ExploreState;
  /** The last few things that happened on the map, newest last. */
  log: string[];
  /** When the player last rested, by the story's clock (once each a time of day). */
  rested?: Rested;
  /** Where they were seen trying to hide (not again from there before the clock moves on). */
  spotted?: Spotted;
}

/** How far a QA observation lists what's in sight, in steps. */
const SIGHT = 10;

const COMPASS: Record<string, [number, number]> = {
  north: [0, -1], northeast: [1, -1], east: [1, 0], southeast: [1, 1], south: [0, 1], southwest: [-1, 1], west: [-1, 0], northwest: [-1, -1],
};
/** Where each compass step goes on screen (the map's north is up-left). */
const ON_SCREEN: Record<string, string> = {
  north: "up-left", northeast: "up", east: "up-right", southeast: "right", south: "down-right", southwest: "down", west: "down-left", northwest: "left",
};

/** The action id for one step (dx, dy each -1, 0 or 1; north is -y): "walk_northeast". */
export function walkId(dx: number, dy: number): string {
  const name = Object.entries(COMPASS).find(([, [x, y]]) => x === Math.sign(dx) && y === Math.sign(dy))?.[0];
  return name ? `walk_${name}` : "look";
}

/** The town state in a game (made fresh for a game that hasn't one, or one saved by the text stand-in). */
export function townOf(game: GameState): TownState {
  const t = (game.explore ?? {}) as unknown as Partial<TownState>;
  if (!t.ex || typeof t.ex.map !== "string") {
    const fresh: TownState = { ex: newExploration(structuredClone(game.story)), log: [] };
    game.explore = fresh as unknown as Record<string, unknown>;
    return fresh;
  }
  t.log ??= [];
  return t as TownState;
}

/** The explore state, with the map following the story (time of day, the lead, who walks with the player). */
export function exploreState(game: GameState): ExploreState {
  const town = townOf(game);
  if (JSON.stringify(town.ex.story) !== JSON.stringify(game.story)) setStory(town.ex, structuredClone(game.story));
  return town.ex;
}

const note = (game: GameState, text: string) => {
  if (!text) return;
  const town = townOf(game);
  town.log = [...town.log, text].slice(-5);
};

// ---------------------------------------------------------------------------------------------
// What's in sight, and what to call it.

export interface Target {
  /** The action id: "talk_kell", "go_to_market_square", "travel_up_the_river_stairs". */
  id: string;
  label: string;
  kind: Action["kind"];
  at: Tile2;
  distance: number;
  direction: string;
  actor?: MapActor;
  interaction?: Interaction;
  /** Walk onto it (a way out, a place) rather than up beside it (a person, a thing). */
  onto?: boolean;
  /** A place to walk into: any tile of it will do. */
  area?: { x: number; y: number; w: number; h: number };
}

const slug = (s: string) => s.toLowerCase().replace(/'s\b/g, "s").replace(/^(a|an|the)\s+/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
/** How far, in words: "here", "just north", "3 steps north-east". */
export const where = (d: number, dir: string) => (d === 0 ? "here" : d === 1 ? `just ${dir}` : `${d} steps ${dir}`);
const isPerson = (a: MapActor) => a.kind === "person" || a.kind === "creature";
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Somewhere a person can stand on this map: open ground, or a doorway that isn't locked. */
function standable(map: TileMap, p: Tile2): boolean {
  const t = tileAt(map, p);
  return !t.blocks && (!isStructure(t) || t.terrain === "door") && t.terrain !== "void" && t.terrain !== "deep-water";
}

/**
 * Everyone, everything, every way out and every place within sight that the player can do
 * something with, nearest first, each with its action id (unique: "palace_guard", "palace_guard_2").
 */
export function targets(game: GameState, session?: SessionState): Target[] {
  const ex = exploreState(game);
  const map = getMap(ex.map);
  const world = ex.scene ? session?.world : undefined;
  const out: Target[] = [];
  const used = new Map<string, number>();
  const unique = (base: string) => { const n = (used.get(base) ?? 0) + 1; used.set(base, n); return n === 1 ? base : `${base}_${n}`; };
  const from = ex.at;
  // A scene's place before it's played is the scene's to show: its people open it, its things wait for it.
  const unplayed = (a: MapActor) => { const scene = a.id.split(":")[0]!; return !!PLACES[scene] && !ex.story.played.includes(scene); };
  const actors = actorsHere(ex, world).filter(a => a.kind !== "player" && a.interaction && !(a.states ?? []).some(s => s === "overhead" || s === "hidden") && steps(a.at, from) <= SIGHT)
    .filter(a => a.interaction!.kind !== "examine" || !unplayed(a) || isPerson(a))
    .sort((a, b) => steps(a.at, from) - steps(b.at, from) || a.id.localeCompare(b.id));
  // A stack spread over three tiles, or a crowd of four, is one thing to look at: the nearest of it.
  const seen = new Set<string>();
  for (const a of actors) {
    if (a.ref) { if (seen.has(a.ref)) continue; seen.add(a.ref); }
    const i = a.interaction!;
    const verb = i.kind === "scene" ? i.verb : i.kind === "travel" ? "travel" : /^talk/i.test(i.label) ? "talk" : "examine";
    const name = slug(a.ref && !a.ref.includes(":") && isPerson(a) ? a.ref : a.name) || "someone";
    const d = steps(a.at, from);
    out.push({ id: unique(`${verb}_${name}`), label: i.label, kind: verb === "talk" ? "talk" : verb === "examine" ? "examine" : verb === "travel" ? "travel" : "enter", at: a.at, distance: d, direction: direction(from, a.at), actor: a, interaction: i });
  }
  // Ways out to other maps (a door, the stairs, along the wharf): one per way, its nearest tile.
  const exits = new Map<string, TileMap["exits"][number]>();
  for (const e of [...map.exits].sort((a, b) => steps(a.at, from) - steps(b.at, from))) if (steps(e.at, from) <= SIGHT && !exits.has(e.label)) exits.set(e.label, e);
  for (const e of exits.values()) {
    const d = steps(e.at, from);
    out.push({ id: unique(`travel_${slug(e.label)}`), label: exitLabel(e), kind: "travel", at: e.at, distance: d, direction: direction(from, e.at), interaction: { kind: "travel", to: e.to, label: e.label }, onto: true });
  }
  // The lead's place, when it's walked into (the granary yard, the Heron at the wharf's end).
  for (const r of map.regions as PlaceRegion[]) {
    if (r.trigger !== "enter" || !r.sceneId || !isLive(ex.story, r.sceneId)) continue;
    const at = nearestIn(r.rect, from, map);
    if (!at || steps(at, from) > SIGHT) continue;
    const name = PLACES[r.sceneId]?.lead.label ?? r.name;
    out.push({ id: unique(`enter_${slug(name)}`), label: r.label ?? `Go into ${r.name}`, kind: "enter", at, distance: steps(at, from), direction: direction(from, at), interaction: { kind: "scene", sceneId: r.sceneId, verb: "enter", label: r.label ?? r.name }, onto: true, area: r.rect });
  }
  // Places in sight (the market square, the river stairs): somewhere to walk to, if there's a way.
  const here = regionAt(map, from);
  for (const r of map.regions as PlaceRegion[]) {
    if (r.id === here?.id || r.trigger === "enter" || (r.rect.w === 1 && r.rect.h === 1) || !regionOpen(ex.story, r)) continue;
    if (r.lockedAfter && r.sceneId && ex.story.played.includes(r.sceneId)) continue;
    const at = nearestIn(r.rect, from, map);
    if (!at || steps(at, from) > SIGHT || !pathTo(ex, at, world)) continue;
    out.push({ id: unique(`go_to_${slug(r.name)}`), label: `Walk to ${r.name}`, kind: "move", at, distance: steps(at, from), direction: direction(from, at), onto: true, area: r.rect });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/** The standable tile of a rectangle nearest a tile (by steps). */
function nearestIn(rect: { x: number; y: number; w: number; h: number }, from: Tile2, map: TileMap): Tile2 | undefined {
  let best: Tile2 | undefined;
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const p = { x, y };
    if (!standable(map, p)) continue;
    if (!best || steps(p, from) < steps(best, from)) best = p;
  }
  return best;
}

/** Where g walks to: a tile, what it's called, whether to walk onto it, the way out first (`via`), the place it's in. */
export interface LeadTarget { at: Tile2; label: string; onto: boolean; via?: string; area?: { x: number; y: number; w: number; h: number } }

/** Where the lead is from here: its marker on this map, or the way out towards it (`via`). */
export function leadTarget(game: GameState): LeadTarget | undefined {
  const ex = exploreState(game);
  const lead = game.story.lead;
  if (!lead || game.story.played.includes(lead) || ex.scene) return undefined;
  const map = getMap(ex.map);
  const marker = leadMarker(ex.story, ex.map);
  const place = regionForScene(lead);
  // Its place opens by stepping in (on this map): walk into it.
  const region = (map.regions as PlaceRegion[]).find(r => r.sceneId === lead && r.trigger === "enter");
  if (region) {
    const at = nearestIn(region.rect, ex.at, map);
    if (at) return { at, label: PLACES[lead]?.lead.label ?? region.name, onto: true, area: region.rect };
  }
  if (marker) return { at: marker.at, label: marker.label, onto: map.exits.some(e => e.at.x === marker.at.x && e.at.y === marker.at.y) };
  // Elsewhere: the way out whose far side is nearest it.
  const goal = PLACES[lead]?.lead ?? (place ? { map: place.map.id, at: { x: place.region.rect.x, y: place.region.rect.y } } : undefined);
  if (!goal) return undefined;
  const ways = map.exits.filter(e => e.to.map === goal.map).sort((a, b) => steps(a.to.at, goal.at) + steps(a.at, ex.at) - steps(b.to.at, goal.at) - steps(b.at, ex.at));
  const way = ways[0] ?? map.exits.filter(e => e.to.map === "caerwyn")[0];
  const label = PLACES[lead]?.lead.label ?? sceneById(lead).title;
  return way ? { at: way.at, label, onto: true, via: way.label } : undefined;
}

/** "the Drowned Rat, 14 steps south-west" or "the palace: back along the wharves first (6 steps west)". */
function leadWords(lead: NonNullable<ReturnType<typeof leadTarget>>, from: Tile2): string {
  const how = where(steps(lead.at, from), direction(from, lead.at));
  return lead.via ? `${lead.label}: ${lead.via.charAt(0).toLowerCase()}${lead.via.slice(1)} first (${how})` : `${lead.label}, ${how}`;
}

// ---------------------------------------------------------------------------------------------
// Doing things.

/** What an act came to: what's said, and whether a scene, a talk or a fight opens (src/game/menu.ts). */
type Done = MenuDone;

/** What a walk came to: how far, what was said on the way, and how it stopped. */
interface Walk { walked: number; said: string[]; scene: boolean; travelled: boolean; blocked?: string }

/**
 * Walk a path a step at a time, as the player would with the keys, stopping when the lead scene
 * opens, the player goes through to another map, or something's in the way.
 */
function walkPath(game: GameState, path: Array<[number, number]>): Walk {
  const ex = exploreState(game);
  const walk: Walk = { walked: 0, said: [], scene: false, travelled: false };
  for (const [dx, dy] of path) {
    const r = move(ex, dx, dy);
    if (r.moved) walk.walked++;
    if (r.trigger && sceneOpens(game, r.trigger)) { walk.scene = true; return walk; }
    if (r.travelled) { walk.travelled = true; if (r.message) walk.said.push(r.message); return walk; }
    if (!r.moved) { walk.blocked = r.message ?? "Something's in the way."; return walk; }
    // Coming into somewhere new on the way is worth a word; the last one is enough.
    if (r.message && /^You come into/.test(r.message)) walk.said = [...walk.said.filter(s => !/^You come into/.test(s)), r.message];
  }
  return walk;
}

/** "You walk 12 steps south-west." plus what happened on the way. */
function told(walk: Walk, towards: string): string[] {
  return [...(walk.walked ? [`You walk ${walk.walked} step${walk.walked === 1 ? "" : "s"} ${towards}.`] : []), ...walk.said, ...(walk.blocked ? [walk.blocked] : [])];
}

/** A scene trigger opens the lead scene; anything else is just something that happened. */
function sceneOpens(game: GameState, i: Interaction | undefined): boolean {
  return !!i && i.kind === "scene" && (i.sceneId === game.story.lead || (!game.story.lead && !game.story.played.length));
}

/** Use an interaction (talk, look, go through): what the player sees, and whether the lead scene opens. */
function use(game: GameState, i: Interaction, actor?: MapActor): Done {
  const ex = exploreState(game);
  // Someone walking with the player, with a lore entry to be themselves from: a word with them (a talk).
  if (actor && ex.followers.some(f => f.id === actor.id) && talkable(actor.id)) {
    const w = whereabouts(ex);
    return { text: `You go over to ${actor.name}.`, talk: { with: actor.id, where: `${w.place === w.map ? w.map : `${w.place} in ${w.map}`}, ${w.time.replace("-", " ")}` } };
  }
  if (i.kind === "examine") {
    // Passing the time of day near where the story's heading: the line points the way in.
    const lead = leadTarget(game);
    const near = lead && steps(lead.at, ex.at) <= 4 && steps(lead.at, ex.at) > 0;
    return { text: near ? `${i.text} ${capital(leadWords(lead, ex.at))}: that's where the story's heading.` : i.text };
  }
  if (i.kind === "travel") {
    const r = travel(ex, i.to, i.label);
    return { text: r.message ?? "", ...(sceneOpens(game, r.trigger) ? { scene: true } : {}) };
  }
  // "Talk to Sergeant Kell" is what the player chose; what happens is "You go over to Sergeant Kell."
  if (sceneOpens(game, i)) return { text: i.verb === "talk" && actor ? `You go over to ${actor.name}.` : `You ${i.label.charAt(0).toLowerCase()}${i.label.slice(1)}.`, scene: true };
  return { text: `${actor ? capital(actor.name) : "That"} will keep. The story is heading elsewhere for now.` };
}

/** Walk up to a target (beside it, or onto it), then use it if asked. */
function goTo(game: GameState, t: Target, andUse: boolean): Done {
  const ex = exploreState(game);
  const said: string[] = [];
  const there = t.onto ? 0 : 1;
  if (t.distance > there) {
    const path = pathTo(ex, t.at);
    if (!path) return { text: `You can't see a way to ${t.actor?.name ?? t.label.replace(/^Walk to /, "")} from here.` };
    const walk = walkPath(game, path);
    said.push(...told(walk, t.direction));
    if (walk.scene) return { text: said.join(" "), scene: true };
    // Through a door to another map: the target was the door.
    if (walk.travelled || walk.blocked) return { text: said.join(" ") };
  }
  if (!andUse || !t.interaction) return { text: said.join(" ") || "You're already there." };
  const done = use(game, t.interaction, t.actor);
  return { text: [...said, done.text].filter(Boolean).join(" "), ...(done.scene ? { scene: true } : {}), ...(done.talk ? { talk: done.talk } : {}) };
}

// ---------------------------------------------------------------------------------------------
// A click on the map: what's at a tile, and what can be done with it.

export interface TileActions {
  at: Tile2;
  /** What's there, for a menu's title: "Sergeant Kell", "a cabbage cart", "the watch house". */
  title: string;
  /** What can be done with it, the likeliest first, walking there last. */
  actions: Action[];
}

/**
 * What a click on a tile can do (the app's right-click menu): talk to whoever's there, look at
 * what's there, go through a door or a way out, step into the lead's place, or walk there. What's in
 * sight goes by the explorer's own ids (talk_kell, travel_up_the_river_stairs: what the QA console
 * sees); the rest goes by the tile (look@29,21, walk@30,22).
 */
export function actionsAt(game: GameState, session: SessionState | undefined, at: Tile2): TileActions {
  const ex = exploreState(game);
  const map = getMap(ex.map);
  const world = ex.scene ? session?.world : undefined;
  const title = tileName(ex, at, world);
  if (at.x === ex.at.x && at.y === ex.at.y) return { at, title, actions: [{ id: "look", label: "Look around", kind: "examine" }] };
  const tile = `${at.x},${at.y}`;
  const sighted = targets(game, session);
  const out: Action[] = [];
  const add = (a: Action) => { if (!out.some(o => o.id === a.id || o.label === a.label)) out.push(a); };
  const who = actorsAt(ex, at, world);
  for (const a of who) {
    const i = a.interaction;
    if (!i) continue;
    const t = sighted.find(t => t.actor && (t.actor.id === a.id || (!!a.ref && t.actor.ref === a.ref)));
    if (i.kind === "scene") add({ id: t?.id ?? `${i.verb === "talk" ? "talk" : "enter"}@${tile}`, label: i.label, kind: i.verb === "talk" ? "talk" : "enter" });
    else if (i.kind === "travel") add({ id: t?.id ?? `travel@${tile}`, label: i.label, kind: "travel" });
    else if (isPerson(a) && /^talk/i.test(i.label)) add({ id: t?.id ?? `talk@${tile}`, label: i.label, kind: "talk" });
    // Looking is done from where you stand.
    else add({ id: `look@${tile}`, label: i.label, kind: "examine" });
  }
  const exit = map.exits.find(e => e.at.x === at.x && e.at.y === at.y);
  const t = tileAt(map, at);
  if (exit) {
    const label = exitLabel(exit);
    add({ id: sighted.find(s => s.kind === "travel" && !s.actor && s.label === label)?.id ?? `travel@${tile}`, label, kind: "travel" });
  } else if (t.terrain === "door") {
    // A door broken down is a doorway (the rules' work on the town's world).
    const broken = actorsHere(ex).some(a => a.at.x === at.x && a.at.y === at.y && (a.states ?? []).some(s => s === "destroyed" || s === "broken"));
    add({ id: `door@${tile}`, label: broken ? "Step into the broken doorway" : t.blocks ? "Try the door" : "Go through the door", kind: "use" });
  }
  // The lead's place, when it's walked into (the granary yard).
  const place = (map.regions as PlaceRegion[]).find(r => r.trigger === "enter" && r.sceneId && isLive(ex.story, r.sceneId) && inRect(r.rect, at) && !inRect(r.rect, ex.at));
  if (place) add({ id: sighted.find(s => s.kind === "enter" && s.area && inRect(s.area, at))?.id ?? `enter@${tile}`, label: place.label ?? `Go into ${place.name}`, kind: "enter" });
  // Doors and ways out say what they are when you try them; anything else can be looked at, and walked to.
  if (!exit && t.terrain !== "door") {
    if (!who.some(a => a.interaction)) add({ id: `look@${tile}`, label: `Look at ${title}`, kind: "examine" });
    add({ id: `walk@${tile}`, label: who.some(a => a.blocks) || !standable(map, at) ? "Walk over" : "Walk here", kind: "move" });
  }
  return { at, title, actions: out };
}

/** A tile-addressed action (walk@30,22): walk, look, talk, step in, go through. */
function atTile(game: GameState, session: SessionState, verb: string, at: Tile2): Done {
  const ex = exploreState(game);
  const map = getMap(ex.map);
  const world = ex.scene ? session.world : undefined;
  if (verb === "look") return { text: lookAt(ex, at, world) };
  if (verb === "walk" || verb === "door") return walkTo(game, at);
  const d = steps(at, ex.at), dir = direction(ex.at, at);
  const exit = map.exits.find(e => e.at.x === at.x && e.at.y === at.y);
  if (verb === "travel" && exit) return goTo(game, { id: `travel@${at.x},${at.y}`, label: exit.label, kind: "travel", at, distance: d, direction: dir, interaction: { kind: "travel", to: exit.to, label: exit.label }, onto: true }, true);
  if (verb === "enter") {
    const r = (map.regions as PlaceRegion[]).find(r => r.trigger === "enter" && r.sceneId && isLive(ex.story, r.sceneId) && inRect(r.rect, at));
    if (r) return goTo(game, { id: `enter@${at.x},${at.y}`, label: r.label ?? r.name, kind: "enter", at, distance: d, direction: dir, interaction: { kind: "scene", sceneId: r.sceneId!, verb: "enter", label: r.label ?? r.name }, onto: true, area: r.rect }, true);
  }
  const a = actorsAt(ex, at, world).find(a => a.interaction && (a.interaction.kind !== "examine" || isPerson(a)));
  if (verb === "talk" && a?.interaction) return goTo(game, { id: `talk@${at.x},${at.y}`, label: a.interaction.label, kind: "talk", at: a.at, distance: d, direction: dir, actor: a, interaction: a.interaction }, true);
  throw new Error(`Unavailable action: ${verb}@${at.x},${at.y}. Observe again for what's there.`);
}

/**
 * Walk to a tile (a click on the map): round what's in the way, through it if it's a door, or as
 * near as you can get; up to a door or a way out that doesn't open as you come, you try it.
 */
function walkTo(game: GameState, at: Tile2): Done {
  const ex = exploreState(game);
  const map = getMap(ex.map);
  const name = tileName(ex, at);
  const plan = walkPlan(ex, at);
  if (!plan) return { text: `You can't see a way any nearer ${name} from here.` };
  const walk = walkPath(game, plan.path);
  const said = told(walk, direction(ex.at, at));
  if (walk.scene) return { text: said.join(" "), scene: true };
  if (!plan.reaches && !walk.travelled && !walk.blocked && ex.map === map.id && steps(ex.at, at) === 1 && isDoorway(map, at)) {
    const r = move(ex, at.x - ex.at.x, at.y - ex.at.y);
    if (r.message) said.push(r.message);
    if (sceneOpens(game, r.trigger)) return { text: said.join(" "), scene: true };
  }
  return { text: said.join(" ") || (plan.reaches ? "You're already there." : `You're as near ${name} as you can get.`) };
}

/** What interact (the app's e) would do now, in words: "Talk to Sergeant Kell", "Go through the gate". */
export function interactLabel(game: GameState, session?: SessionState): { label: string; scene: boolean } | undefined {
  const ex = exploreState(game);
  const it = interact(ex, ex.scene ? session?.world : undefined);
  if (!it) return undefined;
  if (!it.actor && it.interaction.kind === "examine" && tileAt(getMap(ex.map), it.at).terrain === "door") {
    const r = move(structuredClone(ex), ex.facing.x, ex.facing.y);
    return { label: r.moved || r.trigger ? "Go through" : "Try the door", scene: !!r.trigger };
  }
  return { label: it.interaction.label, scene: it.interaction.kind === "scene" };
}

// ---------------------------------------------------------------------------------------------
// The action menu (the app's m): src/game/menu.ts, over the town's world.

const menuCtx = (game: GameState, session: SessionState): Ctx => ({ game, session, ex: exploreState(game), keep: townOf(game) });

/** What the player can do here, by kind (spells, features, actions, what they carry), and what's in reach; `at`: aimed at that tile already. */
export function actionMenu(game: GameState, session: SessionState, at?: Tile2): MenuView | undefined {
  return menuOf(menuCtx(game, session), at);
}

/** What one of the menu's entries can be aimed at from here: its reach, and who and what is in it. */
export function aimFor(game: GameState, session: SessionState, key: string): AimView | undefined {
  const ctx = menuCtx(game, session);
  const entry = entryOf(ctx, key);
  return entry ? aimView(ctx, townWorld(ctx.ex), entry) : undefined;
}

/** Aiming one of the menu's entries at a tile: whether it can be (and why not, there), what it would catch, and the action id to do it with. */
export function aimAt(game: GameState, session: SessionState, key: string, at: Tile2): AimAt | undefined {
  const ctx = menuCtx(game, session);
  const entry = entryOf(ctx, key);
  return entry ? checkAim(ctx, townWorld(ctx.ex), entry, at) : undefined;
}

/** A menu entry as the rules have it (what it needs and why it can't be done at all), before what's in reach is counted. */
const entryOf = (ctx: Ctx, key: string) => catalogue(ctx.session, { rested: ctx.keep.rested && ctx.keep.rested.time === ctx.ex.story.time ? ctx.keep.rested : {} })?.entries.find(e => e.key === key);

function walkTowardsLead(game: GameState): Done {
  const ex = exploreState(game);
  const lead = leadTarget(game);
  if (!lead) return { text: game.story.lead ? "Nowhere to walk to: the story comes to you from here." : "The story isn't heading anywhere just now." };
  const path = pathTo(ex, lead.at);
  if (!path) return { text: `You can't see a way to ${lead.label} from here.` };
  const walk = walkPath(game, path);
  const text = told(walk, `towards ${lead.label}`).join(" ") || `You're at ${lead.label}.`;
  return { text, ...(walk.scene ? { scene: true } : {}) };
}

/**
 * Does an act show a hidden player? Moving does (there's no creeping on the map: the street is open),
 * as do going through a door, a word with anyone, and a scene or a talk opening. Looking about, and
 * a step that went nowhere, don't.
 */
function showsYou(game: GameState, id: string, was: { map: string; at: Tile2 }, done: Done): boolean {
  const ex = exploreState(game);
  if (id === "look" || /^look@/.test(id)) return false;
  if (ex.map !== was.map || ex.at.x !== was.at.x || ex.at.y !== was.at.y || done.scene || done.talk) return true;
  if (/^(talk|enter|travel|door|open_door)/.test(id)) return true;
  // Interacting with whoever you face is talking to them.
  return id === "interact" && actorsHere(ex).some(a => a.at.x === ex.at.x + ex.facing.x && a.at.y === ex.at.y + ex.facing.y && isPerson(a));
}

// An object that satisfies Explorer rather than one typed as it, so that another explorer built on
// this one (the zoo's, src/game/zoo) can call its methods as written.
export const town = {
  start(game) {
    game.explore = { ex: newExploration(structuredClone(game.story)), log: [] } satisfies TownState as unknown as Record<string, unknown>;
  },

  observe(game, session) {
    const ex = exploreState(game);
    const w = whereabouts(ex);
    // Further off than look() goes: who's about (everything else is in the actions).
    const near = targets(game, session).filter(t => t.distance > 3 && t.actor && isPerson(t.actor));
    const lead = leadTarget(game);
    const town = townOf(game);
    return [
      `${w.map}: ${w.place}, ${w.time.replace("-", " ")}. You are the @; on this map north is up-left and east is up-right.`,
      townText(game, session, { w: 80, h: 24 }),
      look(ex),
      ...(near.length ? [`Further off: ${near.slice(0, 10).map(t => `${t.actor!.name} (${where(t.distance, t.direction)})`).join(", ")}.`] : []),
      ...(lead ? [`The story is heading for ${sceneById(game.story.lead!).title}: ${leadWords(lead, ex.at)}.`] : []),
      ...(town.log.length ? [`Recently: ${town.log.slice(-3).join(" ")}`] : []),
      ...(ex.scene ? [] : [menuText(menuCtx(game, session))].filter(Boolean)),
    ].join("\n\n");
  },

  actions(game, session) {
    const ex = exploreState(game);
    const all = targets(game, session);
    const out: Action[] = [];
    const lead = leadTarget(game);
    if (lead) out.push({ id: "go_to_lead", label: `Walk to where the story is heading: ${leadWords(lead, ex.at)}`, kind: "move" });
    for (const t of all) {
      if (/^go_to_/.test(t.id)) { out.push({ id: t.id, label: `${t.label} (${where(t.distance, t.direction)})`, kind: t.kind }); continue; }
      const reach = t.distance <= (t.onto ? 0 : 1) || (t.distance <= 1 && t.kind !== "move");
      out.push({ id: t.id, label: reach ? t.label : `${t.label} (${where(t.distance, t.direction)}: you walk over first)`, kind: t.kind });
      // Someone further off can be walked over to without a word yet.
      if (!reach && t.actor && isPerson(t.actor)) out.push({ id: `go_to_${t.id.replace(/^[a-z]+_/, "")}`, label: `Walk over to ${t.actor.name} (${where(t.distance, t.direction)})`, kind: "move" });
    }
    // Doors beside you that go nowhere in particular (a house, a shed): you can try them.
    const map = getMap(ex.map);
    for (const [name, [dx, dy]] of Object.entries(COMPASS)) {
      const p = { x: ex.at.x + dx, y: ex.at.y + dy };
      if (tileAt(map, p).terrain === "door" && !map.exits.some(e => e.at.x === p.x && e.at.y === p.y)) out.push({ id: `open_door_${name}`, label: `Try the door to the ${name}`, kind: "use" });
    }
    for (const [name, [dx, dy]] of Object.entries(COMPASS)) {
      const probe = structuredClone(ex);
      const r = move(probe, dx, dy);
      if (r.moved || r.trigger || r.travelled) out.push({ id: `walk_${name}`, label: `Step ${name} (${ON_SCREEN[name]} on the map)${r.trigger ? `: ${r.trigger.label}` : r.travelled ? `: ${r.travelled.label}` : ""}`, kind: "move" });
    }
    out.push({ id: "look", label: "Look around", kind: "examine" });
    // The action menu's: what needs no aiming, and the nearest of what's in reach for what does (observe lists the rest).
    if (!ex.scene) {
      const ctx = menuCtx(game, session);
      const menu = menuOf(ctx);
      const tw = menu ? townWorld(ctx.ex) : undefined;
      for (const e of menu?.sections.flatMap(s => s.entries) ?? []) {
        if (e.why || !e.act) continue;
        const kind: Action["kind"] = e.key === "jump" ? "move" : e.effect === "harm" ? "fight" : e.key.startsWith("rest") ? "wait" : "use";
        if (e.id) { out.push({ id: e.id, label: `${e.name}: ${e.summary}`, kind }); continue; }
        const view = aimView(ctx, tw!, e);
        // The nearest; for an area, the nearest it doesn't catch you in.
        const near = e.aim.kind === "area" ? view.targets.find(t => !(checkAim(ctx, tw!, e, t.at).caught ?? []).includes("you")) : view.targets[0];
        if (view.selfReady) out.push({ id: `${e.act}_self`, label: `${e.name} on yourself (${e.summary})`, kind });
        if (near) out.push({ id: near.id, label: `${e.name} ${e.key === "jump" ? "to" : e.effect === "harm" ? "at" : "on"} ${near.name} (${e.summary})`, kind });
      }
    }
    return out;
  },

  act(game, session, id) {
    const ex = exploreState(game);
    const was = { map: ex.map, at: { ...ex.at }, facing: { ...ex.facing } };
    // The action menu's: at once when it opens someone's scene or a talk (the app shows it opening), else the rules' work.
    if (isMenuAct(id)) {
      const ctx = menuCtx(game, session);
      const routed = storyRoute(ctx, id);
      if (routed) { note(game, routed.text); return routed; }
      return doMenuAct(ctx, id).then(done => {
        const lines = done.text.split("\n").filter(Boolean);
        note(game, [...new Set([lines[0], lines.at(-1)])].filter(Boolean).join(" "));
        return done;
      });
    }
    let done: Done;
    const step = /^walk_(\w+)$/.exec(id);
    const byTile = /^(walk|look|talk|enter|travel|door)@(\d+),(\d+)$/.exec(id);
    if (byTile) done = atTile(game, session, byTile[1]!, { x: Number(byTile[2]), y: Number(byTile[3]) });
    else if (id === "look") done = { text: look(ex) };
    else if (step && COMPASS[step[1]!]) {
      const [dx, dy] = COMPASS[step[1]!]!;
      const r = move(ex, dx, dy);
      done = { text: r.message ?? (r.moved ? "" : "You stay where you are."), ...(sceneOpens(game, r.trigger) ? { scene: true } : {}) };
    } else if (id === "go_to_lead") done = walkTowardsLead(game);
    else if (id === "interact") {
      const it = interact(ex, ex.scene ? session.world : undefined);
      // A door in front of you that isn't shut (the yard gate): go through it, as walking into it would.
      const door = it && !it.actor && it.interaction.kind === "examine" && tileAt(getMap(ex.map), it.at).terrain === "door";
      if (door) {
        const r = move(ex, ex.facing.x, ex.facing.y);
        done = { text: r.message ?? (r.moved ? "You go through." : ""), ...(sceneOpens(game, r.trigger) ? { scene: true } : {}) };
      } else done = it ? use(game, it.interaction, it.actor) : { text: "There's nothing here to do anything with but the weather." };
    } else if (/^open_door_/.test(id)) {
      const [dx, dy] = COMPASS[id.slice("open_door_".length)] ?? [0, 0];
      if (!dx && !dy) throw new Error(`Unavailable action: ${id}`);
      const r = move(ex, dx, dy);
      done = { text: r.message ?? (r.moved ? "The door gives, and you go through." : ""), ...(sceneOpens(game, r.trigger) ? { scene: true } : {}) };
    } else {
      const all = targets(game, session);
      // go_to_<x> walks over to anything in sight (its talk_/examine_ id names it too); the verbs walk over and use it.
      const bare = id.replace(/^go_to_/, "");
      const t = all.find(x => x.id === id) ?? all.find(x => x.id.replace(/^(talk|examine|enter|open|travel)_/, "") === bare);
      if (!t) throw new Error(`Unavailable action: ${id}. Observe again for what's in sight.`);
      done = goTo(game, t, !/^go_to_/.test(id) || t.kind === "travel" || t.kind === "enter");
    }
    // Out of sight only until you show yourself: a step out into the open, a door, a word with anyone, a scene.
    if (ex.hidden && showsYou(game, id, was, done)) {
      delete ex.hidden;
      done = { ...done, text: [done.text, "(You're in plain sight again.)"].filter(Boolean).join("\n") };
    }
    note(game, done.text);
    return done;
  },

  /**
   * A fight that broke out on the map is over: the player stands where it left them, and whoever
   * went down or ran stays that way until the story's clock moves on (the rules keep their hurts).
   * How it went, and who lies where they fell.
   */
  afterFight(game, session, result) {
    const ex = exploreState(game);
    const map = getMap(ex.map);
    const at = result.positions?.["player"];
    if (at && standable(map, at)) ex.at = { ...at };
    const town = ((ex.overlay.town ??= {})[ex.map] ??= { things: {} });
    if (!town.people || town.people.time !== ex.story.time) town.people = { time: ex.story.time, states: {} };
    const fell: string[] = [];
    for (const c of result.casualties) {
      const states = c.state === "down" || c.state === "dead" ? ["down"] : c.state === "fled" ? ["gone"] : c.state === "surrendered" ? ["cowering"] : undefined;
      if (!states || !c.id.includes(":")) continue;
      town.people.states[c.id] = states;
      // Where the fight left them: whoever went down lies there, not back at their post.
      const at = result.positions?.[c.id];
      if (at && !states.includes("gone")) town.people.at = { ...town.people.at, [c.id]: { ...at } };
      if (states[0] === "down") fell.push(c.name);
    }
    void session;
    const said = fell.length ? `${capital(fell.join(" and "))} ${fell.length === 1 ? "lies" : "lie"} where they fell. Caerwyn steps round.` : undefined;
    if (said) note(game, said);
    return [`The fight: ${result.summary}`, said].filter(Boolean).join("\n\n");
  },

  enterScene(game, session) {
    const ex = exploreState(game);
    // Whoever the scene is with sees you come in.
    delete ex.hidden;
    enterScene(ex, session.sceneId);
  },

  leaveScene(game, session) {
    const ex = exploreState(game);
    leaveScene(ex, session.world);
  },

  afterScene(game, _session) {
    // The map follows the story on (the time of day, the lead, Kell at the player's side); what
    // happened before the scene is old news.
    exploreState(game);
    townOf(game).log = [];
  },
} satisfies Explorer;
