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
const { diceReason, landRuling, settleRuling, toRuling, verdict } = await import("./consider.ts");
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

test("the verdict: the guidance's grid for someone worked on, leaning to the dice; a feat's difficulty otherwise", () => {
  const on = (j: Partial<Judged>, skill: "persuasion" | "deception" | "intimidation" = "persuasion") => verdict(scene, { target: "cob", skill, judged: judged(j) });
  assert.deepEqual([on({}).kind, on({}).dc], ["roll", 12], "guarded, plausible, wary: the middle of the grid");
  assert.equal(on({ stakes: "dangerous" }).dc, 15);
  assert.equal(on({ stakes: "ruinous", approach: "weak", disposition: "hostile" }).dc, 18, "a long shot rolls at 18, not a no on the GM's say-so");
  assert.equal(on({ approach: "strong" }).dc, 10, "leverage that nearly settles it still rolls, low");
  assert.equal(on({ approach: "excellent", disposition: "friendly" }).kind, "yes", "overwhelming: no dice");
  assert.equal(on({ approach: "excellent", disposition: "friendly" }, "deception").dc, 10, "but a lie can always be seen through");
  assert.equal(on({ approach: "free", disposition: "hostile" }).kind, "yes", "they'd do it anyway");
  assert.equal(on({ stakes: "trivial" }).kind, "yes");
  assert.equal(on({ approach: "no_chance" }).kind, "no", "a lever that can't move them");
  assert.equal(on({ sameAgain: true }).kind, "no", "the same push again");
  assert.equal(verdict(scene, { target: "cob", skill: "persuasion", judged: judged({}), hollow: "no roll could get them that here" }).kind, "no", "a success that's no success: nothing to roll for");
  // A feat: no one being worked on (or a skill that isn't for people).
  const feat = (difficulty: Judged["difficulty"]) => verdict(scene, { target: "world", skill: "athletics", judged: judged({ difficulty }) });
  assert.deepEqual(["trivial", "easy", "moderate", "hard", "impossible"].map(d => feat(d as Judged["difficulty"]).dc ?? feat(d as Judged["difficulty"]).kind), ["yes", 10, 13, 16, "no"]);
  assert.equal(verdict(scene, { target: "cob", skill: "sleight_of_hand", judged: judged({ difficulty: "hard" }) }).dc, 16, "palming is a feat, whoever's pocket");
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

test("a ruling is held to the scene: an outcome counts as the route it amounts to, closes only ways of trying, and always changes something", () => {
  const state = yard(0);
  const ruling = toRuling(scene, state, {
    ...LINING,
    success: outcome({ happens: "He opens it.", gets: "all", counts_as: "page-found", reveals: ["page", "nonsense"], closes: ["concede", "catch-moll"] }),
    failure: outcome({ happens: "Cob shakes his head.", gets: "none" }),
  }, META);
  assert.equal(ruling.success.to, "motive", "the page found leads where its route leads");
  assert.deepEqual(ruling.success.establishes, [PAGE], "with the route's own facts (the exit scripts read them)");
  assert.deepEqual(ruling.success.reveals, ["page"]);
  assert.deepEqual(ruling.success.closes, ["catch-moll"], "giving up isn't a way of trying the ruling can shut");
  assert.equal(ruling.failure.to, undefined);
  assert.equal(ruling.failure.establishes.length, 1, "a failure that changed nothing is on the record at least");
  assert.match(ruling.failure.establishes[0]!, /it failed: Cob shakes his head\./);
  assert.equal(ruling.hollow, undefined);
});

test("a lie is rolled as Deception, however friendly its words: by the review's read, or the decider's", () => {
  const state = yard(0);
  assert.equal(toRuling(scene, state, { ...LINING, lie: true }, META).skill, "deception", "a made-up promise is a lie");
  assert.equal(toRuling(scene, state, LINING, META, { read: { probability: 0.9, routes: [], means: "deception" } }).skill, "deception", "the decider read the method as a lie");
  assert.equal(toRuling(scene, state, LINING, META).skill, "persuasion", "an honest bargain");
  assert.equal(toRuling(scene, state, { ...LINING, skill: "intimidation", lie: true }, META).skill, "intimidation", "a bluffed threat is still a threat");
});

test("a success that's no success (a refusal, or the same as its failure) is a no, without dice", async () => {
  const state = yard(30);
  const refusal = toRuling(scene, state, json(
    outcome({ happens: "Kell refuses to put her truncheon to the lock.", gets: "none", establishes: ["Kell refuses to break the padlock without lawful authority."] }),
    outcome({ happens: "Kell refuses, and writes the claim down.", gets: "none", establishes: ["Kell refuses to break the padlock without lawful authority.", "Kell has written down the player's claim."] }),
  ), META);
  assert.equal(refusal.hollow, "no roll could get them that here");
  const same = toRuling(scene, state, json(
    outcome({ happens: "Cob takes the shilling.", gets: "some", establishes: ["Cob has the player's shilling."] }),
    outcome({ happens: "Cob takes the shilling.", gets: "some", establishes: ["Cob has the player's shilling."] }),
  ), META);
  assert.equal(same.hollow, "either way it comes to the same");
  const settled = await settleRuling(scene, state, refusal);
  assert.equal(settled.move.roll, undefined, "nothing rolled");
  assert.deepEqual([settled.record.kind, settled.record.went], ["no", "failure"]);
  assert.match(settled.directive[0]!, /^No dice: this can't work like this \(no roll could get them that here\)\. Decided, and it stands [^:]*: Kell refuses, and writes the claim down\./);
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

test("a ruling settled: a roll it loses costs what failure costs, a way of trying it shut stays shut, and what success would have brought out is kept back", async () => {
  const state = yard(-30);
  const settled = await settleRuling(scene, state, toRuling(scene, state, LINING, META));
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

test("a ruling with no roll: yes takes success's way, no takes failure's, and an ending the player didn't choose is held for their answer", async () => {
  const yes = yard(0);
  const free = await settleRuling(scene, yes, toRuling(scene, yes, { ...LINING, approach: "free" }, { costUsd: 0, latencyMs: 0 }));
  assert.equal(free.move.roll, undefined);
  assert.equal(free.dice, undefined);
  assert.deepEqual([free.move.to, free.move.chosen, free.record.kind], ["motive", true, "yes"]);
  assert.deepEqual(free.move.transition.establishes, [PAGE]);
  assert.match(free.directive[0]!, /^No dice needed \(they'd do it anyway/);
  const no = yard(0);
  const ruled = await settleRuling(scene, no, toRuling(scene, no, { ...LINING, approach: "no_chance", failure: outcome({ happens: "Kell has had enough: she tells Tull to take him.", gets: "none", to: "closed-suicide" }) }, { costUsd: 0, latencyMs: 0 }));
  assert.deepEqual([ruled.move.to, ruled.move.chosen, ruled.move.exit?.id, ruled.record.kind], ["closed-suicide", false, "closed-suicide", "no"]);
  assert.match(ruled.directive[0]!, /^No dice: this can't work like this \(it pulls a lever that can't move them/);
  assert.match(ruled.directive[1]!, /Things are escalating towards this/);
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
    const steps: string[] = [];
    const turn = await playerTurn(state, "Who found him, Sergeant?", { onStep: s => steps.push(s) });
    assert.deepEqual(steps, []);
    assert.equal(turn.metric.considerMs, undefined);
    assert.equal(state.rulings, undefined);
    assert.equal(fake.asked.filter(p => p.endsWith("/responses")).length, 1, "the reply, and nothing before it");
  } finally {
    fake.restore();
  }
});
