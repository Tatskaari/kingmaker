// Copied from the prototype's src/runtime/speakers.ts at 44c6d4a, whole, but that quoteSpeaker's sentence leading into a line starts after the line before it (QA round qa1-1018: Hobb's whisper went to Hep, whose line came just before); and, since QA round qa2-1018, that what someone's called by a word anyone could be is its last two words ("the big man"), a sentence naming nobody who might speak goes on about whoever its pronoun is, and a line whose speech tag names someone nobody here is known as is theirs (strangerTagged).

/**
 * Who says a quoted line in the GM's prose: by its speaker's tag when the GM wrote one
 * (src/runtime/markup.ts), or else as a reader would tell, from the speech tag after it ("…,” Nan
 * says) or the sentence leading into it. The look director puts barks over speakers this way, and
 * the scene's transcript colours each line by it.
 */

/** Who "she" or "he" is: what someone's card calls them. */
export type Pronoun = "she" | "he";

/**
 * Someone who might speak, and the names that mean them in prose (lower case). `heads`: the last
 * word of what they're called ("boy" for the boy in the too-big boots, "porter" for the big porter
 * with the bandaged hand), with the rest of its words; their rank ("the King" is King Aldren); and
 * what they are ("woman", "boy"), with the words of their look. Alone, such a word could be anyone of
 * the kind (a porter the GM made up), so it means them only as "the boy", or beside another word of
 * theirs ("a scrawny boy in enormous boots", "a woman in a rain cape"). `away`: not in the place
 * (cast who haven't come in, or have gone), so known only by a name of theirs, never by their rank or
 * what they are, and by what they're called (`arrives`) only once the narration brings them in by it
 * (`arrived`). `pronoun`: as their card has it, for the narration's "she".
 */
export interface Speaker { id: string; names: string[]; heads?: Record<string, string[]>; away?: boolean; arrives?: Record<string, string[]>; pronoun?: Pronoun | "they" }

/** Words that say someone's talking. */
export const SPEECH = "said|says|shouts|calls|mutters|snaps|adds|asks|cries|yells|whispers|growls|replies|tells|answers|murmurs|hisses|grunts|barks|warns|blurts|drawls|admits|insists|protests|agrees|repeats|interrupts|pleads|rasps|croaks|bellows|roars|shrieks|retorts|announces|declares|explains|demands|mumbles|stammers|stutters|wails|sobs|groans|breathes|sniffs|sighs";
/** A speech tag that's the player's: "…,” you say. */
const YOU_SAY = /^[^a-z]*you\s+(say|said|add|added|ask|asked|reply|replied|tell|told|answer|answered|call|called|shout|shouted|mutter|muttered|whisper|whispered|snap|snapped)\b/;
/** Words too common to tell people apart by. */
const GENERIC = /^(person|people|fellow|figure|someone|stranger|man|men|woman|women|child|children|one|two|lot)$/;
/** Titles a name can come with between the words before it and the name ("to Sergeant Kell", "at Master Sallow"). */
const TITLED = "sergeant|corporal|captain|marshal|master|mister|madam|missus|mistress|king|queen|lady|lord|sir|dame|mrs|mr|miss|big|old|young|little";
/** A name after one of these is someone being looked at, talked about or watched, not the speaker ("Her gaze settles on Kell.", "stays on the landlady", "flick to Sergeant Kell’s notebook"). */
const MENTIONED = new RegExp(`\\b(at|to|from|with|toward|towards|past|beside|behind|for|of|about|over|by|than|like|and|on|upon|onto|into|watching|eyeing|after)\\s+(?:(?:the|a|an|her|his|their|its)\\s+)?(?:(?:${TITLED})\\s+)?$`);
/** Words of a name that don't tell people apart in prose ("Sergeant" is any sergeant). */
const COMMON = /^(the|sergeant|corporal|master|mister|madam|mother|father|old|young|little|big|lady|lord|sir|dame|mrs|miss|king|queen)$/;
/** Titles a speaker's tag may carry that don't say which one ("Sergeant", "Madam"). */
const TITLE = /^(the|sergeant|corporal|master|mister|madam|missus|mistress|big|old|young|little|captain|lady|lord|sir|dame)$/;
/** A name's first word that's a rank, which means them as "the King", "the Marshal", "the Sergeant" (when they're the only one here). */
const RANK = /^(king|queen|prince|princess|duke|duchess|marshal|sergeant|corporal|captain|lieutenant|constable|warden|reeve|abbot|abbess|prior|bishop|magistrate|mayor|alderman|steward|chamberlain)$/;

