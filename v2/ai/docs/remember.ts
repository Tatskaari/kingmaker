import { JevDecider, type ChoiceQuestion, type Decider } from "../llm/decide.ts";
import { LUNA, respondJson } from "../llm/openrouter.ts";
import { playerWho, presentCast, prompt, scriptTranscript, sceneEntries } from "../runtime/brief.ts";
import type { Scene } from "../runtime/scene.ts";
import type { SessionState } from "../runtime/session.ts";
import { memoryLines, saveFact, saveMemory, type MemoryInput } from "./docs.ts";

/**
 * Background memory capture (V1's attention filter and focused reviews). After each reply Jev
 * flags what the player would expect the world to remember; only flagged turns get a review,
 * which writes first-person memories for the people who were there (and shared facts). At the
 * end of a scene, everyone present gets one memory of what they'll carry away.
 */

const GUIDANCE = "Analyze the latest exchange in this roleplaying scene for things the people in it should still remember later: in a later part of this scene, or when the player meets them again in another place on another day. You are the GM's attention filter: help a living world remember what matters, follow through on agreements and keep improvised history consistent. Flag only what the player would be disappointed to find forgotten. Flagging asks the GM to review; it does not establish a claim as true. Classify each category independently, and only for the latest exchange: don't flag old developments merely because they appear in the history, and don't flag routine talk, questions, small courtesies, descriptions of the moment or steps along the way to something not yet done.";

export const ATTENTION: Record<string, string> = {
  memorable_deed: "Did the player character do or say something in the latest exchange that the people who saw it would still bring up a week later: a real kindness or cruelty, a threat, a daring or daft act, a public humiliation, a lie found out, how they treated someone weaker? Ordinary politeness, questions and small talk don't count.",
  relationship_or_knowledge_change: "Would the player expect a character to remember something newly learned, or behave differently after a meaningful change in trust, suspicion, affection, hostility or forgiveness? Flag learning a consequential secret, accepting an apology or a reaction showing changed feelings. Mere repeated facts, routine pleasantries or a player claim without a character reaction are not enough.",
  commitment: "Would the player expect someone (a character, or the player character) to remember and honour a promise, deal or undertaking made in the latest exchange: something to do now, later, or when a condition is met, or a broad pledge of support? Vague goodwill, refused requests and hypotheticals don't count.",
  improvised_detail: "Did the player or the GM introduce a concrete, lasting story detail not in the scene's prep that later scenes might depend on: a name, someone's history, a past event, who owns or owes what? Implicit acceptance counts. Descriptions of the moment (sounds, gestures, the weather), requests, hypotheticals and denied claims don't.",
  exchange: "Was an agreed gift, payment, handover or trade carried out in the latest exchange? Rejected offers and requests with no agreement don't count.",
};

const exchangeAt = (scene: Scene, state: SessionState, turn: number) => scriptTranscript(scene, state, sceneEntries(state).filter(e => e.turn === turn));

export async function attend(scene: Scene, state: SessionState, turn: number, decider: Decider = new JevDecider()): Promise<string[]> {
  const latest = exchangeAt(scene, state, turn);
  if (!latest.trim()) return [];
  const earlier = scriptTranscript(scene, state, sceneEntries(state).filter(e => e.turn < turn).slice(-8));
  const questions: Record<string, ChoiceQuestion> = Object.fromEntries(Object.entries(ATTENTION).map(([id, criterion]) => [id, {
    instructions: `${GUIDANCE}\nEvaluate ONLY ${id}: ${criterion}`,
    criteria: { flagged: `There is evidence of ${id} under the category rules; flag it for GM follow-up.`, not_flagged: `The ${id} category rules do not apply; do not flag this category.` },
  }]));
  const decision = await decider.decide([
    "# SYSTEM", `Scene: ${scene.title}. ${scene.premise}`, `People here: ${presentCast(scene, state).map(c => `${c.name} (${c.attitude.split(/[.;]/)[0]})`).join("; ")}`,
    "# USER", earlier ? `Earlier in the scene:\n${earlier}` : "", `The latest exchange:\n${latest}`,
  ].filter(Boolean).join("\n\n"), questions, "memory.attend");
  return Object.keys(ATTENTION).filter(id => decision.answers[id]?.choice === "flagged" && (decision.answers[id]?.probabilities?.flagged ?? 1) >= 0.5);
}

