/**
 * The page's database (browser-design §5): one for the simulation's rows and the AI service's
 * stores, so that one transaction keeps a commit's rows with the docs its think wrote. IndexedDB in
 * a browser; in memory where the browser won't keep anything (a private window), and in the tests,
 * which rebuild a server from it. Either way a record is kept as a structured clone, which leaves
 * the SDK's classes only their fields, so what's read back is revived (shared/protocol/port.ts).
 *
 * Its stores:
 * - `rows`: every table's rows, public and private, by [table, key] (the memory host's change set key);
 * - `meta`: the page host's own records by name (sim-store.ts and ai-store.ts say which);
 * - `answers`: the AI service's kept answers, by idempotency key;
 * - `docs`: each game's copy of the lore, by [game, path];
 * - `logs`: each game's call log and memory reviews, by [game, log, n]: written as they go, and read
 *   back only for a report of a problem (`logs`).
 */

export const STORES = ["rows", "meta", "answers", "docs", "logs"] as const;
export type StoreName = (typeof STORES)[number];

/** The stores read back as the page host starts: all but the logs. */
export type ReadStore = Exclude<StoreName, "logs">;
const READ: ReadStore[] = ["rows", "meta", "answers", "docs"];

/** A record's key: a name, or a tuple of names and numbers ([table, key], [game, path], [game, log, n]). */
export type RecordKey = string | Array<string | number>;

/** A record put, with its value, or deleted, without one. */
export interface Write { store: StoreName; key: RecordKey; value?: unknown }

/** Each read store's records, as [key, value] pairs. */
export type Records = Record<ReadStore, Array<[RecordKey, unknown]>>;

export interface Database {
  /** Every record of the stores read back, in one go. */
  read(): Promise<Records>;
  /** Puts and deletes in one transaction: all of them kept, or none. */
  write(writes: Write[]): Promise<void>;
  /** Every record of every store gone. */
  clear(): Promise<void>;
  /** A game's call log or memory reviews, oldest first (a report's: the AI service's GET /v1/games/{game}/calls). */
  logs(game: string, log: string): Promise<Array<Record<string, unknown>>>;
}

/** How the page hears whether the browser is keeping the game: not (and why, in words for it), or again. */
export type StorageNotice = (ok: boolean, message?: string) => void;

/** The meta store's records, by name. */
export function metaOf(records: Records): Map<string, unknown> {
  return new Map(records.meta.map(([key, value]) => [String(key), value]));
}

/** The IndexedDB schema's version: its stores. (What the records mean is sim-store.ts's DATA_VERSION.) */
const VERSION = 1;
/** How long IndexedDB has to open the database: one that hasn't answered by then counts as none (it happens: Safari 14 shipped it). */
const OPEN_TIMEOUT_MS = 5000;

/**
 * The page's database: IndexedDB's, or one in memory when the browser won't keep anything here (a
 * private window, the site's data blocked, no answer in time), which the page is told.
 */
export async function pageDatabase(name: string, notice: StorageNotice): Promise<Database> {
  try {
    return await openIndexedDb(name);
  } catch (error) {
    console.warn("No IndexedDB here, so this game won't be kept:", error);
    notice(false, /didn't answer/.test(String((error as Error)?.message))
      ? "This browser's storage didn't answer, so this game won't be kept."
      : "This browser won't keep games here: this one goes when the page closes.");
    return memoryDatabase();
  }
}

/** A database in memory: a Map by key for each store, each value a structured clone, as IndexedDB keeps it. Nothing of it outlives the page. */
export function memoryDatabase(): Database {
  const stores = new Map(STORES.map(name => [name, new Map<string, [RecordKey, unknown]>()]));
  const store = (name: StoreName) => stores.get(name)!;
  return {
    async read() {
      return Object.fromEntries(READ.map(name => [name, [...store(name).values()].map(([key, value]) => [key, structuredClone(value)])])) as Records;
    },
    async write(writes) {
      // Every value cloned before any is kept: one that can't be refuses the whole write, as a transaction does.
      const cloned = writes.map(write => ({ ...write, value: structuredClone(write.value) }));
      for (const { store: name, key, value } of cloned) {
        if (value === undefined) store(name).delete(JSON.stringify(key));
        else store(name).set(JSON.stringify(key), [key, value]);
      }
    },
    async clear() {
      for (const records of stores.values()) records.clear();
    },
    async logs(game, log) {
      const mine = [...store("logs").values()].filter(([key]) => Array.isArray(key) && key[0] === game && key[1] === log);
      return mine.sort(([a], [b]) => Number((a as unknown[])[2]) - Number((b as unknown[])[2])).map(([, line]) => structuredClone(line) as Record<string, unknown>);
    },
  };
}

