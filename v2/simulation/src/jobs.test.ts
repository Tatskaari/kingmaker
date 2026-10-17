import { test } from "node:test";
import assert from "node:assert/strict";
import type { DecideResponse, NotesResponse, ReplyResponse, SuggestResponse } from "../../shared/protocol/ai.ts";
import { idText } from "../../shared/protocol/keys.ts";
import { memoryHost } from "./host/memory.ts";
import { all, caerwynArgs, DEFAULTS, down, held, http, identity, openedGame, sceneNow, tick } from "./host/testing.ts";
import { LOST_THREAD, queueThink } from "./jobs.ts";
import { suggest } from "./moves/suggest.ts";

/**
 * The job loop (v0-design §3.5) on the memory host: a POST that can be tried again waits and is
 * dispatched by the reaper with backoff; one that can't fails the turn until retry_turn; a late
 * answer from an earlier dispatch is dropped; a job whose procedure died is dispatched again. And
 * the jobs beside a turn (v5-design §3.4): in the background, they say nothing on the turn and never
 * fail it, and they're one row a turn and move.
 */

const decision: DecideResponse = { decision: { earned: false, daft: false, outOfCharacter: false }, opened: [], usage: { calls: 1, costUsd: 0.0005, byOperation: {} } };

test("a POST that fails is tried again by the reaper, at 1 s then 2 s, the same key each time; the turn says so meanwhile", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("decide", down(), http(503), decision);

  host.as(wren).say({ text: "Who found him?" });
  await host.drain();

  const waiting = sceneNow(host, scene.id);
  assert.deepEqual(waiting.jobs.map(j => [j.step, j.state, j.attempts]), [["decide", "waiting", 1]]);
  assert.equal(waiting.turns[1]!.phase, "deciding");
  assert.equal(waiting.turns[1]!.note, LOST_THREAD);
  assert.match(waiting.jobs[0]!.error!, /Connection refused/);

  host.advance(999);
  await host.drain();
  assert.equal(script.to("decide").length, 1, "not yet: the first retry is a second away");
  host.advance(1);
  await host.drain();
  assert.deepEqual(sceneNow(host, scene.id).jobs.map(j => [j.state, j.attempts]), [["waiting", 2]]);

  host.advance(2000);
  await host.drain();

  const now = sceneNow(host, scene.id);
  const decides = script.to("decide");
  assert.deepEqual(decides.map(d => d.attempt), ["1", "2", "3"]);
  assert.equal(new Set(decides.map(d => d.key)).size, 1);
  assert.deepEqual(now.turns.map(t => [t.n, t.phase, t.note]), [[0, "done", undefined], [1, "done", undefined]]);
  assert.match(host.logs.join("\n"), /attempt 1\] HttpError.*: waiting, retry in 1 s/);
  assert.match(host.logs.join("\n"), /attempt 2\] 503 model_failed: scripted: waiting, retry in 2 s/);
});

test("a status that won't mend fails the turn, keeping the lease; retry_turn carries on from that step", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("reply", http(400));
  host.as(wren).say({ text: "Who found him?" });
  await host.drain();

  const failed = sceneNow(host, scene.id);
  assert.deepEqual(failed.turns[1]!.phase, "failed");
  assert.equal(failed.turns[1]!.error, "The GM couldn't answer: 400 bad_request: scripted");
  assert.equal(failed.scene.turnId, failed.turns[1]!.id, "the lease kept");
  assert.deepEqual(failed.jobs.map(j => [j.step, j.state]), [["reply", "failed"]]);
  assert.equal(host.as(wren).say({ text: "Hello?" })?.code, "turn_failed");

  assert.equal(host.as(wren).retryTurn({ turn: failed.turns[1]!.id }), undefined);
  const retried = sceneNow(host, scene.id);
  assert.deepEqual([retried.turns[1]!.phase, retried.turns[1]!.error], ["replying", undefined]);
  assert.deepEqual(retried.jobs.map(j => [j.step, j.state, j.attempts]), [["reply", "queued", 0]]);
  await host.drain();

  assert.deepEqual(sceneNow(host, scene.id).turns.map(t => t.phase), ["done", "done"]);
  assert.deepEqual(script.to("decide").length, 1, "the decide was committed before: not asked again");
  assert.deepEqual(script.to("reply").map(r => r.attempt), ["1", "1"]);
});

