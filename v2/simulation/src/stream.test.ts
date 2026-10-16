import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReplyRequest } from "../../shared/protocol/ai.ts";
import { all, DEFAULTS, openedGame, sceneNow } from "./host/testing.ts";

/** stream_reply's rules (v0-design §3.3, §5.8): the AI service only; while the turn replies; each post after the draft's. */

const post = (turnId: bigint, attempt: number, seq: number, text: string, done = false) => ({ turnId, attempt, seq, speaker: "gm", text, done });

test("only the AI service may post; anyone else is refused, and nothing is written", async () => {
  const { host, script, wren } = await openedGame();
  let refused: unknown;
  script.then("reply", (request: ReplyRequest) => {
    refused = host.streamReply(post(BigInt(request.stream.turn), 1, 1, "Kell"), wren);
    return DEFAULTS.reply;
  });
  host.as(wren).say({ text: "Who found him?" });
  await host.drain();

  assert.deepEqual(refused, { code: "not_service", text: "Only the AI service may do that." });
  assert.equal(all(host.db.replyDraft).length, 0);
  assert.equal(script.to("reply").length, 1);
});

test("the draft grows post by post; a stale post is dropped; a new attempt starts it again; the reply's commit ends it", async () => {
  const { host, script, wren, scene } = await openedGame();
  const drafts: unknown[] = [];
  const draft = (turnId: bigint) => {
    const d = host.db.replyDraft.turnId.find(turnId);
    drafts.push(d ? [d.attempt, d.seq, d.text, d.done] : undefined);
  };
  script.then("reply", (request: ReplyRequest) => {
    const turnId = BigInt(request.stream.turn);
    for (const [p, check] of [
      [post(turnId, 1, 1, "Kell"), true], [post(turnId, 1, 2, "Kell looks"), true], [post(turnId, 1, 2, "Kell lo"), true], [post(turnId, 1, 1, "K"), true],
      [post(turnId, 2, 1, "Sergeant"), true], [post(turnId, 1, 9, "Kell looks up at last"), true], [post(turnId, 2, 2, "Sergeant Kell nods.", true), true],
    ] as const) {
      assert.equal(host.streamReply(p), undefined, "a stale post isn't refused: it's dropped");
      if (check) draft(turnId);
    }
    return { entries: [{ speaker: "gm", kind: "narration", text: "Sergeant Kell nods." }], gm: { repeated: null }, firstTextMs: 2, usage: { calls: 1, costUsd: 0, byOperation: {} } };
  });
  host.as(wren).say({ text: "Who found him?" });
  await host.drain();

  assert.deepEqual(drafts, [
    [1, 1, "Kell", false], [1, 2, "Kell looks", false], [1, 2, "Kell looks", false], [1, 2, "Kell looks", false],
    [2, 1, "Sergeant", false], [2, 1, "Sergeant", false], [2, 2, "Sergeant Kell nods.", true],
  ]);
  const turn = sceneNow(host, scene.id).turns[1]!;
  assert.ok(turn.firstTextAt, "the first post's time kept");
  assert.equal(all(host.db.replyDraft).length, 0, "the commit deleted the draft");

  assert.equal(host.streamReply(post(turn.id, 3, 1, "late")), undefined);
  assert.equal(all(host.db.replyDraft).length, 0, "a post once the turn has moved on is dropped");
});

test("a post for a turn that isn't replying is dropped: deciding, or no such turn", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("decide", () => {
    const turn = sceneNow(host, scene.id).turns[1]!;
    assert.equal(turn.phase, "deciding");
    host.streamReply(post(turn.id, 1, 1, "too early"));
    host.streamReply(post(9999n, 1, 1, "nobody's"));
    assert.equal(all(host.db.replyDraft).length, 0);
    assert.equal(sceneNow(host, scene.id).turns[1]!.firstTextAt, undefined);
    return { decision: { earned: false, daft: false, outOfCharacter: false }, opened: [], usage: { calls: 0, costUsd: 0, byOperation: {} } };
  });
  host.as(wren).say({ text: "Who found him?" });
  await host.drain();
  assert.equal(script.to("decide").length, 1);
});
