import type { GameAction } from "../../core/src/actions.js";
import type { AiService } from "../../conversation/src/services.js";
import { runAction } from "../../conversation/src/action.js";
import type { jevRequest } from "../../providers/src/jev.js";
import type { Experiment, RunRecording } from "./experiment.js";

export interface NavigationCase {
  name: string;
  characterId: string;
  goal: string;
  expected: string;
  request: ReturnType<typeof jevRequest>;
  actions: GameAction[];
}
function selected(recording: RunRecording): string {
  const output = recording.getServiceRecord("debug").find(call => call.method === "record")?.args[0] as
    { output?: { actionId?: string } } | undefined;
  if (!output?.output?.actionId) throw new Error("No resolved navigation action recorded");
  return output.output.actionId;
}

/** Exact failed planner input; exercise the shared game action strategy without rewriting the prompt. */
export function createNavigationExperiment(fixture: NavigationCase, createAi: () => AiService): Experiment {
  if (!fixture.actions.some(action => action.id === fixture.expected)
    || !Object.hasOwn(fixture.request.questions.next!.criteria, fixture.expected)) throw new Error("Expected action must be offered");
  return {
    name: fixture.name, type: "jev-action",
    rubric: [{ name: "navigation", description: "Choose the offered door-opening action that advances the route to Cressida's chamber instead of backtracking, waiting or declaring completion." }],
    getBaseline: () => ({ name: "game", configure: () => ({ services: {
      ai: () => createAi(), debug: () => ({ record: () => {} }),
    } }) }),
    getVariants: () => [],
    async run(runtime, signal) {
      const result = await runAction({ characterId: fixture.characterId, goal: fixture.goal,
        request: fixture.request, actions: fixture.actions }, runtime, signal);
      runtime.services.debug.record({ turn: 1, pass: 1, source: "navigation", stage: "resolve", status: "completed",
        output: { actionId: result.action?.id ?? result.decision.choice } });
    },
    summarise: recording => recording.error !== undefined ? "Navigation execution failed" : `Selected ${selected(recording)}`,
    async score(recording) {
      if (recording.error !== undefined) return { criteria: { navigation: { score: 0, reason: "Execution failed" } } };
      const actual = selected(recording);
      return { criteria: { navigation: { score: Number(actual === fixture.expected), reason: `Expected ${fixture.expected}; selected ${actual}` } } };
    },
  };
}
