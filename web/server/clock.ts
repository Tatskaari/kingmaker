import { Timestamp } from "spacetimedb";

/**
 * The page host's clock (browser-design §4.2): the time each of the simulation's transactions is
 * stamped with, as SpacetimeDB stamps one with its own. The page's time origin plus the time since,
 * to the microsecond, rather than Date.now(), which a page may coarsen and the system may set back.
 */
export function realClock(): Timestamp {
  return new Timestamp(BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000)));
}
