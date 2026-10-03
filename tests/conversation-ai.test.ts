import assert from "node:assert/strict";
import test from "node:test";
import { retryResponses } from "../packages/conversation/src/ai.js";
import { adjudicateConversationChecks } from "../packages/conversation/src/checks.js";
import { OutputTokenLimitError, ProviderResponseError } from "../packages/providers/src/openrouter.js";

test("AI service retries transient failures once and expands only truncated responses", async () => {
  for (const failure of [new ProviderResponseError("unavailable", true), new TypeError("fetch failed"),
    new DOMException("timeout", "TimeoutError"), new OutputTokenLimitError()]) {
    let calls = 0;
    const respond = retryResponses(async request => {
      if (++calls === 1) throw failure;
      assert.equal(request.max_tokens, failure instanceof OutputTokenLimitError ? 400 : 200);
      return { role: "assistant", content: "Recovered" };
    });
    assert.equal((await respond({ model: "test", messages: [], max_tokens: 200 })).content, "Recovered");
    assert.equal(calls, 2);
  }
});

test("terminal errors and cancellation do not retry; repeated transient failures stop after two calls", async () => {
  for (const mode of ["terminal", "cancel", "exhausted"]) {
    const controller = new AbortController(); let calls = 0;
    const respond = retryResponses(async () => {
      calls++;
      if (mode === "cancel") controller.abort();
      throw new ProviderResponseError("failed", mode !== "terminal");
    });
    await assert.rejects(respond({ model: "test", messages: [] }, controller.signal));
    assert.equal(calls, mode === "exhausted" ? 2 : 1);
  }
});

test("GM retry keeps presentation open and reuses the already-resolved dice", async () => {
  let calls = 0, rolls = 0, presentations = 0, acknowledged = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const turn = adjudicateConversationChecks({ plan: [{ skill: "insight", difficulty: "normal" }], messages: [], build: undefined,
    roll: () => { rolls++; return 12; },
    present: async (_result, signal) => {
      presentations++; await gate;
      assert.equal(signal.aborted, false); acknowledged = true;
    },
    complete: retryResponses(async request => {
      calls++;
      assert.equal(JSON.parse(request.messages.at(-1)!.content!).resolvedChecks[0].roll, 12);
      if (calls === 1) throw new ProviderResponseError("temporarily unavailable", true);
      return { role: "assistant", content: '{"direction":"Notice their hesitation."}' };
    }),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([calls, rolls, presentations, acknowledged], [2, 1, 1, false]);
  release(); assert.match((await turn)!, /Notice their hesitation/);
});
