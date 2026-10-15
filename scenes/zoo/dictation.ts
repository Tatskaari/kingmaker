import type { Scene } from "../../src/runtime/scene.ts";
import type { WorldSpec } from "../../src/world/scene-world.ts";
import { KELL_VOICE } from "../hanged-clerk.ts";
import { ft } from "./common.ts";

/**
 * Kell's own scene in the zoo, a very short one: she takes the visitor's statement about the zoo for
 * the record. Whatever the player says is a statement (it simply happens: no dice), and the scene
 * closes on it; its ending writes the notebook, and if Kell walks with the player she reads the
 * entry back between the scene and the map, in the words of the record.
 */

export const dictationWorld: WorldSpec = {
  name: "Kell's desk",
  description: "A watch-house desk in the zoo: a lamp, an inkwell, a stack of forms, and Sergeant Kell's notebook.",
  size: { w: 50, h: 40 },
  areas: [{ id: "desk-room", name: "Kell's desk", rect: { x: 5, y: 5, w: 40, h: 30 } }],
  things: [
    { id: "kells-desk", name: "a watch-house desk", kind: "object", in: "desk-room", at: ft(4, 2), size: "large", material: "wood", tags: ["furniture"], description: "Forms in triplicate, an inkwell, a lamp, and a sign: STATEMENTS TAKEN. COMPLAINTS NOTED. NOTHING DONE BEFORE NOON." },
    { id: "desk-lamp", name: "a desk lamp", kind: "object", in: "desk-room", at: ft(6, 2), size: "small", material: "brass", tags: ["light"], states: ["lit"] },
  ],
  people: {
    player: { in: "desk-room", at: ft(4, 6) },
    kell: { in: "desk-room", at: ft(4, 1), note: "behind the desk, notebook open" },
  },
};

export const dictation: Scene = {
  id: "zoo-dictation",
  title: "For the Record",
  time: "afternoon",
  summary: "Kell takes a statement for the record: the zoo's shortest scene, and what goes in the notebook.",
  setting: "Sergeant Kell's desk in the zoo: a watch-house desk with forms in triplicate, an inkwell, a lamp, and a sign (STATEMENTS TAKEN. COMPLAINTS NOTED. NOTHING DONE BEFORE NOON). Kell is behind it with her notebook open.",
  premise: "What will the visitor put on the record?",
  hook: "Sergeant Kell would like a statement.",
  opening: "Open on Kell behind the desk, pencil ready, notebook open at a clean page. She asks, in a line, for the visitor's statement about the zoo, for the record. End on her pencil, waiting.",
  cast: [
    {
      id: "kell", name: "Sergeant Agnes Kell", statblock: "guard", weapon: "club",
      look: "Forties, a rain cape, a battered oilcloth notebook and a pencil stub sharpened with a clasp knife.",
      voice: KELL_VOICE,
      wants: "A statement she can write down and swear to.",
      knows: ["The zoo is a place where the game's features are laid out to look at. She has opinions about the goose."],
      attitude: "Patient and dry: she takes down exactly what's said, reads it back in the words of the record, and says 'Noted.'",
    },
  ],
  start: "statement",
  beats: [
    {
      id: "statement",
      title: "For the record",
      direction: "Kell takes the statement. Whatever the player says about the zoo is the statement: it simply happens, no dice. She writes it down, reads it back in the words of the record, and says 'Noted.'",
      cast: { kell: "Write it down. Read it back. 'Noted.'" },
      transitions: [
        { id: "stated", on: "attempt", when: "The player gives any statement, says anything for the record, or declines to.", to: "noted", establishes: ["The visitor gave Sergeant Kell a statement about the zoo."] },
      ],
    },
  ],
  exits: [
    {
      id: "noted", kind: "progress", title: "Noted",
      outcome: "Kell has the visitor's statement in her notebook.",
      closing: "Close on her reading it back in the words of the record, and 'Noted.'",
      script: world => { world.journal("Gave Sergeant Kell a statement about the zoo, for the record. She read it back. Noted."); },
    },
  ],
  world: dictationWorld,
};
