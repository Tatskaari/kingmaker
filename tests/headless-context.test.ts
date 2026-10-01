import assert from "node:assert/strict";
import test from "node:test";
import { silkScarf } from "../evals/jev/scenarios.js";
import { activateGoal } from "../packages/evals/src/jev-world-eval.js";
import { JevClient, jevRequest } from "../packages/providers/src/jev.js";

test("offline decision context is exactly the request sent to Jev", async t => {
  const runtime = silkScarf.createRuntime("");
  assert.throws(() => runtime.npcDecisionContext(silkScarf.characterId), /idle/);
  activateGoal(runtime, silkScarf);
  const context = runtime.npcDecisionContext(silkScarf.characterId);
  t.mock.method(JevClient.prototype, "choose", async (...[state, instructions, criteria]: Parameters<JevClient["choose"]>) => {
    assert.deepEqual(jevRequest(state, instructions, criteria), context.request);
    return { choice: "wait", probabilities: {} };
  });
  const plan = await runtime.planNpc(silkScarf.characterId, new AbortController().signal);
  assert.equal(plan.decision.choice, "wait");
  assert.equal(typeof context.request.state, "string");
  assert.ok(Object.keys(context.request.questions.next!.criteria).length > 3);
});
