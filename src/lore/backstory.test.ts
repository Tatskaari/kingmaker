import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Ask } from "../llm/openrouter.ts";

/**
 * The backstory (src/lore/backstory.ts) with the model stood in for: the lore a backstory is
 * checked against (the docs service's World, places and Cast as anyone in Caerwyn could know them,
 * and never a GM's or a character's own doc: what the check says goes to the player), what the lore
 * check finds and the fix it offers (accepted only where its words are), drafting and working notes
 * in (nothing they wrote left out, the premise's order of the morning kept), what it says of them
 * (from the model, or offline from their own words); and what reaches the GM: who they are in every
 * brief, the whole of it in the session's own lore (never the authored lore), known in the story only
 * where someone would know it, and nobody in the story knowing them from before it began.
 */

process.env.KM_RUNS_DIR = mkdtempSync(join(tmpdir(), "km-backstory-"));
process.env.OPENROUTER_API_KEY = "offline";
const { applyFix, canonFor, checkLore, draftBackstory, finishBackstory, keepWords, leftOut, locate, MOST_WORDS, numberWords, premiseSlips, tooLong, traitsFromWords, workIn } = await import("./backstory.ts");
const { LORE_ROOT, playerDocPath, readDoc, seedDoc, seedPaths } = await import("./docs.ts");

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

/** Stories that touch the case and everyone in it: the King, Kell, Prout, the loft, Cob, Sallow, the Rat, the Heron, the goblins. */
const TOUCHING = [
  "I'm the King's nephew, and Sergeant Kell taught me to read at the watch house.",
  "I carry sacks in the King's Granary. The night Prout died I was asleep in the tally loft, and I heard two men on the hoist.",
  "I clerked two years under Master Josiah Sallow at the Royal Purveyor's office. He's a fussy, honest man who never once fiddled a figure.",
  "Cob and Moll are my cousins; I've seen them throw stones at the granary hoist.",
  "I drank at the Drowned Rat most nights and arm-wrestled Big Hobb, and I carried sacks for the Heron warehouse on the wharves for Mister Scrope.",
  "Last spring the goblins of the burnt mill took my father's wagon on the King's Road, and the Crake brothers laughed.",
];

/** What only the GM, or a character, may know: every line of the authored lore's gm and private docs that no public doc says too. */
function secrets(): string[] {
  const docs = seedPaths().map(p => seedDoc(p)!).filter(Boolean);
  const open = docs.filter(d => d.meta.visibility === "public").map(d => d.body).join("\n");
  return [...new Set(docs.filter(d => d.meta.visibility !== "public").flatMap(d => d.body.split("\n")).map(l => l.trim()).filter(l => l.length >= 40 && !open.includes(l)))];
}

test("the lore a backstory is checked against: what anyone in Caerwyn could know, and never a GM's or a character's own doc, whoever and wherever it touches", () => {
  const plain = canonFor("I grew up on a turnip farm in the Nine Furrows. My mother drowned in the flood.").map(d => d.path);
  assert.ok(plain.includes("World/Caerwyn.md") && plain.includes("Cast/King Aldren/public.md") && plain.includes("Cast/Sergeant Agnes Kell/public.md"), "the world and the cast's public faces");
  for (const story of TOUCHING) {
    const docs = canonFor(story);
    const deeper = docs.filter(d => d.meta.visibility !== "public" || /gm\.md$|private\.md$|\(truth\)|(^|\/)index\.md$/.test(d.path));
    assert.deepEqual(deeper.map(d => d.path), [], `only public docs for: ${story}`);
  }
  // The places it touches, as anyone could know them.
  assert.ok(canonFor("I drank at the Drowned Rat most nights.").some(d => d.path === "Places/The Drowned Rat.md"));
  assert.ok(canonFor("I slept in the tally loft.").some(d => d.path === "Places/Granary Yard.md"));
  assert.ok(!canonFor("I drank at the Drowned Rat most nights.").some(d => d.path === "Places/The Drowned Rat (truth).md"), "never the truth behind it");
});