const SHE = /\b(she|her|hers|herself)\b/g;
const HE = /\b(he|him|his|himself)\b/g;
const SHE_NOUN = /\b(woman|women|girl|lady|lass|landlady|bargewoman|forewoman|washerwoman|fishwife|wife|widow|mother|mum|grandmother|daughter|sister|aunt|queen|princess|duchess|madam|mistress|missus|mrs|miss)\b/;
const HE_NOUN = /\b(man|boy|lad|gentleman|king|prince|duke|lord|sir|father|son|brother|uncle|husband|mister|mr|master|watchman|lighterman|bargeman|ferryman|fisherman)\b/;
/** A child, by their card ("a scrawny boy of about eleven", "a girl of thirteen"). */
const YOUNG = /\b(boy|girl|child|lad|lass|urchin)\b|\bof (?:about |some )?(?:[2-9]|1[0-5])\b/;

/** "she" or "he", as the words of a card have it: its pronouns, else its words for a woman or a man. */
export function pronounOf(card: string): Pronoun | undefined {
  const c = card.toLowerCase();
  const she = c.match(SHE)?.length ?? 0, he = c.match(HE)?.length ?? 0;
  if (she !== he) return she > he ? "she" : "he";
  const f = SHE_NOUN.test(c), m = HE_NOUN.test(c);
  return f && !m ? "she" : m && !f ? "he" : undefined;
}

