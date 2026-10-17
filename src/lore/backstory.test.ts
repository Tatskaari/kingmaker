import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * A backstory in the prototype's game (the backstory itself is the docs service's, in v2/ai/docs, and
 * tested there): what reaches the GM, through these adapters. Who they are is in every brief, the whole
 * of it in the session's own lore (never the authored lore), known in the story only where someone
 * would know it, and nobody in the story knows them from before it began.
 */

process.env.KM_RUNS_DIR = mkdtempSync(join(tmpdir(), "km-backstory-"));
process.env.OPENROUTER_API_KEY = "offline";
const { traitsFromWords } = await import("./backstory.ts");
const { LORE_ROOT, playerDocPath, readDoc } = await import("./docs.ts");

const WHO = { name: "Tamsin Vell", concept: "a disgraced palace auditor with a borrowed rapier", build: "halfling rogue 3 (Thief), sage background" };

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
  assert.match(docsBrief, /What it says of the story's own people and places is what they believe or heard: where your prep says otherwise, your prep is the truth/);
  assert.match(docsBrief, /Before the story began, none of its people had met them/, "nobody knows them from before");
  assert.match(docsBrief, /If the player claims an old acquaintance with one of them \("You'll remember me"\), it isn't so/);
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
  // Traits in their own words (offline, whole sentences): one stop between them, not two.
  const worded = await createSession({ sceneId: "hanged-clerk", approach: "v2", player: `Tamsin Vell: ${WHO.concept}`, level: 3, build: PREGENS.rogue!.build, seed: 3, backstory: { text, ...traitsFromWords("My mother drowned in the flood. I owe Fat Jory three crowns. I never could hold my drink.", WHO) } });
  const wordedBrief = sceneBrief(scene, worded);
  assert.match(wordedBrief, /bonds: My mother drowned in the flood; I owe Fat Jory three crowns\. flaws: I never could hold my drink\.\)/);
  assert.ok(!/[^.]\.\.[^.]/.test(wordedBrief), "no doubled stops");
  assert.ok(!readFileSync(join(process.env.KM_RUNS_DIR!, "sessions", session.id, "state.json"), "utf8").includes("undefined"));
});
