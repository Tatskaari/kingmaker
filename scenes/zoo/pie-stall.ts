import type { Scene } from "../../src/runtime/scene.ts";
import type { WorldSpec } from "../../src/world/scene-world.ts";
import { ft } from "./common.ts";

/**
 * The zoo's first scene (src/game/zoo): one pie left, one pie-seller, and the player, hungry. A
 * small scene for the decider's ways with an attempt: an authored check (haggling, at Persuasion,
 * rolled with whatever method the player actually uses: a threat rolls Intimidation and leaves her
 * sore), what simply happens (paying her price: no dice), a payoff earned (a real kindness gets the
 * pie for nothing), a daft act's bill (insulting the pies), honest limits (no credit, no second pie,
 * no recipe), a question out of character answered out of character, a cue when the player dawdles
 * (a rival buyer), and the beat's pressure (a hopeful dog). It ends in two or three turns.
 */

export const pieStallWorld: WorldSpec = {
  name: "The pie stall",
  description: "A striped awning over a counter, one pie left on the tray, a chalked price board, and a dog who has worked out where the pies come from.",
  size: { w: 50, h: 40 },
  areas: [
    { id: "behind-the-counter", name: "behind the counter", rect: { x: 5, y: 5, w: 40, h: 10 } },
    { id: "the-queue", name: "the queue", rect: { x: 5, y: 15, w: 40, h: 20 } },
  ],
  things: [
    { id: "stall", name: "the pie stall", kind: "object", in: "behind-the-counter", at: ft(4, 2), size: "large", material: "wood", tags: ["furniture", "container"], description: "A counter under a striped awning, scrubbed, floury, with a tray on it." },
    { id: "last-pie", name: "the last pork pie", kind: "item", in: "stall", size: "tiny", material: "flesh", description: "Golden, steaming slightly, with a crimped edge like a crown. Mostly pork." },
    { id: "spare-pie", name: "a pie under the counter", kind: "item", in: "stall", size: "tiny", material: "flesh", tags: ["hidden"], description: "Madam Crust's own tea, which nobody was meant to know about." },
    { id: "price-board", name: "a chalked price board", kind: "object", in: "behind-the-counter", at: ft(7, 1), size: "small", material: "wood", tags: ["sign"], description: "PIES 2d. ASSEMBLY PIES 3d. QUESTIONS 1d. NO CREDIT, NO EXCEPTIONS, NO DOGS." },
    { id: "dog", name: "a hopeful dog", kind: "creature", in: "the-queue", at: ft(2, 5), description: "A dog of no breed and great patience, sitting very straight." },
  ],
  people: {
    player: { in: "the-queue", at: ft(4, 5) },
    crust: { in: "behind-the-counter", at: ft(4, 1), note: "behind the counter, arms folded" },
  },
};

