import assert from "node:assert/strict";
import test from "node:test";
import { createAttentionExperiment } from "../packages/evals/src/attention-experiment.js";
import { runExperiment } from "../packages/evals/src/experiment.js";
import { attentionQuestions } from "../packages/conversation/src/attention.js";
import cases from "../evals/attention/shared-graduation.json" with { type: "json" };

test("attention eval uses the shared classifier, response hook and recorded AI for each fresh trial", async () => {
  let services = 0;
  for (const fixture of cases) {
    const experiment = createAttentionExperiment(fixture, () => {
      services++;
      return { responses: async () => { throw Error("Must not generate dialogue"); }, decisions: async (state, questions, _signal, purpose) => {
        assert.deepEqual(questions, attentionQuestions);
        assert.equal(purpose, "conversation_attention");
        assert.deepEqual(state, { messages: [{ role: "system", content: fixture.context }, { role: "user", content: fixture.player }],
          characterReply: { role: "assistant", content: fixture.reply } });
        return Object.fromEntries(Object.keys(questions).map(name => [name, {
          choice: fixture.expected[name as keyof typeof fixture.expected] === "flagged" ? "flagged" : name === "immediate_feasibility" ? "not_applicable" : "not_flagged", probabilities: {},
        }]));
      } };
    });
    assert.deepEqual(experiment.getVariants(), []);
    const trials = await runExperiment(experiment, { repeats: 2 });
    for (const trial of trials) {
      assert.equal(trial.result?.criteria.attention?.score, 1);
      assert.equal(trial.recording.getServiceRecord("ai").length, 1);
      assert.equal(trial.recording.getServiceRecord("debug").length, 1);
      assert.equal(trial.recording.error, undefined);
    }
  }
  assert.equal(services, cases.length * 2);
});

test("missing flags fail positive cases and swallowed provider errors never pass negative cases", async () => {
  const noFlag = () => ({ responses: async () => { throw Error("unused"); }, decisions: async () => ({
    improvised_detail: { choice: "not_flagged", probabilities: { not_flagged: 1, flagged: 0 } },
  }) });
  const missed = await runExperiment(createAttentionExperiment(cases[0]!, noFlag), { repeats: 1 });
  assert.equal(missed[0]?.result?.criteria.attention?.score, 0);
  const failed = await runExperiment(createAttentionExperiment(cases[2]!, () => ({ ...noFlag(),
    decisions: async () => { throw Error("Provider unavailable"); },
  })), { repeats: 1 });
  assert.equal(failed[0]?.result?.criteria.attention?.score, 0);
  assert.match(JSON.stringify(failed[0]?.recording.error), /Provider unavailable/);
});

test("candidate configuration records changed questions against identical evidence", async () => {
  const questions = { improvised_detail: { type: "choice" as const, instructions: "Test candidate", criteria: { flagged: "yes", not_flagged: "no" } } };
  const experiment = createAttentionExperiment(cases[0]!, () => ({
    responses: async () => { throw Error("Unexpected dialogue"); },
    decisions: async () => ({ improvised_detail: { choice: "flagged", probabilities: { flagged: 1, not_flagged: 0 } } }),
  }), [{ name: "test-candidate", questions }]);
  const trials = await runExperiment(experiment, { repeats: 1 });
  const baseline = trials[0]!.recording.getServiceRecord("ai")[0]!.args as unknown[];
  const candidate = trials[1]!.recording.getServiceRecord("ai")[0]!.args as unknown[];
  assert.deepEqual(candidate[0], baseline[0]);
  assert.deepEqual(candidate[1], questions);
  assert.deepEqual(baseline[1], attentionQuestions);
  assert.equal(trials[1]!.result?.criteria.attention?.score, 1);
});
