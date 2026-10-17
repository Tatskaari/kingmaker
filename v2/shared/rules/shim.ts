/**
 * What the rules engine's bundle (vendor/dnd-srd-engine) needs of its host, set up as this file
 * loads: import it before the bundle, which ES modules then evaluate after it (the module's bundler
 * keeps that order). v1-design §3.6, spacetime.md §8.
 *
 * - ulid, bundled in the engine, looks for `window.crypto` as the bundle loads, keeps what it finds
 *   for every id it makes, and won't load without one. A SpacetimeDB module has none; Node's ES
 *   modules have no `require` to reach its own. It's given one here that draws on the current
 *   call's source.
 * - The engine stamps each event with `new Date()`, and ulid each id with `Date.now()`: while a call
 *   is pinned they read the pinned time, through a Date that's the platform's in every other way
 *   (its prototype, so instanceof holds for dates made before or after).
 * - immer reads NODE_ENV as the bundle loads: the module-ready copy has it inlined, and a host
 *   without a `process` (a module) is given one that says production, for any copy that hasn't.
 *
 * In the simulation every engine call is pinned (shared/rules/engine.ts withEngine: the game's dice
 * and the transaction's time), so what it writes is a pure function of the rows. In the AI service
 * nothing is: its ids come from the platform's crypto, and its clock is real.
 */

/** A pinned call's randomness, filling the bytes the engine's ids are made from, and its time in milliseconds since 1970. */
export interface Pin { fill(bytes: Uint8Array): void; nowMs: number }

/** What this host let the shim do: give ulid its crypto (else ids can't be pinned), and replace Date for a call (else the clock can't be). */
export const shimmed = { ids: false, clock: false };

interface Crypto { getRandomValues<T extends ArrayBufferView | null>(bytes: T): T }
interface Host { window?: { crypto?: Crypto }; crypto?: Crypto; process?: { env?: Record<string, string | undefined> }; Date: DateConstructor }

const host = globalThis as unknown as Host;
const PlatformDate = host.Date;
const platformCrypto = host.crypto;
let current: Pin | undefined;

installProcess();
installCrypto();
const PinnedDate = pinnedDate();
shimmed.clock = canReplaceDate();

/**
 * Runs fn with the engine's randomness and clock pinned, and puts back what was there after, however
 * fn ends (pins nest). The engine runs synchronously, so nothing else runs in between.
 */
export function pinned<T>(pin: Pin, fn: () => T): T {
  const outer = current;
  current = pin;
  if (!outer && shimmed.clock) host.Date = PinnedDate;
  try {
    return fn();
  } finally {
    current = outer;
    if (!outer && shimmed.clock) host.Date = PlatformDate;
  }
}

// ---------------------------------------------------------------------------------------------
// What's installed as this file loads.

function installProcess(): void {
  host.process ??= { env: { NODE_ENV: "production" } };
}

/**
 * ulid's crypto: the pinned call's source, else the platform's (the AI service's Node). A module has
 * neither outside a pinned call, and an id made there is a bug in its caller, so it says so. Where
 * spacetimedb/server has loaded first, `window` is the global object, and the crypto goes on it.
 */
function installCrypto(): void {
  const engineCrypto: Crypto = {
    getRandomValues(bytes) {
      if (current && bytes) current.fill(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      else if (platformCrypto) platformCrypto.getRandomValues(bytes);
      else throw new Error("The rules engine made an id outside a pinned call, and this host has no crypto: run it through withEngine.");
      return bytes;
    },
  };
  host.window ??= {};
  host.window.crypto ??= engineCrypto;
  shimmed.ids = host.window.crypto === engineCrypto;
}

/** The platform's Date, but for one made with no arguments, and Date.now, which read the pinned time while a call is pinned. */
function pinnedDate(): DateConstructor {
  const now = () => (current ? current.nowMs : PlatformDate.now());
  return new Proxy(PlatformDate, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget) as object,
    apply: (target, self, args) => (current ? new target(current.nowMs).toString() : Reflect.apply(target, self, args)) as unknown,
    get: (target, key, receiver) => (key === "now" ? now : Reflect.get(target, key, receiver)) as unknown,
  });
}

/** Whether the global Date can be replaced (and put back) here. */
function canReplaceDate(): boolean {
  try {
    host.Date = PinnedDate;
    const took = host.Date === PinnedDate;
    host.Date = PlatformDate;
    return took && host.Date === PlatformDate;
  } catch {
    return false;
  }
}
