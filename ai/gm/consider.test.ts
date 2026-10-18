// Copied from the prototype's src/runtime/consider.test.ts at 44c6d4a: its cases on the review's answer that need no engine (the verdict's grid, the same push again, what the review is told, a ruling held to the scene, a lie rolled as one, the dice line's reason), and the directive asserts of its settleRuling cases against rulingDirective (the simulation's settle rolls and moves). The whole turns played through the engine are the e2e's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveScene, presentCast } from "../../shared/scene/graph.ts";
import type { RulingRecord } from "../../shared/gm/consider.ts";
import { buildWorld } from "../../shared/world/scene-world.ts";
import { diceReason, plainReason, refusalOf, reviewInput, rulingDirective, rulingRoute, toRuling, verdict, type Judged, type OutcomeJson, type Ruling } from "./consider.ts";
import type { Move } from "./directives.ts";
import { granaryYard, hangedClerk, sceneById, stateIn, viewAt } from "./fixtures.ts";
import type { TurnView } from "./view.ts";

const scene = hangedClerk();
const PAGE = scene.beats.find(b => b.id === "yard")!.transitions.find(t => t.id === "page-found")!.establishes![0]!;

/** The granary yard, before anything has troubled the suicide story; no world (the prototype's tests' yard). */
function yard(): TurnView {
  const view = viewAt(scene, "yard", { turn: 4, turnsInBeat: 3, player: { name: "Pell Marrow", concept: "a hedge-wizard with a scorched hat", modifiers: {} } });
  delete view.world;
  return view;
}

/** The Drowned Rat with Hobb talking (the confession beat), as the barbarian had it. */
const rat = (beat = "confession"): TurnView => stateIn("drowned-rat", { beat, turn: 24, turnsInBeat: 2, player: { name: "Grukka", concept: "a half-orc barbarian with a greataxe", modifiers: {} } });

const judged = (j: Partial<Judged>): Judged => ({ stakes: "guarded", approach: "plausible", disposition: "wary", sameAgain: false, difficulty: "moderate", ...j });

/** The guidance's whole grid (docs/research/dc-guidance.md §3.2): rows approach and disposition, columns guarded, dangerous, ruinous. */
const GRID: Array<[Judged["approach"], Judged["disposition"], string, string, string]> = [
  ["weak", "hostile", "18", "no", "no"], ["weak", "wary", "15", "18", "no"], ["weak", "friendly", "12", "15", "18"],
  ["plausible", "hostile", "15", "18", "no"], ["plausible", "wary", "12", "15", "18"], ["plausible", "friendly", "yes", "12", "15"],
  ["strong", "hostile", "12", "15", "18"], ["strong", "wary", "yes", "12", "15"], ["strong", "friendly", "yes", "yes", "12"],
  ["excellent", "hostile", "yes", "12", "15"], ["excellent", "wary", "yes", "yes", "12"], ["excellent", "friendly", "yes", "yes", "yes"],
];

test("the verdict: the guidance's grid for someone worked on, as designed (yes at a gap of 0, no at 4); a feat's difficulty otherwise", () => {
  const on = (j: Partial<Judged>, skill: "persuasion" | "deception" | "intimidation" = "persuasion") => verdict(scene, { target: "cob", skill, judged: judged(j) });
  const cell = (v: ReturnType<typeof on>) => (v.kind === "roll" ? String(v.dc) : v.kind);
  for (const [approach, disposition, ...byStakes] of GRID) {
    assert.deepEqual((["guarded", "dangerous", "ruinous"] as const).map(stakes => cell(on({ stakes, approach, disposition }))), byStakes, `${approach}, ${disposition}`);
  }
  assert.equal(on({ stakes: "dangerous", approach: "excellent", disposition: "wary" }).kind, "yes", "barbarian#48's T42");
  assert.deepEqual(on({ stakes: "dangerous", approach: "weak", disposition: "hostile" }), { kind: "no", no: "refused", why: "not like this: it's too far from what would move them (dangerous, weak, hostile)" }, "barbarian#48's T11");
  assert.equal(on({ approach: "excellent", disposition: "friendly" }, "deception").dc, 10, "a lie that would be enough can always be seen through: it rolls, low");
  assert.equal(on({ approach: "free", disposition: "hostile" }).kind, "yes", "they'd do it anyway");
  assert.equal(on({ stakes: "trivial" }).kind, "yes");
  assert.equal(on({ approach: "no_chance" }).kind, "no", "a lever that can't move them");
  assert.equal(on({ sameAgain: true }).kind, "no", "the same push again");
  const feat = (difficulty: Judged["difficulty"]) => verdict(scene, { target: "world", skill: "athletics", judged: judged({ difficulty }) });
  assert.deepEqual(["trivial", "easy", "moderate", "hard", "impossible"].map(d => feat(d as Judged["difficulty"]).dc ?? feat(d as Judged["difficulty"]).kind), ["yes", 10, 13, 16, "no"]);
  // A lift from someone is a contest with them: rolled, though nothing else stands in the way.
  assert.deepEqual(verdict(scene, { target: "cob", skill: "sleight_of_hand", judged: judged({ difficulty: "trivial" }) }), { kind: "roll", dc: 12, why: "guarded to lose, plausible cover, wary: they could notice" });
});

