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

/** What the GM was told for the turn's reply (the last of its input: the per-turn note). */
const told = (fake: { sent: Array<{ instructions?: string; input?: Array<{ content: string }> }> }) =>
  fake.sent.filter(b => b.instructions?.startsWith("You are the Game Master")).at(-1)!.input!.at(-1)!.content;

test("a daft act gets its bill, unless the dice have already decided it", async () => {
  const bill = /this one isn't free/;
  const billed = fakeOpenRouter({ choices: { daft: "consequential" }, replies: ["Moll shrieks."] });
  try {
    await playerTurn(yard("endings-billed"), "*pulls a face at Moll and pelts her with gravel*");
    assert.match(told(billed), bill);
  } finally {
    billed.restore();
  }
  const rolled = fakeOpenRouter({ choices: { daft: "consequential", attempt: "examine-body", roll_call: "route" }, replies: ["You lean in close."] });
  try {
    const state = yard("endings-rolled");
    await playerTurn(state, "*shins up the hoist rope one-handed, showing off, to get a look at his neck*");
    assert.equal(state.path.at(-1)?.roll?.skill, "medicine", "the route's roll decided it");
    assert.doesNotMatch(told(rolled), bill, "its outcome is the bill");
  } finally {
    rolled.restore();
  }
});
