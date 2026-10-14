import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoiceQuestion, Decider } from "../llm/decide.ts";
import { JevDecider } from "../llm/decide.ts";
import { sceneById } from "../../scenes/index.ts";
import { effectiveScene } from "./brief.ts";
import { decideBefore, type RulesOptions } from "./director.ts";
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
