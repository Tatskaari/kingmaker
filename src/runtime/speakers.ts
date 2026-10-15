/**
 * Who says a quoted line in the GM's prose: by its speaker's tag when the GM wrote one
 * (src/runtime/markup.ts), or else as a reader would tell, from the speech tag after it ("…,” Nan
 * says) or the sentence leading into it. The look director puts barks over speakers this way, and
 * the scene's transcript colours each line by it.
 */

/**
 * Someone who might speak, and the names that mean them in prose (lower case). `heads`: the last
 * word of what they're called ("boy" for the boy in the too-big boots, "porter" for the big porter
 * with the bandaged hand), with the rest of its words. Alone, that word could be anyone of the kind
 * (a porter the GM made up), so it means them only as "the boy", or beside another word of theirs
 * ("a scrawny boy in enormous boots").
 */
export interface Speaker { id: string; names: string[]; heads?: Record<string, string[]> }

/** Words that say someone's talking. */
export const SPEECH = "said|says|shouts|calls|mutters|snaps|adds|asks|cries|yells|whispers|growls|replies|tells|answers|murmurs|hisses|grunts|barks|warns";
/** A speech tag that's the player's: "…,” you say. */
const YOU_SAY = /^[^a-z]*you\s+(say|said|add|added|ask|asked|reply|replied|tell|told|answer|answered|call|called|shout|shouted|mutter|muttered|whisper|whispered|snap|snapped)\b/;
/** Words too common to tell people apart by. */
const GENERIC = /^(person|people|fellow|figure|someone|stranger|man|men|woman|women|child|children|one|two|lot)$/;
/** A name after one of these is someone being looked at, talked about or watched, not the speaker ("Her gaze settles on Kell.", "stays on the landlady"). */
const MENTIONED = /\b(at|to|from|with|toward|towards|past|beside|behind|for|of|about|over|by|than|like|and|on|upon|onto|into|watching|eyeing|after)\s+(?:(?:the|a|an|her|his|their|its)\s+)?$/;
/** Words of a name that don't tell people apart in prose ("Sergeant" is any sergeant). */
const COMMON = /^(the|sergeant|corporal|master|mister|madam|mother|father|old|young|little|big|lady|lord|sir|dame|mrs|miss|king|queen)$/;
/** Titles a speaker's tag may carry that don't say which one ("Sergeant", "Madam"). */
const TITLE = /^(the|sergeant|corporal|master|mister|madam|missus|mistress|big|old|young|little|captain|lady|lord|sir|dame)$/;

