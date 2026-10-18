import { Identity, TimeDuration, Timestamp } from "spacetimedb";
import { CLIENT_TABLES, keyOf, PROTOCOL, revive, rowKey, type CallWire, type ClientTable, type MoveWire, type Rejection, type Row, type RowChange, type ToClient, type ToServer } from "../../shared/protocol/port.ts";
import type { ClientTables, Link, LinkCalls, LinkMoves, LinkStatus, RowListener } from "./link.ts";

/**
 * A link over a MessagePort (browser-design §4.1): the page's channel to its server worker, which
 * hosts the simulation without SpacetimeDB, or a test's MessageChannel. The wire is
 * shared/protocol/port.ts. The server pushes every row this player may see, so the link keeps each
 * one in a Map for its table, by its primary key, and covers the seat's rows once the snapshot is in.
 * A transaction is applied whole and only then told, row by row, as the SDK tells one; a move waits
 * for the answer with its id, which comes after its rows, on the same port. A status that cuts the
 * client off answers every move waiting, and every move after, with its words. Rows come as
 * structured clones, which leave the SDK's classes only their fields, so each row is revived on its
 * way in: a Timestamp is a Timestamp again (the title calls toMillis on one). Of the SDK, only its
 * classes: the bindings and their DbConnection are connection.ts's alone.
 */

/** What the link needs of a MessagePort: the page's, or Node's (a test's MessageChannel). */
export type MessagePortLike = Pick<MessagePort, "postMessage" | "onmessage" | "start" | "close">;

export interface PortLinkOptions {
  /** The name the server keeps this client's identity under (the page's client is "default"); without one, the server's own default. */
  session?: string;
}

/** A link over `port`, connected as `options.session`. */
export function portLink(port: MessagePortLike, options: PortLinkOptions = {}): PortLink {
  return new PortLink(port, options);
}

/** The SDK's classes a row may hold, for revive. */
const SDK_CLASSES = { Identity, Timestamp, TimeDuration };

export class PortLink implements Link {
  readonly tables: ClientTables;
  readonly ready: Promise<void>;
  /** The identity (hex) the server gave, once connected. */
  identity = "";

  private readonly port: MessagePortLike;
  private readonly stores = new Map<ClientTable, TableStore>();
  private readonly rowListeners = new Set<RowListener>();
  private readonly statusListeners = new Set<(status: LinkStatus) => void>();
  /** The moves and calls sent and not yet answered, by id: each one's resolve, with its answer's rejection and value. */
  private readonly waiting = new Map<number, (why: Rejection | undefined, value?: string) => void>();
  private nextId = 1;
  /** The snapshot is in. */
  private settled = false;
  private status: LinkStatus = {};
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;

  constructor(port: MessagePortLike, options: PortLinkOptions) {
    this.port = port;
    this.tables = this.newTables();
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    port.onmessage = event => this.receive(event.data as ToClient);
    port.start();
    this.send({ kind: "connect", protocol: PROTOCOL, ...(options.session ? { session: options.session } : {}) });
  }

  onRow(listener: RowListener): void {
    this.rowListeners.add(listener);
  }

  onStatus(listener: (status: LinkStatus) => void): void {
    this.statusListeners.add(listener);
  }

  /** Everything the server sends is everything this player may see: once the snapshot is in, so are the seat's rows. */
  covers(): boolean {
    return this.settled;
  }

  /** A move sent with an id of its own: undefined when it was made, else why not. Cut off, none is sent: the words say why. */
  move<K extends MoveWire>(name: K, args: LinkMoves[K]): Promise<Rejection | undefined> {
    if (this.status.cutOff) return Promise.resolve({ code: "error", text: this.status.cutOff });
    const id = this.nextId++;
    return new Promise(resolve => {
      this.waiting.set(id, resolve);
      this.send({ kind: "move", id, name, args });
    });
  }

