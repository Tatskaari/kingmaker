import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
const RUNS = mkdtempSync(join(tmpdir(), "km-endings-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.OPENROUTER_API_KEY = "offline";
const { playerTurn } = await import("./engine.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
type SessionState = import("./session.ts").SessionState;

/**
 * The scene's clock and its endings, played through the engine with OpenRouter stood in for: what an
 * out-of-character turn doesn't count, and when an ending waits for the player's answer.
 */

/** The granary yard a few exchanges in; no character sheet, so the dice are the session's. */
function yard(id: string): SessionState {
  return {
    id, sceneId: "hanged-clerk", approach: "v2", seed: 11, rollCount: 0,
    player: { name: "Pell Marrow", concept: "a hedge-wizard with a scorched hat", modifiers: { persuasion: 2 } },
    turn: 4, beat: "yard", turnsInBeat: 3, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [],
  };
}

test("a word out of character isn't an exchange: the scene's clock doesn't move", async () => {
  const fake = fakeOpenRouter({ choices: { ooc: "out_of_character" }, replies: ["(Out of character: you can look at the body, talk to the kids, or ask Kell.)"] });
  try {
    const state = yard("endings-ooc-clock");
    await playerTurn(state, "(out of character: what can I do here?)");
    assert.equal(state.turnsInBeat, 3, "still three exchanges at this point");
  } finally {
    fake.restore();
  }
  const plain = fakeOpenRouter({ replies: ["Kell nods."] });
  try {
    const state = yard("endings-clock");
    await playerTurn(state, "Who found him, Sergeant?");
    assert.equal(state.turnsInBeat, 4, "an exchange in character counts");
  } finally {
    plain.restore();
  }
});
