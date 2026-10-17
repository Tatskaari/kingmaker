import type { Database, RecordKey, StoreName, Write } from "./database.ts";

/**
 * Writes to the page's database a moment after they're made, as the prototype's persist.ts writes
 * its files through (src/web/static/persist.ts at 8f21717): 150 ms after the last, and at least once
 * a second while they keep coming. Each flush is one transaction with everything waiting, so what's
 * kept is always whole commits (a commit's writes are all handed in at once), with the AI service's
 * docs and answers beside them. The last write to a record wins. A flush that fails leaves its writes
 * to go with the next (unless a newer one for the record has come since), and says so; the next one
 * that goes in says the game is kept again. Closed (another tab has the game), it takes no more.
 */

export interface WriteBehind {
  put(store: StoreName, key: RecordKey, value: unknown): void;
  delete(store: StoreName, key: RecordKey): void;
  /** Everything handed in so far, written now: resolves once it's in, or has failed (which the Keeping hears). */
  flush(): Promise<void>;
  /** Everything handed in so far, written, and nothing after it. */
  close(): Promise<void>;
}

/** What hears how the writes go: one failed (its writes go with the next), or one went in after one that failed. */
export interface Keeping {
  failed(error: unknown): void;
  keptAgain(): void;
}

const DELAY_MS = 150;
const MAX_DELAY_MS = 1000;

export function writeBehind(database: Database, keeping: Keeping): WriteBehind {
  let waiting = new Map<string, Write>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstAt = 0;
  let writing: Promise<void> = Promise.resolve();
  let failing = false;
  let closed = false;

  const add = (write: Write) => {
    if (closed) return;
    waiting.set(idOf(write), write);
    flushSoon();
  };

  /** A flush 150 ms on, put off by each write after it until a second after the first. */
  const flushSoon = () => {
    const now = Date.now();
    if (!timer) firstAt = now;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), Math.max(0, Math.min(DELAY_MS, MAX_DELAY_MS - (now - firstAt))));
  };

  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    writing = writing.then(writeWaiting);
    return writing;
  };

  /** Everything waiting, in one transaction; if it fails, back in the queue under anything newer, and said. */
  const writeWaiting = async (): Promise<void> => {
    const batch = waiting;
    waiting = new Map();
    if (!batch.size) return;
    try {
      await database.write([...batch.values()]);
    } catch (error) {
      for (const [id, write] of batch) if (!waiting.has(id)) waiting.set(id, write);
      failing = true;
      keeping.failed(error);
      return;
    }
    if (failing) {
      failing = false;
      keeping.keptAgain();
    }
  };

  return {
    put: (store, key, value) => add({ store, key, value }),
    delete: (store, key) => add({ store, key }),
    flush,
    close() {
      closed = true;
      return flush();
    },
  };
}

const idOf = ({ store, key }: Write) => `${store}\u0000${JSON.stringify(key)}`;
