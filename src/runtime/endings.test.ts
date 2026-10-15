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
const { writeRepair } = await import("./repair.ts");
const { saveSession } = await import("./session.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
type SessionState = import("./session.ts").SessionState;

/** One turn with the decider answering as `choices` says (and quietly otherwise); what the GM was told, and how the turn ended. */
async function turn(state: SessionState, line: string, choices: Record<string, string> = {}): Promise<{ told: string; ended?: string }> {
  const fake = fakeOpenRouter({ choices, replies: ["The yard waits on you."] });
  try {
    const result = await playerTurn(state, line);
    return { told: told(fake), ...(result.ended ? { ended: result.ended.id } : {}) };
  } finally {
    fake.restore();
  }
}

/** The granary at noon: Tull's dead-cart is in the yard, and Kell is about to sign for Prout. */
function deadCart(id: string): SessionState {
  return { ...yard(id), beat: "dead-cart", turnsInBeat: 2, path: [{ turn: 3, from: "yard", to: "dead-cart", via: "cart-comes", source: "pre" }] };
}

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

// Endings found after the reply. The granary's T28 and T29: the player asked Kell to protect the
// kids; she promised, then signed Prout in as murder by persons unknown, and the next turn (the
// player asking Cob what he saw) was spent closing the scene.

test("an ending found after the reply that isn't the player's own doing waits for their answer", async () => {
  const state = deadCart("endings-waits");
  const signed = await turn(state, "Kell, I'm worried. Can you protect these kids until we get to the bottom of this?", { outcome: "held-as-murder" });
  assert.equal(signed.ended, undefined);
  assert.equal(state.closing, undefined, "no wind-down turn");
  assert.deepEqual([state.pendingExit?.exitId, state.pendingExit?.extended, state.pendingExit?.waits], ["open-case", false, "it isn't the player's own doing"]);
  // Their answer (a question to Cob) holds it once more, and gets a real reply.
  const asked = await turn(state, "Cob, you'll be safe. Can you tell me exactly what you heard and saw?", { brink: "answers" });
  assert.equal(asked.ended, undefined);
  assert.match(asked.told, /The scene is on the brink of: Murder by persons unknown .*It hasn't closed: the player is answering it/s);
  assert.equal(state.pendingExit?.extended, true);
  // Then, with nothing changing it, it lands, with their turn answered first.
  const done = await turn(state, "Right. Thank you, Sergeant.");
  assert.equal(done.ended, "open-case");
  assert.match(done.told, /This reply closes the scene: .*Answer the player's turn first: if they ask someone here something, or challenge or call someone out, that person hears it and answers/s);
});

test("an ending found as someone comes in waits for the player, even one they brought about", async () => {
  // The King's morning, T93: the co-GM moved the scene on as the player spoke, Sallow came in as an
  // ending was found, and the player's "Sallow." went into the closing. (Sallow now comes in when the
  // scene moves to "In front of the King", sent for; here the King decides in the same turn.)
  const state: SessionState = { ...yard("endings-arrival"), sceneId: "kings-morning", beat: "reckoning", turnsInBeat: 2 };
  saveSession(state);
  writeRepair(state, { turn: state.turn, assessment: "", status: "on_track", notes: "", canon: [], patches: [], moveTo: "face-to-face", costUsd: 0, latencyMs: 0 });
  await turn(state, "Make him explain where this grain came from.", { outcome: "king-acts", own_exit: "theirs" });
  assert.equal(state.beat, "face-to-face");
  assert.deepEqual([state.pendingExit?.exitId, state.pendingExit?.waits], ["justice", "Master Josiah Sallow just came in"]);
  assert.equal(state.closing, undefined);
  const answered = await turn(state, "Sallow.", { brink: "answers" });
  assert.equal(answered.ended, undefined, "the player's challenge to the man in the doorway gets a reply of its own");
});

test("an ending the player chose, with nothing left hanging, gets one wind-down turn, where a challenge still lands", async () => {
  const state = yard("endings-own");
  await turn(state, "We're done here, Sergeant. Write him up as murdered and let's take it to the King.", { ending: "open-case", own_exit: "theirs" });
  assert.deepEqual(state.closing, { exitId: "open-case", turn: state.turn });
  assert.equal(state.pendingExit, undefined);
  const close = await turn(state, "*to Moll, on the way out* You lied about seeing him jump.");
  assert.equal(close.ended, "open-case");
  assert.match(close.told, /The scene is ending: .*Answer the player's turn first: .*challenge or call someone out, that person hears it and answers in their own way and character \(a reaction, a retort, a slip\), so it lands/s);
});

test("a question the reply left unanswered holds an ending the player chose", async () => {
  const state = yard("endings-unanswered");
  await turn(state, "Shall we go, Sergeant? And who found him?", { ending: "open-case", own_exit: "theirs", ask: "unanswered" });
  assert.deepEqual([state.pendingExit?.exitId, state.pendingExit?.waits], ["open-case", "the player asked something the reply left unanswered"]);
});

test("a word out of character never closes an ending held or winding down: it's answered, and the turn is given back", async () => {
  // The Heron's T90: "so what am I meant to do here?" closed the scene on the barge sailing.
  const held = deadCart("endings-ooc-held");
  held.pendingExit = { exitId: "closed-suicide", turn: held.turn, via: "carted-off", extended: false };
  held.sceneStatus = "stuck";
  const answer = await turn(held, "(out of character: so what am I meant to do here? Feel a bit stuck)", { ooc: "out_of_character" });
  assert.equal(answer.ended, undefined);
  assert.deepEqual(held.pendingExit, { exitId: "closed-suicide", turn: held.turn - 1, via: "carted-off", extended: false }, "as it was: not spent, not taken");
  assert.match(answer.told, /Nothing in the story moves on while you answer: the scene is on the brink of Filed as a suicide, which hasn't happened yet/);
  assert.match(answer.told, /If they're stuck or ask what they can do, name two or three concrete things in front of them/);
  assert.doesNotMatch(answer.told, /This reply closes the scene|going in circles/, "no close, and no push to break the loop");
  assert.equal(held.turnsInBeat, 2);
  // On a wind-down turn too: the close waits for their next turn in character.
  const winding = yard("endings-ooc-closing");
  winding.closing = { exitId: "open-case", turn: winding.turn };
  const asked = await turn(winding, "(ooc: before we go, is there anything else here I missed?)", { ooc: "out_of_character" });
  assert.equal(asked.ended, undefined);
  assert.deepEqual(winding.closing, { exitId: "open-case", turn: winding.turn - 1 });
  assert.match(asked.told, /it closes on the player's next turn in character, not in this reply/);
  assert.equal((await turn(winding, "Let's go.")).ended, "open-case");
});

test("the co-GM's notes reach the GM while an ending is held, and not in the reply that closes it", async () => {
  const state = deadCart("endings-notes");
  state.pendingExit = { exitId: "closed-suicide", turn: state.turn, via: "carted-off", extended: false };
  state.notes = "Tull's order names who asked for it: let the player see it if they reach for it.";
  state.notesTurn = state.turn;
  const held = await turn(state, "Corporal, may I see that order?", { brink: "answers" });
  assert.match(held.told, /## Notes from your co-GM[\s\S]*Tull's order names who asked for it/);
  const closed = await turn(state, "Fine. Take him.");
  assert.equal(closed.ended, "closed-suicide");
  assert.doesNotMatch(closed.told, /## Notes from your co-GM/);
});
