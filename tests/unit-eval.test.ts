import assert from "node:assert/strict";
import test from "node:test";
import { loadEvalScenario, runUnitEval } from "../packages/evals/src/unit-eval.js";

const scenarioPath = new URL("../evals/witnessed-player-theft.json", import.meta.url).pathname;

test("the unit eval loads its model and transcript", () => {
  const { scenario, transcript } = loadEvalScenario(scenarioPath);
  assert.equal(scenario.model, "openai/gpt-6-luna");
  assert.equal(scenario.transcript, "transcripts/witnessed-player-theft.json");
  assert.equal(transcript.messages.length, 4);
});

test("the library sends the transcript to the model and its captured response to Jev", async () => {
  const { scenario, transcript } = loadEvalScenario(scenarioPath);
  const response = { role: "assistant" as const, content: null, tool_calls: [{
    id: "call-1", type: "function" as const, function: { name: "update_character", arguments: "{\"character_id\":\"corvin\"}" },
  }], responseItems: [{ type: "reasoning", encrypted_content: "not part of the eval state" }] };
  let generatedMessages: unknown;
  const judgedStates: unknown[] = [];
  const result = await runUnitEval(scenario, transcript, [], {
    generate: async (model, messages) => {
      assert.equal(model, scenario.model);
      generatedMessages = messages;
      return response;
    },
    judge: async state => {
      judgedStates.push(state);
      return { choice: "meets", probabilities: { meets: 0.9, does_not_meet: 0.1 } };
    },
  });
  assert.equal(generatedMessages, transcript.messages);
  assert.equal(judgedStates.length, scenario.rubric.length);
  assert.ok(judgedStates.every(state => (state as { response: unknown }).response === result.response));
  assert.deepEqual(result.response, { role: "assistant", content: null, tool_calls: response.tool_calls });
  assert.ok(Math.abs(result.score - 0.9) < Number.EPSILON);
  assert.equal(result.passed, true);
});
