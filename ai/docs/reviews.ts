import { JEV_MODEL, JevDecider, type ChoiceQuestion, type Decider } from "../llm/decide.ts";
import { LUNA, respondJson, type CallContext } from "../llm/openrouter.ts";
import { runTools, InvalidToolArguments, type ToolDef } from "../llm/tools.ts";
import { prompt } from "../prompts/index.ts";
import { characterEntry, createDoc, editDoc, playerDocPath, readDoc, searchDocs, type DocMeta } from "./docs.ts";
import { isNotesPath, note, NOTE_SECTIONS, notesText, readNotes, SECTIONS, type NoteSection, type Noted } from "./notes.ts";
import { script, type WorkingSet } from "./types.ts";

/**
 * V1's background memory, rebuilt for scenes and kept as the GM's notes on the people (notes.ts).
 * After each reply Jev classifies the moment against the attention categories. Nothing flagged:
 * nothing runs (the common case, one Jev call). Anything flagged brings the notes on the people
 * present up to date: one structured call, whose updates each rewrite a line of someone's note or
 * add one. A world fact (an improvised detail, a lasting change) also fires the world-facts agent, a
 * Luna tool loop that records it in the lore, run after the notes. Each is handed the scene's working
 * set (types.ts).
 */

const GUIDANCE = "Analyze the latest exchange in this live roleplaying scene (the player's turn and the game master's reply, which voices every character) for things the player might expect the world to react to. You are the GM's attention filter: help a living, responsive world remember what was said, follow through on agreements, and reconcile collaborative improvisation. Think like a good game master: help the player tell a fun, surprising story, honour binding roll outcomes, preserve continuity, and make meaningful interactions matter. Prefer flagging a plausible need for follow-up over silently losing it. Flagging asks the GM to review; it does not establish a claim as true, move anyone, transfer an item or complete an objective. Classify each category independently. Do not flag old developments merely because they appear in history, or routine greetings with no new detail, commitment or consequence. Do not invent missing details.";

/**
 * The attention categories: V1's (lore/gm_prompts/conversation/attention), for a scene where the GM
 * voices everyone, brought to the parts of the GM's notes where they were about what people keep: a
 * promise (V1's deferred and general commitments), standing and learned (its change in relationship
 * or knowledge, in two, learned with what someone witnessed), seen (its exchange, with the rest of
 * what the player did in front of them) and did (what they did themselves); and V1's two for the
 * world's facts as they were. V1's immediate commitment went: what's to be done now is done in the
 * next reply or not at all, and a note keeps what lasts.
 */
export const CATEGORIES: Record<string, string> = {
  promise: "Would the player expect someone (a character, or the player character) to remember and honour a promise, deal or undertaking made in the latest exchange: something to do later or when a condition is met, or a broad pledge of support or allegiance? Preserve stated timing or triggers without inventing them. Doing something right now ('Lead on', 'After you', 'Let me fetch it'), vague goodwill, refused requests and hypothetical discussion are not promises.",
  standing: "Would the player expect someone present to treat the player character differently after the latest exchange: a meaningful change in trust, suspicion, affection, hostility, fear or forgiveness, or now owing them, shown in how they react to what the player character did or said? Routine pleasantries, or a player claim without a character reaction, are not enough.",
  seen: "Did the player character do something in front of someone present that they would still bring up later: a real kindness or cruelty, a threat, an agreed gift, payment, handover or trade carried out, a daring or daft act, a lie found out, how they treated someone weaker? Ordinary politeness, questions and small talk, rejected offers and requests with no agreement don't count.",
  learned: "Did someone present learn something consequential in the latest exchange, or see or hear for themselves something the story may need them to tell or swear to later: a confession or admission, a secret, who came or went and when, something handed over, taken or found, a crime, a name said? Flag it for anyone who was there to see or hear it, including whoever stood watch or kept out of the way, and a companion of the player's. Mere repeated facts, routine talk, and what everyone already knew do not qualify.",
  did: "Did someone present do something of consequence on their own account in the latest exchange that later scenes should remember they did: admitted something, told a secret or a lie, gave something up or took it, took a side, broke a rule, ran off or raised the alarm? Their ordinary talk, gestures and errands don't count.",
  improvised_detail: "Did the player or the GM introduce a concrete story detail not already established in the scene's prep or lore? Flag it for GM reconciliation so the story can evolve collaboratively. If the player introduces a detail and the characters don't explicitly deny it, flag it: implicit acceptance, hedging, topic changes and simply going along all qualify. Explicit rejection of the player's claim, already established facts, requests, future proposals and clearly hypothetical examples alone do not qualify. Preserve the distinction between a shared fact, belief and unresolved claim; the flag does not decide which it is.",
  other_world_update: "Did the exchange narrate a consequential, lasting change in the world whose effect later scenes should show: something broken, left, marked or moved in a place, a change in someone's condition, a public event? Passing gestures and descriptions of the moment don't count.",
};

