import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRoll } from "../../../shared/dice.ts";
import type { Ruling, Verdict } from "../../../shared/gm/consider.ts";
import type { ConsiderRequest, ConsiderResponse, Decision, DecideResponse, ReplyRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
import { keyParts } from "../../../shared/protocol/keys.ts";
import type { Transition } from "../../../shared/scene/types.ts";
import { http, nextCheck, openedGame, sceneNow } from "../host/testing.ts";

/**
 * Considered rolls on the memory host (full-gm-design §4.2): a turn the GM rules on goes decide,
 * considering, consider, reply, settle; the ruling's route rolls from the game's dice like any
 * route's, with its dice line before the reply, its record and the ways of trying it shuts; with no
 * ruling, the plain check the AI service read rolls instead. The AI service is scripted.
 */

const none = { calls: 0, costUsd: 0, byOperation: {} };
const decided = (d: Partial<Decision> = {}): DecideResponse => ({ decision: { earned: false, daft: false, outOfCharacter: false, ...d }, opened: [], usage: none });
const read = { probability: 0.8, routes: [{ id: "coax-cob", p: 0.4 }], means: "sleight_of_hand" as const };

const ACT = "lift the folded paper out of the boy's boot";
const lift: Ruling = {
  act: ACT, target: "cob", skill: "sleight_of_hand", lie: false,
  judged: { stakes: "guarded", approach: "plausible", disposition: "wary", sameAgain: false, difficulty: "moderate" },
  reason: "to lift the paper from the boy's boot",
  success: { happens: "The paper comes free, and the boy never feels it go.", gets: "all", to: "motive", establishes: ["The investigator has the page from Cob's boot."], reveals: ["page"], closes: [] },
  failure: { happens: "Cob jerks his foot back and glares.", gets: "none", establishes: ["Cob caught the investigator reaching for his boot."], reveals: [], closes: ["coax-cob"] },
  costUsd: 0.0012, latencyMs: 4100,
};
/** The ruling's route as the AI service writes it (consider.ts rulingRoute), at a DC the dice can't make but on a 20. */
const DC = 30;
const verdict: Verdict = { kind: "roll", dc: DC, why: "guarded to lose, plausible cover, wary: they could notice" };
const route: Transition = {
  id: "considered-1", on: "attempt", when: `The player's attempt: ${ACT}.`,
  check: {
    skill: "sleight_of_hand", dc: DC, reason: lift.reason, success: "Decided, and it stands: the paper comes free.", failure: "Decided, and it stands: Cob jerks his foot back.",
    onSuccess: "motive", establishes: { success: lift.success.establishes, failure: lift.failure.establishes },
  },
};
const ruled: ConsiderResponse = { ruling: lift, verdict, route, ms: 4100, usage: { calls: 1, costUsd: 0.0012, byOperation: {} } };

test("a considered turn: decide, considering, consider, reply, settle; the ruling rolled from the game's dice, its dice line before the reply, its record, and the way of trying it shut", async () => {
  const { host, script, wren, scene, player } = await openedGame();
  const roll = nextCheck(host, player.id, "sleight_of_hand", DC);
  assert.notEqual(roll.die, 20, "this seed's next roll must fail at DC 30");
  const phases: string[] = [];
  const phaseNow = () => phases.push(sceneNow(host, scene.id).turns[1]!.phase);
  script.then("decide", () => { phaseNow(); return decided({ considered: read }); });
  script.then("consider", () => { phaseNow(); return ruled; });
  script.then("reply", () => { phaseNow(); return { entries: [{ speaker: "gm", kind: "narration", text: "The boy yanks his foot away." }], gm: { repeated: null }, firstTextMs: 3, usage: none }; });
  script.then("settle", () => { phaseNow(); return { ops: [], after: { landed: ["page", "not-suicide"], hinted: [], unanswered: false, theirs: false }, usage: none } satisfies SettleResponse; });

  assert.equal(host.as(wren).say({ text: "(I try to lift the folded paper out of the boy's boot while he watches the sergeant)" }), undefined);
  await host.drain();

  const now = sceneNow(host, scene.id);
  const dice = describeRoll(roll, lift.reason);
  assert.deepEqual(phases, ["deciding", "considering", "replying", "settling"]);
  assert.deepEqual(now.lines.slice(1).map(l => [l.turn, l.kind, l.text]), [
    [1, "player", "(I try to lift the folded paper out of the boy's boot while he watches the sergeant)"],
    [1, "roll", dice],
    [1, "narration", "The boy yanks his foot away."],
  ]);
  assert.match(dice, /^Sleight Of Hand check to lift the paper from the boy's boot: .* vs DC 30: failure$/);

  const consider = script.to("consider")[0]!.body as ConsiderRequest;
  assert.deepEqual([keyParts(consider.key)?.step, consider.read, consider.pending], ["consider", read, undefined]);
  const reply = script.to("reply")[0]!.body as ReplyRequest;
  assert.deepEqual(reply.outcome.ruled, { ruling: lift, verdict, route, went: "failure", roll, from: "yard", to: "yard", chosen: false });
  assert.deepEqual(reply.outcome.lines, [dice]);

  assert.deepEqual(now.gm.rulings, [{
    turn: 1, act: ACT, target: "cob", skill: "sleight_of_hand", kind: "roll", dc: DC, why: verdict.why, roll, went: "failure",
    changed: "Cob jerks his foot back and glares; closed: coax-cob", costUsd: 0.0012, latencyMs: 4100,
  }]);
  assert.deepEqual(now.gm.patches, [{ turn: 1, close: { beat: "yard", id: "coax-cob" }, why: `Closed by the ruling on: ${ACT}` }]);
  assert.deepEqual(now.gm.path, [{ turn: 1, from: "yard", to: "yard", via: "considered-1", source: "pre", roll, known: 0 }]);
  assert.deepEqual(now.gm.established, ["Cob caught the investigator reaching for his boot."]);
  assert.deepEqual(now.gm.landed, ["not-suicide"], "what the dice kept back (the page) doesn't land, whatever the reply let slip");
  assert.equal(now.turns[1]!.phase, "done");

  // The way of trying it shut is gone for the decide too.
  script.then("decide", decided({ route: { id: "coax-cob", phase: "attempt", check: { skill: "persuasion", dc: 12 } } }));
  host.as(wren).say({ text: "Come on, lad. Let me see that paper." });
  await host.drain();
  assert.match(host.logs.join("\n"), /turn 2\] the decision's route coax-cob isn't open from yard: no move/);
  assert.equal(script.to("consider").length, 1, "a turn the decide answered isn't ruled on");
});

test("no ruling (the review ran past its deadline): the plain check the AI service read is rolled instead, as a freeform step; no record", async () => {
  const { host, script, wren, scene, player } = await openedGame();
  const roll = nextCheck(host, player.id, "persuasion", 13);
  const reason = "to win the boy in the too-big boots over";
  script.then("decide", decided({ considered: read }));
  script.then("consider", { error: "the review took longer than 12000 ms", fallback: { skill: "persuasion", dc: 13, reason }, ms: 12000, usage: none } satisfies ConsiderResponse);

  host.as(wren).say({ text: "Lad, the paper. I'll see you right." });
  await host.drain();

  const now = sceneNow(host, scene.id);
  assert.deepEqual(now.lines.filter(l => l.kind === "roll").map(l => l.text), [describeRoll(roll, reason)]);
  assert.deepEqual(now.gm.path, [{ turn: 1, from: "yard", to: "yard", via: "freeform", source: "pre", roll }]);
  assert.deepEqual(now.gm.rulings, []);
  assert.equal(now.gm.offGraphTurn, undefined);
  const reply = script.to("reply")[0]!.body as ReplyRequest;
  assert.deepEqual([reply.outcome.freeform, reply.outcome.ruled], [{ skill: "persuasion", dc: 13, roll, reason }, undefined]);
});

test("a no without dice: nothing rolled, the plain refusal on the path and on record, by what the player would call them", async () => {
  const { host, script, wren, scene } = await openedGame();
  const rolls = host.db.dice.gameId.find(scene.gameId)!.rolls;
  const no: Verdict = { kind: "no", no: "refused", why: "it pulls a lever that can't move them (guarded, no chance, wary)" };
  const ask = { ...lift, skill: "persuasion" as const, act: "ask the boy for his boots" };
  script.then("decide", decided({ considered: read }));
  script.then("consider", { ruling: ask, verdict: no, route: { id: "considered-1", on: "attempt", when: "The player's attempt: ask the boy for his boots.", to: "yard" }, ms: 3000, usage: none } satisfies ConsiderResponse);

  host.as(wren).say({ text: "Give me those boots, boy." });
  await host.drain();

  const now = sceneNow(host, scene.id);
  assert.equal(host.db.dice.gameId.find(scene.gameId)!.rolls, rolls, "no roll");
  assert.equal(now.lines.filter(l => l.kind === "roll").length, 0);
  assert.deepEqual(now.gm.path, [{ turn: 1, from: "yard", to: "yard", via: "considered-1", source: "pre" }]);
  assert.deepEqual(now.gm.rulings.map(r => [r.kind, r.went, r.changed]), [["no", "failure", "The boy in the too-big boots said no, and nothing else changed"]]);
  assert.deepEqual(now.gm.patches, [], "a no without dice shuts nothing");
});

test("off the graph with nothing ruled, the co-GM reviews the turn; off the graph on a turn a route answered, no ruling is asked for", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("decide", decided({ offGraph: true }), decided({ offGraph: true, route: { id: "cart-comes", phase: "cue" } }));

  host.as(wren).say({ text: "Sergeant, what if we leave him up there and watch who comes back for those boots?" });
  await host.drain();
  const first = sceneNow(host, scene.id);
  assert.deepEqual([script.to("consider").length, first.gm.offGraphTurn, first.gm.rulings], [1, 1, []]);
  assert.deepEqual(script.to("repair").map(r => r.body.reviewed), [1], "the co-GM goes over the turn");

  host.as(wren).say({ text: "I'll wait in the loft." });
  await host.drain();
  const second = sceneNow(host, scene.id);
  assert.deepEqual([script.to("consider").length, second.gm.offGraphTurn, second.gm.beat], [1, 2, "dead-cart"]);
  assert.deepEqual(script.to("repair").map(r => r.body.reviewed), [1, 2]);
});

test("a consider step that fails fails the turn, and /retry asks again, considering", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("decide", decided({ considered: read }));
  script.then("consider", http(400), ruled);

  host.as(wren).say({ text: "(I try to lift the folded paper out of the boy's boot)" });
  await host.drain();
  const failed = sceneNow(host, scene.id).turns[1]!;
  assert.equal(failed.phase, "failed");

  assert.equal(host.as(wren).retryTurn({ turn: failed.id }), undefined);
  assert.equal(sceneNow(host, scene.id).turns[1]!.phase, "considering");
  await host.drain();
  const now = sceneNow(host, scene.id);
  assert.deepEqual([now.turns[1]!.phase, now.gm.rulings.length], ["done", 1]);
});
