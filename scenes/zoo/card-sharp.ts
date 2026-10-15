import type { Scene } from "../../src/runtime/scene.ts";
import type { WorldSpec } from "../../src/world/scene-world.ts";
import { ft } from "./common.ts";

/**
 * The zoo's scene of people and what they keep back: a woman winning every throw with a pair of
 * silver dice. She goes by what the player calls her ("the woman with the silver dice") in the
 * narration, the dice lines and the barks until someone says her name. What she's hiding comes
 * out a step at a time, and only when the player gives her reason (staged secrets: a tell, guard
 * up, torn, told); pressing her is ruled yes, no, or a roll from the stakes and the leverage
 * (pressure rolls). Lay hands on her and the two gamblers at the table react, each their own way.
 * Both staged secrets and pressure rolls are switched on for this scene alone (the game's own
 * scenes run neither).
 */

export const cardRoomWorld: WorldSpec = {
  name: "The card room",
  description: "A low room with one lamp, one table and a great deal of money changing hands in one direction.",
  size: { w: 50, h: 40 },
  areas: [{ id: "card-room", name: "the card room", rect: { x: 5, y: 5, w: 40, h: 30 } }],
  things: [
    { id: "card-table", name: "the card table", kind: "object", in: "card-room", at: ft(4, 3), size: "medium", material: "wood", tags: ["furniture"], description: "Green baize, scorched at one corner, a pot of coins in the middle." },
    { id: "pot", name: "the pot of coins", kind: "item", in: "card-table", size: "small", material: "silver", description: "Everyone's pennies, on their way to the woman with the silver dice." },
    { id: "silver-dice", name: "a pair of silver dice", kind: "item", in: "sal", size: "tiny", material: "silver", tags: ["evidence"], description: "Very pretty. Very slightly heavier on one side than the other." },
    { id: "honest-dice", name: "a pair of bone dice", kind: "item", in: "sal", size: "tiny", material: "bone", tags: ["hidden"], description: "The pair she uses when someone's watching closely." },
    { id: "lamp", name: "a lamp on a hook", kind: "object", in: "card-room", at: ft(1, 1), size: "small", material: "brass", tags: ["light"], states: ["lit"] },
    { id: "green-waistcoat", name: "a gambler in a green waistcoat", kind: "person", in: "card-room", at: ft(2, 3), description: "Losing, and taking it personally." },
    { id: "wooden-leg", name: "a gambler with a wooden leg", kind: "person", in: "card-room", at: ft(6, 3), description: "Losing, and taking it philosophically. He has lost worse." },
  ],
  people: {
    player: { in: "card-room", at: ft(4, 6) },
    sal: { in: "card-room", at: ft(4, 2), note: "at the head of the table, shaking the dice" },
  },
};

