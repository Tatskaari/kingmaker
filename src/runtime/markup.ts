import { quoteSpeaker, SPEECH, tagSpeaker, type Speaker } from "./speakers.ts";

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
 * The model drifts, so what it drifts to is taken too: Markdown's order ([phrase](why: …)), a space
 * between the phrase and its note, a note with no kind (a reason), and a note written on a line of
 * its own after the reply, its phrase copied from the reply (which lights up the phrase where it
 * already stands).
 *
 * Parsed as the reply streams (`final: false`), what's shown only ever grows: a bracket that might
 * be markup holds back what follows it until it's clear, and markup never shows. What's malformed
 * falls back to plain words: a phrase whose note never came is shown as written, without its
 * brackets; a tag with no line after it, or a note with no phrase, disappears; a note that never
 * closes is hidden to the end of its line. Brackets that are only brackets ("(I cast Fireball)")
 * are shown as they are.
 */

export type MarkKind = "why" | "know" | "you";
export const MARK_KINDS: readonly MarkKind[] = ["why", "know", "you"];

/** The knowledge entry a mark is about, found after the reply (src/runtime/knowledge.ts): only ever something the player knows. */
export type MarkLink =
  /** Someone of the scene's cast or the place's world. */
  | { kind: "person"; id: string }
  /** A lore doc anyone could read (a place, a custom, a body of people). */
  | { kind: "lore"; path: string }
  /** Something the player did: their own turn. */
  | { kind: "deed"; scene: string; turn: number };

/** A note on a phrase of the reply: [start, end) in its text. */
export interface Mark {
  start: number;
  end: number;
  kind: MarkKind;
  /** The GM's note, said to the player. */
  note: string;
  link?: MarkLink;
}

/** A spoken line: [start, end) in the reply's text, its quote marks included. */
export interface Speech {
  start: number;
  end: number;
  /** Who says it: a cast or world entity's id, "you" for the player's own words; none when nobody can tell. */
  speaker?: string;
  /** The tag the GM wrote, when it wrote one. */
  tag?: string;
}

/** A reply as the screen shows it: its words, who says what, and the notes. */
export interface Marked { text: string; speech: Speech[]; marks: Mark[] }

/** What the markup said of a reply, kept on its transcript entry beside its words (offsets into them). */
export type Markup = Omit<Marked, "text">;

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

/** The words a note can start with to say its kind (and what the model sometimes writes instead). */
const LABEL = /^\s*(why|know|you|because|reason|known|remember)\s*:\s*/i;
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

/** What parsing builds: the words shown, the spoken lines, the notes. */
class Reply {
  text = "";
  speech: Speech[] = [];
  marks: Mark[] = [];
  stats = emptyStats();
  /** A spoken line still open, and the quote that opened it. */
  open: (Speech & { by: string }) | undefined;
  /** A speaker's tag waiting for its line. */
  tag: string | undefined;

  char(c: string): void {
    // A reply starts with its first word (whatever markup came before it).
    if (!this.text && /\s/.test(c)) return;
    if (c === "\n" && this.open && this.text.endsWith("\n")) this.close();
    if (c === "“" || c === "”" || c === "\"") this.quote(c);
    else this.text += c;
  }

  emit(s: string): void { for (const c of s) this.char(c); }

  private close(): void {
    const o = this.open!;
    o.end = Math.max(o.start + 1, this.text.trimEnd().length);
    const { by, ...line } = o;
    void by;
    this.speech.push(line);
    this.open = undefined;
  }

