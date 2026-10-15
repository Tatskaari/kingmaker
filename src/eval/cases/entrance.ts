import type { EvalCase } from "../types.ts";
import type { FixtureSpec } from "../fixtures.ts";

const OPENING = "The palace service arch is jammed by a tall green cart, wheels dug into the stone at a stubborn angle, a silver-birch sapling hung with tiny brass bells riding on top. Porters stand about with armfuls of linen; outside, wagons queue in the drizzle. A lanky scholar is half under the cart. \"Four minutes lost. Six porters idle,\" Marshal Holt snaps at his pocket watch. He rounds on you. \"You there. Who are you and what do you want?\"";

const BRIEFED: FixtureSpec = {
  beat: "holt-briefs", turnsInBeat: 1, visited: ["holt-raging"],
  transcript: [
    ["gm", OPENING],
    ["player", "\"I'm here about the King's cushions. Before you bite my head off: I want to help. What's going on?\""],
    ["holt", "*Holt snaps his watch shut.* \"Help. Good. Rowan's cart wedged itself across this arch at nine this morning. The cushions, the wine and half the linen are in the queue behind it. I have cleared space for him twice. Twice he was 'nearly finished'.\""],
    ["rowan", "*Rowan slides out from under the cart, soot on his nose.* \"Nearly finished! It's a self-guiding carriage, you see, with a protective charm. It's just being a little... protective.\""],
    ["mags", "*From outside, through the gap under the cart:* \"The tarp's leaking, love! The King's cushions are getting a bath!\""],
  ],
};

const AT_CART: FixtureSpec = {
  ...BRIEFED, beat: "the-cart", turnsInBeat: 1, visited: ["holt-raging", "holt-briefs"],
  transcript: [
    ...BRIEFED.transcript!,
    ["player", "\"Doctor Ash, what exactly is the cart protecting itself from?\""],
    ["rowan", "\"Not itself, the tree! The charm braces the wheels when it senses danger to the cargo. The arch is a hair too narrow for the branches, so it's decided the doorway is a threat. I just need to find the release. One more minute.\""],
    ["holt", "\"He has said 'one more minute' eleven times. I counted.\""],
  ],
};

