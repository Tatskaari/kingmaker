import { TranscriptRole } from "../../contracts/src/index.js";
import type { WorldState } from "../../contracts/src/v2.js";
import type { AiService, ConversationDebugEvent } from "../../conversation/src/services.js";
import { createReviewExperiment, type ReviewCase } from "./review-experiment.js";
import { oswinKoboldCase } from "./oswin-kobold-case.js";
import { incrementalReviewStrategy, lifecycleEvent } from "./incremental-review-candidate.js";
import type { Experiment, RunRecording, RuntimeConfig } from "./experiment.js";

export const koboldLifecycleCase: ReviewCase = {
  ...oswinKoboldCase, name: "oswin-kobold-lifecycle",
  expectations: oswinKoboldCase.expectations + " In this lifecycle experiment the undated visit should remain a future promise in memory. Preserve existing intent rather than starting travel, preparation or a wait for the journey.",
  loadWorld(overlays) {
    const world = oswinKoboldCase.loadWorld(overlays);
    const entry = world.docs[world.runtimeCharacters.oswin!.document]!;
    // The captured pre-review entry already includes the earlier GM's acceptance memory.
    // Rewind that conversation-derived note for both sides of a pre-conversation replay.
    entry.body = entry.body.replace(/\n+## Conversation review[\s\S]*$/, "");
    return world;
  },
};

export function lifecycleMetrics(recording: RunRecording) {
  const calls = recording.getCalls();
  const events = calls.filter(call => call.service === "debug" && call.method === "record").flatMap(call => {
    const event = (call.args as ConversationDebugEvent[])[0];
    return event?.source.startsWith("lifecycle:") ? [{ id: call.id, name: event.source.slice(10),
      ...(event.output as { atMs: number; data: Record<string, unknown> }) }] : [];
  });
  const end = events.find(event => event.name === "conversation_ended");
  const committed = events.find(event => event.name === "decisions_committed");
  const review = events.find(event => event.name === "full_review_started");
  const finished = events.find(event => event.name === "full_review_completed");
  const writes = calls.filter(call => call.service === "docs" && call.method !== "read");
  const activated = writes.filter(call => call.method === "commit" && ((call.args as unknown[])[1] as { actorId: string; activity: string | null; wait: string | null }[] | undefined)
    ?.some(intent => intent.actorId === "oswin" && (intent.activity || intent.wait)));
  return { events, exchanges: events.filter(e => e.name === "exchange_observed").length,
    preparedRevisions: events.filter(e => e.name === "decisions_prepared").length,
    actionSpecialists: events.filter(e => e.name === "action_specialist_started").length,
    quietBeforeEnd: !!end && writes.every(call => call.id > end.id),
    decisionsBeforeReview: !!committed && !!review && committed.id < review.id,
    endToCommitMs: end && committed ? committed.atMs - end.atMs : null,
    endToReviewCompleteMs: end && finished ? finished.atMs - end.atMs : null,
    intentActivations: activated.length,
    aiCalls: calls.filter(call => call.service === "ai").length };
}

export function createKoboldLifecycleExperiment(createAi: () => AiService, judge: Pick<AiService, "decisions">): Experiment {
  const base = createReviewExperiment(koboldLifecycleCase, [], createAi, judge);
  const config = (incremental: boolean): RuntimeConfig => ({ name: incremental ? "incremental" : "game", async configure() {
    const setup = await base.getBaseline().configure();
    const normal = setup.strategies!.review!;
    return { ...setup, strategies: { ...setup.strategies, review: incremental ? incrementalReviewStrategy() : {
      ...normal, async resolve(context, labels, signal, services) {
        lifecycleEvent(services, "full_review_started");
        const result = await normal.resolve!(context, labels, signal, services);
        lifecycleEvent(services, "full_review_completed");
        return result;
      },
    } } };
  } });
  return { ...base, getBaseline: () => config(false), getVariants: () => [config(true)],
    rubric: [...base.rubric,
      { name: "staged-until-end", description: "No document or intent writes occur before conversation end." },
      { name: "no-unwanted-intent", description: "This undated future visit never activates travel, preparation or a wait during the replay or full review." }],
    async run(runtime, signal) {
      let labels = {};
      lifecycleEvent(runtime.services, "conversation_started");
      for (let i = 0; i < koboldLifecycleCase.transcript.length; i++) {
        const message = koboldLifecycleCase.transcript[i]!;
        if (message.role !== TranscriptRole.CHARACTER || message.speakerId !== "oswin") continue;
        signal.throwIfAborted();
        const context = { ...koboldLifecycleCase, transcript: koboldLifecycleCase.transcript.slice(0, i + 1) };
        lifecycleEvent(runtime.services, "exchange_observed", { throughMessageId: `m${i}` });
        // Paced replay: the next exchange arrives once this boundary's analysis is ready.
        labels = await runtime.strategies.review.classify(context, signal, runtime.services);
      }
      lifecycleEvent(runtime.services, "conversation_ended");
      await runtime.strategies.review.resolve(koboldLifecycleCase, labels, signal, runtime.services);
    },
    summarise(recording) {
      const m = lifecycleMetrics(recording);
      return `${base.summarise(recording)}; ${m.preparedRevisions} prepared revisions; ${m.actionSpecialists} action specialists; commit ${m.endToCommitMs === null ? "in full review" : `${Math.round(m.endToCommitMs)}ms after end`}`;
    },
    async score(recording, context) {
      const result = await base.score(recording, context), m = lifecycleMetrics(recording);
      const actor = (recording.finalState as WorldState | undefined)?.runtimeCharacters.oswin;
      result.criteria["staged-until-end"] = { score: m.quietBeforeEnd ? 1 : 0 };
      result.criteria["no-unwanted-intent"] = { score: actor && !actor.activity && !actor.wait && !m.intentActivations ? 1 : 0 };
      return result;
    },
  };
}
