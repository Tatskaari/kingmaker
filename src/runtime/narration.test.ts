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
const { effectiveScene, genderOf, nowNote, outOfSight, presentCast, prompt, sceneBrief } = await import("./brief.ts");
const { chainScene, forceEnding, playerTurn, resumeAfterFight } = await import("./engine.ts");
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
  // The world is as things stood before the player's turn (the clerk turned the open book the player had just buttoned into her coat).
  assert.match(world, /It's as things stood before the player's turn: what the player does in it \(shutting a book and buttoning it into their coat, picking something up, crossing the room\) has happened by your reply, and the world catches up after it\./);
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
  assert.match(note, /Your prep, the details established, the world and your directions use their names; your narration doesn't, until someone says it\./);
});

test("the prep's essentials each say whether the player has come across them, and what's owed is out of sight", () => {
  const state = at("hanged-clerk");
  const brief = sceneBrief(sceneById("hanged-clerk"), { ...state, landed: ["not-suicide"], hinted: ["silvertop"] });
  assert.match(brief, /Until they have, it's behind the screen: they don't know it, and it comes out only through play/);
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

test("the player character as they are: a woman isn't sir, their past is what it says, and they do only what the player says", () => {
  const nim = { name: "Nim Bramblefoot", concept: "a halfling cutpurse and smooth liar", modifiers: {}, backstory: { text: "I tell folk I'm a cooper's girl. I'm not.", summary: "Nim Bramblefoot is a river-raised halfling cutpurse, freed after two years in irons for a strongbox theft Tobin Wick pinned on her. She owes Old Marrow forty silver by the next new moon, carries a grudge against Tobin, and took this case for reasons not yet stated.", personality: [], ideals: [], bonds: [], flaws: [] } };
  const caelith = { name: "Caelith Ondraviel", concept: "an elf wizard and college pedant, certain he is the cleverest in any room", modifiers: {}, backstory: { text: "Caelith took his robes at forty.", summary: "Caelith Ondraviel is a young elf wizard sent away from his college after publicly challenging its Provost's prize decision.", personality: [], ideals: [], bonds: [], flaws: [] } };
  const wren = { name: "Wren Ashdown", concept: "a soft-spoken former pickpocket who now carries letters for hire", modifiers: {} };
  assert.equal(genderOf(nim), "woman");
  assert.equal(genderOf(caelith), "man");
  assert.equal(genderOf(wren), undefined);
  const scene = sceneById("hanged-clerk");
  const brief = (player: SessionState["player"]) => sceneBrief(scene, { ...at("hanged-clerk"), player });
  assert.match(brief(nim), /She's a woman: people speak of her as she and her, and address her as they'd address a woman \(mistress, missus, miss or madam, as fits who's talking\), never as sir\./);
  assert.match(brief(caelith), /He's a man: people speak of him as he and him/);
  assert.match(brief(wren), /Nothing says whether they're a man or a woman: until the player shows it, people address them by name or by what they're here as, not as sir or madam\./);
  assert.match(brief(caelith), /it's all there is of their past: nobody adds to it \(a prison, a crime, a debt or a trade it doesn't have\)/);
  const gm = prompt("gm");
  assert.match(gm, /They do what the player says, the way the player says it, and no more: they don't hurry, slip or fall, step outside, or take anyone anywhere unless the player says so/);
  assert.match(gm, /Nor do they say the player's words back to them/);
});

test("the rules in the prose are told in the story's words and counted as the rules counted (Detect Magic pasted, four darts from a 1st-level Magic Missile)", () => {
  const gm = prompt("gm");
  assert.match(gm, /Tell it in the story's words, never the rulebook's \(no ranges, actions or "you may use your action"\), and count only what the rules counted: as many darts as struck, a spell's time as long as the rules gave it\./);
  assert.match(gm, /A dead body is a thing, not a creature, for what a spell can move\./);
});

test("things happen once: a beat's agenda comes with its status the second time, and old facts give way to the world", () => {
  const scene = sceneById("hanged-clerk");
  const state = { ...at("hanged-clerk", "motive"), established: ["Moll has dropped from the wall and put herself between Caelith and Cob, holding Cob by the shoulder."] };
  const agenda = (turnsInBeat: number) => nowNote(scene, { ...state, turnsInBeat }, []);
  assert.match(agenda(0), /What people are after in this part of the scene \(they pursue it naturally[^\n]*\n- Sergeant Agnes Kell: Read the page and go still/);
  assert.match(agenda(1), /The last reply began it: whatever of it they've already said or done there is said and done, so they don't say or do it again[^\n]*\n- Sergeant Agnes Kell: Read the page and go still/);
  assert.doesNotMatch(agenda(2), /- Sergeant Agnes Kell: Read the page/);
  assert.match(agenda(2), /People have already made their wants known here/);
  assert.match(agenda(3), /## Details established in play \(keep them true\)\nWhat has happened and been found, in the order it happened\. Where people are and what they're doing now is the world's, below: a detail here about where someone was or what they were doing was true then/);
});

test("a closing doesn't show again what the scene has shown (Kell's arrest of Hobb came twice, word for word)", async () => {
  const fake = fakeOpenRouter({ replies: ["You leave them to it, and the wharf takes you."] });
  try {
    const state = { ...at("drowned-rat"), id: "narration-closing", closing: { exitId: "taken-in", turn: 4 } };
    delete state.world;
    await playerTurn(state, "*I give Hobb a small nod and leave them to it.*");
    const told = fake.sent.filter(b => b.instructions?.startsWith("You are the Game Master")).at(-1)!.input!.at(-1)!.content;
    assert.match(told, /The scene is ending: Sergeant Kell has arrested Big Hobb/);
    assert.match(told, /What the scene has already shown has happened: don't show it again or say any line of it twice; if this ending's moment has already played, close from where it stands\./);
    // And in the story's voice: plain fates, only the promises made, none of the game's words.
    assert.match(told, /Tell it in the story's own voice: what became of people, said plainly as what became of them[^\n]*only the promises actually made in play; never the game's words \(established, the story, this scene, between scenes\)\./);
    assert.equal(state.ended?.exitId, "taken-in");
  } finally {
    fake.restore();
  }
});

test("the aftermath stands: the fight's result is the summary's, the world says who's down, and what it narrates is staged", async () => {
  // The player's own states come before who they're by: "by … Master Josiah Sallow (down)" read as Sallow down.
  const state = { ...at("hanged-clerk"), id: "narration-aftermath" };
  state.world!.entities.player!.states.push("down");
  const view = nowNote(sceneById("hanged-clerk"), state, []);
  assert.match(view, /\nThe player \(down\) is by [^\n]*\./);
  assert.doesNotMatch(view, /The player is by [^\n]*\(down\)/);
  state.ended = { exitId: "case-made", turn: 4, operations: [], warnings: [] };
  const fake = fakeOpenRouter({ replies: ["You come round on the cobbles. Kell stands over you; Cob has the page."] });
  try {
    await resumeAfterFight(state, "Kell was still on her feet at the end. The player was knocked out.");
    const told = fake.sent.filter(b => b.instructions?.startsWith("You are the Game Master")).at(-1)!.input!.findLast(m => m.role === "developer")!.content;
    assert.match(told, /The fight's result stands as it went, whatever the details established before it or the world's last word say: who is standing and who is down is as this says\./);
    assert.match(told, /what the player carried that they'd want is theirs to take, and they take it/);
    assert.ok(fake.sent.some(b => b.text?.format?.name === "world_ops"), "the stage manager read the aftermath");
    assert.ok(!state.world!.entities.player!.states.includes("gone"));
  } finally {
    fake.restore();
  }
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
    // The world's turn brings what's come due into the next scene as what happens there (the bills for the
    // granary fire and the attack on Sallow were in the King's GM's lore, and never showed).
    const fronts = fake.sent.find(b => b.text?.format?.name === "fronts")!;
    assert.match(fronts.instructions!, /and first any bill \(listed already, or new\) that comes due there, as what happens there and who brings it/);
  } finally {
    fake.restore();
  }
});
