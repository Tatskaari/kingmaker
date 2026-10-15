import type { Scene } from "../../src/runtime/scene.ts";
import type { WorldSpec } from "../../src/world/scene-world.ts";
import { ft } from "./common.ts";

/**
 * The zoo's scene of the rules in a scene: a practice yard with things to burn, break, jump over
 * and throw. Say what you do and the decider reads it: "(I cast Fireball at the haystack)" picks
 * one of your spells, its aim and where you cast from, and the rules cast it from your own slots
 * (or not, if it isn't yours); "I hit the dummy" is one attack through the engine; "I grab Wim" or
 * "I shove him over" is a grapple or a shove he saves against; "I jump the ditch with a run-up" is
 * your Strength against the gap; "I take a breather" is Second Wind for a fighter; "I rest for an
 * hour" is a short rest. Violence against the people here draws their reactions. The Rules Room sets
 * the same rules off directly, with no GM.
 */

export const practiceYardWorld: WorldSpec = {
  name: "The practice yard",
  description: "A fenced yard of beaten earth with things in it put there to be hit, burned, jumped over and thrown about.",
  size: { w: 70, h: 50 },
  areas: [
    { id: "near-side", name: "the near side of the ditch", rect: { x: 5, y: 5, w: 25, h: 40 }, tags: ["outside"] },
    { id: "far-side", name: "the far side of the ditch", rect: { x: 40, y: 5, w: 25, h: 40 }, tags: ["outside"] },
    { id: "ditch", name: "the ditch", rect: { x: 30, y: 5, w: 10, h: 40 }, tags: ["outside"], description: "Ten feet across and eight deep, with a puddle at the bottom and a very old boot." },
  ],
  things: [
    { id: "haystack", name: "a haystack", kind: "object", in: "far-side", at: ft(10, 2), size: "large", material: "cloth", description: "Put there to be set on fire, and resigned to it." },
    { id: "training-dummy", name: "a training dummy", kind: "object", in: "near-side", at: ft(3, 2), size: "medium", material: "wood", description: "A wooden man on a post, much dented, with a painted moustache." },
    { id: "rain-barrel", name: "a rain barrel", kind: "object", in: "near-side", at: ft(1, 1), size: "medium", material: "wood", tags: ["container", "water"], description: "Full of rainwater, and a few drowned wasps." },
    { id: "scarecrow", name: "a scarecrow", kind: "object", in: "far-side", at: ft(11, 6), size: "medium", material: "cloth" },
    { id: "ditch-feature", name: "the ditch", kind: "feature", in: "ditch", at: ft(7, 4), size: "huge", material: "stone", tags: ["fixed"], description: "Ten feet across, eight deep, muddy at the bottom." },
    { id: "bottles", name: "a crate of empty bottles", kind: "object", in: "near-side", at: ft(2, 7), size: "medium", material: "wood", tags: ["container"], description: "For throwing. The keeper says so on a sign." },
  ],
  people: {
    player: { in: "near-side", at: ft(1, 4) },
    hobble: { in: "near-side", at: ft(2, 6), note: "by the gate, with a list of what's been broken" },
    wim: { in: "near-side", at: ft(4, 5), note: "cracking his knuckles, in the middle of the near side" },
  },
};

export const practiceYard: Scene = {
  id: "zoo-practice-yard",
  title: "The Practice Yard",
  time: "afternoon",
  summary: "The zoo's scene of the rules in a scene: spells, blows, grapples, jumps, class features and rests, read by the decider and decided by the engine.",
  setting: "A fenced practice yard in the zoo's theatre: beaten earth, a ditch ten feet across and eight deep down the middle, a haystack and a scarecrow on the far side, a much-dented training dummy and a rain barrel on the near side, a crate of empty bottles for throwing, Big Wim the sparring partner cracking his knuckles, and Mistress Hobble the keeper at the gate with a list of what's been broken.",
  premise: "What will the player try in the practice yard, and what will the rules make of it?",
  hook: "A yard for practising in: everything in it is there to be hit, burned, jumped over or thrown about.",
  opening: "Open on the yard: Mistress Hobble at the gate with her list, reading out the rules (break it, the zoo pays; don't set fire to Wim); Big Wim cracking his knuckles, offering to be thrown about; the haystack across the ditch, waiting to be set alight. End on Mistress Hobble asking what the player would like to try first.",
  cast: [
    {
      id: "hobble", name: "Mistress Hobble", called: "the yard-keeper", statblock: "commoner",
      look: "A small, square woman with a clipboard, a whistle and the calm of someone who has seen every kind of accident.",
      voice: "Brisk, unflappable, in lists: 'Haystack, fine. Dummy, fine. Wim, not on fire.'",
      wants: "Visitors to try things safely, and to write down what broke.",
      knows: ["What's in the yard and what it's for.", "The ditch is ten feet across and eight deep: most people clear it with a run-up."],
      attitude: "Encouraging and unshockable; she blows her whistle at anything aimed at a person who hasn't agreed to it, and has the visitor out of the yard by the ear for setting fire to Wim.",
    },
    {
      id: "wim", name: "Big Wim", called: "the sparring partner", statblock: "tough", weapon: "club",
      look: "A large cheerful man in a padded jerkin, with cauliflower ears and a broken nose he's proud of.",
      voice: "Slow, friendly, and delighted by anything that hurts a bit.",
      wants: "A good honest shove, a grapple, a bout.",
      knows: ["How to fall over properly.", "That a fighter's second wind is worth more than a sandwich."],
      attitude: "Game for anything that isn't a weapon; hits back, cheerfully, if hit; doesn't like spells, at all.",
    },
  ],
  start: "practice",
  beats: [
    {
      id: "practice",
      title: "Practice",
      direction: "The player tries things. The rules decide each: a spell from their own slots (or nothing, if it isn't theirs), a blow at the dummy or at Wim, a grapple or a shove Wim saves against, a jump over the ditch (Strength against the gap), a class feature, a rest. Narrate exactly what the rules decided; let Mistress Hobble write it down, and Wim enjoy it.",
      cast: { hobble: "Write it down. Blow the whistle at anything dangerous to anyone who didn't agree to it.", wim: "Offer to be thrown about. Hit back if hit." },
      pressure: "Mistress Hobble blows her whistle: the yard closes soon, and she'd like everything broken by then.",
      transitions: [
        { id: "done", on: "attempt", when: "The player says they've finished practising, thanks Mistress Hobble, or heads out of the gate.", to: "done" },
      ],
    },
  ],
  exits: [
    {
      id: "done", kind: "progress", title: "Practice over",
      outcome: "The player has finished in the practice yard.",
      closing: "Close on Mistress Hobble reading back her list of what broke, with satisfaction.",
      script: world => { world.journal("Practised in the zoo's yard. Mistress Hobble has a list."); },
    },
  ],
  limits: ["Real weapons against Wim: he spars with fists and a padded club; a blade gets the whistle, and the gate."],
  world: practiceYardWorld,
};
