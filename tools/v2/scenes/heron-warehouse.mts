/**
 * The Heron warehouse's table for tools/v2/scene-files.mts: what the converter can't infer from
 * scenes/heron-warehouse.ts at 44c6d4a. Its facts' ids (heron-warehouse.ts:23-30) and its exits'
 * scripts as effects (:403-495, with keepBook and bookFlag, :42-51), checked against the scripts for
 * every set of the facts. The book's tests as conditions: it's saved when it's in hand and not gone
 * (`if` book-in-hand `unless` book-gone); bookFlag's else-ifs are each the one before ruled out.
 * The fight's set-up is a startFight effect, recorded for the fight to come (the stub resolves it).
 */
import type { Cond, Effect, SceneTable } from "./table.mts";

const MASTER_HERE: Cond = { if: { established: "master-here" } };
const MASTER_NOT_HERE: Cond = { unless: { established: "master-here" } };
const FIRE: Cond = { if: { established: "heron-ablaze" } };
const SUNK: Cond = { if: { established: "barge-sunk" } };
const GONE: Cond = { if: { established: "book-gone" } };
/** bookSaved: the book in their hands, and nobody destroyed it afterwards. */
const SAVED: Cond = { if: { established: "book-in-hand" }, unless: { established: "book-gone" } };
/** Not saved and not destroyed: never in their hands. */
const NEVER_HELD: Cond = { unless: { established: ["book-in-hand", "book-gone"] } };
/** Seen, and never in their hands nor destroyed. */
const SEEN_ONLY: Cond = { if: { established: "book-seen" }, unless: { established: ["book-gone", "book-in-hand"] } };

/** keepBook (:42-44): the true book, if it's saved, is the player's. */
const keepBook: Effect[] = [{ op: "give", what: "true-book", to: "$player", ...SAVED }];

/** bookFlag (:47-51): burned, else taken (unless it's lost when they're caught), else seen. */
const bookFlag = (lostIfCaught = false): Effect[] => [
  { op: "flag", name: "true_book", value: "burned", ...GONE },
  ...(lostIfCaught
    ? [{ op: "flag", name: "true_book", value: "seen", ...SAVED }]
    : [{ op: "flag", name: "true_book", value: "taken", ...SAVED }]),
  { op: "flag", name: "true_book", value: "seen", ...SEEN_ONLY },
];

/** `!bookSaved(outcome)`: destroyed, or never in their hands. */
const notSaved = (effect: Effect): Effect[] => [{ ...effect, ...GONE }, { ...effect, ...NEVER_HELD }];