test("a commit that throws fails the turn rather than looping; retry_turn tries it again", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("decide", { opened: [], usage: { calls: 1, costUsd: 0, byOperation: {} } });
  host.as(wren).say({ text: "Who found him?" });
  await host.drain();

  const failed = sceneNow(host, scene.id);
  assert.equal(failed.turns[1]!.phase, "failed");
  assert.equal(failed.turns[1]!.error, "The GM couldn't answer: the commit failed: Error: the answer has no decision");
  assert.equal(failed.turns[1]!.calls, 0, "the commit's writes, usage included, were rolled back");
  assert.equal(script.to("decide").length, 1);

  host.as(wren).retryTurn({ turn: failed.turns[1]!.id });
  await host.drain();
  assert.deepEqual(sceneNow(host, scene.id).turns.map(t => t.phase), ["done", "done"]);
});

test("a job whose POST outlives its deadline is dispatched again, and the late answer is dropped", async () => {
  const { host, script, wren, scene } = await openedGame();
  const slow = held<DecideResponse>();
  script.then("decide", () => slow.promise, decision);
  host.as(wren).say({ text: "Who found him?" });

  const first = host.drain();
  await tick();
  assert.deepEqual(sceneNow(host, scene.id).jobs.map(j => [j.state, j.attempts]), [["running", 1]]);

  host.advance(20_000 + 10_000);
  assert.match(host.logs.join("\n"), /\[reaper\] job \d+ .+:t1:decide re-dispatched after its deadline/);
  assert.equal(sceneNow(host, scene.id).turns[1]!.note, LOST_THREAD);
  await host.drain();
  assert.deepEqual(sceneNow(host, scene.id).turns.map(t => t.phase), ["done", "done"]);

  slow.settle({ ...decision, decision: { ...decision.decision, outOfCharacter: true } });
  await first;
  const now = sceneNow(host, scene.id);
  assert.deepEqual(now.gm.oocTurns, [], "the late answer changed nothing");
  assert.match(host.logs.join("\n"), /\[job \d+ .+:t1:decide attempt 1\] dropped: the job has moved on since this dispatch/);
  assert.deepEqual(script.to("decide").map(d => d.attempt), ["1", "2"]);
});

test("a queued job whose dispatch was lost (its procedure died before claiming it) gets another after 10 s", async () => {
  const { host, wren, scene } = await openedGame();
  host.as(wren).say({ text: "Who found him?" });
  host.transact(tx => { for (const d of [...tx.db.jobDispatch.iter()]) tx.db.jobDispatch.scheduledId.delete(d.scheduledId); });

  await host.drain();
  assert.equal(sceneNow(host, scene.id).turns[1]!.phase, "deciding");
  host.advance(9_999);
  assert.equal(all(host.db.jobDispatch).length, 0);
  host.advance(1);
  await host.drain();
  assert.deepEqual(sceneNow(host, scene.id).turns.map(t => t.phase), ["done", "done"]);
});

