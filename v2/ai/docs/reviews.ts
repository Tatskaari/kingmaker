import { JEV_MODEL, JevDecider, type ChoiceQuestion, type Decider } from "../llm/decide.ts";
import type { CallContext } from "../llm/openrouter.ts";
import { runTools, InvalidToolArguments, type ToolDef } from "../llm/tools.ts";
import { prompt } from "../prompts/index.ts";
import { characterEntry, createDoc, editDoc, memoryIndexPath, memoryLines, playerDocPath, readDoc, saveMemory, searchDocs, type DocMeta } from "./docs.ts";
import { script, type Ending, type WorkingSet } from "./types.ts";

/**
 * V1's background memory, rebuilt for scenes. After each reply Jev classifies the moment against
 * V1's attention categories. Nothing flagged: nothing runs (the common case, one Jev call).
 * Each flagged category fires its own focused review: a Luna tool loop with only its tools, run
 * in order. Personal memories (commitments, relationships, exchanges) and world facts (improvised
 * details, world changes) are separate agents. Each is handed the scene's working set (types.ts).
 */

const GUIDANCE = "Analyze the latest exchange in this live roleplaying scene (the player's turn and the game master's reply, which voices every character) for things the player might expect the world to react to. You are the GM's attention filter: help a living, responsive world remember what was said, follow through on agreements, and reconcile collaborative improvisation. Think like a good game master: help the player tell a fun, surprising story, honour binding roll outcomes, preserve continuity, and make meaningful interactions matter. Prefer flagging a plausible need for follow-up over silently losing it. Flagging asks the GM to review; it does not establish a claim as true, move anyone, transfer an item or complete an objective. Classify each category independently. Do not flag old developments merely because they appear in history, or routine greetings with no new detail, commitment or consequence. Do not invent missing details.";

/** V1's category criteria (lore/gm_prompts/conversation/attention), for a scene where the GM voices everyone. */
export const CATEGORIES: Record<string, string> = {
  immediate_commitment: "Would the player expect a character (or the player character) to do something now? Flag a specific immediate agreement or undertaking, including indirect assent such as 'Lead on', 'After you', or 'Let me fetch it'. Do not flag vague support, completed actions, future-only plans or refused requests.",
  deferred_commitment: "Would the player expect someone to remember and honour a specific promise later, or when a condition is met? Flag it for a future obligation; preserve stated timing or triggers without inventing them. Immediate-only actions, vague support and hypothetical discussion are not deferred promises.",
  general_commitment: "Would the player expect ongoing support, allegiance or willingness to help after this exchange? Flag broad commitments such as 'You have my support' without turning them into a specific invented task.",
  improvised_detail: "Did the player or the GM introduce a concrete story detail not already established in the scene's prep or lore? Flag it for GM reconciliation so the story can evolve collaboratively. If the player introduces a detail and the characters don't explicitly deny it, flag it: implicit acceptance, hedging, topic changes and simply going along all qualify. Explicit rejection of the player's claim, already established facts, requests, future proposals and clearly hypothetical examples alone do not qualify. Preserve the distinction between a shared fact, belief and unresolved claim; the flag does not decide which it is.",
  relationship_or_knowledge_change: "Would the player expect a character to remember something newly learned, or behave differently after a meaningful change in trust, suspicion, affection, hostility or forgiveness? Flag learning a consequential secret, accepting an apology, or a reaction showing changed feelings, including towards the player character after something they did. Mere repeated facts, routine pleasantries or a player claim without a character reaction are not enough.",
  conversational_exchange: "Would the player expect an agreed gift, payment, handover or trade to take effect? Flag accepted terms or a narrated exchange. Rejected offers, requests with no agreement and hypothetical trades do not qualify.",
  witnessed: "Did someone present see or hear for themselves something the story may need them to tell or swear to later: a confession or admission, who came or went and when, something handed over, taken or found, a crime, a name said? Flag it for anyone who was there to see or hear it, including whoever stood watch or kept out of the way, and a companion of the player's. Routine talk, and what everyone already knew, do not qualify.",
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
  // A false flag costs one review that writes nothing; a missed flag loses the memory. Trigger low.
  return Object.keys(CATEGORIES).filter(id => decision.answers[id]?.choice === "flagged" && (decision.answers[id]?.probabilities?.flagged ?? 1) >= FLAG_THRESHOLD);
}

export const FLAG_THRESHOLD = 0.4;

/**
 * Two review agents (the user's split): personal memories (what each person present will remember:
 * promises, changed feelings, gifts) and world facts (improvised details and lasting changes,
 * recorded into the lore). Each is fired by its V1 attention categories.
 */
