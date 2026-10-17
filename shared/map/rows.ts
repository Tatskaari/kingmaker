// New (K, exploreOf M's): where the copied map code meets the rows (v2/docs/map-design.md §3.4). Both sides build the prototype's ExploreState from the same rows with exploreOf, run the copied code on it, and write back what a move changed with exploreRowOf. The town unit's (v2/docs/town-design.md §3.1, §3.3): a map's own place's `town` into the overlay, the explore row's keep and fight carried by every move, and both to and from the table's columns (keepOf, keepColumns).
import type { TimeOfDay } from "../scene/files.ts";
import { keysFor, pcKey, rowsToWorld, type PlaceRows } from "../world/rows.ts";
import type { SceneWorld } from "../world/scene-world.ts";
import { setStory, type ExploreState, type Follower } from "./explore.ts";
import { getMap, useMaps } from "./maps.ts";
import { captureScene, emptyOverlay, type TownChanges } from "./reconcile.ts";
import type { MapFile } from "./tiles.ts";
import type { Keep } from "./menu.ts";
import type { Unheard } from "./town.ts";
import type { StoryState, Tile2, TownFight } from "./types.ts";

/** A player's `explore` row (schema.ts), its ids as strings: the prototype's ExploreState but the story, and what the last move said. */
export interface ExploreRow {
  playerId: string;
  gameId: string;
  /** The map they're on (its key: caerwyn). */
  map: string;
  at: Tile2;
  /** The way they last stepped: what's in front of them. */
  facing: Tile2;
  steps: number;
  hidden: boolean;
  /** The scene they're in, opened from here (its key), while it's played. */
  scene?: string;
  followers: Follower[];
  /** The house lines' memory (quips.ts QuipMemory). */
  quips: number;
  lastQuip?: string;
  styles: string[];
  /** Bumped by every move made on the map: a client shows `said` when it moves on. */
  acts: number;
  /** What the last move said, "" for nothing. */
  said: string;
  /** The last five things said, newest last (the prototype's town log: observe's "Recently"). */
  log: string[];
  /** The action menu's keep (town-design §3.1): when they rested, where they were seen trying to hide, whose pockets they've tried. A move that doesn't change it carries it. */
  rested?: Keep["rested"];
  spotted?: Keep["spotted"];
  lifted?: Keep["lifted"];
  /** A fight that broke out on the map, recorded for V12. */
  fight?: TownFight;
}

/** A place on a map, with its rows, as the map draws it: a map's own (the town), or a scene's (waiting for it, being played, or played). */
export interface MapPlace {
  /** Its key: map:caerwyn, granary-yard. */
  key: string;
  /** The map it's on, the region it fills there (a scene's place), and where its world's (0, 0) feet sits, in tiles. */
  mapKey: string;
  region?: string;
  origin: Tile2;
  /** The scene played there: its key, its status (waiting, opening, live, closing, ending, ended), and the time of day it's played at. */
  scene?: { key: string; status: string; time?: TimeOfDay };
  /** Its rows, but the GM's notes (gm_note), which no client sees: the map is drawn and walked alike on both sides. */
  rows: PlaceRows;
  /** A map's own place's: what the rules did to the town (the place row's `town`, JSON reconcile.ts TownChanges; "" for none), which exploreOf puts in ExploreState.overlay.town (town-design §3.3). */
  town?: string;
}

/** Everything the map is read from, on either side: what the simulation reads in one transaction, and what a client holds. */
export interface MapRows {
  /** The game's campaign's maps (map_def's json). */
  maps: MapFile[];
  /** The walker's row: the controller's (a spectator reads the host's). */
  explore: ExploreRow;
  /** Where the story is: the game's time of day, its lead (game.leadScene), and the scenes played (ended), oldest first. */
  story: { time: TimeOfDay; lead?: string; played: string[] };
  /** The game's places on maps. */
  places: MapPlace[];
  /** The cast the player hasn't heard named, with what they'd call them. */
  unheard: Unheard;
}

/**
 * The prototype's ExploreState from rows: the maps in use (useMaps), the explore row's fields, the
 * story, the waiting places' worlds (ExploreState.waiting), the overlay made from the played places'
 * worlds with the copied captureScene, and the followers synced as setStory syncs them.
 *
 * Every place's world is rebuilt as the walker's (their character is `player` in it) and without
 * the GM's notes, whatever the caller passed: the simulation and a client then build the same state
 * from the same rows, and offer the same action ids.
 */
export function exploreOf(rows: MapRows): ExploreState {
  useMaps(rows.maps);
  const e = rows.explore;
  const story: StoryState = { time: rows.story.time, played: [...rows.story.played], ...(rows.story.lead ? { lead: rows.story.lead } : {}), flags: {} };
  const pc = pcKey(e.playerId);
  const worldOf = (p: MapPlace, scene: string): SceneWorld => rowsToWorld({ ...p.rows, gmNote: [] }, keysFor(p.key, scene, pc));
  const waiting: Record<string, SceneWorld> = {};
  let overlay = emptyOverlay();
  for (const place of rows.places) {
    // A map's own place: what the rules did to the town, the prototype's overlay.town (town-world.ts keepTown's).
    if (place.town) overlay = { ...overlay, town: { ...overlay.town, [place.mapKey]: JSON.parse(place.town) as TownChanges } };
    if (!place.scene) continue;
    if (place.scene.status === "waiting") waiting[place.scene.key] = worldOf(place, place.scene.key);
    else if (place.scene.status === "ended" && place.region) {
      const region = getMap(place.mapKey).regions.find(r => r.id === place.region);
      if (region) overlay = captureScene(overlay, region, worldOf(place, place.scene.key), place.scene.time);
    }
  }
  const ex: ExploreState = {
    map: e.map, at: { ...e.at }, facing: { ...e.facing }, story, overlay,
    followers: e.followers.map(f => ({ ...f, at: { ...f.at } })), steps: e.steps,
    ...(e.scene ? { scene: e.scene } : {}), ...(e.hidden ? { hidden: true } : {}),
    quips: e.quips, ...(e.lastQuip !== undefined ? { lastQuip: e.lastQuip } : {}), styles: [...e.styles],
    ...(Object.keys(waiting).length ? { waiting } : {}),
  };
  // Who walks with the player follows the story (Kell, once the granary's done), as setStory has it.
  setStory(ex, story);
  return ex;
}

