import { resolve } from "node:path";
import { createScenarioServices } from "../../lore/src/services.js";
import { refreshDocumentGraph } from "../../lore/src/world-state.js";
import { documentLoreService } from "../../conversation/src/document-lore.js";
import type { AiService } from "../../conversation/src/services.js";
import { loadPlayableWorld } from "../../../scripts/lib/playable-world.js";
import { defaultWorldStrategies } from "../../../apps/web/src/world-strategies.js";
import { planWorldAction } from "../../../apps/web/src/world-action.js";
import { plannerMap } from "./planner-map.js";
import type { Experiment, RunRecording } from "./experiment.js";
import { navigationRubric } from "./navigation-experiment.js";
import fixture from "../../../evals/actions/corvin-nine-furrows/fixture.json" with { type: "json" };
import captured from "../../../evals/actions/corvin-nine-furrows/world.json" with { type: "json" };

const root = resolve(import.meta.dirname, "../../../evals/actions/corvin-nine-furrows");

/** Fresh game plus captured call-28 notes and positions; the planner prompt comes from the current engine. */
export function loadCorvinNineFurrowsWorld() {
  const world = loadPlayableWorld(undefined, [resolve(root, fixture.docs_override)]);
  for (const actor of world.simulation!.map!.actors) {
    const position = captured.positions[(actor.instanceId ?? actor.characterId) as keyof typeof captured.positions];
    if (position) { actor.roomId = position.roomId; Object.assign(actor.position!, position.position); }
  }
  const corvin = world.simulation!.runtimeCharacters[fixture.characterId]!;
  corvin.activity = fixture.activity; corvin.wait = undefined; corvin.intentRevision = 0;
  return refreshDocumentGraph(world);
}

function selected(recording: RunRecording) {
  const call = recording.getServiceRecord("debug").find(call => call.method === "record");
  const output = (call?.args as unknown[] | undefined)?.[0] as { output?: { choice: string; talkTarget?: string } } | undefined;
  if (!output?.output) throw new Error("No planner decision recorded");
  return output.output;
}

/** One live planning decision: Corvin should start talking to a Nine Furrows delegate. */
export function createCorvinNineFurrowsExperiment(createAi: () => AiService): Experiment {
  const targets = fixture.expectedTalkTargets;
  return {
    name: fixture.name, type: "jev-action",
    rubric: navigationRubric,
    getBaseline: () => ({ name: "game", configure() {
      const backing = createScenarioServices(loadCorvinNineFurrowsWorld());
      return { recordServices: ["ai", "docs", "map", "debug"], strategies: defaultWorldStrategies, services: {
        ai: () => createAi(),
        docs: () => backing.docs, scenario: () => backing.scenario, inventory: () => backing.inventory,
        lore: services => documentLoreService(services.scenario), map: services => plannerMap(services, backing.mechanics),
        debug: () => ({ record: () => {} }),
      } };
    } }),
    getVariants: () => [],
    async run(runtime, signal) {
      const plan = await planWorldAction(fixture.characterId, runtime, signal);
      const action = plan?.action;
      runtime.services.debug.record({ turn: 1, pass: 1, source: "navigation", stage: "resolve", status: "completed",
        output: { choice: action?.id ?? plan?.decision.choice ?? "idle", talkTarget: action?.type === "talk" ? action.target : undefined } });
    },
    summarise: recording => recording.error !== undefined ? "Navigation execution failed" : `Selected ${selected(recording).choice}`,
    async score(recording) {
      if (recording.error !== undefined) return { criteria: { navigation: { score: 0, reason: "Execution failed" } } };
      const { choice, talkTarget } = selected(recording);
      return { criteria: { navigation: { score: Number(targets.includes(talkTarget ?? "")),
        reason: `Expected talk to ${targets.join(" or ")}; selected ${choice}` } } };
    },
  };
}
