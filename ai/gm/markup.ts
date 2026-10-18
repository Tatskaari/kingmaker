// Copied from the prototype's src/runtime/markup.ts at 44c6d4a, all but markupLines (the QA console's); its types are v2/shared/markup.ts's, imported.
import { antecedent, arrived, firstNamed, newcomer, pronounTagged, quoteSpeaker, SPEECH, speechTagged, tagSpeaker, type Pronoun, type Speaker } from "./speakers.ts";
import { MARK_KINDS, type Mark, type MarkKind, type Marked, type Markup, type Speech } from "../../shared/markup.ts";

export { MARK_KINDS, type Mark, type MarkKind, type Marked, type Markup, type Speech };

/**
 * The GM's markup: what a reply says beyond its words, for the screen (each person's lines in
 * their own colour, and phrases the player can click to see what's behind them). It's never shown
 * as written. Anything in square brackets is for the screen; a marked phrase is in round ones:
 *
 *   [Kell] “On what evidence?”                         who says the line that follows
 *   (she won't serve you)[why: You called her pies…]   a note on a phrase: why, know or you
 *
 * The kinds: `why` (someone refuses, bristles or helps because of the player's past, a side, a
 * prejudice or custom of the world, or a law), `know` (what the player's character would know and
 * a newcomer wouldn't) and `you` (one of the player's own past acts).
 *
 * The model drifts, so what it drifts to is taken too: Markdown's order ([phrase](why: …)), both in
 * square brackets ([phrase][why: …]), a space between the phrase and its note, a note with no kind
 * (a reason), and a note written on a line of its own after the reply, or just after the sentence
 * that said its phrase, its phrase copied from the reply (which lights up the phrase where it
 * already stands).
 *
 * Parsed as the reply streams (`final: false`), what's shown only ever grows: a bracket that might
 * be markup holds back what follows it until it's clear, and markup never shows. What's malformed
 * falls back to plain words: a phrase whose note never came is shown as written, without its
 * brackets; a tag with no line after it, or a note with no phrase, disappears; a note that never
 * closes is hidden to the end of its line. Brackets that are only brackets ("(I cast Fireball)")
 * are shown as they are.
 */

/** How the reply kept to the markup (for the evals, and a turn's metric). */
export interface MarkupStats {
  /** Spoken lines, and those the GM tagged with their speaker. */
  quotes: number;
  tagged: number;
  /** Notes taken, by kind. */
  marks: number;
  kinds: Record<MarkKind, number>;
  /** Notes with no kind, taken as reasons. */
  unlabelled: number;
  /** Notes left out: no phrase, an empty note, a standalone note whose phrase isn't in the reply. */
  dropped: number;
  /** Markup that fell back to plain words or vanished: an unclosed note, a stray tag, a phrase with no note. */
  malformed: number;
}

export const emptyStats = (): MarkupStats => ({ quotes: 0, tagged: 0, marks: 0, kinds: { why: 0, know: 0, you: 0 }, unlabelled: 0, dropped: 0, malformed: 0 });

/** Several replies' stats as one (a turn's), or undefined when there were none. */
export function sumStats(all: Array<MarkupStats | undefined>): MarkupStats | undefined {
  const some = all.filter((s): s is MarkupStats => !!s);
  if (!some.length) return undefined;
  const out = emptyStats();
  for (const s of some) {
    out.quotes += s.quotes; out.tagged += s.tagged; out.marks += s.marks; out.unlabelled += s.unlabelled; out.dropped += s.dropped; out.malformed += s.malformed;
    for (const k of MARK_KINDS) out.kinds[k] += s.kinds[k];
  }
  return out;
}

/** The words a note can start with to say its kind (and what the model sometimes writes instead), on the bracket's own line. */
const LABEL = /^[ \t]*(why|know|you|because|reason|known|remember)\s*:\s*/i;
const KIND_OF: Record<string, MarkKind> = { why: "why", because: "why", reason: "why", know: "know", known: "know", you: "you", remember: "you" };
/** A marked phrase or a speaker's tag: a few words, on one line. */
const PHRASE_MAX = 160;
/** A note: a sentence or two. */
const NOTE_MAX = 700;

