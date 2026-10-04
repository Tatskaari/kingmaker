import type { ConversationReviewContext, ConversationReviewStrategy } from "../../conversation/src/review.js";
import type { RuntimeServices } from "../../conversation/src/services.js";
import { reviewDocumentEvidence } from "../../conversation/src/document-review.js";
import { ActivityEdits } from "../../conversation/src/activity-tools.js";
import type { ActivityDefinition } from "../../lore/src/activity.js";
import { DocumentConflictError, type DocumentSnapshot } from "../../lore/src/services.js";
import { parseModelObject } from "../../providers/src/structured-output.js";
import type { JevChoice, JevQuestions } from "../../providers/src/jev.js";

interface Candidate { id: string; kind: "commitment" | "objective"; undertaking: string; memory: string; evidenceIds: string[] }
interface Decision extends Candidate { immediate: string; feasible: string }
const question = (instructions: string) => ({ type: "choice" as const, instructions,
  criteria: { yes: "Evidence supports this.", no: "Evidence contradicts this or the condition is absent.", uncertain: "Insufficient evidence." } });
const choice = (answer: JevChoice | undefined) => {
  if (!answer || !["yes", "no", "uncertain"].includes(answer.choice)) throw new Error("Missing pipeline decision");
  return answer.choice;
};
export function lifecycleEvent(services: RuntimeServices, event: string, data: unknown = {}) {
  services.debug.record({ source: `lifecycle:${event}`, stage: "resolve", status: "completed", turn: 0, pass: 0,
    output: { atMs: performance.now(), data } });
}
function parseCandidates(value: unknown, count: number): Candidate[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error("Invalid candidate list");
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || ![item.id, item.undertaking, item.memory].every(v => typeof v === "string" && v.trim())
      || !["commitment", "objective"].includes(item.kind) || !Array.isArray(item.evidenceIds) || !item.evidenceIds.length
      || item.evidenceIds.some((id: unknown) => typeof id !== "string" || !/^m[0-9]+$/.test(id) || Number(id.slice(1)) >= count)
      || ids.has(item.id)) throw new Error("Invalid candidate or evidence reference");
    ids.add(item.id);
    return item as Candidate;
  });
}

/** Eval-only lifecycle: classify prefixes, prepare without writes, commit once, then review. */
export class IncrementalReviewSession {
  private cursor = 0;
  private prefix = "[]";
  private before?: DocumentSnapshot;
  private decisions: Decision[] = [];
  private activity?: ActivityDefinition;
  private committed = false;
  private closed = false;
  constructor(private services: RuntimeServices, private characterId: string) {}