export const entranceCases: EvalCase[] = [
  { kind: "reply", id: "be-another-route", about: "V1's stonewall: 'find another route'. The world has none; say so honestly and point at what is possible.", scene: "blocked-entrance", setup: BRIEFED,
    input: "\"Is there no other way in? Another door the wagons could use, a side gate, anything?\"",
    criterion: "There is no other route (the scene's limits say so). A good GM answers honestly and in the fiction (a character who would know says why not), without inventing a door, and turns the player back toward what could work here, so the conversation doesn't get stuck on the impossible route.",
    expect: { exit: "none" }, tags: ["impossible", "v1"] },
  { kind: "reply", id: "be-lift-tree", about: "V1's improvised remedy: lift the tree off so the charm has nothing to protect.", scene: "blocked-entrance", setup: AT_CART,
    input: "I look up at the sapling. \"So if the tree weren't on the cart, there'd be nothing for the charm to protect. Mags, porters, let's lift the tree off and carry it through by hand.\"",
    criterion: "This is a clever idea that addresses the real cause. The GM should take it seriously and let it gain real traction (characters react truthfully: Rowan nervous for the fragile tree, Holt impatient for it, Mags ready to lift), with an honest cost or risk, so that the cart can actually be freed this way. Burying it in procedure, or refusing it, would stonewall.",
    tags: ["tangent", "v1", "creative"] },
  { kind: "reply", id: "be-dwarves", about: "Bringing in people who aren't in the scene (V1: 'get the dwarves to wrestle it out').", scene: "blocked-entrance", setup: AT_CART,
    input: "\"The Kläggenheim delegation is in the palace, yes? Dwarves. Strong ones. Let's fetch a dozen dwarves to wrestle this thing out of the arch.\"",
    criterion: "Nobody else is coming to this scene, so the dwarves can't simply appear. A good GM responds in the fiction (a reason it won't work right now, or what fetching them would cost), and offers the help that IS here (porters, Mags, Holt's people), keeping the player's underlying idea (brute force) alive.",
    expect: { exit: "none" }, tags: ["impossible", "v1"] },
  { kind: "reply", id: "be-no-volunteered-solution", about: "Characters shouldn't hand the player the hidden solution unprompted.", scene: "blocked-entrance", setup: BRIEFED,
    input: "\"Right. So what's actually wrong with it?\"",
    criterion: "Rowan (or someone) explains the charm and the narrow arch, but nobody volunteers the hidden insight that removing the tree would stop the bracing: Rowan hasn't thought of it, and it should be the player's discovery. Explaining what the cart is doing is good; solving the scene for the player is not.",
    tags: ["characters", "secrets"] },
  { kind: "reply", id: "be-relay-shuttle", about: "V1's shuttle diplomacy: NPCs defer to each other and the player becomes a courier.", scene: "blocked-entrance",
    setup: { ...AT_CART, turnsInBeat: 3, transcript: [
      ...AT_CART.transcript!,
      ["player", "\"Marshal, would you give Doctor Ash ten more minutes if he promised to back out after that?\""],
      ["holt", "\"Ask him if he'll swear to it. In writing.\""],
      ["player", "\"Doctor Ash, will you swear to back out in ten minutes if you haven't fixed it?\""],
      ["rowan", "\"Ten minutes? Well. What does the Marshal say about twenty?\""],
    ] },
    input: "I take a deep breath. \"Marshal, he wants twenty.\"",
    criterion: "The player is being used as a courier between two people standing a few feet apart. A good GM breaks the loop: the characters start talking to each other directly, someone makes a decision or a counter-offer with a real deadline, or events force the issue. Another round of 'ask him' is a stonewall.",
    tags: ["stonewall", "v1"] },
  { kind: "decision", id: "be-dec-tree-lifted", about: "Freeing the cart by lifting the tree is the 'other remedy' exit.", scene: "blocked-entrance", setup: AT_CART, phase: "after",
    input: "\"Everyone on three: lift the tree off, carry it through by hand.\"",
    reply: "Mags and two porters take the pot, Rowan hovering with his hands out, Holt counting aloud. The sapling comes free of the cart with a shiver of bells. The cart's hum drops to nothing; its wheels sigh and relax on the flagstones. Rowan gives it a push and it rolls clear of the arch as meekly as a pram.",
    expect: ["other-remedy"], tags: ["exits", "v1"] },
  { kind: "decision", id: "be-dec-tree-proposed", about: "Merely proposing the lift hasn't freed the cart yet.", scene: "blocked-entrance", setup: AT_CART, phase: "after",
    input: "\"What if we lifted the tree off the cart?\"",
    reply: "Rowan blinks. \"Oh. Oh, that's... no tree, no threat. The charm would have nothing to protect.\" He looks up at the heavy pot. \"It's fragile, though. We'd need four people and steady hands.\" Holt is already pointing at porters.",
    expect: ["none"], tags: ["exits", "v1"] },
  { kind: "trajectory", id: "be-traj-diplomat", about: "A diplomat who tries to get everyone to agree.", scene: "blocked-entrance", maxTurns: 14,
    persona: "You're a diplomat at heart: you want everyone to come out of this happy. You ask each person what they want, try to broker compromises between them, and dislike anything destructive.",
    criterion: "The scene gives the player's diplomacy real traction (people negotiate with each other, make concessions or counter-offers) and reaches an ending without the player being stuck relaying messages or stonewalled.", tags: ["social", "v1"] },
  { kind: "trajectory", id: "be-traj-inventor", about: "A player who invents their own fixes.", scene: "blocked-entrance", maxTurns: 14,
    persona: "You love inventing your own solutions: you examine the cart, ask how the charm works, and try clever, unexpected fixes (some sensible, some ridiculous). You also try at least one thing that probably isn't possible in this world.",
    criterion: "Sensible inventions get real traction and can solve the scene; ridiculous or impossible ones get honest, in-fiction responses with an alternative; nobody solves it for the player.", tags: ["creative", "impossible"] },
];
