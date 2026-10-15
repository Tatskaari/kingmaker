import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
const RUNS = mkdtempSync(join(tmpdir(), "km-crossing-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.OPENROUTER_API_KEY = "offline";
const { chainScene, forceEnding, lastChance, openingDirective, openScene, playerTurn } = await import("./engine.ts");
const { sceneById } = await import("../../scenes/index.ts");
const { effectiveScene } = await import("./brief.ts");
const { memoryLines, memoryIndexPath, readDoc } = await import("../lore/docs.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
type SessionState = import("./session.ts").SessionState;

/**
 * Crossing from one scene to the next holds together, with OpenRouter stood in for: who is in the
 * next scene agrees with the boundary's word on what's true now; what a scene still holds for the
 * player is offered through someone who has it before it closes; the lead stays in the fiction;
 * and what the boundary says someone did in the time between is in their own memory.
 */

/** The Rat a while in: Hobb has clammed up, and Nan, Dilly and Cob are about. */
function ratLate(id: string): SessionState {
  return {
    id, sceneId: "drowned-rat", approach: "v2", seed: 6, rollCount: 0,
    player: { name: "Ivo Marsh", concept: "a patient, soft-spoken investigator", modifiers: {} },
    turn: 10, beat: "the-rat", turnsInBeat: 4, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], landed: ["which-man"], hinted: [],
    history: [{ sceneId: "hanged-clerk", exitId: "case-made", summary: "Previous scene, \"The Hanged Clerk\", ended: The case is made." }],
  };
}

test("before a scene closes, what it still holds for the player is offered once through someone here who has it (the Heron, once Hobb clammed up)", async () => {
  const rat = effectiveScene(sceneById("drowned-rat"), []);
  const line = lastChance(rat, ratLate("crossing-last"))!;
  assert.match(line, /^Before it closes: the player hasn't come across these, and the story goes on without them unless they do: Hobb does night work for a gentleman at the Heron warehouse/);
  assert.match(line, /\(Nan Quill or Dilly Sparrow or Cob or Big Hobb Mallory could let it out\)/);
  assert.match(line, /nobody who has refused it gives it up for nothing\./);
  assert.doesNotMatch(line, /Which of the Rat's many big men/, "not what they've come across");
  assert.equal(lastChance(rat, { ...ratLate("crossing-none"), landed: ["which-man", "heron", "way-in"] }), undefined);
  // What the story carries on anyway (needed later, or brought over) isn't pressed here.
  assert.equal(lastChance(effectiveScene(sceneById("hanged-clerk"), []), { ...ratLate("crossing-granary"), sceneId: "hanged-clerk", beat: "yard", landed: ["not-suicide", "silvertop"] }), undefined);
  // In the closing reply.
  const fake = fakeOpenRouter({ replies: ["Kell takes him up the stairs. Nan calls after you."] });
  try {
    const state = { ...ratLate("crossing-closing"), closing: { exitId: "taken-in", turn: 9 } };
    await playerTurn(state, "(I follow Kell out.)");
    const told = fake.sent.filter(b => b.instructions?.startsWith("You are the Game Master")).at(-1)!.input!.at(-1)!.content;
    assert.match(told, /The scene is ending: [^\n]*\n\nBefore it closes: the player hasn't come across these/);
  } finally {
    fake.restore();
  }
});

test("the lead stays in the story, and what it says someone did in the time between is in their memory (Kell denied the sighting the lead gave her)", async () => {
  const lead = "As the hours pass, Kell tells you she saw a gentleman with a wheat-ear ring beside the Purveyor's wagons, and followed a big porter with a bandaged hand to the Drowned Rat.";
  const fake = fakeOpenRouter({ byName: { boundary: {
    scenes: [{ id: "drowned-rat", holds: true, why: "The big man hasn't been questioned." }],
    adjustments: ["Kell has signed Prout in as murdered, over the Captain's order.", "Nan has the Rat open as ever."],
    opening: "Hours after the granary, open at the Rat's door at dusk. End on the landlady, with a look at the rules board, asking the sergeant whether she's on duty.",
    lead,
  } }, replies: ["Prout went into the book as murder."] });
  try {
    const state: SessionState = {
      id: "crossing-between", sceneId: "hanged-clerk", approach: "v2", seed: 2, rollCount: 0,
      player: { name: "Caelith Ondraviel", concept: "an elf wizard", modifiers: {} },
      turn: 31, beat: "yard", turnsInBeat: 3, path: [], established: [], canon: [], notes: null, notesTurn: null,
      patches: [], repairs: [], metrics: [], history: [],
      transcript: [{ turn: 31, scene: "hanged-clerk", speaker: "kell", kind: "dialogue", text: "I couldn't tell you who." }],
    };
    forceEnding(state, "case-made");
    await chainScene(state, "the party won", { skipInterludes: true });
    const verdict = fake.sent.find(b => b.text?.format?.name === "boundary")!;
    assert.match(verdict.instructions!, /What someone tells them doesn't go against what that person said in play: what they found out since is told as new/);
    assert.match(verdict.instructions!, /It's always the story, never a note about it \(what the story does or doesn't say, or that there's no lead\)/);
    assert.match(verdict.input![0]!.content, /Whatever begins with an "if" happens only when play has made the if true/);
    const line = memoryLines("crossing-between", "kell").find(l => l.includes("Between The Hanged Clerk and The Drowned Rat"));
    assert.ok(line, "Kell remembers the time between");
    const path = /\]\(([^)]+)\)/.exec(line!)![1]!;
    const note = readDoc("crossing-between", `${memoryIndexPath("kell").replace(/index\.md$/, "")}${decodeURIComponent(path)}`)!;
    assert.match(note.body, /As Caelith Ondraviel heard it in the time between: As the hours pass, Kell tells you she saw a gentleman/);
    assert.match(note.body, /- Kell has signed Prout in as murdered, over the Captain's order\./);
    assert.doesNotMatch(note.body, /Nan has the Rat open/, "only what's about her");
    assert.ok(memoryLines("crossing-between", "nan-quill").some(l => l.includes("Between The Hanged Clerk and The Drowned Rat")), "and Nan, whom an adjustment is about");
    assert.equal(state.lead, lead);
  } finally {
    fake.restore();
  }
});

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
    // The opening is shown whole: none of it has happened yet.
    const opening = fake.sent.find(b => b.instructions?.startsWith("You are the Game Master"))!.input!.findLast(m => m.role === "developer")!.content;
    assert.match(opening, /Open the scene: show the whole of the opening below, from its first glance to the moment it ends on\. None of it has happened yet; the player sees all of it now, for the first time\./);
  } finally {
    fake.restore();
  }
});

test("the opening on entry is all shown, and the boundary writes it as directions, not the scene's lines (Kell answered a question the player never heard)", async () => {
  const state = { ...ratOpening("crossing-opening", []), opening: "At the Rat's door at dusk, the din drops as you step in. The landlady looks at the rules board, then at Kell. “Sergeant, are you on duty?”" };
  const directive = openingDirective(sceneById("drowned-rat"), state);
  assert.match(directive, /None of it has happened yet; the player sees all of it now, for the first time\./);
  assert.match(directive, /without repeating that scene's closing lines\. The opening, as it stands after what actually happened: At the Rat's door at dusk/);
  assert.match(directive, /end on what it ends on: something the player can respond to\.$/);
  assert.doesNotMatch(directive, /Pick up after the last scene's closing lines rather than repeating them/);
  assert.match(openingDirective(sceneById("hanged-clerk"), { ...state, history: [] }), /^Open the scene\. Open on the yard: Prout turning slowly/, "the story's first scene, as it's written");
  const fake = fakeOpenRouter({ replies: ["Kell signs Prout in as murdered."] });
  try {
    const granary: SessionState = { ...ratOpening("crossing-opening-boundary", []), sceneId: "hanged-clerk", beat: "yard", history: [], transcript: [] };
    forceEnding(granary, "case-made");
    await chainScene(granary, "the party won", { skipInterludes: true });
    const verdict = fake.sent.find(b => b.text?.format?.name === "boundary")!;
    assert.match(verdict.instructions!, /Write it as the author did: directions for its GM \(what to show, in what order, what to end on: "End on the landlady asking the sergeant whether she's on duty"\), never the scene's prose or its spoken lines; the GM writes those\./);
  } finally {
    fake.restore();
  }
});