  /** A procedure called with an id of its own: its text, else why not. Cut off, none is sent: the words say why. */
  call<K extends CallWire>(name: K, args: LinkCalls[K]): Promise<string | Rejection> {
    if (this.status.cutOff) return Promise.resolve({ code: "error", text: this.status.cutOff });
    const id = this.nextId++;
    return new Promise(resolve => {
      this.waiting.set(id, (rejection, value) => resolve(rejection ?? value ?? { code: "error", text: "(The game's server gave no answer.)" }));
      this.send({ kind: "call", id, name, args });
    });
  }

  /** Tells the server this client has gone (a port has no close event of its own), and stops listening. */
  close(): void {
    this.send({ kind: "disconnect" });
    this.port.onmessage = null;
    this.port.close();
  }

  private send(message: ToServer): void {
    this.port.postMessage(message);
  }

  private receive(message: ToClient): void {
    switch (message.kind) {
      case "connected": this.identity = message.identity; return;
      case "snapshot": return this.snapshot(message.tables);
      case "tx": return this.apply(message.changes);
      case "answer": return this.answer(message.id, message.rejection, message.value);
      case "status": return this.troubled(message);
    }
  }

  /** The first rows, everything this player may see: each told as an insert, as the SDK tells a subscription's rows. Then ready. */
  private snapshot(tables: Record<ClientTable, Row[]>): void {
    const changes = Object.entries(tables).flatMap(([table, rows]) => rows.map((row): RowChange => ({ table: table as ClientTable, op: "insert", row })));
    this.settled = true;
    this.apply(changes);
    this.resolveReady();
  }

  /**
   * A transaction's changes: every row in first, revived, then word of each in order, so whoever
   * hears of one sees the transaction whole. A table the client doesn't watch is passed over.
   */
  private apply(changes: RowChange[]): void {
    const mine = changes.filter(change => this.stores.has(change.table)).map(change => ({ ...change, row: revive(change.row, SDK_CLASSES) }));
    for (const { table, op, row } of mine) this.stores.get(table)!.change(op, row);
    for (const { table, op, row } of mine) for (const listener of this.rowListeners) listener(table, op, row);
  }

  private answer(id: number, rejection: Rejection | undefined, value?: string): void {
    const resolve = this.waiting.get(id);
    this.waiting.delete(id);
    resolve?.(rejection, value);
  }

  /**
   * The server's trouble, for the status line. Cut off is for good: every move waiting is answered
   * with its words (as is every move after), and before the snapshot, ready fails with them.
   */
  private troubled({ trouble, cutOff }: LinkStatus): void {
    if (this.status.cutOff) return;
    this.status = { trouble: trouble ?? cutOff, cutOff };
    if (cutOff) this.cut(cutOff);
    for (const listener of this.statusListeners) listener(this.status);
  }

  private cut(words: string): void {
    for (const id of [...this.waiting.keys()]) this.answer(id, { code: "error", text: words });
    if (!this.settled) this.rejectReady(new Error(words));
  }

  /**
   * The tables by the bindings' accessors, as the Replica reads them: each one's rows, and found by
   * its primary key under the key's own name (game.id, sheet.playerId, explore.playerId…).
   */
  private newTables(): ClientTables {
    const tables: Record<string, unknown> = {};
    for (const [name, { accessor, key }] of Object.entries(CLIENT_TABLES)) {
      const store = new TableStore(name as ClientTable);
      this.stores.set(name as ClientTable, store);
      tables[accessor] = { iter: () => store.iter(), [key]: { find: (value: unknown) => store.find(value) } };
    }
    return tables as unknown as ClientTables;
  }
}

/** One table's rows by their primary key, as the server last sent them. */
class TableStore {
  private readonly rows = new Map<string, Row>();
  private readonly table: ClientTable;

  constructor(table: ClientTable) {
    this.table = table;
  }

  iter(): Iterable<Row> {
    return this.rows.values();
  }

  find(value: unknown): Row | undefined {
    return this.rows.get(keyOf(value));
  }

  change(op: RowChange["op"], row: Row): void {
    if (op === "delete") this.rows.delete(rowKey(this.table, row));
    else this.rows.set(rowKey(this.table, row), row);
  }
}
