import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const RUNS = mkdtempSync(join(tmpdir(), "km-threats-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.OPENROUTER_API_KEY = "offline";
const { pregenSession } = await import("../game/combat/pregen.ts");
const { sceneById } = await import("../../scenes/index.ts");
const { castSpell } = await import("../rules/dnd.ts");
const { comeRound, givesIn, holdAfterReply, landThreat } = await import("./threats.ts");
const { playerTurn } = await import("./engine.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
type SessionState = import("./session.ts").SessionState;

/**
 * What the last reply left hanging over the player, as it lands at the start of their turn: a grab
 * is resisted once and never when they give in (goals#64: a Crake's hold forced a Strength save
 * every turn for ten turns, the turn after "I stop struggling" too); a Shield goes up before the
 * blow it answers, and a player knocked down comes round, conscious at 1 HP, as the GM was told
 * (wizard#21). Offline: the rules engine's own dice, seeded.
 */

const heron = sceneById("heron-warehouse");
const at = async (pregen: string, seed = 5): Promise<SessionState> => {
  const state = await pregenSession({ pregen, seed, sceneId: "heron-warehouse" });
  state.entered = ["sallow", "crake-1"];
  return state;
};
const grab = (state: SessionState) => { state.threat = { kind: "hazard", hazard: "grab_or_shove", severity: "serious", turn: state.turn }; };

test("giving in, in the player's words: no struggle, going quietly, letting them take you (and not its opposite)", () => {
  for (const said of ["(I stop struggling and let them take me to the river door.)", "I go quietly.", "I don't resist.", "Fine. I surrender.", "I let the Crake drag me out.", "I let myself be led to the door", "Hands up, I go with them."]) assert.ok(givesIn(said), said);
  for (const said of ["I won't stop struggling!", "I refuse to go quietly", "I twist free of his grip", "I give up the ledger to Kell", "I submit the ledger to the sergeant", "I let the book fall", "I go along the wall to the door"]) assert.ok(!givesIn(said), said);
});

test("a hold is resisted once: a save when it catches them, none while it has them, none at all when they give in (goals#64)", async () => {
  const state = await at("rogue");
  // The grab catches them: a Strength save, and a failure leaves them held.
  let held: number | undefined;
  for (let n = 0; n < 12 && held === undefined; n++) {
    state.turn++;
    grab(state);
    const landed = await landThreat(heron, state, "I carry letters for a living, sir.");
    assert.match(landed!.lines.join("\n"), /Your Strength save: .* (saved|failed)/);
    assert.equal(state.held !== undefined, landed!.saved === false);
    held = state.held;
  }
  assert.ok(held !== undefined, "some grab caught them");
  // While the reply has them held, later grabs roll nothing: the hold stands.
  holdAfterReply(state, "hazard:grab_or_shove");
  state.turn++;
  grab(state);
  const still = await landThreat(heron, state, "Sergeant, the book is in Sallow's hand.");
  assert.deepEqual(still!.lines, []);
  assert.match(still!.directive, /no new saving throw against the hold on the player: it still has them/);
  // The reply lets them go: the next grab is a new one.
  holdAfterReply(state, "none");
  assert.equal(state.held, undefined);
  // Giving in to a new grab takes no roll: they're held, as the story has it.
  state.turn++;
  grab(state);
  const given = await landThreat(heron, state, "(I stop struggling and let them take me to the river door.)");
  assert.deepEqual(given!.lines, []);
  assert.match(given!.directive, /doesn't resist .* no saving throw/);
  assert.equal(state.held, state.turn);
  // Other dangers are saved against as ever, held or not.
  state.threat = { kind: "hazard", hazard: "fire", severity: "glancing", turn: state.turn };
  assert.match((await landThreat(heron, state, "I let them take me"))!.lines.join("\n"), /Your Dexterity save/);
});

test("Shield goes up before the blow it answers: +5 AC against it and a slot spent, and the turn doesn't cast it again (wizard#21)", async () => {
  const state = await at("wizard");
  state.threat = { kind: "attack", by: "sallow", turn: 0 };
  const landed = (await landThreat(heron, state, "As the blade comes down I snap up a hand and speak the word for Shield!"))!;
  assert.match(landed.lines[0]!, /^Cast Shield \(1st-level slot\): \+5 AC against the blow/);
  assert.match(landed.lines[1]!, /attack on you: .* vs AC 17: (hit|miss|critical hit!)/, "the wizard's AC 12, and 5 for the Shield");
  assert.equal(landed.shielded, true);
  assert.match(state.rules!.status!, /1st 3\/4/);
  assert.match(landed.directive, /Shield went up first/);
  // Without it, the blow is against their AC as it is.
  state.threat = { kind: "attack", by: "sallow", turn: 0 };
  const bare = (await landThreat(heron, state, "I back away from the blade."))!;
  assert.match(bare.lines[0]!, /vs AC 12/);
  assert.equal(bare.shielded, undefined);
});

test("down is down, then up: knocked to 0 HP they can't act that turn, and come round at 1 HP as their next turn begins (wizard#21)", async () => {
  const state = await at("wizard", 11);
  let down;
  for (let n = 0; n < 30 && !down; n++) {
    state.threat = { kind: "attack", by: "sallow", turn: n };
    const landed = await landThreat(heron, state, "I argue.");
    if (landed?.down) down = landed;
  }
  assert.ok(down, "Sallow's blows put the wizard down");
  assert.match(state.rules!.status!, /^HP 0\//);
  assert.match(down.directive, /whatever they meant to do this turn doesn't happen.*come to, with 1 hit point/);
  // Their next turn: they come round first, and the rules have them conscious, at 1 HP.
  const up = (await comeRound(state))!;
  assert.match(up.lines[0]!, /^You come to: HP 1\//);
  assert.match(up.directive, /conscious at 1 hit point/);
  assert.equal(await comeRound(state), undefined, "only once");
  const bolt = await castSpell(state, [], "fire-bolt", []);
  assert.doesNotMatch(bolt.lines.join("\n"), /Unconscious/);
});

test("in a turn, a Shield raised against the blow isn't cast again by the turn's own act", async () => {
  const state = await at("wizard");
  state.threat = { kind: "attack", by: "sallow", turn: state.turn };
  const fake = fakeOpenRouter({ choices: { mechanic: "cast", spell: "shield", aim_self: "yes" }, replies: ["The blade skids off a plane of force."] });
  try {
    await playerTurn(state, "*As the blade comes down I snap up a hand and speak the word for Shield.*");
  } finally {
    fake.restore();
  }
  const dice = state.transcript.filter(e => e.kind === "roll").map(e => e.text);
  assert.equal(dice.filter(d => /^Cast Shield/.test(d)).length, 1, dice.join("\n"));
  assert.match(state.rules!.status!, /1st 3\/4/, "one slot for it");
});
