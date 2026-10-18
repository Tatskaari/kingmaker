// Copied from the prototype's src/runtime/story.test.ts at 44c6d4a (here as story-so-far.test.ts: story.test.ts is gm/story.ts's): its cases but the actors' next speaker (the actors' voice isn't v2's). A session is a TurnView of the test story (fixtures.ts), the boundary gm/boundary.ts's chainScene over the candidates the simulation sends, and the lore the campaign's.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureDocs } from "../docs/config.ts";
import { CATEGORIES, plan } from "../docs/reviews.ts";
import { JevDecider, LUNA_DECISIONS_MODEL } from "../llm/decide.ts";
import { fakeFetch } from "../llm/fake-openrouter.ts";
import type { CallContext } from "../llm/openrouter.ts";
import { prompt } from "../prompts/index.ts";
import type { PlaceFile } from "../../shared/scene/files.ts";
import { effectiveScene } from "../../shared/scene/graph.ts";
import { inventory } from "../../shared/world/inventory.ts";
import { buildWorld } from "../../shared/world/scene-world.ts";
import { chainScene } from "./boundary.ts";
import { sceneBrief } from "./brief.ts";
import { CAERWYN, sceneById, stateIn } from "./fixtures.ts";
import type { TurnView } from "./view.ts";

/**
 * The story's facts reach the GM across scenes: every scene's hand-off and what play settled there
 * is in the GM's prep, the hand-off keeps what someone admitted and what a companion saw, and what
 * someone saw or heard for themselves is a memory of theirs.
 */

const overlays = mkdtempSync(join(tmpdir(), "km-story-so-far-"));
after(() => rmSync(overlays, { recursive: true, force: true }));
configureDocs({ loreRoot: join(CAERWYN, "lore"), overlay: game => join(overlays, game) });

const ADMITTED = "Hobb admitted he held Prout in the loft and held the rope. He says he was coerced; he has not named the Master.";
const TOKEN = "Hobb has handed over his brass river-door token for the Heron (to the player or to Kell).";

/** The King's morning, after the granary, the Rat and the Heron, as Brother Ambrose's game had them. */
function morning(): TurnView {
  return stateIn("kings-morning", {
    id: "story-brief", player: { name: "Brother Ambrose Hake", concept: "a disgraced temple bookkeeper", modifiers: {} },
    turn: 90, beat: "report", turnsInBeat: 0,
    history: [
      { sceneId: "hanged-clerk", exitId: "open-case", summary: "Previous scene, \"The Hanged Clerk\", ended: Murder by persons unknown.\nKell wrote Prout up as murdered." },
      { sceneId: "drowned-rat", exitId: "gone-to-work", summary: `Previous scene, "The Drowned Rat", ended: Hobb goes to work.\n- ${ADMITTED}`, facts: [TOKEN] },
      { sceneId: "heron-warehouse", exitId: "barge-sails", summary: "Previous scene, \"The Heron Warehouse\", ended: The barge sails.\nKell watched Sallow come in at the land door at the midnight bell.", lastMoments: ["The Patience slips her moorings."] },
    ],
  });
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
  const fake = fakeFetch({ replies: ["Ambrose is at the top of the river stairs with Hobb's token."] });
  const calls: CallContext = { fetch: fake.fetch, apiKey: "test", log: () => {}, cost: () => {} };
  const rat = sceneById("drowned-rat");
  const state = stateIn("drowned-rat", {
    id: "story-chain", player: { name: "Brother Ambrose Hake", concept: "a disgraced temple bookkeeper", modifiers: {} },
    turn: 66, beat: "confession", turnsInBeat: 6, established: [TOKEN],
    transcript: [
      { turn: 55, scene: "drowned-rat", speaker: "hobb", kind: "dialogue", text: "I only held him. In the loft. I only held the rope." },
      { turn: 66, scene: "drowned-rat", speaker: "system", kind: "system", text: "Scene ends: Hobb goes to work" },
    ],
  });
  const crossed = await chainScene(rat, state, rat.exits.find(e => e.id === "gone-to-work")!, ["heron-warehouse", "kings-morning"].map(sceneById), { calls, sceneById, decider: new JevDecider(LUNA_DECISIONS_MODEL, "luna-decisions", calls) });
  assert.deepEqual(crossed.chapter.facts, [TOKEN]);
  const handoff = fake.sent.find(b => b.instructions?.startsWith("You write the hand-off"))!;
  assert.match(handoff.instructions!, /Always keep, when there are any: what anyone confessed or admitted, in their own words and in whose hearing/);
  assert.match(handoff.instructions!, /what each person who goes on with the player \(a partner, a companion\) saw and heard for themselves, from where they were/);
});