const outcome = (o: Partial<OutcomeJson>): OutcomeJson => ({ happens: "", gets: "some", to: "stay", counts_as: "none", establishes: [], reveals: [], closes: [], ...o });
const json = (success: OutcomeJson, failure: OutcomeJson) => ({
  act: "talk Cob into opening the boot's lining himself", target: "cob", lie: false, skill: "persuasion", stakes: "guarded" as const, approach: "plausible" as const,
  disposition: "wary" as const, same_again: false, difficulty: "moderate" as const, reason: "to get Cob to open the boot's lining", success, failure,
});
const LINING = json(
  outcome({ happens: "Cob drags the left boot off, picks the stitches with a grimy thumbnail and draws out a folded page.", gets: "all", counts_as: "page-found", reveals: ["page"] }),
  outcome({ happens: "Cob jeers and bolts behind the water butt and through the gap into the granary, boots and all.", gets: "none", establishes: ["Cob has bolted into the granary through the gap behind the water butt."], closes: ["win-cob"] }),
);
const META = { costUsd: 0.002, latencyMs: 4000 };

/** A ruling on record that failed: the penny for a look, as the goals tester's granary had it (goals#58). */
const PENNY: RulingRecord = { turn: 2, act: "Offer a penny for a look in Cob's left boot", target: "cob", skill: "persuasion", kind: "roll", dc: 15, why: "guarded, weak, hostile",
  roll: { skill: "persuasion", dc: 15, die: 6, modifier: 2, total: 8, success: false, critical: null }, went: "failure",
  changed: "Cob snatches the penny and backs toward the water butt, clamping a hand over the left boot", costUsd: 0, latencyMs: 0 };

test("the same push again gets the same answer, whatever else the review says; but only when something has failed here to be the same as (goals#58, robust#74)", () => {
  const state = yard();
  state.rulings = [PENNY];
  const fair = toRuling(scene, state, { ...LINING, stakes: "trivial", approach: "weak", disposition: "hostile", same_again: true }, META);
  assert.equal(fair.judged.sameAgain, true);
  assert.deepEqual(verdict(scene, fair), { kind: "no", no: "same_again", why: "the same push again, with nothing new" }, "trivial stakes don't make it a yes");
  const first = toRuling(scene, yard(), { ...LINING, same_again: true }, META);
  assert.equal(first.judged.sameAgain, false);
  assert.equal(verdict(scene, first).kind, "roll");
});