/** What the prep already establishes (so narrating it isn't mistaken for improvisation). */
function prepSummary(view: WorkingSet): string {
  const cast = view.present.map(c => `- ${c.name}: ${c.look} Knows: ${c.knows.join(" ")}`).join("\n");
  return `The setting (prep): ${view.scene.setting}\nThe people (prep):\n${cast}${view.scene.limits?.length ? `\nWhat this place can't offer (prep): ${view.scene.limits.join(" ")}` : ""}`;
}

const exchange = (view: WorkingSet, turn: number) => script(view.transcript.filter(e => e.turn === turn));
const before = (view: WorkingSet, turn: number, n = 10) => script(view.transcript.filter(e => e.turn < turn).slice(-n));

export async function attend(view: WorkingSet, turn: number, decider: Decider = new JevDecider()): Promise<string[]> {
  const latest = exchange(view, turn);
  if (!latest.trim()) return [];
  const questions: Record<string, ChoiceQuestion> = Object.fromEntries(Object.entries(CATEGORIES).map(([id, criterion]) => [id, {
    instructions: `${GUIDANCE}\nEvaluate ONLY ${id}: ${criterion}`,
    criteria: { flagged: `There is evidence of ${id} under the category rules; flag it for GM follow-up.`, not_flagged: `The ${id} category rules do not apply, or an explicit exclusion applies; do not flag this category.` },
  }]));
  const earlier = before(view, turn, 8);
  const decision = await decider.decide([
    "# SYSTEM", `Scene: ${view.scene.title}. ${view.scene.premise}`, prepSummary(view), `The player character: ${view.player.who}.`,
    "Details the prep already establishes are not improvised, even when the GM narrates them for the first time.",
    "# USER", ...(earlier ? [`Earlier in the scene:\n${earlier}`] : []), `The latest exchange:\n${latest}`,
  ].join("\n\n"), questions, "memory.attend");
  // A false flag costs one review that writes nothing; a missed flag loses the note. Trigger low.
  return Object.keys(CATEGORIES).filter(id => decision.answers[id]?.choice === "flagged" && (decision.answers[id]?.probabilities?.flagged ?? 1) >= FLAG_THRESHOLD);
}

export const FLAG_THRESHOLD = 0.4;

/**
 * The two reviews: the notes on the people present (anything flagged: a world fact has its witnesses
 * too) and the world's facts (improvised details and lasting changes, recorded into the lore).
 */
type ReviewKind = "notes" | "lore";
const FIRES: Record<ReviewKind, string[]> = {
  notes: Object.keys(CATEGORIES),
  lore: ["improvised_detail", "other_world_update"],
};

/** Which reviews a set of flags fires (the notes first). */
export function plan(flags: string[]): ReviewKind[] {
  return (["notes", "lore"] as const).filter(k => FIRES[k].some(f => flags.includes(f)));
}

export interface ReviewRecord { kind: ReviewKind; summary: string; changes: string[]; costUsd: number; latencyMs: number; error?: string }

/** The binding rulings of the moment: its dice lines. */
const rulings = (view: WorkingSet, turn: number) => view.transcript.flatMap(e => e.turn === turn && e.roll !== undefined ? [e.roll] : []);

/** The notes' parts as the notes review is told them: each one's key, how many lines it holds, and what goes in it. */
export const partsText = (): string => SECTIONS.map(s => `- ${s.key} (${s.heading}; ${s.most === 1 ? "one line" : `${s.most} lines at most`}): ${s.about}.`).join("\n");

interface NoteUpdate { characterId: string; section: NoteSection; line: string; replaces: string }

/**
 * The notes on the people present brought up to date (memory-review.md): one structured call, given
 * the moment and each one's notes as they stand, answering with updates, each a line of someone's
 * notes rewritten (`replaces`, word for word from their notes), taken out (an empty line) or added
 * (no `replaces`). Each is written at once (notes.ts note), so a full part gives up its oldest line,
 * and one the notes have already changes nothing.
 */
