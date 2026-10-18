import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { backgroundOf, notesText, statusOf, type Row, type StatusRows } from "./gm-status.ts";

/** Game 1's rows as the owner's SQL gives them: snake_case, an empty option null, times in microseconds. */
function rows(gm: Row = {}, more: Partial<StatusRows> = {}): StatusRows {
  return {
    game: { id: 1, uid: "g1-abc" },
    scene: { id: 7, scene_key: "hanged-clerk", status: "live", turns: 2 },
    gm: {
      scene_id: 7, beat: "yard", turns_in_beat: 2, path: [], established: [], landed: [], hinted: [], opened: [],
      ending_lead: null, pending_exit: null, closing: null, ended: null, scene_status: null, ooc_turns: [], pressure_offered: [], repeated: null,
      // The full GM's columns as a V1 database has them once migrated: their defaults.
      canon: [], patches: "[]", notes: null, notes_turn: null, whispers: [], last_repair_turn: null, off_graph_turn: null, rulings: [],
      // The world bridge's, then the story's (story-design §4.1), as a full-GM database has them once migrated: their defaults.
      threat: null, held: null, brawl: null, absent: [],
      adjustments: [], opening: null, lead: null, owed: [], fought: [],
      ...gm,
    },
    turns: [
      { id: 100, n: 0, started_at: 0, first_text_at: 1_000_000, ended_at: 3_000_000, cost_micros: 1200 },
      { id: 101, n: 1, started_at: 10_000_000, first_text_at: 13_000_000, ended_at: 18_000_000, cost_micros: 3400 },
      { id: 102, n: 2, started_at: 20_000_000, first_text_at: 25_000_000, ended_at: null, cost_micros: 0 },
    ],
    repairs: [], jobs: [], reviews: [],
    ...more,
  };
}

test("a V1 game: the prototype's fields, and the full GM's there and empty", () => {
  const status = statusOf(rows());

  assert.deepEqual(status, {
    game: 1, uid: "g1-abc", scene: "hanged-clerk", status: "live", turn: 2,
    beat: "yard", turnsInBeat: 2, path: [], ended: null,
    notes: null, notesTurn: null, whispers: [], canon: [], established: [], patches: [], rulings: [], landed: [], hinted: [],
    sceneStatus: null, offGraphTurn: null, lastRepairTurn: null, opened: [],
    threat: null, held: null, brawl: null, absent: [],
    adjustments: [], opening: null, lead: null, owed: [], fought: [],
    reached: ["yard"], closing: null, roles: [], coGmNote: null, moved: null, heldOnce: null,
    repairs: [], memoryReviews: [], jobs: [],
    latency: { avgFirstTextMs: 4000, consideredTurns: 0, avgConsiderMs: 0 },
    costUsd: "0.00460",
    story: { status: null, time: null, lead: null, onward: null, chapters: [], quests: [], flags: [], followers: [], attitudes: [] },
  });
});

test("the two-part GM's side: what's reached, a closing on its way, each person's role and the co-GM's latest note", () => {
  const status = statusOf(rows({
    reached: ["start", "hobb", "cart-arrives"], beat: "cart-arrives", closing: { exit_id: "murder-unknown", turn: 4 },
    two_part: { roles: [{ cast: "kell", status: "At the gate", mental_state: "", conversation_role: "Writes down only what is said." }], notes: [{ turn: -1, text: "Co-GM note, before turn 0" }, { turn: 4, text: "Co-GM note, before turn 5" }], moved: "cart-arrives", held: false },
  }));

  assert.deepEqual([status.reached, status.closing, status.roles, status.coGmNote, status.moved, status.heldOnce], [["start", "hobb", "cart-arrives"], "murder-unknown (turn 4)", ["kell: At the gate | Writes down only what is said."], "turn 4", "cart-arrives", null]);
});