test("failing for ten minutes, a job fails its turn", async () => {
  const { host, script, wren, scene } = await openedGame();
  for (let i = 0; i < 60; i++) script.then("decide", down());
  host.as(wren).say({ text: "Who found him?" });
  await host.drain();

  for (let s = 0; s < 10 * 60; s += 15) {
    host.advance(15_000);
    await host.drain();
  }

  const now = sceneNow(host, scene.id);
  assert.equal(now.turns[1]!.phase, "failed");
  assert.match(now.turns[1]!.error!, /^The GM couldn't answer: no answer for 10 minutes \(last: HttpError/);
  assert.equal(now.jobs[0]!.state, "failed");
  const attempts = script.to("decide").length;
  host.advance(60_000);
  await host.drain();
  assert.equal(script.to("decide").length, attempts, "nothing is tried once it has failed");
});

test("an answer for a turn the scene no longer waits on is dropped, and the move stops", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("decide", () => {
    host.transact(tx => tx.db.scene.id.update({ ...tx.db.scene.id.find(scene.id)!, turnId: undefined }));
    return decision;
  });
  host.as(wren).say({ text: "Who found him?" });
  await host.drain();

  assert.deepEqual(all(host.db.job), []);
  assert.equal(script.to("reply").length, 0);
  assert.match(host.logs.join("\n"), /dropped: scene \d+ no longer waits on turn \d+/);
});

test("with no AI_URL, the opening fails at once: nothing to POST to", async () => {
  const host = memoryHost({ ai: async () => { throw new Error("never called"); }, env: {} });
  host.as(host.owner).installCampaign(caerwynArgs());
  host.as(identity(1)).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "", build: "rogue" });
  await host.drain();

  const scene = all(host.db.scene)[0]!;
  const turn0 = sceneNow(host, scene.id).turns[0]!;
  assert.deepEqual([scene.status, turn0.phase, turn0.error], ["opening", "failed", "The GM couldn't answer: the AI service isn't configured (no AI_URL)"]);
});

// ---------------------------------------------------------------------------------------------
// Jobs in the background (v5-design §3.4).

const TEXT = "Kell looks up. “Cob found him.”";
const kellSays: ReplyResponse = {
  entries: [{ speaker: "gm", kind: "narration", text: TEXT, markup: { speech: [{ start: 15, end: TEXT.length, speaker: "kell" }], marks: [] } }],
  gm: { repeated: null }, firstTextMs: 3, usage: { calls: 1, costUsd: 0.001, byOperation: {} },
};
const noted: NotesResponse = { marks: [{ start: 15, end: TEXT.length, kind: "why", note: "She saw who found him.", link: { kind: "person", id: "kell" } }], usage: { calls: 1, costUsd: 0.0002, byOperation: {} } };

test("a job in the background says nothing on the turn as it tries again while the turn has its own steps; the turn's own step's note stays when its answer lands, and its usage counts", async () => {
  const { host, script, wren, scene } = await openedGame();
  const notes = held<NotesResponse>();
  script.then("reply", kellSays, kellSays);
  script.then("notes", () => notes.promise, http(503), noted);
  script.then("settle", down());

  host.as(wren).say({ text: "Who found him?" });
  const first = host.drain();
  await tick();
  await host.drain();
  assert.deepEqual([sceneNow(host, scene.id).turns[1]!.phase, sceneNow(host, scene.id).turns[1]!.note], ["settling", LOST_THREAD], "the settle waits to try again");

  notes.settle(noted);
  await first;
  const landed = sceneNow(host, scene.id).turns[1]!;
  assert.deepEqual([landed.notes, landed.note, landed.calls], ["written", LOST_THREAD, 1 + 1 + 2 + 1], "the notes' answer leaves the settle's note, and adds its call");
  host.advance(1000);
  await host.drain();
  assert.deepEqual([sceneNow(host, scene.id).turns[1]!.phase, sceneNow(host, scene.id).turns[1]!.note], ["done", undefined]);

  host.as(wren).say({ text: "When?" });
  await host.drain();
  const noting = sceneNow(host, scene.id).turns[2]!;
  assert.deepEqual([noting.phase, noting.note], ["noting", undefined], "a 503 on the notes while the turn settled: waiting to try again, and nothing said");
  assert.equal(all(host.db.job).find(j => j.move === "notes")?.state, "waiting");
  host.advance(1000);
  await host.drain();
  assert.deepEqual([sceneNow(host, scene.id).turns[2]!.phase, sceneNow(host, scene.id).turns[2]!.notes], ["done", "written"]);
});

