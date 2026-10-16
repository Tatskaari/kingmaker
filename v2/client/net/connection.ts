import { setGlobalLogLevel } from "spacetimedb";
import type { InteractArgs, TravelArgs, WalkArgs } from "../../shared/map/moves.ts";
import { refusal, refusalIn } from "../../shared/protocol/refusals.ts";
import type { Backend, HomeRows, MoveName, Moves, NewGame, Rejection } from "../backend.ts";
import { exploreViewOf, type ExploreRows, type ExploreView, type MapPlaceTables } from "../explore/rows.ts";
import { DbConnection, type SubscriptionHandle } from "../module_bindings/index.ts";
import type { SeatView } from "../module_bindings/types.ts";
import type { PlaceTables } from "../scene/place-rows.ts";
import { sceneViewOf, type SceneRows } from "../scene/rows.ts";
import type { SceneView } from "../scene/view.ts";

/**
 * The client's way into the simulation (v0-design §7, v1-design §3.10), and the e2e's: a
 * SpacetimeDB connection that follows the seat. It subscribes to the caller's own views (my_seat,
 * my_names, my_games, my_creation) and the campaigns; whenever the seat moves (a new game, a join,
 * a game continued) it subscribes to that game's, scene's and place's rows (the scene's suggested
 * lines among them, and the place's world, which the side panel draws), and the map's (map-design
 * §3.6: the campaign's maps, the explore rows, and the rows of every place of the game on a map),
 * and only then drops the old set, so nothing blinks out. Each row change
 * rebuilds the scene's rows from the client's cache, once a tick; each row event also goes, in
 * arrival order, to whoever listens. The moves are the reducers: a refusal comes back as the
 * simulation wrote it, in the game's words.
 */

export interface ConnectOptions {
  /** The server: ws://127.0.0.1:3300 (http:// works too). */
  url: string;
  /** The database: kingmaker. */
  db: string;
  /** Connect as this identity (a session's token); without one, the server makes a new identity. */
  token?: string;
  /** Told the identity (hex) and its token once connected: a session keeps them. */
  onIdentity?(identity: string, token: string): void;
}

/** The tables and views a client watches, by their SQL names. */
export type Watched =
  | "my_seat" | "my_names" | "my_games" | "my_creation" | "campaign"
  | "game" | "player" | "sheet" | "scene" | "transcript" | "reply_draft" | "turn" | "on_stage" | "look" | "scene_suggestion"
  | "place" | PlaceTable | "map_def" | "explore";

/** The tables of a place's world a client watches (all but gm_note, which is the module's), by their SQL names. */
type PlaceTable = (typeof PLACE_TABLES)[number];
const PLACE_TABLES = ["entity", "position", "area", "material", "health", "stack", "surface", "creature", "player_character", "gear", "narrative", "world_log"] as const;
export type RowOp = "insert" | "update" | "delete";
export type RowListener = (table: Watched, op: RowOp, row: unknown) => void;

/** Connects, and resolves once the seat is known and, when there is one, its game's rows are in. */
export async function connect(options: ConnectOptions): Promise<Connection> {
  quietSdk();
  const connection = new Connection(options);
  await connection.ready;
  return connection;
}

/** The SDK's own news ("Connecting to SpacetimeDB WS...") goes to stdout, which is the screen, or the agent's answer: only its warnings and errors. */
const quietSdk = () => setGlobalLogLevel("warn");

/**
 * What the seat's subscription set covers: the game, its scene, the place whose looks to read; the
 * game's campaign version (its maps), once its row has come, and its places on maps (their rows).
 */
interface WatchKey { game: bigint; scene?: bigint; place?: bigint; campaign?: string; mapPlaces: bigint[] }
interface Watching { key: WatchKey; handle: SubscriptionHandle; dropped: boolean }

export class Connection implements Backend {
  /** Resolves once the seat and its rows are in (connect awaits it); rejects when the server can't be reached. */
  readonly ready: Promise<void>;
  identity = "";

