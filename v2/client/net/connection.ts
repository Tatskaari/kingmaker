import { setGlobalLogLevel } from "spacetimedb";
import { refusal, refusalIn } from "../../shared/protocol/refusals.ts";
import type { Backend, NewGame, Rejection } from "../backend.ts";
import { DbConnection, type SubscriptionHandle } from "../module_bindings/index.ts";
import type { SeatView } from "../module_bindings/types.ts";
import { sceneViewOf, type SceneRows } from "../scene/rows.ts";
import type { SceneView } from "../scene/view.ts";

/**
 * The client's way into the simulation (v0-design §7), and the e2e's: a SpacetimeDB connection
 * that follows the seat. It subscribes to my_seat and my_names; whenever the seat moves (a new
 * game, a join) it subscribes to that game's, scene's and place's rows, and only then drops the
 * old set, so nothing blinks out. Each row change rebuilds the scene's rows from the client's
 * cache, once a tick; each row event also goes, in arrival order, to whoever listens. The moves
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
}

/** The tables and views a client watches, by their SQL names. */
export type Watched = "my_seat" | "my_names" | "game" | "player" | "sheet" | "scene" | "transcript" | "reply_draft" | "turn" | "on_stage" | "look";
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

/** What the seat's subscription set covers: the game, its scene, the place whose looks to read. */
interface WatchKey { game: bigint; scene?: bigint; place?: bigint }
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
  /** my_seat is in: the seat (or that there's none) is known. */
  private seatKnown = false;
  private settled = false;
  private pending = false;
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
      ...(this.refused ? { refusal: this.refused } : {}),
      ...(this.trouble ? { trouble: this.trouble } : {}),
    };
  }

  view(): SceneView | undefined {
    const rows = this.rows();
    return rows && sceneViewOf(rows);
  }

  /** The caller's seat (my_seat): its player, game, place and scene; undefined when it has none. */
  seat(): SeatView | undefined {
    return [...this.db.db.mySeat.iter()][0];
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

  /** Carries the failed turn on: the one holding the scene's lease. */
  retry(): Promise<Rejection | undefined> {
    const turn = this.rows()?.scene.turnId;
    return turn === undefined ? Promise.resolve(refusal("not_failed")) : this.retryTurn(turn);
  }

  retryTurn(turn: bigint): Promise<Rejection | undefined> {
    return this.move(() => this.db.reducers.retryTurn({ turn }));
  }

  close(): void {
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

  private failedToConnect(options: ConnectOptions, error: Error, next: number | undefined): void {
    if (!this.settled) { void whyNot(options, error).then(why => this.rejectReady(new Error(why))); return; }
    this.trouble = `(The game's server is out of reach: trying again${next ? ` (attempt ${next})` : ""}…)`;
    this.changed();
  }

  private lost(error: Error | undefined, next: number | undefined): void {
    this.trouble = next === undefined ? `(The connection to the game's server closed${error ? `: ${error.message}` : ""}.)` : "(Lost the game's server: reconnecting…)";
    this.changed();
  }

  private back(): void {
    this.trouble = undefined;
    this.changed();
  }

  // -------------------------------------------------------------------------------------------
  // Following the seat.

  /** The caller's own views: always watched. Once they're in, the seat's rows follow. */
  private watchSeat(): void {
    this.db.subscriptionBuilder()
      .onApplied(() => { this.seatKnown = true; this.follow(); this.readyOnceIn(); })
      .onError(ctx => this.subscriptionFailed(ctx.event))
      .subscribe(["SELECT * FROM my_seat", "SELECT * FROM my_names"]);
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
    return { game: seat.gameId, ...(seat.sceneId !== undefined ? { scene: seat.sceneId } : {}), ...(place !== undefined ? { place } : {}) };
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

  /** Ready once the seat is known and its rows are in, or there's no seat. */
  private readyOnceIn(): void {
    if (this.settled || !this.seatKnown || (this.watching && !this.watching.handle.isActive())) return;
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
      ["my_seat", t.mySeat], ["my_names", t.myNames], ["game", t.game], ["player", t.player], ["sheet", t.sheet], ["scene", t.scene],
      ["transcript", t.transcript], ["reply_draft", t.replyDraft], ["turn", t.turn], ["on_stage", t.onStage], ["look", t.look],
    ];
    for (const [name, table] of tables) {
      table.onInsert((_ctx, row) => this.event(name, "insert", row));
      table.onDelete((_ctx, row) => this.event(name, "delete", row));
      table.onUpdate?.((_ctx, _old, row) => this.event(name, "update", row));
    }
  }

  private event(table: Watched, op: RowOp, row: unknown): void {
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

  /** A reducer called: undefined when it was made; else why not, and the words kept for the status line until the next move. */
  private async move(call: () => Promise<void>): Promise<Rejection | undefined> {
    this.refused = undefined;
    this.changed();
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

/** A table's row callbacks, as every watched table and view has them (onUpdate on those with a primary key). */
interface Observable {
  onInsert(cb: (ctx: unknown, row: unknown) => void): void;
  onDelete(cb: (ctx: unknown, row: unknown) => void): void;
  onUpdate?(cb: (ctx: unknown, old: unknown, row: unknown) => void): void;
}

/** The seat's subscription set (v0-design §7). */
function queriesFor({ game, scene, place }: WatchKey): string[] {
  return [
    `SELECT * FROM game WHERE id = ${game}`,
    ...["player", "sheet", "scene"].map(table => `SELECT * FROM ${table} WHERE game_id = ${game}`),
    ...(scene === undefined ? [] : ["transcript", "reply_draft", "turn", "on_stage"].map(table => `SELECT * FROM ${table} WHERE scene_id = ${scene}`)),
    ...(place === undefined ? [] : [`SELECT * FROM look WHERE place_id = ${place}`]),
  ];
}

const sameKey = (a: WatchKey | undefined, b: WatchKey | undefined) => a?.game === b?.game && a?.scene === b?.scene && a?.place === b?.place;

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
