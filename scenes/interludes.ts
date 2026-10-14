import type { Character, Scene } from "../src/runtime/scene.ts";
import { hangedClerk } from "./hanged-clerk.ts";

/**
 * Interludes: downtime between scenes, standing in for the world map that will sit there later.
 * The last scene's people go their ways, the player gets a breath in the town (a few vivid details
 * of what Caerwyn is like right now), and they're asked what they do. When they follow the lead,
 * the next scene starts. Short by design: a couple of exchanges, never a quest of their own.
 */

const kell: Character = { ...hangedClerk.cast.find(c => c.id === "kell")!, attitude: "As things stand between her and the investigator after the morning (her memories say how); she stays practical and dry, and she has her own errands too." };

function interlude(spec: { id: string; title: string; summary: string; setting: string; where: string; flavour: string; lead: string; onward: string; next: string; lore: string[]; limits: string[]; rest?: "short" | "long"; assumes?: string[]; overtaken?: string; time?: Scene["time"] }): Scene {
  return {
    id: spec.id, title: spec.title, summary: spec.summary,
    setting: spec.setting,
    premise: `Downtime: where does the player go next, and what do they make of Caerwyn on the way? (The lead: ${spec.lead})`,
    hook: "A breath between one thing and the next.",
    opening: `A little time has passed since the last scene ended (the hand-off says how): the player has left that place and is out in the town now (${spec.where}). In a line or two, say where the others from the last scene went: Sergeant Kell stays with the investigator (the King lent her to the case) unless what happened rules it out; anyone else goes their own way. Then show the town: ${spec.flavour} Two or three vivid details, no more. End with the player on their own feet, and ask what they do.`,
    cast: [kell],
    start: "downtime",
    beats: [{
      id: "downtime", title: "Downtime",
      direction: `Downtime between scenes, standing in for the map. Keep it short and alive: answer what the player does or asks with the town as it is (people, prices, gossip, the Assembly preparations), in the house style, from the lore where it says. If they ask around, people know the everyday things the lore gives them and pass on gossip. The lead points onward: ${spec.lead} If they haven't got it, let it reach them through whatever they're doing (a porter's gossip, a word from Kell, a shopkeeper). Don't start new adventures here: places that aren't on the way are for another day.`,
      cast: { kell: "Keep the investigator company, with your own dry view of the town and the case; if they're dawdling, say so." },
      pressure: "A bell tolls the hour across the city; time and the lead are moving on without the investigator.",
      transitions: [
        { id: "onward", on: "attempt", when: `The player sets off for ${spec.onward} (or says they're going there now), following the lead.`, to: "onward" },
      ],
    }],
    exits: [{ id: "onward", kind: "progress", title: `Onward`, outcome: `The player sets off for ${spec.onward}.`, closing: "Close on them setting off, at the threshold: the next scene picks up from there.", next: spec.next }],
    essentials: [{ id: "lead", what: spec.lead, placedWith: ["Sergeant Kell", "gossip in the town"], carriers: ["kell"], unlocks: "the next scene" }],
    limits: spec.limits,
    lore: spec.lore,
    interlude: true,
    ...(spec.time ? { time: spec.time } : {}),
    ...(spec.rest ? { rest: spec.rest } : {}),
    ...(spec.assumes ? { assumes: spec.assumes, overtaken: spec.overtaken! } : {}),
  };
}

export const caerwynAfternoon = interlude({
  id: "caerwyn-afternoon", title: "Caerwyn, the afternoon", summary: "Downtime in the market square on the eve of the Assembly, between the granary and the river.",
  setting: "Caerwyn's market square and the streets off it, afternoon on the eve of the Centennial Assembly: bunting going up on the procession route, sweepers, delegation banners (Nine Furrows wheat-sheaves, Saltmere salt-gulls, Kläggenheim axes), bread dearer than last week and grumbled about, the dead-cart's bell somewhere behind, the Corn Exchange posting prices, and everybody too busy for a hanged clerk.",
  where: "the market square, an hour or two after the granary",
  flavour: "the Assembly eve (bunting, sweepers, delegation banners, dear bread, the Corn Exchange's price board) and the city too busy to care about a hanged clerk.",
  lead: "Big men with bandaged hands who do night work for gentlemen drink at the Drowned Rat, halfway down the river stairs (a porter told Kell; dock gossip says the same).",
  onward: "the river stairs and the Drowned Rat",
  next: "drowned-rat",
  rest: "short",
  time: "afternoon",
  lore: ["World/Caerwyn.md", "World/Centennial Assembly.md"],
  limits: [
    "Places that aren't on the way (the palace, the Corn Exchange's back rooms, the watch house cells, anywhere outside the walls): they're for another day. The Assembly has the palace shut to anyone without business, and the trail goes to the river.",
    "Fetching help or authority (the Watch Captain, a warrant, the King): the Captain takes his orders from the Purveyor's office and the King is at the Assembly rehearsals; nobody with a seal can be reached today. A written message left at the palace gate will reach the Marshal by evening.",
  ],
});

export const wharfNight = interlude({
  id: "wharf-night", title: "The wharves after dark", summary: "Downtime on the river stairs at night, between the Drowned Rat and the Heron.",
  setting: "The river stairs and the wharves after dark, before the midnight bells: the river high and black, fog coming off it, barge lanterns, night porters going down to the shifts, eel-sellers packing up, the bunting above gone grey in the dark, and downriver the painted heron of the last warehouse, its hoist working.",
  where: "outside on the river stairs, the Drowned Rat behind them",
  flavour: "the docks at night (the river high and black, fog, barge lanterns, the night shift going down, the Heron's hoist working downriver).",
  lead: "The Heron warehouse, at the downriver end of the wharves, is loading a barge tonight, and the gentleman comes at midnight to see it off.",
  onward: "the Heron warehouse",
  next: "heron-warehouse",
  time: "night",
  lore: ["Places/River Stairs.md"],
  assumes: ["The player hasn't yet gone into the Heron warehouse or dealt with what happens there tonight (the loading, the true book, the Master's visit)."],
  overtaken: "heron-warehouse",
  limits: [
    "Going anywhere else tonight (the palace, home, the watch house): the barge sails on the ebb after midnight, and whatever is in the Heron goes with it.",
    "More help: the watch is out on the Assembly route and the night patrol is three streets away; Kell's whistle is the only help in reach.",
  ],
});
