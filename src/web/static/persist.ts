import { onChange, peek, PERSISTED, requeue, restore, takeChanges } from "./node/fs.ts";

/**
 * runs/ kept in IndexedDB, from the worker (as V1 kept its games, in apps/web/src/game-worker.ts):
 * every file the game writes under runs/ (saves, notes, call logs) is written through to the
 * database's "files" store a moment after it changes, and read back into the browser's file system
 * before the game starts.
 *
 * Each place the game is published has a database of its own, named after its site's path (dbName;
 * the game is at play/ in it): a PR preview's games are its own, as another preview's build may not read them, or may rewrite them
 * as it reads them. (V1's database is "kingmaker", on the same origin as these previews; V2 keeps
 * out of it.)
 *
 * Deleted games (runs/deleted/, where x x on the title moves them) are deleted for good the next
 * time the game starts: in a browser nobody can go and look at them, and they'd be read back into
 * the worker every time.
 */

const STORE = "files";
const DELAY_MS = 150;
const MAX_DELAY_MS = 1000;
const DELETED = `${PERSISTED}/deleted/`;

/** The database for the game published in the site at `base` (its path, as "/kingmaker/pr-preview/pr-650/"; the game is at play/ under it). */
export const dbName = (base: string) => `kingmaker-v2 ${base}`;

interface FileRecord { path: string; data: string | Uint8Array; mtimeMs: number }

/** Opens the database; an IndexedDB that hasn't answered in `timeoutMs` (it happens: Safari 14 shipped it) counts as none. */
function open(name: string, timeoutMs: number): Promise<IDBDatabase> {
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
      request = indexedDB.open(name, 1);
    } catch (error) {
      settle(() => reject(error));
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "path" });
    };
    // One that answers after the time is up isn't used.
    request.onsuccess = () => { if (!settle(() => resolve(request.result))) request.result.close(); };
    request.onerror = () => settle(() => reject(request.error ?? new Error("IndexedDB wouldn't open")));
    request.onblocked = () => settle(() => reject(new Error("IndexedDB is blocked by another tab")));
  });
}

const done = (request: IDBRequest) => new Promise<void>((resolve, reject) => {
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
});

export class Store {
  private db: IDBDatabase;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private firstChange = 0;
  private writing: Promise<void> = Promise.resolve();
  /** How many writes have been made (for the checks). */
  writes = 0;
  onError: (error: unknown) => void = error => console.error("Couldn't save to IndexedDB:", error);
  /** Each write that went in (after one that didn't, the game is being kept again). */
  onSaved: () => void = () => {};

  private constructor(db: IDBDatabase) { this.db = db; }

  static async open(name: string, timeoutMs = 5000): Promise<Store> { return new Store(await open(name, timeoutMs)); }

  /** Everything saved, back into the file system (but the deleted games, which go for good). */
  async load(): Promise<number> {
    const tx = this.db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const read = (range: IDBKeyRange) => new Promise<FileRecord[]>((resolve, reject) => {
      const request = store.getAll(range);
      request.onsuccess = () => resolve(request.result as FileRecord[]);
      request.onerror = () => reject(request.error);
    });
    // Keys are paths, so runs/deleted/ is one range of them, and everything else is either side of it.
    const records = (await Promise.all([read(IDBKeyRange.upperBound(DELETED, true)), read(IDBKeyRange.lowerBound(`${DELETED}￿`))])).flat();
    restore(records);
    void this.forget(DELETED);
    return records.length;
  }

  /** Every record under a path, gone (best effort: they're tried again next time). */
  private async forget(prefix: string): Promise<void> {
    try {
      await done(this.db.transaction(STORE, "readwrite").objectStore(STORE).delete(IDBKeyRange.bound(prefix, `${prefix}￿`)));
    } catch (error) {
      console.warn("Couldn't clear the deleted games out of IndexedDB:", error);
    }
  }

  /** Write changes through, a moment after they come (and at least once a second while they keep coming). */
  autosave(): void {
    onChange(() => {
      const now = Date.now();
      if (!this.timer) this.firstChange = now;
      clearTimeout(this.timer);
      const wait = Math.max(0, Math.min(DELAY_MS, MAX_DELAY_MS - (now - this.firstChange)));
      this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, wait);
    });
  }

  /** Write what's changed now; resolves when it's in IndexedDB. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const next = this.writing.then(() => this.write()).catch(error => this.onError(error));
    this.writing = next;
    return next;
  }

  /** A write that fails (the browser's storage full, say) leaves its changes to be tried again with the next. */
  private write(): Promise<void> {
    const changes = takeChanges();
    if (!changes.size) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const [path, change] of changes) {
        const file = change === "put" ? peek(path) : undefined;
        if (file) store.put({ path, data: file.data, mtimeMs: file.mtimeMs });
        else store.delete(path);
      }
      tx.oncomplete = () => { this.writes++; resolve(); this.onSaved(); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("The save was aborted"));
    }).catch(error => {
      requeue(changes);
      throw error;
    });
  }
}
