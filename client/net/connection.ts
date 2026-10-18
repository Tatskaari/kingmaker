import { setGlobalLogLevel } from "spacetimedb";
import type { MoveWire } from "../../shared/protocol/port.ts";
import { refusalIn } from "../../shared/protocol/refusals.ts";
import type { Rejection } from "../backend.ts";
import { DbConnection, type SubscriptionHandle } from "../module_bindings/index.ts";
import { PLACE_TABLES, type ClientTables, type Link, type LinkMoves, type LinkStatus, type RowListener, type RowOp, type Watched } from "./link.ts";
import { endSceneAs, type Owner } from "./owner.ts";
import { Replica } from "./replica.ts";

export type { RowListener, RowOp, Watched } from "./link.ts";

/**
 * The client's way into the simulation over SpacetimeDB (v0-design §7, v1-design §3.10), and the
 * e2e's: a Connection is the client's rows and views (replica.ts) over a SpacetimeLink, a SpacetimeDB
 * connection that follows the seat. It subscribes to the caller's own views (my_seat, my_names,
 * my_games, my_creation) and the campaigns; whenever the seat moves (a new game, a join, a game
 * continued) it subscribes to that game's, scene's and place's rows (the scene's suggested lines among
 * them, the story's tables: story-design §4.5, and the place's world, which the side panel draws), and
 * the map's (map-design §3.6: the campaign's maps, the explore rows, and the rows of every place of
 * the game on a map), and only then drops the old set, so nothing blinks out. Each row event goes to
 * the Replica as it comes, which rebuilds the scene's rows from the SDK's cache once a tick. The moves
 * are the reducers: a refusal comes back as the simulation wrote it, in the game's words.
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
  /** The dev stack's owner (net/owner.ts ownerAt), for the testing moves only the owner may make: end_scene. */
  owner?: Owner;
}

/** Connects, and resolves once the seat is known and, when there is one, its game's rows are in. */
export async function connect(options: ConnectOptions): Promise<Connection> {
  quietSdk();
  const connection = new Connection(options);
  await connection.ready;
  return connection;
}

/** The SDK's own news ("Connecting to SpacetimeDB WS...") goes to stdout, which is the screen, or the agent's answer: only its warnings and errors. */
const quietSdk = () => setGlobalLogLevel("warn");

/** The client over SpacetimeDB: the rows and views over a SpacetimeLink. */
export class Connection extends Replica {
  private readonly spacetime: SpacetimeLink;

  constructor(options: ConnectOptions) {
    const link = new SpacetimeLink(options);
    super(link);
    this.spacetime = link;
  }

  /** The identity (hex) the server gave, once connected. */
  get identity(): string {
    return this.spacetime.identity;
  }
}

/**
 * What the seat's subscription set covers: the game, its scene, the place whose looks to read; the
 * game's campaign version (its maps), once its row has come, and its places on maps (their rows).
 */
interface WatchKey { game: bigint; scene?: bigint; place?: bigint; campaign?: string; mapPlaces: bigint[] }
interface Watching { key: WatchKey; handle: SubscriptionHandle; dropped: boolean }

/** A SpacetimeDB connection that follows the seat (above): the SDK's cache is the link's tables. */
export class SpacetimeLink implements Link {
  readonly ready: Promise<void>;
  identity = "";

  private readonly db: DbConnection;
  /** The dev stack's owner, for end_scene (testing): none when the client found no stack.json. */
  private readonly owner?: Owner;
  private watching?: Watching;
  /** What's wrong with the connection, while something is; and, once the SDK has stopped trying to reconnect for good, what's wrong and what to do. */
  private status: LinkStatus = {};
  /** The client closed the connection itself: its end isn't trouble. */
  private closing = false;
  /** my_seat is in: the seat (or that there's none) is known. */
  private seatKnown = false;
  private settled = false;
  /** The subscriptions follow the seat this tick. */
  private following = false;
  private readonly rowListeners = new Set<RowListener>();
  private readonly statusListeners = new Set<(status: LinkStatus) => void>();
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;

  constructor(options: ConnectOptions) {
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    if (options.owner) this.owner = options.owner;
    this.db = this.open(options);
    this.watchTables();
  }

  /** The SDK's client cache, which has ClientTables' shape as it is. */
  get tables(): ClientTables {
    return this.db.db;
  }

  onRow(listener: RowListener): void {
    this.rowListeners.add(listener);
  }

  onStatus(listener: (status: LinkStatus) => void): void {
    this.statusListeners.add(listener);
  }

  /** The set in place is the one the seat's rows ask for, and it's in: every place of the game on a map has its rows. */
  covers(): boolean {
    return !!this.watching && this.watching.handle.isActive() && sameKey(this.wanted(), this.watching.key);
  }

