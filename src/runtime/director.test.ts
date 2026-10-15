import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoiceQuestion, Decider } from "../llm/decide.ts";
import { JevDecider } from "../llm/decide.ts";
import { sceneById } from "../../scenes/index.ts";
import { effectiveScene } from "./brief.ts";
import { decideBefore, pressureReason, type RulesOptions } from "./director.ts";
import { checkedWhen } from "./repair.ts";
import type { SessionState } from "./session.ts";

/** A decider that answers from a script (choice, its probability, the others'), and keeps what it was asked. */
function scripted(picks: Record<string, [string, number, Record<string, number>?]>): Decider & { asked: Array<Record<string, ChoiceQuestion>> } {
  const asked: Array<Record<string, ChoiceQuestion>> = [];
  const quiet = ["none", "not_yet", "in_character", "covered", "not_now", "no", "not_theirs", "other"];
  return {
    name: "scripted", asked,
    async decide(_state, questions) {
      asked.push(questions);
      const answers = Object.fromEntries(Object.entries(questions).map(([id, q]) => {
        const keys = Object.keys(q.criteria);
        const [choice, p, others] = picks[id] && keys.includes(picks[id][0]) ? picks[id] : [keys.find(k => quiet.includes(k)) ?? keys.at(-1)!, 1];
        return [id, { choice, probabilities: { ...others, [choice]: p } }];
      }));
      return { answers, latencyMs: 0, costUsd: 0, decider: "scripted" };
    },
  };
}

/** The granary yard at its start: Prout still hanging, the body's Medicine route open. */
function yard(): SessionState {
  return {
    id: "director-test", sceneId: "hanged-clerk", approach: "v2", seed: 7, rollCount: 0,
    player: { name: "Kren Brook", concept: "a jaded ex-soldier", modifiers: { medicine: 1, athletics: 5 } },
    turn: 3, beat: "yard", turnsInBeat: 2, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [],
  };
}

const scene = effectiveScene(sceneById("hanged-clerk"), []);
const rules: RulesOptions = { spells: [], weapons: [{ id: "javelin", name: "Javelin" }], things: [{ id: "hoist-rope", name: "the hoist rope" }] };
const THROW = "(I throw my javelin at the rope above the corpse to get the body down)";

test("a route's roll waits while the rules resolve the player's act", async () => {
  const decider = scripted({ attempt: ["examine-body", 0.9], mechanic: ["attack", 0.9], target: ["hoist-rope", 0.95], weapon: ["javelin", 1], also: ["no", 0.9] });
  const pre = await decideBefore(decider, scene, yard(), THROW, { speaker: false, freeform: true, rules });
  assert.equal(pre.move, undefined, "no Medicine roll for a javelin throw");
  assert.deepEqual(pre.mechanic, { kind: "attack", target: "hoist-rope", weapon: "javelin" });
  // Asked alongside the attack's details, in the call those turns make anyway.
  assert.equal(decider.asked.length, 2);
  assert.match(decider.asked[1]!.also!.instructions, /Medicine check is for \(to tell how Prout really died\)/);
});

test("the route still rolls when the player is doing its act too", async () => {
  const decider = scripted({ attempt: ["examine-body", 0.9], mechanic: ["attack", 0.9], target: ["hoist-rope", 0.95], weapon: ["javelin", 1], also: ["yes", 0.9] });
  const pre = await decideBefore(decider, scene, yard(), THROW, { speaker: false, freeform: true, rules });
  assert.equal(pre.move?.transition.id, "examine-body");
  assert.equal(pre.move?.roll?.skill, "medicine");
  assert.equal(pre.mechanic?.kind, "attack");
});

test("without an act for the rules, a route's roll is as it was", async () => {
  const decider = scripted({ attempt: ["examine-body", 0.9] });
  const pre = await decideBefore(decider, scene, yard(), "(I get right up to Prout and examine his neck and hands)", { speaker: false, freeform: true, rules });
  assert.equal(pre.move?.roll?.skill, "medicine");
  assert.equal(pre.mechanic, undefined);
  assert.equal(decider.asked.length, 1, "no second call");
});

test("no freeform check rides along with an attack the rules roll", async () => {
  const decider = scripted({ attempt: ["other_risky", 0.9], mechanic: ["attack", 0.9], target: ["hoist-rope", 0.95], weapon: ["javelin", 1] });
  const pre = await decideBefore(decider, scene, yard(), THROW, { speaker: false, freeform: true, rules });
  assert.equal(pre.freeform, undefined);
  assert.equal(pre.mechanic?.kind, "attack");
  assert.equal(decider.asked.length, 2, "the attack's details, and no freeform call");
});