/** The database in IndexedDB, by its name, its stores made the first time: the browser's own, or a test's (fake-indexeddb's, with its key ranges). */
export async function openIndexedDb(name: string, factory: IDBFactory = globalThis.indexedDB, timeoutMs = OPEN_TIMEOUT_MS, keyRange: typeof IDBKeyRange = globalThis.IDBKeyRange): Promise<Database> {
  const db = await open(factory, name, timeoutMs);
  return {
    read: () => readAll(db),
    write: writes => (writes.length ? inTransaction(db, [...new Set(writes.map(write => write.store))], tx => writeAll(tx, writes)) : Promise.resolve()),
    clear: () => inTransaction(db, [...STORES], tx => { for (const name of STORES) tx.objectStore(name).clear(); }),
    logs: (game, log) => logsOf(db, keyRange, game, log),
  };
}

/** A game's log, its lines by [game, log, n] in n's order (IndexedDB sorts an array key element by element). */
async function logsOf(db: IDBDatabase, keyRange: typeof IDBKeyRange, game: string, log: string): Promise<Array<Record<string, unknown>>> {
  const range = keyRange.bound([game, log, 0], [game, log, Number.MAX_SAFE_INTEGER]);
  return (await requested(db.transaction("logs", "readonly").objectStore("logs").getAll(range))) as Array<Record<string, unknown>>;
}

/**
 * Opens the database, as the prototype's persist.ts opens its own (src/web/static/persist.ts at
 * 8f21717, its open()): one that hasn't answered in time, is blocked by another tab, or answers too
 * late counts as none. Here it makes the page host's stores on its upgrade.
 */
function open(factory: IDBFactory, name: string, timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (done: () => void) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      done();
      return true;
    };
    const timer = setTimeout(() => settle(() => reject(new Error(`IndexedDB didn't answer in ${timeoutMs / 1000} s`))), timeoutMs);
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, VERSION);
    } catch (error) {
      settle(() => reject(error));
      return;
    }
    request.onupgradeneeded = () => {
      for (const store of STORES) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
    };
    // One that answers after the time is up isn't used.
    request.onsuccess = () => { if (!settle(() => resolve(request.result))) request.result.close(); };
    request.onerror = () => settle(() => reject(request.error ?? new Error("IndexedDB wouldn't open")));
    request.onblocked = () => settle(() => reject(new Error("IndexedDB is blocked by another tab")));
  });
}

/** Every record of the read stores, in one readonly transaction (each store's requests made at once, so it stays open for them). */
async function readAll(db: IDBDatabase): Promise<Records> {
  const tx = db.transaction(READ, "readonly");
  const stores = await Promise.all(READ.map(async name => {
    const store = tx.objectStore(name);
    const [keys, values] = await Promise.all([requested(store.getAllKeys()), requested(store.getAll())]);
    return [name, keys.map((key, i) => [key as RecordKey, values[i]])] as const;
  }));
  return Object.fromEntries(stores) as Records;
}

function writeAll(tx: IDBTransaction, writes: Write[]): void {
  for (const { store, key, value } of writes) {
    if (value === undefined) tx.objectStore(store).delete(key);
    else tx.objectStore(store).put(value, key);
  }
}

/** A readwrite transaction over the stores named, its work done in it: resolves once it's committed, rejects when it's aborted (work that throws aborts it, so nothing of it is kept). */
function inTransaction(db: IDBDatabase, stores: StoreName[], work: (tx: IDBTransaction) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB refused the write"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB aborted the write"));
    try {
      work(tx);
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}

const requested = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
