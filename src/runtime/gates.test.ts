import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
const RUNS = mkdtempSync(join(tmpdir(), "km-gates-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.OPENROUTER_API_KEY = "offline";
const { rng } = await import("./dice.ts");
const { playerTurn } = await import("./engine.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
type SessionState = import("./session.ts").SessionState;
type Fake = ReturnType<typeof fakeOpenRouter>;

/**
 * The engine's gates for considered rolls, played through `playerTurn` with OpenRouter stood in for:
 * what the prep, the rules and the same push again settle before the GM's review would, and when a
 * turn goes to it all the same.
 */

/** A seed whose first d20 is neither 1 nor 20: with a big modifier either way, the outcome is certain. */
function plainSeed(): number {
  for (let seed = 1; ; seed++) { const die = 1 + Math.floor(rng(seed + 7919)() * 20); if (die > 1 && die < 20) return seed; }
}

/** The granary yard a few exchanges in, under `v2` (considered rolls on); no character sheet, so the dice are the session's. */
function yard(id: string, modifier = 0): SessionState {
  return {
    id, sceneId: "hanged-clerk", approach: "v2", seed: plainSeed(), rollCount: 0,
    player: { name: "Nim Bramblefoot", concept: "a halfling cutpurse", modifiers: { persuasion: modifier, deception: modifier, intimidation: modifier, sleight_of_hand: modifier } },
    turn: 14, beat: "yard", turnsInBeat: 3, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [],
  };
}

/** What the GM was told for the turn's reply (the last of its input: the per-turn note). */
const told = (fake: Fake) => fake.sent.filter(b => b.instructions?.startsWith("You are the Game Master")).at(-1)!.input!.at(-1)!.content;
/** Whether the GM's review was asked for a ruling. */
const reviewed = (fake: Fake) => fake.sent.some(b => b.text?.format?.name === "ruling");

type OutcomeJson = { happens: string; gets: string; to: string; counts_as: string; establishes: string[]; reveals: string[]; closes: string[] };
const outcome = (o: Partial<OutcomeJson>): OutcomeJson => ({ happens: "", gets: "some", to: "stay", counts_as: "none", establishes: [], reveals: [], closes: [], ...o });
/** A ruling the review might make on a bid for Cob's paper. */
const RULING = {
  act: "buy the paper from Cob", target: "cob", lie: false, skill: "persuasion", stakes: "guarded", approach: "plausible", disposition: "wary",
  same_again: false, difficulty: "moderate", reason: "to buy the paper in Cob's boot",
  success: outcome({ happens: "Cob snatches the crown and tosses the folded page over.", gets: "all", reveals: ["page"] }),
  failure: outcome({ happens: "Cob yells thief, and he and Moll are through the loose board into the granary.", gets: "none", establishes: ["Cob and Moll have bolted into the granary."] }),
};

// The thief's T15 (and the goals run's g2, and the robustness run's rb-1m2): a bribe read as the
// author's no-dice bribe route, and off the graph too in the same call, went to the GM's review; its
// ruling played ('Thief! Cob's not selling you Mister Prout's things') instead of the haggling.
const CROWN = "*I hold up the wheat-ear crown where Cob can see it shine, staying well back.* Cob. Business, then, rat to rat. A whole silver crown for that bit of paper.";

test("a route the author gave no dice, read with an attempt's confidence, settles the turn: no review, whatever off_graph says", async () => {
  const fake = fakeOpenRouter({ choices: { attempt: "plain:bribe-cob", roll_call: "new", off_graph: "off_graph" }, byName: { ruling: RULING }, replies: ["Cob bites the crown, names a price twice as high, and keeps his boots on."] });
  try {
    const state = yard("gates-bribe");
    await playerTurn(state, CROWN);
    assert.equal(reviewed(fake), false, "no ruling asked for");
    assert.equal(state.rulings, undefined);
    assert.match(told(fake), /No dice needed: what the player is doing simply works \(The player offers coin, food or a trade as the price of a look in Cob's boot/);
    assert.doesNotMatch(told(fake), /Decided, and it stands/);
  } finally {
    fake.restore();
  }
});

test("an unsure read of a no-dice route still lets the GM rule on what was asked, off the graph or a roll wanted", async () => {
  const reads: Array<Record<string, string>> = [{ attempt: "plain:bribe-cob", roll_call: "new" }, { attempt: "plain:bribe-cob", off_graph: "off_graph" }];
  for (const choices of reads) {
    const fake = fakeOpenRouter({ choices, odds: { attempt: 0.3 }, byName: { ruling: RULING }, replies: ["Cob eyes the crown."] });
    try {
      const state = yard(`gates-bribe-unsure-${Object.keys(choices).join("-")}`);
      await playerTurn(state, CROWN);
      assert.equal(reviewed(fake), true, `the review rules (${Object.keys(choices).join(", ")})`);
      assert.equal(state.rulings?.length, 1);
    } finally {
      fake.restore();
    }
  }
});

// The wizard's T11: a Mage Hand sent to pinch the page from the boot of a boy who was watching got no
// roll (the spell was the whole act), and the GM narrated a failure. The barbarian's war-roar with
// the Rage went unruled the same way (the class feature answered the turn).
const { pregenSession, PREGENS } = await import("../game/combat/pregen.ts");
const PINCH = "*While Cob glares at my coins, I call up a Mage Hand behind him and have it pinch the edge of that paper out of his boot.*";
const LIFT = {
  ...RULING, act: "pinch the page from Cob's boot with the Mage Hand", target: "world", skill: "sleight_of_hand", difficulty: "moderate", reason: "to slip the page out of Cob's boot unseen",
  success: outcome({ happens: "The hand draws the page out of the boot's lining; Cob never feels it go.", gets: "all", reveals: ["page"] }),
  failure: outcome({ happens: "Cob feels the tug, slaps at his boot and yells; Moll has him behind the water butt before the hand can try again.", gets: "none", establishes: ["Cob knows someone tried to take what's in his boot."] }),
};

async function wizardInTheYard(id: string): Promise<SessionState> {
  const state = await pregenSession({ pregen: "wizard", build: { ...PREGENS.wizard!.build, cantrips: ["mage-hand", "fire-bolt", "light"] }, sceneId: "hanged-clerk", seed: plainSeed() });
  return { ...state, id, beat: "yard", turnsInBeat: 3, turn: 10 };
}

test("a spell that's only the means to a risky act still gets the act's ruling, which knows how the spell went", async () => {
  const fake = fakeOpenRouter({ choices: { roll_call: "new", mechanic: "cast", spell: "mage-hand", means_only: "yes" }, byName: { ruling: LIFT }, replies: ["The hand drifts towards Cob's boot."] });
  try {
    const state = await wizardInTheYard("gates-mage-hand");
    await playerTurn(state, PINCH);
    assert.equal(fake.sent.filter(b => b.questions?.means_only).length, 1, "asked once, with the spell's details");
    assert.equal(fake.sent.find(b => b.questions?.roll_call)?.questions?.means_only, undefined, "not in the turn's main decision");
    const review = fake.sent.find(b => b.text?.format?.name === "ruling");
    assert.ok(review, "the act goes to the GM's ruling");
    assert.match(review.input!.at(-1)!.content, /Cast Mage Hand/, "after the rules, so it rules knowing the spell was cast");
    assert.deepEqual(state.rulings?.map(r => r.act), [LIFT.act]);
    assert.ok(state.path.some(p => p.via === "rules:cast:mage-hand"), "the rules resolved the cast");
    assert.match(told(fake), /Decided, and it stands/);
  } finally {
    fake.restore();
  }
});

test("a spell doing what it does, or a blow, stays the rules' alone: no ruling on top", async () => {
  const fake = fakeOpenRouter({ choices: { roll_call: "new", mechanic: "cast", spell: "mage-hand", means_only: "no" }, byName: { ruling: LIFT }, replies: ["The hand lifts the satchel's flap."] });
  try {
    const state = await wizardInTheYard("gates-mage-hand-plain");
    await playerTurn(state, "*I send a Mage Hand to lift the flap of the satchel on the cobbles.*");
    assert.equal(reviewed(fake), false);
    assert.equal(state.rulings, undefined);
    assert.ok(state.path.some(p => p.via === "rules:cast:mage-hand"));
  } finally {
    fake.restore();
  }
  // No roll wanted: the means question isn't asked at all.
  const quiet = fakeOpenRouter({ choices: { mechanic: "cast", spell: "mage-hand" }, replies: ["The hand lifts the satchel's flap."] });
  try {
    await playerTurn(await wizardInTheYard("gates-mage-hand-quiet"), "*I send a Mage Hand to lift the flap of the satchel on the cobbles.*");
    assert.ok(!quiet.sent.some(b => b.questions?.means_only));
  } finally {
    quiet.restore();
  }
});

test("a class feature with a risky act beside it gets the act's ruling, after the feature's used", async () => {
  const ROAR = { ...RULING, act: "roar the kids down off the wall", target: "moll", skill: "intimidation", reason: "to make the kids come down off the wall" };
  const fake = fakeOpenRouter({ choices: { roll_call: "new", mechanic: "feature", feature: "second-wind" }, byName: { ruling: ROAR }, replies: ["Moll freezes on the wall."] });
  try {
    const fighter = await pregenSession({ pregen: "fighter", sceneId: "hanged-clerk", seed: plainSeed() });
    const state: SessionState = { ...fighter, id: "gates-feature", beat: "yard", turnsInBeat: 3, turn: 10, rules: { ...fighter.rules!, features: [{ id: "second-wind", name: "Second Wind", target: "self" }] } };
    await playerTurn(state, "*I catch my breath, then bellow at the kids to get down off that wall, now.*");
    assert.ok(state.path.some(p => p.via === "rules:feature:second-wind"), "the feature is used");
    assert.deepEqual(state.rulings?.map(r => r.act), [ROAR.act], "and the roar is ruled on");
  } finally {
    fake.restore();
  }
});
