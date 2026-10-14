import type { Scene } from "../src/runtime/scene.ts";

/** Follows crossroads-ambush. The previous exit arrives as background facts. */
export const crossroadsAftermath: Scene = {
  id: "crossroads-aftermath",
  title: "After the Ambush",
  summary: "Tam comes out of hiding; thanks, a reward, and the question of where the goblins came from.",
  setting: "The same crossroads, a little later. Broken arrows in the road, the dead ox in the ditch, the milestone scarred. The light is going amber. Tam's pitchfork lies abandoned in the road.",
  premise: "What does the party make of what just happened, and where does it lead them?",
  hook: "The goblins are gone, one way or another. Somewhere nearby, the farmer is still hiding.",
  opening: "Pick up from how the goblin confrontation ended (see the background facts). Tam peers out from the ditch, or from behind the milestone, and slowly emerges. Match his mood to what happened: shaky gratitude after a fight, hysterical relief after a rout, grumbling if his idol was given away.",
  cast: [
    {
      id: "tam",
      name: "Tam Hollis",
      look: "Fifties, sunburnt, mud to the knees, shaking hands, a cut on his cheek from a thorn.",
      voice: "Rapid, rural, repeats himself, swears by turnips and saints. Now jittery with relief.",
      wants: "To get home to Bet at Hollis Farm, to repay the party somehow, and never see a goblin again.",
      fears: "That the goblins will come back for him.",
      knows: [
        "Goblin tracks have been coming out of the north, along the river towards the old burnt mill.",
        "Bet will feed anyone who saved his life; Hollis Farm is an hour down the drovers' track.",
        "The toll-house warden, Garrow, laughed at him this morning; Tam would love the party to tell Garrow he was right.",
      ],
      secrets: ["He has eleven silver pennies sewn into his hat; he'll offer them if pushed, reluctantly."],
      attitude: "Grateful; attaches himself to the party.",
    },
  ],
  limits: [
    "The warren under the burnt mill is half a day north: the party can set off for it, but it isn't reachable within this scene.",
    "Tam has no money beyond the eleven silver pennies sewn into his hat, and nothing else of value.",
    "Garrow and the toll house are a mile back up the King's Road; nobody else is around.",
  ],
  anchors: ["crossroads", "milestone", "ditch", "hedgerow", "drovers-track", "kings-road", "hollis-farm"],
  start: "emerges",
  beats: [
    {
      id: "emerges",
      title: "Tam comes out of hiding",
      direction: "Tam emerges and reacts to how things ended. Let the party catch their breath, check the bodies or tracks if there was a fight, and talk. He thanks them in his own rambling way.",
      cast: { tam: "Babble thanks. Ask if they're hurt. Insist on repaying them somehow." },
      pressure: "Tam spots goblin tracks heading north and goes pale: 'They came from the mill. Saints. The old mill.'",
      transitions: [
        { id: "mill-mentioned", when: "Tam has told the party the goblins came from the burnt mill to the north, or the party has found the tracks and worked it out.", to: "the-mill", establishes: ["The goblins came from a warren under the burnt mill to the north."] },
      ],
    },
    {
      id: "the-mill",
      title: "Where the goblins came from",
      direction: "The burnt mill becomes a lead the party can choose to follow, or not. Tam wants to go home and offers dinner at Hollis Farm and a bed. Let the party decide what they care about: Tam's safety, the goblins, the road to Caerwyn.",
      cast: { tam: "Offer a reward (dinner and a bed; the hat money only if pushed). Beg them to see him home. Shudder at the idea of the mill." },
      transitions: [
        { id: "escort", when: "The party has agreed to walk Tam home to Hollis Farm.", to: "escort-home" },
        { id: "to-mill", when: "The party has decided to go and look at the burnt mill.", to: "seek-mill" },
        { id: "part-ways", when: "The party says goodbye to Tam and carries on towards Caerwyn.", to: "part-ways" },
      ],
    },
  ],
  exits: [
    {
      id: "escort-home", kind: "progress", title: "To Hollis Farm",
      outcome: "The party escorts Tam home to Hollis Farm, where Bet will feed them.",
      closing: "Narrate the walk down the drovers' track in the dusk, Tam talking the whole way, a lit window ahead.",
      script: (world) => {
        world.character("tam").moveTo("hollis-farm");
        world.character("tam").setAttitude("devoted", "The party saved his life and walked him home.");
        world.quest("mad-farmer").complete("Saw Tam safely home.");
      },
    },
    {
      id: "seek-mill", kind: "progress", title: "North to the mill",
      outcome: "The party heads north to investigate the goblin warren under the burnt mill.",
      closing: "Tam presses something on them for luck and scurries home. Narrate the first glimpse of the mill's black timbers.",
      script: (world) => {
        world.quest("burnt-mill").start("The Burnt Mill", "Goblins have a warren under the old burnt mill north of the crossroads.");
        world.character("tam").moveTo("hollis-farm");
      },
    },
    {
      id: "part-ways", kind: "leave", title: "On to Caerwyn",
      outcome: "The party and Tam part ways at the crossroads.",
      closing: "Tam waves them off, then hurries down the drovers' track, glancing back at the hedges.",
      script: (world) => {
        world.character("tam").moveTo("hollis-farm");
      },
    },
  ],
};
