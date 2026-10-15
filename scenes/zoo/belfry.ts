import type { Scene } from "../../src/runtime/scene.ts";
import type { WorldSpec } from "../../src/world/scene-world.ts";
import { ft } from "./common.ts";

/**
 * The zoo's scene of time running out: a pigeon has nested in the noon bell, and the bell-ringer
 * rings it at noon, as he has every day for sixty years. Pacing cues (a minute to noon, then noon),
 * the beat's pressure (he spits on his hands), an ending the player didn't choose that escalates
 * and waits a turn (the noon bell), a risky attempt no route covers (climbing the frame: a freeform
 * roll), a danger left hanging over the player (a slip from the frame, a bell going off in their
 * ear) landing at the start of their next turn, and walking out (an ending of their own). The
 * belfry's arches are open: it's the only place in the game where it rains (its dressing says so).
 */

export const belfryWorld: WorldSpec = {
  name: "The belfry",
  description: "The ringing chamber of a bell tower, open arches on the drizzle, a bell frame with the noon bell in it, a rope, a ladder, and the back of the clock's face.",
  size: { w: 50, h: 40 },
  areas: [{ id: "ringing-chamber", name: "the ringing chamber", rect: { x: 5, y: 5, w: 40, h: 30 } }],
  things: [
    { id: "bell-frame", name: "the bell frame", kind: "feature", in: "ringing-chamber", at: ft(4, 2), size: "large", material: "wood", tags: ["fixed"], description: "Oak beams, black with age, and up in them the noon bell." },
    { id: "noon-bell", name: "the noon bell", kind: "object", in: "bell-frame", size: "large", material: "brass", states: ["hanging"], description: "Big Agnes: a ton of brass with a pigeon's nest in her mouth." },
    { id: "nest", name: "a pigeon's nest, two eggs in it", kind: "object", in: "ringing-chamber", at: ft(5, 2), size: "small", material: "cloth", tags: ["overhead"], description: "Twigs, bunting and two warm eggs, in the bell's mouth." },
    { id: "pigeon", name: "a pigeon on the nest", kind: "creature", in: "ringing-chamber", at: ft(6, 2), description: "She has opinions about the bell." },
    { id: "bell-rope", name: "the bell rope", kind: "feature", in: "ringing-chamber", at: ft(3, 4), size: "medium", material: "rope", tags: ["fixed"], description: "A red-and-white sally on a long rope, worn smooth by sixty years of one man's hands." },
    { id: "ladder", name: "a ladder up to the frame", kind: "object", in: "ringing-chamber", at: ft(7, 3), size: "large", material: "wood", description: "A ladder up into the frame, with a rung missing near the top, as ladders up to bells always have." },
    { id: "clock-face", name: "the back of the clock's face", kind: "feature", in: "ringing-chamber", at: ft(1, 1), size: "large", material: "wood", tags: ["sign"], description: "The works of the tower clock, and its hands seen from behind: it's a few minutes to noon." },
  ],
  people: {
    player: { in: "ringing-chamber", at: ft(4, 6) },
    peal: { in: "ringing-chamber", at: ft(2, 4), note: "by the rope, rolling up his sleeves" },
  },
};

