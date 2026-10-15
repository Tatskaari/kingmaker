import { onChange, peek, requeue, restore, takeChanges } from "./node/fs.ts";

/**
 * runs/ kept in IndexedDB, from the worker (as V1 kept its games, in apps/web/src/game-worker.ts):
 * every file the game writes under runs/ (saves, notes, call logs) is written through to the
 * "kingmaker-v2" database's "files" store a moment after it changes, and read back into the
 * browser's file system before the game starts. (V1's database is "kingmaker", on the same origin
 * as these previews; V2 keeps out of it rather than upgrading it under V1.)
 */

const DB = "kingmaker-v2";
const STORE = "files";
const DELAY_MS = 150;
const MAX_DELAY_MS = 1000;

interface FileRecord { path: string; data: string | Uint8Array; mtimeMs: number }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "path" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB wouldn't open"));
    request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
}

export class Store {
  private db: IDBDatabase;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private firstChange = 0;
  private writing: Promise<void> = Promise.resolve();
  /** How many writes have been made (for the checks). */
  writes = 0;
  onError: (error: unknown) => void = error => console.error("Couldn't save to IndexedDB:", error);

  private constructor(db: IDBDatabase) { this.db = db; }

  static async open(): Promise<Store> { return new Store(await open()); }

  /** Everything saved, back into the file system. */
  async load(): Promise<number> {
    const records = await new Promise<FileRecord[]>((resolve, reject) => {
      const request = this.db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as FileRecord[]);
      request.onerror = () => reject(request.error);
    });
    restore(records);
    return records.length;
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
      tx.oncomplete = () => { this.writes++; resolve(); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("The save was aborted"));
    }).catch(error => {
      requeue(changes);
      throw error;
    });
  }
}
