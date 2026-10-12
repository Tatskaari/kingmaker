import { toJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema } from "../../contracts/src/index.js";
import type { JevChoice, JevQuestions } from "../../providers/src/jev.js";
import { reviewDocumentEvidence } from "../../conversation/src/document-review.js";
import { advanceQuestTool, gameMasterTools } from "../../conversation/src/gm-tools.js";
import { activityTools } from "../../conversation/src/activity-tools.js";
import { reviewGuidance } from "../../conversation/src/review-prompt-context.js";
import type { ConversationReviewContext, ConversationReviewStrategy } from "../../conversation/src/review.js";
import type { RuntimeServices } from "../../conversation/src/services.js";
import { renderPrompt as renderGamePrompt } from "../../prompts/src/index.js";
import { renderPrompt } from "./prompts.js";

interface QuestCandidate { id: string; question: string; quest: unknown }
export interface QuestTranscriptLabels extends Record<string, unknown> { candidates: QuestCandidate[]; decisions: Record<string, JevChoice> }

/** Temporary quest-update policy used by evals and the conversation debugger. */
export class QuestTranscriptReviewer {
  private readonly transcripts = new WeakMap<RuntimeServices["scenario"], Map<string, string[]>>();

  snapshot(services: Pick<RuntimeServices, "scenario">) {
    return Object.fromEntries([...(this.transcripts.get(services.scenario) ?? new Map())].map(([id, entries]) => [id, [...entries]]));
  }

  private transcript(services: Pick<RuntimeServices, "scenario">) {
    let transcript = this.transcripts.get(services.scenario);
    if (!transcript) { transcript = new Map(); this.transcripts.set(services.scenario, transcript); }
    return transcript;
  }

  private wholeMap(services: Pick<RuntimeServices, "scenario">) {
    const map = services.scenario.read().simulation!.map!;
    return {
      rooms: map.rooms.map(room => ({ id: room.id, name: room.name, exits: room.exitRoomIds, private: room.private,
        allowedCharacterIds: room.allowedCharacterIds })),
      doors: map.doors.map(door => ({ id: door.id, name: door.name, rooms: door.roomIds, open: door.open })),
      fixtures: map.fixtures.map(fixture => ({ id: fixture.id, name: fixture.name, roomId: fixture.roomId,
        container: fixture.container, open: fixture.open, requiredKeyId: fixture.requiredKeyId,
        ownerCharacterId: fixture.ownerCharacterId, contents: fixture.inventory?.items.map(item => ({ id: item.id, name: item.name, quantity: item.quantity })) ?? [] })),
      actors: map.actors.map(actor => ({ characterId: actor.characterId, roomId: actor.roomId, awake: actor.awake,
        physicalForm: actor.physicalForm })),
    };
  }

  strategy(): ConversationReviewStrategy<QuestTranscriptLabels> {
    return {
      classify: (context, signal, services) => this.classify(context, signal, services),
      resolve: (context, labels, signal, services) => this.resolve(context, labels, signal, services),
    };
  }

  async review(context: ConversationReviewContext, signal: AbortSignal, services: RuntimeServices) {
    const labels = await this.classify(context, signal, services);
    return this.resolve(context, labels, signal, services);
  }

  private questContext(services: RuntimeServices) {
    const world = services.scenario.read();
    const conversationIds = new Set(Object.entries(world.docs).filter(([path]) => path.startsWith("Conversations/"))
      .map(([, document]) => document.frontmatter?.id));
    return Object.entries(world.quests).filter(([id, state]) => state.active && !conversationIds.has(id)).map(([id, state]) => ({
      id, currentStageId: state.currentStageId, revision: state.revision, quest: state.quest,
      documents: Object.entries(world.docs).filter(([path, document]) => path.includes("/Quests/") && document.frontmatter?.id === id)
        .map(([path]) => path),
    }));
  }

  async classify(context: ConversationReviewContext, signal: AbortSignal, services: RuntimeServices): Promise<QuestTranscriptLabels> {
    const turn = JSON.stringify(context.transcript.map(message => toJson(TranscriptMessageSchema, message)), null, 2);
    const candidates: QuestCandidate[] = this.questContext(services).map((quest, index) => ({
      id: quest.id, question: `quest_${index}`, quest,
    }));
    if (!candidates.length) return { candidates, decisions: {} };
    const questions: JevQuestions = Object.fromEntries(candidates.map(candidate => [candidate.question, {
      type: "choice",
      instructions: renderPrompt("quest-transcript-relevance", { quest: JSON.stringify(candidate.quest, null, 2), turn }),
      criteria: {
        update: "This turn creates progress, a new approach, a commitment, an opening, or a blocker or failure that changes what this quest should do next.",
        unchanged: "This turn does not change the playable course of this quest.",
      },
    }]));
    const decisions = await services.ai.decisions({ characterId: context.characterId, turn }, questions, signal, "conversation_attention");
    return { candidates, decisions };
  }

  async resolve(context: ConversationReviewContext, labels: QuestTranscriptLabels, signal: AbortSignal, services: RuntimeServices) {
    const changed: string[] = [];
    for (const candidate of labels.candidates) {
      if (labels.decisions[candidate.question]?.choice !== "update") continue;
      signal.throwIfAborted();
      const turn = JSON.stringify(context.transcript.map(message => toJson(TranscriptMessageSchema, message)), null, 2);
      const transcripts = this.transcript(services), prior = transcripts.get(candidate.id) ?? [];
      const summaryRequest = renderPrompt("quest-transcript-summary", {
        quest: JSON.stringify(candidate.quest, null, 2), questTranscript: prior.join("\n"), turn,
      });
      const summary = await services.ai.responses({ model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "none" }, tools: [],
        messages: [{ role: "system", content: summaryRequest }],
      }, signal, { characterId: context.characterId, purpose: "conversation_review" });
      if (summary.tool_calls?.length || !summary.content?.trim()) throw new Error("Quest transcript summarizer returned no plain-text entry.");
      const transcript = [...prior, summary.content.trim()];
      transcripts.set(candidate.id, transcript);

      const world = services.scenario.read(), observation = services.map.observe(context.characterId);
      const activeConversationTrees = Object.entries(world.docs).filter(([path]) => path === `Conversations/${context.characterId}.md`)
        .map(([path, document]) => ({ path, document, state: world.quests[String(document.frontmatter?.id)] ?? null }));
      const purpose = renderPrompt("quest-transcript-update", {
        quest: JSON.stringify(candidate.quest, null, 2), questTranscript: transcript.map((entry, index) => `${index + 1}. ${entry}`).join("\n"),
        activeConversationTrees: JSON.stringify(activeConversationTrees, null, 2),
        wholeMap: JSON.stringify(this.wholeMap(services), null, 2),
        availableActions: JSON.stringify(observation.actions, null, 2), reviewGuidance,
      });
      const tools = [...gameMasterTools.filter(tool => !activityTools.some(activity => activity.function.name === tool.function.name)), advanceQuestTool];
      const result = await reviewDocumentEvidence(context, { questId: candidate.id, development: summary.content }, signal,
        { ...services, ai: { ...services.ai, responses: (request, cancellation, info) => services.ai.responses(
          { ...request, reasoning: { ...request.reasoning, effort: "high" } }, cancellation, info) } }, purpose,
        { systemPrompt: renderGamePrompt("review-system"), tools });
      changed.push(`${candidate.id}: ${result.summary}`);
    }
    return { summary: changed.length ? changed.join("\n") : "No active quest was changed by this turn." };
  }
}