interface ReviewOutput { memories: Array<MemoryInput & { character: string }>; facts: MemoryInput[] }

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["memories", "facts"],
  properties: {
    memories: { type: "array", items: { type: "object", additionalProperties: false, required: ["character", "title", "context", "content"], properties: {
      character: { type: "string", description: "The id of the person who remembers (one of the people present)." },
      title: { type: "string" }, context: { type: "string" }, content: { type: "string" } } } },
    facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "context", "content"], properties: { title: { type: "string" }, context: { type: "string" }, content: { type: "string" } } } },
  },
};

function people(scene: Scene, state: SessionState): string {
  return presentCast(scene, state).map(c => {
    const held = memoryLines(state.id, c.id);
    return `- ${c.id}: ${c.name}. ${c.wants}${held.length ? `\n  Already remembers:\n${held.map(l => `  ${l}`).join("\n")}` : ""}`;
  }).join("\n");
}

function store(scene: Scene, state: SessionState, output: ReviewOutput, turn: number): string[] {
  const present = new Map(presentCast(scene, state).map(c => [c.id, c]));
  const saved: string[] = [];
  for (const m of output.memories) {
    const c = present.get(m.character);
    if (!c || !m.content?.trim()) continue; // only witnesses remember
    saved.push(saveMemory(state.id, { id: c.id, name: c.name }, m, { scene: scene.id, turn }));
  }
  for (const f of output.facts) if (f.content?.trim()) saved.push(saveFact(state.id, f, { scene: scene.id, turn }));
  return saved;
}

/** One turn: attention filter, then (only if flagged) the memory review. */
export async function rememberTurn(scene: Scene, state: SessionState, turn: number, decider?: Decider): Promise<{ flagged: string[]; saved: string[]; costUsd: number }> {
  const flagged = await attend(scene, state, turn, decider);
  if (!flagged.length) return { flagged, saved: [], costUsd: 0 };
  const result = await respondJson<ReviewOutput>({
    operation: "memory.review", model: LUNA, effort: "medium",
    instructions: prompt("memory-review"),
    input: [{ role: "user", content: [
      `## Scene: ${scene.title}\n${scene.premise}`,
      `## The player character\n${playerWho(state)}`,
      `## People present (ids), and what they already remember\n${people(scene, state)}`,
      `## The scene so far\n${scriptTranscript(scene, state, sceneEntries(state).filter(e => e.turn < turn).slice(-12))}`,
      `## The moment to review (flagged: ${flagged.join(", ")})\n${exchangeAt(scene, state, turn)}`,
    ].join("\n\n") }],
    json: { name: "memories", schema: SCHEMA }, maxOutputTokens: 3000,
  });
  return { flagged, saved: store(scene, state, result, turn), costUsd: result._meta.costUsd };
}

/** End of scene: what each person present carries away (one memory each, at most). */
export async function rememberScene(scene: Scene, state: SessionState, ending: string): Promise<string[]> {
  const result = await respondJson<ReviewOutput>({
    operation: "memory.scene", model: LUNA, effort: "medium",
    instructions: prompt("memory-scene"),
    input: [{ role: "user", content: [
      `## Scene: ${scene.title}\n${scene.premise}\nHow it ended: ${ending}`,
      `## The player character\n${playerWho(state)}`,
      `## People present (ids), and what they already remember\n${people(scene, state)}`,
      `## The scene as played\n${scriptTranscript(scene, state)}`,
    ].join("\n\n") }],
    json: { name: "memories", schema: { ...SCHEMA, properties: { ...SCHEMA.properties } } }, maxOutputTokens: 3000,
  });
  return store(scene, state, { memories: result.memories, facts: [] }, state.turn);
}
