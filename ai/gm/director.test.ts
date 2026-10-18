// Copied from the prototype's src/runtime/director.test.ts at 44c6d4a: its cases V0 keeps (the hanged clerk's: a route's act, two routes for one check, the same push again, cues, the bill, an ending on the brink), against beforeQuestions and readBefore, with what the decision picks in place of what resolve rolled; and with the world bridge the rules' cases (:40-75, the rules' own act from :194-204, :423-440), against withMechanic too, the freeform roll's and the map menu's (forced) left out, and the threat's reading after a reply (new, parked for combat since the old pipeline's settle went with its read after the reply). Considered rolls' and the other scenes' cases stay the prototype's.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoiceQuestion, Decider } from "../llm/decide.ts";
import { JevDecider } from "../llm/decide.ts";
import { effectiveScene } from "../../shared/scene/graph.ts";
import type { Exit, Scene } from "../../shared/scene/types.ts";
import { sameAgainDirective } from "./directives.ts";
import { beforeQuestions, CUE_CONFIDENCE, CUE_EARLY_CONFIDENCE, cueCount, DAFT_CONFIDENCE, decisionState, readBefore, readThreat, threatQuestions, withMechanic } from "./director.ts";
import { hangedClerk, viewAt } from "./fixtures.ts";
import { namedThing, type RulesOptions } from "./mechanics.ts";
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

/** The turn's one decision before the reply, as the decide endpoint makes it: the questions, the call, the reading. */
async function decideBefore(decider: Decider, scene: Scene, state: TurnView, line: string, brink?: Exit) {
  const asked = beforeQuestions(scene, state, brink);
  return readBefore(scene, state, await decider.decide(decisionState(scene, state, line), asked.questions, "director.before"), asked);
}

/** The granary yard at its start: Prout still hanging, the body's Medicine route open. */
const scene = hangedClerk();
const yard = (): TurnView => viewAt(scene, "yard", { turn: 3, player: { name: "Kren Brook", concept: "a jaded ex-soldier", modifiers: { medicine: 1, athletics: 5 } } });

test("a check route is put to the decider as the act its roll is for", async () => {
  const decider = scripted({});
  await decideBefore(decider, scene, yard(), "\"Morning, Sergeant.\"");
  assert.match(decider.asked[0]!.attempt!.criteria["examine-body"]!, /The Medicine check is to tell how Prout really died: only when the player is doing that now, not something that comes first\.\)$/);
});

test("a route the decider is sure of is the turn's, its check for the simulation to roll", async () => {
  const d = await decideBefore(scripted({ attempt: ["examine-body", 0.9] }), scene, yard(), "(I get right up to Prout and examine his neck and hands)");
  assert.deepEqual(d.route, { id: "examine-body", phase: "attempt", check: { skill: "medicine", dc: 12, reason: "to tell how Prout really died" } });
  // A read under the bar (a check needs 0.6) isn't.
  assert.equal((await decideBefore(scripted({ attempt: ["examine-body", 0.55] }), scene, yard(), "(I glance at the body)")).route, undefined);
});

test("a threat at a route written for persuasion rolls intimidation: the player's means, among the social ones", async () => {
  const d = await decideBefore(scripted({ attempt: ["win-cob", 0.9], attempt_means: ["intimidation", 0.8] }), scene, yard(), "Talk, boy, or I'll have you in the cells by noon.");
  assert.equal(d.route?.check?.skill, "intimidation");
  const unsure = await decideBefore(scripted({ attempt: ["win-cob", 0.9], attempt_means: ["intimidation", 0.5] }), scene, yard(), "Talk, boy.");
  assert.equal(unsure.route?.check?.skill, "persuasion", "an unsure read of the means keeps the route's own");
});