  private readonly db: DbConnection;
  private watching?: Watching;
  private refused?: string;
  /** What's wrong with the connection, while something is: shown on the status line. */
  private trouble?: string;
  /** The SDK has stopped trying to reconnect, for good: what's wrong, and what to do. Every move is refused with it. */
  private cutOff?: string;
  /** The client closed the connection itself: its end isn't trouble. */
  private closing = false;
  /** my_seat is in: the seat (or that there's none) is known. */
  private seatKnown = false;
  private settled = false;
  private pending = false;
  /** Moves on with every row event of a table the map is read from: the explore view is made again only then. */
  private mapRev = 0;
  private explored?: { rev: number; refused: string | undefined; trouble: string | undefined; seat: string; view: ExploreView | undefined };
  private readonly changes = new Set<() => void>();
  private readonly events = new Set<RowListener>();
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;

  constructor(options: ConnectOptions) {
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.db = this.open(options);
    this.watchTables();
  }

  /** The scene's rows as this client holds them; undefined while there's no seat, or its rows haven't come. */
  rows(): SceneRows | undefined {
    const seat = this.seat();
    const game = seat ? this.db.db.game.id.find(seat.gameId) : undefined;
    const scene = seat?.sceneId === undefined ? undefined : this.db.db.scene.id.find(seat.sceneId);
    if (!seat || !game || !scene) return undefined;

    const of = <T>(table: { iter(): Iterable<T> }, keep: (row: T) => boolean) => [...table.iter()].filter(keep);
    return {
      me: seat.playerId,
      game, scene,
      players: of(this.db.db.player, p => p.gameId === game.id),
      sheets: of(this.db.db.sheet, s => s.gameId === game.id),
      transcript: of(this.db.db.transcript, t => t.sceneId === scene.id),
      drafts: of(this.db.db.replyDraft, d => d.sceneId === scene.id),
      turns: of(this.db.db.turn, t => t.sceneId === scene.id),
      onStage: of(this.db.db.onStage, s => s.sceneId === scene.id),
      names: [...this.db.db.myNames.iter()],
      looks: of(this.db.db.look, l => l.placeId === scene.placeId),
      suggestions: of(this.db.db.sceneSuggestion, s => s.sceneId === scene.id),
      ...this.placeOf(scene),
      ...(this.refused ? { refusal: this.refused } : {}),
      ...(this.trouble ? { trouble: this.trouble } : {}),
      ...(this.cutOff ? { cutOff: true } : {}),
    };
  }

  view(): SceneView | undefined {
    const rows = this.rows();
    return rows && sceneViewOf(rows);
  }

  /**
   * The map's rows as this client holds them (map-design §3.6): the seat's game, its players and
   * sheets, the campaign's maps, the game's explore rows and scenes, its places on maps with their
   * rows, and the names the player knows the people in them by; undefined while there's no seat or
   * its game's row hasn't come.
   */
  exploreRows(): ExploreRows | undefined {
    const seat = this.seat();
    const game = seat ? this.db.db.game.id.find(seat.gameId) : undefined;
    if (!seat || !game) return undefined;
    const t = this.db.db;
    const campaign = `${game.campaign}@${game.campaignVersion}`;
    const ofGame = <T extends { gameId: bigint }>(table: { iter(): Iterable<T> }) => [...table.iter()].filter(r => r.gameId === game.id);
    const places: MapPlaceTables[] = ofGame(t.place).filter(p => p.mapKey !== undefined).map(place => {
      const here = <T extends { placeId: bigint }>(table: { iter(): Iterable<T> }) => [...table.iter()].filter(r => r.placeId === place.id);
      return {
        place, entity: here(t.entity), position: here(t.position), area: here(t.area), material: here(t.material), health: here(t.health),
        stack: here(t.stack), surface: here(t.surface), creature: here(t.creature), playerCharacter: here(t.playerCharacter),
        gear: here(t.gear), narrative: here(t.narrative), worldLog: here(t.worldLog),
      };
    });
    return {
      me: seat.playerId, game,
      players: ofGame(t.player), sheets: ofGame(t.sheet),
      maps: [...t.mapDef.iter()].filter(m => m.campaignId === campaign),
      explore: ofGame(t.explore), scenes: ofGame(t.scene), places,
      names: [...t.myNames.iter()],
      ...(this.refused ? { refusal: this.refused } : {}),
      ...(this.trouble ? { trouble: this.trouble } : {}),
      ...(this.cutOff ? { cutOff: true } : {}),
    };
  }

