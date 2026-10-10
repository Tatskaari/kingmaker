import assert from "node:assert/strict";
import test from "node:test";
import { cressidaScheduler } from "../apps/web/src/cressida-scheduler.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { activityGoal } from "../packages/lore/src/activity.js";
import { loadPlayableWorld } from "./fixtures.js";

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
test("warn at 4:30, change at five minutes, return at six even if review stalls", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let timer: import("../apps/web/src/cressida-scheduler.js").CressidaTimer | null = null;
  let cow = false;
  const stages: string[] = [], signals: AbortSignal[] = [];
  const scheduler = cressidaScheduler({ changed: value => { timer = value; }, activeKey: () => "game", isCow: () => cow,
    transform: async () => { cow = !cow; stages.push(cow ? "cow" : "changed-human"); },
    review: async (stage, signal) => { stages.push(stage); signals.push(signal);
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve())); },
    error: error => { throw error; },
  });
  scheduler.sync(); assert.deepEqual(timer, { next: "warning", dueAt: 270_000 });
  t.mock.timers.tick(269_999); await flush(); assert.deepEqual(stages, []);
  t.mock.timers.tick(1); await flush(); assert.deepEqual(stages, ["warning"]);
  t.mock.timers.tick(30_000); await flush(); assert.deepEqual(stages, ["warning", "cow"]);
  assert.equal(signals[0]!.aborted, true);
  assert.deepEqual(timer, { next: "human", dueAt: 360_000 });
  t.mock.timers.tick(59_999); await flush(); assert.equal(cow, true);
  t.mock.timers.tick(1); await flush(); assert.deepEqual(stages, ["warning", "cow", "changed-human", "human"]);
  t.mock.timers.tick(270_000); await flush(); assert.equal(stages.at(-1), "warning");
  scheduler.stop(); assert.equal(timer, null); const count = stages.length;
  t.mock.timers.tick(240_000); await flush(); assert.equal(stages.length, count);
  assert.equal(signals.at(-1)!.aborted, true);
});

test("private reviews get synthetic evidence and activities are assigned before review finishes", async () => {
  const evidence: Array<{ participants: readonly string[]; text: string }> = [];
  let ready = 0;
  const runtime = new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, { strategies: { review: {
    resolve: async context => {
      assert.ok(ready > 0, "Activity must already be available to the worker");
      evidence.push({ participants: context.participants, text: context.transcript[0]!.text });
      return { summary: "Reviewed" };
    },
  } } });
  const signal = new AbortController().signal;
  const playerMessages = runtime.snapshot().playerMessages;
  await runtime.reviewCressidaTransition("warning", signal, () => { ready++; });
  assert.match(activityGoal(runtime.world(), "cressida")!, /Run.*sabine_chamber/);
  assert.match(activityGoal(runtime.world(), "cressida")!, /East Wing, then the Saltmere Drawing Room, then the Saltmere Back Hall/);
  assert.match(activityGoal(runtime.world(), "cressida")!, /open the Saltmere quarters door if it is closed/);
  assert.match(evidence[0]!.text, /in thirty seconds you will turn into a cow/);
  await runtime.reviewCressidaTransition("human", signal);
  assert.match(activityGoal(runtime.world(), "cressida")!, /Return.*great_hall/);
  assert.deepEqual(evidence.map(item => item.participants), [["cressida"], ["cressida"]]);
  assert.deepEqual(runtime.snapshot().playerMessages, playerMessages, "Private warning must not announce her secret to the player");
});

test("failed review leaves the retreat activity assigned", async () => {
  const runtime = new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, { strategies: { review: {
    resolve: async () => { throw new Error("Model unavailable"); },
  } } });
  await assert.rejects(runtime.reviewCressidaTransition("warning", new AbortController().signal), /Model unavailable/);
  assert.match(activityGoal(runtime.world(), "cressida")!, /sabine_chamber/);
});
