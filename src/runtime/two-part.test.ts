import { test } from "node:test";
import assert from "node:assert/strict";
import { sceneById } from "../../scenes/index.ts";
import type { SessionState } from "./session.ts";
import { bandOf, mouthpieceInput, rolesNote, takeRoute } from "./two-part.ts";

function yard(): SessionState {
  return {
    id: "two-part-test", sceneId: "hanged-clerk", approach: "two-part", seed: 7, rollCount: 0,
    player: { name: "Maren Holloway", concept: "a methodical investigator", modifiers: { insight: 3 } },
    turn: 0, beat: "yard", turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [],
    twoPart: { roles: { cob: { status: "Throwing stones", mental_state: "", conversation_role: "Cheek and dares." } }, notes: [] },
  };
}
const scene = sceneById("hanged-clerk");

test("a roll lands in one of five outcomes by how far it made or missed its DC", () => {
  const at = (total: number, critical: "success" | "failure" | null = null) => bandOf({ total, dc: 13, critical });
  assert.equal(at(8), "major_failure");
  assert.equal(at(12), "minor_failure");
  assert.equal(at(13), "barely_passed");
  assert.equal(at(15), "barely_passed");
  assert.equal(at(16), "minor_success");
  assert.equal(at(20), "major_success");
  assert.equal(at(25, "failure"), "major_failure", "a natural 1 goes badly whatever the total");
  assert.equal(at(9, "success"), "major_success", "a natural 20 goes well whatever the total");
});

test("the co-GM moves the scene only along a route open from where it is", () => {
  const state = yard();
  assert.match(takeRoute(scene, state, "held-as-murder", "none"), /isn't open from here/, "a dead-cart route isn't open in the yard");
  assert.equal(state.beat, "yard");
  assert.match(takeRoute(scene, state, "catch-moll", "none"), /the dice decide/, "a route the dice decide needs the check's outcome");
  assert.match(takeRoute(scene, state, "catch-moll", "success"), /Moved to "Not by his own hand"/);
  assert.equal(state.beat, "doubt");
  assert.equal(state.turnsInBeat, 0);
  assert.deepEqual(state.path.map(p => [p.from, p.to, p.via]), [["yard", "doubt", "catch-moll"]]);
});

test("a route to an ending closes the scene on the next reply", () => {
  const state = { ...yard(), beat: "motive" };
  assert.match(takeRoute(scene, state, "make-case", "none"), /The scene is ending: The case is made/);
  assert.equal(state.closing?.exitId, "case-made");
  assert.equal(state.beat, "motive", "the beat stays put until the closing reply finishes the scene");
});

test("each co-GM note reaches the mouthpiece before the player turn it was written for, the latest with the world as it stands", () => {
  const state = yard();
  state.twoPart!.notes.push({ turn: -1, text: rolesNote(scene, state.twoPart!.roles, -1) });
  state.transcript.push({ turn: 0, scene: "hanged-clerk", speaker: "gm", kind: "narration", text: "A stone clangs off the hoist hook." });
  state.twoPart!.notes.push({ turn: 0, text: "Co-GM note, before turn 1\n\nCharacter role for Cob:\nConversation role: Goes quiet." });
  state.turn = 1;
  state.transcript.push({ turn: 1, scene: "hanged-clerk", speaker: "player", kind: "player", text: "Who found him?" });
  const input = mouthpieceInput(scene, state, []);
  assert.deepEqual(input.map(m => m.role), ["system", "user", "assistant", "system", "user"]);
  assert.match(input[0]!.content, /Co-GM note, before turn 0[\s\S]*Cheek and dares/);
  assert.equal(input[2]!.content, "A stone clangs off the hoist hook.");
  assert.match(input[3]!.content, /Goes quiet[\s\S]*## Where the scene is now: Stones at a hanged man/);
  assert.doesNotMatch(input[0]!.content, /Where the scene is now/, "only the latest note carries the per-turn note");
  assert.equal(input[4]!.content, "Who found him?");
});