test("the story between scenes: what was handed on to the scene waiting, the lead, the chapters, quests, flags and followers", () => {
  const status = statusOf(rows({
    adjustments: ["Kell walks with the investigator now."], opening: "Open on the Rat's door.", lead: "The Drowned Rat, then.", absent: ["cob"],
    owed: [{ from: "hanged-clerk", id: "ledger-page", hinted: false, things: ["drowned-rat/boots", "drowned-rat/ledger-page"], holders: ["cob"], where: null }],
  }, {
    game: { id: 1, uid: "g1-abc", status: "playing", time: "evening", lead_scene: "drowned-rat", lead_text: "The afternoon goes in paperwork.", onward: null, onward_note: null },
    scene: { id: 8, scene_key: "drowned-rat", status: "waiting", turns: 0 },
    story: {
      chapters: [{ seq: 1, scene_key: "hanged-clerk", exit_key: "open-case", ending: "Murder by persons unknown", summary: "Previous scene, \"The Hanged Clerk\", ended: Murder by persons unknown (hanged-clerk: open-case).\nKell has it all.", calls: 3, cost_micros: 300, skipped: [] }],
      quests: [{ key: "hanged-clerk", title: "The Hanged Clerk", status: "active", stage: null, notes: ["Prout's death is on the books as murder by persons unknown."] }],
      flags: [{ name: "prout_death", value: "murder, unnamed" }],
      followers: [{ cast_key: "kell", name: "Sergeant Agnes Kell", since_scene: "hanged-clerk" }],
      attitudes: [],
    },
  }));

  assert.deepEqual([status.adjustments, status.opening, status.lead, status.absent, status.owed], [
    ["Kell walks with the investigator now."], "Open on the Rat's door.", "The Drowned Rat, then.", ["cob"], ["hanged-clerk/ledger-page: drowned-rat/ledger-page in drowned-rat/boots with cob"],
  ]);
  assert.deepEqual(status.story, {
    status: "playing", time: "evening", lead: "drowned-rat: The afternoon goes in paperwork.", onward: null,
    chapters: ["1. hanged-clerk -> open-case (Murder by persons unknown): Previous scene, \"The Hanged Clerk\", ended: Murder by persons unknown (hanged-clerk: open-case). [3 calls, $0.0003]"],
    quests: ["hanged-clerk (active): Prout's death is on the books as murder by persons unknown."],
    flags: ["prout_death = murder, unnamed"], followers: ["kell (Sergeant Agnes Kell), since hanged-clerk"], attitudes: [],
  });
});

test("the co-GM's steering, the rulings and the reviews, summarised as the prototype's status has them", () => {
  const roll = { skill: "sleight_of_hand", dc: 12, die: 14, modifier: 5, total: 19, success: true, critical: null, advantage: null };
  const patches = [{ turn: 5, transition: { beat: "yard", transition: { id: "improv-5-0", when: "The player waits in the loft to see who comes back for the boots.", on: "attempt", to: "doubt" } }, why: "A plan the co-GM can see working" }];
  const status = statusOf(rows({
    path: [{ turn: 3, from: "yard", to: "yard", via: "ruling", roll, source: "pre", known: 2 }],
    notes: "Keep Kell writing down only what is said.", notes_turn: 3, scene_status: "drifting",
    whispers: [{ to: "moll", note: "She wants to be asked about the songs.", turn: 3 }],
    canon: ["Cob sleeps in the loft."], patches: JSON.stringify(patches), last_repair_turn: 3, off_graph_turn: 5,
    rulings: [{ turn: 3, act: "lift the folded paper from the boy's boot", target: "cob", skill: "sleight_of_hand", kind: "roll", dc: 12, why: "guarded to lose, plausible cover, wary: they could notice", roll, went: "success", changed: "The investigator has the paper.", cost_usd: 0.002, latency_ms: 4200 }],
    opened: [{ path: "Cast/Agnes Kell/memories/what-the-investigator-did.md", title: "What the investigator did", scope: "kell", turn: 4 }],
  }, {
    repairs: [
      { id: 2, scene_id: 7, turn: 6, review: JSON.stringify({ turn: 6, status: "drifting", assessment: "The talk has wandered to songs." }), merged_turn: null, note: null },
      { id: 1, scene_id: 7, turn: 3, review: JSON.stringify({ turn: 3, status: "on_track", assessment: "The yard is moving." }), merged_turn: 4, note: "move_to yard refused: the scene is past it" },
    ],
    reviews: [
      { turn: 1, flags: ["seen", "promise"], reviews: [{ kind: "notes", changes: ['note cob seen: added "Was given a crown by the investigator for nothing."'] }] },
      { turn: 2, flags: [], reviews: [] },
      { turn: 3, flags: ["improvised_detail"], reviews: [{ kind: "lore", changes: [], error: "tool limit reached" }] },
    ],
    jobs: [
      { id: 9, scene_id: 7, move: "repair", step: "repair", state: "running", attempts: 1, error: null },
      { id: 8, scene_id: 7, move: "remember", step: "remember", state: "waiting", attempts: 2, error: "503 from the AI service" },
      { id: 10, scene_id: 99, move: "say", step: "reply", state: "running", attempts: 1, error: null },
    ],
  }));

  assert.deepEqual(status.path, ["3: yard -> yard via ruling (pre) [sleight_of_hand 19/12]"]);
  assert.deepEqual([status.notes, status.notesTurn, status.sceneStatus, status.offGraphTurn, status.lastRepairTurn], ["Keep Kell writing down only what is said.", 3, "drifting", 5, 3]);
  assert.deepEqual(status.whispers, ["3: moll: She wants to be asked about the songs."]);
  assert.deepEqual(status.patches, ["yard + The player waits in the loft to see who comes back for the boots."]);
  assert.deepEqual(status.rulings, ["3: lift the folded paper from the boy's boot -> sleight_of_hand DC 12 (19) [guarded to lose, plausible cover, wary: they could notice]: success: The investigator has the paper."]);
  assert.deepEqual(status.opened, ["4: kell: What the investigator did (Cast/Agnes Kell/memories/what-the-investigator-did.md)"]);
  assert.deepEqual(status.repairs, ["3: on_track — The yard is moving. [merged at t4] (move_to yard refused: the scene is past it)", "6: drifting — The talk has wandered to songs. [pending]"]);
  assert.deepEqual(status.memoryReviews, ['1: seen, promise — note cob seen: added "Was given a crown by the investigator for nothing."', "2: nothing flagged", "3: improvised_detail [lore failed: tool limit reached]"]);
  assert.deepEqual(status.jobs, ["remember/remember: waiting, attempt 2 (503 from the AI service)", "repair/repair: running"]);
  assert.deepEqual(status.latency, { avgFirstTextMs: 4000, consideredTurns: 1, avgConsiderMs: 4200 });
});

