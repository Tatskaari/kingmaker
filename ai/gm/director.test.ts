// Copied from the prototype's src/runtime/director.test.ts at 44c6d4a: of its cases, the rules' (:40-75, the rules' own act from :194-204, :423-440), against what's parked for combat of them (the mechanic question and the act's details call: mechanicOf), the freeform roll's and the map menu's (forced) left out, and the threat's reading after a reply (new, parked for combat too). Its cases of the turn's one decision (a route's act, two routes for one check, the same push again, cues, the bill, an ending on the brink) and of the read after the reply went with the old pipeline's decide and settle (docs/migration-log.md, M2's "The old pipeline's salvage").
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoiceQuestion, Decider } from "../llm/decide.ts";
import { JevDecider } from "../llm/decide.ts";
import { mechanicOf, mechanicQuestion, readThreat, threatQuestions } from "./director.ts";
import { hangedClerk, viewAt } from "./fixtures.ts";
import { alsoQuestion, meansQuestion, namedThing, type RulesOptions } from "./mechanics.ts";
import type { TurnView } from "./view.ts";

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
const scene = hangedClerk();
const yard = (): TurnView => viewAt(scene, "yard", { turn: 3, player: { name: "Kren Brook", concept: "a jaded ex-soldier", modifiers: { medicine: 1, athletics: 5 } } });

test("a question with one option is answered without asking", async () => {
  // Offline: the Decisions API wants two choices or more, so a lone class feature never reaches it.
  const decision = await new JevDecider().decide({}, { feature: { instructions: "Which feature?", criteria: { "second-wind": "Second Wind" } } }, "test.single");
  assert.deepEqual(decision.answers.feature, { choice: "second-wind", probabilities: { "second-wind": 1 } });
  assert.equal(decision.costUsd, 0);
});

// ---------------------------------------------------------------------------------------------
// Parked for combat (world-bridge-design §2.2): what the rules resolve of the player's line, the
// mechanic question in a call of its own, then the act's details in a second small call (mechanicOf).

const rules: RulesOptions = { spells: [], weapons: [{ id: "javelin", name: "Javelin" }], things: [{ id: "hoist-rope", name: "the hoist rope" }] };
const THROW = "(I throw my javelin at the rope above the corpse to get the body down)";

test("parked for combat: what the rules resolve of a line, the question then the act's details; a rest needs none, and an unsure read is nothing", async () => {
  const decider = scripted({ mechanic: ["attack", 0.9], target: ["hoist-rope", 0.95], weapon: ["javelin", 1] });
  const thrown = await mechanicOf(decider, scene, yard(), THROW, rules);
  assert.deepEqual(thrown.mechanic, { kind: "attack", target: "hoist-rope", weapon: "javelin" });
  assert.equal(decider.asked.length, 2, "the question, then the act's details");
  assert.deepEqual(Object.keys(decider.asked[0]!), ["mechanic"]);
  const rest = scripted({ mechanic: ["short_rest", 0.8] });
  assert.deepEqual((await mechanicOf(rest, scene, yard(), "We sit down for an hour.", rules)).mechanic, { kind: "rest", length: "short" });
  assert.equal(rest.asked.length, 1, "no details for a rest");
  assert.equal((await mechanicOf(scripted({ mechanic: ["attack", 0.55] }), scene, yard(), THROW, rules)).mechanic, undefined, "an unsure read");
  assert.equal((await mechanicOf(scripted({}), scene, yard(), "\"Morning, Sergeant.\"", rules)).mechanic, undefined, "none of them");
  // A class feature is offered only to a character who has one.
  assert.equal(mechanicQuestion(rules).criteria.feature, undefined);
  assert.match(mechanicQuestion({ ...rules, features: [{ id: "second-wind", name: "Second Wind", target: "self" }] }).criteria.feature!, /Second Wind/);
});

test("parked for combat: a route's check the act would hold back, and the act that's only the means to something risky, ride along in the details call", async () => {
  const decider = scripted({ mechanic: ["attack", 0.9], target: ["hoist-rope", 0.95], weapon: ["javelin", 1], also: ["yes", 0.9], means_only: ["no", 0.8] });
  const route = scene.beats.find(b => b.id === "yard")!.transitions.find(t => t.id === "examine-body")!;
  const { mechanic, details } = await mechanicOf(decider, scene, yard(), THROW, rules, { also: alsoQuestion(route, "attack"), means_only: meansQuestion("attack") });
  assert.equal(mechanic?.kind, "attack");
  assert.match(decider.asked[1]!.also!.instructions, /Medicine check is for \(to tell how Prout really died\)/);
  assert.ok(decider.asked[1]!.means_only);
  assert.equal(decider.asked[0]!.also, undefined, "not in the question's own call");
  assert.deepEqual([details?.answers.also?.choice, details?.answers.means_only?.choice], ["yes", "no"]);
});

