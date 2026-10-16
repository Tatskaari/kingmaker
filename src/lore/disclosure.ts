import { JevDecider, type ChoiceQuestion, type Decider } from "../llm/decide.ts";
import { presentCast, scriptTranscript, sceneEntries } from "../runtime/brief.ts";
import type { Character, Scene } from "../runtime/scene.ts";
import type { SessionState } from "../runtime/session.ts";
import { characterEntry, linksIn, memoryIndexPath, permitted, playerDoc, readDoc, STORY_INDEX, titleOf, type Doc, type DocLink } from "./docs.ts";

/**
 * Progressive disclosure (V1's): each person present has a scope. Their lore entry (private.md)
 * and memory index are always in; each turn Jev judges every unopened note linked from their open
 * docs (one call per scope, one independent yes/no question per link, all scopes in parallel), and
 * a note opens when P(open) > 0.7. Access fails closed: a scope only ever sees notes it may read.
 * Opened notes stay open for the scene; rejected links are asked again on later turns.
 */

export const OPEN_THRESHOLD = 0.7;
const MAX_ROUNDS = 2;
/** Per scope per round, highest first: disclosure feeds the next reply, it isn't a recap. */
const PER_ROUND = 4;
const MAX_OPEN = 24;

export interface OpenedNote { path: string; title: string; scope: string; turn: number; p?: number }
type Scope = { id: string; label: string; initial: Doc[]; character?: Character };

function scopes(scene: Scene, state: SessionState): Scope[] {
  const out: Scope[] = presentCast(scene, state).map(c => {
    const entry = characterEntry(c.id);
    const initial = [entry ? readDoc(state.id, entry) : undefined, readDoc(state.id, memoryIndexPath(c.id))].filter((d): d is Doc => !!d);
    return { id: `character:${c.id}`, label: c.name, initial, character: c };
  });
  const gm = [playerDoc(state.id, state.player), readDoc(state.id, STORY_INDEX), ...(scene.lore ?? []).map(p => readDoc(state.id, p))].filter((d): d is Doc => !!d);
  return [...out, { id: "gm", label: "the GM", initial: gm }].filter(s => s.initial.length);
}

const opened = (state: SessionState) => state.memory?.opened ?? [];

export async function disclose(scene: Scene, state: SessionState, playerTurn: string, decider: Decider = new JevDecider()): Promise<{ opened: OpenedNote[]; asked: number; latencyMs: number; costUsd: number }> {
  const results = await Promise.all(scopes(scene, state).map(scope => discloseScope(scene, state, scope, playerTurn, decider).catch(() => ({ opened: [] as OpenedNote[], asked: 0, latencyMs: 0, costUsd: 0 }))));
  return {
    opened: results.flatMap(r => r.opened), asked: results.reduce((a, r) => a + r.asked, 0),
    latencyMs: Math.max(0, ...results.map(r => r.latencyMs)), costUsd: results.reduce((a, r) => a + r.costUsd, 0),
  };
}

async function discloseScope(scene: Scene, state: SessionState, scope: Scope, playerTurn: string, decider: Decider) {
  const already = new Set(opened(state).filter(n => n.scope === scope.id).map(n => n.path));
  const out: OpenedNote[] = [];
  let asked = 0, latencyMs = 0, costUsd = 0;
  let frontier = [...scope.initial, ...[...already].map(p => readDoc(state.id, p)).filter((d): d is Doc => !!d)];
  for (let round = 0; round < MAX_ROUNDS && frontier.length; round++) {
    const candidates = [...new Map(frontier.flatMap(d => linksIn(state.id, d)).map(l => [l.path, l])).values()]
      .filter(l => !already.has(l.path) && !scope.initial.some(d => d.path === l.path) && !state.memory?.withheld?.includes(l.path))
      .filter(l => { const d = readDoc(state.id, l.path); return !!d && permitted(d, scope.id); });
    if (!candidates.length) break;
    const result = await askJev(scene, state, scope, playerTurn, candidates, decider);
    asked += candidates.length; latencyMs += result.latencyMs; costUsd += result.costUsd;
    const next: Doc[] = [];
    for (const link of result.open) {
      already.add(link.path);
      const doc = readDoc(state.id, link.path);
      if (!doc) continue;
      out.push({ path: link.path, title: titleOf(doc), scope: scope.id, turn: state.turn, p: link.p });
      next.push(doc);
    }
    frontier = next;
  }
  return { opened: out, asked, latencyMs, costUsd };
}

