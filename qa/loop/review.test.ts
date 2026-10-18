import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { LoopConfig } from "./paths.ts";
import { newRecord, type Entry, type GameRecord } from "./record.ts";
import { checkReview, locate, packText, quoted, rubricChecks, type Review } from "./review.ts";

const ENTRIES: Entry[] = [
  { turn: 0, kind: "narration", text: "Kell looks up. “You’re the King’s man?”", speech: [{ start: 15, end: 39, who: "Sergeant Agnes Kell" }] },
  { turn: 1, kind: "player", text: "Who found him?" },
  { turn: 1, kind: "roll", text: "Insight check, DC 12: d20 14 + 1 = 15. A success." },
  { turn: 1, kind: "narration", text: "“The porters. First light.” She writes it down. “We don't have the page he wanted.”", speech: [{ start: 0, end: 27, who: "Sergeant Agnes Kell" }, { start: 48, end: 83, who: "Sergeant Agnes Kell" }] },
];
const BASE: Review = { game: "g01", summary: "Fine.", ratings: { pacing: 3, agency: 4, characters: 4, improvisation: 3, dice: 0, overall: 3 }, findings: [], good: [] };

test("the rubric's checks are its #### `id` headings", () => {
  const checks = rubricChecks();
  for (const id of ["knows", "player-words", "dump", "withheld", "roll-failure", "broken", "mouthpiece"]) assert.ok(checks.includes(id), id);
  assert.equal(new Set(checks).size, checks.length, "no check twice");
});

test("a quote is found with curly quotes, dashes, spacing and case taken as plain; with its speaker's label or without", () => {
  assert.deepEqual(locate("Kell says “We don’t have the page.”", "we don't have the page"), [11, 33]);
  assert.equal(locate("Kell says nothing.", "the page"), undefined);
  const turn1 = ENTRIES.filter(e => e.turn === 1);
  assert.ok(quoted(turn1, "We don't have the page he wanted"));
  assert.ok(quoted(turn1, "Sergeant Agnes Kell: “The porters. First light.”"), "as the pack shows it");
  assert.ok(quoted(turn1, "First light.” She writes it down."), "across a spoken line's end");
  assert.ok(!quoted(turn1, "Who found him?"), "the player's own line isn't the reply");
});

test("a review's quotes must be in the reply of the turn they name; its checks the rubric's, its severities and ratings in range", () => {
  assert.deepEqual(checkReview(BASE, { entries: ENTRIES }), []);
  const good = { ...BASE, findings: [{ turn: 1, check: "knows", severity: 5, quote: "We don't have the page he wanted", why: "Nobody said a page." }], good: [{ turn: 0, what: "A sharp opening." }] };
  assert.deepEqual(checkReview(good, { entries: ENTRIES }), []);

  const bad = checkReview({
    ...BASE, summary: "", ratings: { ...BASE.ratings, overall: 7 },
    findings: [
      { turn: 0, check: "knows", severity: 5, quote: "We don't have the page he wanted", why: "w" },
      { turn: 1, check: "nope", severity: 9, quote: "First light", why: "" },
      { turn: 4, check: "drag", severity: 1, quote: "x", why: "w" },
    ],
    good: [{ turn: 9, what: "?" }],
  }, { entries: ENTRIES });
  assert.ok(bad.includes("summary: missing"));
  assert.ok(bad.some(p => p.startsWith("ratings.overall")));
  assert.ok(bad.some(p => p.includes(`isn't in turn 0's reply`)));
  assert.ok(bad.some(p => p.includes('no check "nope"')));
  assert.ok(bad.some(p => p.includes("severity must be 1 to 5")));
  assert.ok(bad.some(p => p.includes("why is missing")));
  assert.ok(bad.some(p => p.includes("there's no turn 4 (turns 0 to 1)")));
  assert.ok(bad.some(p => p.includes("good[0]: there's no turn 9")));
  assert.deepEqual(checkReview({ ...BASE, findings: undefined as never }, { entries: ENTRIES }), ["findings: must be a list (empty for a clean game)"]);
});

test("the pack: the brief with the check's command, where the review goes, the rubric, the truth sheet and the prep, what the player was told, the scene turn by turn", () => {
  const config: LoopConfig = { rounds: mkdtempSync(join(tmpdir(), "km-loop-")), command: "npm run -s loop --" };
  const record: GameRecord = {
    ...newRecord({ round: "r1", game: "g01", scene: "hanged-clerk", stack: "runs/loop-stack" }),
    sceneRow: "7", hook: "A palace clerk hanged.", entries: ENTRIES,
    player: { name: "Nell Quickfingers", concept: "a sneaky halfling thief", build: "Halfling Rogue 3 (Thief), Criminal background", made: "from the persona's sentence" },
  };
  const text = packText({ config, round: "r1", record, prep: "# The prep: The Hanged Clerk\n\nThe yard." });
  assert.match(text, /^# You're reviewing a game master's play/);
  assert.match(text, /npm run -s loop -- review-check r1 g01/);
  assert.match(text, /Write your review to `.*reviews\/g01\.json`, with `"game": "g01"`\./);
  assert.match(text, /# The GM loop rubric/);
  assert.match(text, /# The truth behind the screen \(the player never saw this\)\n\n# The fact sheet for this scene/);
  assert.match(text, /\n# The prep: The Hanged Clerk\n\nThe yard\./);
  assert.doesNotMatch(text, /What the story handed on/, "the first scene had nothing handed on");
  assert.match(text, /# What the player was told before the scene began\n\nA palace clerk hanged\.\n\nTheir character: \*\*Nell Quickfingers\*\*: a sneaky halfling thief \(Halfling Rogue 3/);
  assert.match(text, /## Turn 0 \(the opening\)\n\nKell looks up\. Sergeant Agnes Kell: “You’re the King’s man\?”/);
  assert.match(text, /## Turn 1\n\n> Who found him\?\n\n🎲 Insight check/);
  assert.match(text, /— The game stopped here \(out of turns, or the player stopped\)\. —$/);

  const later = packText({
    config, round: "r1", prep: "# The prep: The Drowned Rat",
    record: { ...record, scene: "drowned-rat", skipped: [{ scene: "hanged-clerk", exit: "case-made", title: "The case is made", result: "good" }], notebook: ["The Hanged Clerk: The case is made\n· Wendell Prout didn't hang himself."], handedOn: { adjustments: ["Sallow has been named."], owed: [], absent: [], lead: "Kell followed the big man here." }, ended: { turn: 1, title: "What Big Hobb knows" } },
  });
  assert.doesNotMatch(later, /# The fact sheet for this scene/, "no truth sheet for the Rat");
  assert.match(later, /# What the story handed on to this scene\n\nThe scenes before this one were ended for the test, not played \(each with its discoveries made first, as a thorough player's game would have them, and the story moved on from each as it would have\): hanged-clerk on "The case is made"\./);
  assert.match(later, /\*\*How the story led the player here:\*\* Kell followed the big man here\./);
  assert.match(later, /\*\*Where the prep no longer matched the story \(the GM was told\):\*\*\n- Sallow has been named\./);
  assert.match(later, /Their notebook of the story so far:\n\nThe Hanged Clerk: The case is made\n· Wendell Prout didn't hang himself\./);
  assert.match(later, /— The scene ended \(What Big Hobb knows\)\. —$/);
});
