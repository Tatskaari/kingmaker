import { test } from "node:test";
import assert from "node:assert/strict";
import { all, down, hostWithCampaign, http, identity } from "../host/testing.ts";
import { LOST_THREAD } from "../jobs.ts";

/**
 * The creation's job owner on the memory host (v1-design §3.5): the job loop's claim, backoff,
 * deadline, reaper and give-up are V0's; what's the creation's is whether its answer is still
 * wanted, the note while the GM is out of reach, and what failing for good leaves behind.
 */

const TAMSIN = { campaign: "caerwyn", name: "Tamsin Vell", concept: "a disgraced palace auditor", how: "three" };
const BUDGET = "The GM has spent today's budget ($5.00): it starts again at midnight UTC, or raise KM_AI_DAILY_USD.";

test("the GM out of reach: the creation's note says so while it tries again, and the answer clears it", async () => {
  const { host, script } = hostWithCampaign();
  const tamsin = identity(1);
  script.then("offer", down(), http(503));

  host.as(tamsin).startCreation(TAMSIN);
  await host.drain();
  const waiting = host.view(tamsin).myCreation()!;
  assert.deepEqual([waiting.busy, waiting.note], ["builds", LOST_THREAD]);
  assert.deepEqual(all(host.db.job).map(j => [j.state, j.attempts]), [["waiting", 1]]);

  host.advance(1000);
  await host.drain();
  host.advance(2000);
  await host.drain();

  const offered = host.view(tamsin).myCreation()!;
  assert.deepEqual([offered.busy, offered.note, offered.step, !!offered.offer], [undefined, undefined, "choose", true]);
  assert.deepEqual(script.to("offer").map(s => s.attempt), ["1", "2", "3"]);
  assert.equal(new Set(script.to("offer").map(s => s.key)).size, 1, "the same key each time");
});

test("over the AI service's budget, a step fails at once in its words: the GM idle, back to the concept, the job gone", async () => {
  const { host, script } = hostWithCampaign();
  const tamsin = identity(1);
  script.then("offer", http(402, { error: { code: "over_budget", message: BUDGET } }));

  host.as(tamsin).startCreation(TAMSIN);
  await host.drain();

  const failed = host.view(tamsin).myCreation()!;
  assert.deepEqual([failed.step, failed.busy, failed.note], ["concept", undefined, BUDGET]);
  assert.deepEqual(all(host.db.job), [], "nothing retries a creation's step but the player's next move");
  assert.equal(script.to("offer").length, 1);

  host.as(tamsin).startCreation(TAMSIN);
  await host.drain();
  assert.deepEqual([host.view(tamsin).myCreation()!.step, host.view(tamsin).myCreation()!.note], ["choose", undefined], "asked again, it's answered");
});

test("a step that fails where there's something to show stays there: a draft that never came leaves the backstory and the box as they were", async () => {
  const { host, script } = hostWithCampaign();
  const tamsin = identity(1);
  host.as(tamsin).startCreation(TAMSIN);
  await host.drain();
  host.as(tamsin).chooseBuild({ index: 0 });
  script.then("draft", http(400));

  host.as(tamsin).draftBackstory({ text: "my notes" });
  await host.drain();

  const row = host.view(tamsin).myCreation()!;
  assert.deepEqual([row.step, row.busy, row.story, row.proposal], ["backstory", undefined, "my notes", undefined]);
  assert.match(row.note!, /^The GM couldn't answer: 400 bad_request: scripted/);
});

test("failing for ten minutes, a step gives up; but one the player has moved on from is let go at once, asking nothing more", async () => {
  const { host, script } = hostWithCampaign();
  const tamsin = identity(1), pell = identity(2);
  for (let i = 0; i < 100; i++) script.then("offer", http(503));

  host.as(tamsin).startCreation(TAMSIN);
  host.as(pell).startCreation({ ...TAMSIN, name: "Pell Marrow" });
  await host.drain();
  host.as(pell).creationBack();

  host.advance(1000);
  await host.drain();
  assert.match(host.logs.join("\n"), /\[reaper\] job \d+ \S+:offer dropped: its creation has moved on/);
  const pellAsked = script.to("offer").filter(s => s.body.who.name === "Pell Marrow").length;

  for (let t = 0; t < 41; t++) {
    host.advance(15_000);
    await host.drain();
  }
  const gaveUp = host.view(tamsin).myCreation()!;
  assert.deepEqual([gaveUp.step, gaveUp.busy], ["concept", undefined]);
  assert.match(gaveUp.note!, /^The GM couldn't answer: no answer for 10 minutes \(last: 503 model_failed: scripted\)/);
  assert.equal(script.to("offer").filter(s => s.body.who.name === "Pell Marrow").length, pellAsked, "nothing more asked for the creation moved on from");
  assert.deepEqual(all(host.db.job), []);
});

test("an answer for a creation replaced meanwhile is dropped: the new one isn't touched", async () => {
  const { host, script } = hostWithCampaign();
  const tamsin = identity(1);
  script.then("offer", () => {
    host.as(tamsin).startCreation({ ...TAMSIN, how: "model" });
    return { offer: { options: [] }, usage: { calls: 1, costUsd: 0.5, byOperation: {} } };
  });

  host.as(tamsin).startCreation(TAMSIN);
  await host.drain();

  const now = host.view(tamsin).myCreation()!;
  assert.deepEqual([now.how, now.offer, now.step, now.calls], ["model", undefined, "backstory", 1], "the pick's call alone");
  assert.match(host.logs.join("\n"), /:offer attempt 1\] dropped: its creation has moved on/);
});