test("a check route is put to the decider as the act its roll is for", async () => {
  const decider = scripted({});
  await decideBefore(decider, scene, yard(), "\"Morning, Sergeant.\"", { speaker: false, freeform: true });
  assert.match(decider.asked[0]!.attempt!.criteria["examine-body"]!, /The Medicine check is to tell how Prout really died: only when the player is doing that now, not something that comes first\.\)$/);
});

test("two routes for the same check share the read between them", async () => {
  // The co-GM's route beside the authored one: the same Medicine roll, the read split across both.
  const twice = effectiveScene(sceneById("hanged-clerk"), [{ turn: 2, why: "test", transition: { beat: "yard", transition: {
    id: "improv-2-0", when: "Kren examines the body up close.", on: "attempt",
    check: { skill: "medicine", dc: 12, reason: "to read the marks on the body", success: "They read them.", failure: "They can't.", onSuccess: "yard" },
  } } }]);
  const examine = "(I get right up to Prout and examine his neck and hands)";
  const split = await decideBefore(scripted({ attempt: ["improv-2-0", 0.55, { "examine-body": 0.4, none: 0.05 }] }), twice, yard(), examine, { speaker: false, freeform: true });
  assert.equal(split.move?.transition.id, "improv-2-0");
  assert.equal(split.move?.roll?.skill, "medicine");
  // A different check doesn't count towards it.
  const other = await decideBefore(scripted({ attempt: ["improv-2-0", 0.55, { "win-cob": 0.4, none: 0.05 }] }), twice, yard(), examine, { speaker: false, freeform: true });
  assert.equal(other.move, undefined);
});

test("a co-GM route whose roll is about getting there is restated as the act", () => {
  assert.equal(checkedWhen("Kren gets Prout down or otherwise close enough to examine his neck, head, or hands.", "to examine Prout for signs he was killed before he was hanged"),
    "The player tries to examine Prout for signs he was killed before he was hanged.");
  assert.equal(checkedWhen("The player cuts the rope so Kell can look at the body.", "to read the marks on the body."), "The player tries to read the marks on the body.");
  // The act itself stands as written; with no reason to restate it from, it goes.
  const act = "Kren examines Prout's neck, head or hands up close, where reading the marks takes some skill.";
  assert.equal(checkedWhen(act, "to tell how Prout died"), act);
  assert.equal(checkedWhen("Kren climbs close enough to examine the body.", undefined), undefined);
});

test("a question with one option is answered without asking", async () => {
  // Offline: the Decisions API wants two choices or more, so a lone class feature never reaches it.
  const decision = await new JevDecider().decide({}, { feature: { instructions: "Which feature?", criteria: { "second-wind": "Second Wind" } } }, "test.single");
  assert.deepEqual(decision.answers.feature, { choice: "second-wind", probabilities: { "second-wind": 1 } });
  assert.equal(decision.costUsd, 0);
});

test("an act chosen already (the map's menu) is the turn's: the decider isn't asked what it is, and nothing else rolls for it", async () => {
  const decider = scripted({ attempt: ["other_risky", 0.95] });
  const forced = { kind: "cast" as const, spell: "fire-bolt", targets: ["hoist-rope"] };
  const withBolt: RulesOptions = { ...rules, spells: [{ id: "fire-bolt", name: "Fire Bolt", level: 0 }] };
  const pre = await decideBefore(decider, scene, yard(), "(I cast Fire Bolt at the hoist rope)", { speaker: false, freeform: true, rules: withBolt, forced });
  assert.deepEqual(pre.mechanic, forced);
  assert.equal(decider.asked.length, 1, "one call: no details to ask for");
  assert.equal(decider.asked[0]!.mechanic, undefined, "not asked what the rules resolve");
  assert.equal(pre.freeform, undefined, "the act is its own resolution: no freeform roll on top");
  // A route's check for the same turn waits for a turn of its own.
  const held = await decideBefore(scripted({ attempt: ["examine-body", 0.9] }), scene, yard(), "(I cast Fire Bolt at the hoist rope)", { speaker: false, freeform: true, rules: withBolt, forced });
  assert.equal(held.move, undefined);
  assert.deepEqual(held.mechanic, forced);
});

test("a pressure roll's dice line names its target as the player knows them, until they've heard the name", () => {
  const scene = sceneById("zoo-card-sharp");
  const check = { target: "sal", skill: "persuasion" as const, stakes: "sore", approach: "none", disposition: "neutral", ruling: "roll" as const };
  assert.match(pressureReason(scene, check, { sal: "the woman with the silver dice" }), /the woman with the silver dice/);
  assert.doesNotMatch(pressureReason(scene, check, { sal: "the woman with the silver dice" }), /Sal/);
  assert.match(pressureReason(scene, check), /Silver Sal Mordaunt/);
});

