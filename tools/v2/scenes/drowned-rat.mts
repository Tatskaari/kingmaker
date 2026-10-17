/**
 * The Drowned Rat's table for tools/v2/scene-files.mts: what the converter can't infer from
 * scenes/drowned-rat.ts at 44c6d4a. Its facts' ids (drowned-rat.ts:39-47) and its exits' scripts as
 * effects (:531-624, with heronLead, keepToken, kellRecords, mumKeptSafe and keepPage, :57-91),
 * checked against the scripts for every set of the facts. A choice in a script's words (`named ?
 * … : …`) is two effects, one for each side; an "or" of facts (knowsHeron: the Heron, or Hobb
 * talked) is the effects twice, `if` the first and `if` the second `unless` the first.
 */
import type { Cond, Effect, SceneTable } from "./table.mts";

const NAMED: Cond = { if: { established: "master-named" } };
const UNNAMED: Cond = { unless: { established: "master-named" } };
const TALKED_NAMED: Cond = { if: { established: ["hobb-talked", "master-named"] } };
const TALKED_UNNAMED: Cond = { if: { established: "hobb-talked" }, unless: { established: "master-named" } };
const KNOWS_HERON: Cond = { if: { established: "knows-heron" } };
const TALKED_NOT_HERON: Cond = { if: { established: "hobb-talked" }, unless: { established: "knows-heron" } };
const IDENTIFIED: Cond = { if: { established: "hobb-picked-out" } };
const TALKED_NOT_IDENTIFIED: Cond = { if: { established: "hobb-talked" }, unless: { established: "hobb-picked-out" } };
const TOKEN: Cond = { if: { established: "token-handed" } };
const INSIDE: Cond = { if: { established: "hobb-inside" } };
const MUM_SAFE: Cond = { if: { established: "mum-safe" } };
const PAGE: Cond = { if: { established: "page-out" } };

/** The Heron is a lead once the player knows of it, however they came by it (heronLead, :58-61). */
const heronLead = (cond: Cond = {}): Effect[] => [
  { op: "flag", name: "heron_known", value: "true", ...cond },
  { op: "quest", quest: "heron-ledger", do: "start", title: "The Heron Ledger", text: "Big Hobb Mallory works nights for a gentleman at the Heron warehouse, at the downriver end of the wharves. If the King's 'lost' grain goes anywhere, it goes through there.", ...cond },
];
/** `if (knowsHeron(outcome)) heronLead(world)`: the Heron known, or Hobb having talked. */
const ifKnowsHeron: Effect[] = [...heronLead(KNOWS_HERON), ...heronLead(TALKED_NOT_HERON)];

/** Hobb's token, if it changed hands before the scene ended (keepToken, :64-66): made for the player, as the prototype's newItem makes it. */
const keepToken: Effect[] = [
  { op: "create", name: "Hobb's river-door token", kind: "item", to: "$player", text: "A worn brass token on a greasy string, stamped with a heron. Shown at the grille of the Heron warehouse's river door, it lets the night gang in.", ...TOKEN },
];

/** What Hobb owned to, in Kell's notebook as he said it (kellRecords, :72-76): `always` when the ending is his telling it. */
const kellRecords = (always = false): Effect[] => {
  const owned = (master: string) => `In the Drowned Rat, Big Hobb Mallory owned that he held Prout's arms in the tally loft while ${master} killed him, and hauled the rope. It's in her notebook as he said it.`;
  return [
    { op: "remember", who: "kell", text: owned("Master Sallow"), ...(always ? NAMED : TALKED_NAMED) },
    { op: "remember", who: "kell", text: owned("his master (he wouldn't say the name)"), ...(always ? UNNAMED : TALKED_UNNAMED) },
  ];
};

/** Hobb's mum, if someone here agreed to take her in tonight (mumKeptSafe, :79-83). */
const mumKeptSafe: Effect[] = [
  { op: "promise", by: "$player", to: "hobb", text: "See his mum taken in somewhere safe tonight, out of the Master's reach.", ...MUM_SAFE },
  { op: "journal", text: "Hobb's mum is to be fetched from the Shambles tonight and kept somewhere safe, out of the Master's reach.", ...MUM_SAFE },
];

/** Prout's page, if it came out of Cob's boot tonight (keepPage, :86-90). */
const keepPage: Effect[] = [
  { op: "give", what: "ledger-page", to: "$player", ...PAGE },
  { op: "journal", text: "Prout's page was in Cob's boot all along: every 'lost' wagon countersigned 'J. Sallow, for the Royal Purveyor'.", ...PAGE },
];

