import { create } from "@bufbuild/protobuf";
import { DocumentSchema } from "../../contracts/src/v2.js";
import { createScenarioServices } from "../../lore/src/services.js";
import { formatActivity } from "../../lore/src/activity.js";
import { parseMarkdown } from "../../lore/src/markdown.js";
import { refreshDocumentGraph } from "../../lore/src/world-state.js";
import { documentLoreService } from "../../conversation/src/document-lore.js";
import { runResolution } from "../../conversation/src/resolution.js";
import { runActionExecution } from "../../conversation/src/action-execution.js";
import type { AiService } from "../../conversation/src/services.js";
import { defaultWorldStrategies } from "../../../apps/web/src/world-strategies.js";
import { planWorldAction } from "../../../apps/web/src/world-action.js";
import { corvinInquiryCase } from "./corvin-inquiry-case.js";
import { plannerMap } from "./planner-map.js";
import type { Experiment, RunRecording } from "./experiment.js";
import activity from "../../../evals/reviews/corvin-inquiry/planner-activity.json" with { type: "json" };

// Controlled interview outcomes, delivered only after a validated talk action arrives.
const accounts: Record<string, string> = {
  elinor: "Lady Elinor Ash says she was laughing about a spilled drink and did not discuss Corvin's academic record.",
  oswin: "Professor Oswin says he heard laughter but no words about Corvin's academic record.",
  rowan: "Doctor Rowan Ash says he did not hear any remarks about Corvin's academic record.",
};
export function loadCorvinPlannerWorld() {
  const world = corvinInquiryCase.loadWorld([]);
  const path = "Scenarios/Centennial Assembly/Characters/corvin/activity-planner-fixture.md";
  const note = parseMarkdown(formatActivity("corvin", activity));
  world.docs[path] = create(DocumentSchema, { frontmatter: note.metadata as Record<string, string>, body: note.body });
  world.simulation!.runtimeCharacters.corvin!.activity = path;
  return refreshDocumentGraph(world);
}
function evidence(recording: RunRecording) {
  const talks = recording.getServiceRecord("map").flatMap(call => {
    if (call.method !== "interact" || call.outcome?.status !== "returned") return [];
    const target = (call.outcome.value as { talkTarget?: string }).talkTarget;
    return target ? [target] : [];
  });
  const inputs = JSON.stringify(recording.getServiceRecord("ai").map(call => call.args));
  const noTranscript = !inputs.includes("Originating conversation")
    && corvinInquiryCase.transcript.every(turn => !inputs.includes(turn.text) && !inputs.includes(JSON.stringify(turn.text).slice(1, -1)));
  return { talks, noTranscript };
}

/** Planner-only regression: captured task output is input, never the original exchange. */
export function createCorvinPlannerExperiment(createAi: () => AiService): Experiment {
  return {
    name: "corvin-inquiry-follow-through", type: "jev-action",
    rubric: [
      { name: "interview-coverage", description: "Physically reach and talk individually to Elinor, Oswin and Rowan." },
      { name: "no-repeat-interviews", description: "Reach all three without repeating an interview or talking to unrelated people." },
      { name: "no-transcript", description: "AI inputs contain no raw source conversation or originating-conversation attachment." },
    ],
    getBaseline: () => ({ name: "game", configure() {
      const backing = createScenarioServices(loadCorvinPlannerWorld());
      return { recordServices: ["ai", "docs", "map", "debug"], strategies: defaultWorldStrategies, services: {
        ai: () => createAi(), docs: () => backing.docs, scenario: () => backing.scenario, inventory: () => backing.inventory,
        lore: services => documentLoreService(services.scenario), map: services => plannerMap(services, backing.mechanics),
        debug: () => ({ record: () => {} }),
      } };
    } }),
    getVariants: () => [],
    async run(runtime, signal) {
      const interviewed = new Set<string>();
      for (let step = 0; step < 24; step++) {
        const plan = await planWorldAction("corvin", runtime, signal);
        runtime.services.debug.record({ turn: step + 1, pass: 1, source: "corvin-follow-through", stage: "resolve", status: "completed",
          output: { goal: plan?.goal, choice: plan?.action?.id ?? plan?.decision.choice ?? "idle" } });
        if (!plan?.action) return; // Premature complete/wait/unable/idle lowers coverage, not a harness error.
        const result = await runActionExecution({ command: { kind: "step", characterId: "corvin", actionId: plan.action.id, goal: plan.goal } }, runtime, signal);
        if (result.talkTarget) {
          const target = result.talkTarget;
          if (!accounts[target] || interviewed.has(target)) return;
          interviewed.add(target);
          await runResolution({ kind: "task_outcome", characterId: "corvin", goal: plan.goal, actions: [plan.action.id],
            result: { reason: "complete", detail: `One individual interview completed with ${target}; this describes the conversation substep only.` },
            observation: { interviewee: target, account: accounts[target], note: "This is the speaker's account, not independently verified truth." },
          }, runtime, signal);
          if (interviewed.size === Object.keys(accounts).length) return;
        }
      }
    },
    summarise(recording) {
      const { talks, noTranscript } = evidence(recording);
      return `Interviews: ${talks.join(" → ") || "none"}; raw transcript absent: ${noTranscript}`;
    },
    async score(recording) {
      const { talks, noTranscript } = evidence(recording);
      const covered = Object.keys(accounts).filter(id => talks.includes(id)).length;
      return { criteria: {
        "interview-coverage": { score: covered / 3, reason: `Reached ${covered}/3: ${talks.join(", ")}` },
        "no-repeat-interviews": { score: Number(covered === 3 && talks.length === 3), reason: "Requires exactly one individual interaction with each target." },
        "no-transcript": { score: Number(noTranscript) },
      } };
    },
  };
}
