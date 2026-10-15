import { respondJson, type Message } from "../llm/openrouter.ts";
import { listDocs, readDoc, titleOf, type Doc } from "../lore/docs.ts";
import { presentCast, prompt } from "./brief.ts";
import { asKnown, deedFor, lead, linkMarks, nameAsKnown, playerKnowledge } from "./knowledge.ts";
import { MARK_KINDS, type Mark, type MarkKind, type Speech } from "./markup.ts";
import type { Scene } from "./scene.ts";
import type { Entry, SessionState } from "./session.ts";

/**
 * The notes the player reads on a GM reply's marked words (src/runtime/markup.ts). The GM marks the
 * moments as it writes, with its whole prep in view: a refusal and its reason, a custom, a callback.
 * What the player reads is written after the reply by a call that sees only what the player knows
 * (who they are, the story so far as they lived it, this scene, and the world's public lore, with
 * names they haven't heard kept out), so a note can't tell a secret: the GM's own notes never reach
 * the screen. The same call finds what the GM left unmarked: a line where someone refuses, bristles
 * or comes round for a reason the player can see gets a why.
 *
 * Each note is placed on its words (the GM's mark, a spoken line, or words of the reply), linked to
 * what it's about (the player's own turn, a lore doc, someone they know), and kept to three a reply.
 */

/** A mark the GM made as it wrote: where, and what kind. Its own note is never kept. */
export type Drafted = Pick<Mark, "start" | "end" | "kind">;

/** A note as the writer gave it. */
export interface Written { on: string; words: string; kind: MarkKind; note: string; turn: number; lore: string }

/** What writing a reply's notes came to, for the turn's metric. */
export interface NotesUsage {
  /** The GM's marks, the notes written (on them and added), and those on words the GM hadn't marked. */
  drafted: number; written: number; added: number;
  costUsd: number; ms: number;
}

/** A lore doc the writer may explain from, by its id in the brief (D1, D2, …). */
export interface LoreRef { id: string; path: string }

/** Marks a reply keeps at most. */
const MAX_MARKS = 3;

const schema = {
  type: "object", additionalProperties: false, required: ["notes"],
  properties: {
    notes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["on", "words", "kind", "note", "turn", "lore"],
        properties: {
          on: { type: "string", description: "M1, M2, … for a mark of the game master's; L1, L2, … for a spoken line; empty for other words of the reply" },
          words: { type: "string", description: "The marked words, copied exactly from the reply" },
          kind: { type: "string", enum: [...MARK_KINDS] },
          note: { type: "string", description: "One or two short sentences, to the player" },
          turn: { type: "integer", description: "The player's turn it's about (a why or a you about something they did), or 0" },
          lore: { type: "string", description: "The id (D1, D2, …) of the lore entry it explains from, or empty" },
        },
      },
    },
  },
};

// --- What the writer is told: only ever what the player knows.

const isPublic = (doc: Doc | undefined): doc is Doc => doc?.meta.visibility === "public";

const TIMES = /\b(morning|afternoon|evening|night)\b/i;

/**
 * A public doc as the writer reads it: without its pointers to other docs (some are the GM's), its
 * "If …" lines (what holds only if it happened, which the GM judges), or the hours of the day that
 * aren't the scene's ("Caerwyn now" goes hour by hour: the scene's hour is the one that's so).
 */
