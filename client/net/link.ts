import type { ClientTable, MoveWire, RowOp } from "../../shared/protocol/port.ts";
import type { Rejection } from "../backend.ts";
import type { DbConnection } from "../module_bindings/index.ts";
import type {
  Area, Attitude, Campaign, Chapter, Creation, Creature, Entity, Explore, Fight, FightEvent, Flag, Follower, Game, GameSummary, Gear, Health, Journal, Look, MapDef,
  Material, NameView, Narrative, OnStage, Place, Player, PlayerCharacter, Position, Quest, ReplyDraft, Scene, SceneSuggestion, SeatView, Sheet,
  Stack, Surface, Transcript, Turn, WorldLog,
} from "../module_bindings/types.ts";

/**
 * The seam between the client's rows and its views (replica.ts) and the way to the simulation
 * (browser-design §4.1): the rows the way keeps for this client, by the bindings' accessors; word of
 * each row event, and of its own trouble; and the moves. The SpacetimeDB connection is one link
 * (connection.ts), a MessagePort to the page's server worker another (port.ts). Types only, but for
 * the place tables' names.
 */

/** A table's rows, in no order. */
export interface Rows<T> { iter(): Iterable<T> }
/** A table's rows found by its primary key. */
export interface Keyed<K, T> { find(key: K): T | undefined | null }

/**
 * The rows a client holds, by the bindings' accessors, with the six lookups by primary key the views
 * make: the SDK's client cache has this shape as it is, and a port's store fills it.
 */
export interface ClientTables {
  mySeat: Rows<SeatView>; myNames: Rows<NameView>; myGames: Rows<GameSummary>; myCreation: Rows<Creation>; campaign: Rows<Campaign>;
  game: Rows<Game> & { id: Keyed<bigint, Game> };
  player: Rows<Player> & { id: Keyed<bigint, Player> };
  sheet: Rows<Sheet> & { playerId: Keyed<bigint, Sheet> };
  scene: Rows<Scene> & { id: Keyed<bigint, Scene> };
  place: Rows<Place> & { id: Keyed<bigint, Place> };
  explore: Rows<Explore> & { playerId: Keyed<bigint, Explore> };
  transcript: Rows<Transcript>; replyDraft: Rows<ReplyDraft>; turn: Rows<Turn>; onStage: Rows<OnStage>; look: Rows<Look>; sceneSuggestion: Rows<SceneSuggestion>;
  chapter: Rows<Chapter>; quest: Rows<Quest>; flag: Rows<Flag>; journal: Rows<Journal>; attitude: Rows<Attitude>; follower: Rows<Follower>;
  entity: Rows<Entity>; position: Rows<Position>; area: Rows<Area>; material: Rows<Material>; health: Rows<Health>; stack: Rows<Stack>;
  surface: Rows<Surface>; creature: Rows<Creature>; playerCharacter: Rows<PlayerCharacter>; gear: Rows<Gear>; narrative: Rows<Narrative>;
  worldLog: Rows<WorldLog>; mapDef: Rows<MapDef>;
  fight: Rows<Fight>; fightEvent: Rows<FightEvent>;
}

/** The tables and views a client watches, by their SQL names (shared/protocol/port.ts CLIENT_TABLES). */
export type Watched = ClientTable;
export type { RowOp };
export type RowListener = (table: Watched, op: RowOp, row: unknown) => void;

/** The tables of a place's world a client watches (all but gm_note, which is the module's), by their SQL names. */
export const PLACE_TABLES = ["entity", "position", "area", "material", "health", "stack", "surface", "creature", "player_character", "gear", "narrative", "world_log"] as const;

/** What's wrong with the way to the simulation, while something is (shown on the status line), and whether it's for good: then every move is refused with it. */
export interface LinkStatus { trouble?: string | undefined; cutOff?: string | undefined }

/** Every move a link carries, by its name on the wire, with its arguments as the bindings have them. */
export type LinkMoves = { [K in MoveWire]: Parameters<DbConnection["reducers"][K]>[0] };

/**
 * The way to the simulation: the rows it keeps for this client, word of each row event and of its own
 * trouble, and the moves.
 */
export interface Link {
  readonly tables: ClientTables;
  /** Resolves once the seat is known and its rows are in; rejects, in words that say what to do, when the server can't be reached. */
  readonly ready: Promise<void>;
  /** Every row event, in arrival order: a transaction's are told once all its rows are in, and a move's come before its answer. */
  onRow(listener: RowListener): void;
  /** Told when the trouble changes, or what the link covers does. */
  onStatus(listener: (status: LinkStatus) => void): void;
  /** The rows the seat asks for are all in: the map waits for its places' rows. */
  covers(): boolean;
  /** A move: undefined when it was made, else why not. */
  move<K extends MoveWire>(name: K, args: LinkMoves[K]): Promise<Rejection | undefined>;
  close(): void;
}