const isOpening = (c: string | undefined) => c === "“" || c === "\"";
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
/** A speaker's tag ("Kell", "the woman with the silver dice", "you"), not a phrase of prose. */
const tagLike = (s: string) => { const t = s.trim(); return t.length > 0 && t.length <= 60 && words(t) <= 7 && !/[.!?;“”"]/.test(t); };
/** A tag that's someone's name or what they're called ("Kell", "the pie-seller"), not words of prose ("and a sigh"). */
const nameLike = (s: string) => tagLike(s) && /^\s*(?:[A-Z@]|(?:the|a|an|you|your)\b)/.test(s);

type Close = { at: number } | "pending" | "none";

/**
 * The bracket closing the one just before `from`, within `max` characters and on the same line
 * (brackets of the same kind nest). "pending" when the text so far ends before it could tell.
 */
function closeOf(raw: string, from: number, open: string, close: string, max: number, final: boolean): Close {
  let depth = 0;
  const limit = Math.min(raw.length, from + max);
  for (let k = from; k < limit; k++) {
    const c = raw[k]!;
    if (c === "\n") return "none";
    if (c === open) depth++;
    else if (c === close) { if (depth === 0) return { at: k }; depth--; }
  }
  return !final && raw.length < from + max ? "pending" : "none";
}

/** The words that tell a phrase apart ("goblins", "scatter"; not "the", "with"), roughly stemmed. */
const keyWords = (s: string) => new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(w => !/^(that|this|with|from|your|they|them|their|there|then|than|have|been|were|what|when|where|which|into|just|only|very|some|said|says)$/.test(w)).map(w => w.replace(/(?:ing|ed|es|s)$/, "")));

/** The sentence of the text a stray phrase is about: the one sharing most of its words (the latest, on a tie), or none. */
function sentenceAbout(text: string, phrase: string): { start: number; end: number } | undefined {
  const want = keyWords(phrase);
  let best: { start: number; end: number; score: number } | undefined;
  for (const m of text.matchAll(/[^.!?…\n]+(?:[.!?…]+[”"’]?)?/g)) {
    const lead = m[0].length - m[0].trimStart().length;
    const body = m[0].trim();
    if (body.length < 3) continue;
    const score = [...keyWords(body)].filter(w => want.has(w)).length;
    if (score > 0 && (!best || score >= best.score)) best = { start: m.index + lead, end: m.index + lead + body.length, score };
  }
  return best ? { start: best.start, end: best.end } : undefined;
}

/** A label after a finished sentence ("…again.” (the goblins scatter)[why: …]"): lower case where a sentence should start, and no speech tag ("she says"). */
const labelAfter = (shown: string, phrase: string) => /[.!?…]["”’)]*\s*$/.test(shown) && /^\s*[a-z]/.test(phrase) && !new RegExp(`^\\s*(?:[a-z']+\\s+)?(?:${SPEECH})\\b`).test(phrase);

const fold = (c: string) => (c === "“" || c === "”" ? "\"" : c === "’" || c === "‘" ? "'" : c.toLowerCase());
/** Where a phrase already stands in the text (quotes and case aside), or -1. */
function phraseIn(text: string, phrase: string): number {
  const p = [...phrase].map(fold).join("");
  const t = [...text].map(fold).join("");
  return p.length >= 3 ? t.lastIndexOf(p) : -1;
}

/** A spoken line still open: the quote that opened it, and the closing quote it has twice when its tag came inside its quotes. */
type OpenLine = Speech & { by: string; twice?: string };
/** An open line as a spoken line. */
const lineOf = ({ by, twice, ...line }: OpenLine): Speech => { void by; void twice; return line; };
/** A spoken line with words in it (not a quote mark left on its own). */
const hasWords = (text: string, s: Speech) => /[\p{L}\p{N}]/u.test(text.slice(s.start, s.end));

/** What parsing builds: the words shown, the spoken lines, the notes. */
class Reply {
  text = "";
  speech: Speech[] = [];
  marks: Mark[] = [];
  stats = emptyStats();
  /** A spoken line still open, the quote that opened it, and the closing quote it came with twice (its tag inside its quotes: “[Kell] “No.””). */
  open: OpenLine | undefined;
  /** A speaker's tag waiting for its line. */
  tag: string | undefined;
  /** A closing quote that came twice, to be dropped if it's next. */
  private swallow: string | undefined;

  char(c: string): void {
    // A reply starts with its first word (whatever markup came before it).
    if (!this.text && /\s/.test(c)) return;
    if (this.swallow) {
      const s = this.swallow;
      this.swallow = undefined;
      if (c === s || (s === "”" && c === "\"")) return;
    }
    if (c === "\n" && this.open && this.text.endsWith("\n")) this.close();
    if (c === "“" || c === "”" || c === "\"") this.quote(c);
    else this.text += c;
  }

  emit(s: string): void { for (const c of s) this.char(c); }

  private close(): void {
    const o = this.open!;
    o.end = Math.max(o.start + 1, this.text.trimEnd().length);
    this.speech.push(lineOf(o));
    this.open = undefined;
  }

  private quote(c: string): void {
    if (this.open) {
      if (c === "”" || (c === "\"" && this.open.by === "\"")) {
        this.text += c;
        this.open.end = this.text.length;
        const twice = this.open.twice;
        this.close();
        if (twice === "”" || twice === "\"") this.swallow = twice;
        return;
      }
      // A new line opened while one is open: the last never closed.
      if (c === "“") this.close();
      else { this.text += c; return; }
    }
    if (isOpening(c)) {
      this.stats.quotes++;
      if (this.tag) this.stats.tagged++;
      this.open = { start: this.text.length, end: this.text.length + 1, by: c, ...(this.tag ? { tag: this.tag } : {}) };
      this.tag = undefined;
    }
    this.text += c;
  }

  /**
   * A note on a phrase: on the phrase where it's written. A phrase astray, that isn't words of the
   * reply (a note on a line of its own, or a label after a finished sentence: “They'll come again.”
   * (the goblins scatter)[why: …]), isn't shown: its note goes on the phrase where it already
   * stands, or on the sentence it's about (the one with most of its words), or nowhere.
   */
  mark(phrase: string, kind: MarkKind, note: string, astray: boolean | "own line"): boolean {
    const n = note.trim().replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "");
    const p = phrase.trim();
    if (astray) {
      const at = phraseIn(this.text, p);
      const about = at >= 0 ? { start: at, end: at + p.length } : sentenceAbout(this.text, p);
      if (about && n) { this.add({ ...about, kind, note: n }); return false; }
      // A note on a line of its own about nothing in the reply: its words are shown, rather than lost.
      if (astray !== "own line" || !n) { this.stats.dropped++; return false; }
    }
    // Inline: the words are shown, marked.
    const lead = phrase.length - phrase.trimStart().length;
    const start = this.text.length + lead;
    this.emit(phrase);
    const end = this.text.trimEnd().length;
    if (!n || end <= start) { this.stats.dropped++; return true; }
    this.add({ start, end, kind, note: n });
    return true;
  }

  /** The line just said (the text ends with its closing quote), or else the sentence just ended; nothing mid-sentence. */
  lastSaid(): { start: number; end: number } | undefined {
    const end = this.text.trimEnd().length;
    const line = this.speech.at(-1);
    if (line && line.end === end && /[”"]$/.test(this.text.slice(0, end))) return { start: line.start, end };
    if (!/[.!?…]["”’)]*$/.test(this.text.slice(0, end))) return undefined;
    const before = this.text.slice(0, end).replace(/[.!?…]["”’)]*$/, "");
    const start = Math.max(before.lastIndexOf("\n"), ...[...before.matchAll(/[.!?…]["”’)]*\s+/g)].map(m => m.index + m[0].length - 1)) + 1;
    const lead = this.text.slice(start, end).length - this.text.slice(start, end).trimStart().length;
    return start + lead < end ? { start: start + lead, end } : undefined;
  }

  add(m: Mark): void {
    if (this.marks.some(o => m.start < o.end && o.start < m.end)) { this.stats.dropped++; return; }
    this.marks.push(m);
    this.stats.marks++;
    this.stats.kinds[m.kind]++;
  }
}

const HOLD = -1;

/**
 * A marked sentence the model wrote without its full stop ("(She takes your coins as if they
 * hurt)[why: …] The dog…"): it needs its stop back, where the next sentence starts straight after.
 */
function stopless(phrase: string, after: string): boolean {
  const p = phrase.trimEnd();
  if (/[.!?…,;:—–”"’')]$/.test(p) || words(p) < 3) return false;
  // The next sentence straight after; or the paragraph (or the reply) ending on a sentence of its own.
  return /^[ \t]*[A-Z“"]/.test(after) || (/^[ \t]*(\n|$)/.test(after) && /^\s*[A-Z“"]/.test(p));
}

/**
 * Parse a reply's markup. `final`: the reply is complete; otherwise what can't be told yet is held
 * back (`pending`) and a spoken line still open is reported as far as it's come. Speakers are the
 * tags as written: `withSpeakers` says who they are.
 */
export function parseMarkup(written: string, options: { final?: boolean } = {}): Marked & { pending: boolean; stats: MarkupStats } {
  const final = options.final ?? true;
  const r = new Reply();
  // Markdown's bold (**CAERWYN — 7 MILES**) is read without its stars; as it streams, a star that
  // may be the first of two waits for the next.
  const bolded = written.replace(/\*\*|__/g, "");
  const raw = !final && /(?<![*_])[*_]$/.test(bolded) && /[*_]$/.test(written) ? bolded.slice(0, -1) : bolded;

  /** Past markup that vanished: a space after it goes too, when there's one before it (no double spaces); at a line's end, the space before it. */
  const gap = (k: number): number => {
    if (raw[k] === "\n") r.text = r.text.replace(/[ \t]+$/, "");
    return raw[k] === " " && (!r.text || /\s$/.test(r.text)) ? k + 1 : k;
  };
  /** The end of the line from `from` (hidden up to there), or held while it hasn't come. */
  const lineEnd = (from: number): number => {
    const end = raw.indexOf("\n", from);
    if (end >= 0) return end;
    return final ? raw.length : HOLD;
  };
  /**
   * A phrase that was just said, written again as a label for its note ("…in the tally loft.” [The
   * tally loft][know: …]"): its words already stand in the reply, it comes after a finished sentence,
   * and the words after it don't carry that sentence on. Its note goes where the words stand.
   */
  const saidBefore = (phrase: string, after: string): boolean => phraseIn(r.text, phrase.trim()) >= 0 && /[.!?…]["”’)]*\s*$/.test(r.text) && !/^\s*[a-z,;:]/.test(after);
  /** Is the note that closes at `close` on a line of its own (its phrase begins one at `open`)? */
  const alone = (open: number, close: number): boolean | "hold" => {
    const before = raw.slice(0, open).replace(/[ \t]+$/, "");
    if (before && !before.endsWith("\n")) return false;
    const after = raw.slice(close + 1);
    if (!after.trim() && !final) return "hold";
    return /^[ \t]*(\n|$)/.test(after);
  };

  /** A note in round brackets, (why: …), or in both, [(why: …)], with nothing after it: on the line or the sentence just said, never shown. */
  const noteAfter = (label: RegExpExecArray, note: string): void => {
    const last = r.lastSaid();
    const n = note.trim().replace(/\s+/g, " ");
    if (last && n) r.add({ ...last, kind: KIND_OF[label[1]!.toLowerCase()]!, note: n });
    // A note with nothing before it to hang on: never shown.
    else r.stats.dropped++;
  };

  /** At a "(": a note in the sketch's order, (phrase)[kind: note], a note in round brackets, or just brackets. */
  const round = (i: number): number => {
    const plain = () => { r.char("("); return i + 1; };
    // Its kind first, (why: …): a note, in the wrong brackets.
    const note = LABEL.exec(raw.slice(i + 1, i + 17));
    const c = closeOf(raw, i + 1, "(", ")", note ? NOTE_MAX : PHRASE_MAX, final);
    if (c === "pending") return HOLD;
    if (c === "none") {
      if (note) { r.stats.malformed++; return lineEnd(i); }
      return plain();
    }
    if (note) { noteAfter(note, raw.slice(i + 1 + note[0].length, c.at)); return gap(c.at + 1); }
    const phrase = raw.slice(i + 1, c.at);
    let k = c.at + 1;
    if (raw[k] === " " && (raw[k + 1] === "[" || (k + 1 >= raw.length && !final))) k++;
    if (k >= raw.length) return final ? plain() : HOLD;
    if (raw[k] !== "[") return plain();
    const n = closeOf(raw, k + 1, "[", "]", NOTE_MAX, final);
    if (n === "pending") return HOLD;
    const label = LABEL.exec(raw.slice(k + 1, k + 17));
    if (label && n === "none") {
      // A note that never closes: the phrase as plain words, the note hidden to the end of its line.
      r.emit(phrase);
      r.stats.malformed++;
      return lineEnd(k);
    }
    if (n === "none") return plain();
    const inner = raw.slice(k + 1, n.at);
    if (!label && (words(inner) <= 3 || tagLike(inner) && words(inner) <= 4)) return plain();
    const lone = alone(i, n.at);
    if (lone === "hold") return HOLD;
    if (!final && !raw.slice(n.at + 1).trim()) return HOLD;
    if (!label) r.stats.unlabelled++;
    const astray = lone ? "own line" : labelAfter(r.text, phrase) || saidBefore(phrase, raw.slice(n.at + 1));
    const shown = r.mark(phrase, label ? KIND_OF[label[1]!.toLowerCase()]! : "why", label ? inner.slice(label[0].length) : inner, astray);
    if (!astray && stopless(phrase, raw.slice(n.at + 1))) r.char(".");
    return shown ? n.at + 1 : gap(n.at + 1);
  };

  /** At a "[": a speaker's tag, a note in Markdown's order, a note with no phrase, or just a bracket. */
  const square = (i: number): number => {
    const c = closeOf(raw, i + 1, "[", "]", NOTE_MAX, final);
    if (c === "pending") return HOLD;
    // A note in both kinds of bracket, [(why: …)], is read as [why: …].
    const lead = raw[i + 1] === "(" && LABEL.test(raw.slice(i + 2, i + 18)) ? 1 : 0;
    const label = LABEL.exec(raw.slice(i + 1 + lead, i + 17 + lead));
    if (c === "none") {
      if (label) { r.stats.malformed++; return lineEnd(i); }
      r.char("[");
      return i + 1;
    }
    const inner = raw.slice(i + 1, c.at);
    if (label) {
      const said = inner.slice(lead + label[0].length);
      const note = lead ? said.replace(/\)\s*$/, "") : said;
      // The note first and its phrase after, [why: …](she won't serve you): the phrase takes it.
      const p = raw[c.at + 1] === "(" ? c.at + 1 : raw[c.at + 1] === " " && raw[c.at + 2] === "(" ? c.at + 2 : -1;
      if (!final && (c.at + 1 >= raw.length || (raw[c.at + 1] === " " && c.at + 2 >= raw.length))) return HOLD;
      if (p >= 0) {
        const n = closeOf(raw, p + 1, "(", ")", PHRASE_MAX, final);
        if (n === "pending") return HOLD;
        if (n !== "none") return r.mark(raw.slice(p + 1, n.at), KIND_OF[label[1]!.toLowerCase()]!, note, labelAfter(r.text, raw.slice(p + 1, n.at))) ? n.at + 1 : gap(n.at + 1);
      }
      // A note straight after a line or a sentence, with no words of its own in brackets
      // ([Dab] “Not you, now.”[why: …]): it's on the line, or the sentence, just said.
      noteAfter(label, note);
      return gap(c.at + 1);
    }
    const k = c.at + 1;
    if (k >= raw.length && !final) return HOLD;
    // Markdown's order: [phrase](kind: note); not a tag before a marked line, [Kell] (“Not you.”)[why: …].
    const p = raw[k] === "(" ? k : raw[k] === " " && raw[k + 1] === "(" ? k + 1 : -1;
    if (raw[k] === " " && k + 1 >= raw.length && !final) return HOLD;
    if (p >= 0 && p + 1 >= raw.length && !final) return HOLD;
    if (p >= 0 && !isOpening(raw[p + 1])) {
      const n = closeOf(raw, p + 1, "(", ")", NOTE_MAX, final);
      if (n === "pending") return HOLD;
      const lab = LABEL.exec(raw.slice(p + 1, p + 17));
      if (lab && n === "none") { r.emit(inner); r.stats.malformed++; return lineEnd(p); }
      if (n !== "none" && (lab || words(raw.slice(p + 1, n.at)) > 3)) {
        const lone = alone(i, n.at);
        if (lone === "hold") return HOLD;
        if (!final && !raw.slice(n.at + 1).trim()) return HOLD;
        if (!lab) r.stats.unlabelled++;
        const astray = lone ? "own line" : labelAfter(r.text, inner) || saidBefore(inner, raw.slice(n.at + 1));
        const shown = r.mark(inner, lab ? KIND_OF[lab[1]!.toLowerCase()]! : "why", raw.slice(p + 1 + (lab ? lab[0].length : 0), n.at), astray);
        if (!astray && stopless(inner, raw.slice(n.at + 1))) r.char(".");
        return shown ? n.at + 1 : gap(n.at + 1);
      }
    }
    // Both in square brackets, [phrase][kind: note] (the note's kind tells it from a tag): the
    // phrase's words where they're written, or a label on words just said.
    const s = raw[k] === "[" ? k : raw[k] === " " && raw[k + 1] === "[" ? k + 1 : -1;
    if (s >= 0 && inner.length <= PHRASE_MAX) {
      const n = closeOf(raw, s + 1, "[", "]", NOTE_MAX, final);
      if (n === "pending") return HOLD;
      const lab = LABEL.exec(raw.slice(s + 1, s + 17));
      if (lab && n === "none") { r.emit(inner); r.stats.malformed++; return lineEnd(s); }
      if (lab && n !== "none") {
        const lone = alone(i, n.at);
        if (lone === "hold") return HOLD;
        const after = raw.slice(n.at + 1);
        if (!final && !after.trim()) return HOLD;
        const astray = lone ? "own line" : labelAfter(r.text, inner) || saidBefore(inner, after);
        const shown = r.mark(inner, KIND_OF[lab[1]!.toLowerCase()]!, raw.slice(s + 1 + lab[0].length, n.at), astray);
        if (!astray && stopless(inner, after)) r.char(".");
        return shown ? n.at + 1 : gap(n.at + 1);
      }
    }
    // A speaker's tag: just before a spoken line (after a space or a colon), or before a marked one.
    let q = k;
    while (q < raw.length && (raw[q] === " " || raw[q] === "\t" || raw[q] === ":")) q++;
    if (q >= raw.length && !final) return HOLD;
    if (raw[q] === "(" && q + 1 >= raw.length && !final) return HOLD;
    // Just inside a line that has only just opened (“[Kell] Not for you”): the tag for it. When the
    // line's own quote comes after the tag (“[Kell] “No.”” or “[Kell] ‘No.’”), one pair goes: the
    // quote after it, and the one that closes it.
    const inside = r.open && !r.open.tag && r.open.start === r.text.length - 1 && tagLike(inner) ? r.open : undefined;
    if (inside && (raw[q] === "“" || raw[q] === "\"" || raw[q] === "‘")) {
      inside.tag = inner.trim();
      inside.twice = raw[q] === "‘" ? "’" : raw[q] === "“" ? "”" : "\"";
      r.stats.tagged++;
      return q + 1;
    }
    if ((isOpening(raw[q]) || (raw[q] === "(" && isOpening(raw[q + 1]))) && tagLike(inner)) { r.tag = inner.trim(); return q; }
    if (inside) {
      inside.tag = inner.trim();
      r.stats.tagged++;
      return raw[k] === " " ? k + 1 : k;
    }
    // At the end of a line of text, just after a spoken line that had none (“Not for you.” [Kell]): the tag for it.
    const line = r.speech.at(-1);
    if (line && !line.tag && !r.open && line.end === r.text.trimEnd().length && (q >= raw.length || raw[q] === "\n") && tagLike(inner)) {
      line.tag = inner.trim();
      r.stats.tagged++;
      return gap(k);
    }
    // Anything else: a tag with no line after it disappears; other words in square brackets are
    // read without them, markup and all ([(Able, perhaps.)[why: …]]); and a tag that's the subject
    // of its sentence ("“…hid.” [Kell] taps her pencil", "[Kell]’s pencil stops") is its words.
    r.stats.malformed++;
    if (!nameLike(inner)) { unbracket.add(c.at); return i + 1; }
    if (/^[a-z]|^['’]s\b/.test(raw.slice(q))) { r.emit(inner.trim()); return k; }
    return gap(k);
  };

  /** The closing brackets of words read without their brackets. */
  const unbracket = new Set<number>();
  let i = 0;
  let pending = raw.length < bolded.length;
  while (i < raw.length) {
    const ch = raw[i]!;
    // A line whose tag came inside its quotes, with its own in single ones (“[Kell] ‘No.’”): the
    // single quote that closes it goes (held until it's clear it's not an apostrophe).
    if (ch === "’" && r.open?.twice === "’") {
      if (i + 1 >= raw.length && !final) { pending = true; break; }
      if (raw[i + 1] === "”" || raw[i + 1] === "\"") { i++; continue; }
    }
    const next = unbracket.has(i) ? i + 1 : ch === "(" ? round(i) : ch === "[" ? square(i) : (r.char(ch), i + 1);
    if (next === HOLD) { pending = true; break; }
    i = next;
  }
  const speech = [...r.speech];
  if (r.open) speech.push({ ...lineOf(r.open), end: Math.max(r.open.start + 1, r.text.trimEnd().length) });
  let text = r.text;
  if (final) text = text.trimEnd();
  return {
    text,
    speech: speech.map(s => ({ ...s, end: Math.min(s.end, text.length) })).filter(s => s.end > s.start && hasWords(text, s)),
    marks: r.marks.map(m => ({ ...m, end: Math.min(m.end, text.length) })).filter(m => m.end > m.start).sort((a, b) => a.start - b.start),
    pending,
    stats: r.stats,
  };
}

/** The plain words of a reply, its markup gone. */
export const stripMarkup = (raw: string) => parseMarkup(raw).text;

/**
 * The spoken lines in words that have no markup (a reply from before it, or the GM offline), as
 * offsets into those words, which are left exactly as they are: quotes only, brackets left alone.
 */
export function speechIn(text: string): Speech[] {
  const r = new Reply();
  r.text = text.slice(0, text.length - text.trimStart().length);
  r.emit(text.trimStart());
  const speech = [...r.speech];
  if (r.open) speech.push({ ...lineOf(r.open), end: Math.max(r.open.start + 1, r.text.trimEnd().length) });
  return speech.filter(s => s.end > s.start && hasWords(text, s));
}

/**
 * Who says each line: the tag the GM wrote; else as the prose says, the speech tag after it (in its
 * paragraph: "…,” Nan says, or the one a "…,” he blurts" means); else the one who said the line
 * before, when only a speech tag ("…,” she says, “…”) or a pause ("A beat.") comes between; else the
 * one the sentence leading in is about (the first named there who isn't only looked at, or the one
 * its "she" means: "Her eyes flick to Sergeant Kell’s notebook." isn't Kell); else, after narration
 * that goes on about someone only as "she" or "he", the one who said the last line, when that's who
 * the pronoun can be and nobody new has come into it ("The boy stops."). Nobody, rather than a guess.
 * Words quoted in narration rather than said ("At “the Purveyor's office,” her pencil stills.", "each
 * marked “lost to goblins”", "At the bottom: “Not goblins.”") are nobody's line, or the player's own
 * when they echo `player`, the player's latest turn.
 */
export function withSpeakers(marked: Marked, everyone: Speaker[], options: { player?: string | undefined } = {}): Marked {
  // Someone away whom the narration brings in by what they're called is known by it.
  const people = arrived(everyone, marked.text);
  const speech: Speech[] = [];
  const pronounOf = (id?: string) => people.find(p => p.id === id)?.pronoun;
  let prev: Speech | undefined;
  for (const s of marked.speech) {
    if (!s.tag && notSaid(marked.text, s)) {
      if (options.player && echoes(marked.text.slice(s.start, s.end), options.player)) speech.push({ ...s, speaker: "you" });
      continue;
    }
    let id = s.tag ? tagSpeaker(s.tag, people) : speechTagged(marked.text, s.end, people);
    const between = prev ? marked.text.slice(prev.end, s.start) : "";
    const carried = !s.tag && prev?.speaker ? prev.speaker : undefined;
    const fits = (p: Pronoun | undefined) => !p || !pronounOf(carried) || pronounOf(carried) === p;
    // "…,” he blurts: whoever he is.
    const told = !id && !s.tag ? pronounTagged(marked.text, s.end) : undefined;
    if (told) id = carried && carried !== "you" && pronounOf(carried) === told && !named(between, people) && !newcomerIn(between) ? carried : antecedent(marked.text, s.start, told, people, speech);
    if (!id && !told && carried && ((continues(between, people) && fits(attributed(between))) || pause(between, people))) id = carried;
    if (!id && !told && !s.tag) id = quoteSpeaker(marked.text, s.start, s.end, people, speech);
    // Untold, after a "she" or a "he" that can be them and nobody else named since the last line: the one who said it.
    if (!id && !told && carried && carried !== "you" && pronounOnly(between, people, pronounOf(carried))) id = carried;
    const line = id ? { ...s, speaker: id } : { ...s };
    speech.push(line);
    prev = line;
  }
  return { ...marked, speech };
}

/** Someone named in some words, as more than a mention ("Kell turns", not "Her gaze settles on Kell"). */
const named = (words: string, people: Speaker[]) => !!firstNamed(words.toLowerCase(), people);

/** Narration's sentences. */
const sentencesOf = (words: string) => words.match(/[^.!?…\n]+(?:[.!?…]+[”"’)]*)?/g) ?? [];
/** Someone the narration brings in that we can't name ("The boy stops at your crown.", "A woman steps in."), who might be the one talking. */
const newcomerIn = (words: string) => sentencesOf(words).some(s => { const n = newcomer(s); return n && !n.plural; });

/** The pronoun narration goes on with (its first "she", "her", "he", "his" or "him"). */
function pronounIn(words: string): Pronoun | undefined {
  const m = /\b(she|her|hers|he|his|him)\b/.exec(words.toLowerCase());
  return m ? (/^(she|her|hers)$/.test(m[1]!) ? "she" : "he") : undefined;
}

/**
 * Narration that goes on about someone only as "she" or "he" (no one else named in it, nobody
 * brought in), a short paragraph at most, with the pronoun the speaker has (`pronoun`, when known).
 */
function pronounOnly(between: string, people: Speaker[], pronoun: Speaker["pronoun"]): boolean {
  const b = between.toLowerCase();
  const said = pronounIn(between);
  return between.length <= 240 && !!said && (!pronoun || said === pronoun) && !/\byou\s+(say|said|ask|asked|answer|reply)/.test(b) && !named(between, people) && !newcomerIn(between);
}

/** Narration that's only a pause ("A beat.", "A long pause.", "Then:", "—"). */
const PAUSE = /^(?:[—–\-…,;:]*|(?:(?:a|an|another|one)\s+)?(?:[a-z]+\s+)?(?:beat|pause|moment|breath|silence|heartbeat|sigh|shrug|nod|blink)s?\b[^.!?\n]{0,20}[.!?…:—–-]*|(?:then|and then|still|again|nothing|silence)[.!?…:—–,-]*)$/i;
/** A pause between two lines in a paragraph: the same speaker goes on. */
const pause = (between: string, people: Speaker[]) => !between.includes("\n") && PAUSE.test(between.trim()) && !named(between, people);

/** A speech tag with no one named in it, that carries a speaker on to their next line: “…,” she says, not looking up, “…” */
const ATTRIBUTION = new RegExp(`^[\\s,;:—–-]*(?:she|he|they|it)\\s+(?:${SPEECH})\\b[^.!?“”"\\n]{0,50}[.!?,;:—–-]?\\s*$`, "i");
/** The pronoun of a speech tag between two lines ("she says"), if it has one. */
const attributed = (between: string): Pronoun | undefined => { const m = /^[\s,;:—–-]*(she|he)\b/i.exec(between); return m ? (m[1]!.toLowerCase() as Pronoun) : undefined; };

/** Narration between two lines that only carries one speaker on to the next. */
function continues(between: string, people: Speaker[]): boolean {
  return ATTRIBUTION.test(between) && !named(between, people);
}

/** Words that, just before a quote, make it words mentioned in the sentence rather than a line said: "at “…”", "the word “…”", "each “lost” wagon", "the crowd’s “lost to goblins!”". */
const MENTION = /(?:^|[\s(])(?:at|of|on|in|for|from|to|with|like|as|than|the|word|words|called|named|about|into|onto|upon|each|every|its|their|his|her|our|your|my|this|that|these|those|so-called|where)\s+$|\w['’]s\s+$/i;
/** Words after a quote that carry its sentence on, the quote its subject: "where “Lost to goblins!” rises from the crowd". */
const CARRIED_ON = new RegExp(`^\\s+(?!(?:she|he|they|it|you|i|we|and|but|or|then|${SPEECH})\\b)[a-z]+s\\b`);
/** Words written, not said, just before a quote: "each marked “lost to goblins”", "countersigned “J. Sallow”", "The sign reads “…”", "At the bottom: “…”". */
const WRITTEN = /\b(?:marked|labell?ed|stamped|headed|titled|signed|countersigned|inscribed|written|scrawled|printed|lettered|chalked|painted|pencilled|reads|spells)\b[^.!?“”"\n]{0,20}[:,]?\s*$|\b(?:page|ledger|letter|sign|board|note|entry|entries|column|heading|margin|bottom|foot|label|inscription|notice|list|signature|countersignature|initials|legend|motto)\b[^.!?“”"\n]{0,15}[:,]?\s*$/i;

/** Quoted words that aren't a line said: a short quote inside a sentence of narration, with no tag ("At “the Royal Purveyor's office,” her pencil stills."), or words written and read. */
function notSaid(text: string, s: Speech): boolean {
  const said = text.slice(s.start, s.end).replace(/^[“"]|[”"]$/g, "").trim();
  const before = text.slice(Math.max(0, s.start - 40), s.start);
  return (said.split(/\s+/).length <= 8 && (MENTION.test(before.slice(-30)) || CARRIED_ON.test(text.slice(s.end, s.end + 20)))) || WRITTEN.test(before);
}

const plain = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
/** Quoted words that are the player's own, from their turn (two words at least). */
const echoes = (quote: string, player: string) => { const q = plain(quote); return q.split(" ").length >= 2 && plain(player).includes(q); };

/**
 * A reply written back out with its markup, for the GM's own history (a model writes as its last
 * few replies were written): each line tagged with its speaker by `name`, each note on its phrase.
 */
export function markupOf(marked: Marked, name: (id: string) => string | undefined): string {
  const opens = new Map<number, string[]>();
  const closes = new Map<number, string[]>();
  const add = (map: Map<number, string[]>, at: number, s: string) => map.set(at, [...(map.get(at) ?? []), s]);
  for (const s of marked.speech) {
    const who = s.speaker === "you" ? "you" : (s.speaker ? name(s.speaker) : undefined) ?? s.tag;
    if (who) add(opens, s.start, `[${who}] `);
  }
  // Notes that cross a spoken line's edge aren't written back (they'd split its tag from it).
  for (const m of marked.marks) {
    if (marked.speech.some(s => (m.start < s.start && m.end > s.start) || (m.start < s.end && m.end > s.end))) continue;
    add(opens, m.start, "(");
    add(closes, m.end, `)[${m.kind}: ${m.note}]`);
  }
  let out = "";
  for (let i = 0; i <= marked.text.length; i++) {
    for (const s of closes.get(i) ?? []) out += s;
    for (const s of opens.get(i) ?? []) out += s;
    if (i < marked.text.length) out += marked.text[i];
  }
  return out;
}
