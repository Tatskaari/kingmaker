import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The process's ledger and call log, where a call with no context goes: somewhere to check nothing went.
const scratch = mkdtempSync(join(tmpdir(), "km-seam-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
process.env.KM_COST_LEDGER = join(scratch, "ledger.jsonl");
delete process.env.KM_CALL_LOG;

const { respond, respondJson, sessionSpend } = await import("./openrouter.ts");
const { JevDecider } = await import("./decide.ts");
const { fakeFetch, fakeOpenRouter } = await import("./fake-openrouter.ts");
const { runTools } = await import("./tools.ts");

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
  assert.deepEqual(logged.map(e => [e.operation, e.started ?? "done"]), [["gm.reply", "/api/v1/responses"], ["gm.reply", "done"], ["director.ooc", "/api/alpha/decisions"], ["director.ooc", "done"]]);
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
  const reply = await respond({ operation: "gm.reply", input: [{ role: "user", content: "Hello" }], onText: t => shown.push(t), calls: { fetch: fake.fetch, apiKey: "k", cost: () => {} } });
  assert.equal(reply.text, "The boy glares at you from under the body.");
  assert.equal(shown.length, 9);
  assert.ok(shown.every((t, i) => i === 0 || t.startsWith(shown[i - 1]!)), "the text only grows");
  assert.ok(performance.now() - started >= 120);
});

test("decisionDelayMs holds every decision that long", async () => {
  const fake = fakeFetch({ decisionDelayMs: 120 });
  const started = performance.now();
  await new JevDecider("typesafe/jev-1.13", "jev", { fetch: fake.fetch, apiKey: "k", cost: () => {} }).decide({}, { ooc: { instructions: "?", criteria: { in_character: "in", out_of_character: "out" } } }, "director.ooc");
  assert.ok(performance.now() - started >= 110);
});

test("byNameDelayMs holds a structured call by its schema's name, and no other", async () => {
  const fake = fakeFetch({ byName: { looks: { looks: [] } }, byNameDelayMs: { looks: 120 } });
  const calls = { fetch: fake.fetch, apiKey: "k", cost: () => {} };
  const ask = (name: string) => respondJson<{ looks: unknown[] }>({ operation: name, input: [{ role: "user", content: "?" }], json: { name, schema: { type: "object", properties: { looks: { type: "array" } }, required: ["looks"] } }, calls });
  const done: string[] = [];
  const started = performance.now();

  const [looks] = await Promise.all([ask("looks").then(n => { done.push("looks"); return n; }), ask("world_ops").then(() => done.push("world_ops"))]);

  assert.deepEqual(looks.looks, []);
  assert.deepEqual(done, ["world_ops", "looks"]);
  assert.ok(performance.now() - started >= 110);
});

test("suggestDelayMs holds the suggested lines, and not the GM's reply", async () => {
  const fake = fakeFetch({ replies: ["Kell looks up."], suggestions: "- say: Who found him?", suggestDelayMs: 120 });
  const calls = { fetch: fake.fetch, apiKey: "k", cost: () => {} };
  const done: string[] = [];
  const started = performance.now();

  const [lines] = await Promise.all([
    respond({ operation: "scene.suggest", instructions: "You suggest what the player might say or do next.", input: [{ role: "user", content: "?" }], calls }).then(r => { done.push("lines"); return r; }),
    respond({ operation: "gm.reply", input: [{ role: "user", content: "Hello" }], calls }).then(() => done.push("reply")),
  ]);

  assert.equal(lines.text, "- say: Who found him?");
  assert.deepEqual(done, ["reply", "lines"]);
  assert.ok(performance.now() - started >= 110);
});

test("a tool loop with a context goes through its fetch, its log and its cost; without one, as it always has", async () => {
  const told = { toolCalls: { save_memory: [{ name: "save_memory", args: { characterId: "kell", title: "The coin" } }] } };
  const loop = (calls?: Parameters<typeof runTools>[0]["calls"]) => {
    const saved: string[] = [];
    const tools = [{ name: "save_memory", description: "Save a memory.", parameters: { type: "object" } }, { name: "read_doc", description: "Read a doc.", parameters: { type: "object" } }];
    const run = runTools({ operation: "memory.review.memories", instructions: "Review the moment.", input: [{ role: "user", content: "The moment." }], tools, ...(calls ? { calls } : {}) }, async (name, args) => { saved.push(`${name}: ${String(args.characterId)}, ${String(args.title)}`); return { ok: true }; });
    return run.then(result => ({ result, saved }));
  };
  const fake = fakeFetch(told);
  const { logged, costs, calls } = keeping(fake.fetch);
  const spentBefore = sessionSpend();

  const { result, saved } = await loop(calls);
  assert.deepEqual(saved, ["save_memory: kell, The coin"], "the first round's call, handled");
  assert.equal(result.text, "Done.", "the round that sent its output back");
  assert.deepEqual(fake.asked, ["/api/v1/responses", "/api/v1/responses"]);
  assert.deepEqual(logged.map(e => [e.operation, e.started ?? "done"]), [["memory.review.memories", "/api/v1/responses"], ["memory.review.memories", "/api/v1/responses"], ["memory.review.memories", "done"]]);
  assert.deepEqual(costs.map(c => c.operation), ["memory.review.memories", "memory.review.memories"]);
  assert.equal(sessionSpend(), spentBefore, "nothing of the process's");

  process.env.OPENROUTER_API_KEY ??= "offline";
  const global = fakeOpenRouter(told);
  try {
    const without = await loop();
    assert.equal(without.result.text, "Done.");
    assert.deepEqual(global.asked, ["/api/v1/responses", "/api/v1/responses"], "through the process's fetch");
    assert.ok(sessionSpend() > spentBefore, "the process's spend");
    assert.equal(logged.length, 3, "and none of it in the context's log");
  } finally {
    global.restore();
  }
});
