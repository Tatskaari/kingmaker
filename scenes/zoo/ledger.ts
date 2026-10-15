import type { Scene } from "../../src/runtime/scene.ts";
import type { WorldSpec } from "../../src/world/scene-world.ts";
import { ft } from "./common.ts";

/**
 * The zoo's scene of what a scene needs the player to find: the zoo's ledger is lost and the
 * auditor is coming. Where it is (under the office cat) is an essential: tracked as hinted or
 * landed, and when play goes elsewhere the co-GM (or the decider) moves it to whoever the player is
 * dealing with. A way through that no route covers waits up to three seconds for the quick co-GM,
 * which can add a route. The auditor arrives at a beat with his two assistants, who join the world
 * at the door, each a person of their own. And Madam Crust, from the pie stall, comes in for a
 * receipt: if the player met her there, she walks in remembering it (the docs service's memory).
 */

export const ledgerWorld: WorldSpec = {
  name: "The ledger office",
  description: "A cramped office full of files, a stove, a desk, a clerk in despair, and a cat asleep on a cushion.",
  size: { w: 50, h: 40 },
  areas: [{ id: "office", name: "the ledger office", rect: { x: 5, y: 5, w: 40, h: 30 } }],
  things: [
    { id: "desk", name: "the clerk's desk", kind: "object", in: "office", at: ft(3, 2), size: "large", material: "wood", tags: ["furniture"], description: "Buried in paper, none of it the ledger." },
    { id: "files", name: "shelves of files", kind: "object", in: "office", at: ft(1, 3), size: "large", material: "wood", tags: ["furniture"], description: "Every file but the one that matters." },
    { id: "stove", name: "a stove", kind: "object", in: "office", at: ft(8, 1), size: "medium", material: "iron", tags: ["fire", "light"], states: ["lit"] },
    { id: "cushion", name: "the cat's cushion", kind: "object", in: "office", at: ft(7, 2), size: "small", material: "cloth", tags: ["container"], description: "A tasselled cushion by the stove, warm, occupied." },
    { id: "ledger", name: "the zoo's ledger", kind: "item", in: "cushion", size: "small", material: "paper", tags: ["evidence", "hidden"], description: "A fat ledger, a little warm, with a cat-shaped dent in the cover." },
    { id: "cat", name: "the office cat", kind: "creature", in: "office", at: ft(7, 2), states: ["asleep"], description: "A large ginger cat who has been asleep on the cushion all morning and intends to go on." },
  ],
  people: {
    player: { in: "office", at: ft(4, 6) },
    inkpen: { in: "office", at: ft(4, 2), note: "behind the desk, turning out drawers" },
  },
};