test("a spell's aim on a weak read is what the player named, a doubtful second target is dropped, and an aim nobody can make out is asked (wizard#17)", async () => {
  const doors = [{ id: "loft-door", name: "the loft door" }, { id: "yard-doors", name: "the yard doors" }, { id: "tally-desk", name: "the tally desk" }, { id: "smashed-lantern", name: "a smashed lantern" }];
  assert.equal(namedThing(doors, "*I aim a Fire Bolt at the padlocked yard doors' hasp*"), "yard-doors");
  assert.equal(namedThing(doors, "the Mage Hand goes through the slot to the chained tally book"), "tally-desk");
  assert.equal(namedThing(doors, "I fling it at the door"), undefined, "a tie names nothing");
  const spells: RulesOptions = { spells: [{ id: "fire-bolt", name: "Fire Bolt", level: 0 }, { id: "magic-missile", name: "Magic Missile", level: 1 }], weapons: [], things: doors };
  const cast = async (said: string, picks: Parameters<typeof scripted>[0]) => (await mechanicOf(scripted({ mechanic: ["cast", 0.95], ...picks }), scene, yard(), said, spells)).mechanic;
  // As played: the loft door at .44 against the yard doors at .14, for the yard doors' hasp.
  assert.deepEqual(await cast("*I aim a Fire Bolt at the padlocked yard doors' hasp*", { spell: ["fire-bolt", 0.99], aim_thing: ["loft-door", 0.44, { "yard-doors": 0.14 }] }), { kind: "cast", spell: "fire-bolt", targets: ["yard-doors"] });
  // A sure read stands.
  assert.deepEqual(await cast("*Fire Bolt at the loft door*", { spell: ["fire-bolt", 0.99], aim_thing: ["loft-door", 0.9] }), { kind: "cast", spell: "fire-bolt", targets: ["loft-door"] });
  // Nothing named, and no clear lead: asked.
  assert.deepEqual(await cast("*I hurl a Fire Bolt up there*", { spell: ["fire-bolt", 0.99], aim_thing: ["loft-door", 0.29, { "yard-doors": 0.25 }] }), { kind: "cast", spell: "fire-bolt", targets: [], unclear: true });
  // Magic Missile into the boy (.99), and Kell at .56 is dropped.
  assert.deepEqual(await cast("*Magic Missile straight into the boy*", { spell: ["magic-missile", 0.9], aim_cob: ["yes", 0.99], aim_kell: ["yes", 0.56] }), { kind: "cast", spell: "magic-missile", targets: ["cob"] });
});

test("parked for combat: a blow or a danger a reply left hanging over the player, on a clear read, with the question's raw choice", async () => {
  const present = scene.cast.filter(c => ["kell", "cob", "moll"].includes(c.id));
  const questions = threatQuestions(present);
  assert.deepEqual(Object.keys(questions.threat!.criteria).filter(k => k.startsWith("attack:")), ["attack:kell", "attack:cob", "attack:moll"], "whoever's here");
  assert.ok(questions.threat!.criteria["hazard:grab_or_shove"]);
  assert.ok(questions.threat_severity);
  const read = async (picks: Parameters<typeof scripted>[0]) => readThreat(await scripted(picks).decide({}, questions, "director.after"), present);
  const blow = await read({ threat: ["attack:kell", 0.8] });
  assert.deepEqual([blow.threat, blow.threatRead], [{ kind: "attack", by: "kell" }, "attack:kell"]);
  const fire = await read({ threat: ["hazard:fire", 0.7], threat_severity: ["serious", 0.9] });
  assert.deepEqual(fire.threat, { kind: "hazard", hazard: "fire", severity: "serious" });
  // An unsure read leaves nothing hanging, though the hold it names still counts for letting go of one (threats.ts holdAfterReply).
  const unsure = await read({ threat: ["hazard:grab_or_shove", 0.5] });
  assert.deepEqual([unsure.threat, unsure.threatRead], [undefined, "hazard:grab_or_shove"]);
  assert.equal((await read({})).threatRead, "none");
  // Someone not here can't be the one striking.
  assert.equal((await read({ threat: ["attack:tull", 0.9] })).threat, undefined);
});
