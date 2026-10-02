import assert from "node:assert/strict";
import test from "node:test";
import { loadEvalScenario, runUnitEval, runUnitEvalBatch, validateTranscript } from "../packages/evals/src/unit-eval.js";

const scenarioPath = new URL("../evals/king-accusation-response.json", import.meta.url).pathname;

test("the Sabine disclosure eval replays the captured Rook request without the leaked answer", async () => {
  const { scenario, transcript, comparison } = loadEvalScenario(
    new URL("../evals/rook-sabine-plan-disclosure.json", import.meta.url).pathname,
  );
  assert.equal(comparison, undefined);
  assert.equal(transcript.messages.length, 16);
  const privacy = transcript.messages.find(message => message.content?.startsWith("# Conversation privacy"))!;
  assert.match(privacy.content!, /"characterId":"sabine","name":"Chancellor Sabine Venn","distance":3,"level":"Clear"/);
  assert.equal(transcript.messages.at(-1)?.content,
    "I'd rather the truth be surfaced but in all truth I have no skin in the game. ");
  assert.ok(transcript.messages.filter(message => message.role === "assistant")
    .every(message => !message.content?.includes("Grey Gull")));
  assert.equal(transcript.request?.reasoning?.effort, "none");
  assert.ok(transcript.request?.response_format);
  assert.equal(transcript.request?.tools?.length, 1);
  await runUnitEval(scenario, transcript, [], {
    generate: async (model, messages, tools, request) => {
      assert.equal(model, scenario.model);
      assert.equal(request, transcript.request);
      assert.equal(messages, request!.messages);
      assert.equal(tools, request!.tools);
      return { role: "assistant", content: "Let us speak in the parlour." };
    },
    judge: async (_state, criteria) => Object.fromEntries(criteria.map(criterion => [criterion.id,
      { choice: "meets", probabilities: { meets: 1, does_not_meet: 0 } }])),
  });
});

test("captured transcripts reject missing messages and invalid roles", () => {
  for (const messages of [[], [{ role: "invalid", content: "Hello" }], [null]]) {
    assert.throws(() => validateTranscript({ request: { model: "test", messages } }, "/tmp/eval.json"),
      /Captured request must contain valid messages/);
  }
});

test("the unit eval loads its model and production transcript", () => {
  const { scenario, transcript, comparison } = loadEvalScenario(scenarioPath);
  assert.equal(scenario.model, "openai/gpt-6-luna");
  assert.equal(scenario.transcript, "transcripts/king-accusation-response.json");
  assert.equal(scenario.repeats, 10);
  assert.equal(scenario.judge_repeats, 1);
  assert.equal(transcript.messages.length, 8);
  const prompt = transcript.messages.map(message => message.content).join("\n");
  assert.match(prompt, /# Dialogue objectives/);
  assert.match(prompt, /King of Caerwyn and expected candidate/);
  assert.match(prompt, /under relentless pressure/);
  assert.match(prompt, /# Known world state/);
  assert.match(prompt, /Lady Elinor Ash \(elinor\)/);
  assert.match(prompt, /Tomas Vey/);
  assert.equal(comparison, undefined);
  assert.equal(transcript.messages.at(-1)?.role, "user");
  assert.equal(transcript.messages.at(-1)?.content,
    "I know about the boy. Would you like to do this the easy way or the hard way?");
});

test("dialogue evals can generate without resource-review tools", () => {
  const { scenario, transcript } = loadEvalScenario(scenarioPath);
  assert.equal(scenario.toolset, "none");
  assert.equal(scenario.model, "openai/gpt-6-luna");
  assert.match(transcript.messages.at(-1)?.content ?? "", /know about the boy/);
  assert.equal(scenario.rubric.reduce((sum, item) => sum + item.weight, 0), 15);
});

test("the promoted character context runs without a comparison patch", () => {
  const { scenario, transcript, comparison } = loadEvalScenario(scenarioPath);
  assert.equal(scenario.rubric.length, 5);
  assert.equal(comparison, undefined);
  assert.equal(transcript.messages.length, 8);
  const prompt = transcript.messages.map(message => message.content).join("\n");
  assert.match(prompt, /Tomas Vey/);
  assert.match(prompt, /birth is not a crime/);
  assert.match(prompt, /Greenweald has not withdrawn recognition/);
  assert.match(prompt, /under relentless pressure/);
  assert.match(prompt, /terrified of losing any more face at court/);
  assert.equal(transcript.messages.at(-1)?.content,
    "I know about the boy. Would you like to do this the easy way or the hard way?");
});

test("the eval batch starts every configured generation in parallel", async () => {
  const { scenario, transcript } = loadEvalScenario(scenarioPath);
  const batchScenario = { ...scenario, repeats: 3, judge_repeats: 1 };
  const releases: Array<() => void> = [];
  let started = 0;
  const batch = runUnitEvalBatch(batchScenario, transcript, [], {
    generate: async () => {
      started++;
      await new Promise<void>(resolve => releases.push(resolve));
      return { role: "assistant", content: "A guarded reply." };
    },
    judge: async (_state, criteria) => Object.fromEntries(criteria.map(criterion => [criterion.id,
      { choice: "meets", probabilities: { meets: 1, does_not_meet: 0 } }])),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 3);
  for (const release of releases) release();
  assert.equal((await batch).length, 3);
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
    judge: async (state, criteria) => {
      judgedStates.push(state);
      return Object.fromEntries(criteria.map(criterion => [criterion.id,
        { choice: "meets", probabilities: { meets: 0.9, does_not_meet: 0.1 } }]));
    },
  });
  assert.equal(generatedMessages, transcript.messages);
  assert.equal(judgedStates.length, 1);
  assert.ok(judgedStates.every(state => (state as { response: unknown }).response === result.response));
  assert.deepEqual(result.response, { role: "assistant", content: null, tool_calls: response.tool_calls });
  assert.ok(Math.abs(result.score - 0.9) < 1e-12);
  assert.equal(result.passed, true);
});