// Considered rolls' flag: asked in the decision the turn makes anyway.
const LINING = "*crouches by Cob* Take the left boot off yourself and feel along the lining with your own fingers. Your boot, your hands. Will you do that for him?";
const considered = { speaker: false, considered: true, offGraph: true };

test("considered rolls: the flag rides in the turn's one decision, and nothing is rolled for it there", async () => {
  const decider = scripted({ roll_call: ["new", 0.75, { route: 0.2, none: 0.05 }], attempt: ["win-cob", 0.43, { none: 0.45 }] });
  const pre = await decideBefore(decider, scene, yard(), LINING, considered);
  assert.equal(decider.asked.length, 1, "no call of its own");
  assert.ok(pre.considered, "flagged for the GM's review");
  assert.equal(pre.move, undefined, "no route's roll");
  assert.equal(pre.considered.probability, 0.95, "a route's yes and none's count together");
  assert.deepEqual(pre.considered.routes.map(r => r.id), ["win-cob"], "the review is told what the decider leant towards");
  // The question names each route's roll by what it's for, so a different payoff reads as another act.
  const call = decider.asked[0]!.roll_call!;
  assert.deepEqual(Object.keys(call.criteria), ["route", "new", "none"]);
  assert.match(call.criteria.route!, /\[win-cob\] Persuasion to get Cob to trust you with what he heard/);
  assert.match(call.criteria.route!, /\[examine-body\] Medicine to tell how Prout really died/);
});

test("considered rolls: a route's roll the decider chose goes ahead when it's what the route is for, and waits when it's another act", async () => {
  const same = await decideBefore(scripted({ roll_call: ["route", 0.8, { new: 0.15 }], attempt: ["win-cob", 0.7] }), scene, yard(), LINING, considered);
  assert.equal(same.considered, undefined);
  assert.equal(same.move?.transition.id, "win-cob");
  assert.equal(same.move?.roll?.skill, "persuasion");
  // The decider matched the route, but called the act another's: the GM rules on it instead of the route's payoff.
  const other = await decideBefore(scripted({ roll_call: ["new", 0.7, { route: 0.25 }], attempt: ["win-cob", 0.7] }), scene, yard(), LINING, considered);
  assert.equal(other.move, undefined);
  assert.ok(other.considered);
});

test("considered rolls: no flag for ordinary talk, an unsure read, a payoff already earned, the rules' own act, the impossible, or out of character", async () => {
  const flag = async (picks: Parameters<typeof scripted>[0], options: Partial<Parameters<typeof decideBefore>[4]> = {}) =>
    (await decideBefore(scripted(picks), scene, yard(), LINING, { ...considered, ...options })).considered;
  assert.equal(await flag({}), undefined, "no roll called for");
  assert.equal(await flag({ roll_call: ["new", 0.62, { none: 0.38 }] }), undefined, "a small ask reads under the bar");
  assert.equal(await flag({ roll_call: ["new", 0.8], earned: ["earned", 0.7] }), undefined, "they've met the terms: it lands");
  assert.equal(await flag({ roll_call: ["new", 0.9], mechanic: ["attack", 0.9], target: ["hoist-rope", 0.95], weapon: ["javelin", 1] }, { rules }), undefined, "the rules settle a blow");
  assert.equal(await flag({ roll_call: ["new", 0.9], limit: ["limit_3", 0.8] }), undefined, "the scene can't offer it");
  assert.equal(await flag({ roll_call: ["new", 0.9], ooc: ["out_of_character", 0.9] }), undefined);
  assert.ok(await flag({ roll_call: ["new", 0.8], earned: ["earned", 0.5, { not_yet: 0.5 }] }), "half earned still goes to the GM (who's told so)");
});

test("considered rolls: off, nothing is asked; on, a forgery isn't the real thing the scene can't offer", async () => {
  const off = scripted({});
  await decideBefore(off, scene, yard(), LINING, { speaker: false, freeform: true });
  assert.equal(off.asked[0]!.roll_call, undefined);
  assert.doesNotMatch(off.asked[0]!.limit!.instructions, /forgery/);
  const on = scripted({});
  await decideBefore(on, scene, yard(), LINING, considered);
  assert.match(on.asked[0]!.limit!.instructions, /a fake, a forgery, a bluff or a lie about one of these is something the player is attempting/);
  assert.equal(on.asked[0]!.attempt!.criteria.other_risky, undefined, "the flag stands in for the freeform roll's option");
});
