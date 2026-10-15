import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
const RUNS = mkdtempSync(join(tmpdir(), "km-crossing-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.OPENROUTER_API_KEY = "offline";
const { openScene } = await import("./engine.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
type SessionState = import("./session.ts").SessionState;

/**
 * Crossing from one scene to the next holds together, with OpenRouter stood in for: who is in the
 * next scene agrees with the boundary's word on what's true now.
 */

/** The Rat about to open, after the granary, with the boundary's adjustments. */
function ratOpening(id: string, adjustments: string[]): SessionState {
  return {
    id, sceneId: "drowned-rat", approach: "v2", seed: 5, rollCount: 0,
    player: { name: "Grukka Kettlebreaker", concept: "a half-orc barbarian, ex-dock bruiser", modifiers: {} },
    turn: 17, beat: "the-rat", turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], adjustments,
    history: [{ sceneId: "hanged-clerk", exitId: "closed-suicide", summary: "Previous scene, \"The Hanged Clerk\", ended: Filed as a suicide.\nGrukka has the page. Kell examined Prout and found he was killed." }],
  };
}

test("who's in the next scene goes by the boundary's word on what's true now, not the hand-off alone (Cob was at the Rat, though it said he wouldn't be)", async () => {
  const fake = fakeOpenRouter({ choices: { cob: "not_here" }, replies: ["The din drops by half as you come down the steps."] });
  try {
    const state = ratOpening("crossing-presence", ["Cob was frightened off. He and Moll have gone to ground in the granary quarter; Cob will not be at the Rat tonight."]);
    await openScene(state);
    const presence = fake.sent.find(b => b.questions?.["cob"])! as unknown as { state: { true_now?: string[] }; questions: Record<string, { instructions: string }> };
    assert.ok(presence, "Cob, whom only the adjustments name, is asked about");
    assert.deepEqual(presence.state.true_now, ["Cob was frightened off. He and Moll have gone to ground in the granary quarter; Cob will not be at the Rat tonight."]);
    assert.match(presence.questions["cob"]!.instructions, /true_now is what's true by the time it starts, and it has the last word on who is where/);
    assert.ok(state.absent?.includes("cob"));
    assert.ok(!state.world?.entities["cob"], "not in the Rat's world either");
  } finally {
    fake.restore();
  }
});
