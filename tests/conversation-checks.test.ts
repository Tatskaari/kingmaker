import assert from "node:assert/strict";
import test from "node:test";
import { classifyConversationTurn, conversationCheckClassifiers, type ConversationCheckInput } from "../packages/providers/src/conversation-checks.js";
import { JevClient, type JevQuestions } from "../packages/providers/src/jev.js";

const signal = () => new AbortController().signal;
const input: ConversationCheckInput = {
  playerTurn: "Let me through or I will expose your theft.",
  history: [{ speaker: "guard", text: "Nobody enters without a seal." }],
  context: "The guard is blocking the locked council chamber. The player witnessed the theft.",
};

// Transport fixtures test the contract, not the model's semantic accuracy.
function clientFor(selected: string[], inspect?: (request: { state: unknown; questions: JevQuestions }) => void) {
  return new JevClient("test-key", async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    inspect?.(request);
    return new Response(JSON.stringify({ answers: Object.fromEntries(Object.keys(request.questions).map(skill => [skill, {
      type: "choice", choice: selected.includes(skill) ? "needed" : "not_needed",
      probabilities: { needed: selected.includes(skill) ? 0.9 : 0.1, not_needed: selected.includes(skill) ? 0.1 : 0.9 },
      confidence: 0.8,
    }])) }));
  });
}

test("classifies the current turn with separate history and context in one Jev request", async () => {
  let calls = 0;
  const before = structuredClone(input);
  const result = await classifyConversationTurn(clientFor(["intimidation"], request => {
    calls++;
    assert.deepEqual(request.state, input);
    assert.equal(Object.keys(request.questions).length, 18);
    for (const question of Object.values(request.questions)) {
      assert.equal(question.type, "choice");
      assert.deepEqual(Object.keys(question.criteria), ["needed", "not_needed"]);
    }
  }), input, signal());
  assert.equal(calls, 1);
  assert.equal(result.needsCheck, true);
  assert.deepEqual(result.checks, ["intimidation"]);
  assert.deepEqual(result.decisions.intimidation.probabilities, { needed: 0.9, not_needed: 0.1 });
  assert.deepEqual(input, before);
});

test("returns no check, each social skill, and multiple distinct checks", async () => {
  for (const selected of [[], ["persuasion"], ["deception"], ["intimidation"], ["insight", "sleight_of_hand"]]) {
    const result = await classifyConversationTurn(clientFor(selected), { playerTurn: "A fixture turn" }, signal());
    assert.equal(result.needsCheck, selected.length > 0);
    assert.deepEqual(result.checks, selected);
  }
});

test("every check type has an independent classifier sharing the batch definition", async () => {
  let batchQuestions: JevQuestions = {};
  await classifyConversationTurn(clientFor([], request => { batchQuestions = request.questions; }), input, signal());
  for (const [skill, classify] of Object.entries(conversationCheckClassifiers)) {
    for (const needed of [true, false]) {
      let calls = 0;
      const result = await classify(clientFor(needed ? [skill] : [], request => {
        calls++;
        assert.deepEqual(request.questions, { [skill]: batchQuestions[skill] });
        assert.deepEqual(request.state, input);
      }), input, signal());
      assert.equal(calls, 1);
      assert.equal(result.skill, skill);
      assert.equal(result.needsCheck, needed);
      assert.equal(result.decision.choice, needed ? "needed" : "not_needed");
    }
  }
});

test("rejects empty turns and cancellation before contacting Jev", async () => {
  const client = new JevClient("test-key", async () => { assert.fail("Must not contact Jev"); });
  await assert.rejects(classifyConversationTurn(client, { playerTurn: " \n " }, signal()), /player turn/);
  await assert.rejects(classifyConversationTurn(client, input, AbortSignal.abort()), { name: "AbortError" });
});

test("missing or invalid model answers and provider failures never become no-check results", async () => {
  for (const answers of [{}, { persuasion: { type: "choice", choice: "unknown", probabilities: {} } }]) {
    const client = new JevClient("test-key", async () => new Response(JSON.stringify({ answers })));
    await assert.rejects(classifyConversationTurn(client, input, signal()), /invalid or unavailable choice/);
  }
  const client = new JevClient("test-key", async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(classifyConversationTurn(client, input, signal()), /HTTP 503/);
});
