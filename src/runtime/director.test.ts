import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoiceQuestion, Decider } from "../llm/decide.ts";
import { JevDecider } from "../llm/decide.ts";
import { sceneById } from "../../scenes/index.ts";
import { effectiveScene } from "./brief.ts";
import { CONSIDER_CONFIDENCE_OPEN, CUE_CONFIDENCE, CUE_EARLY_CONFIDENCE, cueCount, DAFT_CONFIDENCE, decideAfter, decideBefore, namedThing, pressureReason, type RulesOptions } from "./director.ts";
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

test("considered rolls: a route the author gave no dice settles the turn as written; an unsure read of it doesn't", async () => {
  // The Ambrose report, T43: eel for a look read as the bribe route (.63), and still went to a ruling.
  const EEL = "Two pennies for some extra eel if you'll let me look at what's crackling in your boot, Cob.";
  const sure = await decideBefore(scripted({ roll_call: ["new", 0.8, { route: 0.1 }], attempt: ["plain:bribe-cob", 0.63] }), scene, yard(), EEL, considered);
  assert.equal(sure.considered, undefined, "the bribe gets the author's answer: haggling, no dice");
  const unsure = await decideBefore(scripted({ roll_call: ["new", 0.8, { route: 0.1 }], attempt: ["plain:bribe-cob", 0.3] }), scene, yard(), EEL, considered);
  assert.ok(unsure.considered, "a weak read of a no-dice route doesn't stop the GM ruling on what was asked");
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
  assert.match(on.asked[0]!.limit!.instructions, /Faking one isn't reaching for it: a forged paper, a fake badge or a lie that they have one of these is a trick/);
  assert.ok(on.asked[0]!.limit!.criteria.pretending, "faking one has an answer of its own");
  assert.equal(on.asked[0]!.attempt!.criteria.other_risky, undefined, "the flag stands in for the freeform roll's option");
});

const WRIT = "*holds up a folded tavern bill, seal-side out* Know what this is, Cob? The King's own writ of protection. Whoever helps the King's investigator is under the King's hand. Tell me what you saw.";

test("considered rolls: a forged writ read as faking the limit goes to the GM, while reaching for the real thing is still a no", async () => {
  const faked = await decideBefore(scripted({ roll_call: ["new", 0.9], limit: ["pretending", 0.7, { limit_3: 0.25 }] }), scene, yard(), WRIT, considered);
  assert.equal(faked.limit, undefined);
  assert.ok(faked.considered, "a lie to rule on");
  const reached = await decideBefore(scripted({ roll_call: ["new", 0.9], limit: ["limit_3", 0.8] }), scene, yard(), "Then get the King to write it down for me. A warrant, today.", considered);
  assert.ok(reached.limit);
  assert.equal(reached.considered, undefined);
});

/** The yard once Cob and Moll have bolted from a threat that failed (scare-kids, rolled and lost). */
function scared(): SessionState {
  const state = yard();
  state.path.push({ turn: 2, from: "yard", to: "yard", via: "scare-kids", source: "pre", roll: { skill: "intimidation", dc: 12, die: 5, modifier: 4, total: 9, success: false, critical: null } });
  return state;
}
const AGAIN = "*plants herself in the gateway* I said nobody leaves! Come back here, or the watch drags you back by your ear and the boy goes to the Mending House!";

test("the same push again: a route's roll that failed isn't rolled again for it, as the GM's ruling wouldn't be", async () => {
  const decider = scripted({ attempt: ["scare-kids", 0.96], same_again: ["same", 0.85, { new: 0.15 }] });
  const pre = await decideBefore(decider, scene, scared(), AGAIN, { speaker: false, considered: true });
  assert.equal(pre.move, undefined, "no second roll");
  assert.equal(pre.sameAgain?.id, "scare-kids");
  assert.match(decider.asked[0]!.same_again!.instructions, /turn 2: The player tries to frighten the kids into talking.*Intimidation check to scare the children into talking: 5 \+ 4 = 9 vs DC 12: failure/s);
  // Something new on the table: the route rolls as ever.
  const fresh = await decideBefore(scripted({ attempt: ["scare-kids", 0.96], same_again: ["new", 0.8] }), scene, scared(), "*dangles Cob's da's belt* Remember this, lad?", { speaker: false, considered: true });
  assert.equal(fresh.move?.roll?.skill, "intimidation");
  assert.equal(fresh.sameAgain, undefined);
  // Nothing has failed yet: nothing to ask.
  const first = scripted({ attempt: ["scare-kids", 0.96] });
  await decideBefore(first, scene, yard(), AGAIN, { speaker: false, considered: true });
  assert.equal(first.asked[0]!.same_again, undefined);
});

test("considered rolls: the method is asked in every beat, so the GM's review hears a lie read as one wherever it's told", async () => {
  const motive = { ...yard(), beat: "motive" };
  const decider = scripted({ roll_call: ["new", 0.9], attempt_means: ["deception", 0.8] });
  const pre = await decideBefore(decider, scene, motive, "There's a stone-throwing match at the palace tomorrow, Cob, and I can put your name down.", considered);
  assert.ok(decider.asked[0]!.attempt_means, "asked in a beat with no social route");
  assert.equal(pre.considered?.means, "deception");
  // Rolls not considered: asked only where a route is written for one social means, as before.
  const plain = scripted({});
  await decideBefore(plain, scene, motive, "There's a stone-throwing match at the palace tomorrow.", { speaker: false, freeform: true });
  assert.equal(plain.asked[0]!.attempt_means, undefined);
});

test("considered rolls: a beat with no route with a roll has a lower bar, which a big ask clears and a plain question doesn't", async () => {
  const motive = { ...yard(), beat: "motive" };
  const flag = async (state: SessionState, p: number) => (await decideBefore(scripted({ roll_call: ["new", p, { none: 1 - p }] }), scene, state, "Come with me to the palace this afternoon and tell the King yourself.", considered)).considered;
  assert.ok(await flag(motive, CONSIDER_CONFIDENCE_OPEN + 0.05), "flagged where nothing could have rolled for it");
  assert.equal(await flag(motive, CONSIDER_CONFIDENCE_OPEN - 0.05), undefined);
  assert.equal(await flag(yard(), CONSIDER_CONFIDENCE_OPEN + 0.05), undefined, "where routes have rolls, the bar is as it was");
});

// Pacing cues: a bar, as routes have, and the exchanges a cue counts checked by the engine's count.
// The yard's dead-cart comes after "at least eight exchanges at this point" (the test's yard has had two).
const IDLE = "(I sit on the edge of the water butt and wait to see what happens)";
const cueRead = async (p: number, state: SessionState = yard(), extra: Parameters<typeof scripted>[0] = {}) =>
  (await decideBefore(scripted({ cue: ["cart-comes", p, { not_yet: 1 - p }], ...extra }), scene, state, IDLE, { speaker: false })).move?.transition.id;

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
  // An uncounted cue has the same bar: the crossroads' goblins strike as the party sets off.
  const road = effectiveScene(sceneById("crossroads-ambush"), []);
  const story: SessionState = { ...yard(), sceneId: "crossroads-ambush", beat: "story", turnsInBeat: 1 };
  const strike = async (p: number) => (await decideBefore(scripted({ cue: ["goblins-strike", p, { not_yet: 1 - p }] }), road, story, "Let's get you home, Tam.", { speaker: false })).move?.transition.id;
  assert.equal(await strike(0.55), undefined);
  assert.equal(await strike(0.98), "goblins-strike");
});