  /** The map between scenes, made from the rows: made again only when they (or the words beside it) have changed. */
  explore(): ExploreView | undefined {
    const seat = this.seat();
    const key = { rev: this.mapRev, refused: this.refused, trouble: this.trouble, seat: seat ? `${seat.playerId}:${seat.gameId}` : "" };
    const was = this.explored;
    if (was && was.rev === key.rev && was.refused === key.refused && was.trouble === key.trouble && was.seat === key.seat) return was.view;
    const rows = this.exploreRows();
    const view = rows && exploreViewOf(rows);
    this.explored = { ...key, view };
    return view;
  }

  /** The scene's place and its world's rows, once its row has come (the world bridge's §3.5). */
  private placeOf(scene: { placeId: bigint; sceneKey: string }): { place?: PlaceTables } {
    const place = this.db.db.place.id.find(scene.placeId);
    if (!place) return {};
    const t = this.db.db;
    const here = <T extends { placeId: bigint }>(table: { iter(): Iterable<T> }) => [...table.iter()].filter(r => r.placeId === place.id);
    return {
      place: {
        sceneKey: scene.sceneKey, place,
        entity: here(t.entity), position: here(t.position), area: here(t.area), material: here(t.material), health: here(t.health),
        stack: here(t.stack), surface: here(t.surface), creature: here(t.creature), playerCharacter: here(t.playerCharacter),
        gear: here(t.gear), narrative: here(t.narrative), worldLog: here(t.worldLog),
      },
    };
  }

  /** The caller's seat (my_seat): its player, game, place and scene; undefined when it has none. */
  seat(): SeatView | undefined {
    return [...this.db.db.mySeat.iter()][0];
  }

  /** The caller's games and the character they're making, the campaigns, and the seat's own player and sheet (before its game has a scene too). */
  home(): HomeRows {
    const seat = this.seat();
    const player = seat ? this.db.db.player.id.find(seat.playerId) : undefined;
    const sheet = seat ? this.db.db.sheet.playerId.find(seat.playerId) : undefined;
    const creation = [...this.db.db.myCreation.iter()][0];
    return {
      games: [...this.db.db.myGames.iter()],
      ...(creation ? { creation } : {}),
      campaigns: [...this.db.db.campaign.iter()],
      ...(seat ? { seat } : {}),
      ...(player ? { player } : {}),
      ...(sheet ? { sheet } : {}),
      ...(this.refused ? { refusal: this.refused } : {}),
    };
  }

  onChange(listener: () => void): () => void {
    this.changes.add(listener);
    return () => { this.changes.delete(listener); };
  }

  /** Every row event of the watched tables, in the order they arrive (row callbacks fire before a move's promise resolves). */
  onEvent(listener: RowListener): () => void {
    this.events.add(listener);
    return () => { this.events.delete(listener); };
  }

  newGame(args: NewGame): Promise<Rejection | undefined> {
    return this.move(() => this.db.reducers.newGame(args));
  }

  joinGame(game: bigint): Promise<Rejection | undefined> {
    return this.move(() => this.db.reducers.joinGame({ game }));
  }

  say(text: string): Promise<Rejection | undefined> {
    return this.move(() => this.db.reducers.say({ text }));
  }

  walk(args: WalkArgs): Promise<Rejection | undefined> {
    return this.move(() => this.db.reducers.walk({ to: args.to, toward: args.toward }));
  }

  interact(args: InteractArgs): Promise<Rejection | undefined> {
    return this.move(() => this.db.reducers.interact({ verb: args.verb, target: args.target, at: args.at }));
  }

  travel(args: TravelArgs): Promise<Rejection | undefined> {
    return this.move(() => this.db.reducers.travel({ way: args.way, at: args.at }));
  }

  /** This player's own setting: the suggested lines on or off (on, this moment's are asked for at once). */
  setSuggestions(on: boolean): Promise<Rejection | undefined> {
    return this.move(() => this.db.reducers.setSuggestions({ on }));
  }

  /** Carries the failed turn on: the one holding the scene's lease. */
  retry(): Promise<Rejection | undefined> {
    const turn = this.rows()?.scene.turnId;
    return turn === undefined ? Promise.resolve(refusal("not_failed")) : this.retryTurn(turn);
  }

