// Copied from the prototype's src/report/redact.ts at 44c6d4a: redact and redactScreen whole, KEY_SHAPED with the page's key form's shapes; the keys are handed in (keysFrom) where it read them from the environment and the dev key file, which a host does now (shared reads neither).
/**
 * Every key out of a report (V16, M5: docs/migration-log.md). Before a report is written, the keys
 * its host knows of (the OpenRouter key the GM calls with, the bearer the module sends the AI
 * service, a session's or the owner's token) are taken out of everything in it, and so is anything
 * shaped like an OpenRouter key: in a call log, a row, a doc, an error message, the player's own
 * words, the screen. Whatever holds a key takes it out of what it hands over: the AI service out of
 * a game's calls and docs, the page's server worker out of the game's rows, the client out of the
 * whole report.
 */

/** What an OpenRouter key looks like, wherever it turns up (and the other providers' kinds a player might paste). */
export const KEY_SHAPED = /sk-(?:or|ant|proj)-[A-Za-z0-9_-]{8,}/g;

/** What a key becomes in a report. */
export const REMOVED = "[key removed]";

/**
 * The keys worth taking out, from what a host has: each trimmed, and none that's empty, shorter than
 * eight characters (it would take out words) or a stand-in's ("offline", "fake").
 */
export function keysFrom(candidates: ReadonlyArray<string | undefined>): string[] {
  const keys = candidates.map(k => (k ?? "").trim()).filter(k => k.length >= 8 && !/^(offline|fake)$/i.test(k));
  return [...new Set(keys)];
}

/** Text with every key taken out: the keys given (as they are, and as JSON writes them), and anything key-shaped. */
export function redact(text: string, keys: readonly string[] = []): { text: string; removed: number } {
  let out = text;
  let removed = 0;
  for (const key of keys) {
    for (const form of new Set([key, JSON.stringify(key).slice(1, -1)])) {
      const parts = out.split(form);
      removed += parts.length - 1;
      out = parts.join(REMOVED);
    }
  }
  out = out.replace(KEY_SHAPED, () => { removed++; return REMOVED; });
  return { text: out, removed };
}

/** Text with every key taken out, the count left behind: what an answer that carries a game's words is passed through. */
export const withoutKeys = (text: string, keys: readonly string[] = []): string => redact(text, keys).text;

/** What a screen with a key on it is kept as. */
export const KEYED_SCREEN = "(This screen had something like a key on it, so it isn't kept.)";

/**
 * A screen with a key on it isn't kept, even a key wrapped across a box's rows or cut off at its
 * edge (pasted into the scene's box, say): taken out row by row, the rest of it could be left on
 * the next row. So the screen is read without its spaces and box lines, and any 16 characters of a
 * key in use, or anything key-shaped, rules it out.
 */
export function redactScreen(text: string, keys: readonly string[] = []): string {
  const compact = text.replace(/[\s─-╿]+/g, "");
  const pieces = keys.flatMap(k => Array.from({ length: Math.max(1, k.length - 15) }, (_, i) => k.slice(i, i + 16)));
  const keyed = pieces.some(p => compact.includes(p)) || new RegExp(KEY_SHAPED.source).test(compact);
  return keyed ? KEYED_SCREEN : text;
}