export function forReaders(doc: Doc, time?: Scene["time"]): string {
  const [head, ...rest] = doc.body.replace(/^#[^\n]*\n+/, "").split(/\n(?=## )/);
  const sections = rest.filter(sec => !/^## Read when relevant/.test(sec));
  const timed = sections.filter(sec => TIMES.test(sec.split("\n")[0]!));
  // The scene's hour: the first section of it ("next-morning" is the last morning).
  const hour = time === "next-morning" ? timed.filter(sec => /morning/i.test(sec.split("\n")[0]!)).at(-1) : timed.find(sec => time && new RegExp(`\\b${time}\\b`, "i").test(sec.split("\n")[0]!));
  const kept = [head!, ...sections.filter(sec => timed.length < 2 || !timed.includes(sec) || sec === hour)];
  return kept.join("\n").split("\n").filter(l => !/^\s*(?:[-*]\s+(?:\*\*[^*]+\*\*:?\s*)?)?If\b/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The lore anyone could read, as the writer gets it: the scene's own public docs whole, the people
 * here by their public faces, and a line on each of the world's other public docs and places.
 * Names the player hasn't heard are put as what they'd call their owners.
 */
export function publicLore(scene: Scene, state: SessionState): { refs: LoreRef[]; text: string } {
  const refs: LoreRef[] = [];
  const parts: string[] = [];
  const add = (path: string, body: string, title: string) => {
    const id = `D${refs.length + 1}`;
    refs.push({ id, path });
    parts.push(`### ${id}. ${asKnown(title, scene, state)}\n${asKnown(body, scene, state)}`);
  };
  const own = (scene.lore ?? []).map(p => readDoc(state.id, p)).filter(isPublic);
  for (const doc of own) add(doc.path, forReaders(doc, scene.time), titleOf(doc));
  for (const c of presentCast(scene, state)) {
    const doc = readDoc(state.id, `Cast/${c.name}/public.md`);
    if (isPublic(doc)) add(doc.path, forReaders(doc, scene.time), titleOf(doc));
  }
  for (const path of listDocs(state.id).filter(p => /^(World|Places)\//.test(p) && !/index\.md$/.test(p) && !refs.some(r => r.path === p))) {
    const doc = readDoc(state.id, path);
    if (isPublic(doc)) add(path, lead(doc), titleOf(doc));
  }
  return { refs, text: parts.join("\n\n") };
}

/** Who the player is and what they've lived before this scene: their concept, earlier scenes, what they've been told. */
function whoTheyAre(state: SessionState): string {
  const k = playerKnowledge(state);
  return [
    `## Who the player is\n${state.player.name}: ${state.player.concept}${state.player.build ? ` (${state.player.build})` : ""}.`,
    ...(k.scenes.length ? [`## The story so far, as they lived it\n${k.scenes.map(s => `- ${s.title}: ${s.ending}.${s.notebook.length ? ` Their notebook: ${s.notebook.map(n => `"${n}"`).join(" ")}` : ""}`).join("\n")}`] : []),
    ...(k.told.length ? [`## What people have told them of themselves\n${k.told.map(t => `- ${t.who}: ${t.topic}`).join("\n")}`] : []),
  ].join("\n\n");
}

/**
 * The scene so far as the player saw it (their own turns numbered), and before it the player's own
 * turns in earlier scenes: everything said and shown to them, and nothing else.
 */
export function sceneSoFar(state: SessionState, before: Entry[]): string {
  const here = before.filter(e => (e.scene ?? state.sceneId) === state.sceneId);
  const line = (e: Entry) => e.kind === "player" ? `Turn ${e.turn}, the player: ${e.text}` : e.kind === "roll" ? `(The dice: ${e.text})` : e.kind === "system" ? undefined : e.text;
  const earlier = earlierDeeds(state, before);
  return [...(earlier ? [earlier] : []), `## This scene so far\n${here.map(line).filter(Boolean).join("\n\n") || "(It has just begun.)"}`].join("\n\n");
}

/** The player's own turns in earlier scenes (the last dozen), by turn: what they did, which a note may call back. */
export function earlierDeeds(state: SessionState, before: Entry[]): string | undefined {
  const earlier = before.filter(e => e.kind === "player" && (e.scene ?? state.sceneId) !== state.sceneId).slice(-12);
  return earlier.length ? `## What the player did in earlier scenes\n${earlier.map(e => `Turn ${e.turn}: ${e.text}`).join("\n")}` : undefined;
}

/** The words a note is on, as the same name or phrase however it's written ("the Heron", "Heron"). */
const sameWords = (s: string) => s.toLowerCase().replace(/[“”"‘’'.,!?;:…]/g, "").replace(/^(the|a|an)\s+/, "").replace(/\s+/g, " ").trim();

/** The reply as the writer reads it: its words, each spoken line with who says it (as the player knows them), and the GM's marks. */
function replyView(scene: Scene, state: SessionState, text: string, speech: Speech[], drafted: Drafted[]): string {
  const who = (s: Speech) => (s.speaker === "you" ? "the player" : s.speaker ? nameAsKnown(scene, state, s.speaker) ?? "someone" : "someone");
  return [
    `## The reply\n${text}`,
    ...(speech.length ? [`Its spoken lines:\n${speech.map((s, i) => `L${i + 1} (${who(s)}): ${text.slice(s.start, s.end)}`).join("\n")}`] : []),
    drafted.length ? `The game master's marks:\n${drafted.map((m, i) => `M${i + 1} (${m.kind}) on «${text.slice(m.start, m.end)}»`).join("\n")}` : "The game master marked nothing.",
  ].join("\n\n");
}

// --- Placing what was written on the reply.

/** Words folded for finding (case, curly quotes and runs of spaces aside), with where each folded character came from. */
function folded(s: string): { text: string; at: number[] } {
  let text = "";
  const at: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (/\s/.test(c)) { if (!text.endsWith(" ")) { text += " "; at.push(i); } continue; }
    for (const f of c === "“" || c === "”" ? "\"" : c === "‘" || c === "’" ? "'" : c.toLowerCase()) { text += f; at.push(i); }
  }
  return { text, at };
}

/** Where some words stand in the reply, between from and to: the first place they do, or none. */
function wordsAt(text: string, words: string, from = 0, to = text.length): { start: number; end: number } | undefined {
  const want = folded(words.trim().replace(/^[«"“]+|[»"”]+$/g, "")).text.trim();
  if (want.length < 3) return undefined;
  const hay = folded(text.slice(from, to));
  const k = hay.text.indexOf(want);
  if (k < 0) return undefined;
  return { start: from + hay.at[k]!, end: from + hay.at[k + want.length - 1]! + 1 };
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/**
 * The notes placed on the reply: each on its words (the GM's mark it was written for, the spoken
 * line it's on or the words of it it names, or words of the reply), with no two on the same words,
 * three at most. A `you` is about something the player did, or it goes; a turn or a lore doc the
 * writer named is the note's link.
 */
export function placeNotes(text: string, speech: Speech[], drafted: Drafted[], written: Written[], refs: LoreRef[], state: SessionState, explained: string[] = [], scene?: Scene): Mark[] {
  const marks: Mark[] = [];
  const had = new Set(explained.map(sameWords));
  const playerTurns = new Set(state.transcript.filter(e => e.kind === "player").map(e => e.turn));
  for (const w of written) {
    if (marks.length >= MAX_MARKS) break;
    const note = storyWords(w.note);
    if (!MARK_KINDS.includes(w.kind) || note.length < 8) continue;
    const span = spanOf(text, speech, drafted, w);
    if (!span || marks.some(m => overlaps(m, span))) continue;
    // What's been explained once in the scene isn't explained again; two reasons a reply is plenty.
    if (w.kind === "know" && had.has(sameWords(text.slice(span.start, span.end)))) continue;
    if (w.kind === "why" && marks.filter(m => m.kind === "why").length >= 2) continue;
    const deedTurn = w.turn > 0 && playerTurns.has(w.turn) ? w.turn : undefined;
    const deed = deedTurn !== undefined ? state.transcript.find(e => e.kind === "player" && e.turn === deedTurn) : w.kind === "you" ? deedFor(state, `${text.slice(span.start, span.end)} ${note}`) : undefined;
    // A callback is to something the player did: without it, it isn't one.
    if (w.kind === "you" && !deed) continue;
    const doc = refs.find(r => r.id === w.lore.trim());
    // Someone's public face is a person's card (by the name the player knows them by), not a doc's.
    const face = doc && /^Cast\/(.+)\/public\.md$/.exec(doc.path)?.[1];
    const person = face ? scene?.cast.find(c => c.name === face) : undefined;
    const link = deed && (w.kind !== "know") ? { kind: "deed" as const, scene: deed.scene ?? state.sceneId, turn: deed.turn }
      : person ? { kind: "person" as const, id: person.id }
      : doc && !face ? { kind: "lore" as const, path: doc.path } : undefined;
    marks.push({ ...span, kind: w.kind, note, ...(link ? { link } : {}) });
  }
  return marks.sort((a, b) => a.start - b.start);
}

/**
 * A note in the story's words: the turn and the doc go in their own fields, but a model sometimes
 * puts them in the note too ("(D3)", "You said it in turn 3.", "this turn"), which is the game
 * talking, not the story.
 */
export function storyWords(note: string): string {
  let out = note.trim().replace(/^["“]|["”]$/g, "").replace(/\s*\((?:turn \d+|D\d+)(?:[,;] *(?:turn \d+|D\d+))*\)/gi, "");
  const sentences = out.match(/[^.!?]+[.!?]+["”’)]*|[^.!?]+$/g) ?? [out];
  // A sentence that's only there to give the turn goes, when there's another.
  const kept = sentences.filter(s => !(sentences.length > 1 && /\bturn \d+\b/i.test(s) && s.trim().length < 60));
  out = kept.join("").replace(/\s*\b(?:in|on|at|during) (?:your )?turn \d+\b/gi, "").replace(/\b(?:in |on )?(?:your |the )?(?:last|previous) turn\b/gi, "a moment ago").replace(/\bthis turn\b/gi, "just now");
  // "You did that just now." after the note says what was done: only the turn, in other words.
  const told = out.match(/[^.!?]+[.!?]+["”’)]*|[^.!?]+$/g) ?? [out];
  if (told.length > 1) out = told.filter(s => !/^\s*(?:(?:you|that|this|it)\s+(?:did|said|was|happened)\s+(?:that|this|it)?\s*)?(?:just now|a moment ago|this moment)[.!]?\s*$/i.test(s)).join("");
  return out.replace(/\s+([.,;:!?])/g, "$1").replace(/\s+/g, " ").trim();
}

/** Where a written note goes: its GM mark, its line (or the words of the line it names), or its words in the reply. */
function spanOf(text: string, speech: Speech[], drafted: Drafted[], w: Written): { start: number; end: number } | undefined {
  const on = /^([ML])(\d+)$/i.exec(w.on.trim());
  const index = on ? Number(on[2]) - 1 : -1;
  if (on?.[1]!.toUpperCase() === "M" && drafted[index]) return { start: drafted[index]!.start, end: drafted[index]!.end };
  if (on?.[1]!.toUpperCase() === "L" && speech[index]) {
    const line = speech[index]!;
    return wordsAt(text, w.words, line.start, line.end) ?? { start: line.start, end: line.end };
  }
  return wordsAt(text, w.words);
}

// --- Writing them.

/**
 * What the writer is sent: what anyone here knows (the scene's hook and `known`, the public lore)
 * and who the player is, stable through the scene and first (the provider's prompt cache), then the
 * scene so far and the reply. Everything in it is something the player knows.
 */
export function notesInput(scene: Scene, state: SessionState, reply: { text: string; speech: Speech[]; drafted: Drafted[] }, before: Entry[]): { input: Message[]; refs: LoreRef[] } {
  const known = knownToAll(scene, state);
  return {
    refs: known.refs,
    input: [
      { role: "developer", content: known.text },
      { role: "user", content: [sceneSoFar(state, before), ...given(state, before), replyView(scene, state, reply.text, reply.speech, reply.drafted)].join("\n\n") },
    ],
  };
}

/** The notes the player has had in this scene, for the writer: none is written again. */
function given(state: SessionState, before: Entry[]): string[] {
  const had = before.filter(e => (e.scene ?? state.sceneId) === state.sceneId).flatMap(e => (e.marked?.marks ?? []).map(m => `- ${m.kind} on «${e.text.slice(m.start, m.end)}»: ${m.note}`));
  return had.length ? [`## The notes the player already has in this scene\n${had.join("\n")}`] : [];
}

/** What anyone here knows (the scene's hook and `known`, the public lore, by id) and who the player is: what a note may explain from, besides the scene. */
export function knownToAll(scene: Scene, state: SessionState): { refs: LoreRef[]; text: string } {
  const lore = publicLore(scene, state);
  const common = [scene.hook, ...(scene.known ?? [])].map(k => `- ${asKnown(k, scene, state)}`).join("\n");
  return { refs: lore.refs, text: `# What anyone here knows\n${common}\n\n${lore.text}\n\n# The player\n${whoTheyAre(state)}` };
}

/**
 * Write the notes on a reply (its words, who says each line, and the GM's marks), from what the
 * player knows as of `before` (the transcript up to the reply). The marks it comes to: placed,
 * linked, and with no name the player hasn't heard.
 */
export async function writeNotes(scene: Scene, state: SessionState, reply: { text: string; speech: Speech[]; drafted: Drafted[] }, before: Entry[]): Promise<{ marks: Mark[]; usage: NotesUsage }> {
  const { input, refs } = notesInput(scene, state, reply, before);
  const result = await respondJson<{ notes: Written[] }>({ operation: "notes", effort: "none", maxOutputTokens: 900, instructions: prompt("notes"), input, json: { name: "notes", schema } });
  const explained = before.filter(e => (e.scene ?? state.sceneId) === state.sceneId && e.marked?.marks.length).flatMap(e => e.marked!.marks.filter(m => m.kind === "know").map(m => e.text.slice(m.start, m.end)));
  const placed = placeNotes(reply.text, reply.speech, reply.drafted, result.notes ?? [], refs, state, explained, scene);
  // Names the player hasn't heard, kept out; a link where the writer gave none (someone they know, by name).
  const marks = linkMarks({ speech: reply.speech, marks: placed.map(m => ({ ...m, note: asKnown(m.note, scene, state) })) }, reply.text, scene, state).marks;
  const onGm = (m: Mark) => reply.drafted.some(d => overlaps(d, m));
  return {
    marks,
    usage: { drafted: reply.drafted.length, written: marks.length, added: marks.filter(m => !onGm(m)).length, costUsd: result._meta.costUsd, ms: result._meta.latencyMs },
  };
}

/**
 * The notes on a reply that's on the transcript: written, then put on its entry, and the screen
 * told (`onMarks`). The entry's markup is the object the screen's line holds, so they land on both.
 * Only a reply with something to note (a spoken line, or a mark of the GM's) is read. Never throws:
 * a reply whose notes couldn't be written has none.
 */
export async function annotate(scene: Scene, state: SessionState, entry: Entry, drafted: Drafted[], onMarks?: (entry: Entry) => void): Promise<NotesUsage | undefined> {
  const marked = entry.marked;
  if (!marked || (!marked.speech.length && !drafted.length)) return undefined;
  const before = state.transcript.slice(0, Math.max(0, state.transcript.indexOf(entry)));
  try {
    const { marks, usage } = await writeNotes(scene, state, { text: entry.text, speech: marked.speech, drafted }, before);
    if (marks.length) {
      marked.marks = marks;
      onMarks?.(entry);
    }
    return usage;
  } catch {
    return undefined;
  }
}
