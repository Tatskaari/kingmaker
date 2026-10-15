import type { Scene } from "../../src/runtime/scene.ts";
import type { WorldSpec } from "../../src/world/scene-world.ts";
import { ft } from "./common.ts";

/**
 * The zoo's scene that turns into a fight: two porters spoiling for one over a game of
 * shove-ha'penny. Talk them down, or it ends in "Roll for initiative!" and a fight on the tavern's
 * own floor, with everyone where the scene's world has them and its lantern to bring down (the zoo's
 * fights, src/game/zoo/fights.ts); then the scene picks up for the aftermath. An authored fight
 * answers violence on its own: lay hands on a porter and it's the fight.
 */

export const tavernWorld: WorldSpec = {
  name: "The Cracked Tankard",
  description: "A low tavern with one long table, a keg on a trestle, a lantern on a beam and two porters with their sleeves rolled up.",
  size: { w: 60, h: 35 },
  areas: [{ id: "taproom", name: "the taproom", rect: { x: 5, y: 5, w: 50, h: 25 } }],
  things: [
    { id: "long-table", name: "the long table", kind: "object", in: "taproom", at: ft(5, 2), size: "large", material: "wood", tags: ["furniture"], description: "Scarred oak, with a shove-ha'penny board chalked on it and a disputed ha'penny." },
    { id: "keg", name: "the ale keg", kind: "object", in: "taproom", at: ft(9, 1), size: "medium", material: "wood", tags: ["container", "liquid"], description: "Ale, on a trestle, half full." },
    { id: "lantern", name: "a lantern on a beam", kind: "object", in: "taproom", at: ft(5, 3), size: "small", material: "brass", tags: ["light", "fire"], states: ["lit", "hanging"] },
    { id: "bench", name: "a bench", kind: "object", in: "taproom", at: ft(3, 4), size: "medium", material: "wood", tags: ["furniture"] },
    { id: "landlord", name: "the landlord", kind: "person", in: "taproom", at: ft(9, 3), description: "A thin man polishing a tankard, who would very much like nobody to be thrown through his window again." },
  ],
  people: {
    player: { in: "taproom", at: ft(1, 3) },
    dunt: { in: "taproom", at: ft(4, 2), note: "on his feet at the table, fists bunched" },
    gubbins: { in: "taproom", at: ft(6, 2), note: "on his feet across the table from Dunt" },
  },
};

export const tavern: Scene = {
  id: "zoo-tavern",
  title: "The Cracked Tankard",
  time: "evening",
  summary: "The zoo's scene that turns into a fight on the map, unless it doesn't.",
  setting: "The Cracked Tankard, a low tavern in the zoo's theatre: one long table with a shove-ha'penny board chalked on it, a keg on a trestle, a lantern on a beam, a bench, a landlord polishing a tankard very slowly, and two porters on their feet either side of the table over a disputed ha'penny.",
  premise: "Will the porters fight, and whose side will the player be on?",
  hook: "Two porters are about to fight over a ha'penny.",
  opening: "Open on the table: the ha'penny on the line, two big men on their feet either side of it, sleeves rolled, each sure it's his; the landlord polishing a tankard he has polished already. Don't name the porters. End on the bigger one cracking his knuckles.",
  cast: [
    {
      id: "dunt", name: "Dunt", called: "the big porter", statblock: "tough", weapon: "club",
      look: "Enormous, sunburnt, a sack-hook through his belt.",
      voice: "Slow and certain: 'That's my ha'penny.'",
      wants: "His ha'penny, and to be seen to have won it.",
      knows: ["The ha'penny was on the line. On the line counts."],
      attitude: "Spoiling for it; a fair ruling or a better offer calms him; a laugh at him starts it.",
    },
    {
      id: "gubbins", name: "Gubbins", called: "the small porter", statblock: "tough", weapon: "club",
      look: "Shorter, wider and angrier, with a split lip from last week's argument.",
      voice: "Quick and loud: 'Over the line! Over!'",
      wants: "The ha'penny, and Dunt to admit it.",
      knows: ["The ha'penny was over the line. Over counts."],
      attitude: "Spoiling for it too; he'll take a ruling from someone who looks like they know the game.",
    },
  ],
  start: "brewing",
  beats: [
    {
      id: "brewing",
      title: "A disputed ha'penny",
      direction: "The porters are an exchange from blows. A fair ruling, a better offer or a stern word might calm them (a check); a laugh, a shove or a blow starts the fight. If it starts, end on the moment it breaks out: the fight is played on the map.",
      cast: { dunt: "Loom. Repeat yourself.", gubbins: "Shout. Point at the line." },
      pressure: "The bigger porter picks up the bench.",
      transitions: [
        {
          id: "talk-down", on: "attempt", when: "The player tries to settle the dispute or calm the porters down.",
          check: { skill: "persuasion", dc: 13, reason: "to settle the ha'penny before it's settled with fists", success: "They both grumble, and sit down, and buy each other a drink.", failure: "They both turn on the player.", onSuccess: "settled", onFailure: "fight" },
        },
        { id: "blows", on: "attempt", when: "The player attacks, shoves or grabs one of the porters, or eggs them on.", to: "fight" },
        { id: "boils-over", on: "cue", when: "Two exchanges have gone by and nothing has been settled: the porters go for each other, and the player is in the way.", to: "fight" },
        { id: "after-the-fight", on: "attempt", when: "The fight has already been fought, and the player is done with what's left of it: they help sweep up, stand a round, or leave.", to: "swept-up" },
      ],
    },
  ],
  exits: [
    {
      id: "settled", kind: "persuaded", title: "Settled",
      outcome: "The porters accept a ruling and sit down, and nobody goes through the window.",
      closing: "Close on the two of them arguing amiably about something else, and the landlord putting down the tankard at last.",
      script: world => { world.journal("Settled a ha'penny between two porters in the Cracked Tankard without a window broken."); },
    },
    {
      id: "swept-up", kind: "progress", title: "Swept up afterwards",
      outcome: "The fight is over and the Cracked Tankard is put back together, more or less: whoever's standing has a drink on the house, whoever isn't is propped up by the fire, and the landlord sweeps up.",
      closing: "Close on the landlord sweeping up round the ha'penny, which nobody has thought to pick up.",
      script: world => { world.journal("A fight in the Cracked Tankard, over a ha'penny. Swept up afterwards. The ha'penny is still on the table."); },
    },
    {
      id: "fight", kind: "combat", title: "Roll for initiative",
      outcome: "The porters fight, and the player is in it.",
      closing: "End on the moment it breaks out: the bench coming up, the lantern swinging.",
      script: world => { world.startCombat({ enemies: [{ asset: world.assets.get("bandit"), count: 2, leader: "dunt" }], at: world.anchor("taproom") }); world.journal("A fight broke out in the Cracked Tankard."); },
    },
  ],
  anchors: ["taproom"],
  limits: ["The watch: there's no watch in the zoo."],
  world: tavernWorld,
};
