// Moved from v2/ai/docs/backstory.ts, which re-exports it: MOST_WORDS, wordCount, tooLong, locate, applyFix and their helpers (STARTERS, wordsOf, thousands); STARTERS exported (keepWords, which stays, reads it), and locate's chars.at(-1) is chars[chars.length - 1] (ES2021, the module's lib).
import type { LoreIssue } from "./types.ts";

/**
 * A backstory's text, as the box, the moves and the lore check all handle it: how long it may be,
 * where a quote is in it, and the text with a fix accepted. Plain functions of the text, so the
 * client, the simulation and the AI service each run them as they are.
 */

/** The most a backstory can be, in words: the GM is given all of it every turn (the player's doc). */
export const MOST_WORDS = 2000;
export const wordCount = (text: string): number => (text.match(/\S+/g) ?? []).length;
const thousands = (n: number) => n.toLocaleString("en-GB");

/** Why a backstory (or notes to work in) can't go on as it is: longer than MOST_WORDS; else undefined. */
export function tooLong(text: string): string | undefined {
  const n = wordCount(text);
  return n > MOST_WORDS ? `It's ${thousands(n)} words, and the GM reads all of it every turn: cut it to ${thousands(MOST_WORDS)} or fewer.` : undefined;
}

/** Words that start sentences without being anyone's name. */
export const STARTERS = new Set(("i my me mine we our us you your he his him she her they their them it its this that these those there here then when while " +
  "but and or so yet nor if as at in on to for of from by with without after before since until once now later still also even just only " +
  "the a an no not never always sometimes some all every each one two three both because though although which who whom whose what where why how " +
  "was were is are am be been had has have did do does will would could should might must can may shall let").split(" "));

/**
 * Where a quote is in the text: exactly, or with case, spacing and quote marks aside. Its start and
 * end in the text as written, or undefined.
 */
export function locate(text: string, quote: string): { start: number; end: number } | undefined {
  const q = quote.trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim();
  if (!q) return undefined;
  const exact = text.indexOf(q);
  if (exact >= 0) return { start: exact, end: exact + q.length };
  // Normalised, keeping a map back to the original's indices.
  const norm = (c: string) => (/["“”]/.test(c) ? '"' : /['‘’]/.test(c) ? "'" : c.toLowerCase());
  const chars: string[] = [], at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (/\s/.test(c)) { if (chars[chars.length - 1] !== " ") { chars.push(" "); at.push(i); } continue; }
    chars.push(norm(c)); at.push(i);
  }
  const hay = chars.join("");
  const needle = q.replace(/\s+/g, " ").split("").map(norm).join("").replace(/[.,;:!?]+$/, "");
  const found = hay.indexOf(needle);
  if (found < 0 || !needle) return undefined;
  return { start: at[found]!, end: at[found + needle.length - 1]! + 1 };
}

/** A text's words, case and curly apostrophes aside, with where each starts. */
const wordsOf = (t: string) => [...t.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)].map(m => ({ w: m[0].toLowerCase().replace(/’/g, "'"), start: m.index }));

/**
 * The text with a fix accepted: the quote's words replaced by the fix's, fitted to where they go (a
 * fix that runs on into the words after its quote, or back into those before, doesn't say them
 * twice; a capital only where a sentence starts, as in "..., and a retired watchman taught me"; the
 * sentence's own full stop, kept or not doubled). Undefined if the quote isn't there any more.
 */
export function applyFix(text: string, issue: LoreIssue): string | undefined {
  if (!issue.quote) return undefined;
  const span = locate(text, issue.quote);
  if (!span) return undefined;
  const before = text.slice(0, span.start), quote = text.slice(span.start, span.end), after = text.slice(span.end);
  let fix = issue.fix.trim();
  // Words the fix repeats from before its quote ("and" after ", and"; two or more of anything else) come off its start.
  const head = wordsOf(fix), prev = wordsOf(before);
  for (let n = Math.min(head.length - 1, prev.length); n >= 1; n--) {
    if (head.slice(0, n).every((h, i) => h.w === prev[prev.length - n + i]!.w) && (n >= 2 || STARTERS.has(head[0]!.w))) { fix = fix.slice(head[n]!.start); break; }
  }
  // Two or more words it runs on into, from after its quote, come off its end.
  const tail = wordsOf(fix), next = wordsOf(after);
  for (let n = Math.min(tail.length - 1, next.length); n >= 2; n--) {
    if (tail.slice(-n).every((t, i) => t.w === next[i]!.w)) { fix = fix.slice(0, tail[tail.length - n]!.start).replace(/[\s,;:—–-]+$/, ""); break; }
  }
  const opens = !before.trim() || /([.!?…]["”’)]?\s+|\n\s*)$/.test(before);
  const word = /^[A-Za-z]+/.exec(fix)?.[0] ?? "";
  if (opens) fix = fix.charAt(0).toUpperCase() + fix.slice(1);
  else if (word !== "I" && /^[A-Z][a-z]*$/.test(word) && STARTERS.has(word.toLowerCase())) fix = fix.charAt(0).toLowerCase() + fix.slice(1);
  const stop = /[.!?]["”’]?$/;
  // A fix that runs on into the sentence after its quote ("... from the outside, and"): no stop of its
  // own, and that sentence goes on from it, its first word in lower case unless it's a name.
  const next1 = /^(\s+)([A-Z][a-z]*)/.exec(after);
  if (stop.test(quote) && next1 && /(,|\b(and|but|or|so|yet|while|whereas|because|though|although|since|until|when|as|where))$/i.test(fix)) {
    const lower = next1[2] !== "I" && STARTERS.has(next1[2]!.toLowerCase());
    return `${before}${fix}${lower ? `${next1[1]}${next1[2]!.charAt(0).toLowerCase()}${after.slice(next1[0].length - next1[2]!.length + 1)}` : after}`;
  }
  if (stop.test(quote) && !stop.test(fix)) fix += stop.exec(quote)![0];
  // A fix with a stop of its own where the sentence goes on, or where the quote stopped short of the sentence's own stop: one stop, the sentence's.
  else if (!stop.test(quote) && stop.test(fix) && /^(\s*([,;:]|[a-z])|[.!?])/.test(after)) fix = fix.replace(/[.!?]+$/, "");
  return `${before}${fix}${after}`;
}