export const cardSharp: Scene = {
  id: "zoo-card-sharp",
  title: "The Silver Dice",
  time: "evening",
  summary: "The zoo's scene of names held back and secrets kept: a woman who wins every throw.",
  setting: "A low card room in the zoo's theatre, lit by one lamp on a hook: a table of green baize with a pot of coins in the middle, a woman at its head shaking a pair of silver dice, and two gamblers losing to her, one personally, one philosophically.",
  premise: "Will the player catch the woman with the silver dice at it, and what will they do about it?",
  hook: "Somebody at the card table is winning every throw.",
  opening: "Open on the table: the dice rattling in a silver cup, a throw, a groan from the gambler in the green waistcoat, a shrug from the one with the wooden leg, and the woman at the head of the table raking in the pot with a smile. She invites the player to sit in: a penny a throw. Don't name her. End on the cup held out to the player.",
  cast: [
    {
      id: "sal", name: "Silver Sal Mordaunt", called: "the woman with the silver dice", aka: ["Sal", "Silver Sal"], statblock: "spy", weapon: "dagger",
      look: "Forty, elegant in a coat gone shiny at the elbows, silver rings on every finger and a silver dice-cup that never stops moving.",
      voice: "Warm, amused, unhurried; calls people 'friend'; answers questions with a better question.",
      wants: "To win enough tonight to pay what she owes before the Assembly is over.",
      fears: "The Saltmere factor she owes, and his two large nephews. Being caught in front of the table.",
      knows: [
        "Her name is Sal Mordaunt; the tables call her Silver Sal. She doesn't give it to strangers.",
        "Every game in the zoo, and who's good at what.",
      ],
      secrets: [
        "The silver dice are loaded: the sixes are weighted with lead. She switches to an honest bone pair whenever someone watches too closely.",
        "She owes a Saltmere factor forty crowns by the end of the Assembly, and he has two large nephews who collect.",
      ],
      attitude: "Charming and unbothered; she likes the player more the cleverer they are. Accused without proof, she laughs it off and the table takes her side. Caught with proof (the weighted dice in the player's hand, the switch seen), she's torn: she'll bargain, pay back, or bolt. Threatened, she gets cold and careful. Attacked, she draws a knife.",
    },
  ],
  start: "the-game",
  beats: [
    {
      id: "the-game",
      title: "A penny a throw",
      direction: "She wins. The player can play, watch her hands, look at the dice, press her, or make a scene. She gives nothing away at first: what she's hiding comes out a step at a time, and only when the player gives her a reason. Her name is hers to give: until someone in the story says it, she's the woman with the silver dice.",
      cast: { sal: "Win, charmingly. Switch the dice when someone's watching. Never say your name." },
      pressure: "She wins again. The gambler in the green waistcoat stands up, very red, and sits down again.",
      transitions: [
        {
          id: "see-the-switch", on: "attempt", when: "The player watches her hands closely, or asks to see the dice, to catch her switching them.",
          check: { skill: "perception", dc: 14, reason: "to see the dice change hands", success: "There: the silver pair goes up a sleeve, and a bone pair comes down.", failure: "Her hands are quicker than the eye, and the eye is tired.", onSuccess: "caught-out" },
        },
        { id: "proof", when: "The player has the silver dice in their own hands and has found the weight in them, or has otherwise proved they're loaded in front of the table.", to: "caught-out" },
      ],
    },
    {
      id: "caught-out",
      title: "Caught",
      direction: "She's been caught, and she knows it, and the table knows it. She's torn between bluffing, bargaining and bolting. She'll pay the table back if she must; she'd rather take the player into the scheme.",
      cast: { sal: "Keep smiling. Offer a cut. Look at the door." },
      transitions: [
        { id: "pays-back", when: "She agrees to pay the table back, or does.", to: "paid-back" },
        { id: "partners", when: "The player agrees to go in with her on the con.", to: "partners" },
      ],
    },
  ],
  exits: [
    {
      id: "paid-back", kind: "persuaded", title: "The table is paid back",
      outcome: "Silver Sal pays the table back, every penny, and leaves the zoo's card room for a better one.",
      closing: "Close on the coins going back across the baize, and on her tipping her hat to the player at the door.",
      script: world => { world.character("sal").setAttitude("wary", "Caught cheating by the visitor."); world.journal("Caught a card sharp with loaded dice. The table got its pennies back."); },
    },
    {
      id: "partners", kind: "other", title: "Partners",
      outcome: "The player goes in with Silver Sal on the con. The table doesn't know yet.",
      closing: "Close on her sliding the silver dice across to the player, and the gambler in the green waistcoat watching, very red.",
      script: world => { world.setFlag("card_sharp", "partners"); world.journal("Went into partnership with a card sharp. This will end well."); },
    },
  ],
  limits: [
    "The watch: there's no watch in the zoo, and the card room has never heard of it.",
    "Her debts: nobody here can pay forty crowns for her.",
  ],
  approach: { staging: true, pressureRolls: true },
  world: cardRoomWorld,
};