test("the review is given what was tried, each try in the player's own words, to tell the same push from a new one (wizard#15)", () => {
  const state = yard();
  state.rulings = [PENNY];
  state.transcript.push(
    { turn: 2, speaker: "player", kind: "player", text: "Not buying the boots, Cob. (I hold up a silver penny.) This is yours if I can see what's crackling in there." },
    { turn: 3, speaker: "player", kind: "player", text: "You saw him jump, Moll? Tell it again." },
  );
  state.path.push({ turn: 3, from: "yard", to: "yard", via: "catch-moll", source: "pre", roll: { skill: "insight", dc: 13, die: 4, modifier: 1, total: 5, success: false, critical: null } });
  const input = reviewInput(scene, state, "The drizzle started before midnight, and the loft door is barred. Who taught you that story?", undefined);
  assert.match(input, /## Your earlier rulings in this scene \(each with what the player said and did\)\n- turn 2: Offer a penny .*backs toward the water butt, clamping a hand over the left boot\. The player: "Not buying the boots, Cob\. \(I hold up a silver penny\.\) This is yours/);
  assert.match(input, /## Routes you wrote that were rolled in this scene and failed\n- turn 3: The player presses on the holes in Moll's .* The player: "You saw him jump, Moll\? Tell it again\."/);
});

test("a ruling is held to the scene: an outcome counts as the route it amounts to, closes only ways of trying, and always changes something", () => {
  const ruling = toRuling(scene, yard(), {
    ...LINING,
    success: outcome({ happens: "He opens it.", gets: "all", counts_as: "page-found", reveals: ["page", "nonsense"] }),
    failure: outcome({ happens: "Cob shakes his head.", gets: "none" }),
  }, META);
  assert.equal(ruling.success.to, "motive", "the page found leads where its route leads");
  assert.deepEqual(ruling.success.establishes, [PAGE], "with the route's own facts (the exit scripts read them)");
  assert.deepEqual(ruling.success.reveals, ["page"]);
  assert.match(ruling.failure.establishes[0]!, /it failed: Cob shakes his head\./, "a failure that changed nothing is on the record at least");
  const shut = toRuling(scene, yard(), { ...LINING, failure: outcome({ happens: "Moll swears blind it's true and drags Cob off through the gap.", gets: "none", closes: ["concede", "catch-moll"] }) }, META, { read: { probability: 0.8, routes: [{ id: "catch-moll", p: 0.4 }] } });
  assert.deepEqual(shut.failure.closes, ["catch-moll"], "giving up isn't a way of trying the ruling can shut");
});

test("a lie is rolled as Deception, however friendly its words: by the review's read, or the decider's", () => {
  assert.equal(toRuling(scene, yard(), { ...LINING, lie: true }, META).skill, "deception", "a made-up promise is a lie");
  assert.equal(toRuling(scene, yard(), LINING, META, { read: { probability: 0.9, routes: [], means: "deception" } }).skill, "deception", "the decider read the method as a lie");
  assert.equal(toRuling(scene, yard(), LINING, META).skill, "persuasion", "an honest bargain");
  assert.equal(toRuling(scene, yard(), { ...LINING, skill: "intimidation", lie: true }, META).skill, "intimidation", "a bluffed threat is still a threat");
});

test("the dice line says nothing the player hasn't heard: names as they'd call people, 'you', and the plain goal for a place they don't know of", () => {
  const state = yard();
  state.world = buildWorld(scene.id, granaryYard(), presentCast(scene, state).map(c => ({ id: c.id, name: c.name })), state.player);
  const cob = { target: "cob", skill: "persuasion" as const };
  assert.equal(diceReason(scene, state, "to get Cob to tell Pell what he saw last night.", cob), "to get the boy in the too-big boots to tell you what he saw last night");
  assert.equal(diceReason(scene, state, "to make Moll name Master Sallow", { target: "moll", skill: "intimidation" }, [{ name: "Master Josiah Sallow", called: "the gentleman with the silver-topped cane" }]),
    "to make the girl in the shawl name the gentleman with the silver-topped cane");
  assert.equal(diceReason(scene, state, "to get Cob to show you the tally desk", cob), "to win the boy in the too-big boots over", "the tally desk is in the loft, and nobody has said a word of it");
  // The roll made without a ruling: the plain goal at whoever the turn names (barbarian#49).
  const drownedRat = effectiveScene(sceneById("drowned-rat"), []);
  assert.equal(plainReason(drownedRat, rat(), "persuasion", "Hobb, finish it. The Master: who is he?"), "to win the big man with the bandaged hand over");
  assert.equal(plainReason(drownedRat, rat(), "athletics", "I vault the bar and make for the scullery."), "to pull it off");
});

/** A ruling's move as the simulation plays a verdict without dice (settleRuling's, consider.ts:643). */
function noDiceMove(where: typeof scene, state: TurnView, ruling: Ruling): { move: Move; played: ReturnType<typeof refusalOf> } {
  const v = verdict(where, ruling);
  const played = v.kind === "no" ? refusalOf(ruling, v) : ruling.success;
  const route = rulingRoute(where, state, ruling, v, v.kind === "no" ? played : undefined);
  return { move: { transition: route, phase: "attempt", to: route.to!, chosen: v.kind === "yes" }, played };
}

test("a no without dice is an honest refusal: all his coin for Hobb's mum gets 'Coin won't keep her safe', not Hobb bolting (barbarian#38); the same push again keeps the answer it got", () => {
  const drownedRat = effectiveScene(sceneById("drowned-rat"), []);
  const state = rat();
  const ruling = toRuling(drownedRat, state, {
    act: "Offer Hobb all your coin in exchange for what would keep his mother safe tonight", target: "hobb", lie: false, skill: "persuasion",
    stakes: "dangerous", approach: "weak", disposition: "wary", same_again: false, difficulty: "trivial", reason: "to get Hobb to tell you what would keep his mother safe tonight",
    success: outcome({ happens: "Hobb looks at the coins, then closes your fingers around them with his good hand. “Keep it, sir. Coin won’t keep her safe. Don’t go near her. Please.” He turns toward the door, still frightened, but stays to hear what you say next.", gets: "none", establishes: ["Hobb has refused Grukka's money"] }),
    failure: outcome({ happens: "Hobb stares at the coins, then recoils as if they were a threat. “No, sir. Don’t buy her.” He pushes past toward the dark stairs; Kell moves after him, notebook in hand, as Hobb bolts from the Rat.", gets: "none", to: "hobb-fled", counts_as: "hobb-runs", establishes: ["Hobb has fled into the dark to warn his master"], closes: ["turn-hobb", "mum-safe"] }),
  }, META);
  const hollow = noDiceMove(drownedRat, state, ruling);
  const lines = rulingDirective(drownedRat, state, ruling, verdict(drownedRat, ruling), hollow.move, hollow.played);
  assert.equal(hollow.move.to, "confession", "he stays, and the scene with him");
  assert.match(lines[0]!, /^No dice: this can't get them what they're after \(no roll could get them that here\)\..*Coin won’t keep her safe/);
  assert.doesNotMatch(lines.join("\n"), /Hobb bolts|hobb-fled|is shut/);
  // Asked plainly with nothing on the table that could move him: a plain no, and nothing else.
  const plain = { ...ruling, hollow: undefined, judged: { ...ruling.judged, approach: "no_chance" as const } };
  const no = noDiceMove(drownedRat, state, plain);
  assert.match(rulingDirective(drownedRat, state, plain, verdict(drownedRat, plain), no.move, no.played)[0]!, /^No dice: The big man with the bandaged hand won't, not like this \(it pulls a lever that can't move them \(dangerous, no chance, wary\)\)\. They say no in their own words and character/);
  // The same push again, in the granary: the answer it got before.
  const again = yard();
  again.rulings = [PENNY];
  const same = toRuling(scene, again, { ...LINING, same_again: true }, META);
  const pushed = noDiceMove(scene, again, same);
  assert.match(rulingDirective(scene, again, same, verdict(scene, same), pushed.move, pushed.played)[0]!, /^No dice: this is the same push that already failed in this scene, with nothing new on the table, so it gets the same answer it got before\. The boy in the too-big boots holds, as before/);
  assert.equal(pushed.move.to, "yard");
});

test("a ruling with no roll that works: no dice, the decided outcome, and where it takes the scene; a lie that works is believed, for now", () => {
  const state = yard();
  const free = toRuling(scene, state, { ...LINING, approach: "free" }, META);
  const yes = noDiceMove(scene, state, free);
  const lines = rulingDirective(scene, state, free, verdict(scene, free), yes.move, yes.played);
  assert.deepEqual([yes.move.to, yes.move.chosen], ["motive", true]);
  assert.match(lines[0]!, /^No dice needed \(they'd do it anyway \(guarded, free, wary\)\): what the player is attempting works, in the people's own way and voice\. Decided, and it stands [^:]*: Cob drags the left boot off/);
  assert.match(lines[1]!, /^The scene has moved on to "What Prout found"/);
  const lie = toRuling(scene, state, { ...LINING, lie: true, approach: "excellent", disposition: "friendly" }, META);
  const route = rulingRoute(scene, state, lie, verdict(scene, lie));
  const roll = { skill: "deception", dc: 10, die: 14, modifier: 2, total: 16, success: true, critical: null };
  const won = rulingDirective(scene, state, lie, verdict(scene, lie), { transition: route, phase: "attempt", to: "motive", chosen: true, roll }, lie.success);
  assert.match(won[0]!, /^The player's attempt called for a Deception check to get the boy in the too-big boots to open the boot's lining\. Deception check: 14 \+ 2 = 16 vs DC 10: success\. Decided.* the boy in the too-big boots gives way, but will remember how: the lie is believed, for now\.$/);
});