test("two routes for the same check share the read between them", async () => {
  // The co-GM's route beside the authored one: the same Medicine roll, the read split across both.
  const patch = { turn: 2, why: "test", transition: { beat: "yard", transition: {
    id: "improv-2-0", when: "Kren examines the body up close.", on: "attempt" as const,
    check: { skill: "medicine" as const, dc: 12, reason: "to read the marks on the body", success: "They read them.", failure: "They can't.", onSuccess: "yard" },
  } } };
  const twice = effectiveScene(scene, [patch]);
  const state = { ...yard(), patches: [patch] };
  const examine = "(I get right up to Prout and examine his neck and hands)";
  const split = await decideBefore(scripted({ attempt: ["improv-2-0", 0.55, { "examine-body": 0.4, none: 0.05 }] }), twice, state, examine);
  assert.equal(split.route?.id, "improv-2-0");
  assert.equal(split.route?.check?.skill, "medicine");
  // A different check doesn't count towards it.
  const other = await decideBefore(scripted({ attempt: ["improv-2-0", 0.55, { "win-cob": 0.4, none: 0.05 }] }), twice, state, examine);
  assert.equal(other.route, undefined);
});

test("a question with one option is answered without asking", async () => {
  // Offline: the Decisions API wants two choices or more, so a lone class feature never reaches it.
  const decision = await new JevDecider().decide({}, { feature: { instructions: "Which feature?", criteria: { "second-wind": "Second Wind" } } }, "test.single");
  assert.deepEqual(decision.answers.feature, { choice: "second-wind", probabilities: { "second-wind": 1 } });
  assert.equal(decision.costUsd, 0);
});

/** The yard once Cob and Moll have bolted from a threat that failed (scare-kids, rolled and lost). */
function scared(): TurnView {
  const state = yard();
  state.path.push({ turn: 2, from: "yard", to: "yard", via: "scare-kids", source: "pre", roll: { skill: "intimidation", dc: 12, die: 5, modifier: 4, total: 9, success: false, critical: null } });
  return state;
}
const AGAIN = "*plants herself in the gateway* I said nobody leaves! Come back here, or the watch drags you back by your ear and the boy goes to the Mending House!";

test("the same push again: a route's roll that failed isn't rolled again for it", async () => {
  const decider = scripted({ attempt: ["scare-kids", 0.96], same_again: ["again_0", 0.85, { new: 0.15 }] });
  const d = await decideBefore(decider, scene, scared(), AGAIN);
  assert.equal(d.route, undefined, "no second roll");
  assert.equal(d.sameAgain?.route, "scare-kids");
  assert.match(decider.asked[0]!.same_again!.criteria.again_0!, /turn 2: The player tries to frighten the kids into talking.*Intimidation check to scare the children into talking: 5 \+ 4 = 9 vs DC 12: failure/s);
  // The answer it gets is the one it got: the route's own failure, and nothing more.
  const route = scene.beats.find(b => b.id === "yard")!.transitions.find(t => t.id === "scare-kids")!;
  assert.equal(d.sameAgain?.answer, route.check!.failure);
  assert.ok(sameAgainDirective(route, d.sameAgain?.answer).includes(`it gets the same answer it got before: ${route.check!.failure}`));
  // Something new on the table: the route rolls as ever.
  const fresh = await decideBefore(scripted({ attempt: ["scare-kids", 0.96], same_again: ["new", 0.8] }), scene, scared(), "*dangles Cob's da's belt* Remember this, lad?");
  assert.equal(fresh.route?.check?.skill, "intimidation");
  assert.equal(fresh.sameAgain, undefined);
  // Nothing has failed yet: nothing to ask.
  const first = scripted({ attempt: ["scare-kids", 0.96] });
  await decideBefore(first, scene, yard(), AGAIN);
  assert.equal(first.asked[0]!.same_again, undefined);
});