export const heronWarehouse: SceneTable = {
  module: "scenes/heron-warehouse.ts", name: "heronWarehouse",
  place: "heron",
  facts: [
    ["The player is in at the Heron as one of Hep's hands", "in-as-a-hand"], // HAND, heron-warehouse.ts:25
    ["Master Sallow has come to the Heron", "master-here"],                // MASTER_HERE, :23
    ["The player has the true book in their hands", "book-in-hand"],       // BOOK, :26
    ["The player has seen inside the true book", "book-seen"],             // BOOK_SEEN, :27
    ["The true book has been destroyed", "book-gone"],                     // BOOK_GONE, :28
    ["Fire has taken hold of the Heron", "heron-ablaze"],                  // FIRE, :29
    ["The barge Patience has gone down", "barge-sunk"],                    // SUNK, :30
  ],
  // The true book the scripts give the player is the counting desk's.
  items: { "true-book": "true-book" },
  anchors: { "heron-floor": "floor" },
  unsupported: [
    ["The Heron warehouse burned down", "floor"],
    ["The Saltmere barge Patience sank", "barge"],
  ],
  effects: {
    // :409-418
    "proof-taken": [
      { op: "give", what: "true-book", to: "$player" },
      { op: "flag", name: "true_book", value: "taken" },
      { op: "quest", quest: "heron-ledger", do: "complete", text: "Came out of the Heron warehouse with its true book." },
      { op: "quest", quest: "purveyors-man", do: "advance", stage: "proof", text: "The Heron's true book, initialled 'J.S.' on every page, ties Master Sallow to the King's 'lost' grain. The case can go to the King." },
      { op: "remember", who: "kell", text: "The investigator came out of the Heron with the true book: every 'lost' wagon, initialled J.S." },
      { op: "remember", who: "sallow", text: "The King's investigator walked out of the Heron with the true book.", ...MASTER_HERE },
      { op: "journal", text: "We have the Heron's true book. Every page is initialled J.S." },
    ],
    // :424-435
    "caught-in-the-act": [
      { op: "remove", what: "sallow", text: "watch-house" },
      { op: "attitude", who: "sallow", to: "hostile", text: "Caught at the Heron with the King's grain by the King's investigator and a sergeant of the watch." },
      { op: "remember", who: "kell", text: "She arrested Master Josiah Sallow at the Heron warehouse, caught with the King's grain." },
      ...keepBook,
      ...bookFlag(),
      { op: "quest", quest: "purveyors-man", do: "advance", stage: "sallow_arrested", text: "Master Sallow was caught at the Heron warehouse with the King's grain, and Sergeant Kell arrested him." },
      { op: "quest", quest: "heron-ledger", do: "complete", text: "Caught Master Sallow at the Heron with the King's grain." },
      { op: "journal", text: "We caught Sallow at the Heron with the King's grain, and Kell arrested him." },
    ],
    // :441-449
    "caught": [
      { op: "attitude", who: "sallow", to: "hostile", text: "The King's investigator got into the Heron and saw too much." },
      { op: "remember", who: "sallow", text: "He had the King's investigator thrown out of the Heron the hard way." },
      ...bookFlag(true),
      { op: "quest", quest: "heron-ledger", do: "advance", stage: "caught", text: "Caught at the Heron by Master Sallow's men and got rid of the hard way." },
      { op: "journal", text: "Caught at the Heron. We're alive, which is something." },
    ],
    // :455-468
    "up-in-smoke": [
      { op: "create", name: "Plume of smoke", kind: "feature", to: "floor", ...FIRE },
      { op: "note", what: "floor", text: "The Heron warehouse burned down on the eve of the Assembly, with the King's grain in it.", ...FIRE },
      { op: "note", what: "barge", text: "The Saltmere barge Patience sank at the Heron's wharf with the King's grain in her.", ...SUNK },
      ...keepBook,
      { op: "flag", name: "true_book", value: "taken", ...SAVED },
      ...notSaved({ op: "flag", name: "true_book", value: "burned" }),
      { op: "remember", who: "kell", text: "The Heron went up in smoke (or its barge went down) on the eve of the Assembly, with the investigator in the middle of it. She'll have to write it up." },
      { op: "quest", quest: "heron-ledger", do: "advance", stage: "up_in_smoke", text: "The Heron's grain is gone, but the true book came out with us.", ...SAVED },
      ...notSaved({ op: "quest", quest: "heron-ledger", do: "fail", text: "The Heron's grain and its true book went up in smoke or down in the river." }),
      { op: "journal", text: "The Heron's night ended in fire and water, and all Caerwyn saw it." },
    ],
    // :474-479
    "barge-sails": [
      ...keepBook,
      ...bookFlag(),
      ...notSaved({ op: "quest", quest: "heron-ledger", do: "fail", text: "The Patience sailed with the King's grain before we could stop her." }),
      { op: "journal", text: "The Patience sailed on the ebb with the King's grain aboard." },
    ],
    // :486-494: the fight's set-up, for the fight to come (V12); the stand-in resolves it as won.
    "fight": [
      { op: "startFight", enemies: [{ asset: "bandit", count: 2, leader: "sallow" }], allies: ["kell"], at: "floor", ...MASTER_HERE },
      { op: "startFight", enemies: [{ asset: "bandit", count: 6, leader: "hep" }], allies: ["kell"], at: "floor", ...MASTER_NOT_HERE },
    ],
  },
};