test("the lore check is never told a secret, so it can't give one away: a model that says what it's told says nothing of Cob in the loft, the murder or Sallow's racket", async () => {
  const hidden = secrets();
  assert.ok(hidden.length > 100, `the lore has secrets to keep (${hidden.length} lines)`);
  assert.ok(hidden.some(l => l.includes("Cob, asleep in his nest in the loft")), "Cob in the loft is one");
  // A stand-in for a model that gives away whatever secret it's been told, in the problem and the fix: the leak the review found.
  const { ask, asked } = model({
    "backstory.check": (input: string) => {
      const told = hidden.filter(l => input.includes(l));
      return { issues: told.length ? [{ quote: "honest", problem: `It doesn't fit the world as it stands: ${told[0]}`, fix: `I heard ${told[1] ?? told[0]}` }] : [] };
    },
  });
  for (const story of TOUCHING) {
    const checked = await checkLore(story, WHO, { ask });
    assert.deepEqual(checked, { ok: true, value: [] }, `nothing to give away for: ${story}`);
  }
  for (const a of asked) {
    // The GM's truths, and two things a public index lets slip in its pointers (who hires the Crakes, a second book).
    for (const spoiler of ["Cob, asleep in his nest", "Sallow's racket", "the murder in the tally loft", "the paid goblins", "Sallow and Big Hobb", "strangled him with a cord", "the page is sewn into the lining", "the Crake brothers he hires", "the true book"]) assert.ok(!a.input.includes(spoiler), `not in the check's lore: ${spoiler}`);
    assert.match(a.input, /## The story's premise\nThis morning/, "the premise, which needs no secret, is");
  }
  assert.match(asked[0]!.instructions, /aren't yours to guess at/, "and it's told the lore is all it knows");
  assert.match(asked[0]!.instructions, /their past is their own, not part of the case/, "a tie to the case is the premise's to rule out");
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
  // A fix that runs on into the next sentence: no stop of its own, and that sentence goes on from it (a name keeps its capital).
  const clerked = "I clerked under Master Sallow at the Royal Purveyor's office. He's a fussy man. Kell knows it.";
  assert.equal(fix("I clerked under Master Sallow at the Royal Purveyor's office.", "I audited the Royal Purveyor's accounts from the outside, and", clerked), "I audited the Royal Purveyor's accounts from the outside, and he's a fussy man. Kell knows it.");
  assert.equal(fix("He's a fussy man.", "I never met him, but", clerked), "I clerked under Master Sallow at the Royal Purveyor's office. I never met him, but Kell knows it.");
  // A fix with a stop of its own where the quote stopped short of the sentence's: one stop.
  const vouch = "I clerked under Master Sallow. He'd vouch for me to anyone. I left when my mother fell ill.";
  assert.equal(fix("He'd vouch for me to anyone", "I'd vouch for myself to anyone.", vouch), "I clerked under Master Sallow. I'd vouch for myself to anyone. I left when my mother fell ill.");
  // The model was told the lore through the docs service, the King as anyone could know him (and nothing of the GM's), and the backstory word for word.
  assert.equal(asked.length, 1);
  assert.match(asked[0]!.input, /### Cast\/King Aldren\/public\.md\n/);
  assert.ok(!/^### .*(gm\.md|private\.md|\(truth\))/m.test(asked[0]!.input), "no GM's or character's own doc");
  assert.match(asked[0]!.input, /## Their backstory, word for word\nI'm the King's nephew/);
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
  assert.equal(asked.length, 1, "once, when it keeps to the premise");
  assert.match(asked[0]!.input, /halfling rogue 3 \(Thief\), sage background/, "it's told the build");
  assert.match(asked[0]!.input, /## The story this backstory leads into\nThis morning.*Wendell Prout, was found hanged.*the King's investigator now/, "and the story it leads into, from this morning");
  assert.match(asked[0]!.instructions, /Their past runs up to this morning: Prout was found hanged, and then.*the King asked them/, "it ends where the game begins, in the morning's order");
  const offline = await draftBackstory(WHO);
  assert.match(offline.ok ? "" : offline.why, /offline/);
});

test("a draft that has the King ask before Prout was found (or on another day) is asked for again, once", async () => {
  assert.deepEqual(premiseSlips("This morning, before Prout was found, the King asked me to look into his death."), ["the King asked them after Prout was found, not before"]);
  assert.deepEqual(premiseSlips("Yesterday a palace runner came: the King asked for me by name."), ["the King asked them this morning"]);
  assert.deepEqual(premiseSlips("This morning, when the news of Prout reached him, the King asked me to see him done right by. Yesterday I mended nets."), []);
  let tries = 0;
  const { ask, asked } = model({ "backstory.draft": () => ({ story: ++tries === 1 ? "I mend nets. This morning, before Prout was found, the King asked me to look into it." : "I mend nets. This morning, once Prout was found, the King asked me to look into it." }) });
  const drafted = await draftBackstory(WHO, { ask });
  assert.equal(tries, 2);
  assert.match(asked[1]!.instructions, /got the order of this morning wrong \(the King asked them after Prout was found, not before\)/);
  assert.deepEqual(drafted, { ok: true, value: "I mend nets. This morning, once Prout was found, the King asked me to look into it." });
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
  assert.match(asked[1]!.instructions, /left out some of what they wrote: Mum, 89, Fat, Jory, Kell\./, "three crowns kept the 3 they wrote");
  assert.ok(worked.ok);
  assert.deepEqual(leftOut(keepWords(notes), worked.ok ? worked.value : ""), [], "nothing they wrote is missing");
  assert.match(asked[0]!.input, /## The player's notes, word for word\ngrew up Nine Furrows/);
  assert.ok(!/In game terms|rogue|Thief/.test(asked[0]!.input), "the game's terms aren't the story's: it isn't told the build");
  assert.match(asked[0]!.instructions, /numbers in words where a story would have them/);
  assert.match(asked[0]!.instructions, /no class, subclass, background or level/);
  const empty = await workIn("   ", WHO, { ask });
  assert.match(empty.ok ? "" : empty.why, /nothing written yet/);
});

test("a number they wrote is kept when it's written out as a story would (3 as three, 1st as first, 89 as eighty-nine), and no other way", () => {
  assert.equal(numberWords("3"), "three");
  assert.equal(numberWords("70"), "seventy");
  assert.equal(numberWords("89"), "eighty-nine");
  assert.equal(numberWords("1st"), "first");
  assert.equal(numberWords("21st"), "twenty-first");
  assert.equal(numberWords("40th"), "fortieth");
  assert.equal(numberWords("12th"), "twelfth");
  assert.equal(numberWords("120"), "one hundred and twenty");
  assert.equal(numberWords("Kell"), undefined);
  assert.deepEqual(leftOut(["2", "70", "1st", "Jory"], "I heard two men. I've picked pockets for seventy years, since the first winter. Fat Jory saw."), []);
  assert.deepEqual(leftOut(["1", "89"], "Someone was done for in the flood of eighty nine."), ["1"], "a number's word is a word of its own, not part of another");
});

test("a backstory longer than the GM can be given every turn says so (the box keeps it), with its length", () => {
  assert.equal(tooLong("word ".repeat(MOST_WORDS)), undefined);
  assert.match(tooLong("word ".repeat(MOST_WORDS + 345)) ?? "", /^It's 2,345 words, and the GM reads all of it every turn: cut it to 2,000 or fewer\.$/);
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