export const belfry: Scene = {
  id: "zoo-belfry",
  title: "The Noon Bell",
  time: "morning",
  summary: "The zoo's scene of time running out: a nest in the noon bell, and a bell-ringer who has never missed noon.",
  setting: "The ringing chamber of a bell tower in the zoo's theatre: open arches with a thin drizzle blowing in, oak beams black with age, the noon bell up in its frame with a pigeon's nest in its mouth, a long rope with a red-and-white sally, a ladder with a rung missing near the top, and the works of the tower clock, its hands a few minutes from noon.",
  premise: "Will the noon bell ring with the pigeon's eggs in it?",
  hook: "A pigeon has nested in the noon bell, and it's a few minutes to noon.",
  opening: "Open on the chamber: drizzle in the arches, the clock's works ticking loudly, the bell up in its frame with a pigeon sitting in its mouth looking down at everyone, and the bell-ringer rolling up his sleeves by the rope, humming. He tells the player, without being asked, that he has rung noon every day for sixty years and is not stopping for a pigeon. End on the clock's tick.",
  cast: [
    {
      id: "peal", name: "Old Peal", called: "the bell-ringer", statblock: "commoner",
      look: "Eighty if a day, built like a coil of rope, with forearms like a docker's and ears full of grey hair.",
      voice: "Loud, because he's deaf from sixty years of bells; cheerful; talks about the bell as 'her' and 'Big Agnes'.",
      wants: "To ring noon on the stroke, as he has every day for sixty years.",
      fears: "Missing noon. Being retired. The vicar's new idea about a clockwork striker.",
      knows: [
        "The bell is Big Agnes, a ton of brass, cast the year the old King was crowned.",
        "Noon is a few minutes off, by the tower clock, which is never wrong (it's the city that's wrong).",
        "There's a small hand-bell he could ring instead, in an emergency. He's never had an emergency.",
        "The pigeon has nested in the bell every spring for years. The eggs never hatch; he's never wondered why.",
      ],
      secrets: ["He's fond of the pigeon, and calls her Little Agnes when nobody's listening."],
      attitude: "Stubborn and proud and kind underneath. A good reason moves him (the eggs, the pigeon, the bell's own good, a precedent from the old days); bluster doesn't; laying hands on him or his rope gets the vicar called. He counts down out loud as noon comes.",
    },
  ],
  start: "before-noon",
  beats: [
    {
      id: "before-noon",
      title: "A few minutes to noon",
      direction: "Old Peal is getting ready to ring. The player can talk him round, move the nest (up the ladder, past the missing rung: an Athletics check), or try something no route covers (climbing the frame, wedging the clapper, a spell): a risky attempt is rolled as it comes. If a reply leaves the player in danger (slipping from the frame, under the bell when it swings), it lands at the start of their next turn.",
      cast: { peal: "Hum, roll up your sleeves, talk about Big Agnes. Listen, a little." },
      pressure: "Old Peal spits on his hands and takes hold of the rope.",
      transitions: [
        {
          id: "talk-round", on: "attempt", when: "The player tries to talk Old Peal out of ringing the noon bell, or into ringing the hand-bell instead.",
          check: { skill: "persuasion", dc: 14, reason: "to get Old Peal to spare the eggs", success: "He looks up at the pigeon for a long moment, and reaches for the hand-bell.", failure: "He says sixty years is sixty years, and takes hold of the rope.", onSuccess: "spared" },
        },
        {
          id: "move-nest", on: "attempt", when: "The player climbs the ladder to move the nest out of the bell.",
          check: { skill: "athletics", dc: 13, reason: "to get up the ladder, past the missing rung, with a nest in one hand", success: "The nest goes onto a beam, eggs and all, and the pigeon goes with it, complaining.", failure: "The missing rung is missing; the player is left hanging from the frame.", onSuccess: "nest-moved" },
        },
        { id: "a-minute", on: "cue", when: "Two exchanges have gone by and noon hasn't been settled: the clock's hands reach a minute to noon.", to: "minute-to-noon" },
      ],
    },
    {
      id: "minute-to-noon",
      title: "A minute to noon",
      direction: "The last minute. Old Peal counts down out loud. Noon striking is an ending the player didn't choose: give a warning first (his countdown, his hands on the rope), and let them have their last try.",
      cast: { peal: "Count down, loudly. Keep one eye on the pigeon." },
      transitions: [
        {
          id: "last-word", on: "attempt", when: "The player makes one last appeal to Old Peal to spare the eggs.",
          check: { skill: "persuasion", dc: 16, reason: "to stop a man who has never missed noon, with seconds to go", success: "His hands come off the rope. He rings the hand-bell, very loudly, out of the arch.", failure: "Sixty years, he says, and pulls.", onSuccess: "spared", onFailure: "noon" },
        },
        { id: "noon-strikes", on: "cue", when: "An exchange has gone by in the last minute and nothing has stopped him: the clock strikes noon.", to: "noon" },
      ],
    },
  ],
  exits: [
    {
      id: "spared", kind: "persuaded", title: "The eggs are spared",
      outcome: "Old Peal rings the hand-bell for noon, out of the arch, and Big Agnes stays silent for the first time in sixty years.",
      closing: "Close on the hand-bell's thin noon, and Old Peal pretending he isn't watching the pigeon.",
      script: world => { world.character("peal").remember("Rang the hand-bell at noon for the pigeon's sake, the first time in sixty years."); world.journal("Old Peal rang the hand-bell at noon. The eggs are fine. So is Big Agnes."); },
    },
    {
      id: "nest-moved", kind: "progress", title: "The nest is moved",
      outcome: "The nest is out of the bell, on a beam, and Big Agnes rings noon as she always has.",
      closing: "Close on noon ringing out through the drizzle, and the pigeon glaring at the player from her new beam.",
      script: world => { world.journal("Moved a pigeon's nest out of the noon bell. The pigeon will never forgive us."); },
    },
    {
      id: "noon", kind: "other", title: "Noon",
      outcome: "Big Agnes rings noon with the nest in her mouth. The eggs, it turns out, were china (Old Peal put them there years ago to keep the pigeon happy); the pigeon is fine, and deaf.",
      closing: "Close on the enormous BONG, and on Old Peal, delighted, shouting that she's never sounded better.",
      script: world => { world.journal("The noon bell rang with the nest in it. The eggs were china. Nobody tells us anything."); },
    },
  ],
  limits: [
    "Stopping the clock: the tower clock's works are locked, and the key is with the vicar, who is at a funeral.",
    "Cutting the rope: Old Peal sleeps in the tower and would know; it's also the vicar's rope.",
  ],
  world: belfryWorld,
};