test("the hand-off and the verdict know what the player carries as the scene ends, by the world: a token an ending or a skipped scene put in their hands, which the transcript never mentions", async () => {
  const fake = fakeFetch({ replies: ["Wren leaves the Rat with Hobb's token."] });
  const calls: CallContext = { fetch: fake.fetch, apiKey: "test", log: () => {}, cost: () => {} };
  const rat = sceneById("drowned-rat");
  const place = JSON.parse(readFileSync(join(CAERWYN, "places", "drowned-rat.json"), "utf8")) as PlaceFile;
  const world = buildWorld(rat.id, place, rat.cast.map(c => ({ id: c.id, name: c.name })), { name: "Wren Ashdown" });
  inventory(world, 0).settle("heron-token", "player");
  const state = stateIn("drowned-rat", { world, transcript: [{ turn: 1, scene: "drowned-rat", speaker: "system", kind: "system", text: "Scene ends: What Big Hobb knows" }] });
  await chainScene(rat, state, rat.exits.find(e => e.id === "hobb-talks")!, ["heron-warehouse", "kings-morning"].map(sceneById), { calls, sceneById, decider: new JevDecider(LUNA_DECISIONS_MODEL, "luna-decisions", calls) });
  const inputOf = (start: string) => (fake.sent.find(b => b.instructions?.startsWith(start))!.input as Array<{ content: string }>).map(m => m.content).join("\n");
  for (const call of ["You write the hand-off", "The upcoming scenes of a roleplaying game"]) {
    assert.match(inputOf(call), /What the player character carries as it ends, by the world's record \(what play put in their hands, and what the ending gave them\): a brass heron token on a greasy string\./, call);
  }
});

test("nobody answers a question put to the player for them, and nobody knows what they couldn't (the King's morning: Kell answered for the investigator, and the King asked after a barge nobody had told him of)", () => {
  const gm = prompt("gm");
  assert.match(gm, /A question put to the player character is theirs to answer: nobody answers it for them, over them or before them \(a companion included\), and the reply stops on it\./);
  assert.match(gm, /A companion speaks to what they saw themselves when the player calls on them, or once if the player's word is doubted, and never to what they didn't see\./);
  assert.match(gm, /What you know of the story \(your prep, earlier scenes, what happened elsewhere\) isn't theirs, so nobody asks about, names or guesses at something they haven't heard of\./);
  assert.match(prompt("actor"), /A question put to the player's character is theirs to answer: don't answer it for them or over them\./);
  assert.match(prompt("narrator"), /a question put to them is theirs to answer, not anyone else's/);
});

test("what someone saw or heard for themselves goes in the GM's notes on them: a companion's included, in the words that matter", () => {
  assert.match(CATEGORIES.learned!, /including whoever stood watch or kept out of the way, and a companion of the player's/);
  assert.deepEqual(plan(["learned"]), ["notes"], "the notes review");
  assert.deepEqual(plan(["improvised_detail"]), ["notes", "lore"], "a world fact has its witnesses too");
  assert.match(prompt("memory-review"), /"Heard Hobb say: 'I only held him\. In the loft\.'", not "Witnessed Hobb's admission"\), for whoever stood watch or kept out of the way and for the player's companion too/, "in its own words");
});
