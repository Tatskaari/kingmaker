import type { Character, Scene } from "../src/runtime/scene.ts";
import { KELL_VOICE } from "./hanged-clerk.ts";

/**
 * Interludes: downtime between scenes, standing in for the world map that will sit there later.
 * The last scene's people go their ways, the player gets a breath in the town (a few vivid details
 * of what Caerwyn is like right now), and they're asked what they do. When they follow the lead,
 * the next scene starts. Short by design: a couple of exchanges, never a quest of their own.
 */

/** Kell between scenes: on her own errand (which is where the lead goes), not the investigator's guide. */
const kell: Character = {
  id: "kell",
  name: "Sergeant Agnes Kell",
  statblock: "guard", weapon: "club",
  look: "Forties, a rain cape over her watch uniform (or a borrowed coat that fools nobody, after dark), a battered oilcloth notebook and a pencil stub she sharpens with a clasp knife; a truncheon she has never been seen to draw. Stands very still and watches people's hands, even in a crowd.",
  voice: KELL_VOICE,
  wants: "Her own errand, which depends on the hour. In the afternoon: to go down the river stairs at dusk after the big man with the bandaged hand she followed there at noon, with the investigator or without, though she'd rather not walk into the Drowned Rat alone (Nan Quill put her out through its door twenty years ago). After dark on the wharves: to see the Heron's night loading with her own eyes, since a sergeant who sees the King's grain taken may arrest whoever takes it, and to keep the investigator out of the river while she does.",
  fears: "The trail going cold while the city is busy with bunting. A witness in the river. A true record going in a drawer until after the Assembly.",
  knows: [
    "Whatever was said at the granary (and, after dark, at the Rat) is in her notebook, as it was said; asked, she reads an entry back word for word, and that's all.",
    "In the afternoon: she took a pie round to the granary porters at their noon break (porters will talk to a pie when they won't talk to the watch), and while they ate, the Purveyor's flour wagons went by with a gentleman walking beside them (a silver-topped cane, a wheat-ear ring, lavender water), and at his elbow a big dock-man nursing a bandaged right hand, who called him 'Master' and stopped himself. She knows neither of them by name, nor the gentleman by sight. Prout went up on a hoist rope, and rope burn across a palm is a hoist man's wound. When the wagons went up the hill she followed the big man down the river stairs and saw him go into the Drowned Rat, halfway down; she didn't go in after him.",
    "If Prout went into the Captain's book as a murder this morning, a runner has brought word that the Captain will have her report 'after the Assembly'. She means to have the case made before he reads it.",
    "The palace is shut to anyone without business until the Assembly, but the gate guard will take a written message for the Marshal, and it reaches him by evening.",
    "After dark: her whistle brings nobody but her. The whole watch is lining the Assembly route through the night.",
  ],
  secrets: [
    "Prout's visit three days ago, and her sending him to the palace. If it has come out, it's told, and she doesn't tell it again. If not, it may come out now, once, in her own words, if the investigator asks her straight why this one matters.",
  ],
  attitude: "As things stand between her and the investigator (her memories say how); practical and dry. She says where she's going and when, once, and goes, with the investigator or without; she doesn't steer them, wait on them, or tell them what to do. She answers what she's asked, reads back what she's written, and gives her own dry view of the town when it's wanted. If a child of the granary is sitting in a cell for Prout, she says so, and means to get them out.",
};