/** Words of a look that tell someone apart when they're "a woman in a rain cape": its first sentence's, not its common ones. */
function lookWords(look: string | undefined): string[] {
  const first = look?.toLowerCase().split(/[.;]/)[0] ?? "";
  return [...new Set(first.match(/[a-z][a-z'-]{3,}/g) ?? [])].filter(w => !/^(with|from|that|this|their|them|very|much|more|most|some|about|into|over|under|like|years|forties|fifties|sixties|thirties|twenties|fifty|sixty|seventy|forty|thirty|twenty|eleven|twelve|thirteen|always|never|sizes|three|pair|good|worn|kept|keeps|wears|wearing|holds|half|both|each|other)$/.test(w) && !SHE_NOUN.test(w) && !HE_NOUN.test(w) && !YOUNG.test(w));
}

/**
 * What they're called without its article ("boy in the too-big boots"), and its head word with the
 * rest of its words. A head word anyone could be ("man", "woman") takes the word before it: "the big
 * man with the bandaged hand" is "the big man" (QA round qa2-1018: his "Not tonight, Arlo." after
 * "The big man’s shoulders tighten." was nobody's, and after "the big man says" Arlo's).
 */
function aliasOf(called?: string): { alias: string; head?: string; rest: string[] } | undefined {
  const alias = called?.toLowerCase().replace(/^(the|a|an)\s+/, "");
  if (!alias) return undefined;
  const words = alias.split(/\s+(with|in|by|from|at|on)\s+/)[0]!.split(/\s+/);
  const last = words.at(-1);
  const head = last && GENERIC.test(last) && words.length > 1 && words.at(-2)!.length >= 3 ? words.slice(-2).join(" ") : last;
  const rest = (alias.match(/[a-z][a-z'-]{2,}/g) ?? []).filter(w => !head?.split(" ").includes(w) && !/^(the|with|from|and)$/.test(w));
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

/**
 * Someone who might speak: their names, and what they're called by its head word ("the boy"), their
 * rank ("the King") and what they are ("the woman"), from their card (`look`). Someone `away` is
 * known by their names alone.
 */
export function speaker(id: string, name: string, called?: string, aka: string[] = [], card: { look?: string | undefined; away?: boolean } = {}): Speaker {
  const a = aliasOf(called);
  // A group ("the valets", "the re-sacking gang") is "they".
  const pronoun: Speaker["pronoun"] = /^(?:the|some|two|three|four|five)\s(?:.*\S)?(?:[^s]s|gang|crowd|crew|family|watch)$/i.test(name.trim()) ? "they" : pronounOf([name, called ?? "", card.look ?? ""].join(". "));
  const names = namesFor(name, called, aka);
  const rank = name.toLowerCase().split(/\s+/);
  if (rank.length > 1 && /^(king|queen)$/.test(rank[0]!)) names.push(rank[0] === "king" ? "his majesty" : "her majesty");
  const them = pronoun ? { pronoun } : {};
  // Away: by their names, or by what they're called once the narration brings them in by it.
  if (card.away) return { id, names, ...(a?.head && a.rest.length ? { arrives: { [a.head]: a.rest } } : {}), away: true, ...them };
  const heads: Record<string, string[]> = {};
  if (a?.head) heads[a.head] = a.rest;
  if (rank.length > 1 && RANK.test(rank[0]!)) heads[rank[0]!] ??= [];
  // What they are, as the narration may first put them ("a woman in a rain cape steps away from the gate").
  if (pronoun && pronoun !== "they" && card.look) {
    const young = YOUNG.test(`${called ?? ""} ${card.look}`.toLowerCase());
    const kind = young ? (pronoun === "she" ? "girl" : "boy") : (pronoun === "she" ? "woman" : "man");
    heads[kind] = [...new Set([...(heads[kind] ?? []), ...lookWords(card.look)])];
  }
  return { id, names, ...(Object.keys(heads).length ? { heads } : {}), ...them };
}

/**
 * People told apart: a word of a name that two of them share (the Gudgeons' surname) means neither,
 * so it goes from both; whole names and what they're called stay. A head word two share (two
 * porters, two women) means neither too.
 */
export function distinct(people: Speaker[]): Speaker[] {
  const count = new Map<string, number>();
  for (const p of people) for (const n of new Set([...p.names, ...Object.keys(p.heads ?? {})])) count.set(n, (count.get(n) ?? 0) + 1);
  return people.map(({ heads: all, ...p }) => {
    const heads = Object.entries(all ?? {}).filter(([h]) => (count.get(h) ?? 0) < 2);
    return { ...p, names: p.names.filter((n, i) => i === 0 || (count.get(n) ?? 0) < 2), ...(heads.length ? { heads: Object.fromEntries(heads) } : {}) };
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

/** What's someone's by their rank without being them ("the King’s Road", "the King’s investigator"). */
const THINGS_OF = /^['’]s\s+(?:road|granary|peace|highway|grain|wagons?|rolls?|investigator|business|justice|guards?|men|court|purse|warrant|seal|own|coin|face up|shilling|penny|pennies|crown)\b/;

/**
 * The people, with anyone away the narration brings in by what they're called ("The gentleman
 * behind them carries a silver-topped cane."): its head word and another word of it, outside the
 * lines said. They're known by it then, as if they'd been here. A head word someone here has
 * already is theirs.
 */
export function arrived(people: Speaker[], text: string): Speaker[] {
  const sentences = unquoted(text.toLowerCase()).split(/(?<=[.!?…])\s+|\n+/);
  const taken = new Set(people.flatMap(p => Object.keys(p.heads ?? {})));
  const has = (s: string, w: string) => !wordsAt(s, w).next().done;
  return people.map(p => {
    const come = Object.entries(p.arrives ?? {}).filter(([h, rest]) => !taken.has(h) && sentences.some(s => has(s, h) && rest.some(w => has(s, w))));
    return come.length ? { ...p, heads: { ...p.heads, ...Object.fromEntries(come) } } : p;
  });
}

/**
 * Everyone named in some words (lower case), where, and whether they're only mentioned there ("One
 * looks from Kell to you." mentions Kell): by a name, or by what they're called, their rank or what
 * they are, as "the boy" or beside another word of theirs ("a scrawny boy in enormous boots").
 */
function namedIn(words: string, people: Speaker[]): Array<{ id: string; at: number; mentioned: boolean }> {
  const out: Array<{ id: string; at: number; mentioned: boolean }> = [];
  for (const p of people) {
    let best: { at: number; mentioned: boolean } | undefined;
    const take = (at: number, mentioned: boolean) => { if (!best || (best.mentioned && !mentioned) || (best.mentioned === mentioned && at < best.at)) best = { at, mentioned }; };
    for (const n of p.names) for (const i of wordsAt(words, n)) take(i, MENTIONED.test(words.slice(0, i)));
    for (const [head, rest] of Object.entries(p.heads ?? {})) {
      for (const i of wordsAt(words, head)) {
        const before = words.slice(0, i);
        // "The King’s Road" and "the King’s investigator" aren't the King.
        if (THINGS_OF.test(words.slice(i + head.length))) continue;
        if (/\bthe\s+$/.test(before) || rest.some(w => [...wordsAt(words, w)].length)) take(i, MENTIONED.test(before.replace(/\bthe\s+$/, "")));
      }
    }
    if (best) out.push({ id: p.id, ...best });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * The first one named in some words who isn't only mentioned there ("One looks from Kell to you."
 * isn't Kell talking), and where: by a name, or by what they're called as "the boy" or beside
 * another word of it ("a scrawny boy in enormous boots").
 */
export function firstNamed(words: string, people: Speaker[]): { id: string; at: number } | undefined {
  const first = namedIn(words, people).find(n => !n.mentioned);
  return first ? { id: first.id, at: first.at } : undefined;
}

/** People the prose brings in without a name we know them by ("A porter turns.", "the old man"), and what they'd be called: a sentence's subject. */
const PERSON = "man|woman|boy|girl|lad|lass|child|gentleman|lady|fellow|stranger|figure|voice|someone|porter|clerk|guard|valet|servant|page|watchman|constable|soldier|sailor|bargee|bargeman|bargewoman|lighterman|docker|dockhand|dockman|regular|drinker|cook|maid|barmaid|landlady|landlord|forewoman|foreman|labourer|carter|urchin|beggar|vendor|seller|pie-seller|eel-wife";
const NEWCOMER = new RegExp(`^(?:then\\s+|and\\s+|but\\s+|now\\s+|behind\\s+\\w+,?\\s+|from\\s+[a-z ]{2,30},\\s+)?(?:the|a|an|one\\s+of\\s+the|another|some\\s+of\\s+the|two\\s+of\\s+the)\\s+(?:[a-z'-]+\\s+){0,3}?(${PERSON})(e?s)?\\b`);
const pronounOfNoun = (noun: string): Pronoun | undefined => (SHE_NOUN.test(noun) ? "she" : HE_NOUN.test(noun) ? "he" : undefined);

/**
 * Someone the prose brings in as a sentence's subject without a name we know them by ("A porter
 * turns toward the grille.", "One of the valets stops."), with their pronoun when the word says, and
 * whether it's several of them. Undefined for a sentence that doesn't.
 */
export function newcomer(sentence: string): { pronoun?: Pronoun; plural: boolean } | undefined {
  const m = NEWCOMER.exec(sentence.trim().toLowerCase());
  if (!m) return undefined;
  const pronoun = pronounOfNoun(m[1]!);
  return { ...(pronoun ? { pronoun } : {}), plural: !!m[2] && !/^one\b/.test(m[0]) };
}

const pronounWord = (w: string): Pronoun => (/^(she|her|hers)$/.test(w) ? "she" : "he");

/**
 * A sentence that goes on about someone already in it ("Her pencil stops.", "Then he sets it
 * down.", "For a moment, she says nothing.", "The book lies open before him; Sallow’s papers beside
 * it."): its subject "she" or "he", or a pronoun before anyone it names but as what's theirs or whom
 * it looks at. Which, or undefined for a sentence about someone it names ("Beneath him, a scrawny
 * boy lobs stones." is the boy's). One that names nobody who might speak goes on about whoever its
 * pronoun is ("At his boots, the mastiff opens one eye and sniffs." is still the watchman's: QA
 * round qa2-1018, where the line after it was nobody's).
 */
function leadingPronoun(sentence: string, people: Speaker[]): Pronoun | undefined {
  const s = sentence.toLowerCase().trimStart();
  const m = /^(?:(?:then|and|but|still|now|again|so|instead|slowly|finally|at last|at once|for a (?:moment|beat|while|heartbeat)|after a (?:moment|beat|while|pause)),?\s+)*(she|her|he|his)\b/.exec(s);
  if (m) return pronounWord(m[1]!);
  const p = /\b(she|her|hers|he|his|him)\b/.exec(s);
  if (!p || newcomer(s)) return undefined;
  const first = namedIn(s, people)[0];
  if (!first) return pronounWord(p[1]!);
  if (first.at < p.index) return undefined;
  return first.mentioned || /^[a-z-]+['’]s\b/.test(s.slice(first.at)) ? pronounWord(p[1]!) : undefined;
}

/** A line said, with who said it (when that's known), as the narration around it reads it. */
export interface Said { start: number; end: number; speaker?: string | undefined }

/**
 * Who "she" or "he" is just before `at`: the one the nearest sentence about someone of that pronoun
 * is about (its first one named who isn't only mentioned, else the first mentioned, or the speaker
 * of a line), walking back past the sentences that go on about them ("Her pencil stops.") and people
 * of the other one. Nobody when that sentence is about someone the prose doesn't name ("A woman steps
 * in."). `lines`: the lines said before it, and who said them.
 */
export function antecedent(text: string, at: number, pronoun: Pronoun, people: Speaker[], lines: Said[] = []): string | undefined {
  // Someone whose card doesn't say may be either; a group is neither.
  const fits = (id?: string) => { const p = people.find(x => x.id === id)?.pronoun; return p === pronoun || (p === undefined && !!id && id !== "you"); };
  const said = lines.filter(l => l.end <= at).sort((a, b) => a.start - b.start);
  // The reply before `at` as units, latest first: the lines said, and the narration's sentences between them.
  const units: Array<{ line?: Said; sentence?: string }> = [];
  let from = 0;
  const narrate = (to: number) => {
    for (const m of unquoted(text.slice(from, to)).matchAll(/[^.!?…\n]+(?:[.!?…]+[”"’)]*)?/g)) if (m[0].trim().length > 1) units.push({ sentence: m[0] });
  };
  for (const l of said) { narrate(l.start); units.push({ line: l }); from = l.end; }
  narrate(at);
  for (const u of units.reverse()) {
    if (u.line) {
      if (fits(u.line.speaker)) return u.line.speaker;
      continue;
    }
    const s = u.sentence!.toLowerCase();
    // A sentence that goes on about someone already in it: back to the one before.
    if (leadingPronoun(s, people)) continue;
    const named = namedIn(s, people).filter(n => fits(n.id));
    const subject = named.find(n => !n.mentioned) ?? named[0];
    if (subject) return subject.id;
    const someone = newcomer(s);
    if (someone && !someone.plural && (!someone.pronoun || someone.pronoun === pronoun)) return undefined;
  }
  return undefined;
}

/** The words straight after a quote that may be its speech tag: up to the end of the paragraph, and never into the next line said. */
const tagAfter = (text: string, end: number) => text.slice(end, end + 60).split(/\n|[“"]/)[0]!.toLowerCase();

/**
 * Who the speech tag straight after a quote ending at `end` says spoke it: "you" for the player's
 * own words ("…,” you add), or someone it names ("…,” says the landlady), whoever else is about
 * ("she says, without looking at Hobb" isn't Hobb). Only in the same paragraph, before the next
 * line. Undefined when there's none.
 */
export function speechTagged(text: string, end: number, people: Speaker[]): string | undefined {
  const after = tagAfter(text, end);
  if (YOU_SAY.test(after)) return "you";
  return people.find(p => p.names.some(n => taggedBy(after, n)) || Object.keys(p.heads ?? {}).some(h => taggedBy(after, h, true)))?.id;
}

/**
 * A speech tag after a quote that names someone, but nobody `speechTagged` knows ("…,” the big man
 * says, quietly" before he's known by it; "…?” a voice asks"): the line is theirs, whoever they
 * are, so not the lead-in's subject's or the last speaker's (QA round qa2-1018: the big man's "Not
 * tonight, Arlo," went to Arlo, whom the sentence before was about). Only after a line that ends as
 * one a tag follows does (",", "?", "!", a dash): after a full stop, the words are a new sentence.
 */
export function strangerTagged(text: string, end: number): boolean {
  if (!/[,?!—–…-]\s*[”"]$/.test(text.slice(Math.max(0, end - 3), end))) return false;
  const after = tagAfter(text, end);
  return new RegExp(`^[^a-z]*(?:the|a|an|one|another|some|someone|somebody|voices?)\\b[^.!?;:]{0,40}?\\s(?:${SPEECH})\\b|^[^a-z]*(?:${SPEECH})\\s+(?:the|a|an|one|another|someone|somebody)\\b`).test(after);
}

/** A speech tag after a quote that's only "she says" or "he blurts": which. */
export function pronounTagged(text: string, end: number): Pronoun | undefined {
  const m = new RegExp(`^[^a-z]*(she|he)\\s+(?:${SPEECH})\\b`).exec(tagAfter(text, end));
  return m ? (m[1] as Pronoun) : undefined;
}

/**
 * Who says the quote at text[start, end) (its quote marks included): whoever the speech tag after
 * it says (speechTagged, or the one its "she says" means), else the one the sentence leading in is
 * about: the first named there who isn't only mentioned, or, for a sentence that goes on about
 * "her" or "him" ("Her eyes flick to Sergeant Kell’s notebook."), the one that means. Undefined when
 * the prose doesn't say. `lines`: the lines said before it and who said them, which "she" may mean.
 */
export function quoteSpeaker(text: string, start: number, end: number, people: Speaker[], lines: Said[] = []): string | undefined {
  const tagged = speechTagged(text, end, people);
  if (tagged) return tagged;
  const pronoun = pronounTagged(text, end);
  if (pronoun) return antecedent(text, start, pronoun, people, lines);
  // Its tag names someone nobody here is known as: theirs, not the sentence before's.
  if (strangerTagged(text, end)) return undefined;
  // The sentence leading into the quote: the one it's in, or the one before when it opens one (a
  // sentence ends at its stop, its closing quote included, and an earlier line's words don't count).
  // A line that opens its paragraph after one that ended on a line said has none.
  const window = text.slice(Math.max(0, start - 200), start);
  if (/[”"]\s*\n\s*$/.test(window)) return undefined;
  // Only the narration since the line before, when there is some: blanked out, that line's closing
  // stop went with it, and "…shut!” Hobb lowers his voice." read as one sentence that Hep began.
  const since = window.slice(Math.max(window.lastIndexOf("”"), window.lastIndexOf("\"")) + 1);
  const before = /[.!?…]/.test(since) || since.trim().length > 2 ? since : window;
  const sentences = unquoted(before.toLowerCase()).split(/(?<=[.!?…:][”"’]?)\s+|\n+/);
  const lead = (sentences.at(-1)?.trim() ? sentences.at(-1) : sentences.at(-2)) ?? "";
  const going = leadingPronoun(lead, people);
  if (going) return antecedent(text, start, going, people, lines);
  return firstNamed(lead, people)?.id;
}

/**
 * Who a speaker's tag means ("Kell", "Sergeant Agnes Kell", "the landlady", "the King", "you"): the
 * whole name first, then a distinctive part of it; what they're called by its head word, their rank
 * or what they are only as "the boy" ("[Porter]" or "[A porter]" is a porter, not the big porter with
 * the bandaged hand), and only for someone here. Undefined for nobody here (a passer-by the GM made up).
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
  // Their head word last ("[the big porter]"), or the two of one that's two ("[the big man]").
  return people.find(p => Object.keys(p.heads ?? {}).some(h => bare === h || bare.endsWith(` ${h}`)))?.id;
}
