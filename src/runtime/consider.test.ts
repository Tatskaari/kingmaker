import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
const RUNS = mkdtempSync(join(tmpdir(), "km-consider-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.OPENROUTER_API_KEY = "offline";
const { sceneById } = await import("../../scenes/index.ts");
const { effectiveScene, presentCast } = await import("./brief.ts");
const { rng } = await import("./dice.ts");
const { diceReason, landRuling, reviewInput, settleRuling, toRuling, verdict } = await import("./consider.ts");
const { playerTurn } = await import("./engine.ts");
const { owedAtEnd } = await import("./owed.ts");
const { sessionDir } = await import("./session.ts");
const { setCallLog } = await import("../llm/openrouter.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
const { buildWorld } = await import("../world/scene-world.ts");
type SessionState = import("./session.ts").SessionState;
type Judged = import("./consider.ts").Judged;

/**
 * Considered rolls (src/runtime/consider.ts): the verdict from the GM's judgements, the ruling made
 * safe against the scene (a lie rolled as one, a success that's no success, a dice line with nothing
 * the player hasn't heard), the transition a ruling makes when it's settled, what it brings out
 * landing as it says (and settling what's owed), and whole considered turns played through the
 * engine with OpenRouter stood in for: a ruling, a review past its deadline, and one that ran to its
 * token cap.
 */

const authored = sceneById("hanged-clerk");
const scene = effectiveScene(authored, []);
const PAGE = scene.beats.find(b => b.id === "yard")!.transitions.find(t => t.id === "page-found")!.establishes![0]!;

/** A seed whose first d20 is neither 1 nor 20: with a big modifier either way, the outcome is certain. */
function plainSeed(): number {
  for (let seed = 1; ; seed++) { const die = 1 + Math.floor(rng(seed + 7919)() * 20); if (die > 1 && die < 20) return seed; }
}

/** The granary yard, before anything has troubled the suicide story; no character sheet, so the dice are the session's. */
function yard(persuasion: number, id = `consider-${Math.random().toString(36).slice(2, 8)}`): SessionState {
  return {
    id, sceneId: "hanged-clerk", approach: "v2", seed: plainSeed(), rollCount: 0,
    player: { name: "Pell Marrow", concept: "a hedge-wizard with a scorched hat", modifiers: { persuasion, deception: persuasion } },
    turn: 4, beat: "yard", turnsInBeat: 3, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [],
  };
}

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
  // The barbarian's game: an excellent approach at a gap of 0 needs no roll (it failed on a 4 at DC 10),
  // and a weak one on a hostile holder of something dangerous is a no, not a third DC 18 in five turns.
  assert.equal(on({ stakes: "dangerous", approach: "excellent", disposition: "wary" }).kind, "yes", "barbarian#48's T42");
  assert.deepEqual(on({ stakes: "dangerous", approach: "weak", disposition: "hostile" }), { kind: "no", no: "refused", why: "not like this: it's too far from what would move them (dangerous, weak, hostile)" }, "barbarian#48's T11");
  assert.equal(on({ approach: "excellent", disposition: "friendly" }, "deception").dc, 10, "a lie that would be enough can always be seen through: it rolls, low");
  assert.equal(on({ stakes: "ruinous", approach: "weak", disposition: "hostile" }, "deception").kind, "no", "and one too far is a no like any other");
  assert.equal(on({ approach: "free", disposition: "hostile" }).kind, "yes", "they'd do it anyway");
  assert.equal(on({ stakes: "trivial" }).kind, "yes");
  assert.equal(on({ approach: "no_chance" }).kind, "no", "a lever that can't move them");
  assert.equal(on({ sameAgain: true }).kind, "no", "the same push again");
  assert.equal(verdict(scene, { target: "cob", skill: "persuasion", judged: judged({}), hollow: "no roll could get them that here" }).kind, "no", "a success that's no success: nothing to roll for");
  // A feat: no one being worked on (or a skill that isn't for people).
  const feat = (difficulty: Judged["difficulty"]) => verdict(scene, { target: "world", skill: "athletics", judged: judged({ difficulty }) });
  assert.deepEqual(["trivial", "easy", "moderate", "hard", "impossible"].map(d => feat(d as Judged["difficulty"]).dc ?? feat(d as Judged["difficulty"]).kind), ["yes", 10, 13, 16, "no"]);
  assert.equal(verdict(scene, { target: "world", skill: "sleight_of_hand", judged: judged({ difficulty: "hard" }) }).dc, 16, "taking a thing nobody's watching is a feat");
});

test("a lift, a snatch or a slip past someone is a contest with them, and rolled; contradictory reads are reconciled, and a success written as being caught is no success (thief#1, barbarian#53)", async () => {
  const lift = (j: Partial<Judged>, target = "cob", where = scene) => verdict(where, { target, skill: "sleight_of_hand", judged: judged(j) });
  assert.deepEqual(lift({ difficulty: "trivial" }), { kind: "roll", dc: 12, why: "guarded to lose, plausible cover, wary: they could notice" }, "not 'nothing stands in the way': Cob could notice");
  // The thief's T56: Sallow's purse, picked in front of the King, the Marshal and Kell, was ruled trivial and done without a roll.
  assert.deepEqual(lift({ stakes: "dangerous", approach: "plausible", disposition: "hostile", difficulty: "trivial" }, "sallow", sceneById("kings-morning")), { kind: "roll", dc: 18, why: "dangerous to lose, plausible cover, hostile: they could notice" });
  assert.equal(lift({ stakes: "trivial", approach: "excellent", disposition: "friendly" }).dc, 10, "even their eyes elsewhere at the perfect moment rolls: it can always be noticed");
  assert.equal(verdict(scene, { target: "moll", skill: "stealth", judged: judged({ stakes: "ruinous", approach: "weak", disposition: "hostile" }) }).dc, 18, "a long shot past someone watching is still a try");
  assert.equal(lift({ approach: "free" }).kind, "yes", "they'd let them anyway");
  // The thief's T4: no chance, but trivial; the two reads disagree, so it's tried.
  assert.deepEqual(lift({ approach: "no_chance", difficulty: "trivial" }), { kind: "roll", dc: 15, why: "guarded to lose, weak cover, wary: they could notice" });
  assert.equal(lift({ approach: "no_chance", difficulty: "impossible" }).kind, "no", "both reads say it can't be done under their eyes");
  // And as the review wrote T4: its "success" is Cob catching the thief's wrist and shutting a way of trying. That's no success.
  const state = yard(7);
  const caught = toRuling(scene, state, {
    act: "secretly feel inside Cob's left boot", target: "cob", lie: false, skill: "sleight_of_hand", stakes: "guarded", approach: "no_chance", disposition: "wary", same_again: false, difficulty: "trivial", reason: "to feel for what Cob has tucked inside his left boot",
    success: outcome({ happens: "Your fingers find something stiff in the boot lining, but Cob catches your wrist and yanks the boot away before you can get it out.", gets: "some", establishes: ["Cob knows Nim tried to feel inside his boot without permission."], closes: ["coax-cob"] }),
    failure: outcome({ happens: "Cob jerks away and bolts behind the water butt and through the loose board into the granary.", gets: "none", establishes: ["Cob has fled into the granary through the loose board."], closes: ["coax-cob"] }),
  }, META);
  assert.equal(caught.hollow, "no roll could get them that here");
  const settled = await settleRuling(scene, state, caught);
  assert.deepEqual([settled.record.kind, settled.record.went, state.patches], ["no", "failure", []], "not recorded as a success, and the polite ask (coax-cob) stays open");
  assert.match(settled.directive[0]!, /^No dice: this can't get them what they're after .*Cob catches your wrist/);
  const plain = await settleRuling(scene, yard(7), { ...caught, hollow: undefined, judged: { ...caught.judged, difficulty: "impossible" } });
  assert.match(plain.directive[0]!, /^No dice: not like this \(it can't be done under their eyes like this \(guarded to lose, no chance cover, wary\)\)\. Show plainly what stops it/, "the no isn't Cob's to give: he never knew");
});

type OutcomeJson = { happens: string; gets: string; to: string; counts_as: string; establishes: string[]; reveals: string[]; closes: string[] };
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
const PENNY = { turn: 2, act: "Offer a penny for a look in Cob's left boot", target: "cob", skill: "persuasion" as const, kind: "roll" as const, dc: 15, why: "guarded, weak, hostile",
  roll: { skill: "persuasion", dc: 15, die: 6, modifier: 2, total: 8, success: false, critical: null }, went: "failure" as const,
  changed: "Cob snatches the penny and backs toward the water butt, clamping a hand over the left boot", costUsd: 0, latencyMs: 0 };

test("the same push again gets the same answer, whatever else the review says; but only when something has failed here to be the same as (goals#58, robust#74)", () => {
  // The goals tester's T3: "Fair's fair: let me have that look", after the penny failed, judged trivial and the same push.
  const state = yard(0);
  state.rulings = [PENNY];
  const fair = toRuling(scene, state, { ...LINING, stakes: "trivial", approach: "weak", disposition: "hostile", same_again: true }, META);
  assert.equal(fair.judged.sameAgain, true);
  assert.deepEqual(verdict(scene, fair), { kind: "no", no: "same_again", why: "the same push again, with nothing new" }, "trivial stakes don't make it a yes");
  assert.equal(verdict(scene, { ...fair, judged: { ...fair.judged, approach: "free" } }).kind, "no", "nor does free");
  assert.equal(verdict(scene, { target: "world", skill: "athletics", judged: judged({ difficulty: "easy", sameAgain: true }) }).kind, "no", "a feat that failed, tried the same way again");
  // Nothing has failed in this scene: the review's same_again is no reason to refuse.
  const fresh = yard(0);
  const first = toRuling(scene, fresh, { ...LINING, same_again: true }, META);
  assert.equal(first.judged.sameAgain, false);
  assert.equal(verdict(scene, first).kind, "roll");
});

test("the review is given what was tried, each try in the player's own words, to tell the same push from a new one (wizard#15)", () => {
  const state = yard(0);
  state.rulings = [PENNY];
  state.transcript.push(
    { turn: 2, scene: "hanged-clerk", speaker: "player", kind: "player", text: "Not buying the boots, Cob. (I hold up a silver penny.) This is yours if I can see what's crackling in there." },
    { turn: 3, scene: "hanged-clerk", speaker: "player", kind: "player", text: "You saw him jump, Moll? Tell it again." },
  );
  state.path.push({ turn: 3, from: "yard", to: "yard", via: "catch-moll", source: "pre", roll: { skill: "insight", dc: 13, die: 4, modifier: 1, total: 5, success: false, critical: null } });
  const input = reviewInput(scene, state, "The drizzle started before midnight, and the loft door is barred. Who taught you that story?", undefined);
  assert.match(input, /## Your earlier rulings in this scene \(each with what the player said and did\)\n- turn 2: Offer a penny .*backs toward the water butt, clamping a hand over the left boot\. The player: "Not buying the boots, Cob\. \(I hold up a silver penny\.\) This is yours/);
  assert.match(input, /## Routes you wrote that were rolled in this scene and failed\n- turn 3: The player presses on the holes in Moll's .* The player: "You saw him jump, Moll\? Tell it again\."/);
});

test("the review knows the beat and the cast: what people are doing at this point, so what the beat gives freely is free (barbarian#39, robust#82)", () => {
  const drownedRat = effectiveScene(sceneById("drowned-rat"), []);
  const input = reviewInput(drownedRat, rat(), "Now: this Master. Name, and where he keeps himself.", undefined);
  assert.match(input, /## Where the scene is: \[confession\] I only held the rope\nHobb is talking, or starting to\.[^\n]*comes out as the player asks for it/);
  assert.match(input, /What the people here are doing at this point \(what this says they give freely, or when asked, is free\):\n- Big Hobb Mallory: Tell the loft first, then answer what you're asked, one thing at a time\. When it's out, ask what's to become of you\. The token's only brass: give it up if asked\.\n- Sergeant Agnes Kell: Write it down\./);
});

test("a ruling is held to the scene: an outcome counts as the route it amounts to, closes only ways of trying, and always changes something", () => {
  const state = yard(0);
  const ruling = toRuling(scene, state, {
    ...LINING,
    success: outcome({ happens: "He opens it.", gets: "all", counts_as: "page-found", reveals: ["page", "nonsense"] }),
    failure: outcome({ happens: "Cob shakes his head.", gets: "none" }),
  }, META);
  assert.equal(ruling.success.to, "motive", "the page found leads where its route leads");
  assert.deepEqual(ruling.success.establishes, [PAGE], "with the route's own facts (the exit scripts read them)");
  assert.deepEqual(ruling.success.reveals, ["page"]);
  assert.equal(ruling.failure.to, undefined);
  assert.equal(ruling.failure.establishes.length, 1, "a failure that changed nothing is on the record at least");
  assert.match(ruling.failure.establishes[0]!, /it failed: Cob shakes his head\./);
  assert.equal(ruling.hollow, undefined);
  // What a failure shuts is a way of trying (a route with a roll): never giving up.
  const shut = toRuling(scene, state, { ...LINING, failure: outcome({ happens: "Moll swears blind it's true and drags Cob off through the gap.", gets: "none", closes: ["concede", "catch-moll"] }) }, META, { read: { probability: 0.8, routes: [{ id: "catch-moll", p: 0.4 }] } });
  assert.deepEqual(shut.failure.closes, ["catch-moll"], "giving up isn't a way of trying the ruling can shut");
});

test("a lie is rolled as Deception, however friendly its words: by the review's read, or the decider's", () => {
  const state = yard(0);
  assert.equal(toRuling(scene, state, { ...LINING, lie: true }, META).skill, "deception", "a made-up promise is a lie");
  assert.equal(toRuling(scene, state, LINING, META, { read: { probability: 0.9, routes: [], means: "deception" } }).skill, "deception", "the decider read the method as a lie");
  assert.equal(toRuling(scene, state, LINING, META).skill, "persuasion", "an honest bargain");
  assert.equal(toRuling(scene, state, { ...LINING, skill: "intimidation", lie: true }, META).skill, "intimidation", "a bluffed threat is still a threat");
});

test("a success that's no success is a no without dice, and its own refusal is the answer, not the failure's cost; one that comes to the same either way is a yes", async () => {
  const state = yard(30);
  const refusal = toRuling(scene, state, json(
    outcome({ happens: "Kell refuses to put her truncheon to the lock.", gets: "none", establishes: ["Kell refuses to break the padlock without lawful authority."] }),
    outcome({ happens: "Kell refuses, and writes the claim down.", gets: "none", establishes: ["Kell refuses to break the padlock without lawful authority.", "Kell has written down the player's claim."] }),
  ), META);
  assert.equal(refusal.hollow, "no roll could get them that here");
  const settled = await settleRuling(scene, state, refusal);
  assert.equal(settled.move.roll, undefined, "nothing rolled");
  assert.deepEqual([settled.record.kind, settled.record.went], ["no", "failure"]);
  assert.match(settled.directive[0]!, /^No dice: this can't get them what they're after \(no roll could get them that here\)\. Decided, and it stands [^:]*: Kell refuses to put her truncheon to the lock\. .*It's an honest no: it costs the player nothing more than the no/);
  assert.doesNotMatch(settled.directive.join("\n"), /writes the claim down/, "not the failure's cost");
  assert.deepEqual(settled.move.transition.establishes, ["Kell refuses to break the padlock without lawful authority."]);
  // The same either way, and it gets them what they were after: the dice don't matter, and it's a yes.
  const same = toRuling(scene, state, json(
    outcome({ happens: "Cob takes the shilling.", gets: "some", establishes: ["Cob has the player's shilling."] }),
    outcome({ happens: "Cob takes the shilling.", gets: "some", establishes: ["Cob has the player's shilling."] }),
  ), META);
  assert.deepEqual([same.hollow, same.foregone], [undefined, "either way it comes to the same"]);
  const took = await settleRuling(scene, state, same);
  assert.deepEqual([took.move.roll, took.record.kind, took.record.went], [undefined, "yes", "success"]);
});

/** The Drowned Rat with Hobb talking (the confession beat), as the barbarian had it. */
function rat(beat = "confession"): SessionState {
  return {
    id: `consider-rat-${Math.random().toString(36).slice(2, 8)}`, sceneId: "drowned-rat", approach: "v2", seed: plainSeed(), rollCount: 0,
    player: { name: "Grukka", concept: "a half-orc barbarian with a greataxe", modifiers: { persuasion: 0, intimidation: 3, sleight_of_hand: 0 } },
    turn: 24, beat, turnsInBeat: 2, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [],
  };
}

test("a no without dice is an honest refusal: all his coin for Hobb's mum gets 'Coin won't keep her safe', not Hobb bolting (barbarian#38)", async () => {
  const drownedRat = effectiveScene(sceneById("drowned-rat"), []);
  const state = rat();
  // The review's answer at the barbarian's T24, as it came.
  const ruling = toRuling(drownedRat, state, {
    act: "Offer Hobb all your coin in exchange for what would keep his mother safe tonight", target: "hobb", lie: false, skill: "persuasion",
    stakes: "dangerous", approach: "weak", disposition: "wary", same_again: false, difficulty: "trivial", reason: "to get Hobb to tell you what would keep his mother safe tonight",
    success: outcome({ happens: "Hobb looks at the coins, then closes your fingers around them with his good hand. “Keep it, sir. Coin won’t keep her safe. Don’t go near her. Please.” He turns toward the door, still frightened, but stays to hear what you say next.", gets: "none", establishes: ["Hobb has refused Grukka's money"] }),
    failure: outcome({ happens: "Hobb stares at the coins, then recoils as if they were a threat. “No, sir. Don’t buy her.” He pushes past toward the dark stairs; Kell moves after him, notebook in hand, as Hobb bolts from the Rat.", gets: "none", to: "hobb-fled", counts_as: "hobb-runs", establishes: ["Hobb has fled into the dark to warn his master"], closes: ["turn-hobb", "mum-safe"] }),
  }, META);
  const settled = await settleRuling(drownedRat, state, ruling);
  assert.deepEqual([settled.record.kind, settled.record.went, settled.move.to, settled.move.exit], ["no", "failure", "confession", undefined], "he stays, and the scene with him");
  assert.match(settled.directive[0]!, /Coin won’t keep her safe/);
  assert.doesNotMatch(settled.directive.join("\n"), /Hobb bolts|hobb-fled|is shut/);
  assert.deepEqual(state.patches, [], "nothing shut: mum-safe is still a way to try");
  // Asked plainly with nothing on the table that could move him: a plain no, and nothing else.
  const plain = await settleRuling(drownedRat, state, { ...ruling, hollow: undefined, judged: { ...ruling.judged, approach: "no_chance" } });
  assert.match(plain.directive[0]!, /^No dice: The big man with the bandaged hand won't, not like this \(it pulls a lever that can't move them \(dangerous, no chance, wary\)\)\. They say no in their own words and character, and their reaction shows what kind of thing would reach them/);
  assert.deepEqual([plain.move.to, plain.move.transition.establishes, plain.record.changed], ["confession", undefined, "The big man with the bandaged hand said no, and nothing else changed"]);
  assert.deepEqual(plain.withheld, [], "nothing either way would have brought out");
});

test("a no to the same push keeps the answer it got before; a follow-up that gives the player the same either way is a yes, not a failure (barbarian#38's T32)", async () => {
  const state = yard(0);
  state.rulings = [PENNY];
  const again = await settleRuling(scene, state, toRuling(scene, state, { ...LINING, same_again: true }, META));
  assert.match(again.directive[0]!, /^No dice: this is the same push that already failed in this scene, with nothing new on the table, so it gets the same answer it got before\. The boy in the too-big boots holds, as before/);
  assert.deepEqual([again.move.to, again.move.transition.establishes, again.record.changed], ["yard", undefined, "the same answer as before: nothing changed"]);
  // The barbarian's T32: the practical bits of what Hobb had agreed to, written the same either way.
  const drownedRat = effectiveScene(sceneById("drowned-rat"), []);
  const told = outcome({ happens: "Hobb nods toward the downriver wharves. “Eleventh bell. The river door, off the plank walk. Show the token at the grille.”", gets: "all", counts_as: "told-heron", establishes: ["Hobb has told Grukka how to use the token at the river-door grille."], reveals: ["none"], closes: ["none"] });
  const follow = toRuling(drownedRat, rat(), { ...LINING, act: "Ask Hobb how to use the token and when to go", target: "hobb", approach: "plausible", success: told, failure: told }, META);
  const settled = await settleRuling(drownedRat, rat(), follow);
  assert.deepEqual([settled.record.kind, settled.record.went, settled.record.why], ["yes", "success", "either way it comes to the same"]);
});

test("the dice line says nothing the player hasn't heard: names as they'd call people, 'you', and the plain goal for a place they don't know of", () => {
  const state = yard(0);
  state.world = buildWorld(authored.id, authored.world!, presentCast(authored, state).map(c => ({ id: c.id, name: c.name })), state.player);
  const cob = { target: "cob", skill: "persuasion" as const };
  assert.equal(diceReason(scene, state, "to get Cob to tell Pell what he saw last night.", cob), "to get the boy in the too-big boots to tell you what he saw last night");
  assert.equal(diceReason(scene, state, "to make Moll name Master Sallow", { target: "moll", skill: "intimidation" }, [{ name: "Master Josiah Sallow", called: "the gentleman with the silver-topped cane" }]),
    "to make the girl in the shawl name the gentleman with the silver-topped cane");
  assert.equal(diceReason(scene, state, "to get Cob to show you the tally desk", cob), "to win the boy in the too-big boots over", "the tally desk is in the loft, and nobody has said a word of it");
  state.transcript.push({ turn: 1, scene: "hanged-clerk", speaker: "cob", kind: "dialogue", text: "Cob's seen the tally desk. Cob's been everywhere." });
  assert.equal(diceReason(scene, state, "to get Cob to show you the tally desk", cob), "to get Cob to show you the tally desk", "once it's been said (and so has his name), it's theirs");
});

test("a ruling settled: a roll it wins takes the scene where success leads, with its facts; what comes out, as the ruling says it", async () => {
  const state = yard(30);
  const settled = await settleRuling(scene, state, toRuling(scene, state, LINING, META));
  assert.equal(settled.move.roll?.dc, 12);
  assert.equal(settled.move.roll?.success, true);
  assert.equal(settled.move.to, "motive");
  assert.equal(settled.move.chosen, true);
  assert.deepEqual(settled.move.transition.check?.establishes?.success, [PAGE]);
  assert.match(settled.dice!, /^Persuasion check to get the boy in the too-big boots to open the boot's lining: \d+ \+ 30 = \d+ vs DC 12: success$/);
  assert.match(settled.directive[0]!, /Decided, and it stands \(people react to it, but nothing in this reply undoes, reverses or spoils it\): Cob drags the left boot off.*What comes out is what's written here, in these terms, and no more/);
  assert.doesNotMatch(settled.directive.join("\n"), /Prout found grain written off/, "the GM gets what the ruling says comes out, not the essential's own text");
  assert.match(settled.directive[1]!, /The scene has moved on to "What Prout found"/);
  assert.deepEqual([settled.record.kind, settled.record.went, settled.record.dc], ["roll", "success", 12]);
  assert.deepEqual([settled.found, settled.withheld], [["page"], []]);
  assert.equal(state.patches.length, 0, "nothing closed on a success");
});

test("a ruling settled: a roll it loses costs what failure costs, a way of trying it shut (one really tried) stays shut, and what success would have brought out is kept back", async () => {
  const state = yard(-30);
  // The decider read the attempt as winning Cob round, in part: that way has been tried.
  const settled = await settleRuling(scene, state, toRuling(scene, state, LINING, META, { read: { probability: 0.8, routes: [{ id: "win-cob", p: 0.4 }] } }));
  assert.equal(settled.move.roll?.success, false);
  assert.equal(settled.move.to, "yard", "the scene stays where it is");
  assert.equal(settled.move.chosen, false);
  assert.deepEqual(settled.move.transition.check?.establishes?.failure, ["Cob has bolted into the granary through the gap behind the water butt."]);
  assert.match(settled.directive[0]!, /Decided, and it stands [^:]*: Cob jeers and bolts/);
  assert.match(settled.directive.at(-1)!, /this way of trying is shut, for the rest of the scene: The player pushes past Cob's hostility/);
  assert.deepEqual(state.patches.map(p => p.close), [{ beat: "yard", id: "win-cob" }]);
  const after = effectiveScene(authored, state.patches);
  assert.ok(!after.beats.find(b => b.id === "yard")!.transitions.some(t => t.id === "win-cob"), "gone from the yard");
  assert.ok(after.beats.find(b => b.id === "doubt")!.transitions.some(t => t.id === "win-cob"), "the doubt beat's own is another route");
  assert.deepEqual([settled.found, settled.withheld], [[], ["page"]]);
  // Whatever the reply let slip, what the dice kept back hasn't been come across; anything else read as come across has.
  assert.deepEqual(landRuling(state, settled, ["page", "silvertop"]), ["silvertop"]);
  assert.deepEqual(state.landed, ["silvertop"]);
});

test("ways of trying close only when they've really been tried: a lie about a blade, read as scaring the kids, doesn't shut winning Cob round (thief#3)", async () => {
  const state = yard(-30);
  // The thief's T5, as the decider read it (scare-kids .34, win-cob .02) and as the review wrote its failure.
  const read = { probability: 0.67, routes: [{ id: "scare-kids", p: 0.34 }, { id: "win-cob", p: 0.02 }], means: "deception" as const };
  const lie = toRuling(scene, state, {
    act: "Reassure Cob with a false excuse", target: "cob", lie: true, skill: "deception", stakes: "guarded", approach: "plausible", disposition: "wary", same_again: false, difficulty: "moderate", reason: "to make Cob believe you were checking for a knife",
    success: outcome({ happens: "Cob loosens his grip on the boot and admits he saw Prout sewing something into one of them two nights ago.", gets: "some", establishes: ["Cob says he saw Prout sew something into one boot."] }),
    failure: outcome({ happens: "Cob jerks away toward the water butt, shouting that you're a liar who tried to steal his boots.", gets: "none", establishes: ["Kell records that Nim tried to take something from Cob's boot."], closes: ["win-cob", "scare-kids"] }),
  }, META, { read });
  assert.deepEqual(lie.failure.closes, ["scare-kids"], "only the way it was read as");
  const settled = await settleRuling(scene, state, lie);
  assert.equal(settled.move.roll?.success, false);
  assert.deepEqual(state.patches.map(p => p.close?.id), ["scare-kids"]);
  const after = effectiveScene(authored, state.patches);
  assert.ok(after.beats.find(b => b.id === "yard")!.transitions.some(t => t.id === "win-cob"), "winning Cob round is still a way to try");
  assert.ok(after.beats.find(b => b.id === "yard")!.transitions.some(t => t.id === "trust-cob"), "and so is his trust, which no ruling can shut");
});

test("a ruling with no roll: yes takes success's way, no stays where it is and costs nothing; a roll lost towards an ending the player didn't choose holds it for their answer", async () => {
  const yes = yard(0);
  const free = await settleRuling(scene, yes, toRuling(scene, yes, { ...LINING, approach: "free" }, { costUsd: 0, latencyMs: 0 }));
  assert.equal(free.move.roll, undefined);
  assert.equal(free.dice, undefined);
  assert.deepEqual([free.move.to, free.move.chosen, free.record.kind], ["motive", true, "yes"]);
  assert.deepEqual(free.move.transition.establishes, [PAGE]);
  assert.match(free.directive[0]!, /^No dice needed \(they'd do it anyway/);
  const tull = outcome({ happens: "Kell has had enough: she tells Tull to take him.", gets: "none", to: "closed-suicide" });
  const no = yard(0);
  const ruled = await settleRuling(scene, no, toRuling(scene, no, { ...LINING, approach: "no_chance", failure: tull }, { costUsd: 0, latencyMs: 0 }));
  assert.deepEqual([ruled.move.to, ruled.move.exit, ruled.record.kind], ["yard", undefined, "no"], "a no isn't the failure's cost");
  assert.match(ruled.directive[0]!, /^No dice: The boy in the too-big boots won't, not like this \(it pulls a lever that can't move them/);
  assert.doesNotMatch(ruled.directive.join("\n"), /Tull/);
  const lost = yard(-30);
  const rolled = await settleRuling(scene, lost, toRuling(scene, lost, { ...LINING, failure: tull }, { costUsd: 0, latencyMs: 0 }));
  assert.deepEqual([rolled.move.roll?.success, rolled.move.to, rolled.move.chosen, rolled.move.exit?.id], [false, "closed-suicide", false, "closed-suicide"]);
  assert.match(rolled.directive[1]!, /Things are escalating towards this/);
});

test("a considered turn, played: one decision, the GM's ruling a step at a time, the roll, the move, and a reply that plays what was decided", async () => {
  const fake = fakeOpenRouter({ choices: { roll_call: "new" }, byName: { ruling: LINING }, replies: ["Cob scowls, then hauls the boot off and picks at the lining. A folded page comes out."] });
  try {
    const state = yard(30, "consider-played");
    setCallLog(join(sessionDir(state.id), "calls.jsonl"));
    const steps: string[] = [];
    const turn = await playerTurn(state, "*crouches by Cob* Take the left boot off yourself and feel along the lining with your own fingers.", { onStep: s => steps.push(s) });
    assert.deepEqual(steps, ["consider", "weigh", "success", "failure", "roll"], "each step of the ruling, as it starts");
    assert.match(turn.entries.find(e => e.kind === "roll")!.text, /^Persuasion check to get Cob to open the boot's lining: .* vs DC 12: success$/, "the player has said his name");
    assert.equal(state.beat, "motive");
    assert.ok(state.established.includes(PAGE));
    assert.deepEqual(state.path.map(p => [p.from, p.to, p.via]), [["yard", "motive", `considered-${state.turn}`]]);
    assert.deepEqual(state.rulings?.map(r => [r.kind, r.went, r.dc]), [["roll", "success", 12]]);
    assert.deepEqual(state.landed, ["page"], "what the ruling brought out has been come across");
    assert.ok(turn.metric.considerMs !== undefined && turn.metric.considerMs >= 0);
    assert.equal(fake.sent.find(b => b.text?.format?.name === "ruling")?.max_output_tokens, 1000, "the review's output is capped near 1,000 tokens");
    const calls = readFileSync(join(sessionDir(state.id), "calls.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l) as { operation: string; request?: { input?: Array<{ content: string }> } });
    assert.deepEqual(calls.filter(c => c.operation.startsWith("director.")).map(c => c.operation), ["director.before", "director.after"], "no decider call of its own");
    const told = calls.find(c => c.operation === "gm.reply")!.request!.input!.at(-1)!.content;
    assert.match(told, /## For this reply\n[\s\S]*The player's attempt called for a Persuasion check to get Cob to open the boot's lining\. Persuasion check: \d+ \+ 30 = \d+ vs DC 12: success\. Decided, and it stands [^:]*: Cob drags the left boot off/);
    assert.match(told, /The scene has moved on to "What Prout found"/);
    assert.doesNotMatch(told, /What the player just did is the kind of thing people in this world would really answer/, "the ruling carries the consequences: no bill on top");
  } finally {
    fake.restore();
    setCallLog(undefined);
  }
});

test("a ruling that brings out what the story owes the player settles it: Prout's page, in the Drowned Rat", async () => {
  const rat = sceneById("drowned-rat");
  const missed = authored.essentials!.find(e => e.id === "page")!;
  const prepped = rat.essentials!.find(e => e.id === "prouts-page")!;
  const state: SessionState = {
    id: "consider-owed", sceneId: "drowned-rat", approach: "v2", seed: plainSeed(), rollCount: 0,
    player: { name: "Pell Marrow", concept: "a hedge-wizard with a scorched hat", modifiers: { persuasion: 3 } },
    turn: 3, beat: "the-rat", turnsInBeat: 2, path: [], established: [], canon: [], notes: null, notesTurn: null,
    // As the boundary left it: the page missed at the granary, owed, and the Rat's own prep for it brought over.
    patches: [{ turn: 0, essential: prepped, why: "Brought over from hanged-clerk, where the player missed it" }],
    owed: [{ from: "hanged-clerk", id: "page", essential: missed, holders: ["cob"] }],
    repairs: [], transcript: [], metrics: [], history: [],
  };
  const trust = json(
    outcome({ happens: "Cob sits on an upturned pot, unlaces the left boot and picks the lining open: a folded page, held out like it might bite.", gets: "all", counts_as: "trust-cob" }),
    outcome({ happens: "Cob yells for Nan, who comes round the bar to ask what the player wants with her pot-boy's boots.", gets: "none", establishes: ["Nan is keeping an eye on the player and her pot-boy."] }),
  );
  const fake = fakeOpenRouter({ choices: { roll_call: "new" }, byName: { ruling: { ...trust, approach: "free" } }, replies: ["Cob unlaces the boot. The page comes out, soft at the corners."] });
  try {
    assert.equal(owedAtEnd(rat, state).length, 1, "owed as the scene starts");
    await playerTurn(state, "*in the scullery, out of the big man's sight* Nobody hears your name from me, Cob. Not the watch, not him. Show me what crackles in that boot.");
    assert.deepEqual(state.rulings?.map(r => [r.kind, r.went]), [["yes", "success"]]);
    assert.ok(state.landed?.includes("prouts-page"), "counted as Cob trusting them with it, the page has come out");
    assert.deepEqual(owedAtEnd(rat, state), [], "and the story owes the player nothing more");
  } finally {
    fake.restore();
  }
});

test("a review past its deadline is cut off, and the turn rolls without it", async () => {
  process.env.KM_CONSIDER_DEADLINE_MS = "200";
  const fake = fakeOpenRouter({ choices: { roll_call: "new" }, stall: ["ruling"], replies: ["Cob considers the offer, scowling."] });
  try {
    const state = yard(0, "consider-stalled");
    const steps: string[] = [];
    const started = performance.now();
    const turn = await playerTurn(state, "*crouches by Cob* Take the left boot off yourself and feel along the lining with your own fingers.", { onStep: s => steps.push(s) });
    assert.ok(performance.now() - started < 5000, "the turn didn't wait on the review");
    assert.match(turn.metric.considerError ?? "", /took longer than 200 ms/);
    assert.deepEqual([steps[0], steps.at(-1)], ["consider", "roll"]);
    assert.match(turn.entries.find(e => e.kind === "roll")!.text, /^\w+ check: \d+ \+ \d+ = \d+ vs DC \d+: (success|failure)/, "the freeform roll");
    assert.deepEqual(state.path.map(p => p.via), ["freeform"]);
    assert.equal(state.rulings, undefined);
  } finally {
    delete process.env.KM_CONSIDER_DEADLINE_MS;
    fake.restore();
  }
});

test("a review that runs to its token cap is billed all the same: what it cost counts in the turn", async () => {
  const fake = fakeOpenRouter({ choices: { roll_call: "new" }, capped: { ruling: 0.004 }, replies: ["Cob considers the offer, scowling."] });
  try {
    const state = yard(0, "consider-capped");
    const turn = await playerTurn(state, "*crouches by Cob* Take the left boot off yourself and feel along the lining with your own fingers.");
    assert.match(turn.metric.considerError ?? "", /response incomplete \(max_output_tokens\)/);
    assert.ok(turn.metric.costUsd >= 0.008, `the try and its retry, both capped, are in the turn's cost ($${turn.metric.costUsd})`);
    assert.deepEqual(state.path.map(p => p.via), ["freeform"]);
  } finally {
    fake.restore();
  }
});

test("an ordinary turn under considered rolls asks no more and waits for nothing", async () => {
  const fake = fakeOpenRouter({ replies: ["Kell nods. “At first light.”"] });
  try {
    const state = yard(0, "consider-ordinary");
    setCallLog(join(sessionDir(state.id), "calls.jsonl"));
    const steps: string[] = [];
    const turn = await playerTurn(state, "Who found him, Sergeant?", { onStep: s => steps.push(s) });
    assert.deepEqual(steps, []);
    assert.equal(turn.metric.considerMs, undefined);
    assert.equal(state.rulings, undefined);
    // The reply, and nothing before it but the decider's (the decision, disclosure): what comes after
    // it is the notes on its spoken line (src/runtime/notes.ts).
    const calls = readFileSync(join(sessionDir(state.id), "calls.jsonl"), "utf8").trim().split("\n").map(l => (JSON.parse(l) as { operation: string }).operation);
    assert.deepEqual(calls.filter(op => !/^(director|memory)\./.test(op)), ["gm.reply", "notes"], "the reply, and nothing before it");
    assert.equal(fake.asked.filter(p => p.endsWith("/responses")).length, 2, "the reply and its notes");
  } finally {
    fake.restore();
    setCallLog(undefined);
  }
});
