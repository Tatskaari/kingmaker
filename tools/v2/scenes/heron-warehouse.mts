/**
 * The Heron warehouse's table for tools/v2/scene-files.mts: what the converter can't infer from
 * scenes/heron-warehouse.ts at 44c6d4a. Its facts' ids (heron-warehouse.ts:23-30) and its exits'
 * scripts as effects (:403-495, with keepBook and bookFlag, :42-51), checked against the scripts
 * for every set of the facts.
 */
import type { SceneTable } from "./table.mts";

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
    "proof-taken": [],
    "caught-in-the-act": [],
    "caught": [],
    "up-in-smoke": [],
    "barge-sails": [],
    "fight": [],
  },
};