test("before its count, a cue needs the rest of its condition to hold clearly; the decider is told the count", async () => {
  const decider = scripted({ cue: ["cart-comes", 0.75, { not_yet: 0.25 }] });
  const pre = await decideBefore(decider, scene, yard(), IDLE, { speaker: false });
  assert.equal(pre.move, undefined, "two exchanges of the eight: 0.75 isn't clear enough");
  assert.match(decider.asked[0]!.cue!.criteria["cart-comes"]!, /\[The game's count: 2 exchanges at this point so far, against the 8 this asks for, so that part doesn't hold yet: choose this only if the rest of it clearly holds on its own\.\]$/);
  assert.equal(await cueRead(CUE_EARLY_CONFIDENCE), "cart-comes", "the player plainly idling and waiting");
  // Once the count is reached, the usual bar.
  const counted = scripted({ cue: ["cart-comes", 0.65, { not_yet: 0.35 }] });
  const later = await decideBefore(counted, scene, { ...yard(), turnsInBeat: 8 }, IDLE, { speaker: false });
  assert.equal(later.move?.transition.id, "cart-comes");
  assert.match(counted.asked[0]!.cue!.criteria["cart-comes"]!, /\[The game's count: 8 exchanges at this point so far, against the 8 this asks for, so that much holds\.\]$/);
});

test("no cue fires on a word out of character: that isn't time passing in the scene", async () => {
  assert.equal(await cueRead(0.95, { ...yard(), turnsInBeat: 9 }, { ooc: ["out_of_character", 0.95] }), undefined);
});

// The consequences flag: what the player does that the world would answer, not what they ask for.
const BOOT = "I don't want your boots. I just want to see what's making that noise. I assume you got them from the body. Could be evidence.";

test("a courteous ask isn't daft: the question says so, and the bill wants a clear read", async () => {
  const flag = async (p: number) => (await decideBefore(scripted({ daft: ["consequential", p, { none: 1 - p }] }), scene, yard(), BOOT, { speaker: false, consequences: true })).daft;
  assert.equal(await flag(0.63), undefined, "the granary's polite look at the evidence was billed at 0.63");
  assert.equal(await flag(DAFT_CONFIDENCE), true);
  const decider = scripted({});
  await decideBefore(decider, scene, yard(), BOOT, { speaker: false, consequences: true });
  const daft = decider.asked[0]!.daft!;
  assert.match(daft.instructions, /Earnest play isn't daft, however bold: asking for something \(to see it, for help, for evidence\), an honest offer \(food, coin, a trade\), making a case or an accusation from what they've seen, pressing someone for answers, or proposing a plan/);
  assert.match(daft.instructions, /a scam, a bluff or a lie/, "a trick still is");
});

// Endings that wait for the player's answer: what the decisions are asked, in the calls they make anyway.
test("with an ending held, the decision asks whether the player is answering it; only then", async () => {
  const exit = scene.exits.find(e => e.id === "open-case")!;
  const held = scripted({ brink: ["answers", 0.68, { lets_it_happen: 0.32 }] });
  const pre = await decideBefore(held, scene, yard(), "Cob, you'll be safe. Can you tell me exactly what you heard and saw?", { speaker: false, brink: exit });
  assert.equal(pre.answering, true);
  assert.match(held.asked[0]!.brink!.instructions, /^The scene is about to end like this: Murder by persons unknown\./);
  assert.match(held.asked[0]!.brink!.criteria.answers!, /calling someone out \(even just their name, said to them\)/);
  const thanks = await decideBefore(scripted({ brink: ["lets_it_happen", 0.99] }), scene, yard(), "Thank you, Sergeant.", { speaker: false, brink: exit });
  assert.equal(thanks.answering, undefined, "letting it happen");
  const none = scripted({});
  await decideBefore(none, scene, yard(), "Who found him?", { speaker: false });
  assert.equal(none.asked[0]!.brink, undefined);
});

test("after the reply: whether the player left something unanswered, and whether an ending would be their own doing", async () => {
  const after = (picks: Parameters<typeof scripted>[0]) => decideAfter(scripted(picks), scene, yard(), "Shall we go? And who found him?", "Kell closes her notebook.");
  const left = await after({ ask: ["unanswered", 0.55, { none: 0.45 }], own_exit: ["theirs", 0.9] });
  assert.deepEqual([left.unanswered, left.theirs], [true, true]);
  const unsure = await after({ own_exit: ["theirs", 0.55, { no: 0.45 }] });
  assert.deepEqual([unsure.unanswered, unsure.theirs], [undefined, undefined], "only a clear read is the player's own exit");
});

test("a spell's aim on a weak read is what the player named, a doubtful second target is dropped, and an aim nobody can make out is asked (wizard#17)", async () => {
  const doors = [{ id: "loft-door", name: "the loft door" }, { id: "yard-doors", name: "the yard doors" }, { id: "tally-desk", name: "the tally desk" }, { id: "smashed-lantern", name: "a smashed lantern" }];
  assert.equal(namedThing(doors, "*I aim a Fire Bolt at the padlocked yard doors' hasp*"), "yard-doors");
  assert.equal(namedThing(doors, "the Mage Hand goes through the slot to the chained tally book"), "tally-desk");
  assert.equal(namedThing(doors, "I fling it at the door"), undefined, "a tie names nothing");
  const spells = { spells: [{ id: "fire-bolt", name: "Fire Bolt", level: 0 }, { id: "magic-missile", name: "Magic Missile", level: 1 }], weapons: [], things: doors };
  const cast = async (said: string, picks: Record<string, [string, number, Record<string, number>?]>) =>
    (await decideBefore(scripted({ mechanic: ["cast", 0.95], ...picks }), scene, yard(), said, { speaker: false, rules: spells })).mechanic;
  // As played: the loft door at .44 against the yard doors at .14, for the yard doors' hasp.
  assert.deepEqual(await cast("*I aim a Fire Bolt at the padlocked yard doors' hasp*", { spell: ["fire-bolt", 0.99], aim_thing: ["loft-door", 0.44, { "yard-doors": 0.14 }] }), { kind: "cast", spell: "fire-bolt", targets: ["yard-doors"] });
  // A sure read stands.
  assert.deepEqual(await cast("*Fire Bolt at the loft door*", { spell: ["fire-bolt", 0.99], aim_thing: ["loft-door", 0.9] }), { kind: "cast", spell: "fire-bolt", targets: ["loft-door"] });
  // Nothing named, and no clear lead: asked.
  assert.deepEqual(await cast("*I hurl a Fire Bolt up there*", { spell: ["fire-bolt", 0.99], aim_thing: ["loft-door", 0.29, { "yard-doors": 0.25 }] }), { kind: "cast", spell: "fire-bolt", targets: [], unclear: true });
  // Magic Missile into the Crake's back (.99), and Sallow at .56 is dropped.
  const crakeCast = await decideBefore(scripted({ mechanic: ["cast", 0.95], spell: ["magic-missile", 0.9], aim_cob: ["yes", 0.99], aim_kell: ["yes", 0.56] }), scene, yard(), "*Magic Missile straight into the boy*", { speaker: false, rules: spells });
  assert.deepEqual(crakeCast.mechanic, { kind: "cast", spell: "magic-missile", targets: ["cob"] });
});