type ReviewKind = "memories" | "lore";
const FIRES: Record<ReviewKind, string[]> = {
  memories: ["immediate_commitment", "deferred_commitment", "general_commitment", "relationship_or_knowledge_change", "conversational_exchange", "witnessed"],
  lore: ["improvised_detail", "other_world_update"],
};
const PROMPTS: Record<ReviewKind, (flags: string[]) => string[]> = {
  memories: flags => [
    ...(flags.some(f => f.endsWith("_commitment")) ? ["review/commitment"] : []),
    ...(flags.includes("relationship_or_knowledge_change") ? ["review/relationship"] : []),
    ...(flags.includes("conversational_exchange") ? ["review/exchange"] : []),
    // What a witness saw and heard for themselves (Kell watching Sallow come in at the Heron's land door).
    ...(flags.includes("witnessed") ? ["review/witnessed"] : []),
  ],
  lore: flags => [...(flags.includes("improvised_detail") ? ["review/improvised"] : []), ...(flags.includes("other_world_update") ? ["review/world"] : []), "review/focused"],
};

/** Which agents a set of flags fires (personal memories first). */
export function plan(flags: string[]): ReviewKind[] {
  return (["memories", "lore"] as const).filter(k => FIRES[k].some(f => flags.includes(f)));
}

const string = (description: string) => ({ type: "string", description });
const TOOL: Record<string, ToolDef> = {
  save_memory: { name: "save_memory", description: "Save a durable private memory for a character based only on what they experienced, learned, or believe. Distinguish claims from facts. Use this tool for new memories: it creates a separate note and adds its title/context link to their memory index. Avoid duplicate memories.", parameters: { type: "object", additionalProperties: false, required: ["characterId", "title", "context", "content"], properties: {
    characterId: string("The id of the character who remembers (one of the people present)."),
    title: string("What this memory is about in a few words, using names and everyday words the player might use later."),
    context: string("One or two sentences describing the context in which this memory was recorded."),
    content: string("The actual content of the memory from this character's perspective, in their voice."),
  } } },
  list_memories: { name: "list_memories", description: "List a character's memory index (titles and contexts, with paths).", parameters: { type: "object", additionalProperties: false, required: ["characterId"], properties: { characterId: string("The character's id.") } } },
  read_doc: { name: "read_doc", description: "Read a lore or memory document by path (its frontmatter and body).", parameters: { type: "object", additionalProperties: false, required: ["path"], properties: { path: string("Document path, e.g. 'Cast/Cob/private.md' or a memory note path.") } } },
  search_lore: { name: "search_lore", description: "Keyword search across the lore (titles, summaries and bodies). Returns paths with snippets; results are not relevance-ranked.", parameters: { type: "object", additionalProperties: false, required: ["query"], properties: { query: string("Keywords.") } } },
  edit_doc: { name: "edit_doc", description: "Replace an exact passage of a document's body with new text (read the document first). Use it to add a fact to the right section, or to correct something.", parameters: { type: "object", additionalProperties: false, required: ["path", "old_text", "new_text"], properties: { path: string("Document path."), old_text: string("Exact existing text to replace (must occur once)."), new_text: string("Replacement text.") } } },
  create_doc: { name: "create_doc", description: "Create a new lore document when no existing one is the right home for a fact.", parameters: { type: "object", additionalProperties: false, required: ["path", "summary", "visibility", "body"], properties: {
    path: string("New document path ending in .md, next to related lore (e.g. 'Places/Drowned Rat regulars.md'). Link to it from a related doc with a relative Markdown link, spaces written as %20."),
    summary: string("One or two sentences naming the people, topics and details it covers, in words a player would use."),
    visibility: { type: "string", enum: ["public", "private", "gm"] },
    readers: { type: "array", items: { type: "string" }, description: "For private docs: e.g. ['character:kell']." },
    body: string("Markdown body, starting with a # title."),
  } } },
};

const TOOLS_FOR: Record<ReviewKind, string[]> = {
  memories: ["save_memory", "list_memories", "read_doc", "edit_doc"],
  lore: ["search_lore", "read_doc", "edit_doc", "create_doc", "save_memory", "list_memories"],
};

export interface ReviewRecord { kind: ReviewKind; summary: string; changes: string[]; costUsd: number; latencyMs: number; error?: string }

