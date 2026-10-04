import { retryResponses } from "../packages/conversation/src/ai.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { JevClient, type JevQuestions } from "../packages/providers/src/jev.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { adjudicateConversationChecks, resolvePlannedCheck } from "../packages/conversation/src/checks.js";
const reply = (content: unknown) => ({ role: "assistant" as const, content: JSON.stringify(content) });

test("all dice are resolved before presentation and one GM direction covers the actual results", async () => {
  const dice = [20, 6]; let calls = 0, shown = 0;
  const ruling = await adjudicateConversationChecks({ plan: [
    { skill: "persuasion", difficulty: "impossible" }, { skill: "deception", difficulty: "easy" },
  ], build: undefined, messages: [], roll: () => dice.shift()!,
    complete: async request => {
      calls++;
      const results = JSON.parse(request.messages.at(-1)!.content!).resolvedChecks;
      assert.deepEqual(results.map((result: { roll: number }) => result.roll), [20, 6]);
      return reply({ direction: "Agree, but expose the trick." });
    },
    present: async result => {
      assert.equal(dice.length, 0);
      assert.equal(result.degree, shown++ === 0 ? "critical_success" : "major_failure");
    },
  });
  assert.equal(shown, 2); assert.equal(calls, 1);
  assert.match(ruling!, /Agree, but expose/);
});

test("trivial and impossible retain their natural-roll rules at extreme modifiers", () => {
  for (const modifier of [-100, 100]) for (let roll = 1; roll <= 20; roll++) {
    assert.equal(resolvePlannedCheck({ skill: "persuasion", difficulty: "trivial" }, modifier, roll).success, roll !== 1);
    assert.equal(resolvePlannedCheck({ skill: "persuasion", difficulty: "impossible" }, modifier, roll).success, roll === 20);
  }
});

test("truncated GM output retries without rerolling or replaying presentation", async () => {
  const { OutputTokenLimitError } = await import("../packages/providers/src/openrouter.js");
  let calls = 0, rolls = 0, presentations = 0;
  await adjudicateConversationChecks({ plan: [{ skill: "intimidation", difficulty: "hard" }], build: undefined, messages: [],
    complete: retryResponses(async request => {
      calls++;
      if (calls === 1) throw new OutputTokenLimitError();
      assert.equal(request.max_tokens, 4000);
      return reply({ direction: "Reveal what you know." });
    }),
    roll: () => { rolls++; return 20; }, present: async () => { presentations++; },
  });
  assert.deepEqual([calls, rolls, presentations], [2, 1, 1]);
});

test("GM failure cancels pending presentation; presentation failure cancels the GM", async () => {
  for (const fails of ["gm", "presentation"]) {
    let cancelled = false;
    const wait = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => { cancelled = true; reject(signal.reason); }, { once: true });
    });
    await assert.rejects(adjudicateConversationChecks({ plan: [{ skill: "insight", difficulty: "normal" }], build: undefined, messages: [],
      complete: async (_request, signal) => fails === "gm" ? Promise.reject(new Error("GM failed")) : wait(signal),
      present: async (_result, signal) => fails === "presentation" ? Promise.reject(new Error("Popup cancelled")) : wait(signal),
    }), /failed|cancelled/);
    assert.equal(cancelled, true);
  }
});

test("finishing presentation first still waits for the GM", async () => {
  let release!: () => void, finished = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = adjudicateConversationChecks({ plan: [{ skill: "insight", difficulty: "normal" }], build: undefined, messages: [],
    present: async () => {}, complete: async () => { await gate; return reply({ direction: "Notice the lie." }); },
  }).then(result => { finished = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  release(); assert.match((await pending)!, /Notice the lie/);
});

test("cancelling asynchronous manual dice prevents GM and presentation calls", async () => {
  const controller = new AbortController();
  let requested = false;
  const task = adjudicateConversationChecks({ plan: [{ skill: "persuasion", difficulty: "normal" }],
    messages: [], build: undefined, signal: controller.signal,
    roll: (_check, signal) => new Promise<number>((_resolve, reject) => {
      requested = true;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    complete: async () => { throw new Error("GM must not run before a roll"); },
    present: async () => { throw new Error("Presentation must not run before a roll"); },
  });
  assert.equal(requested, true);
  controller.abort(new Error("Player cancelled"));
  await assert.rejects(task, /Player cancelled/);
});
