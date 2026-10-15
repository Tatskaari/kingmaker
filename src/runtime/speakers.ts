/**
 * Who says a quoted line in the GM's prose: by its speaker's tag when the GM wrote one
 * (src/runtime/markup.ts), or else as a reader would tell, from the speech tag after it ("…,” Nan
 * says) or the sentence leading into it. The look director puts barks over speakers this way, and
 * the scene's transcript colours each line by it.
 */

/** Someone who might speak, and the names that mean them in prose (lower case). */
export interface Speaker { id: string; names: string[] }

/** Words that say someone's talking. */
export const SPEECH = "said|says|shouts|calls|mutters|snaps|adds|asks|cries|yells|whispers|growls|replies|tells|answers|murmurs|hisses|grunts|barks|warns";
/** A speech tag that's the player's: "…,” you say. */
const YOU_SAY = /^[^a-z]*you\s+(say|said|add|added|ask|asked|reply|replied|tell|told|answer|answered|call|called|shout|shouted|mutter|muttered|whisper|whispered|snap|snapped)\b/;
/** Words too common to tell people apart by. */
const GENERIC = /^(person|people|fellow|figure|someone|stranger|man|men|woman|women|child|children|one|two|lot)$/;
/** A name after one of these is someone being looked at or talked about, not the speaker. */
const MENTIONED = /\b(at|to|from|with|toward|towards|past|beside|behind|for|of|about|over|by|than|like|and)\s+$/;
/** Words of a name that don't tell people apart in prose ("Sergeant" is any sergeant). */
const COMMON = /^(the|sergeant|corporal|master|mister|madam|mother|father|old|young|little|big|lady|lord|sir|dame|mrs|miss|king|queen)$/;
/** Titles a speaker's tag may carry that don't say which one ("Sergeant", "Madam"). */
const TITLE = /^(the|sergeant|corporal|master|mister|madam|missus|mistress|big|old|young|little|captain|lady|lord|sir|dame)$/;

/**
 * The names that mean someone in prose: their name, its distinctive words, what the story calls
 * them before the player knows the name ("the landlady"), and that alias's head word when it's
 * distinctive ("lighterman", "boy": the boy in the too-big boots is the scene's one boy; two who
 * share it are told apart by neither, see distinct).
 */
export function namesFor(name: string, called?: string, aka: string[] = []): string[] {
  const lower = name.toLowerCase();
  const alias = called?.toLowerCase().replace(/^(the|a|an)\s+/, "");
  const head = alias?.split(/\s+(with|in|by|from|at|on)\s+/)[0]!.split(/\s+/).at(-1);
  return [...new Set([lower, ...lower.split(/\s+/).filter(w => w.length >= 3 && !COMMON.test(w)),
    ...(alias ? [alias] : []), ...(head && head.length >= 3 && !GENERIC.test(head) ? [head] : []),
    ...aka.map(a => a.toLowerCase())])];
}

/**
 * People told apart: a word of a name that two of them share (the Gudgeons' surname) means neither,
 * so it goes from both; whole names and what they're called stay.
 */
export function distinct(people: Speaker[]): Speaker[] {
  const count = new Map<string, number>();
  for (const p of people) for (const n of new Set(p.names)) count.set(n, (count.get(n) ?? 0) + 1);
  return people.map(p => ({ ...p, names: p.names.filter((n, i) => i === 0 || (count.get(n) ?? 0) < 2) }));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does the speech tag straight after a quote name this speaker? "…,” Nan says", "…,” Big Hobb growls", "…,” says the landlady". */
function taggedBy(after: string, name: string): boolean {
  const n = escape(name);
  return new RegExp(`^[^a-z]*(?:[a-z']+\\s+){0,2}?${n}\\s+(?:${SPEECH})\\b|^[^a-z]*(?:${SPEECH})\\s+(?:the\\s+)?${n}\\b`).test(after);
}

/**
 * Who says the quote at text[start, end) (its quote marks included): "you" for the player's own
 * words ("…,” you add), someone named in the speech tag after it, else the first one named in the
 * sentence leading in who isn't only mentioned there ("One looks from Kell to you." isn't Kell
 * talking). Undefined when the prose doesn't say.
 */
export function quoteSpeaker(text: string, start: number, end: number, people: Speaker[]): string | undefined {
  const after = text.slice(end, end + 40).toLowerCase();
  if (YOU_SAY.test(after)) return "you";
  // The sentence leading into the quote: the one it's in, or the one before when it opens one.
  const sentences = text.slice(Math.max(0, start - 200), start).toLowerCase().split(/(?<=[.!?…:])\s+|\n+/);
  const lead = (sentences.at(-1)?.trim() ? sentences.at(-1) : sentences.at(-2)) ?? "";
  let best: { id: string; at: number } | undefined;
  for (const p of people) {
    for (const n of p.names) {
      // Named in the speech tag is the speaker, whoever else is about ("she says, without looking at Hobb" isn't Hobb).
      if (taggedBy(after, n)) return p.id;
      for (let i = lead.indexOf(n); i >= 0; i = lead.indexOf(n, i + 1)) {
        if (MENTIONED.test(lead.slice(0, i))) continue;
        if (!best || i < best.at) best = { id: p.id, at: i };
        break;
      }
    }
  }
  return best?.id;
}

/**
 * Who a speaker's tag means ("Kell", "Sergeant Agnes Kell", "the landlady", "you"): the whole name
 * first, then a distinctive part of it. Undefined for nobody here (a passer-by the GM made up).
 */
export function tagSpeaker(tag: string, people: Speaker[]): string | undefined {
  const t = tag.trim().toLowerCase().replace(/^@/, "").replace(/[.:,]+$/, "");
  if (!t) return undefined;
  if (/^(you|player|me)$/.test(t)) return "you";
  const bare = t.replace(/^(the|a|an)\s+/, "");
  const exact = people.find(p => p.id.toLowerCase() === t || p.names.includes(t) || p.names.includes(bare));
  if (exact) return exact.id;
  const words = bare.split(/\s+/).filter(w => w.length > 2 && !TITLE.test(w));
  return people.find(p => words.some(w => p.names.includes(w)))?.id;
}