async function review(kind: ReviewKind, view: WorkingSet, turn: number, flags: string[], effort: "low" | "medium" | "high", calls?: CallContext): Promise<ReviewRecord> {
  const present = view.present;
  const changes: string[] = [];
  const handle = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const s = (k: string) => { const v = args[k]; if (typeof v !== "string" || !v.trim()) throw new InvalidToolArguments(`${name} needs ${k}`); return v; };
    switch (name) {
      case "save_memory": {
        const c = present.find(x => x.id === s("characterId"));
        if (!c) throw new InvalidToolArguments(`Only people present can remember this: ${present.map(x => x.id).join(", ")}`);
        const path = saveMemory(view.game, { id: c.id, name: c.name }, { title: s("title"), context: s("context"), content: s("content") }, { scene: view.scene.id, turn });
        changes.push(`memory ${c.id}: ${s("title")}`);
        return { ok: true, path };
      }
      case "list_memories": return { ok: true, index: memoryLines(view.game, s("characterId")), path: memoryIndexPath(s("characterId")) };
      case "read_doc": { const d = readDoc(view.game, s("path")); return d ? { ok: true, path: d.path, meta: d.meta, body: d.body } : { ok: false, error: "not found" }; }
      case "search_lore": return { ok: true, results: searchDocs(view.game, s("query")) };
      case "edit_doc": {
        try { editDoc(view.game, s("path"), s("old_text"), String(args.new_text ?? "")); } catch (error) { return { ok: false, error: (error as Error).message }; }
        changes.push(`edit ${s("path")}`);
        return { ok: true };
      }
      case "create_doc": {
        const meta: DocMeta = { summary: s("summary"), visibility: s("visibility") as DocMeta["visibility"], ...(Array.isArray(args.readers) ? { readers: args.readers as string[] } : {}), scene: view.scene.id, turn };
        try { createDoc(view.game, s("path"), meta, s("body")); } catch (error) { return { ok: false, error: (error as Error).message }; }
        changes.push(`create ${s("path")}`);
        return { ok: true };
      }
      default: throw new InvalidToolArguments(`Unknown tool ${name}`);
    }
  };
  const people = present.map(c => {
    const entry = characterEntry(c.id);
    return `- ${c.id}: ${c.name}${entry ? ` (lore: ${entry})` : ""}. Memory index: ${memoryLines(view.game, c.id).length ? `\n${memoryLines(view.game, c.id).map(l => `    ${l}`).join("\n")}` : "(empty)"}`;
  }).join("\n");
  const rolls = view.transcript.flatMap(e => e.turn === turn && e.roll !== undefined ? [e.roll] : []);
  const started = performance.now();
  try {
    const result = await runTools({
      operation: `memory.review.${kind}`, effort,
      instructions: [prompt("review/system"), ...PROMPTS[kind](flags).map(p => prompt(p)), kind === "memories" ? "Write at most one memory per person for this moment, and none where their memories already cover it: steps along the way and routine talk don't need remembering. Someone recalling or answering a question about the past isn't a new memory: record what they newly learned or how their view changed, never their own recollection." : ""].filter(Boolean).join("\n\n"),
      input: [{ role: "user", content: [
        `## Your task: the ${kind === "memories" ? "personal memories" : "world facts (lore)"} review (flags raised on this moment: ${flags.filter(f => FIRES[kind].includes(f)).join(", ")})`,
        `## Scene: ${view.scene.title}\n${view.scene.premise}${view.scene.lore?.length ? `\nLore for this place: ${view.scene.lore.join(", ")}` : ""}`,
        ...(kind === "lore" ? [`## What the scene's prep already establishes (narrating it is not improvising it)\n${prepSummary(view)}`] : []),
        `## The player character\n${view.player.who}${kind === "lore" ? ` (their doc: ${playerDocPath(view.player.name)})` : ""}`,
        `## People present (ids), with their lore entry and memory index\n${people}`,
        ...(rolls.length ? [`## Binding rulings this moment\n${rolls.map(r => `- ${r}`).join("\n")}`] : []),
        `## Earlier in the scene\n${before(view, turn) || "(nothing yet)"}`,
        `## The moment to review\n${exchange(view, turn)}`,
      ].join("\n\n") }],
      tools: TOOLS_FOR[kind].map(n => TOOL[n]!),
      ...(calls ? { calls } : {}),
    }, handle);
    return { kind, summary: result.text, changes, costUsd: result.costUsd, latencyMs: performance.now() - started };
  } catch (error) {
    return { kind, summary: "", changes, costUsd: 0, latencyMs: performance.now() - started, error: (error as Error).message };
  }
}

/**
 * One turn, V1-style: attention, then the fired reviews in order (each sees the last one's edits).
 * `calls`: a request's call context (the AI service's), which the review agents' tool loops go
 * through, and the attention filter too when no decider is given.
 */
export async function reviewTurn(view: WorkingSet, turn: number, options: { decider?: Decider; effort?: "low" | "medium" | "high"; calls?: CallContext } = {}): Promise<{ flags: string[]; reviews: ReviewRecord[] }> {
  const flags = await attend(view, turn, options.decider ?? (options.calls ? new JevDecider(JEV_MODEL, "jev", options.calls) : undefined));
  const reviews: ReviewRecord[] = [];
  for (const kind of plan(flags)) reviews.push(await review(kind, view, turn, flags, options.effort ?? "medium", options.calls));
  return { flags, reviews };
}

/**
 * V1's milestone broadcast: when a scene ends, everyone present gets one fixed memory of how it
 * ended (the authored outcome), so the ending itself is never left to chance.
 */
export function broadcastEnding(view: WorkingSet, exit: Ending): string[] {
  return view.present.map(c => saveMemory(view.game, { id: c.id, name: c.name }, {
    title: `${view.scene.title}: how it ended`,
    context: `I was there when it ended (${exit.title}).`,
    content: exit.outcome,
  }, { scene: view.scene.id, turn: view.turn }));
}
