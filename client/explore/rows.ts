// New (map-design §3.4, §3.6): the map's rows as the client holds them, made into the prototype's ExploreState by shared/map's exploreOf (the seam the simulation calls too), with what the explore screen says beside the map; and the action menu's (town-design §3.3, §3.9): the walker's catalogue from their sheet, the explore row's keep and the fight it records.
import type { ExploreState } from "../../shared/map/explore.ts";
import type { Keep } from "../../shared/map/menu.ts";
import { exploreOf, keepFromColumns, type ExploreRow, type MapPlace, type MapRows } from "../../shared/map/rows.ts";
import type { MapFile } from "../../shared/map/tiles.ts";
import type { Unheard } from "../../shared/map/town.ts";
import type { TownFight } from "../../shared/map/types.ts";
import type { Catalogue } from "../../shared/rules/aim.ts";
import type { TimeOfDay } from "../../shared/scene/files.ts";
import type { Explore, Game, MapDef, Place, Player, Scene, Sheet } from "../module_bindings/types.ts";
import { placeRowsOf, type PlaceTables } from "../scene/place-rows.ts";

/**
 * A place on a map as the client holds it (net/connection.ts subscribes to every place of the game
 * that has a mapKey): its row, with where it is on its map, and its world's rows, the bindings' types
 * narrowed to what the world is rebuilt from. gm_note is the module's alone: the map is drawn and
 * walked from what any client sees, so both sides offer the same ids.
 */
export interface MapPlaceTables extends Omit<PlaceTables, "sceneKey" | "place"> {
  /** town: a map's own place's changes (town-design §3.3), "" or absent for none. */
  place: PlaceTables["place"] & Pick<Place, "sceneId" | "mapKey" | "region" | "origin" | "active"> & Partial<Pick<Place, "town">>;
}

/** Everything the explore screen is drawn from, as the bindings have it. */
export interface ExploreRows {
  /** This client's player: my_seat's playerId. */
  me: bigint;
  game: Pick<Game, "id" | "time" | "hostId" | "leadScene">;
  players: Array<Pick<Player, "id" | "name" | "concept">>;
  /** Each player's sheet: the walker's status line and build, and what they can do outside a fight (the action menu's catalogue, town-design §3.3). */
  sheets: Array<Pick<Sheet, "playerId" | "statusLine" | "build"> & Partial<Pick<Sheet, "actions">>>;
  /** The game's campaign version's maps (map_def). */
  maps: Array<Pick<MapDef, "key" | "json">>;
  /** The game's explore rows: the walker's is the host's, which a spectator draws too. */
  explore: Explore[];
  /** The game's scenes: the lead (a waiting one), the one being played, the ones played. */
  scenes: Array<Pick<Scene, "id" | "sceneKey" | "title" | "hook" | "status" | "placeId">>;
  /** The game's places on maps, with their rows. */
  places: MapPlaceTables[];
  /** my_names: what the player calls the people in the places on their map. */
  names: Array<{ entityId: bigint; key: string; name: string }>;
  /** The words of the last move the simulation refused, until the next move. */
  refusal?: string;
  /** What's wrong with the connection to the server, while something is. */
  trouble?: string;
  /** The connection has stopped trying, for good. */
  cutOff?: boolean;
}

/** The explore screen's view: the prototype's ExploreState made from rows, and what's said beside it. */
export interface ExploreView {
  /** The game's number: what a second terminal gives --join to watch it. */
  game: string;
  /** The walker's state (the host's), made from the rows: shared, so never changed in place. */
  ex: ExploreState;
  /** The cast the player hasn't heard named, with what they'd call them. */
  unheard: Unheard;
  /** The one who walks (the host): their character's name, their sheet's status line and build, their concept. */
  player: { name: string; status?: string; build?: string; concept?: string };
  /** Who has the lead, when this client is a spectator's: the map is theirs to walk. */
  watching?: string;
  /** The scene the story is heading for, as its waiting row has it. */
  lead?: { key: string; title: string; hook: string };
  /** The explore row's count of moves, what the last one said, and the last five things said (map-design §3.1). */
  acts: number;
  said: string;
  log: string[];
  refusal?: string;
  /** What the game is waiting on: the server, while the connection's down. */
  note?: string;
  cutOff?: boolean;
  /**
   * The action menu's (town-design §3.3): what the walker can do outside a fight, by kind (their
   * sheet's catalogue: none without a rules character, or before the menu), and what the explore row
   * keeps for it (when they rested, where they were seen hiding, whose pockets they've tried).
   */
  catalogue?: Catalogue;
  keep?: Keep;
  /** A fight that broke out on the map (the explore row's, for V12): its stand-in's card is up until it's fought out. */
  fight?: TownFight;
}

