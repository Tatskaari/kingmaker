import { Identity, TimeDuration, Timestamp } from "spacetimedb";
import type { Persistence } from "../../ai/service/memory-stores.ts";
import { revive } from "../../shared/protocol/port.ts";
import type { ChangeSet, Restore, Row } from "../../simulation/src/host/memory.ts";
import { TABLES, type TableName } from "../../simulation/src/tables.ts";
import { aiPersistence } from "./ai-store.ts";
import { metaOf, type Database, type Records, type StorageNotice } from "./database.ts";
import { randomIdentity } from "./random.ts";
import { writeBehind, type Keeping, type WriteBehind } from "./write-behind.ts";

/**
 * What the page host keeps between runs (browser-design §5), in the page's database: the
 * simulation's rows (the SimStore) and the AI service's stores (ai-store.ts), written behind
 * together, so each flush is one transaction across both, and flushed now when the page asks.
 *
 * The SimStore keeps each committed transaction as its change set says: every row's last state, by
 * [table, key] (a delete deletes it), public and private, and the autoInc counters, so the next run
 * restores exactly the rows committed and its ids carry on. Beside them, in meta: `database`, the
 * database's own identity (tx.database(), minted when it's made); `sessions`, each session's
 * identity by its name (minted the first time it's asked for); `campaign`, the hash of the campaign
 * the simulation last installed; `sequences`, the counters; and `dataVersion`.
 */

/**
 * What the records mean: bump it when a table changes in a way a restore can't mend (a column
 * renamed or retyped: one added takes its default, tables.ts), so a browser's saves from before are
 * cleared rather than misread. Every push to a PR's preview reads the same database.
 */
export const DATA_VERSION = 1;

export interface Storage {
  sim: SimStore;
  /** The AI service's stores' persistence (memoryStores takes it), with what they kept. */
  ai: Persistence;
  /** Everything handed in so far, written now, in one transaction. */
  flush(): Promise<void>;
  /** Everything handed in so far, written, and nothing after it: another tab has the game. */
  close(): Promise<void>;
}

export interface SimStore {
  /** The rows and counters the last run committed, revived, as memoryHost's restore takes them; none for a new database. */
  readonly restore: Restore | undefined;
  /** The database's own identity (tx.database()). */
  readonly database: Identity;
  /** The hash of the campaign the simulation last installed (content.ts's campaignHash), if it has. */
  readonly installed: string | undefined;
  /** The identity a session's name stands for: minted, and kept, the first time it's asked for. */
  session(name: string): Identity;
  /** A committed transaction, kept (memoryHost's onCommit). */
  write(commit: ChangeSet): void;
  /** The campaign the simulation has installed now, by its hash. */
  markInstalled(hash: string): void;
}

type Sequences = NonNullable<Restore["sequences"]>;

/** The SDK's classes a kept row may hold, for revive. */
const SDK_CLASSES = { Identity, Timestamp, TimeDuration };

/** Both stores over the page's database, starting from what it kept (or from nothing, when this build can't read that: said, or cleared). */
export async function openStorage(database: Database, notice: StorageNotice): Promise<Storage> {
  const records = await readBack(database, notice);
  const queue = writeBehind(database, keepingFor(notice));
  if (metaOf(records).get("dataVersion") === undefined) queue.put("meta", "dataVersion", DATA_VERSION);

  return { sim: simStore(queue, records), ai: aiPersistence(queue, records, database), flush: queue.flush, close: queue.close };
}

/**
 * What the database kept, as this build reads it: all of it; or nothing, when an older build made
 * it (it's cleared) or it can't be read (the page is told, and the game is kept as it goes).
 */
async function readBack(database: Database, notice: StorageNotice): Promise<Records> {
  let records: Records;
  try {
    records = await database.read();
  } catch (error) {
    console.warn("Couldn't read the saved games back from IndexedDB:", error);
    notice(false, "This browser couldn't read back the games it kept; this one is kept as it goes.");
    return nothingKept();
  }
  const version = metaOf(records).get("dataVersion");
  if (version === DATA_VERSION || Object.values(records).every(store => !store.length)) return records;

  console.warn(`The games kept here are an older build's (data version ${String(version)}, this build's ${DATA_VERSION}): they're cleared.`);
  await database.clear();
  return nothingKept();
}

const nothingKept = (): Records => ({ rows: [], meta: [], answers: [], docs: [] });

/** The page told when a write fails (the game plays on, and the next write tries again), and when one goes in after. */
function keepingFor(notice: StorageNotice): Keeping {
  return {
    failed(error) {
      console.warn(`This browser wouldn't keep the game just now (${(error as Error)?.message ?? String(error)}); it will try again.`);
      notice(false, "This browser wouldn't save the game just now (is its storage full?). Still trying.");
    },
    keptAgain: () => notice(true),
  };
}

function simStore(queue: WriteBehind, records: Records): SimStore {
  const meta = metaOf(records);
  const sequences: Sequences = { ...(meta.get("sequences") as Sequences | undefined) };
  const sessions: Record<string, string> = { ...(meta.get("sessions") as Record<string, string> | undefined) };
  let installed = meta.get("campaign") as string | undefined;

  return {
    restore: restoreOf(queue, records.rows, sequences),
    database: identityKept(queue, meta.get("database")),
    get installed() { return installed; },
    session(name) {
      const known = sessions[name];
      if (known) return Identity.fromString(known);
      const minted = randomIdentity();
      sessions[name] = minted.toHexString();
      queue.put("meta", "sessions", { ...sessions });
      return minted;
    },
    write(commit) {
      for (const { table, key, op, row } of commit.changes) {
        if (op === "delete") queue.delete("rows", [table, key]);
        else queue.put("rows", [table, key], row);
      }
      if (!Object.keys(commit.sequences).length) return;
      Object.assign(sequences, commit.sequences);
      queue.put("meta", "sequences", { ...sequences });
    },
    markInstalled(hash) {
      installed = hash;
      queue.put("meta", "campaign", hash);
    },
  };
}

/**
 * The rows kept, by table and revived, with the counters, as a restore takes them (in any order: it
 * sorts them, and fills the columns added since). A table this build hasn't got is dropped, and its
 * rows deleted. No rows: a new database, which init makes.
 */
function restoreOf(queue: WriteBehind, kept: Records["rows"], sequences: Sequences): Restore | undefined {
  if (!kept.length) return undefined;
  const rows: Partial<Record<TableName, Row[]>> = {};
  for (const [key, row] of kept) {
    const [table] = key as [string, string];
    if (table in TABLES) (rows[table as TableName] ??= []).push(revive(row as Row, SDK_CLASSES));
    else queue.delete("rows", key);
  }
  return { rows, sequences };
}

/** The database's identity as kept, or one minted for a new database (and kept). */
function identityKept(queue: WriteBehind, kept: unknown): Identity {
  if (typeof kept === "string") return Identity.fromString(kept);
  const minted = randomIdentity();
  queue.put("meta", "database", minted.toHexString());
  return minted;
}