test("the same push again is a push that failed on the same route: a first try on another route rolls", async () => {
  const WIN = "Cob, here's my promise: your name stays out of it, whatever you tell me.";
  const other = await decideBefore(scripted({ attempt: ["win-cob", 0.9], same_again: ["again_0", 0.7, { new: 0.3 }] }), scene, scared(), WIN);
  assert.equal(other.sameAgain, undefined, "the failed try was the threat, not this");
  assert.equal(other.route?.id, "win-cob");
  // Two failures on the same route share the read between them.
  const twice = scared();
  twice.path.push({ ...twice.path[0]!, turn: 3 });
  const split = await decideBefore(scripted({ attempt: ["scare-kids", 0.96], same_again: ["again_1", 0.4, { again_0: 0.35, new: 0.25 }] }), scene, twice, AGAIN);
  assert.equal(split.sameAgain?.route, "scare-kids");
});

// Pacing cues: a bar, as routes have, and the exchanges a cue counts checked by the engine's count.
// The yard's dead-cart comes after "at least eight exchanges at this point" (the test's yard has had two).
const IDLE = "(I sit on the edge of the water butt and wait to see what happens)";
const cueRead = async (p: number, state: TurnView = yard(), extra: Parameters<typeof scripted>[0] = {}) =>
  (await decideBefore(scripted({ cue: ["cart-comes", p, { not_yet: 1 - p }], ...extra }), scene, state, IDLE)).route?.id;

test("a cue's counted condition is read off its text", () => {
  const cue = (when: string) => cueCount({ id: "c", on: "cue", when, to: "x" });
  assert.equal(cue("The player has been inside a good while (at least five exchanges at this point), or is lying low and waiting"), 5);
  assert.equal(cue("he has waited at least two exchanges since he arrived"), 2);
  assert.equal(cue("The scene has been at this point a good while (at least 6 exchanges)"), 6);
  assert.equal(cue("Two exchanges have gone by and the pie is still on the tray"), 2, "the zoo's way of putting it");
  assert.equal(cue("An exchange has passed with the courier loose in the current"), 1);
  assert.equal(cue("The auditor has waited an exchange and there's no ledger."), 1);
  assert.equal(cue("The conversation has gone on for several exchanges, or they start to leave"), undefined, "several isn't a count");
});

test("a cue fires only on a clear read: the Heron's Master at 0.57 against 0.43 waits", async () => {
  const after = { ...yard(), turnsInBeat: 9 };
  assert.equal(await cueRead(0.57, after), undefined);
  assert.equal(await cueRead(CUE_CONFIDENCE, after), "cart-comes");
});