  retryTurn(turn: bigint): Promise<Rejection | undefined> {
    return this.move(() => this.db.reducers.retryTurn({ turn }));
  }

  act<K extends MoveName>(move: K, args: Moves[K]): Promise<Rejection | undefined> {
    const reducer = this.db.reducers[move] as (args: Moves[K]) => Promise<void>;
    return this.move(() => reducer(args));
  }

  close(): void {
    this.closing = true;
    this.db.disconnect();
  }

  // -------------------------------------------------------------------------------------------
  // Connecting.

  /**
   * The connection, reconnecting by itself after a drop (it keeps its subscriptions and replays
   * them), every few seconds at most: the server's usually this machine's, back in moments.
   */
  private open(options: ConnectOptions): DbConnection {
    return DbConnection.builder()
      .withUri(options.url)
      .withDatabaseName(options.db)
      .withToken(options.token)
      .withAutomaticReconnect({ maxDelayMs: 5000 })
      .onConnect((_conn, identity, token) => {
        this.identity = identity.toHexString();
        options.onIdentity?.(this.identity, token);
        this.watchSeat();
      })
      .onConnectError((_ctx, error, next) => this.failedToConnect(options, error, next))
      .onDisconnect((_ctx, error, next) => this.lost(error, next))
      .onAutomaticReconnect(() => this.back())
      .build();
  }

  /** A reconnect failed: the SDK tries again (`next`), or, with no next attempt, has stopped for good. */
  private failedToConnect(options: ConnectOptions, error: Error, next: number | undefined): void {
    if (!this.settled) { void whyNot(options, error).then(why => this.rejectReady(new Error(why))); return; }
    if (this.closing) return;
    if (next === undefined) { this.cut(TURNED_AWAY); return; }
    this.trouble = `(The game's server is out of reach: trying again (attempt ${next})…)`;
    this.changed();
  }

  /** The connection dropped: the SDK reconnects (`next`), or, with no next attempt, won't. */
  private lost(_error: Error | undefined, next: number | undefined): void {
    if (this.closing) return;
    if (next === undefined) { this.cut(CLOSED); return; }
    this.trouble = "(Lost the game's server: reconnecting…)";
    this.changed();
  }

  /**
   * The SDK has stopped trying, and nothing brings this session back but starting again (a reconnect
   * a server turned away with a 401 or 403: one signed by other keys, on the port). The status line
   * says so and what to do, the box stays shut, and a move is refused with the same words: the SDK
   * would answer each one "out of reach", as if it were still trying.
   */
  private cut(words: string): void {
    this.cutOff = words;
    this.trouble = words;
    this.changed();
  }

  private back(): void {
    this.trouble = undefined;
    this.changed();
  }

  // -------------------------------------------------------------------------------------------
  // Following the seat.

  /** The caller's own views and the campaigns: always watched. Once they're in, the seat's rows follow. */
  private watchSeat(): void {
    this.db.subscriptionBuilder()
      .onApplied(() => { this.seatKnown = true; this.follow(); this.readyOnceIn(); })
      .onError(ctx => this.subscriptionFailed(ctx.event))
      .subscribe(["my_seat", "my_names", "my_games", "my_creation", "campaign"].map(table => `SELECT * FROM ${table}`));
  }

  /**
   * The subscriptions follow the seat: its game, its scene, and the place whose looks to read (the
   * seat's, else its scene's, which arrives with the first set). A new set is subscribed first and
   * the old one dropped once it's applied.
   */
  private follow(): void {
    const key = this.wanted();
    if (sameKey(key, this.watching?.key)) return;

    const was = this.watching;
    this.watching = key ? this.subscribe(key, was) : undefined;
    if (!key) drop(was);
  }

  private wanted(): WatchKey | undefined {
    const seat = this.seat();
    if (!seat) return undefined;
    const scene = seat.sceneId === undefined ? undefined : this.db.db.scene.id.find(seat.sceneId);
    const place = seat.placeId ?? scene?.placeId;
    const game = this.db.db.game.id.find(seat.gameId);
    const mapPlaces = [...this.db.db.place.iter()].filter(p => p.gameId === seat.gameId && p.mapKey !== undefined).map(p => p.id).sort((a, b) => (a < b ? -1 : 1));
    return {
      game: seat.gameId, ...(seat.sceneId !== undefined ? { scene: seat.sceneId } : {}), ...(place !== undefined ? { place } : {}),
      ...(game ? { campaign: `${game.campaign}@${game.campaignVersion}` } : {}), mapPlaces,
    };
  }

