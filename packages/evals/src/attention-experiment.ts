import type { Experiment, RunRecording } from "./experiment.js";
import type { AiService } from "../../conversation/src/services.js";
import type { AnalysisEvent } from "../../conversation/src/attention.js";
import { cliStrategy } from "../../conversation/src/cli-strategy.js";
import { DisclosureSession } from "../../conversation/src/disclosure.js";

export interface AttentionCase {
  name: string;
  context: string;
  player: string;
  reply: string;
  expectedFlag: boolean;
  reason: string;
}

// Accept any existing reconciliation route, not commitment/feasibility or dice labels.
// The fixtures contain no unrelated new world event that could earn accidental credit.
const reconciliationLabels = ["improvised_detail", "plot_progress", "other_world_update", "accepted_player_detail"];
const rubric = [{ name: "acceptance", description: "Flag unsupported player-supplied history adopted by the character; do not flag rejected, merely unchallenged, or already established history." }];
function decisions(recording: RunRecording) {
  const event = recording.getServiceRecord("debug").map(call => (call.args as [{ output?: AnalysisEvent }])[0]?.output)
    .find(event => event?.kind === "labels" && event.source === "attention");
  if (!event || event.kind !== "labels") throw new Error("No completed attention analysis was recorded");
  return event.decisions;
}

/** Freeze the observed dialogue and exercise the same post-reply hook used by the CLI. */
export function createAttentionExperiment(fixture: AttentionCase, createAi: () => AiService): Experiment {
  return {
    name: fixture.name, rubric,
    getBaseline: () => ({ name: "game", configure: () => ({ services: {
      ai: () => createAi(), debug: () => ({ record: () => {} }),
    } }) }),
    getVariants: () => [],
    async run(runtime, signal) {
      const ai = runtime.services.ai;
      const disclosure = new DisclosureSession({ initial: [], links: () => [], open: async () => { throw new Error("Unexpected disclosure"); } }, ai);
      const strategy = cliStrategy(disclosure, ai, undefined, fixture.player,
        async () => { throw new Error("Unexpected roll"); }, () => {}, () => {}, {}, {}, undefined, event => {
          if (event.kind === "error") throw new Error(event.error);
          runtime.services.debug.record({ turn: 1, pass: 1, source: "attention", stage: "classify", status: "completed", output: event });
        });
      await strategy.analyze({ request: { model: "fixed-transcript", messages: [
        { role: "system", content: fixture.context }, { role: "user", content: fixture.player },
      ] }, pass: 1, completed: new Set() }, { role: "assistant", content: fixture.reply }, signal);
    },
    summarise(recording) {
      if (recording.error !== undefined) return "Attention analysis failed";
      const flagged = Object.entries(decisions(recording)).filter(([, decision]) => decision.choice === "flagged").map(([name]) => name);
      return `Expected reconciliation: ${fixture.expectedFlag}; flagged: ${flagged.join(", ") || "none"}`;
    },
    async score(recording) {
      if (recording.error !== undefined) return { criteria: { acceptance: { score: 0, reason: "Execution failed; absence of labels earns no credit." } } };
      const labels = decisions(recording);
      const actual = reconciliationLabels.filter(name => labels[name]?.choice === "flagged");
      return { criteria: { acceptance: { score: (actual.length > 0) === fixture.expectedFlag ? 1 : 0,
        reason: `${fixture.reason} Expected flag: ${fixture.expectedFlag}; observed reconciliation labels: ${actual.join(", ") || "none"}.`,
      } } };
    },
  };
}
