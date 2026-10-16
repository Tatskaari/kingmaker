/**
 * The Drowned Rat's table for tools/v2/scene-files.mts: what the converter can't infer from
 * scenes/drowned-rat.ts at 44c6d4a. Its facts' ids (drowned-rat.ts:39-47) and its exits' scripts as
 * effects (:531-624, with heronLead, keepToken, kellRecords, mumKeptSafe and keepPage, :57-91),
 * checked against the scripts for every set of the facts.
 */
import type { SceneTable } from "./table.mts";

export const drownedRat: SceneTable = {
  module: "scenes/drowned-rat.ts", name: "drownedRat",
  place: "drowned-rat",
  facts: [
    ["The player has picked out Big Hobb Mallory", "hobb-picked-out"], // IDENTIFIED, drowned-rat.ts:39
    ["The player knows that Hobb does night work", "knows-heron"],      // HERON, :40
    ["Big Hobb has broken", "hobb-talked"],                             // TALKED, :41
    ["Cob has had a kindness", "cob-kindness"],                         // KIND, :46
    ["Prout's page is out of the lining", "page-out"],                 // PAGE, :47
    ["Hobb's mum is to be kept safe tonight", "mum-safe"],             // MUM_SAFE, :43
    ["Big Hobb has named his master", "master-named"],                 // NAMED, :42
    ["Hobb has handed over his brass river-door token", "token-handed"], // TOKEN, :44
    ["Hobb has agreed to be the player's man inside", "hobb-inside"],  // INSIDE, :45
  ],
  // Prout's page, owed from the granary, is the yard's ledger page wherever it has got to.
  items: { "prout-ledger-page": "ledger-page" },
  effects: {
    "hobb-talks": [],
    "taken-in": [],
    "hobb-fled": [],
    "thrown-out": [],
    "gone-to-work": [],
  },
};
