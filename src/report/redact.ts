import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The key never goes into a report (src/report/README.md). Before a report is written, the key this
 * game uses (and the dev key on this machine, if there is one) is taken out of everything in it, and
 * so is anything shaped like an OpenRouter key: in a call log, a save, an error message, the player's
 * own words, the screen.
 */

/** What an OpenRouter key looks like, wherever it turns up (and the other providers' kinds a player might paste). */
const KEY_SHAPED = /sk-(?:or|ant|proj)-[A-Za-z0-9_-]{8,}/g;

/** What a key becomes in a report. */
export const REMOVED = "[key removed]";

/** The dev key's file (src/llm/openrouter.ts reads it when OPENROUTER_API_KEY isn't set). */
const KEY_FILE = () => join(homedir(), "secrets", "kingmaker-dev-openrouter.txt");

/** The keys this process could be using: OPENROUTER_API_KEY, and the dev key file's (never "offline", never a stub). */
export function keysInUse(): string[] {
  const keys = [process.env.OPENROUTER_API_KEY ?? "", ...devKeys()];
  return [...new Set(keys.map(k => k.trim()).filter(k => k.length >= 8 && k.toLowerCase() !== "offline"))];
}

/** The key the GM calls with, as src/llm/openrouter.ts's apiKey() picks it: OPENROUTER_API_KEY, else the dev key file's. */
export function keyInUse(): string | undefined {
  return process.env.OPENROUTER_API_KEY?.trim() || devKeys()[0]?.trim() || undefined;
}

function devKeys(): string[] {
  try {
    return existsSync(KEY_FILE()) ? readFileSync(KEY_FILE(), "utf8").split("\n").filter(k => k.trim()) : [];
  } catch {
    return [];
  }
}

/** Text with every key taken out: the keys given (as they are, and as JSON writes them), and anything key-shaped. */
export function redact(text: string, keys: string[] = keysInUse()): { text: string; removed: number } {
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

/**
 * A screen with a key on it isn't kept, even a key wrapped across a box's rows or cut off at its
 * edge (pasted into the scene's box, say): taken out row by row, the rest of it could be left on
 * the next row. So the screen is read without its spaces and box lines, and any 16 characters of a
 * key in use, or anything key-shaped, rules it out.
 */
export function redactScreen(text: string, keys: string[] = keysInUse()): string {
  const compact = text.replace(/[\s─-╿]+/g, "");
  const pieces = keys.flatMap(k => Array.from({ length: Math.max(1, k.length - 15) }, (_, i) => k.slice(i, i + 16)));
  const keyed = pieces.some(p => compact.includes(p)) || new RegExp(KEY_SHAPED.source).test(compact);
  return keyed ? "(This screen had something like a key on it, so it isn't kept.)" : text;
}