test("before its count, a cue needs the rest of its condition to hold clearly; the decider is told the count", async () => {
  const decider = scripted({ cue: ["cart-comes", 0.75, { not_yet: 0.25 }] });
  const d = await decideBefore(decider, scene, yard(), IDLE);
  assert.equal(d.route, undefined, "two exchanges of the eight: 0.75 isn't clear enough");
  assert.match(decider.asked[0]!.cue!.criteria["cart-comes"]!, /\[The game's count: 2 exchanges at this point so far, against the 8 this asks for, so that part doesn't hold yet: choose this only if the rest of it clearly holds on its own\.\]$/);
  assert.equal(await cueRead(CUE_EARLY_CONFIDENCE), "cart-comes", "the player plainly idling and waiting");
  // Once the count is reached, the usual bar.
  const counted = scripted({ cue: ["cart-comes", 0.65, { not_yet: 0.35 }] });
  const later = await decideBefore(counted, scene, { ...yard(), turnsInBeat: 8 }, IDLE);
  assert.deepEqual(later.route, { id: "cart-comes", phase: "cue" });
  assert.match(counted.asked[0]!.cue!.criteria["cart-comes"]!, /\[The game's count: 8 exchanges at this point so far, against the 8 this asks for, so that much holds\.\]$/);
});

test("no cue fires on a word out of character: that isn't time passing in the scene", async () => {
  assert.equal(await cueRead(0.95, { ...yard(), turnsInBeat: 9 }, { ooc: ["out_of_character", 0.95] }), undefined);
});

// The consequences flag: what the player does that the world would answer, not what they ask for.
const BOOT = "I don't want your boots. I just want to see what's making that noise. I assume you got them from the body. Could be evidence.";

test("a courteous ask isn't daft: the question says so, and the bill wants a clear read", async () => {
  const flag = async (p: number) => (await decideBefore(scripted({ daft: ["consequential", p, { none: 1 - p }] }), scene, yard(), BOOT)).daft;
  assert.equal(await flag(0.63), false, "the granary's polite look at the evidence was billed at 0.63");
  assert.equal(await flag(DAFT_CONFIDENCE), true);
  const decider = scripted({});
  await decideBefore(decider, scene, yard(), BOOT);
  const daft = decider.asked[0]!.daft!;
  assert.match(daft.instructions, /Earnest play isn't daft, however bold: asking for something \(to see it, for help, for evidence\), an honest offer \(food, coin, a trade\), making a case or an accusation from what they've seen, pressing someone for answers, or proposing a plan/);
  assert.match(daft.instructions, /a scam, a bluff or a lie/, "a trick still is");
});

// Endings that wait for the player's answer: what the decisions are asked, in the calls they make anyway.
test("with an ending held, the decision asks whether the player is answering it; only then", async () => {
  const exit = scene.exits.find(e => e.id === "open-case")!;
  const held = scripted({ brink: ["answers", 0.68, { lets_it_happen: 0.32 }] });
  const d = await decideBefore(held, scene, yard(), "Cob, you'll be safe. Can you tell me exactly what you heard and saw?", exit);
  assert.equal(d.answering, true);
  assert.match(held.asked[0]!.brink!.instructions, /^The scene is about to end like this: Murder by persons unknown\./);
  assert.match(held.asked[0]!.brink!.criteria.answers!, /calling someone out \(even just their name, said to them\)/);
  const thanks = await decideBefore(scripted({ brink: ["lets_it_happen", 0.99] }), scene, yard(), "Thank you, Sergeant.", exit);
  assert.equal(thanks.answering, undefined, "letting it happen");
  const none = scripted({});
  await decideBefore(none, scene, yard(), "Who found him?");
  assert.equal(none.asked[0]!.brink, undefined);
});

// ---------------------------------------------------------------------------------------------
// The rules (world-bridge-design §2.2): what they resolve is the turn's act, with its details asked
// in a second small call (withMechanic), as the decide endpoint makes them.

/** The turn's decision with the rules' act: the questions, the call, the reading, then the act's details. */
async function decideWithRules(decider: Decider, state: TurnView, line: string, rules: RulesOptions) {
  const asked = beforeQuestions(scene, state, undefined, { rules });
  const read = readBefore(scene, state, await decider.decide(decisionState(scene, state, line), asked.questions, "director.before"), asked);
  return withMechanic(decider, scene, state, line, read, rules);
}

const rules: RulesOptions = { spells: [], weapons: [{ id: "javelin", name: "Javelin" }], things: [{ id: "hoist-rope", name: "the hoist rope" }] };
const THROW = "(I throw my javelin at the rope above the corpse to get the body down)";

test("a route's roll waits while the rules resolve the player's act", async () => {
  const decider = scripted({ attempt: ["examine-body", 0.9], mechanic: ["attack", 0.9], target: ["hoist-rope", 0.95], weapon: ["javelin", 1], also: ["no", 0.9] });
  const d = await decideWithRules(decider, yard(), THROW, rules);
  assert.equal(d.route, undefined, "no Medicine roll for a javelin throw");
  assert.deepEqual(d.mechanic, { kind: "attack", target: "hoist-rope", weapon: "javelin" });
  // Asked alongside the attack's details, in the call those turns make anyway.
  assert.equal(decider.asked.length, 2);
  assert.match(decider.asked[1]!.also!.instructions, /Medicine check is for \(to tell how Prout really died\)/);
  assert.equal("details" in d, false, "what the details call needed isn't part of the answer");
});

test("the route still rolls when the player is doing its act too", async () => {
  const decider = scripted({ attempt: ["examine-body", 0.9], mechanic: ["attack", 0.9], target: ["hoist-rope", 0.95], weapon: ["javelin", 1], also: ["yes", 0.9] });
  const d = await decideWithRules(decider, yard(), THROW, rules);
  assert.deepEqual(d.route, { id: "examine-body", phase: "attempt", check: { skill: "medicine", dc: 12, reason: "to tell how Prout really died" } });
  assert.equal(d.mechanic?.kind, "attack");
});

test("without an act for the rules, a route's roll is as it was", async () => {
  const decider = scripted({ attempt: ["examine-body", 0.9] });
  const d = await decideWithRules(decider, yard(), "(I get right up to Prout and examine his neck and hands)", rules);
  assert.equal(d.route?.check?.skill, "medicine");
  assert.equal(d.mechanic, undefined);
  assert.equal(decider.asked.length, 1, "no second call");
  // A rest needs no details either; nor does anything the rules resolve on an unsure read, over a limit or out of character.
  assert.deepEqual((await decideWithRules(scripted({ mechanic: ["short_rest", 0.8] }), yard(), "We sit down for an hour.", rules)).mechanic, { kind: "rest", length: "short" });
  assert.equal((await decideWithRules(scripted({ mechanic: ["attack", 0.55] }), yard(), THROW, rules)).mechanic, undefined);
  assert.equal((await decideWithRules(scripted({ mechanic: ["attack", 0.9], ooc: ["out_of_character", 0.9] }), yard(), THROW, rules)).mechanic, undefined);
});

test("considered rolls: the rules settle a blow, unless it's only the means to something risky they don't", async () => {
  const LINING = "*crouches by Cob* Take the left boot off yourself and feel along the lining with your own fingers.";
  const blow = { roll_call: ["new", 0.9], mechanic: ["attack", 0.9], target: ["hoist-rope", 0.95], weapon: ["javelin", 1] } satisfies Parameters<typeof scripted>[0];
  const settled = scripted(blow);
  const d = await decideWithRules(settled, yard(), LINING, rules);
  assert.equal(d.considered, undefined, "the rules settle a blow");
  assert.equal(d.mechanic?.kind, "attack");
  assert.ok(settled.asked[1]!.means_only, "asked with the act's details");
  assert.equal(settled.asked[0]!.means_only, undefined, "not in the turn's main decision");
  const means = await decideWithRules(scripted({ ...blow, means_only: ["yes", 0.8] }), yard(), LINING, rules);
  assert.equal(means.mechanic?.kind, "attack");
  assert.ok(means.considered, "the act is only the means: the GM rules on the rest, after the rules");
  assert.equal(means.considered.probability, 0.9);
  // No roll wanted: the means question isn't asked at all.
  const quiet = scripted({ mechanic: ["attack", 0.9], target: ["hoist-rope", 0.95], weapon: ["javelin", 1] });
  await decideWithRules(quiet, yard(), THROW, rules);
  assert.equal(quiet.asked[1]!.means_only, undefined);
});

test("a spell's aim on a weak read is what the player named, a doubtful second target is dropped, and an aim nobody can make out is asked (wizard#17)", async () => {
  const doors = [{ id: "loft-door", name: "the loft door" }, { id: "yard-doors", name: "the yard doors" }, { id: "tally-desk", name: "the tally desk" }, { id: "smashed-lantern", name: "a smashed lantern" }];
  assert.equal(namedThing(doors, "*I aim a Fire Bolt at the padlocked yard doors' hasp*"), "yard-doors");
  assert.equal(namedThing(doors, "the Mage Hand goes through the slot to the chained tally book"), "tally-desk");
  assert.equal(namedThing(doors, "I fling it at the door"), undefined, "a tie names nothing");
  const spells: RulesOptions = { spells: [{ id: "fire-bolt", name: "Fire Bolt", level: 0 }, { id: "magic-missile", name: "Magic Missile", level: 1 }], weapons: [], things: doors };
  const cast = async (said: string, picks: Parameters<typeof scripted>[0]) => (await decideWithRules(scripted({ mechanic: ["cast", 0.95], ...picks }), yard(), said, spells)).mechanic;
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
