import { test } from "node:test";
import assert from "node:assert/strict";
import type { RememberRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
import { keyParts } from "../../../shared/protocol/keys.ts";
import { all, openedGame, sceneNow } from "../host/testing.ts";

/**
 * The jobs after a turn, on the memory host (full-gm-design §4.2): the memory reviews after every
 * player turn, with the scene as the turn left it. (The co-GM's reviews after a turn went with the
 * old pipeline: the two-part GM's co-GM runs in the settle.)
 */

const none = { calls: 0, costUsd: 0, byOperation: {} };
const settled = (moves: NonNullable<SettleResponse["coGm"]>["moves"] = []): SettleResponse => ({ ops: [], coGm: { roles: {}, moves, log: [] }, usage: none });

async function game() {
  const opened = await openedGame();
  const line = async (text: string) => {
    assert.equal(opened.host.as(opened.wren).say({ text }), undefined, `"${text}" was refused`);
    await opened.host.drain();
    return sceneNow(opened.host, opened.scene.id);
  };
  return { ...opened, line };
}

test("the memory reviews go over every player turn, not the opening, with the scene as the turn left it: a line said meanwhile isn't in it", async () => {
  const { host, script, wren, line } = await game();
  assert.equal(script.to("remember").length, 0, "nothing after the opening");
  script.then("settle", () => {
    assert.equal(host.as(wren).say({ text: "And who found him?" }), undefined);
    return settled();
  });

  await line("Morning, Sergeant.");

  const asked = script.to("remember").map(s => s.body as RememberRequest);
  assert.deepEqual(asked.map(r => [keyParts(r.key)?.step, r.reviewed, r.turn.scene.turn]), [["remember", 1, 1], ["remember", 2, 2]]);
  assert.deepEqual(asked[0]!.turn.transcript.map(e => [e.turn, e.kind]), [[0, "narration"], [1, "player"], [1, "narration"]], "turn 2's line, said as turn 1 settled, isn't in turn 1's review");
  assert.equal("line" in asked[0]!.turn, false);
  assert.deepEqual(all(host.db.job), [], "done with, and nothing on the turns");
});

test("the closing's turn is remembered too", async () => {
  const { script, line } = await game();
  script.then("settle", settled([{ route: "make-case", outcome: "none", why: "The case is made." }]));
  const closing = await line("I'll take the page to the King myself.");
  assert.equal(closing.scene.status, "closing");

  const ended = await line("Thank you, Sergeant.");
  assert.equal(ended.scene.status, "ended");
  assert.deepEqual(script.to("remember").map(s => (s.body as RememberRequest).reviewed), [1, 2]);
});
