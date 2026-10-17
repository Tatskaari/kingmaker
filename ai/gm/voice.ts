// Copied from the prototype's src/runtime/voices.ts:1-156 at 44c6d4a (the GM's voice, not the narrator's or the actors'): it reads a TurnView, the v2 approach's settings are constants (VOICE), its calls go through the request's call context, and a reply is the protocol's Reply (replyOf, for entryOf: its people by the game's keys, with the marks the GM drafted).

import { memoryBrief } from "../docs/disclosure.ts";
import { respond, type CallContext, type Message, type RespondResult } from "../llm/openrouter.ts";
import { prompt } from "../prompts/index.ts";
import type { Reply } from "../../shared/protocol/ai.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { nowNote, sceneBrief, sceneEntries, speakerName } from "./brief.ts";
import { knowledgeBrief, nameAsKnown, speakersOf } from "./knowledge.ts";
import { markupOf, parseMarkup, speechIn, withSpeakers, type Markup, type MarkupStats } from "./markup.ts";
import type { Drafted } from "./notes.ts";
import type { TurnView, ViewEntry } from "./view.ts";
import { workingSet } from "./working-set.ts";

/** The GM's voice as the prototype's v2 approach has it (approaches.ts:79): the docs service's memory, the comic house style, no reasoning, the essentials in its prep. */
const VOICE = { memory: true, tone: "comic", effort: "none", hideEssentials: false } as const;

export interface Spoken {
  speaker: string; kind: "narration" | "dialogue";
  /** What the player reads: the reply with its markup taken out. */
  text: string;
  result: RespondResult;
  /**
   * The reply's markup as the screen has it: who says each line, and the notes on its marks, which
   * come later (src/runtime/notes.ts: written from what the player knows, never the GM's own).
   */
  marked?: Markup;
  /** The marks the GM made as it wrote (where, and what kind), for the notes to be written on. */
  drafted?: Drafted[];
  /** How well the reply kept to the markup. */
  stats?: MarkupStats;
}

/** How a reply is asked for: its operation, the request's calls, the world's name (what the player knows), and where its words go as they're written. */
export interface GmCall {
  operation: string;
  calls: CallContext;
  setting: string;
  onText?: (text: string, markup?: Markup) => void;
}

