import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The process's ledger and call log, where a call with no context goes: somewhere to check nothing went.
const scratch = mkdtempSync(join(tmpdir(), "km-seam-"));
process.env.KM_COST_LEDGER = join(scratch, "ledger.jsonl");
delete process.env.KM_CALL_LOG;

const { respond, sessionSpend } = await import("./openrouter.ts");
const { JevDecider } = await import("./decide.ts");
const { fakeFetch, fakeOpenRouter } = await import("./fake-openrouter.ts");

/** A call context that keeps what it's told, as the AI service's does. */
function keeping(fetch: typeof globalThis.fetch) {
  const logged: Array<Record<string, unknown>> = [];
  const costs: Array<{ operation: string; costUsd: number }> = [];
  return { logged, costs, calls: { fetch, apiKey: "test-key", log: (e: Record<string, unknown>) => logged.push(e), cost: (c: { operation: string; costUsd: number }) => costs.push(c) } };
}

test("a call with a context goes through its fetch, its log and its cost, and touches none of the process's", async () => {
  const fake = fakeFetch({ replies: ["Kell looks up."] });
  const { logged, costs, calls } = keeping(fake.fetch);
  const spentBefore = sessionSpend();

  const reply = await respond({ operation: "gm.reply", input: [{ role: "user", content: "Hello" }], calls });
  const decision = await new JevDecider("typesafe/jev-1.13", "jev", calls).decide({}, { ooc: { instructions: "?", criteria: { in_character: "in", out_of_character: "out" } } }, "director.ooc");

  assert.equal(reply.text, "Kell looks up.");
  assert.equal(decision.answers.ooc?.choice, "in_character");
  assert.deepEqual(fake.asked, ["/api/v1/responses", "/api/alpha/decisions"]);
  assert.deepEqual(logged.map(e => e.operation), ["gm.reply", "director.ooc"]);
  assert.deepEqual(costs.map(c => c.operation), ["gm.reply", "director.ooc"]);
  assert.equal(sessionSpend(), spentBefore);
  assert.equal(existsSync(process.env.KM_COST_LEDGER!), false);
});

test("the key a context carries is the one sent", async () => {
  const fake = fakeFetch();
  const seen: string[] = [];
  const watching: typeof fetch = (input, init) => { seen.push(new Headers(init?.headers).get("authorization") ?? ""); return fake.fetch(input, init); };
  await respond({ operation: "gm.reply", input: [{ role: "user", content: "Hello" }], calls: { fetch: watching, apiKey: "sk-the-request's" } });
  assert.deepEqual(seen, ["Bearer sk-the-request's"]);
});

test("without a context, a call goes as it always has: through the process's fetch", async () => {
  process.env.OPENROUTER_API_KEY ??= "offline";
  const fake = fakeOpenRouter({ replies: ["The yard waits."] });
  try {
    const reply = await respond({ operation: "gm.reply", input: [{ role: "user", content: "Hello" }] });
    assert.equal(reply.text, "The yard waits.");
    assert.deepEqual(fake.asked, ["/api/v1/responses"]);
  } finally {
    fake.restore();
  }
});

test("streamMs writes a reply a word at a time, over about that long", async () => {
  const fake = fakeFetch({ replies: ["The boy glares at you from under the body."], streamMs: 160 });
  const shown: string[] = [];
  const started = performance.now();
  const reply = await respond({ operation: "gm.reply", input: [{ role: "user", content: "Hello" }], onText: t => shown.push(t), calls: { fetch: fake.fetch, apiKey: "k" } });
  assert.equal(reply.text, "The boy glares at you from under the body.");
  assert.equal(shown.length, 9);
  assert.ok(shown.every((t, i) => i === 0 || t.startsWith(shown[i - 1]!)), "the text only grows");
  assert.ok(performance.now() - started >= 120);
});

test("decisionDelayMs holds every decision that long", async () => {
  const fake = fakeFetch({ decisionDelayMs: 120 });
  const started = performance.now();
  await new JevDecider("typesafe/jev-1.13", "jev", { fetch: fake.fetch, apiKey: "k" }).decide({}, { ooc: { instructions: "?", criteria: { in_character: "in", out_of_character: "out" } } }, "director.ooc");
  assert.ok(performance.now() - started >= 110);
});
