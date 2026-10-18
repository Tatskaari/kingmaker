// New (M5: problem reports): a game's rows as JSON can carry them, there (a report's) and back (a restore's).
import { revive, type SdkClasses } from "../protocol/port.ts";

/**
 * A game's rows as JSON (V16: the rows a report keeps, and the rows a restore writes back). A u64 is
 * {"$big": "12"}, so nothing is lost to a double; the SDK's classes are the fields structured clone
 * leaves of them ({"__identity__": …}, {"__timestamp_micros_since_unix_epoch__": …}), which revive()
 * makes classes again. The module writes them (report_game) and reads them (restore_game), so this
 * is plain ES2021.
 */

/** Rows by table, each a row as the module keeps it. */
export type RowsByTable = Record<string, Array<Record<string, unknown>>>;

/** A u64 as JSON carries it. */
interface Big { $big: string }

/** Any value of rows as JSON: its bigints tagged. */
export function rowsJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? ({ $big: v.toString() } satisfies Big) : v));
}

/** JSON rowsJson wrote, its bigints and the SDK's classes back as they were. */
export function rowsFromJson<T = RowsByTable>(text: string, classes: SdkClasses): T {
  return revive(JSON.parse(text, (_key, v: unknown) => (isBig(v) ? BigInt(v.$big) : v)) as T, classes);
}

/** A value of rows already parsed as plain JSON (its bigints still tagged), its bigints and classes back. */
export function rowsFromParsed<T = RowsByTable>(value: unknown, classes: SdkClasses): T {
  return rowsFromJson<T>(JSON.stringify(value), classes);
}

/** A tagged u64, as a report's reader shows it: its digits. */
export function bigOf(value: unknown): string | undefined {
  return isBig(value) ? value.$big : undefined;
}

function isBig(value: unknown): value is Big {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "$big" && typeof (value as Big).$big === "string" && /^-?\d+$/.test((value as Big).$big);
}
