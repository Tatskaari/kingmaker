// Copied from the prototype's src/runtime/narration.test.ts at 44c6d4a: its prompt-content tests on the hanged clerk (out of sight, the world note, the essentials' status, the player character, things happen once), and its names test moved from the Heron to the hanged clerk. The scene is campaigns/caerwyn's, the state a TurnView (fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { prompt } from "../prompts/index.ts";
import { genderOf, nowNote, outOfSight, sceneBrief } from "./brief.ts";
import { hangedClerk, viewAt } from "./fixtures.ts";
import type { TurnView } from "./view.ts";

/**
 * What the GM is told so that its narration shows only what the player could see or has been told,
 * without model calls. It's given every fact, each with its status: what's out of the player's sight
 * in the world (the page sewn into Cob's boot), what they haven't come across yet, and whose names
 * they haven't heard. Hidden from it, a fast GM invents; listed like anything else, it narrated
 * "The folded page remains sewn inside Cob's left boot in the scullery" to a player who'd never met Cob.
 */

const scene = hangedClerk();

test("what's out of the player's sight: hidden, or inside what is, and neither theirs nor found", () => {
  const state = viewAt(scene);
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
  const state = viewAt(scene);
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

test("names the player hasn't heard come last before the reply's form, with what they'd call them", () => {
  const state = viewAt(scene);
  const note = nowNote(scene, state, ["Cob shouts for Moll."], { remind: "Mark this reply up." });
  const names = note.indexOf("## Names the player hasn't heard yet");
  assert.ok(names > note.indexOf("## The world right now"), "after the world, which uses the names");
  assert.ok(names < note.indexOf("Mark this reply up.") && names < note.indexOf("## For this reply"));
  assert.match(note, /- Cob: "the boy in the too-big boots"\n- Moll: "the girl in the shawl"/);
  assert.match(note, /Your prep, the details established, the world and your directions use their names; your narration doesn't, until someone says it\./);
  // Once someone says a name, it's heard.
  const heard = nowNote(scene, { ...state, transcript: [{ turn: 1, speaker: "gm", kind: "narration", text: "“Cob, get down from there,” the girl hisses." }] }, []);
  assert.doesNotMatch(heard, /- Cob: /);
  assert.match(heard, /- Moll: "the girl in the shawl"/);
});

test("the prep's essentials each say whether the player has come across them", () => {
  const state = viewAt(scene);
  const brief = sceneBrief(scene, { ...state, landed: ["not-suicide"], hinted: ["silvertop"] });
  assert.match(brief, /Until they have, it's behind the screen: they don't know it, and it comes out only through play/);
  assert.match(brief, /he was struck and strangled, then hoisted up for show\.[^\n]*\[already come across\]/);
  assert.match(brief, /countersigned 'J\. Sallow, for the Royal Purveyor'\.[^\n]*\[not come across yet\]/);
  assert.match(brief, /signet ring \(Sallow\) was in the loft that night\.[^\n]*\[already hinted at/);
});

test("the player character as they are: a woman isn't sir, their past is what it says, and they do only what the player says", () => {
  const nim = { name: "Nim Bramblefoot", concept: "a halfling cutpurse and smooth liar", modifiers: {}, backstory: { text: "I tell folk I'm a cooper's girl. I'm not.", summary: "Nim Bramblefoot is a river-raised halfling cutpurse, freed after two years in irons for a strongbox theft Tobin Wick pinned on her. She owes Old Marrow forty silver by the next new moon, carries a grudge against Tobin, and took this case for reasons not yet stated.", personality: [], ideals: [], bonds: [], flaws: [] } };
  const caelith = { name: "Caelith Ondraviel", concept: "an elf wizard and college pedant, certain he is the cleverest in any room", modifiers: {}, backstory: { text: "Caelith took his robes at forty.", summary: "Caelith Ondraviel is a young elf wizard sent away from his college after publicly challenging its Provost's prize decision.", personality: [], ideals: [], bonds: [], flaws: [] } };
  const wren = { name: "Wren Ashdown", concept: "a soft-spoken former pickpocket who now carries letters for hire", modifiers: {} };
  assert.equal(genderOf(nim), "woman");
  assert.equal(genderOf(caelith), "man");
  assert.equal(genderOf(wren), undefined);
  const brief = (player: TurnView["player"]) => sceneBrief(scene, { ...viewAt(scene), player });
  assert.match(brief(nim), /She's a woman: people speak of her as she and her, and address her as they'd address a woman \(mistress, missus, miss or madam, as fits who's talking\), never as sir\./);
  assert.match(brief(caelith), /He's a man: people speak of him as he and him/);
  assert.match(brief(wren), /Nothing says whether they're a man or a woman: until the player shows it, people address them by name or by what they're here as, not as sir or madam\./);
  assert.match(brief(caelith), /it's all there is of their past: nobody adds to it \(a prison, a crime, a debt or a trade it doesn't have\)/);
  const gm = prompt("gm");
  assert.match(gm, /They do what the player says, the way the player says it, and no more: they don't hurry, slip or fall, step outside, or take anyone anywhere unless the player says so/);
  assert.match(gm, /Nor do they say the player's words back to them/);
});

test("things happen once: a beat's agenda comes with its status the second time, and old facts give way to the world", () => {
  const state = { ...viewAt(scene, "motive"), established: ["Moll has dropped from the wall and put herself between Caelith and Cob, holding Cob by the shoulder."] };
  const agenda = (turnsInBeat: number) => nowNote(scene, { ...state, turnsInBeat }, []);
  assert.match(agenda(0), /What people are after in this part of the scene \(they pursue it naturally[^\n]*\n- Sergeant Agnes Kell: Read the page and go still/);
  assert.match(agenda(1), /The last reply began it: whatever of it they've already said or done there is said and done, so they don't say or do it again[^\n]*\n- Sergeant Agnes Kell: Read the page and go still/);
  assert.doesNotMatch(agenda(2), /- Sergeant Agnes Kell: Read the page/);
  assert.match(agenda(2), /People have already made their wants known here/);
  assert.match(agenda(3), /## Details established in play \(keep them true\)\nWhat has happened and been found, in the order it happened\. Where people are and what they're doing now is the world's, below: a detail here about where someone was or what they were doing was true then/);
});
