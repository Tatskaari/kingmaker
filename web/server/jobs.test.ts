import assert from "node:assert/strict";
import { test } from "node:test";
import { ScheduleAt, Timestamp } from "spacetimedb";
import { memoryHost } from "../../simulation/src/host/memory.ts";
import { all, caerwynArgs, DEFAULTS, held, identity, scriptedAi } from "../../simulation/src/host/testing.ts";
import { markOnline } from "../../simulation/src/lifecycle.ts";
import { recoverAfterRestart, startJobs, type Jobs } from "./jobs.ts";

/**
 * The jobs run as SpacetimeDB's scheduler runs them (browser-design §4.2), on fake timers: a commit
 * that dispatched starts its runs on the next turn of the event loop (after the move's answer), the
 * reaper runs on its row's interval, the town's clock every 6 s, idle waits for the thinks to come
 * in; and a start after the page went dispatches every running job again and has nobody online.
 */

const NEW_GAME = { campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "ranger" };
/** A turn of the event loop for the promises (the fake timers leave setImmediate real). */
const settled = () => new Promise(resolve => setImmediate(resolve));

test("a commit that dispatched starts its runs on the next turn of the event loop, the reaper runs on its row's interval, and idle waits for the thinks to come in", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const script = scriptedAi();
  const opening = held<unknown>();
  script.then("open", () => opening.promise);
  let jobs: Jobs | undefined;
  const host = memoryHost({ ai: script.ai, seed: 7, onCommit: commit => jobs?.afterCommit(commit) });
  host.as(host.owner).installCampaign(caerwynArgs());
  let reaped = 0;
  jobs = startJobs({ ...host, reap: () => { reaped++; host.reap(); } });
  t.after(() => jobs.stop());

  host.as(identity(1)).newGame(NEW_GAME);
  assert.equal(host.db.jobDispatch.count(), 1n, "not yet: the move's tx and answer go first");
  t.mock.timers.tick(0);
  assert.deepEqual([host.db.jobDispatch.count(), all(host.db.job).map(job => job.state)], [0n, ["running"]], "dispatched: the opening's POST in flight");

  let idle = false;
  void jobs.idle().then(() => { idle = true; });
  t.mock.timers.tick(4000);
  assert.equal(reaped, 2, "the reaper every 2 s, as its row says");
  await settled();
  assert.equal(idle, false, "the opening is still out");

  opening.settle(DEFAULTS.open);
  for (let n = 0; n < 20 && !idle; n++) {
    await settled();
    t.mock.timers.tick(0);
  }
  assert.equal(idle, true);
  assert.deepEqual(script.sent.map(sent => sent.step), ["open", "suggest"], "the opening's lines run after it, dispatched by its commit");
  assert.ok(all(host.db.job).every(job => job.state === "done"));
});

test("the town's clock runs every 6 s, as SpacetimeDB schedules tick_place by its place_tick rows, and stops with the jobs", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const host = memoryHost({ ai: scriptedAi().ai, seed: 7 });
  let ticked = 0;
  const jobs = startJobs({ ...host, tickPlaces: () => { ticked++; host.tickPlaces(); } });
  t.mock.timers.tick(5999);
  assert.equal(ticked, 0);
  t.mock.timers.tick(12_001);
  assert.equal(ticked, 3, "at 6, 12 and 18 s");
  jobs.stop();
  t.mock.timers.tick(60_000);
  assert.equal(ticked, 3, "another tab has the game: its clock is that tab's");
});

test("a fight's next turn runs once its fight_clock row's time has come by the simulation's clock, even when its timer wakes a little before it (a browser's)", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  // The simulation's clock a shade slower than the timers', as a browser's coarsened performance.now()
  // can be beside its timers: a wait of exactly the time left wakes before the row is due.
  const start = BigInt(Date.UTC(2026, 9, 18, 9)) * 1000n;
  let timersMs = 0;
  const clock = () => new Timestamp(start + BigInt(Math.floor(timersMs * 999)));
  let jobs: Jobs | undefined;
  const host = memoryHost({ ai: scriptedAi().ai, seed: 7, clock, onCommit: commit => jobs?.afterCommit(commit) });
  let ran = 0;
  jobs = startJobs({ ...host, fightSteps: () => { ran++; return host.fightSteps(); } });
  t.after(() => jobs?.stop());
  const tick = (ms: number) => { for (let i = 0; i < ms; i++) { timersMs++; t.mock.timers.tick(1); } };

  host.transact(tx => { tx.db.fightClock.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(start + 1_650_600n), fightId: 1n }); });
  tick(1640);
  assert.equal(host.db.fightClock.count(), 1n, "not yet");
  tick(40);
  assert.equal(host.db.fightClock.count(), 0n, "its turn ran (fight_step takes its row away as it runs)");
  assert.ok(ran >= 1 && ran <= 3, `woken early, it waited again for what was left (${ran} wake-ups), and no more`);
});

test("a start after the page went: every job that was running is dispatched again now, and every seated player is offline", async () => {
  const script = scriptedAi();
  script.then("open", () => new Promise(() => {}));
  const host = memoryHost({ ai: script.ai, seed: 7 });
  host.as(host.owner).installCampaign(caerwynArgs());
  host.as(identity(1)).newGame(NEW_GAME);
  void host.dispatchDue();
  host.transact(tx => markOnline(tx, identity(1), true));
  assert.deepEqual([all(host.db.job)[0]!.state, all(host.db.player)[0]!.online], ["running", true], "as the page left it");

  recoverAfterRestart(host);
  assert.deepEqual([all(host.db.job)[0]!.state, host.db.jobDispatch.count(), all(host.db.player)[0]!.online], ["queued", 1n, false]);
});