const normalise = (text: string) => text.toLowerCase().replace(/[*_"“”‘’'.,!?;:()\-—–]/g, " ").replace(/\s+/g, " ").trim();

/** A sentence of eight or more words repeated verbatim from recent replies (or within this one). */
export function repeatedSentence(text: string, recent: string[]): string | undefined {
  const seen = new Set<string>();
  for (const earlier of recent) for (const sentence of earlier.split(/(?<=[.!?])\s+|\n+/)) {
    const n = normalise(sentence);
    if (n.split(" ").length >= 8) seen.add(n);
  }
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const n = normalise(sentence);
    if (n.split(" ").length < 8) continue;
    if (seen.has(n)) return sentence.trim();
    seen.add(n);
  }
  return undefined;
}

function recentTexts(state: TurnView, count = 6): string[] {
  return sceneEntries(state).filter(e => e.kind === "narration" || e.kind === "dialogue").slice(-count).map(e => e.text);
}

/** Models imitate their last few replies; when a draft repeats one verbatim, ask once for a fresh take. */
async function withoutRepeats(state: TurnView, draft: Spoken, regenerate: (note: string) => Promise<Spoken>, streamed: boolean): Promise<Spoken> {
  const repeat = repeatedSentence(draft.text, recentTexts(state));
  if (!repeat) return draft;
  // On screen already (streamed): rewriting it would show the player a reply being taken back.
  // It stands, and the next reply is told not to repeat it.
  if (streamed) { state.repeated = repeat; return draft; }
  const second = await regenerate(`Your first draft repeated something already said, word for word ("${repeat}"). Don't repeat it: move the moment on with something new.`);
  return { ...second, result: { ...second.result, costUsd: second.result.costUsd + draft.result.costUsd } };
}

/**
 * What's said, as the protocol's reply (entryOf): the words the player reads, with the markup beside
 * them when there's any, its people by the game's keys (`byKey`), and the marks the GM made, for the
 * notes to be written on.
 */
export const replyOf = (s: Spoken, byKey: (markup: Markup) => Markup = m => m): Reply => ({
  speaker: "gm", kind: "narration", text: s.text,
  ...(s.marked && (s.marked.speech.length || s.marked.marks.length || s.drafted?.length) ? { markup: byKey({ speech: s.marked.speech, marks: [...s.marked.marks] }) } : {}),
  ...(s.drafted?.length ? { drafted: s.drafted } : {}),
});

/**
 * A reply as the GM wrote it, its markup put back: a model writes as its last few replies were
 * written, so a reply from before the markup (an older save) gets its spoken lines tagged too, by
 * whoever the prose says spoke them.
 */
function asWritten(scene: Scene, state: TurnView, e: ViewEntry): string {
  const name = (id: string) => nameAsKnown(scene, state, id);
  if (e.marked) return markupOf({ text: e.text, ...e.marked }, name);
  if (e.kind !== "narration" || !/[“"]/.test(e.text)) return e.text;
  return markupOf(withSpeakers({ text: e.text, speech: speechIn(e.text), marks: [] }, speakersOf(scene, state)), name);
}

/** Multi-turn chat history for the single-GM voice: player turns as user, GM replies as assistant. */
function gmHistory(scene: Scene, state: TurnView): Message[] {
  const messages: Message[] = [];
  for (const e of sceneEntries(state)) {
    if (e.kind === "player") messages.push({ role: "user", content: e.text });
    else if (e.kind === "roll" || e.kind === "system") messages.push({ role: "developer", content: `[${e.text}]` });
    else {
      const text = e.kind === "dialogue" ? `${speakerName(scene, state, e.speaker)}: ${e.text}` : asWritten(scene, state, e);
      const last = messages.at(-1);
      if (last?.role === "assistant") last.content += `\n\n${text}`;
      else messages.push({ role: "assistant", content: text });
    }
  }
  return messages;
}

/** The player's latest turn, whose words a reply may quote back. */
const lastSaid = (state: TurnView) => state.transcript.findLast(e => e.kind === "player")?.text;

/**
 * A GM reply's markup read as it streams: `onText` hears the words shown so far (never the markup)
 * and who says each line in them, only when they've grown. The marks wait for their notes.
 */
function streamed(scene: Scene, state: TurnView, onText: (text: string, markup?: Markup) => void): (raw: string) => void {
  const people = speakersOf(scene, state);
  const player = lastSaid(state);
  let shown = "";
  return raw => {
    const parsed = parseMarkup(raw, { final: false });
    if (parsed.text === shown) return;
    shown = parsed.text;
    const { text, speech } = withSpeakers(parsed, people, { player });
    onText(text, { speech, marks: [] });
  };
}

/**
 * A GM reply's markup read once it's whole: the words, who says each line, and the marks the GM
 * made (where and what kind: its own notes on them are dropped here, and the player's are written
 * from what they know, src/runtime/notes.ts).
 */
export function readReply(scene: Scene, state: TurnView, raw: string): { text: string; marked: Markup; drafted: Drafted[]; stats: MarkupStats } {
  const parsed = parseMarkup(prose(raw));
  const { text, speech, marks } = withSpeakers(parsed, speakersOf(scene, state), { player: lastSaid(state) });
  return { text, marked: { speech, marks: [] }, drafted: marks.map(m => ({ start: m.start, end: m.end, kind: m.kind })), stats: parsed.stats };
}

/** The GM's reply: one call, the GM narrating and voicing everyone. A repeat it was warned of is the view's to clear, and one it makes the view's to keep (`state.repeated`). */
export async function gmReply(scene: Scene, state: TurnView, directive: string[], how: GmCall): Promise<Spoken> {
  if (state.repeated) {
    directive = [...directive, `Your last reply repeated something already said, word for word ("${state.repeated}"). Don't repeat yourself: move the moment on with something new.`];
    delete state.repeated;
  }
  const docs = VOICE.memory;
  const lore = docs ? memoryBrief(workingSet(scene, state), "stable") : undefined;
  const memory = docs ? memoryBrief(workingSet(scene, state), "live") : undefined;
  const input: Message[] = [
    // The prep, then what the player knows of it (what a mark's note may explain): both stable through a scene.
    { role: "developer", content: `${sceneBrief(scene, state, { hideEssentials: VOICE.hideEssentials, docs })}\n\n${knowledgeBrief(state, how.setting)}` },
    ...(lore ? [{ role: "developer" as const, content: lore }] : []),
    ...gmHistory(scene, state),
    // Volatile memory goes after the conversation so the cached prefix survives a newly opened note;
    // the markup's reminder (prompts/gm-markup.md) goes in just before the reply's directives.
    { role: "developer", content: [memory, nowNote(scene, state, directive, { remind: prompt("gm-markup") })].filter(Boolean).join("\n\n") },
  ];
  // The model behaves best with a user turn to answer; the opening has none yet.
  if (!input.some(m => m.role === "user")) input.push({ role: "user", content: "(The player is ready. Begin.)" });
  const result = await respond({ operation: how.operation, instructions: prompt("gm", { tone: prompt(`tone-${VOICE.tone}`) }), input, effort: VOICE.effort, maxOutputTokens: 700, calls: how.calls, ...(how.onText ? { onText: streamed(scene, state, how.onText) } : {}) });
  const { text, marked, drafted, stats } = readReply(scene, state, result.text);
  const draft: Spoken = { speaker: "gm", kind: "narration", text, result, marked, drafted, stats };
  if (directive.some(d => d.startsWith("Your first draft repeated"))) return draft;
  return withoutRepeats(state, draft, note => gmReply(scene, state, [...directive, note], { ...how, operation: `${how.operation}.fresh` }), !!how.onText);
}

/** The reply as prose: stray model tokens ("RGCTX:VEVENT") don't reach the transcript. */
export const prose = (text: string) => text.replace(/[ \t]*\b[A-Z]{3,}(?:_[A-Z0-9]+)*:[A-Z][A-Z0-9_]{2,}\b/g, "").trim();