  /** A reducer called: undefined when it was made; else why not (its refusal, or what went wrong on the way). */
  async move<K extends MoveWire>(name: K, args: LinkMoves[K]): Promise<Rejection | undefined> {
    // end_scene is the owner's (testing): made as the dev stack's owner, over HTTP, not as this player.
    if (name === "endScene") return endSceneAs(this.owner, args as LinkMoves["endScene"]);
    const reducer = this.db.reducers[name] as (args: LinkMoves[K]) => Promise<void>;
    try {
      await reducer(args);
      return undefined;
    } catch (error) {
      return rejectionOf(error);
    }
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
    this.troubled(`(The game's server is out of reach: trying again (attempt ${next})…)`);
  }

  /** The connection dropped: the SDK reconnects (`next`), or, with no next attempt, won't. */
  private lost(_error: Error | undefined, next: number | undefined): void {
    if (this.closing) return;
    if (next === undefined) { this.cut(CLOSED); return; }
    this.troubled("(Lost the game's server: reconnecting…)");
  }

  /**
   * The SDK has stopped trying, and nothing brings this session back but starting again (a reconnect
   * a server turned away with a 401 or 403: one signed by other keys, on the port). The status line
   * says so and what to do, the box stays shut, and a move is refused with the same words: the SDK
   * would answer each one "out of reach", as if it were still trying.
   */
  private cut(words: string): void {
    this.status = { trouble: words, cutOff: words };
    this.changed();
  }

  private back(): void {
    this.troubled(undefined);
  }

  /** What's wrong with the connection now (or nothing), on the status line. */
  private troubled(trouble: string | undefined): void {
    this.status = { ...this.status, trouble };
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
    const seat = [...this.db.db.mySeat.iter()][0];
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
    this.troubled(`(The game's rows stopped coming: ${why}.)`);
  }

  // -------------------------------------------------------------------------------------------
  // Rows.

  /** Every watched table's row events: told to the Replica as they come. */
  private watchTables(): void {
    const t = this.db.db;
    const tables: Array<[Watched, Observable]> = [
      ["my_seat", t.mySeat], ["my_names", t.myNames], ["my_games", t.myGames], ["my_creation", t.myCreation], ["campaign", t.campaign],
      ["game", t.game], ["player", t.player], ["sheet", t.sheet], ["scene", t.scene],
      ["transcript", t.transcript], ["reply_draft", t.replyDraft], ["turn", t.turn], ["on_stage", t.onStage], ["look", t.look],
      ["scene_suggestion", t.sceneSuggestion],
      ["chapter", t.chapter], ["quest", t.quest], ["flag", t.flag], ["journal", t.journal], ["attitude", t.attitude], ["follower", t.follower],
      ["place", t.place], ["entity", t.entity], ["position", t.position], ["area", t.area], ["material", t.material], ["health", t.health],
      ["stack", t.stack], ["surface", t.surface], ["creature", t.creature], ["player_character", t.playerCharacter], ["gear", t.gear],
      ["narrative", t.narrative], ["world_log", t.worldLog], ["map_def", t.mapDef], ["explore", t.explore],
      ["fight", t.fight], ["fight_event", t.fightEvent],
    ];
    for (const [name, table] of tables) {
      table.onInsert((_ctx, row) => this.event(name, "insert", row));
      table.onDelete((_ctx, row) => this.event(name, "delete", row));
      table.onUpdate?.((_ctx, _old, row) => this.event(name, "update", row));
    }
  }

  private event(table: Watched, op: RowOp, row: unknown): void {
    this.followSoon();
    for (const listener of this.rowListeners) listener(table, op, row);
  }

  /** The trouble, or what the set in place covers, changed: the subscriptions follow the seat, and the Replica hears of it. */
  private changed(): void {
    this.followSoon();
    for (const listener of this.statusListeners) listener(this.status);
  }

  /**
   * Once a tick, the subscriptions follow the seat: queued before the Replica hears of the change, so
   * they've followed before its listeners look, as they always have.
   */
  private followSoon(): void {
    if (this.following) return;
    this.following = true;
    queueMicrotask(() => {
      this.following = false;
      if (this.seatKnown) this.follow();
    });
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

/**
 * The seat's subscription set (v0-design §7, v5-design §3.9's scene_suggestion), the story's
 * (story-design §4.5): its tables by game, and every turn of the game (their costs are the GM's bar
 * tab at The End), not only the scene's; the world bridge's (§3.5): the place and its world; and
 * the map's (map-design §3.6): the game's places and explore rows, its campaign's maps, and the rows
 * of each of its places on a map.
 */
function queriesFor({ game, scene, place, campaign, mapPlaces }: WatchKey): string[] {
  const places = [...new Set([...(place === undefined ? [] : [place]), ...mapPlaces])];
  return [
    `SELECT * FROM game WHERE id = ${game}`,
    ...["player", "sheet", "scene", "place", "explore", "chapter", "quest", "flag", "journal", "attitude", "follower", "turn", "fight", "fight_event"].map(table => `SELECT * FROM ${table} WHERE game_id = ${game}`),
    ...(campaign === undefined ? [] : [`SELECT * FROM map_def WHERE campaign_id = '${campaign.replace(/'/g, "''")}'`]),
    ...(scene === undefined ? [] : ["transcript", "reply_draft", "on_stage", "scene_suggestion"].map(table => `SELECT * FROM ${table} WHERE scene_id = ${scene}`)),
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