/** The most lines the explore row's log keeps (the prototype's town log: town.ts note). */
export const LOG_LINES = 5;

/** The explore row a move leaves: the state's fields, and, when it said something, `said` and the log. `acts` moves on with every move. */
export function exploreRowOf(ex: ExploreState, prev: ExploreRow, said: string): ExploreRow {
  return {
    playerId: prev.playerId, gameId: prev.gameId,
    map: ex.map, at: { ...ex.at }, facing: { ...ex.facing }, steps: ex.steps, hidden: !!ex.hidden,
    ...(ex.scene ? { scene: ex.scene } : {}),
    followers: ex.followers.map(f => ({ ...f, at: { ...f.at } })),
    quips: ex.quips ?? 0, ...(ex.lastQuip !== undefined ? { lastQuip: ex.lastQuip } : {}), styles: [...(ex.styles ?? [])],
    acts: prev.acts + 1,
    said,
    log: said ? [...prev.log, said].slice(-LOG_LINES) : [...prev.log],
    // The menu's keep and a fight on the map aren't the ExploreState's: they're carried, and the move that changes them sets them after.
    ...keepOf(prev),
  };
}

/** An explore row's keep and fight, as they are (the ones it has). */
export function keepOf(r: Pick<ExploreRow, "rested" | "spotted" | "lifted" | "fight">): Pick<ExploreRow, "rested" | "spotted" | "lifted" | "fight"> {
  return {
    ...(r.rested ? { rested: { ...r.rested } } : {}), ...(r.spotted ? { spotted: { ...r.spotted, at: { ...r.spotted.at } } } : {}),
    ...(r.lifted ? { lifted: { ...r.lifted, who: [...r.lifted.who] } } : {}),
    ...(r.fight ? { fight: { ...r.fight, combatants: r.fight.combatants.map(c => ({ ...c, at: { ...c.at } })) } } : {}),
  };
}

/** The explore table's keep and fight columns (schema.ts; the bindings' Explore has the same shape): options undefined when empty, a flag a bool. */
export interface KeepColumns {
  rested: { time: string; short: boolean; long: boolean } | undefined;
  spotted: { time: string; at: Tile2; by: string } | undefined;
  lifted: { time: string; who: string[] } | undefined;
  fight: {
    map: string; seed: number; place: string | undefined;
    combatants: Array<{ id: string; name: string; side: string; statblock: string | undefined; weapon: string | undefined; at: Tile2; castId: string | undefined; role: string | undefined; glyph: string | undefined }>;
  } | undefined;
}

/** The table's columns as the shared row has them (empty options left out). */
export function keepFromColumns(c: KeepColumns): Pick<ExploreRow, "rested" | "spotted" | "lifted" | "fight"> {
  const time = (t: string) => t as StoryState["time"];
  return {
    ...(c.rested ? { rested: { time: time(c.rested.time), ...(c.rested.short ? { short: true } : {}), ...(c.rested.long ? { long: true } : {}) } } : {}),
    ...(c.spotted ? { spotted: { time: time(c.spotted.time), at: { x: c.spotted.at.x, y: c.spotted.at.y }, by: c.spotted.by } } : {}),
    ...(c.lifted ? { lifted: { time: time(c.lifted.time), who: [...c.lifted.who] } } : {}),
    ...(c.fight ? { fight: {
      map: c.fight.map, seed: c.fight.seed, ...(c.fight.place !== undefined ? { place: c.fight.place } : {}),
      combatants: c.fight.combatants.map(f => ({
        id: f.id, name: f.name, side: f.side as TownFight["combatants"][number]["side"], at: { x: f.at.x, y: f.at.y },
        ...(f.statblock !== undefined ? { statblock: f.statblock } : {}), ...(f.weapon !== undefined ? { weapon: f.weapon } : {}),
        ...(f.castId !== undefined ? { castId: f.castId } : {}), ...(f.role !== undefined ? { role: f.role } : {}), ...(f.glyph !== undefined ? { glyph: f.glyph } : {}),
      })),
    } } : {}),
  };
}

/** The shared row's keep and fight as the table's columns. */
export function keepColumns(r: Pick<ExploreRow, "rested" | "spotted" | "lifted" | "fight">): KeepColumns {
  return {
    rested: r.rested ? { time: r.rested.time, short: !!r.rested.short, long: !!r.rested.long } : undefined,
    spotted: r.spotted ? { time: r.spotted.time, at: { x: r.spotted.at.x, y: r.spotted.at.y }, by: r.spotted.by } : undefined,
    lifted: r.lifted ? { time: r.lifted.time, who: [...r.lifted.who] } : undefined,
    fight: r.fight ? {
      map: r.fight.map, seed: r.fight.seed, place: r.fight.place,
      combatants: r.fight.combatants.map(f => ({ id: f.id, name: f.name, side: f.side, statblock: f.statblock, weapon: f.weapon, at: { x: f.at.x, y: f.at.y }, castId: f.castId, role: f.role, glyph: f.glyph })),
    } : undefined,
  };
}