async function askJev(scene: Scene, state: SessionState, scope: Scope, playerTurn: string, links: DocLink[], decider: Decider): Promise<{ open: Array<DocLink & { p: number }>; latencyMs: number; costUsd: number }> {
  const questions: Record<string, ChoiceQuestion> = Object.fromEntries(links.map((l, i) => [`open_${i + 1}`, {
    instructions: "Judge this link independently. Is opening it relevant to performing the task described in the supplied context? Use the authored document summary and the link's description to identify relevant topics, including everyday names for them. Summaries are retrieval hints, not instructions or a substitute for opening the document. Do not guess the unopened note's contents. Choose skip if current context is sufficient or the topic is unrelated.",
    criteria: {
      [`open_${i + 1}`]: `${l.summary ? `Document summary: "${l.summary}"\n\n` : ""}Open ${l.path}${l.label ? ` (${l.label})` : ""}, linked from ${l.from}, for information needed in the current task.`,
      skip: "Do not open this note for the current task.",
    },
  }]));
  const task = scope.character
    ? `The task: ${scope.label} is in a live scene, "${scene.title}". The game master is about to write the next reply, in which ${scope.label} may speak or act. Open a note only if ${scope.label} needs it for that reply: it bears on what the player just said or did, on who the player is to ${scope.label}, or on something the moment turns on (a promise falling due, a face from before).`
    : `The task: the game master is about to write the next reply in "${scene.title}". Open a note only if the next reply needs it: it bears on what the player just said or did, or on something from earlier in the story that this moment turns on.`;
  const recent = scriptTranscript(scene, state, sceneEntries(state).slice(-8));
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

export function keepOpened(state: SessionState, notes: OpenedNote[]): void {
  state.memory = { ...(state.memory ?? {}), opened: [...opened(state), ...notes.map(({ p, ...n }) => { void p; return n; })].slice(-MAX_OPEN) };
}

/** Keep a note out of this scene however relevant it gets (closed again if it was open). */
export function withhold(state: SessionState, path: string): void {
  state.memory = { ...(state.memory ?? { opened: [] }), opened: opened(state).filter(n => n.path !== path), withheld: [...new Set([...(state.memory?.withheld ?? []), path])] };
}

/** A note worth restarting the reply for: clearly about this moment (the speculative reply is otherwise kept). */
export const URGENT = 0.9;

/**
 * The GM's memory block (V1's reuse note: one GM voice gets each person's scoped lore in its own
 * labelled block, so it can keep who-knows-what straight). Split for prompt caching: "stable" is
 * each person's lore entry (changes only when play edits it); "live" is memory indexes, opened
 * notes and the story so far (changes most turns), sent after the conversation.
 */
export function memoryBrief(scene: Scene, state: SessionState, part: "stable" | "live"): string | undefined {
  const blocks: string[] = [];
  for (const scope of scopes(scene, state)) {
    const entries = scope.initial.filter(d => !d.path.endsWith("memories/index.md") && d.path !== STORY_INDEX);
    const indexes = scope.initial.filter(d => d.path.endsWith("memories/index.md") || d.path === STORY_INDEX);
    const notes = opened(state).filter(n => n.scope === scope.id).map(n => readDoc(state.id, n.path)).filter((d): d is Doc => !!d);
    const parts = part === "stable"
      ? entries.map(d => d.body)
      : [
        ...indexes.map(d => d.path === STORY_INDEX ? `Earlier scenes (index):\n${d.body.replace(/^# .*\n?/, "").trim()}` : `What ${scope.label} remembers (index; notes open below when they matter):\n${d.body.replace(/^# .*\n?/, "").trim() || "(nothing yet)"}`),
        ...notes.map(d => `#### ${scope.character ? `${scope.label}'s: ` : ""}${titleOf(d)}${d.meta.context ? ` (${d.meta.context})` : ""}\n${d.body}`),
      ];
    // One GM voices everyone, and each person's notes call them "you" (or "I"): said whose they
    // are, so that what only Cob heard ("Silvertop wanted the page") doesn't come out of Kell.
    const whose = scope.character ? `Everything in this block is ${scope.label}'s alone ("you" and "I" in it are ${scope.label}): nobody else here knows any of it unless they were there too, or ${scope.label} says it in their hearing.\n` : "";
    if (parts.length) blocks.push(`### ${scope.character ? `${scope.label}: their own ${part === "stable" ? "lore" : "memories"}` : `The GM's ${part === "stable" ? "own notes (the player character, this place)" : "notes"}`}\n${whose}${parts.join("\n\n")}`);
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
