import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CreationWorld } from "../../shared/creation/types.ts";
import type { Ask } from "../llm/openrouter.ts";

/**
 * The backstory (backstory.ts) with the model stood in for: the lore a backstory is checked against
 * (the docs service's World, places and Cast as anyone in Caerwyn could know them, and never a GM's
 * or a character's own doc: what the check says goes to the player), what the lore check finds and
 * the fix it offers (accepted only where its words are), drafting and working notes in (nothing they
 * wrote left out, the premise's order of the morning kept), and what it says of them (from the model,
 * or offline from their own words); the world it's for, Caerwyn's unless another is given (the
 * campaign's creation block). What reaches the GM in the prototype is tested there
 * (src/lore/backstory.test.ts); where a quote is, a fix applied and the length, with their code, in
 * shared/creation/story.test.ts.
 */

process.env.KM_RUNS_DIR = mkdtempSync(join(tmpdir(), "km-backstory-"));
process.env.OPENROUTER_API_KEY = "offline";
const { applyFix, CAERWYN, canonFor, checkLore, draftBackstory, finishBackstory, keepWords, leftOut, numberWords, premiseSlips, traitsFromWords, workIn } = await import("./backstory.ts");
const { seedDoc, seedPaths } = await import("./docs.ts");

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

test("the world is Caerwyn's unless another is given, and the campaign's creation block is Caerwyn's", async () => {
  const campaign = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "campaigns", "caerwyn", "campaign.json"), "utf8")) as { creation: CreationWorld };
  assert.deepEqual(campaign.creation, CAERWYN);
  const elsewhere: CreationWorld = { name: "Elsewhere", premise: "The game begins in a muddy field.", primer: "World/Nowhere.md", notCanon: [], places: [{ doc: "Places/Granary Yard.md", words: "\\bturnips?\\b" }] };
  const { ask, asked } = model({ "backstory.draft": { story: "I grew turnips." }, "backstory.check": { issues: [] } });
  await draftBackstory(WHO, { ask, world: elsewhere });
  await checkLore("I grew turnips, never anything else.", WHO, { ask, world: elsewhere });
  assert.match(asked[0]!.input, /## The world: Elsewhere\n\n\n## The story this backstory leads into\nThe game begins in a muddy field\.$/, "its primer (none in the lore: its name, and no words) and its premise");
  assert.match(asked[1]!.input, /### Places\/Granary Yard\.md\n/, "its places, by its words");
  assert.match(asked[1]!.input, /## The story's premise\nThe game begins in a muddy field\./);
  assert.match(asked[1]!.input, /### World\/Caerwyn now\.md\n/, "what isn't canon is its to say: none here");
  assert.ok(!canonFor("I mend nets.").some(d => d.path === "World/Caerwyn now.md"), "Caerwyn's leaves how the city stands now out");
});

test("ask: null is offline, whatever the environment says", async () => {
  const offline = { ask: null };
  assert.match((await draftBackstory(WHO, offline) as { why: string }).why, /offline/);
  assert.match((await workIn("I mend nets.", WHO, offline) as { why: string }).why, /offline/);
  assert.deepEqual(await checkLore("I mend nets.", WHO, offline), { ok: false, why: "The GM is offline, so nobody has checked it against the world: it goes in as you wrote it.", reason: "the GM is offline" });
  assert.match((await finishBackstory("I mend nets. I owe Fat Jory three crowns.", WHO, offline)).summary, /in their own words/);
  assert.equal(applyFix("I mend nets.", { quote: "nets", problem: "", fix: "sails" }), "I mend sails.", "and the moved helpers are still here");
});
