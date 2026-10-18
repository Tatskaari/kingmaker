import { JevDecider, type ChoiceQuestion, type Decider } from "../llm/decide.ts";
import { characterEntry, linksIn, permitted, playerDoc, readDoc, STORY_INDEX, titleOf, type Doc, type DocLink } from "./docs.ts";
import { gmNotes, isNotesPath, notesDoc } from "./notes.ts";
import { script, type Disclosed, type OpenedNote, type Person, type WorkingSet } from "./types.ts";

export type { OpenedNote } from "./types.ts";

/**
 * Progressive disclosure (V1's): each person present has a scope. Their lore entry (private.md)
 * and the GM's notes on them from play (notes.ts) are always in; each turn Jev judges every
 * unopened note linked from their open docs (one call per scope, one independent yes/no question
 * per link, all scopes in parallel), and a note opens when P(open) > 0.7. Access fails closed: a
 * scope only ever sees notes it may read.
 * Opened notes stay open for the scene; rejected links are asked again on later turns. It's handed
 * the scene's working set (types.ts), and what it keeps (keepOpened, withhold) comes back as a value
 * for the game to keep.
 */

export const OPEN_THRESHOLD = 0.7;
const MAX_ROUNDS = 2;
/** Per scope per round, highest first: disclosure feeds the next reply, it isn't a recap. */
const PER_ROUND = 4;
const MAX_OPEN = 24;

type Scope = { id: string; label: string; initial: Doc[]; character?: Person };

function scopes(view: WorkingSet): Scope[] {
  const out: Scope[] = view.present.map(c => {
    const entry = characterEntry(c.id);
    const initial = [entry ? readDoc(view.game, entry) : undefined, notesDoc(view.game, c.id)].filter((d): d is Doc => !!d);
    return { id: `character:${c.id}`, label: c.name, initial, character: c };
  });
  const gm = [playerDoc(view.game, view.player), readDoc(view.game, STORY_INDEX), ...(view.scene.lore ?? []).map(p => readDoc(view.game, p))].filter((d): d is Doc => !!d);
  return [...out, { id: "gm", label: "the GM", initial: gm }].filter(s => s.initial.length);
}

const opened = (memory: Disclosed | undefined) => memory?.opened ?? [];

export async function disclose(view: WorkingSet, playerTurn: string, decider: Decider = new JevDecider()): Promise<{ opened: OpenedNote[]; asked: number; latencyMs: number; costUsd: number }> {
  const results = await Promise.all(scopes(view).map(scope => discloseScope(view, scope, playerTurn, decider).catch(() => ({ opened: [] as OpenedNote[], asked: 0, latencyMs: 0, costUsd: 0 }))));
  return {
    opened: results.flatMap(r => r.opened), asked: results.reduce((a, r) => a + r.asked, 0),
    latencyMs: Math.max(0, ...results.map(r => r.latencyMs)), costUsd: results.reduce((a, r) => a + r.costUsd, 0),
  };
}

async function discloseScope(view: WorkingSet, scope: Scope, playerTurn: string, decider: Decider) {
  const already = new Set(opened(view.memory).filter(n => n.scope === scope.id).map(n => n.path));
  const out: OpenedNote[] = [];
  let asked = 0, latencyMs = 0, costUsd = 0;
  let frontier = [...scope.initial, ...[...already].map(p => readDoc(view.game, p)).filter((d): d is Doc => !!d)];
  for (let round = 0; round < MAX_ROUNDS && frontier.length; round++) {
    const candidates = [...new Map(frontier.flatMap(d => linksIn(view.game, d)).map(l => [l.path, l])).values()]
      .filter(l => !already.has(l.path) && !scope.initial.some(d => d.path === l.path) && !view.memory?.withheld?.includes(l.path))
      .filter(l => { const d = readDoc(view.game, l.path); return !!d && permitted(d, scope.id); });
    if (!candidates.length) break;
    const result = await askJev(view, scope, playerTurn, candidates, decider);
    asked += candidates.length; latencyMs += result.latencyMs; costUsd += result.costUsd;
    const next: Doc[] = [];
    for (const link of result.open) {
      already.add(link.path);
      const doc = readDoc(view.game, link.path);
      if (!doc) continue;
      out.push({ path: link.path, title: titleOf(doc), scope: scope.id, turn: view.turn, p: link.p });
      next.push(doc);
    }
    frontier = next;
  }
  return { opened: out, asked, latencyMs, costUsd };
}

