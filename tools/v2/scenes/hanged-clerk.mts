/**
 * The hanged clerk's table for tools/v2/scene-files.mts: what the converter can't infer from
 * scenes/hanged-clerk.ts at 44c6d4a. Its facts' ids, its exits' scripts as effects (hand
 * translations of hanged-clerk.ts:401-465, checked against the scripts for every set of the facts),
 * and onEnd: Kell walks with the investigator after the granary, whichever way it ends (the
 * prototype's syncFollowers, src/game/map/explore.ts:100-112, as data). Copied from the scratchpad's
 * convert-hanged-clerk.mts (FACT_IDS, EFFECTS, PLACE_KEY); onEnd is new.
 */
import type { SceneTable } from "./table.mts";

const MOLL = { if: { established: "moll-taken" } };
const COB = { unless: { established: "moll-taken" } }; // the script's default: `has(MOLL_TAKEN) ? "moll" : "cob"`
const PAGE = { if: { established: "page-read" } };

export const hangedClerk: SceneTable = {
  module: "scenes/hanged-clerk.ts", name: "hangedClerk",
  // Where the place sits on its map (src/game/map/maps/caerwyn.ts:108, worldOrigin; src/game/map/places.ts:34-36).
  place: "granary-yard",
  facts: [
    ["Prout didn't hang himself", "killed-not-suicide"],   // NOT_SUICIDE, hanged-clerk.ts:32
    ["Sewn into the lining of Prout's left boot", "page-read"], // PAGE, :33
    ["Cob has had a kindness", "cob-kindness"],          // KIND, :34
    ["Cob was taken in", "cob-taken"],                   // COB_TAKEN, :35
    ["Moll was taken in", "moll-taken"],                 // MOLL_TAKEN, :36
  ],
  // The page the scripts give the player is the yard's ledger page.
  items: { "prout-ledger-page": "ledger-page" },
  onEnd: [{ op: "follow", who: "kell" }],
  effects: {
    "case-made": [
      { op: "quest", quest: "hanged-clerk", do: "complete", text: "Proved Wendell Prout was murdered, and named Sallow of the Royal Purveyor's office as behind it." },
      { op: "quest", quest: "purveyors-man", do: "start", title: "The Purveyor's Man", text: "A man calling himself Master Sallow, of the Royal Purveyor's office, had the palace clerk Wendell Prout killed and hung up as a suicide. The case needs taking to the King, not the Watch Captain." },
      { op: "attitude", who: "kell", to: "friendly", text: "The King's investigator made Prout's case properly." },
      { op: "remember", who: "kell", text: "The King's investigator proved Prout was murdered and named Sallow of the Purveyor's office." },
      { op: "give", what: "ledger-page", to: "$player", ...PAGE },
      { op: "flag", name: "prout_death", value: "murder, Sallow named" },
      { op: "journal", text: "Wendell Prout didn't hang himself. The trail leads to Master Sallow of the Royal Purveyor's office." },
    ],
    "open-case": [
      { op: "quest", quest: "hanged-clerk", do: "advance", stage: "murder_unnamed", text: "Prout's death is on the books as murder by persons unknown." },
      { op: "remember", who: "kell", text: "Prout was murdered; nobody has been named for it yet, and the case is open." },
      { op: "give", what: "ledger-page", to: "$player", ...PAGE },
      { op: "flag", name: "prout_death", value: "murder, unnamed" },
      { op: "journal", text: "Prout was murdered. The watch has it down as persons unknown." },
    ],
    "wrong-man": [
      { op: "remove", what: "moll", text: "the watch-house cells", ...MOLL },
      { op: "attitude", who: "moll", to: "hostile", text: "Taken in for a murder they didn't do, on the player's word.", ...MOLL },
      { op: "attitude", who: "cob", to: "hostile", text: "The player had their friend taken in for murder.", ...MOLL },
      { op: "remove", what: "cob", text: "gone to ground somewhere in the granary quarter", ...MOLL },
      { op: "remove", what: "cob", text: "the watch-house cells", ...COB },
      { op: "attitude", who: "cob", to: "hostile", text: "Taken in for a murder they didn't do, on the player's word.", ...COB },
      { op: "attitude", who: "moll", to: "hostile", text: "The player had their friend taken in for murder.", ...COB },
      { op: "remove", what: "moll", text: "gone to ground somewhere in the granary quarter", ...COB },
      { op: "attitude", who: "kell", to: "unfriendly", text: "Made to arrest a child for murder on no evidence." },
      { op: "remember", who: "kell", text: "She arrested a child for Prout's murder at the investigator's insistence, and wrote down her objection." },
      { op: "quest", quest: "hanged-clerk", do: "fail", text: "A child was taken in for Prout's murder; whoever really killed him is in the clear." },
      { op: "flag", name: "prout_death", value: "murder, blamed on a granary child" },
      { op: "journal", text: "We had one of the granary kids taken in for the clerk's murder. The sergeant thinks we're wrong." },
    ],
    "closed-suicide": [
      { op: "quest", quest: "hanged-clerk", do: "fail", text: "Prout was filed as a suicide." },
      { op: "attitude", who: "kell", to: "wary", text: "The King's investigator let Prout go down as a suicide." },
      { op: "flag", name: "prout_death", value: "suicide" },
      { op: "journal", text: "The clerk behind the granary was filed as a suicide." },
    ],
    "walked-away": [
      { op: "quest", quest: "hanged-clerk", do: "fail", text: "Walked away before the case was made; Prout was filed as a suicide." },
      { op: "attitude", who: "kell", to: "wary", text: "The King's investigator walked away from Prout's case." },
      { op: "remember", who: "kell", text: "The King's investigator walked off and left Prout to the dead-cart." },
      { op: "flag", name: "prout_death", value: "suicide" },
    ],
  },
};
