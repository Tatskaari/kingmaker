import type { JevQuestions } from "../../providers/src/jev.js";
import type { Experiment, RunRecording, RuntimeConfig } from "./experiment.js";
import type { AiService, RuntimeServices } from "../../conversation/src/services.js";
import type { AnalysisEvent } from "../../conversation/src/attention.js";
import { cliStrategy } from "../../conversation/src/cli-strategy.js";
import { DisclosureSession } from "../../conversation/src/disclosure.js";

export interface AttentionCase {
  name: string;
  context: string;
  player: string;
  reply: string;
  expected: Record<string, string>;
  reason: string;
}

const rubric = [{ name: "attention", description: "Identify developments the player expects the world to react to. Flag unestablished details unless explicitly denied; distinguish commitments, actual consequences, exchanges and changes in knowledge or relationships. Respect lore and binding rulings." }];
function decisions(recording: RunRecording) {
  const event = recording.getServiceRecord("debug").map(call => (call.args as [{ output?: AnalysisEvent }])[0]?.output)
    .find(event => event?.kind === "labels" && event.source === "attention");
  if (!event || event.kind !== "labels") throw new Error("No completed attention analysis was recorded");
  return event.decisions;
}

/** Freeze the observed dialogue and exercise the same post-reply hook used by the CLI. */
export function createAttentionExperiment(fixture: AttentionCase, createAi: () => AiService, variants: readonly { name: string; questions: JevQuestions }[] = []): Experiment {
  const config = (name: string, questions?: JevQuestions): RuntimeConfig => ({ name, configure() {
    let services: RuntimeServices;
    return { services: { ai: () => createAi(), debug: dependencies => { services = dependencies; return { record: () => {} }; } },
      strategies: { conversation: { classify: async () => ({}), resolve: async () => ({ reclassify: false }),
        analyze: async (context, reply, signal) => {
          const report = (event: AnalysisEvent) => {
            if (event.kind === "error") throw new Error(event.error);
            services.debug.record({ turn: 1, pass: 1, source: "attention", stage: "classify", status: "completed", output: event });
          };
          if (questions) {
            const decisions = await services.ai.decisions({ messages: context.request.messages, characterReply: reply }, questions, signal, "conversation_attention");
            report({ kind: "labels", subject: "character", source: "attention", decisions });
          } else {
            const disclosure = new DisclosureSession({ initial: [], links: () => [], open: async () => { throw new Error("Unexpected disclosure"); } }, services.ai);
            await cliStrategy(disclosure, services.ai, undefined, fixture.player,
              async () => { throw new Error("Unexpected roll"); }, () => {}, () => {}, {}, {}, undefined, report).analyze(context, reply, signal);
          }
        },
      } },
    };
  } });
  return {
    name: fixture.name, type: "jev-decision", rubric,
    getBaseline: () => config("game"),
    getVariants: () => variants.map(variant => config(variant.name, variant.questions)),
    async run(runtime, signal) {
      await runtime.strategies.conversation.analyze!({ request: { model: "fixed-transcript", messages: [
        { role: "system", content: fixture.context }, { role: "user", content: fixture.player },
      ] }, pass: 1, completed: new Set() }, { role: "assistant", content: fixture.reply }, signal);
    },
    summarise(recording) {
      if (recording.error !== undefined) return "Attention analysis failed";
      const flagged = Object.entries(decisions(recording)).filter(([, decision]) => decision.choice === "flagged").map(([name]) => name);
      return `Flagged: ${flagged.join(", ") || "none"}`;
    },
    async score(recording) {
      if (recording.error !== undefined) return { criteria: { attention: { score: 0, reason: "Execution failed; absence of labels earns no credit." } } };
      const labels = decisions(recording);
      const results = Object.entries(fixture.expected).map(([name, expected]) => {
        const actual = labels[name]?.choice ?? "not_flagged";
        return { name, expected, actual, correct: actual === expected };
      });
      if (!results.length) throw new Error("Attention fixture needs expected decisions");
      return { criteria: { attention: { score: results.filter(result => result.correct).length / results.length,
        reason: `${fixture.reason} ${results.map(result => `${result.name}: expected ${result.expected}, got ${result.actual}`).join("; ")}`,
      } } };
    },
  };
}
