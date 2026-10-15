import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
const RUNS = mkdtempSync(join(tmpdir(), "km-fight-start-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.OPENROUTER_API_KEY = "offline";
const { playerTurn } = await import("./engine.ts");
const { pregenSession } = await import("../game/combat/pregen.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
type SessionState = import("./session.ts").SessionState;

/**
 * A fight starts with the blow that started it, against whoever the turn brought on: played through
 * the engine with OpenRouter stood in for, on the Heron's floor. The wizard's Fire Bolt that started
 * the Heron fight was narrated as a miss with no roll (wizard#20); the barbarian's fight was built
 * before the same turn's master-comes cue had landed, so he fought Hep's porters while the reply had
 * Sallow and the Crakes come in (barbarian#36).
 */

const MASTER_HERE = "Master Sallow has come to the Heron.";

/** The Heron's floor, a good while in: the bell is due. */
async function floor(id: string): Promise<SessionState> {
  const state = await pregenSession({ pregen: "wizard", seed: 4, sceneId: "heron-warehouse" });
  return { ...state, id, beat: "floor", turnsInBeat: 6, path: [{ turn: 1, from: "wharf", to: "floor", via: "show-token", source: "pre" }] };
}

/** What the GM was told for the turn's reply (the last of its input: the per-turn note). */
const told = (fake: { sent: Array<{ instructions?: string; input?: Array<{ content: string }> }> }) =>
  fake.sent.filter(b => b.instructions?.startsWith("You are the Game Master")).at(-1)!.input!.at(-1)!.content;

test("the act that starts a fight is rolled before it, and the GM tells it as the rules have it (wizard#20)", async () => {
  const state = await floor("fight-start-opening");
  const fake = fakeOpenRouter({ choices: { attempt: "attack", mechanic: "cast", spell: "fire-bolt", aim_hep: "yes" }, replies: ["The bolt takes Hep in the shoulder. Roll for initiative!"] });
  try {
    const result = await playerTurn(state, "*I hurl a Fire Bolt at the forewoman.*");
    assert.equal(result.ended?.id, "fight");
    const dice = state.transcript.filter(e => e.kind === "roll").map(e => e.text);
    assert.ok(dice.some(d => /^Cast Fire Bolt \(cantrip\) on /.test(d)), dice.join("\n"));
    assert.ok(dice.some(d => /Fire Bolt: your attack on .*: \d+(\/\d+)? [+-]\d+ = \d+ vs AC \d+: (hit|miss|critical hit!)/.test(d)), dice.join("\n"));
    assert.match(told(fake), /it's the blow that starts the fight, and the rules have already resolved it/);
  } finally {
    fake.restore();
  }
});

test("a cue that fires alongside the route into a fight lands first: the Master who came in is the one fought (barbarian#36)", async () => {
  const state = await floor("fight-start-cue");
  const fake = fakeOpenRouter({ choices: { attempt: "attack", cue: "master-comes" }, replies: ["Lavender, and the land door opens. Roll for initiative!"] });
  try {
    await playerTurn(state, "(I meet the first porter up the stair with a fist in the chest.) Next!");
  } finally {
    fake.restore();
  }
  assert.equal(state.ended?.exitId, "fight");
  assert.ok(state.established.includes(MASTER_HERE), state.established.join("; "));
  const start = state.ended!.operations.find(o => o.op === "startCombat")?.args as { enemies: Array<{ leader: string }> };
  assert.equal(start.enemies[0]!.leader, "sallow");
  assert.ok(state.path.some(p => p.via === "master-comes" && p.to === "midnight"), "the scene is at midnight when the fight is over");
  // Without the cue, it's Hep's gang, as before.
  const quiet = await floor("fight-start-no-cue");
  const plain = fakeOpenRouter({ choices: { attempt: "attack" }, replies: ["The porters drop their sacks. Roll for initiative!"] });
  try {
    await playerTurn(quiet, "(I meet the first porter up the stair with a fist in the chest.) Next!");
  } finally {
    plain.restore();
  }
  const hep = quiet.ended!.operations.find(o => o.op === "startCombat")?.args as { enemies: Array<{ leader: string }> };
  assert.equal(hep.enemies[0]!.leader, "hep");
});
