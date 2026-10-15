import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Ask } from "../llm/openrouter.ts";

/**
 * The backstory (src/lore/backstory.ts) with the model stood in for: the lore a backstory is
 * checked against (the docs service's World, places and Cast, the deeper truth for whoever it
 * touches), what the lore check finds and the fix it offers (accepted only where its words are),
 * drafting and working notes in (nothing they wrote left out), what it says of them (from the model,
 * or offline from their own words); and what reaches the GM: who they are in every brief, the whole
 * of it in the session's own lore (never the authored lore), known in the story only where someone
 * would know it.
 */

process.env.KM_RUNS_DIR = mkdtempSync(join(tmpdir(), "km-backstory-"));
process.env.OPENROUTER_API_KEY = "offline";
const { applyFix, canonFor, checkLore, draftBackstory, finishBackstory, keepWords, leftOut, locate, traitsFromWords, workIn } = await import("./backstory.ts");
const { LORE_ROOT, playerDocPath, readDoc } = await import("./docs.ts");

const WHO = { name: "Tamsin Vell", concept: "a disgraced palace auditor with a borrowed rapier", build: "halfling rogue 3 (Thief), sage background" };

/** A model that answers each operation as it's told to, and keeps what it was asked. */
function model(answers: Record<string, unknown | ((input: string) => unknown)>): { ask: Ask; asked: Array<{ operation: string; input: string; instructions: string }> } {
  const asked: Array<{ operation: string; input: string; instructions: string }> = [];
  const ask: Ask = async <T>(request: Parameters<Ask>[0]) => {
    const input = request.input.map(m => m.content).join("\n");
    asked.push({ operation: request.operation, input, instructions: request.instructions ?? "" });
    const answer = answers[request.operation];
    if (answer === undefined) throw new Error(`nothing to say to ${request.operation}`);
    return (typeof answer === "function" ? (answer as (i: string) => unknown)(input) : answer) as T;
  };
  return { ask, asked };
}

test("the lore a backstory is checked against: everything public, and the deeper truth for whoever and wherever it touches", () => {
  const plain = canonFor("I grew up on a turnip farm in the Nine Furrows. My mother drowned in the flood.").map(d => d.path);
  assert.ok(plain.includes("World/Caerwyn.md") && plain.includes("Cast/King Aldren/public.md") && plain.includes("Cast/Sergeant Agnes Kell/public.md"), "the world and the cast's public faces");
  assert.ok(!plain.some(p => /gm\.md$|private\.md$|\(truth\)/.test(p)), `nothing deeper for a story that touches nobody: ${plain.filter(p => /gm|private|truth/.test(p)).join(", ")}`);
  const royal = canonFor("I'm the King's nephew, and Sergeant Kell taught me to read.").map(d => d.path);
  for (const p of ["Cast/King Aldren/gm.md", "Cast/King Aldren/private.md", "Cast/Sergeant Agnes Kell/gm.md", "World/City Watch (truth).md"]) assert.ok(royal.includes(p), p);
  assert.ok(!royal.includes("Cast/Nan Quill/gm.md"), "not someone it doesn't touch");
  assert.ok(canonFor("I drank at the Drowned Rat most nights.").some(d => d.path === "Places/The Drowned Rat (truth).md"));
});