const TIMES: readonly TimeOfDay[] = ["morning", "afternoon", "evening", "night", "next-morning"];
const timeOf = (word: string): TimeOfDay => (TIMES.includes(word as TimeOfDay) ? word as TimeOfDay : "morning");

/** The walker's explore row: the host's (a spectator walks nowhere, and sees the host's map). */
export const walkerOf = (rows: Pick<ExploreRows, "game" | "explore">): Explore | undefined => rows.explore.find(e => e.playerId === rows.game.hostId);

/**
 * The rows as shared/map reads them (MapRows), as the simulation reads them in a move
 * (simulation/src/map/rows.ts mapRowsOf), so both sides make the same state and offer the same ids:
 * the campaign's map files, the walker's row with its ids as strings, the story (the game's time of
 * day, its lead, the scenes played, oldest first), the game's places on their maps now with their
 * rows (by id), and the cast the player hasn't heard named. A scene is played at the game's time of
 * day (the simulation reads its scene file's, which the client hasn't: the same, until a story's
 * clock moves on with V3).
 */
export function mapRowsOf(rows: ExploreRows): MapRows | undefined {
  const row = walkerOf(rows);
  if (!row) return undefined;
  const time = timeOf(rows.game.time);
  const maps = rows.maps.map(m => JSON.parse(m.json) as MapFile);
  const played = rows.scenes.filter(s => s.status === "ended").sort((a, b) => (a.id < b.id ? -1 : 1)).map(s => s.sceneKey);
  const onMaps = onMapsOf(rows);
  const places: MapPlace[] = onMaps.flatMap(p => {
    const mapKey = p.place.mapKey;
    if (mapKey === undefined) return [];
    const scene = p.place.sceneId === undefined ? undefined : rows.scenes.find(s => s.id === p.place.sceneId);
    return [{
      key: p.place.key, mapKey, ...(p.place.region !== undefined ? { region: p.place.region } : {}),
      origin: p.place.origin ? { x: p.place.origin.x, y: p.place.origin.y } : { x: 0, y: 0 },
      ...(scene ? { scene: { key: scene.sceneKey, status: scene.status, time } } : {}),
      rows: placeRowsOf({ ...p, sceneKey: scene?.sceneKey ?? "" }),
      // A map's own place's: what the rules did to the town (town-design §3.3), into the overlay.
      ...(p.place.town ? { town: p.place.town } : {}),
    }];
  });
  const explore: ExploreRow = {
    playerId: String(row.playerId), gameId: String(row.gameId), map: row.map, at: { x: row.at.x, y: row.at.y }, facing: { x: row.facing.x, y: row.facing.y },
    steps: row.steps, hidden: row.hidden, ...(row.scene !== undefined ? { scene: row.scene } : {}),
    followers: row.followers.map(f => ({ ...f, at: { x: f.at.x, y: f.at.y } })),
    quips: row.quips, ...(row.lastQuip !== undefined ? { lastQuip: row.lastQuip } : {}), styles: [...row.styles],
    acts: row.acts, said: row.said, log: [...row.log],
    ...keepFromColumns(row),
  };
  return { maps, explore, story: { time, ...(rows.game.leadScene !== undefined ? { lead: rows.game.leadScene } : {}), played }, places, unheard: unheardOf(rows, onMaps) };
}

