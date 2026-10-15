import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionState } from "./session.ts";

/**
 * What the GM is told so that its narration shows only what the player could see or has been told,
 * without model calls. It's given every fact, each with its status: what's out of the player's sight
 * in the world (the page sewn into Cob's boot), what they haven't come across yet, and whose names
 * they haven't heard. Hidden from it, a fast GM invents; listed like anything else, it narrated
 * "The folded page remains sewn inside Cob's left boot in the scullery" to a player who'd never met Cob.
 */

const RUNS = mkdtempSync(join(tmpdir(), "km-narration-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.OPENROUTER_API_KEY = "offline";
const { sceneById } = await import("../../scenes/index.ts");
const { buildWorld, joinWorld } = await import("../world/scene-world.ts");
const { effectiveScene, nowNote, outOfSight, presentCast, prompt, sceneBrief } = await import("./brief.ts");
const { chainScene, forceEnding } = await import("./engine.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");

/** A scene a few exchanges in, with its world as it opens. */
function at(sceneId: string, beat?: string): SessionState {
  const authored = sceneById(sceneId);
  const state = {
    id: `narration-${sceneId}`, sceneId, approach: "v2", seed: 3, rollCount: 0,
    player: { name: "Nim Bramblefoot", concept: "a halfling cutpurse", modifiers: {} },
    turn: 4, beat: beat ?? authored.start, turnsInBeat: 2, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [], landed: [], hinted: [],
  } as SessionState;
  const scene = effectiveScene(authored, state.patches);
  const cast = presentCast(scene, state).map(c => ({ id: c.id, name: c.name }));
  state.world = buildWorld(scene.id, scene.world!, cast, state.player);
  joinWorld(state.world, cast, 0);
  return state;
}

test("what's out of the player's sight: hidden, or inside what is, and neither theirs nor found", () => {
  const state = at("hanged-clerk");
  const scene = sceneById("hanged-clerk");
  assert.deepEqual(outOfSight(scene, state).map(e => e.id), ["ledger-page"], "the page sewn into the boot on Cob's feet, and nothing else");
  // Come across (its essential has landed), it's in the open.
  assert.deepEqual(outOfSight(scene, { ...state, landed: ["page"] }).map(e => e.id), []);
  // The player's own, they know of.
  const theirs = structuredClone(state);
  theirs.world!.entities["ledger-page"]!.parent = "player";
  assert.deepEqual(outOfSight(scene, theirs).map(e => e.id), []);
  // Gone, it's nowhere.
  const gone = structuredClone(state);
  gone.world!.entities["ledger-page"]!.states.push("destroyed");
  assert.deepEqual(outOfSight(scene, gone).map(e => e.id), []);
});

test("the world in the GM's note says what the player hasn't seen, by name and with that status", () => {
  const state = at("hanged-clerk");
  const scene = sceneById("hanged-clerk");
  const note = nowNote(scene, state, []);
  const world = note.slice(note.indexOf("## The world right now"));
  assert.match(world, /It's the truth behind the screen, not what the player has seen/);
  assert.match(world, /Out of the player's sight, and nobody has shown or told them of it: a folded page sewn into the left boot's lining \[ledger-page\]\. Until they find it, the narration doesn't mention it or where it is\./);
  // The GM still knows where it is: the world lists it under the boots.
  assert.match(world, /- a folded page sewn into the left boot's lining \[ledger-page\]/);
  const found = nowNote(scene, { ...state, landed: ["page"] }, []);
  assert.doesNotMatch(found, /Out of the player's sight/);
  // And the GM's instructions say what that means for the narration.
  assert.match(prompt("gm"), /Your narration shows what the player character can see and hear, and nothing they haven't seen or been told\./);
  assert.match(prompt("gm"), /never narrate it, not even to say it's still hidden \("the page stays in the boot"\)/);
});

test("names the player hasn't heard come last before the reply's form, with every name they go by", () => {
  const state = at("heron-warehouse", "floor");
  const scene = sceneById("heron-warehouse");
  const note = nowNote(scene, state, ["Hep shouts for the river door."], { remind: "Mark this reply up." });
  const names = note.indexOf("## Names the player hasn't heard yet");
  assert.ok(names > note.indexOf("## The world right now"), "after the world, which uses the names");
  assert.ok(names < note.indexOf("Mark this reply up.") && names < note.indexOf("## For this reply"));
  assert.match(note, /- Hepzibah Grist \(Hep\): "the forewoman with the sack-needle"/, "Hep is her name too");
  assert.match(note, /Your prep, the details established, the world and your directions use their names; your reply doesn't\./);
});

test("the prep's essentials each say whether the player has come across them, and what's owed is out of sight", () => {
  const state = at("hanged-clerk");
  const brief = sceneBrief(sceneById("hanged-clerk"), { ...state, landed: ["not-suicide"], hinted: ["silvertop"] });
  assert.match(brief, /Until they have, it's behind the screen: they don't know it, and the narration doesn't tell it/);
  assert.match(brief, /he was struck and strangled, then hoisted up for show\.[^\n]*\[already come across\]/);
  assert.match(brief, /countersigned 'J\. Sallow, for the Royal Purveyor'\.[^\n]*\[not come across yet\]/);
  assert.match(brief, /signet ring \(Sallow\) was in the loft that night\.[^\n]*\[already hinted at/);
  // Brought over from an earlier scene: where its things are is the GM's, never the narration's.
  const rat = sceneById("drowned-rat");
  const owed = effectiveScene(rat, [{ turn: 0, essential: rat.essentials!.find(e => e.missed)!, why: "brought over" }]);
  const ratBrief = sceneBrief(owed, { ...at("drowned-rat"), patches: [] });
  assert.match(ratBrief, /\[missed in an earlier scene, and the story still needs it: its things are where the world has them, with whoever has them, out of the player's sight until they find them or someone shows them; the narration never says where they are\]/);
  assert.doesNotMatch(ratBrief, /stays where the world has it/);
});

test("the boundary keeps the author's word on who isn't there yet when it rewrites the next opening (the Heron opened on the Master, who comes at midnight)", async () => {
  const fake = fakeOpenRouter({ replies: ["Hobb goes down the stairs to his work."] });
  try {
    const state = { ...at("drowned-rat"), id: "narration-boundary", turn: 20 };
    delete state.world;
    forceEnding(state, "gone-to-work");
    await chainScene(state, "the party won", { skipInterludes: true });
    const verdict = fake.sent.find(b => b.text?.format?.name === "boundary")!;
    assert.match(verdict.instructions!, /Nobody is there sooner than its prep brings them on \("at the midnight bell the Master comes"\) unless play has sent them there already/);
    assert.match(verdict.instructions!, /and who isn't there yet: "Don't show Master Sallow: he isn't here yet"\) and drop or change only what the adjustments make untrue/);
  } finally {
    fake.restore();
  }
});
