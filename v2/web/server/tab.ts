// Copied from the prototype's src/web/static/worker.ts at 8f21717: claim() (its lines 155-174), as the page host's tab: the lock's name and the locks handed in, busy told to whoever asks, and the lock let go of when another tab takes the game over (release), where the prototype holds it until its worker ends.

/**
 * One tab at a time plays from the page's database (browser-design §5): each server worker holds its
 * own copy of the rows, and the last to write a record wins, so a second tab playing its stale copy
 * would undo the first one's progress. A server worker holds a Web Lock named as its database is,
 * for as long as it plays. One that finds the lock held says so (busy, with the name of the
 * BroadcastChannel the page asks the other tab on) and waits for it; the tab holding it hears that,
 * saves its game and lets go (release). Without Web Locks (an older browser, or a page that isn't
 * https or localhost), every tab plays its own copy.
 */

export interface Tab {
  /** The lock let go of: the tab waiting for it plays. */
  release(): void;
}

/** How long a tab waits for the lock before it says it's busy: a tab being reloaded lets go as its old page goes. */
const GRACE_MS = 1500;

/** Resolves once this worker holds the lock, which it keeps until it lets go. */
export async function claimTab(name: string, busy: (channel: string) => void, locks: LockManager | undefined = (navigator as { locks?: LockManager }).locks, graceMs = GRACE_MS): Promise<Tab> {
  let release = () => {};
  const held = () => new Promise<void>(resolve => { release = resolve; });
  const tab = { release: () => release() };
  if (!locks) return tab;
  try {
    const wait = new AbortController();
    const timer = setTimeout(() => wait.abort(), graceMs);
    const got = await new Promise<boolean>(resolve => {
      locks.request(name, { signal: wait.signal }, () => { clearTimeout(timer); resolve(true); return held(); }).catch(() => resolve(false));
    });
    if (got) return tab;
    busy(name);
    await new Promise<void>(resolve => { locks.request(name, () => { resolve(); return held(); }).catch(() => resolve()); });
  } catch (error) {
    // Locks refused outright (a sandboxed page, say): as without them.
    console.warn("No Web Locks here, so another tab could play the same saves:", error);
  }
  return tab;
}