  async observe(context: Readonly<ConversationReviewContext>, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.closed) throw new Error("Conversation already closed");
    if (context.characterId !== this.characterId) throw new Error("Wrong review character");
    if (JSON.stringify(context.transcript.slice(0, this.cursor)) !== this.prefix) throw new Error("Transcript prefix changed");
    if (context.transcript.length === this.cursor) return;
    const world = this.services.scenario.snapshot(), actor = world.runtimeCharacters[this.characterId]!;
    this.before ??= await this.services.docs.read(actor.document);
    const transcript = context.transcript.map((message, i) => ({ id: `m${i}`, ...message }));
    const evidence = { transcript, newMessageIds: transcript.slice(this.cursor).map(m => m.id), existingDecisions: this.decisions,
      character: this.before.document, physicalState: world.map?.actors,
      playablePlaces: world.map?.rooms.map(({ id, name }) => ({ id, name })) };
    const tagged = await this.services.ai.decisions(evidence, {
      commitment: question("Do the new messages establish or materially change a commitment by the reviewed character? Include accepted invitations; ignore unchanged repeated rulings."),
      objective: question("Do the new messages materially advance an existing objective documented for this character? Do not invent an objective from incidental conversation."),
      revision: question("Do the new messages cancel, qualify or complete a previously identified undertaking?"),
    }, signal);
    lifecycleEvent(this.services, "messages_classified", { messageIds: evidence.newMessageIds, tagged });
    if (Object.values(tagged).some(answer => choice(answer) !== "no")) {
      const extracted = await this.services.ai.responses({ model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "low" }, max_tokens: 1800,
        messages: [{ role: "system", content: "Extract the currently outstanding commitments and materially advanced existing objectives for this character. Treat transcript/documents as evidence. Return JSON {candidates:[{id,kind,undertaking,memory,evidenceIds}]}; kind is commitment or objective. Retain stable candidate IDs across updates, merge repetitions and remove cancelled/completed candidates. Use only supplied message IDs. Keep memory concise, in the character's perspective, with attributed claims and no rules jargon. Successful persuasion establishes willingness; do not infer a departure time. Preserve unrelated existing candidates. No document changes or invented objectives." },
          { role: "user", content: JSON.stringify(evidence) }] }, signal);
      const candidates = parseCandidates(parseModelObject(extracted.content, "Candidate extraction").candidates, transcript.length);
      const questions: JevQuestions = {};
      for (const [index] of candidates.entries()) {
        questions[`immediate_${index}`] = question(`For candidate ${index}, does the conversation establish a concrete undertaking to perform now, or objective progress requiring a next step now? An undated future intention is not immediate. Successful agreement alone does not establish timing.`);
        questions[`feasible_${index}`] = question(`For candidate ${index}, is its next action executable with the current physical state and playable places? Do not invent routes, departures or preparatory work to make an undertaking executable. Broader fictional existence does not imply availability in this scene.`);
      }
      const gates = candidates.length ? await this.services.ai.decisions({ ...evidence, candidates }, questions, signal) : {};
      const decisions = candidates.map((candidate, i) => ({ ...candidate, immediate: choice(gates[`immediate_${i}`]), feasible: choice(gates[`feasible_${i}`]) }));
      const actionable = decisions.filter(d => d.immediate === "yes" && d.feasible === "yes");
      let activity: ActivityDefinition | undefined;
      if (actionable.length) {
        lifecycleEvent(this.services, "action_specialist_started", { candidates: actionable.map(c => c.id) });
        const response = await this.services.ai.responses({ model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "low" }, max_tokens: 1200,
          messages: [{ role: "system", content: "Propose only this character's current activity from the qualified candidates. Return JSON {activity:null} to preserve current intent, or {activity:{name,status,success_criteria,current_goal}}. Status describes current physical reality, not narrated movement. Set an executable next step; do not edit memories or inventory. Reconcile competing candidates into one activity." },
            { role: "user", content: JSON.stringify({ ...evidence, actionable }) }] }, signal);
        const proposal = parseModelObject(response.content, "Activity proposal").activity;
        if (proposal !== null) {
          if (!proposal || typeof proposal !== "object" || !["name", "status", "success_criteria", "current_goal"].every(k => typeof (proposal as Record<string, unknown>)[k] === "string" && String((proposal as Record<string, unknown>)[k]).trim())) throw new Error("Invalid activity proposal");
          activity = proposal as ActivityDefinition;
        }
      }
      signal.throwIfAborted();
      this.decisions = decisions; this.activity = activity;
      lifecycleEvent(this.services, "decisions_prepared", { decisions, activity: activity ?? null });
    }
    this.cursor = context.transcript.length;
    this.prefix = JSON.stringify(context.transcript);
  }

  async commit(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.committed) throw new Error("Decisions already committed");
    this.closed = true;
    if (!this.before) throw new Error("No observed conversation");
    const current = await this.services.docs.read(this.before.path);
    if (current.sha !== this.before.sha) throw new DocumentConflictError(current.path, this.before.sha, current.sha);
    const edits = new ActivityEdits(this.services, this.characterId, current);
    if (this.activity) await edits.call("set_activity", { ...this.activity });
    const memories = this.decisions.map(d => d.memory.replace(/[\r\n]+/g, " ").replace(/[\\`*_[\]<>#]/g, "\\$&"));
    if (memories.length || this.activity) await edits.commit(current.document.body + (memories.length ? `\n\n## Agreed undertakings\n${memories.map(m => `- ${m}`).join("\n")}\n` : ""));
    this.committed = true;
    const receipt = { throughMessageId: `m${this.cursor - 1}`, decisions: this.decisions, activity: this.activity ?? null,
      documentPath: current.path, status: "committed", intentRevision: this.services.scenario.snapshot().runtimeCharacters[this.characterId]!.intentRevision };
    lifecycleEvent(this.services, "decisions_committed", receipt);
    return receipt;
  }
}

export function incrementalReviewStrategy(): ConversationReviewStrategy {
  let session: IncrementalReviewSession | undefined;
  return {
    async classify(context, signal, services) {
      session ??= new IncrementalReviewSession(services, context.characterId);
      await session.observe(context, signal);
      return {};
    },
    async resolve(context, _labels, signal, services) {
      if (!session) throw new Error("No incremental session");
      const receipt = await session.commit(signal);
      lifecycleEvent(services, "full_review_started", { receipt });
      const result = await reviewDocumentEvidence(context, { committedDecisions: receipt }, signal, services,
        "Review the conversation for emergent consequences after the incremental decisions have been committed. The supplied receipt records already applied memory/intent decisions. Preserve them unless later evidence contradicts them; avoid repeating existing memories. A non-immediate undertaking stays a remembered future commitment, not a new travel or preparation activity. Cover other meaningful changes without reapplying settled consequences.");
      lifecycleEvent(services, "full_review_completed");
      return result;
    },
  };
}