test("the world bridge's: a blow left hanging, a hold, a fight that broke out, and who left", () => {
  const status = statusOf(rows({
    threat: { kind: "attack", by: "kell", hazard: null, severity: null, turn: 3 }, held: 3,
    brawl: { turn: 3, cause: "attacked Sergeant Agnes Kell with a quarterstaff", against: ["kell"], allies: [], fled: ["cob"] }, absent: ["cob"],
  }));
  assert.deepEqual([status.threat, status.held, status.brawl, status.absent], ["3: an attack by kell", 3, "3: attacked Sergeant Agnes Kell with a quarterstaff; against kell; fled cob", ["cob"]]);
  const hazard = statusOf(rows({ threat: { kind: "hazard", by: null, hazard: "fire", severity: "serious", turn: 4 } }));
  assert.equal(hazard.threat, "4: fire, serious");
});

test("an ended scene's review that never merged says so", () => {
  const status = statusOf({ ...rows(), scene: { id: 7, scene_key: "hanged-clerk", status: "ended", turns: 5 }, repairs: [{ id: 1, turn: 5, review: JSON.stringify({ status: "on_track", assessment: "Done." }), merged_turn: null, note: null }] });

  assert.deepEqual(status.repairs, ["5: on_track — Done. [never merged: the scene ended]"]);
});

test("--notes: the GM's notes on each person in full, with where they were last brought up to date; none says so", () => {
  const docs = mkdtempSync(join(tmpdir(), "km-notes-"));
  try {
    assert.equal(notesText(docs, "1"), "(No notes yet: play has given nobody any in game 1.)");

    const write = (path: string, text: string) => { mkdirSync(dirname(join(docs, path)), { recursive: true }); writeFileSync(join(docs, path), text); };
    write("Cast/Agnes Kell/private.md", "---\nsummary: \"Kell\"\nvisibility: \"private\"\n---\n# Kell\n");
    write("Cast/Agnes Kell/notes.md", "---\nsummary: \"The GM's notes on Kell.\"\ntype: \"notes\"\nvisibility: \"gm\"\nscene: \"hanged-clerk\"\nturn: 3\n---\n# Agnes Kell: notes from play\n\n## Seen the player do\n- Watched the investigator give Cob a silver crown and ask nothing for it.\n");
    write("characters/tull/notes.md", "---\nsummary: \"The GM's notes on Tull.\"\ntype: \"notes\"\nvisibility: \"gm\"\n---\n# Tull: notes from play\n\n## Did\n- Was there when The Hanged Clerk ended: Murder by persons unknown.\n");

    const text = notesText(docs, "1");
    assert.match(text, /^## Cast\/Agnes Kell\/notes\.md {2}\[gm, last hanged-clerk turn 3\]\n# Agnes Kell: notes from play\n\n## Seen the player do\n- Watched the investigator give Cob a silver crown/);
    assert.match(text, /\n## characters\/tull\/notes\.md {2}\[gm\]\n# Tull: notes from play\n\n## Did\n- Was there when The Hanged Clerk ended: Murder by persons unknown\.\n$/);
    assert.doesNotMatch(text, /private\.md/);
  } finally {
    rmSync(docs, { recursive: true, force: true });
  }
});

test("the scene's background jobs in flight: its memory reviews and co-GM reviews, by the turn their key names", () => {
  const jobs = [
    { scene_id: 7, move: "remember", key: "g1-abc:s7:t3:remember" },
    { scene_id: 7, move: "repair", key: "g1-abc:s7:t3:repair" },
    { scene_id: 7, move: "say", key: "g1-abc:s7:t4:decide" },
    { scene_id: 8, move: "remember", key: "g2-def:s8:t1:remember" },
    { scene_id: null, move: "creation", key: "c5:offer" },
  ];

  assert.deepEqual(backgroundOf(jobs, "7"), ["remember t3", "repair t3"]);
  assert.deepEqual(backgroundOf(jobs, "9"), []);
});
