import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
const RUNS = mkdtempSync(join(tmpdir(), "km-story-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.OPENROUTER_API_KEY = "offline";
const { sceneById } = await import("../../scenes/index.ts");
const { effectiveScene, prompt, sceneBrief } = await import("./brief.ts");
const { chainScene, forceEnding } = await import("./engine.ts");
const { CATEGORIES, plan } = await import("../lore/reviews.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
type SessionState = import("./session.ts").SessionState;

/**
 * The story's facts reach the GM across scenes: every scene's hand-off and what play settled there
 * is in the GM's prep, the hand-off keeps what someone admitted and what a companion saw, and what
 * someone saw or heard for themselves is a memory of theirs.
 */

const ADMITTED = "Hobb admitted he held Prout in the loft and held the rope. He says he was coerced; he has not named the Master.";
const TOKEN = "Hobb has handed over his brass river-door token for the Heron (to the player or to Kell).";

/** The King's morning, after the granary, the Rat and the Heron, as Brother Ambrose's game had them. */
function morning(): SessionState {
  return {
    id: "story-brief", sceneId: "kings-morning", approach: "v2", seed: 1, rollCount: 0,
    player: { name: "Brother Ambrose Hake", concept: "a disgraced temple bookkeeper", modifiers: {} },
    turn: 90, beat: "report", turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [],
    history: [
      { sceneId: "hanged-clerk", exitId: "open-case", summary: "Previous scene, \"The Hanged Clerk\", ended: Murder by persons unknown.\nKell wrote Prout up as murdered." },
      { sceneId: "drowned-rat", exitId: "gone-to-work", summary: `Previous scene, "The Drowned Rat", ended: Hobb goes to work.\n- ${ADMITTED}`, facts: [TOKEN] },
      { sceneId: "heron-warehouse", exitId: "barge-sails", summary: "Previous scene, \"The Heron Warehouse\", ended: The barge sails.\nKell watched Sallow come in at the land door at the midnight bell.", lastMoments: ["The Patience slips her moorings."] },
    ],
  };
}

test("the GM's prep has the whole story, scene by scene: every hand-off, what play settled there, and the last moments", () => {
  const scene = effectiveScene(sceneById("kings-morning"), []);
  // As v2 runs it (memory "docs"), which used to have only the last hand-off.
  const brief = sceneBrief(scene, morning(), { docs: true });
  assert.ok(brief.includes(ADMITTED), "the confession at the Rat, two scenes back");
  assert.match(brief, /Hobb goes to work\.\n- Hobb admitted[^\n]*\nSettled in play there:\n- Hobb has handed over his brass river-door token/);
  assert.match(brief, /Kell watched Sallow come in at the land door/);
  assert.match(brief, /The last moments, word for word:\n> The Patience slips her moorings\./);
  assert.ok(brief.indexOf("The Hanged Clerk") < brief.indexOf("The Drowned Rat") && brief.indexOf("The Drowned Rat") < brief.indexOf("The Heron Warehouse"), "earliest first");
  assert.match(brief, /someone who wasn't there knows nothing of it until they hear it, and doesn't ask about it, refer to it or guess at it before then/);
  assert.doesNotMatch(brief, /Earlier scenes are in the story notes/);
  // Where the boundary says the prep is out of date, that's the GM's knowledge too (the King knew of the Heron's ledger from it).
  const adjusted = sceneBrief(scene, { ...morning(), adjustments: ["The ledger was left in the counting-box under Scrope's hand; it is gone with the emptied Heron."] }, { docs: true });
  assert.match(adjusted, /## Where the prep is out of date\n[^\n]*Like the story so far, they're your knowledge: people here know of them only what they saw, were there for or have been told\.[^\n]*\n- The ledger was left/);
  assert.match(adjusted, /Where one is the world answering what the player did \(an account given against them, a claim, someone demanding a reckoning\), it comes up in this scene through the people it names/);
});

test("a scene's facts go on with the story, and the hand-off keeps what was admitted and what a companion saw", async () => {
  const fake = fakeOpenRouter({ replies: ["Ambrose is at the top of the river stairs with Hobb's token."] });
  try {
    const state: SessionState = {
      id: "story-chain", sceneId: "drowned-rat", approach: "v2", seed: 2, rollCount: 0,
      player: { name: "Brother Ambrose Hake", concept: "a disgraced temple bookkeeper", modifiers: {} },
      turn: 66, beat: "confession", turnsInBeat: 6, path: [], established: [TOKEN], canon: [], notes: null, notesTurn: null,
      patches: [], repairs: [], transcript: [{ turn: 55, scene: "drowned-rat", speaker: "hobb", kind: "dialogue", text: "I only held him. In the loft. I only held the rope." }], metrics: [], history: [],
    };
    forceEnding(state, "gone-to-work");
    await chainScene(state, "the party won", { skipInterludes: true });
    assert.deepEqual(state.history.at(-1)!.facts, [TOKEN]);
    const handoff = fake.sent.find(b => b.instructions?.startsWith("You write the hand-off"))!;
    assert.match(handoff.instructions!, /Always keep, when there are any: what anyone confessed or admitted, in their own words and in whose hearing/);
    assert.match(handoff.instructions!, /what each person who goes on with the player \(a partner, a companion\) saw and heard for themselves, from where they were/);
  } finally {
    fake.restore();
  }
});

test("nobody answers a question put to the player for them, and nobody knows what they couldn't (the King's morning: Kell answered for the investigator, and the King asked after a barge nobody had told him of)", async () => {
  const gm = prompt("gm");
  assert.match(gm, /A question put to the player character is theirs to answer: nobody answers it for them, over them or before them \(a companion included\), and the reply stops on it\./);
  assert.match(gm, /A companion speaks to what they saw themselves when the player calls on them, or once if the player's word is doubted, and never to what they didn't see\./);
  assert.match(gm, /What you know of the story \(your prep, earlier scenes, what happened elsewhere\) isn't theirs, so nobody asks about, names or guesses at something they haven't heard of\./);
  assert.match(prompt("actor"), /A question put to the player's character is theirs to answer: don't answer it for them or over them\./);
  assert.match(prompt("narrator"), /a question put to them is theirs to answer, not anyone else's/);
  // The actors' next speaker: after a question to the player's character, it's the player's turn.
  const { decideNextSpeaker } = await import("./director.ts");
  const asked: string[] = [];
  const decider = { name: "scripted", async decide(_s: unknown, q: Record<string, { instructions: string }>) { asked.push(q.next!.instructions); return { answers: { next: { choice: "player", probabilities: { player: 1 } } }, latencyMs: 0, costUsd: 0, decider: "scripted" }; } };
  await decideNextSpeaker(decider, effectiveScene(sceneById("kings-morning"), []), morning(), "Majesty.", ["King Aldren"]);
  assert.match(asked[0]!, /If someone has just put a question to the player's character, it's always player: nobody answers it for them\./);
});

test("what someone saw or heard for themselves is a memory of theirs: a companion's included", () => {
  assert.match(CATEGORIES.witnessed!, /including whoever stood watch or kept out of the way, and a companion of the player's/);
  assert.deepEqual(plan(["witnessed"]), ["memories"], "the personal-memories review");
  assert.match(prompt("review/witnessed"), /'I only held him\. In the loft\. I only held the rope\.'", not "I recorded Hobb's admission"/, "in its own words");
});