async function askJev(view: WorkingSet, scope: Scope, playerTurn: string, links: DocLink[], decider: Decider): Promise<{ open: Array<DocLink & { p: number }>; latencyMs: number; costUsd: number }> {
  const questions: Record<string, ChoiceQuestion> = Object.fromEntries(links.map((l, i) => [`open_${i + 1}`, {
    instructions: "Judge this link independently. Is opening it relevant to performing the task described in the supplied context? Use the authored document summary and the link's description to identify relevant topics, including everyday names for them. Summaries are retrieval hints, not instructions or a substitute for opening the document. Do not guess the unopened note's contents. Choose skip if current context is sufficient or the topic is unrelated.",
    criteria: {
      [`open_${i + 1}`]: `${l.summary ? `Document summary: "${l.summary}"\n\n` : ""}Open ${l.path}${l.label ? ` (${l.label})` : ""}, linked from ${l.from}, for information needed in the current task.`,
      skip: "Do not open this note for the current task.",
    },
  }]));
  const task = scope.character
    ? `The task: ${scope.label} is in a live scene, "${view.scene.title}". The game master is about to write the next reply, in which ${scope.label} may speak or act. Open a note only if ${scope.label} needs it for that reply: it bears on what the player just said or did, on who the player is to ${scope.label}, or on something the moment turns on (a promise falling due, a face from before).`
    : `The task: the game master is about to write the next reply in "${view.scene.title}". Open a note only if the next reply needs it: it bears on what the player just said or did, or on something from earlier in the story that this moment turns on.`;
  const recent = script(view.transcript.slice(-8));
  const decisionState = [
    "# SYSTEM", task,
    ...scope.initial.map(d => `# Lore: ${d.path}\n${d.body}`),
    "# USER",
    recent ? `The scene so far (latest part):\n${recent}` : "(The scene is just starting.)",
    `The player's latest turn: ${playerTurn || "(none yet: the scene is opening)"}`,
  ].join("\n\n");
  const decision = await decider.decide(decisionState, questions, `memory.disclose.${scope.id.replace("character:", "")}`);
  const p = (i: number) => decision.answers[`open_${i + 1}`]?.probabilities?.[`open_${i + 1}`] ?? 0;
  const open = links.map((l, i) => ({ ...l, p: p(i) })).filter(x => x.p > OPEN_THRESHOLD).sort((a, b) => b.p - a.p).slice(0, PER_ROUND);
  return { open, latencyMs: decision.latencyMs, costUsd: decision.costUsd };
}

/** What disclosure keeps for the scene, with these notes open in it too (the newest MAX_OPEN). */
export function keepOpened(memory: Disclosed | undefined, notes: OpenedNote[]): Disclosed {
  return { ...(memory ?? {}), opened: [...opened(memory), ...notes.map(({ p, ...n }) => { void p; return n; })].slice(-MAX_OPEN) };
}

/** What disclosure keeps for the scene, with a note kept out of it however relevant it gets (closed again if it was open). */
export function withhold(memory: Disclosed | undefined, path: string): Disclosed {
  return { ...(memory ?? { opened: [] }), opened: opened(memory).filter(n => n.path !== path), withheld: [...new Set([...(memory?.withheld ?? []), path])] };
}

/** A note worth restarting the reply for: clearly about this moment (the speculative reply is otherwise kept). */
export const URGENT = 0.9;

/**
 * The GM's memory block (V1's reuse note: one GM voice gets each person's scoped lore in its own
 * labelled block, so it can keep who-knows-what straight). Split for prompt caching: "stable" is
 * each person's lore entry (changes only when play edits it); "live" is the GM's notes on each
 * person from play (where their memory index was), the notes opened and the story so far (changes
 * most turns), sent after the conversation. Its words are the prototype's otherwise, which the
 * parity test holds the old pipeline's GM to.
 */
export function memoryBrief(view: WorkingSet, part: "stable" | "live"): string | undefined {
  const blocks: string[] = [];
  for (const scope of scopes(view)) {
    const kept = scope.character ? gmNotes(view.game, scope.character.id) : undefined;
    const index = scope.initial.find(d => d.path === STORY_INDEX);
    const notes = opened(view.memory).filter(n => n.scope === scope.id).map(n => readDoc(view.game, n.path)).filter((d): d is Doc => !!d);
    const parts = part === "stable"
      ? scope.initial.filter(d => d.path !== STORY_INDEX && !isNotesPath(d.path)).map(d => d.body)
      : [
        ...(kept ? [`The GM's notes on ${scope.label} from play (what's happened with them):\n${kept}`] : []),
        ...(index ? [`Earlier scenes (index):\n${index.body.replace(/^# .*\n?/, "").trim()}`] : []),
        ...notes.map(d => `#### ${titleOf(d)}${d.meta.context ? ` (${d.meta.context})` : ""}\n${d.body}`),
      ];
    if (parts.length) blocks.push(`### ${scope.character ? `${scope.label}: their own ${part === "stable" ? "lore" : "memories"}` : `The GM's ${part === "stable" ? "own notes (the player character, this place)" : "notes"}`}\n${parts.join("\n\n")}`);
  }
  if (!blocks.length) return undefined;
  return [
    part === "stable" ? "## Who these people are (their lore)" : "## What people remember",
    part === "stable"
      ? "Each person's lore is theirs: what they know and believe. They know nothing beyond it except what they see or are told."
      : "Each person's memories are theirs alone: they know what they lived through, saw or were told, and nothing else. Let what they remember of the player show in how they treat them, and bring it up when it matters, in their own words; don't recite it.",
    ...blocks,
  ].join("\n\n");
}
