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

test("what someone saw or heard for themselves is a memory of theirs: a companion's included", () => {
  assert.match(CATEGORIES.witnessed!, /including whoever stood watch or kept out of the way, and a companion of the player's/);
  assert.deepEqual(plan(["witnessed"]), ["memories"], "the personal-memories review");
  assert.match(prompt("review/witnessed"), /'I only held him\. In the loft\. I only held the rope\.'", not "I recorded Hobb's admission"/, "in its own words");
});