test("the lore check finds what contradicts canon, quotes it as written, and offers a fix that's only applied where its words are", async () => {
  const story = "I'm the King's nephew, though nobody at court will say so.\nI came to Caerwyn in the spring, owing Fat Jory three crowns.";
  const { ask, asked } = model({
    "backstory.check": { issues: [
      // The model's copy of the words differs in case and its quote marks: they're found as written.
      { quote: "i'm the king’s nephew", problem: "King Aldren's family is known to all Caerwyn, and there's no nephew in it.", fix: "I'm a cousin of a minor courtier, twice removed" },
      { quote: "words that aren't there", problem: "Something else.", fix: "Something better." },
    ] },
  });
  const checked = await checkLore(story, WHO, { ask });
  assert.ok(checked.ok);
  const [nephew, lost] = checked.value;
  assert.equal(nephew!.quote, "I'm the King's nephew", "the backstory's own words");
  assert.equal(lost!.quote, undefined, "words it can't find: rewrite, not accept");
  assert.equal(applyFix(story, nephew!), "I'm a cousin of a minor courtier, twice removed, though nobody at court will say so.\nI came to Caerwyn in the spring, owing Fat Jory three crowns.");
  assert.equal(applyFix(story, lost!), undefined, "nothing changed where the words aren't");
  // A fix fitted to where it goes: no capital mid-sentence (a name keeps its own), one where a sentence starts, the full stop kept and not doubled.
  const lucan = "I'm the King's nephew, and Sergeant Kell is my aunt: she taught me to fence. I owe Master Fenwick forty crowns.";
  const fix = (quote: string, with_: string, text = lucan) => applyFix(text, { quote, problem: "", fix: with_ });
  assert.equal(fix("Sergeant Kell is my aunt: she taught me to fence.", "A retired watchman taught me to fence near the watch house"),
    "I'm the King's nephew, and a retired watchman taught me to fence near the watch house. I owe Master Fenwick forty crowns.");
  assert.equal(fix("Sergeant Kell is my aunt", "Master Fenwick's cousin is my aunt"), "I'm the King's nephew, and Master Fenwick's cousin is my aunt: she taught me to fence. I owe Master Fenwick forty crowns.");
  assert.equal(fix("I owe Master Fenwick forty crowns.", "my tailor is owed forty crowns."), "I'm the King's nephew, and Sergeant Kell is my aunt: she taught me to fence. My tailor is owed forty crowns.");
  assert.equal(fix("I'm the King's nephew", "I hoped the King would notice me."), "I hoped the King would notice me, and Sergeant Kell is my aunt: she taught me to fence. I owe Master Fenwick forty crowns.");
  // A fix that runs on past its quote, or back before it, doesn't say those words twice.
  const duel = "I left the palace after a duel over a card game and have lived on credit and charm since. I owe my tailor forty crowns.";
  assert.equal(fix("I left the palace after a duel over a card game", "I left a grand house after a duel over a card game, and have lived on credit and charm since.", duel),
    "I left a grand house after a duel over a card game and have lived on credit and charm since. I owe my tailor forty crowns.");
  assert.equal(fix("Sergeant Kell is my aunt", "and a retired watchman is my aunt"), "I'm the King's nephew, and a retired watchman is my aunt: she taught me to fence. I owe Master Fenwick forty crowns.");
  assert.equal(fix("Master Fenwick forty crowns.", "Master Fenwick, my tailor, forty crowns."), "I'm the King's nephew, and Sergeant Kell is my aunt: she taught me to fence. I owe Master Fenwick, my tailor, forty crowns.", "words of its own that happen to match aren't cut");
  // The model was told the lore through the docs service, the King's truth among it, and the backstory word for word.
  assert.equal(asked.length, 1);
  assert.match(asked[0]!.input, /### Cast\/King Aldren\/gm\.md \(the GM's truth: never tell the player what's in it\)/);
  assert.match(asked[0]!.input, /## Their backstory, word for word\nI'm the King's nephew/);
  assert.match(asked[0]!.instructions, /never what the truth is/, "a problem never gives away a GM's secret");
  assert.match(asked[0]!.instructions, /keep its spirit/);
  assert.match(asked[0]!.instructions, /never keeps what didn't fit by another road/, "a fix fits the world too (the game checks it once more besides)");
});

test("a backstory that fits comes back with nothing to fix; offline it isn't checked, and says so", async () => {
  const { ask } = model({ "backstory.check": { issues: [] } });
  assert.deepEqual(await checkLore("I mended nets on the wharves.", WHO, { ask }), { ok: true, value: [] });
  const offline = await checkLore("I mended nets on the wharves.", WHO);
  assert.equal(offline.ok, false);
  assert.match(offline.ok ? "" : offline.why, /offline.*as you wrote it/);
  const failing: Ask = async () => { throw new Error("HTTP 500"); };
  const failed = await checkLore("I mended nets.", WHO, { ask: failing });
  assert.match(failed.ok ? "" : failed.why, /couldn't be reached.*HTTP 500.*as you wrote it/);
});

test("finding a quote: exactly, or with case, spacing and quote marks aside", () => {
  const text = "I'm the King's nephew,\n  though nobody says so.";
  assert.deepEqual(locate(text, "the King's nephew"), { start: 4, end: 21 });
  assert.deepEqual(locate(text, "“I’M THE KING’S NEPHEW.”"), { start: 0, end: 21 });
  assert.deepEqual(locate(text, "nephew, though nobody"), { start: 15, end: 38 }, "across the line break, to the end of nobody");
  assert.equal(locate(text, "the Queen's niece"), undefined);
  assert.equal(locate(text, ""), undefined);
});

test("Draft one: a backstory from the concept and the build, shown before it's anyone's; offline, the GM is offline", async () => {
  const { ask, asked } = model({ "backstory.draft": { story: "I was born above a chandler's shop.\nMy mother taught me to count.\n\nThe King asked, so I came." } });
  const drafted = await draftBackstory(WHO, { ask });
  assert.deepEqual(drafted, { ok: true, value: "I was born above a chandler's shop. My mother taught me to count.\n\nThe King asked, so I came." });
  assert.match(asked[0]!.input, /halfling rogue 3 \(Thief\), sage background/, "it's told the build");
  assert.match(asked[0]!.input, /## The story this backstory leads into\nThis morning.*Wendell Prout, was found hanged.*the King's investigator now/, "and the story it leads into, from this morning");
  assert.match(asked[0]!.instructions, /everything in it happened before this morning/, "it ends where the game begins");
  const offline = await draftBackstory(WHO);
  assert.match(offline.ok ? "" : offline.why, /offline/);
});

test("Work it in: the notes as a story in their voice, every name, place and number they wrote kept (asked again when one's left out)", async () => {
  const notes = "grew up Nine Furrows. Mum drowned in the flood of '89. owe Fat Jory 3 crowns. Kell? never met her";
  assert.deepEqual(keepWords(notes), ["Nine", "Furrows", "Mum", "89", "Fat", "Jory", "3", "Kell"]);
  let tries = 0;
  const { ask, asked } = model({
    "backstory.work": () => (++tries === 1
      ? { story: "I grew up in the Nine Furrows. My mother drowned in the great flood. I owe a man three crowns." }
      : { story: "I grew up in the Nine Furrows. Mum drowned in the flood of '89, and I still owe Fat Jory 3 crowns. Kell? I've never met her." }),
  });
  const worked = await workIn(notes, WHO, { ask });
  assert.equal(tries, 2, "asked again for what it left out");
  assert.match(asked[1]!.instructions, /left out some of what they wrote: Mum, 89, Fat, Jory, 3, Kell/);
  assert.ok(worked.ok);
  assert.deepEqual(leftOut(keepWords(notes), worked.ok ? worked.value : ""), [], "nothing they wrote is missing");
  assert.match(asked[0]!.input, /## The player's notes, word for word\ngrew up Nine Furrows/);
  const empty = await workIn("   ", WHO, { ask });
  assert.match(empty.ok ? "" : empty.why, /nothing written yet/);
});

test("what it says of them: from the model, short and to the point; offline, from their own sentences", async () => {
  const text = "I grew up on a turnip farm in the Nine Furrows. My mother drowned in the flood. I owe Fat Jory three crowns. I never could hold my drink. I believe the truth always comes out.";
  const { ask } = model({ "backstory.traits": { summary: "Tamsin Vell, a farm girl from the Nine Furrows who lost her mother to the flood and owes Fat Jory three crowns.", personality: ["Dogged"], ideals: ["The truth comes out"], bonds: ["Her drowned mother", "Fat Jory, owed three crowns"], flaws: ["Can't hold her drink"] } });
  const told = await finishBackstory(text, WHO, { ask });
  assert.equal(told.text, text);
  assert.match(told.summary, /^Tamsin Vell, a farm girl/);
  assert.deepEqual(told.bonds, ["Her drowned mother", "Fat Jory, owed three crowns"]);
  const offline = await finishBackstory(text, WHO);
  assert.match(offline.summary, /^Tamsin Vell, in their own words: "I grew up on a turnip farm/);
  assert.deepEqual(offline.bonds, ["My mother drowned in the flood.", "I owe Fat Jory three crowns."]);
  assert.deepEqual(offline.flaws, ["I never could hold my drink."]);
  assert.deepEqual(offline.ideals, ["I believe the truth always comes out."]);
  assert.deepEqual(traitsFromWords("", WHO).summary, `Tamsin Vell: ${WHO.concept}.`);
});

test("into the game: the GM's brief says who they are, the whole of it is in the session's own lore (never the authored lore), and nobody knows it unless they would", async () => {
  const { createSession } = await import("../runtime/engine.ts");
  const { sceneBrief, effectiveScene, playerWho } = await import("../runtime/brief.ts");
  const { memoryBrief } = await import("./disclosure.ts");
  const { sheetData, sheetText } = await import("../rules/dnd.ts");
  const { sceneById } = await import("../../scenes/index.ts");
  const { saveSession, loadSession } = await import("../runtime/session.ts");
  const { PREGENS } = await import("../game/combat/pregen.ts");
  const text = "I kept the accounts of a Saltmere grain factor for nine years, until I found the error that wasn't one.\n\nI owe Fat Jory three crowns, and my sister Ada a letter.";
  const backstory = { text, summary: "Tamsin Vell kept a grain factor's books until she found an error that wasn't one; she owes Fat Jory three crowns.", personality: ["Sharp-tongued"], ideals: ["The books should balance"], bonds: ["Her sister Ada"], flaws: ["Owes Fat Jory three crowns"] };
  const session = await createSession({ sceneId: "hanged-clerk", approach: "v2", player: `Tamsin Vell: ${WHO.concept}`, level: 3, build: PREGENS.rogue!.build, seed: 3, backstory });
  // Saved with the game.
  saveSession(session);
  assert.deepEqual(loadSession(session.id).player.backstory, backstory);
  // Who they are, in every brief.
  const scene = effectiveScene(sceneById("hanged-clerk"), []);
  const docsBrief = sceneBrief(scene, session, { docs: true });
  assert.match(docsBrief, /Who they are, from their own backstory: Tamsin Vell kept a grain factor's books/);
  assert.match(docsBrief, /bonds: Her sister Ada/);
  assert.match(docsBrief, /The whole of their backstory, in their own words, is in your notes/);
  assert.match(docsBrief, /know of it only what they'd plausibly know/);
  assert.match(docsBrief, /Nobody brings it up out of nowhere/);
  assert.match(docsBrief, /they tell it as their backstory has it/, "a telling the player only sums up is told from it");
  assert.ok(!docsBrief.includes("Ada a letter"), "the whole of it is the notes' to give, not the brief's");
  // Without the docs service, the whole of it is in the brief.
  assert.match(sceneBrief(scene, session), /> I owe Fat Jory three crowns, and my sister Ada a letter\./);
  assert.match(playerWho(session), /^Tamsin Vell: a disgraced palace auditor.*\. Tamsin Vell kept a grain factor's books/);
  // The whole of it, through the docs service: the player's doc, in the session's own overlay.
  const path = playerDocPath("Tamsin Vell");
  const doc = readDoc(session.id, path)!;
  assert.equal(doc.meta.visibility, "gm", "the GM's, so nobody in the story reads it");
  assert.match(doc.body, /## Their backstory, in their own words[\s\S]*my sister Ada a letter/);
  assert.match(doc.body, /- Bonds: Her sister Ada/);
  assert.match(doc.body, /## What they've told or shown people about themselves$/, "what they tell people still goes last");
  assert.ok(existsSync(join(process.env.KM_RUNS_DIR!, "sessions", session.id, "docs", path)), "in the session's own overlay");
  assert.ok(!existsSync(join(LORE_ROOT, path)), "never in the authored lore");
  // The GM's notes (the docs service's memory brief) carry it every turn.
  const notes = memoryBrief(scene, session, "stable") ?? "";
  assert.match(notes, /### The GM's own notes[\s\S]*my sister Ada a letter/);
  assert.ok(!/Ada a letter/.test(notes.split("### The GM's own notes")[0]!), "in the GM's own block, not anyone else's");
  // The sheet: a backstory section, and what it says of them; no mechanics beyond the background.
  const sheet = (await sheetData(session))!;
  assert.deepEqual(sheet.story, { backstory: text, personality: ["Sharp-tongued"], ideals: ["The books should balance"], bonds: ["Her sister Ada"], flaws: ["Owes Fat Jory three crowns"] });
  const plain = await createSession({ sceneId: "hanged-clerk", approach: "v2", player: `Tamsin Vell: ${WHO.concept}`, level: 3, build: PREGENS.rogue!.build, seed: 3 });
  const without = (await sheetData(plain))!;
  assert.equal(without.story, undefined);
  assert.deepEqual({ ...sheet, story: undefined, concept: "" }, { ...without, story: undefined, concept: "" }, "the same numbers, skills and gear with it or without");
  assert.match(await sheetText(session), /Bonds: Her sister Ada\nFlaws: Owes Fat Jory three crowns\nBackstory:\n  I kept the accounts/);
  assert.ok(!readFileSync(join(process.env.KM_RUNS_DIR!, "sessions", session.id, "state.json"), "utf8").includes("undefined"));
});