const HOBB_IDENTIFIED: Effect = { op: "flag", name: "hobb_identified", value: "true" };

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
    // :537-552
    "hobb-talks": [
      { op: "remove", what: "hobb", text: "heron-warehouse" },
      { op: "remember", who: "hobb", text: "He told the King's investigator what happened in the tally loft, and who his master is.", ...NAMED },
      { op: "remember", who: "hobb", text: "He told the King's investigator what he did in the tally loft. He didn't say his master's name.", ...UNNAMED },
      { op: "promise", by: "hobb", to: "$player", text: "Open the Heron's river door to the player tonight and keep the gang off them.", ...INSIDE },
      ...keepToken,
      ...kellRecords(true),
      HOBB_IDENTIFIED,
      ...heronLead(),
      { op: "quest", quest: "purveyors-man", do: "advance", stage: "hobb_talked", text: "Big Hobb Mallory says Master Sallow killed Prout in the tally loft while Hobb held his arms, and had Hobb hoist him; the stolen grain goes through the Heron warehouse.", ...NAMED },
      { op: "quest", quest: "purveyors-man", do: "advance", stage: "hobb_talked", text: "Big Hobb Mallory says his master killed Prout in the tally loft while Hobb held his arms, and had Hobb hoist him; the stolen grain goes through the Heron warehouse.", ...UNNAMED },
      { op: "journal", text: "Big Hobb talked: he held Prout in the loft while Master Sallow killed him. The grain goes through the Heron warehouse, and tonight a barge is loading there.", ...NAMED },
      { op: "journal", text: "Big Hobb owned to the loft: he held Prout while his master killed him, and hauled the rope. The grain goes through the Heron warehouse, and tonight a barge is loading there.", ...UNNAMED },
      ...mumKeptSafe,
      ...keepPage,
    ],
    // :558-572
    "taken-in": [
      { op: "remove", what: "hobb", text: "watch-house" },
      { op: "remember", who: "hobb", text: "Sergeant Kell arrested him outside the Drowned Rat for the clerk's death, with the King's investigator there." },
      { op: "remember", who: "kell", text: "She arrested Big Hobb Mallory for Prout's murder outside the Drowned Rat and took him to the watch-house cells." },
      ...kellRecords(),
      ...keepToken,
      HOBB_IDENTIFIED,
      ...ifKnowsHeron,
      { op: "quest", quest: "purveyors-man", do: "advance", stage: "hobb_arrested", text: "Big Hobb Mallory, the big man with the bandaged hand, is in the watch-house cells." },
      { op: "journal", text: "Kell took Big Hobb in. He's in the watch-house cells tonight." },
      ...mumKeptSafe,
      ...keepPage,
    ],
    // :578-591
    "hobb-fled": [
      { op: "remove", what: "hobb", text: "ran off up the river stairs into the city, to warn his master" },
      { op: "attitude", who: "hobb", to: "unfriendly", text: "The King's investigator frightened him out of the Drowned Rat." },
      { op: "remember", who: "hobb", text: "He ran from the Drowned Rat to warn Master Sallow that the King's investigator and a watch sergeant are asking about the loft." },
      HOBB_IDENTIFIED,
      { op: "flag", name: "sallow_warned", value: "true" },
      ...ifKnowsHeron,
      ...kellRecords(),
      { op: "journal", text: "Big Hobb ran from the Drowned Rat, and he'll have gone straight to his master." },
      ...mumKeptSafe,
      ...keepPage,
    ],
    // :597-609
    "thrown-out": [
      { op: "attitude", who: "nan-quill", to: "unfriendly", text: "Broke the house rules in the Drowned Rat." },
      { op: "remember", who: "nan-quill", text: "She threw the King's investigator out of the Rat with Manners, and barred them." },
      { op: "remove", what: "hobb", text: "heron-warehouse" },
      { ...HOBB_IDENTIFIED, ...IDENTIFIED },
      { ...HOBB_IDENTIFIED, ...TALKED_NOT_IDENTIFIED },
      ...ifKnowsHeron,
      ...kellRecords(),
      { op: "journal", text: "Thrown out of the Drowned Rat by Nan Quill and her cudgel, Manners." },
      ...mumKeptSafe,
      ...keepPage,
    ],
    // :615-623
    "gone-to-work": [
      { op: "remove", what: "hobb", text: "heron-warehouse" },
      { ...HOBB_IDENTIFIED, ...IDENTIFIED },
      ...ifKnowsHeron,
      ...kellRecords(),
      { op: "journal", text: "Big Hobb went off to his night's work at the bell without telling us what he knows." },
      ...mumKeptSafe,
      ...keepPage,
    ],
  },
};