test("retry_turn takes the turn's own failed job, never one in the background", async () => {
  const { host, script, wren, scene } = await openedGame();
  const turnId = sceneNow(host, scene.id).turns[0]!.id + 1n;
  host.transact(tx => tx.db.job.insert({
    id: 0n, key: `x:s${scene.id}:t1:notes`, gameId: scene.gameId, sceneId: scene.id, turnId, move: "notes", step: "notes", endpoint: "/v1/turns/notes", timeoutMs: 30_000,
    request: "{}", plan: "{}", state: "failed", attempts: 1, deadline: undefined, retryAt: undefined, failingSince: undefined, error: "a background job left failed", updatedAt: host.now(),
  }));
  script.then("reply", http(400));
  host.as(wren).say({ text: "Who found him?" });
  await host.drain();
  assert.equal(sceneNow(host, scene.id).turns[1]!.id, turnId);

  assert.equal(host.as(wren).retryTurn({ turn: turnId }), undefined);
  const jobs = all(host.db.job).map(j => [j.move, j.step, j.state]);
  assert.deepEqual(jobs, [["notes", "notes", "failed"], ["say", "reply", "queued"]]);
});

test("one job a turn and move: queued again, its row is written over, and an answer to what it held is dropped as stale", async () => {
  const { host, script, wren, scene } = await openedGame();
  const old = held<SuggestResponse>();
  script.then("suggest", () => old.promise);
  host.as(wren).say({ text: "Sergeant." });
  const first = host.drain();
  await tick();
  await host.drain();

  const turn = sceneNow(host, scene.id).turns[1]!;
  host.transact(tx => queueThink(tx, suggest, { step: "suggest", game: idText(scene.gameId), scene: idText(scene.id), turn: idText(turn.id), n: 1, ask: 2 }));
  const rows = all(host.db.job).filter(j => j.turnId === turn.id);
  assert.deepEqual(rows.map(j => [j.move, j.state, j.key.split(":").pop()]), [["suggest", "queued", "suggest-2"]]);

  await host.drain();
  old.settle({ lines: [{ kind: "say", text: "Stale" }], dropped: [], usage: { calls: 2, costUsd: 0, byOperation: {} } });
  await first;
  assert.deepEqual([...host.db.sceneSuggestion.sceneId.filter(scene.id)].map(s => s.text), DEFAULTS.suggest.lines.map(l => l.text));
  assert.match(host.logs.join("\n"), /:t1:suggest attempt 1\] dropped: the job has moved on since this dispatch/);
});

test("dispatch_waiting, the owner's: every waiting job goes again now, not at its time; anyone else is refused", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("decide", down(), down(), down(), down(), decision);
  host.as(wren).say({ text: "Who found him?" });
  await host.drain();
  for (const ms of [1_000, 2_000, 4_000]) { host.advance(ms); await host.drain(); }
  assert.deepEqual(sceneNow(host, scene.id).jobs.map(j => [j.state, j.attempts]), [["waiting", 4]], "the next try is 8 s away");

  assert.deepEqual(host.as(wren).dispatchWaiting(), { code: "not_admin", text: "Only the database's owner may dispatch the waiting thinks." });
  assert.equal(host.as(host.owner).dispatchWaiting(), undefined);
  await host.drain();

  assert.deepEqual(script.to("decide").map(d => d.attempt), ["1", "2", "3", "4", "5"], "the fifth try at once, the clock where it was");
  assert.deepEqual(sceneNow(host, scene.id).turns.map(t => [t.phase, t.note]), [["done", undefined], ["done", undefined]]);
  assert.match(host.logs.join("\n"), /\[dispatch_waiting\] job \d+ .+:t1:decide dispatched again \(attempt 5\)/);
});
