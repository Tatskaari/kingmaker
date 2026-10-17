/**
 * A JSON column read back (the creation's offer, the sheet's data): its value, or undefined when it's
 * empty, missing or unreadable, so a screen draws what it has rather than breaking on a bad row.
 */
export function jsonOf<T>(text: string | undefined): T | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
