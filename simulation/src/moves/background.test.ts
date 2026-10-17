import { test } from "node:test";
import assert from "node:assert/strict";
import type { RepairResult } from "../../../shared/gm/repair.ts";
import type { After, DecideRequest, Decision, DecideResponse, RememberRequest, RepairRequest, RepairResponse, SettleResponse } from "../../../shared/protocol/ai.ts";
import { keyParts } from "../../../shared/protocol/keys.ts";
import { all, onTrack, openedGame, sceneNow } from "../host/testing.ts";

/**
 * The jobs after a turn, on the memory host (full-gm-design §4.2): the memory reviews after every
 * player turn, and the co-GM when it's due, each with the scene as the turn left it; the co-GM's
 * answer waits in a co_gm_result row until the next turn's start merges it (a line said, or one
 * that waited), its notes steering two replies and its whispers one, its routes open to the decide.
 */

const none = { calls: 0, costUsd: 0, byOperation: {} };
const decided = (d: Partial<Decision> = {}): DecideResponse => ({ decision: { earned: false, daft: false, outOfCharacter: false, ...d }, opened: [], usage: none });
const read = (a: Partial<After> = {}): SettleResponse => ({ ops: [], after: { landed: [], hinted: [], unanswered: false, theirs: false, ...a }, usage: none });

const NOTE = "Bring the talk back to the boots on the body.";
const WHISPER = { to: "moll", note: "Moll wants to slip away before the dead-cart comes." };
const CANON = "The yard gate creaks on its one good hinge.";
/** The co-GM's review of a turn: a note, a whisper for Moll, a canon line, and a route from the yard to doubt (on attempt, no check). */
const steering = (request: RepairRequest): RepairResponse => {
  const n = request.reviewed;
  const review: RepairResult = {
    ...onTrack(n), status: "drifting", assessment: "The player is chatting about songs.", notes: NOTE, whispers: [WHISPER], canon: [CANON],
    patches: [{ turn: n, transition: { beat: "yard", transition: { id: `improv-${n}-0`, when: "The player sets a watch on the boots.", on: "attempt", to: "doubt" } }, why: "Let the stake-out count." }],
  };
  return { review, usage: { calls: 1, costUsd: 0.004, byOperation: {} } };
};

async function game() {
  const opened = await openedGame();
  const line = async (text: string, decide: DecideResponse = decided()) => {
    opened.script.then("decide", decide);
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
    return read();
  });

  await line("Morning, Sergeant.");

  const asked = script.to("remember").map(s => s.body as RememberRequest);
  assert.deepEqual(asked.map(r => [keyParts(r.key)?.step, r.reviewed, r.turn.scene.turn]), [["remember", 1, 1], ["remember", 2, 2]]);
  assert.deepEqual(asked[0]!.turn.transcript.map(e => [e.turn, e.kind]), [[0, "narration"], [1, "player"], [1, "narration"]], "turn 2's line, said as turn 1 settled, isn't in turn 1's review");
  assert.equal("line" in asked[0]!.turn, false);
  assert.deepEqual(all(host.db.job), [], "done with, and nothing on the turns");
  assert.deepEqual(script.to("repair"), [], "the co-GM isn't due");
});

test("the wind-down's turn is remembered too; a scene closing or over gets no co-GM", async () => {
  const { script, line } = await game();
  script.then("settle", read({ ending: { exitId: "case-made", probability: 0.9 }, theirs: true, status: "drifting" }));
  const closing = await line("I'll take the page to the King myself.");
  assert.equal(closing.scene.status, "closing");

  const ended = await line("Thank you, Sergeant.");
  assert.equal(ended.scene.status, "ended");
  assert.deepEqual(script.to("remember").map(s => (s.body as RememberRequest).reviewed), [1, 2]);
  assert.deepEqual(script.to("repair"), []);
});

test("the co-GM every third turn: its row waits, merged at the next turn's start, its route taken by that turn's decide; its whisper lapses after one reply, its notes after two", async () => {
  const { host, script, scene, line } = await game();
  script.then("repair", steering);

  await line("Who found him?");
  await line("When?");
  const third = await line("Where was the girl?");
  assert.deepEqual(script.to("repair").map(s => [keyParts(s.key)?.step, (s.body as RepairRequest).reviewed]), [["repair", 3]], "the backstop, every third turn");
  assert.deepEqual(all(host.db.coGmResult).map(r => [r.sceneId, r.turn, r.mergedTurn, r.note]), [[scene.id, 3, undefined, undefined]]);
  assert.deepEqual([third.gm.notes, third.gm.whispers, third.gm.canon, third.gm.patches, third.gm.lastRepairTurn], [null, [], [], [], undefined], "nothing merged mid-turn");

  const fourth = await line("I'll keep watch on those boots.", decided({ route: { id: "improv-3-0", phase: "attempt" } }));
  const at4 = (script.to("decide")[3]!.body as DecideRequest).turn.gm;
  assert.deepEqual([at4.notes, at4.notesTurn, at4.whispers, at4.canon, at4.lastRepairTurn], [NOTE, 3, [{ ...WHISPER, turn: 3 }], [CANON], 3], "merged before the decide was asked");
  assert.deepEqual(at4.patches.map(p => p.transition?.transition.id), ["improv-3-0"]);
  assert.deepEqual(all(host.db.coGmResult).map(r => [r.turn, r.mergedTurn]), [[3, 4]]);
  assert.deepEqual([fourth.gm.beat, fourth.gm.path.at(-1)], ["doubt", { turn: 4, from: "yard", to: "doubt", via: "improv-3-0", source: "pre", known: 0 }], "the co-GM's route, taken");

  await line("Kell?");
  const at5 = (script.to("decide")[4]!.body as DecideRequest).turn.gm;
  assert.deepEqual([at5.notes, at5.whispers], [NOTE, []], "the whisper has had its reply");
  await line("Moll?");
  const at6 = (script.to("decide")[5]!.body as DecideRequest).turn.gm;
  assert.deepEqual([at6.notes, at6.notesTurn], [null, null], "the notes have had their two");
  assert.deepEqual(script.to("repair").map(s => (s.body as RepairRequest).reviewed), [3, 6], "and the backstop again, three turns on");
});

test("a review that comes in while the next turn is in flight is merged when the turn after starts, a line that waited", async () => {
  const { host, script, wren, line } = await game();
  script.then("repair", steering);
  script.then("settle", () => {
    assert.equal(host.as(wren).say({ text: "And the girl?" }), undefined);
    return read({ status: "drifting" });
  }, () => {
    assert.equal(host.as(wren).say({ text: "And the boots?" }), undefined);
    return read();
  });

  const now = await line("Who found him?");

  assert.deepEqual(now.turns.map(t => [t.n, t.phase]), [[0, "done"], [1, "done"], [2, "done"], [3, "done"]]);
  assert.deepEqual(script.to("repair").map(s => (s.body as RepairRequest).reviewed), [1, 2, 3], "drifting, so after every turn");
  const decides = script.to("decide").map(s => (s.body as DecideRequest).turn.gm);
  assert.deepEqual(decides.map(gm => gm.notesTurn), [null, null, 1], "turn 2 started before turn 1's review came; turn 3, a line that waited, merged it");
  assert.deepEqual(decides[2]!.whispers, [], "its whisper had already had its turn");
  assert.deepEqual(all(host.db.coGmResult).map(r => [r.turn, r.mergedTurn]), [[1, 3], [2, undefined], [3, undefined]]);
});