async function reviewNotes(view: WorkingSet, turn: number, flags: string[], effort: "low" | "medium" | "high", calls?: CallContext): Promise<ReviewRecord> {
  const started = performance.now();
  const changes: string[] = [];
  const present = view.present;
  try {
    const people = present.map(c => `- ${c.id}: ${c.name}\n${(notesText(readNotes(view.game, c.id), { keys: true }) ?? "(no notes yet)").split("\n").map(l => `    ${l}`).join("\n")}`).join("\n");
    const dice = rulings(view, turn);
    const result = await respondJson<{ updates: NoteUpdate[]; summary: string }>({
      operation: "memory.review.notes", model: LUNA, effort, maxOutputTokens: 8000,
      instructions: prompt("memory-review", { parts: partsText() }),
      input: [{ role: "user", content: [
        `## Your task: the GM's notes on the people here (flags raised on this moment: ${flags.join(", ")})`,
        `## Scene: ${view.scene.title}\n${view.scene.premise}`,
        `## The player character\n${view.player.who}`,
        `## The people here (ids), and your notes on each so far\n${people}`,
        ...(dice.length ? [`## Binding rulings this moment\n${dice.map(r => `- ${r}`).join("\n")}`] : []),
        `## Earlier in the scene\n${before(view, turn) || "(nothing yet)"}`,
        `## The moment to review\n${exchange(view, turn)}`,
      ].join("\n\n") }],
      json: { name: "gm_notes", schema: notesSchema(present.map(c => c.id)) },
      ...(calls ? { calls } : {}),
    });
    for (const u of result.updates ?? []) {
      const person = present.find(c => c.id === u.characterId);
      if (!person || !NOTE_SECTIONS.includes(u.section)) continue;
      const noted = note(view.game, { id: person.id, name: person.name }, u.section, u.line ?? "", { replaces: u.replaces, origin: { scene: view.scene.id, turn } });
      if (noted.did !== "kept") changes.push(changeOf(person.id, u.section, noted));
    }
    return { kind: "notes", summary: result.summary ?? "", changes, costUsd: result._meta.costUsd, latencyMs: performance.now() - started };
  } catch (error) {
    return { kind: "notes", summary: "", changes, costUsd: 0, latencyMs: performance.now() - started, error: (error as Error).message };
  }
}

function notesSchema(ids: string[]): Record<string, unknown> {
  return {
    type: "object", additionalProperties: false, required: ["updates", "summary"],
    properties: {
      updates: { type: "array", items: { type: "object", additionalProperties: false, required: ["characterId", "section", "line", "replaces"], properties: {
        characterId: { type: "string", enum: ids, description: "Whose notes: one of the people here." },
        section: { type: "string", enum: NOTE_SECTIONS, description: "The part of their notes." },
        line: { type: "string", description: "The line as it should read now: one sentence in the third person. Empty, with replaces, to take that line out." },
        replaces: { type: "string", description: "The line of theirs this rewrites, word for word from their notes; empty to add a new line." },
      } } },
      summary: { type: "string", description: "One sentence: what changed in whose notes, or that nothing needed to." },
    },
  };
}

/** A note's update in a few words, for the review's record: "note kell seen: added …", "note kell promises: rewrote … → …". */
function changeOf(id: string, section: NoteSection, noted: Noted): string {
  const what = noted.did === "rewrote" ? `rewrote "${noted.was}" → "${noted.line}"` : noted.did === "removed" ? `took out "${noted.was}"` : `${noted.did} "${noted.line}"`;
  return `note ${id} ${section}: ${what}${noted.dropped ? ` (gave up "${noted.dropped}")` : ""}`;
}

const string = (description: string) => ({ type: "string", description });
const TOOLS: ToolDef[] = [
  { name: "search_lore", description: "Keyword search across the lore (titles, summaries and bodies). Returns paths with snippets; results are not relevance-ranked.", parameters: { type: "object", additionalProperties: false, required: ["query"], properties: { query: string("Keywords.") } } },
  { name: "read_doc", description: "Read a lore document by path (its frontmatter and body).", parameters: { type: "object", additionalProperties: false, required: ["path"], properties: { path: string("Document path, e.g. 'Cast/Cob/private.md'.") } } },
  { name: "edit_doc", description: "Replace an exact passage of a document's body with new text (read the document first). Use it to add a fact to the right section, or to correct something.", parameters: { type: "object", additionalProperties: false, required: ["path", "old_text", "new_text"], properties: { path: string("Document path."), old_text: string("Exact existing text to replace (must occur once)."), new_text: string("Replacement text.") } } },
  { name: "create_doc", description: "Create a new lore document when no existing one is the right home for a fact.", parameters: { type: "object", additionalProperties: false, required: ["path", "summary", "visibility", "body"], properties: {
    path: string("New document path ending in .md, next to related lore (e.g. 'Places/Drowned Rat regulars.md'). Link to it from a related doc with a relative Markdown link, spaces written as %20."),
    summary: string("One or two sentences naming the people, topics and details it covers, in words a player would use."),
    visibility: { type: "string", enum: ["public", "private", "gm"] },
    readers: { type: "array", items: { type: "string" }, description: "For private docs: e.g. ['character:kell']." },
    body: string("Markdown body, starting with a # title."),
  } } },
];

/**
 * The world-facts agent (review/system.md and its categories' prompts): a Luna tool loop that records
 * an improvised detail or a lasting change in the lore doc where it belongs. People's notes are the
 * notes review's, so it neither edits nor makes one.
 */