export const ledger: Scene = {
  id: "zoo-ledger",
  title: "The Lost Ledger",
  time: "afternoon",
  summary: "The zoo's scene of essentials, the co-GM and memory: a lost ledger, an auditor on his way, and a cat.",
  setting: "The zoo's ledger office, in the theatre: a cramped room of files and shelves, a desk buried in paper, a stove ticking in the corner, a tasselled cushion by it with a large ginger cat asleep on it, and the clerk, Mister Inkpen, turning out drawers. The auditor is due within the hour.",
  premise: "Will the player find the ledger before the auditor does?",
  hook: "The zoo's ledger is lost, and the auditor is on his way.",
  opening: "Open on the office mid-search: drawers out, papers everywhere, the clerk on his knees under the desk, the cat asleep on its cushion by the stove, undisturbed by any of it. The clerk explains, in a rush, that the ledger is lost and the auditor is coming. End on him asking the player if they've seen it.",
  cast: [
    {
      id: "inkpen", name: "Mister Inkpen", called: "the clerk", statblock: "commoner",
      look: "A thin young man with ink to the elbows, spectacles pushed up into his hair (where he hasn't looked for them either).",
      voice: "Fast, apologetic, numbered: 'One, it was here. Two, it isn't. Three, I'm doomed.'",
      wants: "The ledger found before the auditor sees the office.",
      fears: "The auditor. Being dismissed. The cat, slightly.",
      knows: [
        "He had the ledger first thing this morning, by the stove, and put it down to feed the cat.",
        "The auditor, Mister Tally, has never once been late, and never once found an office in order.",
      ],
      attitude: "Frantic and grateful for any help; he'll do whatever the player suggests, except disturb the cat, which he daren't.",
    },
    {
      id: "tally", name: "Mister Tally", called: "the auditor", statblock: "noble", enters: "auditor",
      group: "Mister Tally and his two assistants",
      members: [
        { id: "first-assistant", name: "the first assistant", look: "A tall assistant with a ledger of his own." },
        { id: "second-assistant", name: "the second assistant", look: "A short assistant with a very sharp pencil." },
      ],
      look: "A grey man in a grey coat with a grey ledger, who has never been surprised.",
      voice: "Dry, exact, unhurried: speaks in figures, and in the passive voice when things go wrong.",
      wants: "To audit the zoo's books, today, to the farthing.",
      knows: ["The zoo's accounts are due. A missing ledger is a fine of five crowns, and a note in the record."],
      attitude: "Correct and immovable; a ledger produced softens him by a degree; an excuse doesn't.",
    },
    {
      id: "crust", name: "Madam Crust", called: "the pie-seller", statblock: "commoner", enters: "auditor",
      look: "A broad woman in a floury apron, with a pie for the auditor and a bill for the zoo.",
      voice: "Brisk market patter; calls everyone 'my lamb'.",
      wants: "A receipt for the pies the zoo had, and to see what the fuss is.",
      knows: ["The zoo owes her for forty pies.", "Anything she remembers of the player, from her stall."],
      attitude: "As she left things with the player at her stall, if they've met; otherwise friendly and nosy.",
    },
  ],
  start: "search",
  beats: [
    {
      id: "search",
      title: "Lost",
      direction: "The ledger is under the cat (in the cushion she's sleeping on), and the cat isn't moving. The clerk put it down there this morning to feed her and forgot. Let the player search; if they search everywhere but the cushion, the clerk remembers something, or the cat shifts and something crackles under her.",
      cast: { inkpen: "Search everywhere but under the cat. Number your despair." },
      pressure: "The cat stretches on her cushion, and something under her crackles like paper.",
      transitions: [
        { id: "found", when: "The ledger has been found (it's under the cat, in her cushion).", to: "found" },
        { id: "auditor-cue", on: "cue", when: "Two exchanges have gone by and the ledger is still lost: the auditor arrives.", to: "auditor" },
      ],
    },
    {
      id: "auditor",
      title: "The auditor",
      direction: "Mister Tally arrives with his two assistants, punctually, and Madam Crust comes in behind them for her receipt. The auditor will wait one exchange, exactly, then fine the zoo.",
      cast: { tally: "Stand in the doorway with your assistants and open your own ledger.", crust: "Come in for your receipt; recognise the player if you've met." },
      transitions: [
        { id: "found-late", when: "The ledger has been found (it's under the cat).", to: "found" },
        { id: "fine", on: "cue", when: "The auditor has waited an exchange and there's no ledger.", to: "fined" },
      ],
    },
  ],
  exits: [
    {
      id: "found", kind: "progress", title: "Found",
      outcome: "The zoo's ledger is found, a little warm, with a cat-shaped dent in the cover.",
      closing: "Close on the clerk hugging the ledger, and the cat, displaced, glaring at everyone.",
      script: world => { world.character("inkpen").setAttitude("friendly", "The visitor found the ledger."); world.journal("Found the zoo's lost ledger under the office cat."); },
    },
    {
      id: "fined", kind: "other", title: "Fined",
      outcome: "The auditor fines the zoo five crowns and notes it in the record. The ledger turns up the moment he's gone.",
      closing: "Close on the door shutting behind the auditor, and the cat getting up, revealing the ledger.",
      script: world => { world.journal("The zoo was fined five crowns for a missing ledger. It was under the cat."); },
    },
  ],
  essentials: [
    {
      id: "under-the-cat", what: "The ledger is under the office cat, in the cushion she's been asleep on all morning.",
      placedWith: ["the cat's cushion (it crackles)", "Mister Inkpen's memory of putting it down by the stove to feed the cat"], carriers: ["inkpen"],
      unlocks: "finding the ledger before the auditor",
    },
  ],
  limits: ["Moving the cat by force: she weighs as much as a small dog and has opinions; the clerk won't let you."],
  world: ledgerWorld,
};