function interlude(spec: { id: string; title: string; summary: string; setting: string; where: string; flavour: string; lead: string; onward: string; next: string; lore: string[]; limits: string[]; rest?: "short" | "long"; assumes?: string[]; overtaken?: string; time?: Scene["time"] }): Scene {
  return {
    id: spec.id, title: spec.title, summary: spec.summary,
    setting: spec.setting,
    premise: `Downtime: where does the player go next, and what do they make of Caerwyn on the way? (The lead: ${spec.lead})`,
    hook: "A breath between one thing and the next.",
    opening: `A little time has passed since the last scene ended (the hand-off says how): the player has left that place and is out in the town now (${spec.where}). In a line or two, say where the others from the last scene went: Sergeant Kell stays with the investigator (the King lent her to the case) unless what happened rules it out; anyone else goes their own way. Then show the town as it is now: ${spec.flavour} From Caerwyn now, show what's new since the last scene: one or two things, by sight or by talk, each said once by someone it matters to. Two or three vivid details in all, no more. End with the player on their own feet, and ask what they do.`,
    cast: [kell],
    start: "downtime",
    beats: [{
      id: "downtime", title: "Downtime",
      direction: `Downtime between scenes, standing in for the map. Keep it short and alive: answer what the player does or asks with the town as it is (people, prices, gossip, the Assembly preparations), in the house style, from the lore where it says. If they ask around, people know the everyday things the lore gives them and pass on gossip. The lead points onward: ${spec.lead} If they haven't got it, let it reach them through whatever they're doing (a porter's gossip, a shopkeeper, or Kell saying where she's off to on her own errand). Don't start new adventures here: places that aren't on the way are for another day.`,
      cast: { kell: "You're on your own errand (your card says what it is at this hour): say where you'll be and when, once, then go about it, with the investigator or without. Your own dry view of the town and the case, when it's wanted." },
      pressure: "A bell tolls the hour across the city; time and the lead are moving on without the investigator.",
      transitions: [
        { id: "onward", on: "attempt", when: `The player sets off for ${spec.onward} (or says they're going there now), following the lead.`, to: "onward" },
      ],
    }],
    exits: [{ id: "onward", kind: "progress", title: `Onward`, outcome: `The player sets off for ${spec.onward}.`, closing: "Close on them setting off, at the threshold: the next scene picks up from there.", next: spec.next }],
    essentials: [{ id: "lead", what: spec.lead, placedWith: ["Sergeant Kell's own errand (she's going there)", "gossip in the town"], carriers: ["kell"], unlocks: "the next scene" }],
    limits: spec.limits,
    lore: spec.lore,
    interlude: true,
    fronts: "World/Fronts.md",
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
  lead: "The big man with the bandaged hand, whom Kell saw at a gentleman's elbow by the Purveyor's wagons at noon, went down the river stairs into the Drowned Rat; she followed him there, and means to go back down at dusk (dock gossip says the big men who do night work for gentlemen drink there).",
  onward: "the river stairs and the Drowned Rat",
  next: "drowned-rat",
  rest: "short",
  time: "afternoon",
  lore: ["World/Caerwyn.md", "World/Centennial Assembly.md", "World/Caerwyn now.md", "Places/Market Square.md"],
  limits: [
    "Places that aren't on the way (the palace, the Corn Exchange's back rooms, the watch house cells, anywhere outside the walls): they're for another day. The Assembly has the palace shut to anyone without business, and the trail goes to the river.",
    "Fetching help or authority (the Watch Captain, a warrant, the King): the Captain files what the Purveyor's office asks him to file, and the King is at the Assembly rehearsals; nobody with a seal can be reached today. A written message left at the palace gate will reach the Marshal by evening.",
  ],
});

export const wharfNight = interlude({
  id: "wharf-night", title: "The wharves after dark", summary: "Downtime on the river stairs at night, between the Drowned Rat and the Heron.",
  setting: "The river stairs and the wharves after dark, before the midnight bells: the river high and black, fog coming off it, barge lanterns, night porters going down to the shifts, eel-sellers packing up, the bunting above gone grey in the dark, and downriver the painted heron of the last warehouse, its hoist working.",
  where: "outside on the river stairs, the Drowned Rat behind them",
  flavour: "the docks at night (the river high and black, fog, barge lanterns, the night shift going down, the Heron's hoist working downriver).",
  lead: "The Heron warehouse, at the downriver end of the wharves, is loading a barge tonight that sails on the ebb at the second bell after midnight; if Hobb talked, the gentleman comes at midnight to see it off.",
  onward: "the Heron warehouse",
  next: "heron-warehouse",
  time: "night",
  lore: ["Places/River Stairs.md", "World/Caerwyn now.md"],
  assumes: ["The player hasn't yet gone into the Heron warehouse or dealt with what happens there tonight (the loading, the true book, the Master's visit)."],
  overtaken: "heron-warehouse",
  limits: [
    "Going anywhere else tonight (the palace, home, the watch house): the barge sails on the ebb after midnight, and whatever is in the Heron goes with it.",
    "More help: the whole watch is lining the Assembly route through the night, the river watch with it, and Kell's whistle brings nobody but Kell.",
  ],
});
