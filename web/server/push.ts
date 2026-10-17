import type { Identity } from "spacetimedb";
import { CLIENT_VIEWS, PUBLIC_TABLES, rowKey, type ClientTable, type ClientView, type PublicTable, type Row, type RowChange, type ToClient } from "../../shared/protocol/port.ts";
import type { ChangeSet, MemoryHost } from "../../simulation/src/host/memory.ts";

/**
 * What each client is sent of the simulation's rows (browser-design §3, shared/protocol/port.ts):
 * everything it may see, pushed rather than asked for, since one browser holds one player's games
 * (a host on a network would filter by subscription). A client joining is sent a snapshot: every row
 * of the public tables, and its own four views, made for its identity. Then each committed
 * transaction is one tx: the commit's net change to the public tables (the memory host's change set,
 * by the tables' SQL names), then each view's change by its key, the views made again and set
 * against what the client was sent last. A commit with nothing in it for a client sends it nothing.
 * Commits are told as they're made (the memory host's onCommit), so a move's tx goes out before its
 * answer. An update's old row isn't sent: nothing on the client reads it.
 */

export interface Push {
  /** A client's rows from now on: its snapshot sent now, and a tx for each commit after. Returns its leaving. */
  join(identity: Identity, send: (message: ToClient) => void): () => void;
  /** A committed transaction, to every client. */
  commit(changes: ChangeSet): void;
}

/** Each view's rows as a client was sent them, by their keys. */
type Views = Record<ClientView, Map<string, Row>>;

interface Client { identity: Identity; send(message: ToClient): void; views: Views }

/** Each public table's SQL name by its accessor (the change set's name for it). */
const SQL_NAMES = new Map(Object.entries(PUBLIC_TABLES).map(([sql, { accessor }]) => [accessor as string, sql as PublicTable]));

export function pushTo(sim: MemoryHost): Push {
  const clients = new Set<Client>();
  return {
    join(identity, send) {
      const client: Client = { identity, send, views: viewsOf(sim, identity) };
      send({ kind: "snapshot", tables: snapshotOf(sim, client.views) });
      clients.add(client);
      return () => { clients.delete(client); };
    },
    commit(changes) {
      const shared = publicChanges(changes);
      for (const client of clients) sendTx(client, [...shared, ...viewChanges(client, viewsOf(sim, client.identity))]);
    },
  };
}

/** Every row of the public tables, and the client's views as they were just made. */
function snapshotOf(sim: MemoryHost, views: Views): Record<ClientTable, Row[]> {
  const db = sim.db as unknown as Record<string, { iter(): Iterable<Row> }>;
  const tables = Object.entries(PUBLIC_TABLES).map(([sql, { accessor }]) => [sql, [...db[accessor]!.iter()]]);
  const own = Object.entries(views).map(([view, rows]) => [view, [...rows.values()]]);
  return Object.fromEntries([...tables, ...own]) as Record<ClientTable, Row[]>;
}

/** A commit's changes to the public tables, by their SQL names: no private table's ever crosses. */
function publicChanges(commit: ChangeSet): RowChange[] {
  return commit.changes.flatMap(({ table, op, row }) => {
    const sql = SQL_NAMES.get(table);
    return sql ? [{ table: sql, op, row }] : [];
  });
}

/** The four views made for a caller, each by its rows' keys (my_seat and my_creation: a row or none). */
function viewsOf(sim: MemoryHost, identity: Identity): Views {
  const made = sim.view(identity);
  const rows: Record<ClientView, unknown[]> = {
    my_seat: listOf(made.mySeat()), my_names: made.myNames(), my_games: made.myGames(), my_creation: listOf(made.myCreation()),
  };
  return Object.fromEntries(Object.entries(rows).map(([view, list]) => [view, new Map((list as Row[]).map(row => [rowKey(view as ClientView, row), row]))])) as Views;
}

const listOf = <T>(row: T | undefined): T[] => (row === undefined ? [] : [row]);

/** How the client's views have changed since it was last sent them, by their keys; what it's sent is now these. */
function viewChanges(client: Client, now: Views): RowChange[] {
  const changes = (Object.keys(CLIENT_VIEWS) as ClientView[]).flatMap(view => changesIn(view, client.views[view], now[view]));
  client.views = now;
  return changes;
}

function changesIn(view: ClientView, was: Map<string, Row>, now: Map<string, Row>): RowChange[] {
  const changes: RowChange[] = [];
  for (const [key, row] of now) {
    const old = was.get(key);
    if (!old) changes.push({ table: view, op: "insert", row });
    else if (!same(old, row)) changes.push({ table: view, op: "update", row });
  }
  for (const [key, row] of was) if (!now.has(key)) changes.push({ table: view, op: "delete", row });
  return changes;
}

function sendTx(client: Client, changes: RowChange[]): void {
  if (changes.length) client.send({ kind: "tx", changes });
}

/** Whether two rows hold the same values all through (an Identity or a Timestamp by its field). */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const columns = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...columns].every(column => same((a as Row)[column], (b as Row)[column]));
}
