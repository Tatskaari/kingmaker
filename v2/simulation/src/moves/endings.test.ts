import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRoll, rollFrom } from "../../../shared/dice.ts";
import type { After, Decision, DecideResponse, ReplyRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
import { all, openedGame, sceneNow } from "../host/testing.ts";

/**
 * The GM's bookkeeping as the commits run it (gm-port §6, §9, §10), on the memory host with the AI
 * service's decisions scripted: routes and cues move the beats, endings are held for the player's
 * answer, wound down, or closed, and the scene ends with its line.
 */

const none = { calls: 0, costUsd: 0, byOperation: {} };
const decided = (d: Partial<Decision> = {}): DecideResponse => ({ decision: { earned: false, daft: false, outOfCharacter: false, ...d }, opened: [], usage: none });
const read = (a: Partial<After> = {}): SettleResponse => ({ ops: [], after: { landed: [], hinted: [], unanswered: false, theirs: false, ...a }, usage: none });
/** The settle of a reply that closed the scene: the stage manager's ops only (the AI service skips the read after it). */
const closed: SettleResponse = { ops: [], usage: none };

async function game() {
  const opened = await openedGame();
  const line = async (text: string, decide: DecideResponse = decided(), settle?: SettleResponse) => {
    opened.script.then("decide", decide);
    if (settle) opened.script.then("settle", settle);
    assert.equal(opened.host.as(opened.wren).say({ text }), undefined, `"${text}" was refused`);
    await opened.host.drain();
    return sceneNow(opened.host, opened.scene.id);
  };
  return { ...opened, line };
}

test("an ending the player chose, with nothing hanging, gets one wind-down turn, whose reply closes the scene", async () => {
  const { host, script, wren, line } = await game();

  const reached = await line("I'll take the page to the King myself.", decided(), read({ ending: { exitId: "case-made", probability: 0.9 }, theirs: true }));
  assert.deepEqual(reached.gm.closing, { exitId: "case-made", turn: 1 });
  assert.equal(reached.scene.status, "closing");
  assert.deepEqual(reached.gm.path.at(-1), { turn: 1, from: "yard", to: "case-made", via: "ending-reached", source: "post" });

  const ended = await line("Thank you, Sergeant.");
  const reply = script.to("reply").at(-1)!.body as ReplyRequest;
  assert.deepEqual(reply.outcome.windDown, { exit: "case-made" });
  assert.equal(script.to("settle").length, 1, "the wind-down has no settle");
  assert.deepEqual([ended.scene.status, ended.scene.exitKey, ended.scene.turnId], ["ended", "case-made", undefined]);
  assert.ok(ended.scene.endedAt);
  assert.equal(ended.gm.closing, undefined);
  assert.deepEqual(ended.lines.at(-1)!.text, "Scene ends: The case is made");
  assert.deepEqual([ended.lines.at(-1)!.speaker, ended.lines.at(-1)!.kind, ended.lines.at(-1)!.turn], ["system", "system", 2]);
  assert.deepEqual(ended.turns.map(t => t.phase), ["done", "done", "done"]);
  assert.equal(host.as(wren).say({ text: "One more thing…" })?.code, "scene_over");
});

test("a word out of character on the wind-down is answered and the ending still waits: the next turn in character closes it", async () => {
  const { line } = await game();
  await line("I'll take the page to the King myself.", decided(), read({ ending: { exitId: "case-made", probability: 0.9 }, theirs: true }));

  const asked = await line("(ooc: can I still look around?)", decided({ outOfCharacter: true }));
  assert.deepEqual([asked.scene.status, asked.gm.closing?.exitId, asked.gm.oocTurns], ["closing", "case-made", [2]]);

  const ended = await line("Let's go.");
  assert.equal(ended.scene.status, "ended");
});

test("an ending that isn't the player's doing waits for their answer; a turn that doesn't answer it closes the scene", async () => {
  const { script, line } = await game();

  const held = await line("Who found him?", decided(), read({ ending: { exitId: "closed-suicide", probability: 0.9 }, theirs: false }));
  assert.deepEqual(held.gm.pendingExit, { exitId: "closed-suicide", turn: 1, via: "ending-reached", extended: false, waits: "it isn't the player's own doing" });
  assert.equal(held.scene.status, "live");

  const ended = await line("Fine, sign it.", decided(), closed);
  const reply = script.to("reply").at(-1)!.body as ReplyRequest;
  assert.deepEqual([reply.outcome.held, reply.outcome.closes, reply.outcome.pending], ["closes", "closed-suicide", { exit: "closed-suicide" }]);
  assert.deepEqual(reply.turn.gm.ended, { exitId: "closed-suicide", turn: 2 });
  assert.equal(script.to("settle").length, 2, "the stage manager still settles the closing reply");
  assert.deepEqual([ended.scene.status, ended.lines.at(-1)!.text], ["ended", "Scene ends: Filed as a suicide"]);
});

test("a turn that answers a held ending holds it once more; answered again, it lands", async () => {
  const { line } = await game();
  await line("Who found him?", decided(), read({ ending: { exitId: "closed-suicide", probability: 0.9 } }));

  const brink = await line("Wait. Look at his hands first.", decided({ answering: true }));
  assert.deepEqual([brink.gm.pendingExit?.exitId, brink.gm.pendingExit?.extended, brink.gm.ended], ["closed-suicide", true, undefined]);
  assert.equal(brink.scene.status, "live");

  const ended = await line("And his boots!", decided({ answering: true }), closed);
  assert.equal(ended.scene.status, "ended");
});

test("a word out of character never closes a held ending, nor moves the scene's clock", async () => {
  const { line } = await game();
  const before = await line("Who found him?", decided(), read({ ending: { exitId: "closed-suicide", probability: 0.9 } }));

  const asked = await line("(ooc: what's a dead-cart?)", decided({ outOfCharacter: true }));
  assert.deepEqual(asked.gm.pendingExit, before.gm.pendingExit);
  assert.equal(asked.gm.turnsInBeat, before.gm.turnsInBeat, "out of character isn't an exchange");
  assert.deepEqual(asked.gm.oocTurns, [2]);
  assert.equal(asked.scene.status, "live");
});

test("a route the player chose into an ending closes the scene in this reply", async () => {
  const { line } = await game();
  const ended = await line("*I turn and walk out of the gate.*", decided({ route: { id: "walk-away", phase: "attempt" } }), closed);

  assert.deepEqual(ended.gm.path, [{ turn: 1, from: "yard", to: "walked-away", via: "walk-away", source: "pre", known: 0 }]);
  assert.equal(ended.gm.beat, "yard", "an exit isn't a beat");
  assert.deepEqual([ended.scene.status, ended.lines.at(-1)!.text], ["ended", "Scene ends: Walked away"]);
});

test("a cue brings the corporal on: he joins the world and the stage after the reply, and an ending found as he comes in waits", async () => {
  const { host, wren, scene, line } = await game();
  const now = await line("*I wait by the gate.*", decided({ route: { id: "cart-comes", phase: "cue" } }), read({ ending: { exitId: "closed-suicide", probability: 0.9 }, theirs: true }));

  assert.deepEqual([now.gm.beat, now.gm.turnsInBeat], ["dead-cart", 0]);
  const tull = [...host.db.entity.byGameKey.filter([scene.gameId, "tull"])][0]!;
  assert.deepEqual([tull.called, tull.createdTurn, tull.placeId], ["the corporal", 1, scene.placeId]);
  assert.equal(host.db.onStage.entityId.find(tull.id)?.role, "cast");
  assert.equal(host.db.look.entityId.find(tull.id)?.glyph, "T");
  assert.ok(host.view(wren).myNames().some(n => n.key === "tull" && n.name === "the corporal"));
  assert.ok([...host.db.worldLog.placeId.filter(scene.placeId)].some(l => l.text === "Corporal Abner Tull arrives" && l.round === 1));
  assert.equal(now.gm.pendingExit?.waits, "Corporal Abner Tull just came in");
});

test("a failed check into an ending the player didn't choose holds it for their answer", async () => {
  const { host, scene, line } = await game();
  await line("*I wait by the gate.*", decided({ route: { id: "cart-comes", phase: "cue" } }));
  const dice = host.db.dice.gameId.find(scene.gameId)!;
  const persuasion = (JSON.parse(all(host.db.sheet)[0]!.skills) as Record<string, number>).persuasion!;
  const roll = rollFrom(dice, "persuasion", 30, persuasion).roll;
  assert.notEqual(roll.die, 20, "this seed's next roll must fail at DC 30");

  const held = await line("Corporal, give me till noon.", decided({ route: { id: "persuade-tull", phase: "attempt", check: { skill: "persuasion", dc: 30 } } }));
  assert.deepEqual(held.gm.pendingExit, { exitId: "closed-suicide", turn: 2, via: "persuade-tull", extended: false });
  assert.deepEqual(held.gm.path.at(-1), { turn: 2, from: "dead-cart", to: "closed-suicide", via: "persuade-tull", source: "pre", roll, known: 0 });
  assert.equal(held.lines.find(l => l.kind === "roll")!.text, `Persuasion check to convince Tull to wait before taking Prout away: ${describeRoll(roll).replace(/^Persuasion check: /, "")}`);
});

test("an ending that leads twice running is reached, though neither read was sure of it", async () => {
  const { line } = await game();
  const once = await line("Who would want him dead?", decided(), read({ ending: { exitId: "open-case", probability: 0.4 }, theirs: true }));
  assert.deepEqual([once.gm.endingLead, once.gm.closing], [{ exitId: "open-case", count: 1, probability: 0.4 }, undefined]);

  const twice = await line("Then it's murder, by persons unknown.", decided(), read({ ending: { exitId: "open-case", probability: 0.4 }, theirs: true }));
  assert.deepEqual([twice.gm.endingLead, twice.gm.closing], [undefined, { exitId: "open-case", turn: 2 }]);
});

test("an outcome into the improvised ending gives way to the authored ending the AI service names", async () => {
  const { line } = await game();
  const own = await line("I'll settle this my own way.", decided(), read({ outcome: { route: "improvised-ending" }, theirs: true }));
  assert.deepEqual([own.gm.closing?.exitId, own.gm.path.at(-1)?.to], ["own-ending", "own-ending"]);

  const { line: again } = await game();
  const authored = await again("I'll settle this my own way.", decided(), read({ outcome: { route: "improvised-ending", exit: "case-made" } as After["outcome"], theirs: true }));
  assert.deepEqual([authored.gm.closing?.exitId, authored.gm.path.at(-1)?.to, authored.gm.path.at(-1)?.via], ["case-made", "case-made", "improvised-ending"]);
});

test("the same push again: no dice, and a step on the path that the reply is told of", async () => {
  const { host, script, scene, line } = await game();
  const now = await line("You were never up that wall, Moll!", decided({ sameAgain: { route: "catch-moll", answer: "Moll sticks to her story." } }));

  assert.deepEqual(now.gm.path, [{ turn: 1, from: "yard", to: "yard", via: "same-again:catch-moll", source: "pre" }]);
  assert.equal(host.db.dice.gameId.find(scene.gameId)!.rolls, 0);
  assert.equal(now.lines.filter(l => l.kind === "roll").length, 0);
  assert.deepEqual((script.to("reply")[0]!.body as ReplyRequest).decision.sameAgain, { route: "catch-moll", answer: "Moll sticks to her story." });
});

test("a decision naming a route that isn't open here moves nothing", async () => {
  const { host, line } = await game();
  const now = await line("I accuse the boy!", decided({ route: { id: "insist-cob", phase: "attempt" } }));

  assert.deepEqual([now.gm.beat, now.gm.path], ["yard", []]);
  assert.match(host.logs.join("\n"), /the decision's route insist-cob isn't open from yard: no move/);
  assert.equal(all(host.db.job).length, 0);
});
