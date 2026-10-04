import { strict as assert } from "node:assert";
import { test } from "node:test";
import { traceCliDecisions, type CliDecisionCall } from "../apps/conversation-cli/decision-calls.js";
import type { AiService } from "../packages/conversation/src/services.js";

test("CLI decision inspector records pending, negative answers and failures with stable IDs", async () => {
  const calls: CliDecisionCall[] = [];
  const answer = { flag: { choice: "not_flagged", probabilities: { flagged: 0, not_flagged: 1 } } };
  const ai: AiService = { responses: async () => { throw Error("unused"); }, decisions: async (_state, _questions, signal) => {
    assert.equal(calls.at(-1)?.status, "pending");
    signal.throwIfAborted();
    return answer;
  } };
  const traced = traceCliDecisions(ai, call => calls.push(call));
  const questions = { flag: { type: "choice" as const, instructions: "Classify", criteria: { flagged: "yes", not_flagged: "no" } } };
  assert.equal(await traced.decisions({ reply: "Hello" }, questions, new AbortController().signal, "conversation_attention"), answer);
  assert.deepEqual(calls.map(call => call.status), ["pending", "completed"]);
  assert.equal(calls[0]?.id, calls[1]?.id);
  assert.deepEqual(calls[1]?.request, { state: { reply: "Hello" }, questions });
  assert.equal(calls[1]?.answers, answer);
  const controller = new AbortController(); controller.abort(Error("Cancelled"));
  await assert.rejects(traced.decisions({}, questions, controller.signal), /Cancelled/);
  assert.deepEqual(calls.slice(2).map(call => call.status), ["pending", "failed"]);
  assert.equal(calls[2]?.id, calls[3]?.id);
  assert.notEqual(calls[0]?.id, calls[2]?.id);
  assert.match(calls[3]!.error!, /Cancelled/);
});