  private subscribe(key: WatchKey, was: Watching | undefined): Watching {
    let watching: Watching | undefined;
    const handle = this.db.subscriptionBuilder()
      .onApplied(() => this.applied(watching!, was))
      .onError(ctx => this.subscriptionFailed(ctx.event))
      .subscribe(queriesFor(key));
    watching = { key, handle, dropped: false };
    return watching;
  }

  /** A set is in: the one it replaces goes. One that was replaced while it came goes itself. (A reconnect applies every set again.) */
  private applied(watching: Watching, was: Watching | undefined): void {
    if (this.watching !== watching) { drop(watching); return; }
    drop(was);
    this.readyOnceIn();
    this.changed();
  }

  /**
   * Ready once the seat is known and its rows are in, or there's no seat. Its rows are in once the set
   * that's in is the one the rows ask for: the game's row brings its campaign's maps, and its places
   * on maps their rows, in a set of their own.
   */
  private readyOnceIn(): void {
    if (this.settled || !this.seatKnown || (this.watching && (!this.watching.handle.isActive() || !sameKey(this.wanted(), this.watching.key)))) return;
    this.settled = true;
    this.resolveReady();
  }

  private subscriptionFailed(error: Error | undefined): void {
    const why = error?.message ?? "the server said no";
    if (!this.settled) { this.rejectReady(new Error(`The game's server won't share its rows: ${why}`)); return; }
    this.trouble = `(The game's rows stopped coming: ${why}.)`;
    this.changed();
  }

  // -------------------------------------------------------------------------------------------
  // Rows and moves.

  /** Every watched table's row events: told to the listeners as they come, and the view rebuilt once a tick. */
  private watchTables(): void {
    const t = this.db.db;
    const tables: Array<[Watched, Observable]> = [
      ["my_seat", t.mySeat], ["my_names", t.myNames], ["my_games", t.myGames], ["my_creation", t.myCreation], ["campaign", t.campaign],
      ["game", t.game], ["player", t.player], ["sheet", t.sheet], ["scene", t.scene],
      ["transcript", t.transcript], ["reply_draft", t.replyDraft], ["turn", t.turn], ["on_stage", t.onStage], ["look", t.look],
      ["scene_suggestion", t.sceneSuggestion],
      ["place", t.place], ["entity", t.entity], ["position", t.position], ["area", t.area], ["material", t.material], ["health", t.health],
      ["stack", t.stack], ["surface", t.surface], ["creature", t.creature], ["player_character", t.playerCharacter], ["gear", t.gear],
      ["narrative", t.narrative], ["world_log", t.worldLog], ["map_def", t.mapDef], ["explore", t.explore],
    ];
    for (const [name, table] of tables) {
      table.onInsert((_ctx, row) => this.event(name, "insert", row));
      table.onDelete((_ctx, row) => this.event(name, "delete", row));
      table.onUpdate?.((_ctx, _old, row) => this.event(name, "update", row));
    }
  }

  private event(table: Watched, op: RowOp, row: unknown): void {
    if (MAP_TABLES.has(table)) this.mapRev++;
    for (const listener of this.events) listener(table, op, row);
    this.changed();
  }

  /** The rows changed: once a tick, the subscriptions follow the seat and the listeners hear of it. */
  private changed(): void {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      if (this.seatKnown) this.follow();
      for (const listener of this.changes) listener();
    });
  }

  /**
   * A reducer called: undefined when it was made; else why not, and the words kept for the status
   * line until the next move. Once the SDK has stopped trying, none is called: the words say why.
   */
  private async move(call: () => Promise<void>): Promise<Rejection | undefined> {
    this.refused = this.cutOff;
    this.changed();
    if (this.cutOff) return { code: "error", text: this.cutOff };
    try {
      await call();
      return undefined;
    } catch (error) {
      const why = rejectionOf(error);
      this.refused = why.text;
      this.changed();
      return why;
    }
  }
}

