import assert from "node:assert/strict";
import { test } from "node:test";
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