export const pieStall: Scene = {
  id: "zoo-pie-stall",
  title: "The Last Pie",
  time: "afternoon",
  summary: "The zoo's scene of checks and payoffs: one pie left, one pie-seller who knows it, and you.",
  setting: "A pie stall in the zoo's theatre, set up like a corner of Caerwyn's market on the eve of the Assembly: a striped awning, a scrubbed counter with one pie left on the tray, a chalked price board (PIES 2d. ASSEMBLY PIES 3d. QUESTIONS 1d. NO CREDIT, NO EXCEPTIONS, NO DOGS), and a dog sitting very straight by the counter. Every other pie in the city went to the delegations' servants this morning.",
  premise: "Will the player get the last pie, and at what price?",
  hook: "One pie left in the whole of the zoo, and the pie-seller knows it.",
  opening: "Open on the stall: one pie, steaming slightly on its tray; the pie-seller behind the counter with her arms folded, watching the player the way a cat watches a pigeon that has come too close; the dog by the counter, sitting very straight. She names her price before anyone has asked: threepence, it being an Assembly pie. End on her waiting.",
  cast: [
    {
      id: "crust", name: "Madam Crust", called: "the pie-seller", statblock: "commoner", weapon: "club",
      look: "A broad woman in a floury apron, forearms like hams, a small brass bell on the counter for summoning nobody in particular.",
      voice: "Brisk market patter; calls everyone 'my lamb'; never uses one word where three will sell more pies.",
      wants: "Threepence for the last pie, and the day done.",
      fears: "Being thought a soft touch. The delegations' servants coming back for more.",
      knows: [
        "The pie is pork, mostly. What the rest is, is a family secret, and the recipe isn't for sale at any price.",
        "Every pie in Caerwyn went to the delegations this morning: Saltmere's servants bought forty.",
        "She doesn't give credit. She has a list of people who asked for it, and she reads it out at Midwinter.",
      ],
      secrets: ["There's one more pie, under the counter: her own tea. A real kindness, or a case she can't argue with, gets it out from there."],
      attitude: "Friendly, businesslike and immovable on price, unless she's charmed, given a good reason, or done a kindness; then she's generous and pretends she isn't. Threatened, she sells (people do), and remembers it: the next pie is dearer, and the dog is given the crust. Insulted (her pies, her prices, her dog), she takes it out of the player in her own way, in public.",
    },
    {
      id: "servant", name: "a Saltmere servant", statblock: "commoner", enters: "rival",
      look: "A young man in salt-gull livery with a purse and a list, both long.",
      voice: "Polite, harried, faintly superior: he has been sent for pies and will not go back without them.",
      wants: "Whatever pies there are, for the Saltmere delegation, at any price his purse allows.",
      knows: ["His delegation's cook has already made pies, which the delegation won't eat, which is why he's here."],
      attitude: "Courteous until there's one pie and two buyers; then he bids, and bids again.",
    },
  ],
  start: "haggle",
  beats: [
    {
      id: "haggle",
      title: "One pie left",
      direction: "Madam Crust sells the last pie. Paying her price simply happens: no dice. Haggling is a check (Persuasion); whatever method the player uses is the roll (a threat is Intimidation, a lie is Deception), and it lands that way. A real kindness or service (minding the stall a moment, finding her a customer, making her laugh properly) is a payoff earned: the pie comes free, with no new conditions. An insult to the pies, the prices or the dog has a consequence, in her own way.",
      cast: { crust: "Name the price; stick to it cheerfully; let the dog's hopeful presence do some of the work." },
      pressure: "The dog lies down at the player's feet and sighs, enormously, at the pie.",
      transitions: [
        { id: "pay", on: "attempt", when: "The player pays her price (threepence) or more, or puts the coins on the counter.", to: "bought", establishes: ["The player paid Madam Crust threepence for the last pie."] },
        {
          id: "haggle", on: "attempt", when: "The player tries to get the pie for less than threepence: haggling, charming, making a case, threatening or lying.",
          check: { skill: "persuasion", dc: 12, reason: "to get the last pie for tuppence", success: "She gives way and lets it go for tuppence, with a show of being robbed blind.", failure: "She folds her arms tighter: threepence, and the dog is looking at the pie with intent.", onSuccess: "bargain" },
        },
        { id: "kindness", when: "The player has done Madam Crust a real kindness or service, unasked and without haggling, and she has noticed.", to: "gift", given: true },
        { id: "rival-cue", on: "cue", when: "Two exchanges have gone by and the pie is still on the tray: a delegation's servant arrives wanting pies.", to: "rival" },
      ],
    },
    {
      id: "rival",
      title: "A rival for the pie",
      direction: "The Saltmere servant arrives with a purse and a list, and wants every pie there is. Madam Crust is delighted: an auction. The player can outbid him, talk him out of it, or give way.",
      cast: { servant: "Bid fourpence, politely. Then fivepence, less politely.", crust: "Run the auction like a duchess at a cattle fair." },
      transitions: [
        { id: "outbid", on: "attempt", when: "The player bids more than the servant, or pays whatever Madam Crust now asks.", to: "bought" },
        {
          id: "talk-him-out", on: "attempt", when: "The player tries to talk the servant out of buying the pie.",
          check: { skill: "persuasion", dc: 13, reason: "to send the servant back to his own delegation's pies", success: "The servant decides his delegation's own pies will do, and leaves with dignity.", failure: "The servant pays fivepence, and the last pie goes to Saltmere.", onSuccess: "bought", onFailure: "lost" },
        },
        { id: "give-up", when: "The player lets the servant have the pie.", to: "lost" },
      ],
    },
  ],
  exits: [
    {
      id: "bought", kind: "progress", title: "Bought, fair and square",
      outcome: "The player has the last pie, at Madam Crust's price.",
      closing: "Close on the first bite, and on the dog, who has seen this before and is not giving up.",
      script: world => { world.setFlag("pie", "bought"); world.journal("Bought the last pie in the zoo, at the asking price. Mostly pork."); },
    },
    {
      id: "bargain", kind: "persuaded", title: "A bargain",
      outcome: "Madam Crust lets the last pie go for tuppence (or for whatever the method won her over with), and the player has it.",
      closing: "Close on her taking the coins as if they hurt, and on the player's pie.",
      script: world => { world.setFlag("pie", "bargain"); world.journal("Talked the pie-seller down to tuppence. She'll remember."); },
    },
    {
      id: "gift", kind: "persuaded", title: "On the house",
      outcome: "Madam Crust gives the player a pie for nothing (the one from under the counter, if the last has gone), for a kindness done.",
      closing: "Close on her pushing it across the counter and saying she never did.",
      script: world => { world.character("crust").setAttitude("friendly", "The visitor did her a kindness."); world.journal("Madam Crust gave us a pie for nothing. Nobody is to know."); },
    },
    {
      id: "lost", kind: "other", title: "No pie",
      outcome: "The last pie went to someone else.",
      closing: "Close on the servant walking off with it, and the dog following him.",
      script: world => { world.setFlag("pie", "lost"); world.journal("Lost the last pie to Saltmere. Saltmere will pay for this."); },
    },
  ],
  limits: [
    "A second pie: there isn't one (or so she says; see her secret).",
    "Credit: Madam Crust doesn't give credit. Asking puts you on the list she reads out at Midwinter.",
    "The recipe: a family secret, not for sale at any price.",
  ],
  world: pieStallWorld,
};