async function reviewLore(view: WorkingSet, turn: number, flags: string[], effort: "low" | "medium" | "high", calls?: CallContext): Promise<ReviewRecord> {
  const changes: string[] = [];
  const handle = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const s = (k: string) => { const v = args[k]; if (typeof v !== "string" || !v.trim()) throw new InvalidToolArguments(`${name} needs ${k}`); return v; };
    const notesOff = (path: string) => (isNotesPath(path) ? { ok: false, error: "That's someone's notes, which the notes review keeps: record the fact in the lore." } : undefined);
    switch (name) {
      case "read_doc": { const d = readDoc(view.game, s("path")); return d ? { ok: true, path: d.path, meta: d.meta, body: d.body } : { ok: false, error: "not found" }; }
      case "search_lore": return { ok: true, results: searchDocs(view.game, s("query")) };
      case "edit_doc": {
        const off = notesOff(s("path"));
        if (off) return off;
        try { editDoc(view.game, s("path"), s("old_text"), String(args.new_text ?? "")); } catch (error) { return { ok: false, error: (error as Error).message }; }
        changes.push(`edit ${s("path")}`);
        return { ok: true };
      }
      case "create_doc": {
        const off = notesOff(s("path"));
        if (off) return off;
        const meta: DocMeta = { summary: s("summary"), visibility: s("visibility") as DocMeta["visibility"], ...(Array.isArray(args.readers) ? { readers: args.readers as string[] } : {}), scene: view.scene.id, turn };
        try { createDoc(view.game, s("path"), meta, s("body")); } catch (error) { return { ok: false, error: (error as Error).message }; }
        changes.push(`create ${s("path")}`);
        return { ok: true };
      }
      default: throw new InvalidToolArguments(`Unknown tool ${name}`);
    }
  };
  const people = view.present.map(c => { const entry = characterEntry(c.id); return `- ${c.id}: ${c.name}${entry ? ` (lore: ${entry})` : ""}`; }).join("\n");
  const dice = rulings(view, turn);
  const started = performance.now();
  try {
    const result = await runTools({
      operation: "memory.review.lore", effort,
      instructions: [prompt("review/system"), ...(flags.includes("improvised_detail") ? [prompt("review/improvised")] : []), ...(flags.includes("other_world_update") ? [prompt("review/world")] : []), prompt("review/focused")].join("\n\n"),
      input: [{ role: "user", content: [
        `## Your task: the world facts (lore) review (flags raised on this moment: ${flags.filter(f => FIRES.lore.includes(f)).join(", ")})`,
        `## Scene: ${view.scene.title}\n${view.scene.premise}${view.scene.lore?.length ? `\nLore for this place: ${view.scene.lore.join(", ")}` : ""}`,
        `## What the scene's prep already establishes (narrating it is not improvising it)\n${prepSummary(view)}`,
        `## The player character\n${view.player.who} (their doc: ${playerDocPath(view.player.name)})`,
        `## People present (ids), with their lore entry\n${people}`,
        ...(dice.length ? [`## Binding rulings this moment\n${dice.map(r => `- ${r}`).join("\n")}`] : []),
        `## Earlier in the scene\n${before(view, turn) || "(nothing yet)"}`,
        `## The moment to review\n${exchange(view, turn)}`,
      ].join("\n\n") }],
      tools: TOOLS,
      ...(calls ? { calls } : {}),
    }, handle);
    return { kind: "lore", summary: result.text, changes, costUsd: result.costUsd, latencyMs: performance.now() - started };
  } catch (error) {
    return { kind: "lore", summary: "", changes, costUsd: 0, latencyMs: performance.now() - started, error: (error as Error).message };
  }
}

/**
 * One turn, V1-style: attention, then the fired reviews in order (the notes, then the lore, which
 * sees what the notes wrote). `calls`: a request's call context (the AI service's), which the reviews'
 * calls go through, and the attention filter too when no decider is given.
 */
export async function reviewTurn(view: WorkingSet, turn: number, options: { decider?: Decider; effort?: "low" | "medium" | "high"; calls?: CallContext } = {}): Promise<{ flags: string[]; reviews: ReviewRecord[] }> {
  const flags = await attend(view, turn, options.decider ?? (options.calls ? new JevDecider(JEV_MODEL, "jev", options.calls) : undefined));
  const reviews: ReviewRecord[] = [];
  const effort = options.effort ?? "medium";
  for (const kind of plan(flags)) {
    if (kind === "notes" && !view.present.length) continue;
    reviews.push(kind === "notes" ? await reviewNotes(view, turn, flags, effort, options.calls) : await reviewLore(view, turn, flags, effort, options.calls));
  }
  return { flags, reviews };
}