/** What they're called without its article ("boy in the too-big boots"), and its head word with the rest of its words. */
function aliasOf(called?: string): { alias: string; head?: string; rest: string[] } | undefined {
  const alias = called?.toLowerCase().replace(/^(the|a|an)\s+/, "");
  if (!alias) return undefined;
  const head = alias.split(/\s+(with|in|by|from|at|on)\s+/)[0]!.split(/\s+/).at(-1);
  const rest = (alias.match(/[a-z][a-z'-]{2,}/g) ?? []).filter(w => w !== head && !/^(the|with|from|and)$/.test(w));
  return { alias, ...(head && head.length >= 3 && !GENERIC.test(head) ? { head } : {}), rest };
}

/**
 * The names that mean someone in prose: their name, its distinctive words, and what the story calls
 * them before the player knows the name ("the landlady"). What they're called by its last word
 * alone is a `heads` entry (see Speaker, and `speaker`).
 */
export function namesFor(name: string, called?: string, aka: string[] = []): string[] {
  const lower = name.toLowerCase();
  const alias = aliasOf(called)?.alias;
  return [...new Set([lower, ...lower.split(/\s+/).filter(w => w.length >= 3 && !COMMON.test(w)),
    ...(alias ? [alias] : []), ...aka.map(a => a.toLowerCase())])];
}

/** Someone who might speak: their names, and what they're called by its head word ("the boy"). */
export function speaker(id: string, name: string, called?: string, aka: string[] = []): Speaker {
  const a = aliasOf(called);
  return { id, names: namesFor(name, called, aka), ...(a?.head ? { heads: { [a.head]: a.rest } } : {}) };
}

/**
 * People told apart: a word of a name that two of them share (the Gudgeons' surname) means neither,
 * so it goes from both; whole names and what they're called stay. A head word two share (two
 * porters) means neither too.
 */
export function distinct(people: Speaker[]): Speaker[] {
  const count = new Map<string, number>();
  for (const p of people) for (const n of new Set([...p.names, ...Object.keys(p.heads ?? {})])) count.set(n, (count.get(n) ?? 0) + 1);
  return people.map(p => {
    const heads = Object.entries(p.heads ?? {}).filter(([h]) => (count.get(h) ?? 0) < 2);
    return { id: p.id, names: p.names.filter((n, i) => i === 0 || (count.get(n) ?? 0) < 2), ...(heads.length ? { heads: Object.fromEntries(heads) } : {}) };
  });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does the speech tag straight after a quote name this speaker? "…,” Nan says", "…,” Big Hobb growls", "…,” says the landlady". */
function taggedBy(after: string, name: string, definite = false): boolean {
  const n = escape(name);
  return definite
    ? new RegExp(`^[^a-z]*the\\s+${n}\\s+(?:${SPEECH})\\b|^[^a-z]*(?:${SPEECH})\\s+the\\s+${n}\\b`).test(after)
    : new RegExp(`^[^a-z]*(?:[a-z']+\\s+){0,2}?${n}\\s+(?:${SPEECH})\\b|^[^a-z]*(?:${SPEECH})\\s+(?:the\\s+)?${n}\\b`).test(after);
}

/** Where a name stands in some words as a whole word (not inside another: "dab" isn't in "dabbed"). */
function* wordsAt(text: string, name: string): Generator<number> {
  const re = new RegExp(`(?<![a-z'])${escape(name)}(?![a-z])`, "g");
  for (const m of text.matchAll(re)) yield m.index;
}

/** The text before a quote, with any earlier quoted words blanked out (a name said in a line is mentioned, not speaking). */
const unquoted = (s: string) => s.replace(/[“"][^“”"]*[”"]/g, q => " ".repeat(q.length));

/**
 * The first one named in some words who isn't only mentioned there ("One looks from Kell to you."
 * isn't Kell talking), and where: by a name, or by what they're called as "the boy" or beside
 * another word of it ("a scrawny boy in enormous boots").
 */
export function firstNamed(words: string, people: Speaker[]): { id: string; at: number } | undefined {
  let best: { id: string; at: number } | undefined;
  const take = (id: string, at: number) => { if (!best || at < best.at) best = { id, at }; };
  for (const p of people) {
    for (const n of p.names) {
      for (const i of wordsAt(words, n)) { if (!MENTIONED.test(words.slice(0, i))) { take(p.id, i); break; } }
    }
    for (const [head, rest] of Object.entries(p.heads ?? {})) {
      for (const i of wordsAt(words, head)) {
        const before = words.slice(0, i);
        if (MENTIONED.test(before.replace(/\bthe\s+$/, ""))) continue;
        if (/\bthe\s+$/.test(before) || rest.some(w => [...wordsAt(words, w)].length)) { take(p.id, i); break; }
      }
    }
  }
  return best;
}

/**
 * Who the speech tag straight after a quote ending at `end` says spoke it: "you" for the player's
 * own words ("…,” you add), or someone it names ("…,” says the landlady), whoever else is about
 * ("she says, without looking at Hobb" isn't Hobb). Undefined when there's none.
 */
export function speechTagged(text: string, end: number, people: Speaker[]): string | undefined {
  const after = text.slice(end, end + 40).toLowerCase();
  if (YOU_SAY.test(after)) return "you";
  return people.find(p => p.names.some(n => taggedBy(after, n)) || Object.keys(p.heads ?? {}).some(h => taggedBy(after, h, true)))?.id;
}

/**
 * Who says the quote at text[start, end) (its quote marks included): whoever the speech tag after
 * it says (speechTagged), else the first one named in the sentence leading in who isn't only
 * mentioned there. Undefined when the prose doesn't say.
 */
export function quoteSpeaker(text: string, start: number, end: number, people: Speaker[]): string | undefined {
  const tagged = speechTagged(text, end, people);
  if (tagged) return tagged;
  // The sentence leading into the quote: the one it's in, or the one before when it opens one (a
  // sentence ends at its stop, its closing quote included, and an earlier line's words don't count).
  const sentences = unquoted(text.slice(Math.max(0, start - 200), start).toLowerCase()).split(/(?<=[.!?…:][”"’]?)\s+|\n+/);
  const lead = (sentences.at(-1)?.trim() ? sentences.at(-1) : sentences.at(-2)) ?? "";
  return firstNamed(lead, people)?.id;
}

/**
 * Who a speaker's tag means ("Kell", "Sergeant Agnes Kell", "the landlady", "you"): the whole name
 * first, then a distinctive part of it; what they're called by its head word only as "the boy"
 * ("[Porter]" or "[A porter]" is a porter, not the big porter with the bandaged hand). Undefined for
 * nobody here (a passer-by the GM made up).
 */
export function tagSpeaker(tag: string, people: Speaker[]): string | undefined {
  const t = tag.trim().toLowerCase().replace(/^@/, "").replace(/[.:,]+$/, "");
  if (!t) return undefined;
  if (/^(you|player|me)$/.test(t)) return "you";
  const bare = t.replace(/^(the|a|an)\s+/, "");
  const exact = people.find(p => p.id.toLowerCase() === t || p.names.includes(t) || p.names.includes(bare));
  if (exact) return exact.id;
  const words = bare.split(/\s+/).filter(w => w.length > 2 && !TITLE.test(w));
  const named = people.find(p => words.some(w => p.names.includes(w)));
  if (named) return named.id;
  if (!/^the\s/.test(t)) return undefined;
  return people.find(p => Object.keys(p.heads ?? {}).some(h => words.at(-1) === h))?.id;
}
