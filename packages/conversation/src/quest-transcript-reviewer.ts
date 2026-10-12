import { toJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema } from "../../contracts/src/index.js";
import type { JevChoice, JevQuestions } from "../../providers/src/jev.js";
import { runGameMaster } from "./game-master.js";
import { advanceQuestTool, gameMasterTools } from "./gm-tools.js";
import { activityTools } from "./activity-tools.js";
import { reviewGuidance } from "./review-prompt-context.js";
import type { ConversationReviewContext, ConversationReviewStrategy } from "./review.js";
import type { RuntimeServices } from "./services.js";
import { renderPrompt } from "../../prompts/src/index.js";

interface QuestCandidate { id: string; question: string; quest: unknown }
export interface QuestTranscriptLabels extends Record<string, unknown> { candidates: QuestCandidate[]; decisions: Record<string, JevChoice> }

/** Temporary quest-update policy used by evals and explicit PLOT: turns. */
export class QuestTranscriptReviewer {
  private readonly transcripts = new Map<string, string[]>();

  snapshot() {
    return Object.fromEntries([...this.transcripts].map(([id, entries]) => [id, [...entries]]));
  }

  clear() { this.transcripts.clear(); }

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
    const world = services.scenario.read(), scenarioRoot = services.scenario.info().scenario.replace(/\/scenario\.md$/, "");
    const conversationIds = new Set(Object.entries(world.docs).filter(([path]) => path.startsWith("Conversations/"))
      .map(([, document]) => document.frontmatter?.id));
    const quests = Object.entries(world.quests).filter(([id]) => !conversationIds.has(id)).map(([id, state]) => ({
      id, currentStageId: state.currentStageId, revision: state.revision, quest: state.quest,
      documents: Object.entries(world.docs).filter(([path, document]) => path.includes("/Quests/") && document.frontmatter?.id === id)
        .map(([path]) => path),
    }));
    const activeQuests = quests.filter(quest => world.quests[quest.id]!.active);
    const questIndexPath = `${scenarioRoot}/Quests/index.md`, questIndex = world.docs[questIndexPath];
    return { activeQuests, candidates: activeQuests.length ? activeQuests : quests,
      questIndex: JSON.stringify({ path: questIndexPath, document: questIndex ?? null }, null, 2) };
  }

  async classify(context: ConversationReviewContext, signal: AbortSignal, services: RuntimeServices): Promise<QuestTranscriptLabels> {
    const turn = JSON.stringify(context.transcript.map(message => toJson(TranscriptMessageSchema, message)), null, 2);
    const questContext = this.questContext(services);
    const candidates: QuestCandidate[] = questContext.candidates.map((quest, index) => ({
      id: quest.id, question: `quest_${index}`, quest,
    }));
    if (!candidates.length) return { candidates, decisions: {} };
    const questions: JevQuestions = Object.fromEntries(candidates.map(candidate => [candidate.question, {
      type: "choice",
      instructions: renderPrompt("quest-transcript-relevance", { quest: JSON.stringify(candidate.quest, null, 2), turn,
        activeQuests: questContext.activeQuests, questIndex: questContext.questIndex }),
      criteria: {
        update: "This turn creates progress, a new approach, a commitment, an opening, or a blocker or failure that changes what this quest should do next.",
        unchanged: "This turn does not change the playable course of this quest.",
      },
    }]));
    const decisions = await services.ai.decisions({ characterId: context.characterId, turn }, questions, signal, "quest_relevance");
    return { candidates, decisions };
  }

  async resolve(context: ConversationReviewContext, labels: QuestTranscriptLabels, signal: AbortSignal, services: RuntimeServices) {
    const changed: string[] = [];
    for (const candidate of labels.candidates) {
      if (labels.decisions[candidate.question]?.choice !== "update") continue;
      signal.throwIfAborted();
      const turn = JSON.stringify(context.transcript.map(message => toJson(TranscriptMessageSchema, message)), null, 2);
      const prior = this.transcripts.get(candidate.id) ?? [];
      const summaryRequest = renderPrompt("quest-transcript-summary", {
        quest: JSON.stringify(candidate.quest, null, 2), questTranscript: prior.join("\n"), turn,
      });
      const summary = await services.ai.responses({ model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "none" }, tools: [],
        messages: [{ role: "system", content: summaryRequest }],
      }, signal, { characterId: context.characterId, purpose: "conversation_review" });
      if (summary.tool_calls?.length || !summary.content?.trim()) throw new Error("Quest transcript summarizer returned no plain-text entry.");
      const transcript = [...prior, summary.content.trim()];
      this.transcripts.set(candidate.id, transcript);

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
      const result = await runGameMaster({ model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "high" }, tools,
        messages: [{ role: "system", content: purpose }],
      }, services, signal, { characterId: context.characterId, review: true, systemPrompt: renderPrompt("review-system") });
      changed.push(`${candidate.id}: ${result.content ?? ""}`);
    }
    return { summary: changed.length ? changed.join("\n") : "No active quest was changed by this turn." };
  }
}
