import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameReport } from "../../../shared/report/format.ts";
import { all, held, hostWithCampaign, http, identity, openedGame, sceneNow, tick } from "../host/testing.ts";

/**
 * restore_game (V16, M5): a reported game's jobs made again from its rows in the database it's
 * restored to, as it was reported: a turn that had failed can be retried, and one under way thinks
 * again and finishes. (A game played on the local host, restored and played on: hosts/report.test.ts.)
 */

/** The report's rows of the game, as report_game gives them (no AI service here: its own say why not). */
async function rowsOf(host: Awaited<ReturnType<typeof openedGame>>["host"], who: ReturnType<typeof identity>, game: bigint): Promise<string> {
  const report = JSON.parse(await host.report(who, game)) as GameReport;
  assert.ok("error" in report.ai, "this host has no AI service to ask");
  return JSON.stringify(report.rows);
}

test("a failed turn is restored failed, its job made again with the new game's key, and retry_turn carries it on", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("reply", http(400));
  assert.equal(host.as(wren).say({ text: "Who cut him down?" }), undefined);
  await host.drain();
  assert.equal(sceneNow(host, scene.id).turns[1]!.phase, "failed");

  const target = hostWithCampaign(9);
  const tam = identity(2);
  const uid = "restored-failed-turn";
  assert.equal(target.host.as(target.host.owner).restoreGame({ rows: await rowsOf(host, wren, scene.gameId), identity: tam.toHexString(), uid }), undefined);

  const game = all(target.host.db.game).find(g => g.uid === uid)!;
  const restored = all(target.host.db.scene).find(s => s.gameId === game.id)!;
  const turn = sceneNow(target.host, restored.id).turns[1]!;
  assert.deepEqual([turn.phase, restored.turnId], ["failed", turn.id], "the failed turn holds the scene's lease, as it did");
  const job = all(target.host.db.job).find(j => j.turnId === turn.id)!;
  assert.deepEqual([job.state, job.key], ["failed", `${uid}:s${restored.id}:t1:reply`]);
  assert.match(job.request, new RegExp(`"id":"${uid}"`), "its request is the new game's");

  assert.equal(target.host.as(tam).retryTurn({ turn: turn.id }), undefined);
  await target.host.drain();
  assert.equal(sceneNow(target.host, restored.id).turns[1]!.phase, "done");
});

test("a turn under way is restored with its job queued again: it thinks again there, and finishes", async () => {
  const { host, script, wren, scene } = await openedGame();
  const reply = held<unknown>();
  script.then("reply", () => reply.promise);
  assert.equal(host.as(wren).say({ text: "Who found him?" }), undefined);
  const draining = host.drain();
  await tick();
  assert.equal(sceneNow(host, scene.id).turns[1]!.phase, "replying", "the reply is in flight as it's reported");
  const rows = await rowsOf(host, wren, scene.gameId);
  reply.settle({ entries: [{ speaker: "gm", kind: "narration", text: "Late." }], gm: {}, firstTextMs: 1, usage: { calls: 1, costUsd: 0, byOperation: {} } });
  await draining;

  const target = hostWithCampaign(9);
  const tam = identity(2);
  assert.equal(target.host.as(target.host.owner).restoreGame({ rows, identity: tam.toHexString(), uid: "restored-mid-turn" }), undefined);
  const game = all(target.host.db.game).find(g => g.uid === "restored-mid-turn")!;
  const restored = all(target.host.db.scene).find(s => s.gameId === game.id)!;
  assert.deepEqual(all(target.host.db.job).filter(j => j.gameId === game.id).map(j => [j.step, j.state]), [["reply", "queued"]]);

  await target.host.drain();
  const now = sceneNow(target.host, restored.id);
  assert.equal(now.turns[1]!.phase, "done");
  assert.ok(target.script.to("reply").some(s => s.key === `restored-mid-turn:s${restored.id}:t1:reply`), "asked again, by the new game's key");
});