  private quote(c: string): void {
    if (this.open) {
      if (c === "”" || (c === "\"" && this.open.by === "\"")) { this.text += c; this.open.end = this.text.length; this.close(); this.open = undefined; return; }
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
export function parseMarkup(raw: string, options: { final?: boolean } = {}): Marked & { pending: boolean; stats: MarkupStats } {
  const final = options.final ?? true;
  const r = new Reply();

  /** Past markup that vanished: a space after it goes too, when there's one before it (no double spaces). */
  const gap = (k: number): number => (raw[k] === " " && (!r.text || /\s$/.test(r.text)) ? k + 1 : k);
  /** The end of the line from `from` (hidden up to there), or held while it hasn't come. */
  const lineEnd = (from: number): number => {
    const end = raw.indexOf("\n", from);
    if (end >= 0) return end;
    return final ? raw.length : HOLD;
  };
  /** Is the note that closes at `close` on a line of its own (its phrase begins one at `open`)? */
  const alone = (open: number, close: number): boolean | "hold" => {
    const before = raw.slice(0, open).replace(/[ \t]+$/, "");
    if (before && !before.endsWith("\n")) return false;
    const after = raw.slice(close + 1);
    if (!after.trim() && !final) return "hold";
    return /^[ \t]*(\n|$)/.test(after);
  };

  /** At a "(": a note in the sketch's order, (phrase)[kind: note], or just brackets. */
  const round = (i: number): number => {
    const plain = () => { r.char("("); return i + 1; };
    const c = closeOf(raw, i + 1, "(", ")", PHRASE_MAX, final);
    if (c === "pending") return HOLD;
    if (c === "none") return plain();
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
    const astray = lone ? "own line" : labelAfter(r.text, phrase);
    const shown = r.mark(phrase, label ? KIND_OF[label[1]!.toLowerCase()]! : "why", label ? inner.slice(label[0].length) : inner, astray);
    if (!astray && stopless(phrase, raw.slice(n.at + 1))) r.char(".");
    return shown ? n.at + 1 : gap(n.at + 1);
  };

  /** At a "[": a speaker's tag, a note in Markdown's order, a note with no phrase, or just a bracket. */
  const square = (i: number): number => {
    const c = closeOf(raw, i + 1, "[", "]", NOTE_MAX, final);
    if (c === "pending") return HOLD;
    const label = LABEL.exec(raw.slice(i + 1, i + 17));
    if (c === "none") {
      if (label) { r.stats.malformed++; return lineEnd(i); }
      r.char("[");
      return i + 1;
    }
    const inner = raw.slice(i + 1, c.at);
    if (label) {
      // The note first and its phrase after, [why: …](she won't serve you): the phrase takes it.
      const p = raw[c.at + 1] === "(" ? c.at + 1 : raw[c.at + 1] === " " && raw[c.at + 2] === "(" ? c.at + 2 : -1;
      if (!final && (c.at + 1 >= raw.length || (raw[c.at + 1] === " " && c.at + 2 >= raw.length))) return HOLD;
      if (p >= 0) {
        const n = closeOf(raw, p + 1, "(", ")", PHRASE_MAX, final);
        if (n === "pending") return HOLD;
        if (n !== "none") return r.mark(raw.slice(p + 1, n.at), KIND_OF[label[1]!.toLowerCase()]!, inner.slice(label[0].length), labelAfter(r.text, raw.slice(p + 1, n.at))) ? n.at + 1 : gap(n.at + 1);
      }
      // A note straight after a line or a sentence, with no words of its own in brackets
      // ([Dab] “Not you, now.”[why: …]): it's on the line, or the sentence, just said.
      const last = r.lastSaid();
      const n = inner.slice(label[0].length).trim().replace(/\s+/g, " ");
      if (last && n) r.add({ ...last, kind: KIND_OF[label[1]!.toLowerCase()]!, note: n });
      // A note with nothing before it to hang on: never shown.
      else r.stats.dropped++;
      return gap(c.at + 1);
    }
    const k = c.at + 1;
    if (k >= raw.length && !final) return HOLD;
    // Markdown's order: [phrase](kind: note).
    const p = raw[k] === "(" ? k : raw[k] === " " && raw[k + 1] === "(" ? k + 1 : -1;
    if (raw[k] === " " && k + 1 >= raw.length && !final) return HOLD;
    if (p >= 0) {
      const n = closeOf(raw, p + 1, "(", ")", NOTE_MAX, final);
      if (n === "pending") return HOLD;
      const lab = LABEL.exec(raw.slice(p + 1, p + 17));
      if (lab && n === "none") { r.emit(inner); r.stats.malformed++; return lineEnd(p); }
      if (n !== "none" && (lab || words(raw.slice(p + 1, n.at)) > 3)) {
        const lone = alone(i, n.at);
        if (lone === "hold") return HOLD;
        if (!final && !raw.slice(n.at + 1).trim()) return HOLD;
        if (!lab) r.stats.unlabelled++;
        const astray = lone ? "own line" : labelAfter(r.text, inner);
        const shown = r.mark(inner, lab ? KIND_OF[lab[1]!.toLowerCase()]! : "why", raw.slice(p + 1 + (lab ? lab[0].length : 0), n.at), astray);
        if (!astray && stopless(inner, raw.slice(n.at + 1))) r.char(".");
        return shown ? n.at + 1 : gap(n.at + 1);
      }
    }
    // A speaker's tag: just before a spoken line (after a space or a colon).
    let q = k;
    while (q < raw.length && (raw[q] === " " || raw[q] === "\t" || raw[q] === ":")) q++;
    if (q >= raw.length && !final) return HOLD;
    if (isOpening(raw[q]) && tagLike(inner)) { r.tag = inner.trim(); return q; }
    // Just inside a line that has only just opened (“[Kell] Not for you”): the tag for it.
    if (r.open && !r.open.tag && r.open.start === r.text.length - 1 && tagLike(inner)) {
      r.open.tag = inner.trim();
      r.stats.tagged++;
      return raw[k] === " " ? k + 1 : k;
    }
    // Anything else: a tag with no line after it disappears; a phrase whose note never came is shown as written.
    r.stats.malformed++;
    if (!nameLike(inner)) { r.emit(inner); return k; }
    return gap(k);
  };

  let i = 0;
  let pending = false;
  while (i < raw.length) {
    const ch = raw[i]!;
    const next = ch === "(" ? round(i) : ch === "[" ? square(i) : (r.char(ch), i + 1);
    if (next === HOLD) { pending = true; break; }
    i = next;
  }
  const speech = [...r.speech];
  if (r.open) {
    const { by, ...line } = r.open;
    void by;
    speech.push({ ...line, end: Math.max(line.start + 1, r.text.trimEnd().length) });
  }
  let text = r.text;
  if (final) text = text.trimEnd();
  return {
    text,
    speech: speech.map(s => ({ ...s, end: Math.min(s.end, text.length) })).filter(s => s.end > s.start),
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
  if (r.open) { const { by, ...line } = r.open; void by; speech.push({ ...line, end: Math.max(line.start + 1, r.text.trimEnd().length) }); }
  return speech.filter(s => s.end > s.start);
}

/**
 * Who says each line: the tag the GM wrote; else the one who said the line before, when only a
 * speech tag comes between ("…,” she says, “…”); else as a reader would tell from the prose (the
 * speech tag after it, or the sentence leading in).
 */
export function withSpeakers(marked: Marked, people: Speaker[]): Marked {
  const speech: Speech[] = [];
  for (const s of marked.speech) {
    let id = s.tag ? tagSpeaker(s.tag, people) : undefined;
    const prev = speech.at(-1);
    const between = prev ? marked.text.slice(prev.end, s.start) : "";
    if (!id && !s.tag && prev?.speaker && continues(between, people)) id = prev.speaker;
    id ??= s.tag ? undefined : quoteSpeaker(marked.text, s.start, s.end, people);
    // Untold, after a "she" or a "he" and nobody else named since the last line: the one who said it.
    if (!id && !s.tag && prev?.speaker && prev.speaker !== "you" && pronounOnly(between, people)) id = prev.speaker;
    speech.push(id ? { ...s, speaker: id } : { ...s });
  }
  return { ...marked, speech };
}

/** Narration that goes on about someone only as "she" or "he" (no one else named in it), a short paragraph at most. */
function pronounOnly(between: string, people: Speaker[]): boolean {
  const b = between.toLowerCase();
  return between.length <= 240 && /\b(she|he|her|his|him)\b/.test(b) && !/\byou\s+(say|said|ask|asked|answer|reply)/.test(b) && !people.some(p => p.names.some(n => b.includes(n)));
}

/** A speech tag with no one named in it, that carries a speaker on to their next line: “…,” she says, not looking up, “…” */
const ATTRIBUTION = new RegExp(`^[\\s,;:—–-]*(?:she|he|they|it)\\s+(?:${SPEECH})\\b[^.!?“”"\\n]{0,50}[.!?,;:—–-]?\\s*$`, "i");

/** Narration between two lines that only carries one speaker on to the next. */
function continues(between: string, people: Speaker[]): boolean {
  const b = between.toLowerCase();
  return ATTRIBUTION.test(between) && !people.some(p => p.names.some(n => b.includes(n)));
}

/**
 * A reply's markup in words, for the QA console and the scene harness (their transcripts are
 * text): who says each line, then each marked phrase with its note and what it's linked to.
 */
export function markupLines(text: string, markup: Markup, name: (id: string) => string | undefined): string[] {
  const clip = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…”` : s);
  const who = markup.speech.map(s => `${s.speaker === "you" ? "you" : (s.speaker ? name(s.speaker) : undefined) ?? (s.tag ? `${s.tag} (not here)` : "nobody can tell")} ${clip(text.slice(s.start, s.end))}`);
  const link = (l: MarkLink) => (l.kind === "deed" ? `what you did, turn ${l.turn}` : l.kind === "person" ? `who: ${name(l.id) ?? l.id}` : `lore: ${l.path}`);
  return [
    ...(who.length ? [`  ⟨who says what: ${who.join("; ")}⟩`] : []),
    ...markup.marks.map(m => `  ⟨${m.kind} on “${text.slice(m.start, m.end)}”: ${m.note}${m.link ? ` (${link(m.link)})` : ""}⟩`),
  ];
}

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
