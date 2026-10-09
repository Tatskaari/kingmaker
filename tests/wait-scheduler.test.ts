import assert from "node:assert/strict";
import test from "node:test";
import { WaitScheduler } from "../apps/web/src/wait-scheduler.js";

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
test("wait timers jitter independently, skip busy characters and never overlap a pending call", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0, busy = true, index = 0, finish: (() => void) | undefined;
  const calls: Array<[string, number]> = [];
  const candidates = new Map([["alice", "a.md"], ["bob", "b.md"]]);
  const scheduler = new WaitScheduler({ candidates: () => candidates, busy: id => id === "alice" && busy,
    now: () => now, random: () => index++ % 2, error: () => assert.fail(),
    run: async (id, elapsed) => { calls.push([id, elapsed]); await new Promise<void>(resolve => { finish = resolve; }); },
  });
  scheduler.sync();
  now = 12_000; t.mock.timers.tick(12_000); await flush();
  assert.equal(calls.length, 0);
  now = 18_000; t.mock.timers.tick(6_000); await flush();
  assert.deepEqual(calls, [["bob", 18]]);
  now = 60_000; t.mock.timers.tick(42_000); await flush();
  assert.equal(calls.length, 1, "No second call while the first remains pending");
  candidates.delete("bob"); scheduler.sync(); finish!(); await flush();
  busy = false; now = 78_000; t.mock.timers.tick(18_000); await flush();
  assert.equal(calls.at(-1)![0], "alice");
  scheduler.stop(); finish!(); await flush();
});

test("replacing a wait or cancelling the game aborts stale calls and resets elapsed time", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0; const candidates = new Map([["alice", "first.md"]]);
  const signals: AbortSignal[] = [], elapsed: number[] = [];
  const scheduler = new WaitScheduler({ candidates: () => candidates, busy: () => false,
    now: () => now, random: () => 0.5, error: () => assert.fail(), run: async (_id, seconds, signal) => {
      signals.push(signal); elapsed.push(seconds);
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve()));
    },
  });
  scheduler.sync(); now = 15_000; t.mock.timers.tick(15_000); await flush();
  candidates.set("alice", "second.md"); scheduler.sync();
  assert.equal(signals[0]!.aborted, true);
  now = 30_000; t.mock.timers.tick(15_000); await flush();
  assert.deepEqual(elapsed, [15, 15]);
  candidates.clear(); scheduler.stop(); await flush();
  assert.equal(signals[1]!.aborted, true);
});

test("follow checks use an exact 15 second cadence and stop with their wait", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const candidates = new Map([["rowan", "follow.md"]]);
  let calls = 0;
  const scheduler = new WaitScheduler({ candidates: () => candidates, busy: () => false,
    delayMs: () => 15_000, error: () => assert.fail(), run: async () => { calls++; } });
  scheduler.sync(); t.mock.timers.tick(14_999); await flush(); assert.equal(calls, 0);
  t.mock.timers.tick(1); await flush(); assert.equal(calls, 1);
  t.mock.timers.tick(15_000); await flush(); assert.equal(calls, 2);
  candidates.clear(); scheduler.sync(); t.mock.timers.tick(15_000); await flush(); assert.equal(calls, 2);
});