/** The game's places on their maps now (a mapKey, and active), by id. */
const onMapsOf = (rows: ExploreRows) => rows.places.filter(p => p.place.mapKey !== undefined && p.place.active).sort((a, b) => (a.place.id < b.place.id ? -1 : 1));

/**
 * The cast the player hasn't heard named, with what they'd call them (asHeard's pairs), in the
 * simulation's order: place by place, each entity with a `called` by its order, once a key, unless
 * my_names gives it its own name (heard).
 */
function unheardOf(rows: ExploreRows, places: MapPlaceTables[]): Unheard {
  const known = new Map(rows.names.map(n => [n.entityId, n.name] as const));
  const out = new Map<string, { name: string; called: string }>();
  for (const p of places) {
    for (const e of [...p.entity].sort((a, b) => a.ord - b.ord)) {
      if (e.called && known.get(e.id) !== e.name && !out.has(e.key)) out.set(e.key, { name: e.name, called: e.called });
    }
  }
  return [...out.values()];
}

/**
 * The explore screen's view of the rows: none while the walker has no explore row (the game hasn't
 * begun on a map, or its rows haven't come), or while the rows don't make a state (the map's rows
 * half arrived): the screen waits for them.
 */
export function exploreViewOf(rows: ExploreRows): ExploreView | undefined {
  const map = mapRowsOf(rows);
  const row = walkerOf(rows);
  if (!map || !row || !rows.maps.some(m => m.key === row.map)) return undefined;
  let ex: ExploreState;
  try {
    ex = exploreOf(map);
  } catch {
    return undefined;
  }
  const host = rows.players.find(p => p.id === rows.game.hostId);
  const sheet = rows.sheets.find(s => s.playerId === rows.game.hostId);
  const watching = rows.me === rows.game.hostId ? undefined : host?.name ?? "Someone else";
  // The lead, while it's still ahead: once its scene is played, the story comes to the player from there (V3 moves it on).
  const lead = rows.game.leadScene === undefined ? undefined : rows.scenes.find(s => s.sceneKey === rows.game.leadScene && s.status !== "ended");
  return {
    game: String(rows.game.id), ex, unheard: map.unheard,
    player: { name: host?.name ?? "", ...(sheet?.statusLine ? { status: sheet.statusLine } : {}), ...(sheet?.build ? { build: sheet.build } : {}), ...(host?.concept ? { concept: host.concept } : {}) },
    ...(watching ? { watching } : {}),
    ...(lead ? { lead: { key: lead.sceneKey, title: lead.title, hook: lead.hook } } : {}),
    acts: row.acts, said: row.said, log: [...row.log],
    ...(rows.refusal ? { refusal: rows.refusal } : {}),
    ...(rows.trouble ? { note: rows.trouble } : {}),
    ...(rows.cutOff ? { cutOff: true } : {}),
    ...townOf(map.explore, sheet?.actions),
  };
}

/** The action menu's part of the view: the walker's catalogue (the sheet's `actions`, JSON; "" before the menu), the explore row's keep, and a fight it records. */
function townOf(row: ExploreRow, actions: string | undefined): Pick<ExploreView, "catalogue" | "keep" | "fight"> {
  const catalogue = catalogueOf(actions);
  const keep: Keep = { ...(row.rested ? { rested: row.rested } : {}), ...(row.spotted ? { spotted: row.spotted } : {}), ...(row.lifted ? { lifted: row.lifted } : {}) };
  return { ...(catalogue ? { catalogue } : {}), keep, ...(row.fight ? { fight: row.fight } : {}) };
}

/** A sheet's catalogue (town-design §3.1: JSON shared/rules/aim.ts Catalogue), or none when it's "" or unreadable: then there's no menu. */
export function catalogueOf(json: string | undefined): Catalogue | undefined {
  if (!json) return undefined;
  try {
    const value = JSON.parse(json) as Partial<Catalogue> | null;
    return value && Array.isArray(value.sections) && Array.isArray(value.entries) ? value as Catalogue : undefined;
  } catch {
    return undefined;
  }
}