/** A reconnect the server refused, for good (a 401 or 403: a server signed by other keys, on the port), and what to do. */
export const TURNED_AWAY = "(The game's server turned this session away: /quit, then start again.)";
/** A connection the server closed that the SDK won't open again (a protocol error), and what to do. */
export const CLOSED = "(The game's server closed this session: /quit, then start again.)";

/** A table's row callbacks, as every watched table and view has them (onUpdate on those with a primary key). */
interface Observable {
  onInsert(cb: (ctx: unknown, row: unknown) => void): void;
  onDelete(cb: (ctx: unknown, row: unknown) => void): void;
  onUpdate?(cb: (ctx: unknown, old: unknown, row: unknown) => void): void;
}

/** The tables the map is read from (map-design §3.6): an event in one makes the explore view again. */
const MAP_TABLES = new Set<Watched>(["my_seat", "my_names", "game", "player", "sheet", "scene", "place", ...PLACE_TABLES, "map_def", "explore"]);

/**
 * The seat's subscription set (v0-design §7, v5-design §3.9's scene_suggestion, the world bridge's
 * §3.5: the place and its world, and map-design §3.6: the game's places and explore rows, its
 * campaign's maps, and the rows of each of its places on a map).
 */
function queriesFor({ game, scene, place, campaign, mapPlaces }: WatchKey): string[] {
  const places = [...new Set([...(place === undefined ? [] : [place]), ...mapPlaces])];
  return [
    `SELECT * FROM game WHERE id = ${game}`,
    ...["player", "sheet", "scene", "place", "explore"].map(table => `SELECT * FROM ${table} WHERE game_id = ${game}`),
    ...(campaign === undefined ? [] : [`SELECT * FROM map_def WHERE campaign_id = '${campaign.replace(/'/g, "''")}'`]),
    ...(scene === undefined ? [] : ["transcript", "reply_draft", "turn", "on_stage", "scene_suggestion"].map(table => `SELECT * FROM ${table} WHERE scene_id = ${scene}`)),
    ...places.flatMap(id => ["look", ...PLACE_TABLES].map(table => `SELECT * FROM ${table} WHERE place_id = ${id}`)),
  ];
}

const sameKey = (a: WatchKey | undefined, b: WatchKey | undefined) =>
  a?.game === b?.game && a?.scene === b?.scene && a?.place === b?.place && a?.campaign === b?.campaign && (a?.mapPlaces ?? []).join() === (b?.mapPlaces ?? []).join();

/** Drops a set once (a second unsubscribe throws); one still on its way is dropped by `applied` when it lands. */
function drop(watching: Watching | undefined): void {
  if (!watching || watching.dropped || !watching.handle.isActive()) return;
  watching.dropped = true;
  watching.handle.unsubscribe();
}

/**
 * Why the first connection failed, in words that say what to do: the SDK's own error says nothing
 * (a bare TypeError), so ask the server whether it's there, and whether it has the database.
 */
async function whyNot({ url, db }: ConnectOptions, error: Error): Promise<string> {
  const http = url.replace(/^ws/, "http").replace(/\/+$/, "");
  const status = (path: string) => fetch(`${http}${path}`, { signal: AbortSignal.timeout(2000) }).then(r => r.status, () => 0);
  if (await status("/v1/ping") !== 200) return `Nothing answers at ${url}: is the dev stack up (npm run dev)? Or play with --demo.`;
  if (await status(`/v1/database/${db}`) === 404) return `The server at ${url} has no database called ${db}: is the module published (npm run dev does it)?`;
  return `The server at ${url} wouldn't take the connection to ${db}${error.message ? `: ${error.message}` : ""}. If it's the session's identity it doesn't know, start another --session.`;
}

/** Why a reducer call failed: its refusal (a SenderError carrying it as JSON), else what went wrong, in words for the status line. */
function rejectionOf(error: unknown): Rejection {
  const message = error instanceof Error ? error.message : String(error);
  const refused = refusalIn(message);
  if (refused) return refused;
  if (error instanceof Error && error.name === "DisconnectedError") return { code: "error", text: "(The game's server is out of reach: try again in a moment.)" };
  return { code: "error", text: `(The game couldn't do that: ${message})` };
}
