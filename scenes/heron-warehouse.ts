import type { Scene, Transition } from "../src/runtime/scene.ts";
import type { SceneOutcome, WorldApi } from "../src/world/dsl.ts";
import { heronWorld } from "./worlds/heron-warehouse.ts";

/**
 * Scene three, and the end, of the Purveyor's Man arc (docs/design/caerwyn-arc.md): hanged-clerk →
 * drowned-rat → heron-warehouse. Night at the wharves. The King's "lost" grain is slit out of the
 * palace's wheat-ear sacks, re-sacked under a Saltmere factor's heron and loaded onto a barge that
 * sails on the ebb, and Master Sallow comes at the midnight bell to see it go and initial the true
 * book (thieves keep honest books because they don't trust each other). The scene is getting in,
 * getting the proof, and possibly catching Sallow in the act.
 *
 * The night staff are new: Saul the watchman (deaf on one side, devoted to his dog), Hep Grist and
 * her re-sacking gang, and Scrope, the clerk who keeps the true book and was Prout's oldest friend.
 * The recurring people are written neutral to how the Drowned Rat ended: Hobb's card says where he is
 * in each case (on the hoist, in the cells, or at his master's heels), Sallow's says what changes if
 * Hobb warned him, and Kell is as warm as things stand between her and the player. Every ending goes
 * on to the King's morning (kings-morning), and so does the story if play has already overtaken this
 * scene (the night's business settled before the player got here).
 */

const MASTER_HERE = "Master Sallow has come to the Heron.";
const BOOK = "The player has the true book in their hands.";
const BOOK_SEEN = "The player has seen inside the true book: the 'lost' wagons by their Granary Roll numbers, with Sallow's initials on every page.";
const BOOK_GONE = "The true book has been destroyed: burned, or gone into the river.";
const FIRE = "Fire has taken hold of the Heron.";
const SUNK = "The barge Patience has gone down with the King's grain in her.";

const has = (facts: string[], fact: string) => facts.includes(fact);
/** The book is the player's if they got their hands on it and nobody destroyed it afterwards. */
const bookSaved = (outcome: SceneOutcome) => has(outcome.established, BOOK) && !has(outcome.established, BOOK_GONE);

const trueBookItem = {
  id: "true-book",
  name: "The Heron's true book",
  content: "A fat ledger bound in green calf with a brass clasp, in Mister Scrope's small, careful hand. Page after page of King's Road grain wagons that the Granary Roll calls 'lost to goblins', each by its Roll number and date: sacks received at the Heron in the palace's wheat-ear sacking, re-sacked under the heron, sold to the Saltmere factor by the barge-load, the price, and the Master's share. Every page is initialled 'J.S.'",
};

function keepBook(world: WorldApi, outcome: SceneOutcome): void {
  if (bookSaved(outcome)) world.player.addItem(world.newReadable(trueBookItem));
}

/** What became of the proof: taken, seen, or burned (docs/design/caerwyn-arc.md). */
function bookFlag(world: WorldApi, outcome: SceneOutcome, options: { lostIfCaught?: boolean } = {}): void {
  if (has(outcome.established, BOOK_GONE)) world.setFlag("true_book", "burned");
  else if (bookSaved(outcome) && !options.lostIfCaught) world.setFlag("true_book", "taken");
  else if (has(outcome.established, BOOK) || has(outcome.established, BOOK_SEEN)) world.setFlag("true_book", "seen");
}

const bookInHand = (beat: string): Transition => ({ id: "book-in-hand", when: "The player has the true book in their hands: lifted, taken, snatched or handed over by Scrope.", to: beat, establishes: [BOOK] });
const bookRead = (beat: string): Transition => ({ id: "book-read", when: "The player has had a good look inside the true book, or had it read to them: the 'lost' wagons by their Granary Roll numbers, with the Master's initials on every page.", to: beat, establishes: [BOOK_SEEN] });
const fight: Transition = { id: "attack", on: "attempt", when: "The player attacks Sallow, the Crakes or Hep's gang, meaning to hurt them now: a real fight, not a shove to get past someone.", to: "fight" };

export const heronWarehouse: Scene = {
  id: "heron-warehouse",
  title: "The Heron Warehouse",
  time: "night",
  summary: "Night at the wharves: the King's grain re-sacked under a heron, a barge that sails on the ebb, and the true book that can hang a gentleman.",
  setting: "Night on the eve of the Centennial Assembly, at the downriver end of Caerwyn's wharves, where the lamps give out. The Heron warehouse is a tall, tarred timber warehouse standing half on the wharf and half on piles over the river, with a painted heron on its signboard. On the wharf side is the land door, big double doors with a wicket in one leaf, and beside it Saul's sentry box and brazier, with Duchess the dog snoring across the threshold. On the river side, along a slippery plank walk on the piles, is the river door: a low loading door at water level with a grille in it, where the gang come and go, holding a brass heron token up to the grille for whoever is nearest inside to draw the bolt. Above it the hoist beam swings sacks out and down into the barge moored alongside: the Saltmere barge Patience, broad and low, hatches open, her bargees waiting for the ebb. Inside is one long floor lit by lanterns and thick with grain dust, which hangs in the light like fog. Down one side are stacked the palace's grain sacks, each stamped with the wheat-ear; down the other, new sacks stamped with a heron. Between them Hep Grist's gang are slitting, pouring and sewing, and a chute runs down through the river door to the barge. There's a heap of empty wheat-ear sacks waiting for the river, a brazier for cold hands, and a painted sign reading NO NAKED LIGHTS, which everyone ignores. Up a short stair, a glass-sided counting-box hangs over the floor, where Mister Scrope sits under a lamp with the true book open. The river runs high, fast and black under the floor, and the tide is on the turn. The bells carry across the water: at the midnight bell the Master comes, and at the second bell after it the ebb runs and the Patience, which waits for no one, casts off.",
  premise: "Can the player get into the Heron, come away with proof of where the King's grain goes (the true book), and catch Master Sallow at it, before the barge sails on the ebb?",
  hook: "Night, on the eve of the Assembly. The big man with the bandaged hand, Hobb Mallory, works nights for a gentleman at the Heron warehouse, at the downriver end of the wharves, and tonight a barge is loading there. If the King's 'lost' grain goes anywhere, it goes through those doors. Sergeant Kell is with you on the dark wharf.",
  background: [
    "This is the same night as the Drowned Rat and the morning at the granary where Wendell Prout was found hanged. What happened in them is in what happened just before this scene, and that wins: where Hobb is, whether Sallow has been warned, what the player carries (Prout's page, Hobb's token) and how they stand with Kell. If nothing happened before: the player knows Hobb works nights at the Heron for a gentleman, Hobb is at work on the hoist, and Sallow hasn't been warned.",
  ],
  opening: "An hour or so after the Rat, near midnight: open on the dark wharf with the Heron in view. Lantern light through the cracks with the grain dust swimming in it, the hoist swinging sacks down into the barge, Saul's brazier at the land door with Duchess snoring across the threshold, the river running high and black. Pick up from how the Rat ended: the player has come on Hobb's directions or on his heels, with his token or without. Kell is at their side, unless she took Hobb to the cells, in which case she's coming along the wharf to meet them. Don't show Master Sallow: he isn't here yet (and if Hobb ran to him from the Rat, neither is Hobb). Nobody gets a name until someone says it: describe the watchman, the dog, the forewoman and the clerk by look. End on something the player can act on: the watchman heaving himself up for his round, a knock and a token at the river door, the lamp in the counting-box window.",
  cast: [
    {
      id: "kell",
      name: "Sergeant Agnes Kell",
      statblock: "guard", weapon: "club",
      look: "Forties, in the same borrowed coat over her watch uniform that fools nobody (it's the boots). A battered oilcloth notebook and a pencil stub she sharpens with a clasp knife, a watch whistle on a cord round her neck, and a truncheon she has never been seen to draw. Stands very still and watches people's hands.",
      voice: "Dry, calm, precise and sparing: short sentences, the odd 'Noted.' Calls the player 'investigator'. Finds them funny and lets a joke land with a twitch of the mouth, then gets back to the matter in hand without making it the investigator's job to steer. Taps her pencil on the notebook when time is being wasted. Whispers badly.",
      wants: "To see Prout's killer answer for it, written down true: tonight, to catch the man behind it with the King's grain, or to come away with proof the King can't wave aside.",
      fears: "Putting a wrong name in her notebook. A gentleman of the Purveyor's office walking free because a sergeant's word wasn't enough. The investigator drowned on her watch.",
      knows: [
        "A sergeant of the watch who sees a crime done may arrest whoever does it, gentleman or not, on her own authority. She'll do it by the book, out loud, with the proper words. She needs to see it herself, or have it sworn to by people who did.",
        "Receiving the King's stolen goods is a hanging matter, and so is murder. People who might hang with the guilty can sometimes be brought to swear for the Crown instead.",
        "The whole watch is lining the Assembly route through the night: her whistle will bring nobody but her. And she's no sneak (watch boots, and knees that complain on ladders).",
        "Whatever was said at the granary and the Rat is in her notebook.",
      ],
      secrets: [
        "Three days ago Prout came to the watch house and asked her how a clerk reports 'false entries in the King's rolls', and whether the watch could arrest 'a gentleman of the Purveyor's office'. She told him to take it to the palace. It's why this one matters to her. If it hasn't come out yet, it may tonight.",
      ],
      attitude: "Reserved and watchful, and exactly as warm with the investigator as things stand between them; she doesn't pretend otherwise. She'll go in at their elbow if they want a witness there, or keep the wharf and the land door with her whistle and come at their signal; left to choose, she takes the wharf, where she can see who comes and goes. She notices things and points them out in a word, or writes them down where the investigator can see, rather than drawing the conclusion for them. She won't arrest on a hunch or a lie, she won't take a bribe from anyone, and she steps in, once and firmly, if anyone is about to be drowned.",
    },
    {
      id: "saul",
      name: "Saul Tench",
      statblock: "guard", weapon: "spear",
      look: "An old river-watchman in a greatcoat over a dozen other coats, a red muffler wound round his head over his left ear, a lantern, a rattle, and a cudgel he mostly uses to poke his brazier. At his feet, or across the land door's threshold, lies Duchess: a vast, elderly brindle mastiff with a face like a collapsed sofa, who snores, drools and has opinions about smells.",
      voice: "Loud, because he can't hear himself on the left. Talks to Duchess more than to people, and answers for her ('She says you smell of sausage'). Repeats things back ('A buyer, you say?'). Ends sentences with 'and all's well', out of forty years' habit, whether it is or not.",
      wants: "A quiet night by his brazier, Duchess fed and happy, and to keep his place: the Heron pays three times what the river watch did.",
      fears: "Losing his place. The Master, who once kicked Duchess (she has growled at him ever since, and Saul has never forgiven him). The river: he can't swim.",
      knows: [
        "On loading nights nobody comes in at the land door but the Master, at the midnight bell; the gang come and go by the river door. Those are the Master's orders, and Saul keeps them.",
        "He walks the wharf with his lantern at every bell, calling the hour, with Duchess. Between bells he sits by his brazier at the land door.",
        "Duchess knows the whole gang by smell and growls at strangers. She also growls at the Master, which Saul considers a mark of good character.",
        "The barge alongside is the Saltmere barge Patience, and she sails on the ebb at the second bell after midnight.",
      ],
      secrets: [
        "He's deaf as a post on his left side and hides it: anything said or done on his left goes past him, and he nods along. He trusts Duchess's nose over his own eyes: anyone she takes to, he takes to, and she takes to anyone with food and patience.",
        "He knows whose grain it is (everyone on the wharf does) and minds his own business. He would much sooner be on the side of a sergeant than in front of a judge.",
        "He can be bought, but not cheaply (the Heron pays him three times what the river watch did), and he'd be happier if it could be called a present for Duchess.",
      ],
      attitude: "Gruff and suspicious at the door, and garrulous once Duchess has decided you're all right. Respects a uniform and the King's name; frightened of the Master.",
    },
    {
      id: "hep",
      name: "Hepzibah Grist",
      statblock: "tough", weapon: "dagger",
      group: "Hep Grist and her re-sacking gang, six porters in grain-white with knives and sack-needles",
      look: "A broad woman in a leather apron with a sack-needle stuck through her collar and a knife on a cord, floured white to the elbows, with a voice like a winch. Her gang work fast, heads down, and don't talk.",
      voice: "Shouts in numbers and the gang's own cant ('Forty to the hatch! Mind that seam!'). Never uses a name if 'you' will do. Swears by the tide.",
      wants: "The last of the grain re-sacked and down to the barge before the ebb, the gang's double pay, and no questions from anyone.",
      fears: "The gallows: receiving the King's grain is a hanging matter, and she knows it. The Master. Missing the tide.",
      knows: [
        "Two hundred sacks tonight, forty still to go before the Master comes at the midnight bell to see the last of them down and initial the clerk's count. The barge sails on the ebb at the second bell.",
        "The palace sacks are slit, poured into heron sacks and sewn shut; the empty wheat-ear sacks go in the river at the end of the night, weighted with stones.",
        "The gang is short-handed tonight (Assembly eve: half the river's drunk), and she'll put any strong pair of hands to work and ask who they are afterwards.",
      ],
      secrets: [
        "She knows exactly whose grain it is and has never once said so out loud.",
        "She skims a sack a night for the gang's families. It's in nobody's book but hers.",
        "Her gang comes before everything. To keep them off the gallows she'd swear against the Master in a heartbeat, if she believed it would work.",
      ],
      attitude: "Brusque, practical and suspicious of anyone not working: anyone with a sack on their shoulder is crew until proven otherwise. Cares for her gang like a hen for her chicks, and for nobody else.",
    },
    {
      id: "scrope",
      name: "Mister Lemuel Scrope",
      statblock: "commoner", weapon: "unarmed-strike",
      look: "A narrow, stooped clerk in rusty black, with sleeve-guards, a green eyeshade and a pen behind each ear, up a short stair in the glass-sided counting-box over the floor. The true book, a fat ledger bound in green calf with a brass clasp, lies open under his left hand, which never leaves it.",
      voice: "A dry murmur of figures. Talks in double entry ('That doesn't balance'). Apologises to the book when he blots it.",
      wants: "The count right and the books balanced. To get through tonight. To be anywhere else.",
      fears: "The Master. A mistake in the book. Whatever happened to Wendell Prout.",
      knows: [
        "The true book: every 'lost' wagon from the King's Road by its Granary Roll number and date, the sacks received in the palace's wheat-ear sacking, re-sacked under the heron, sold to the Saltmere factor by the barge-load, the price, and the Master's share, with the Master's initials, 'J.S.', on every page.",
        "Why it exists: the Master doesn't trust the Saltmere factor and the factor doesn't trust the Master, so both insisted on a true book kept by a clerk they both pay. There is no honour among thieves; there is bookkeeping.",
        "The Master initials each night's page when he comes at the midnight bell, and takes his share in heron pennies.",
      ],
      secrets: [
        "He and Wendell Prout were apprentices together under the old Keeper of the Granary Roll forty years ago, and have played draughts every Sunday since. This morning he was told Wendell hanged himself, and he doesn't believe it: Wendell never left a column unbalanced in his life. He has spent the day sick with the thought that he knows exactly why Wendell is dead, and that a man who keeps an honest book for the Master might be next.",
        "He would know Wendell's hand anywhere, and his pencilled weights.",
      ],
      attitude: "Timid, punctilious and evasive; polite to everyone and frightened of most of them. The book is the one thing he'll fight for.",
    },
    {
      id: "hobb",
      name: "Big Hobb Mallory",
      statblock: "tough", weapon: "unarmed-strike",
      look: "A dock-porter the size of a door, with a head like a bollard, a nose broken more than once and a leather porter's hood. His right hand is wrapped in a tarry rag, and he works the hoist one-handed, wincing. Where he is tonight follows from how the Drowned Rat ended: on the hoist with Hep's gang as usual; in the watch-house cells if Kell took him in (then he isn't here at all, and the gang is a man shorter); or, if he ran from the Rat to warn his master, with the Master, and he comes in at his heels at the midnight bell.",
      voice: "Slow, low and polite: 'sir', 'missus'. Says as little as he can, then far too much all at once. When frightened he goes very quiet and very still, like a dray-horse in thunder.",
      wants: "To get through tonight's loading without his master looking at him. Not to hang. For his mum in the Shambles never to know. Underneath, to put right what he did, if anyone could show him how.",
      fears: "His master, and the river. The noose. What he did in the tally loft.",
      knows: [
        "The night routine: the gang come and go by the river door with a heron token at its grille; Saul and Duchess keep the land door; Mister Scrope keeps the true book in the counting-box; the Master comes at the midnight bell; the barge goes on the ebb.",
      ],
      secrets: [
        "Last night in the granary tally loft the Master struck the clerk with his cane head and strangled him with a cord while Hobb held his arms, then had Hobb haul him up on the sack hoist to look like a suicide. The rope took the skin off his palm. 'I only held him. I only held the rope.'",
      ],
      attitude: "Polite, slow and closed; no fighter unless cornered, and then a door falling on you. How he takes the investigator tonight is as things were left at the Rat: their man inside (for as long as his nerve holds, which may not be long with the Master in the room), a man who has run to his master, or a man they've never spoken to. With the Master in the room he can't look at anyone.",
    },
    {
      id: "sallow",
      name: "Master Josiah Sallow",
      group: "Master Sallow, his lantern-boy and the Crake brothers, two hired river-bruisers",
      statblock: "bandit-captain", weapon: "rapier",
      members: [
        { id: "crake-1", name: "the talking Crake", statblock: "tough", weapon: "club", look: "An enormous river-bruiser in a reefer jacket, with a cudgel and a great deal to say about it." },
        { id: "crake-2", name: "the silent Crake", statblock: "tough", weapon: "club", look: "His identical brother, who has never been heard to say anything at all." },
        { id: "lantern-boy", name: "the lantern-boy", statblock: "commoner", weapon: "unarmed-strike", look: "A yawning boy of ten with a lantern on a pole, who would very much like to be somewhere else." },
      ],
      look: "Fifty, pink and well-fed, in a good dark coat with a fur collar, with a silver-topped cane, a wheat-ear signet ring (the Royal Purveyor's office's mark) and the soft hands of a man who signs things, except that they're very quick. He wears so much lavender water that you smell him a full minute before you see him. Behind him come a yawning lantern-boy and the Crakes: two enormous, identical river-bruisers, one of whom talks.",
      voice: "Smooth, reasonable and faintly bored; talks like an official letter ('It has come to my attention', 'regrettably', 'in the King's interest'). Never raises his voice. Calls people by their trade ('Clerk', 'Porter', 'Sergeant'). The more frightened he is, the more polite he gets.",
      wants: "The barge loaded and away on the ebb, tonight's page initialled and his share in his purse, and the business of the clerk Prout closed for good, tidily, with no loose ends.",
      fears: "The King's attention. A scandal on the eve of the Assembly. The true book in the wrong hands. Being laughed at. Dogs.",
      knows: [
        "The grain, he will say, is condemned stock lawfully sold by the Royal Purveyor's office, and he has the paper to prove it: an order of sale signed 'J. Sallow, for the Royal Purveyor'. It's his own signature, and nobody has ever checked.",
        "The Watch Captain files what the Purveyor's office asks him to file.",
        "The Crakes will do anything for a shilling and worse for two. The wharves are dangerous at night, and every Assembly somebody falls in.",
        "The Patience sails on the ebb at the second bell.",
      ],
      secrets: [
        "He killed Wendell Prout in the tally loft last night: a blow from the cane head, then a cord, while Hobb held the clerk's arms. Then Hobb hoisted him for a suicide, a granary girl was paid a crown to swear she saw him jump, and the Captain closed it. He will never admit it, except to someone he believes is about to die.",
        "The racket: King's Road grain wagons that he writes off in the Granary Roll as 'lost to goblins' come here to be re-sacked under the Saltmere factor's heron and sold downriver. He pays the hedge-goblins in the factor's heron pennies to keep the goblin story true.",
        "The true book is the one thing that can hang him, and he lets it exist only because the factor won't deal without it. Cornered with it, he'd sooner put it in the brazier or the river than see it taken.",
        "If Hobb ran to him from the Rat, he knows the King's investigator and a watch sergeant are asking about the loft. Then he comes at the bell with Hobb at his heels, sharp and hurrying, has the Crakes look along the wharf, and wants the true book sewn into oilcloth and aboard the barge, out of Caerwyn's reach, before anything else.",
        "The silver-topped cane is a sword-cane, and thirty years ago he was the best fencer of his year at the Purveyor's school. Nobody at the Heron has ever seen it drawn. Cornered with proof in front of witnesses he can't buy, he stops being polite: he draws it, and sets the Crakes on whoever is holding the proof.",
      ],
      attitude: "Courteous, superior and unhurried, as if everyone were a junior clerk who has made an error. Faced with trouble he tries his office first (papers, titles, the Captain's name), then money (heron pennies, a post in the Purveyor's office), then the Crakes and the river. Under the courtesy is a coward who fights like a cornered rat: exposed with proof he can't buy or drown, he draws the sword from his cane, and it comes to blades. Beaten, he surrenders at once, very politely.",
      enters: "midnight",
    },
  ],
  start: "wharf",
  beats: [
    {
      id: "wharf",
      title: "The Heron by night",
      direction: "The player is outside the Heron on the dark wharf, and nobody inside knows they're here. This beat is for looking and choosing how to go in. Answer questions about the outside concretely and generously: the land door with Saul, his brazier and Duchess; the plank walk along the piles to the river door and its grille; the barge alongside and the hoist swinging sacks into her; the gang glimpsed through the river door, slitting sacks; the lamp in the counting-box window; the tide on the turn. Kell works out with the player where she's most use. Preparations the player makes should pay off in position and surprise, and a diversion (a noise down the wharf, a barge line slipped, something for Duchess to chase) can draw Saul or the gang away for a moment; a naked flame anywhere near the grain dust is a very bad idea, and everyone at the Heron knows it. Getting in is a real edge, but there are several doors into it, and some need no dice: Hobb's token at the river door, Hobb himself if he's on their side, or a sack on the shoulder and a place in Hep's short-handed gang.",
      cast: {
        saul: "You want a quiet night: mind the land door, talk to Duchess, and get up at the bell to walk the wharf with your lantern.",
        kell: "Work out with the investigator where you're most use: at their elbow inside, or out here on the wharf with your whistle.",
        hep: "You want hands and the count: drive the gang, and shout for help at the river door.",
        hobb: "If you're here, you're on the hoist. If you agreed at the Rat to let them in, you're listening for their knock.",
      },
      pressure: "Saul heaves himself up for his round and comes along the wharf with his lantern and Duchess, straight towards wherever the player is standing. Or a sack splits on the hoist and spills grain across the wharf at the player's feet, the wheat-ear stamp plain on the torn sacking.",
      transitions: [
        { id: "inside", when: "The player is inside the Heron, unnoticed or taken for someone who belongs there (in at the river door with Hobb's token or his help, past Saul, as a hand in Hep's gang, or any other way established in play).", to: "floor" },
        {
          id: "sneak-in", on: "attempt",
          when: "The player tries to slip into the Heron unseen: past Saul's deaf side and the sleeping dog, or along the plank walk and in at the river door while the gang's backs are turned.",
          check: { reason: "to slip into the Heron unseen",
            skill: "stealth", dc: 13,
            success: "They're in, in the shadow of the wheat-ear stacks, with the whole floor in front of them and nobody the wiser.",
            failure: "Something gives them away (a plank that creaks, a dog that wasn't asleep, a porter who looks round at the wrong moment) and the alarm goes up. They're not caught yet, but the wharf is looking for them.",
            onSuccess: "floor",
          },
        },
        {
          id: "talk-past", on: "attempt",
          when: "The player tries to bluff their way in past Saul or whoever answers the river door with a story that isn't true: the Saltmere factor's man, someone sent by the Master, a hand that somebody sent for when nobody did. (Answering Hep's own shout for hands, turning up with a sack on their shoulder, or showing Hobb's token isn't a bluff and needs no dice.)",
          check: { reason: "to talk your way into the Heron",
            skill: "deception", dc: 13,
            success: "Whoever's at the door believes it and stands aside. They're in, and expected to behave like whoever they said they were.",
            failure: "It doesn't wash. The door stays shut, and whoever was at it is now watching the wharf for them; the next way in will have to be a different one.",
            onSuccess: "floor",
          },
        },
        {
          id: "win-duchess", on: "attempt",
          when: "The player tries to make friends with Duchess before she raises the wharf: food, patience, a way with dogs.",
          check: { reason: "to win Duchess over before she raises the wharf",
            skill: "animal_handling", dc: 12,
            success: "Duchess decides they're the best thing that's happened to her all night and leans her whole weight on them. Saul, who trusts her nose over his own eyes, unbends: anyone she likes can't be all bad, and all's well.",
            failure: "Duchess takes the offering, and very nearly the hand with it, and sets up a baying fit to wake the river. Saul is on his feet with the lantern, staring hard into the dark.",
            onSuccess: "wharf",
          },
        },
        {
          id: "river-way", on: "attempt",
          when: "The player tries to get in from the river side the hard way: along the piles under the floor, up the hoist rope, or across the barge and in through the loading door.",
          check: { reason: "to climb into the Heron from the river side",
            skill: "athletics", dc: 14,
            success: "Cold, wet to the knees and very quiet, they come up through the river door in the shadow of the chute, and nobody looks round.",
            failure: "A pile is slimed with weed, or the hoist swings: they go into the river to the chest, and the cold drives the breath out of them. They're clinging to a pile under the floor, unseen for now, with Duchess barking somewhere overhead.",
            onSuccess: "floor",
          },
        },
        { id: "master-comes", on: "cue", when: "The player has been out on the wharf a long while (at least six exchanges at this point) without getting in, or is waiting to see who comes: the midnight bell, a smell of lavender along the wharf, and the Master arrives at the land door.", to: "midnight", establishes: [MASTER_HERE] },
      ],
    },
    {
      id: "floor",
      title: "The re-sacking floor",
      direction: "The player is inside the Heron. The proof is in plain sight: the gang slitting the palace's wheat-ear sacks and pouring the King's grain into heron sacks, the chute down to the barge, the heap of empties waiting for the river, and Mister Scrope up in his counting-box entering every sack in the true book. This beat is for getting proof: seeing it, taking the book, or finding people who'd swear to it. Anyone who isn't gang and gets noticed is challenged, and Hep, Scrope and the gang react as they would. Hobb, if he's here, is on the hoist and can't look at anyone. The clock is the midnight bell: Hep wants the count done before the Master comes, and Scrope keeps looking at the land door.",
      cast: {
        hep: "You want forty more sacks down before the bell. Put idle hands to work, and challenge anyone who won't take a sack.",
        scrope: "Count, enter, blot, apologise. Keep your hand on the book.",
        hobb: "If you're here, work the hoist one-handed and don't look at the player.",
        kell: "If you're inside, watch and remember. If you're on the wharf, keep it.",
        saul: "Keep the land door, and get up at the bell.",
      },
      pressure: "Hep bellows the count: forty to go before the Master. Scrope wipes his pen and looks at the land door. One of the gang, a sack on his shoulder, stops and looks at the player for a long moment.",
      transitions: [
        bookInHand("floor"), bookRead("floor"),
        {
          id: "lift-book", on: "attempt",
          when: "The player tries to lift the true book from under Scrope's hand without him or the gang seeing.",
          check: { reason: "to lift the ledger from under the clerk's hand",
            skill: "sleight_of_hand", dc: 15,
            success: "Scrope turns to trim the lamp, and when he turns back his hand comes down on bare desk. The book is under the player's coat.",
            failure: "Scrope's hand clamps down on the book with a squeak like a trodden mouse, and heads turn all over the floor.",
            onSuccess: "floor",
          },
        },
        {
          id: "win-scrope", on: "attempt",
          when: "The player tries to persuade Scrope to give them the true book or to swear to it (for Prout's sake, for his own neck, for the King), where his terror of the Master could still win. (Proof that puts it beyond doubt for him needs no dice.)",
          check: { reason: "to persuade the clerk to give up his ledger",
            skill: "persuasion", dc: 14,
            success: "Scrope looks at the book for a long time, then closes it, does up the clasp and holds it out in both hands. 'It balances,' he says. 'Every page. Wendell would want it to balance.'",
            failure: "Scrope hugs the book to his chest and shakes his head, white as paper: not with the Master coming. He hasn't called for anyone. Yet.",
            onSuccess: "floor",
          },
        },
        {
          id: "talk-down", on: "attempt",
          when: "Challenged on the floor (by Hep, the gang or Scrope), the player tries to bluff that they belong here.",
          check: { reason: "to bluff your way through a challenge on the floor",
            skill: "deception", dc: 13,
            success: "Whoever challenged them grunts, satisfied, and goes back to work.",
            failure: "Nobody believes a word. Hep shouts for hands, and the gang put their sacks down.",
            onSuccess: "floor",
          },
        },
        { id: "seized", when: "The player has been caught out on the floor and is being held (by Hep's gang, Saul or Hobb) to wait for the Master.", to: "midnight", establishes: [MASTER_HERE] },
        fight,
        { id: "master-comes", on: "cue", when: "The player has been inside a good while (at least five exchanges at this point), or is lying low and waiting: the midnight bell, lavender on the air, and the Master comes in at the land door.", to: "midnight", establishes: [MASTER_HERE] },
      ],
    },
    {
      id: "midnight",
      title: "The Master comes",
      direction: "Master Sallow is here, a minute behind his lavender, with his lantern-boy and the Crakes: in at the land door to see the last sacks down, take his share and initial tonight's page in the true book. Everything on the floor changes: the gang work faster and quieter, Scrope stands, Saul holds the door, Duchess growls, and Hobb (if he's here) can't look at anyone. If he has been warned, he's sharp and hurried, wants the book aboard the barge, and has the Crakes look along the wharf. If he finds the player held, or finds them at all, he deals with them his way: his office first, then money, then the Crakes and the river. This is the climax: hide and watch him sign, catch him in the act before witnesses who'll swear (Kell, Hep's gang, Scrope, Hobb), take the book from under his nose, bluff him, or be caught by him. The barge goes at the second bell, whoever has said what.",
      cast: {
        sallow: "You want the barge loaded, the page initialled and your share in your purse. Find fault with something. If you find intruders: papers, then money, then the Crakes. Keep the book out of their hands.",
        kell: "This is the investigator's case and their moment: back their play. You can arrest Sallow if you see him take the King's grain, by the book and out loud, and you will when the investigator calls for it or plainly gives you the moment; never over their plan or instead of it. If they mean to slip away with the proof, go with them. If you're on the wharf, come at their signal or the first shout.",
        hep: "Keep the gang working and your head down, and watch who looks likeliest to keep your gang off the gallows.",
        scrope: "Present the book to the Master with shaking hands.",
        hobb: "If you're here, you can't look at the Master, or at the player.",
        saul: "Hold the land door for the Master, and keep Duchess off his ankles.",
      },
      pressure: "Sallow takes out his watch: the ebb won't wait. He orders the last sacks down and the hatches battened, and out on the river the bargees start singling up their lines.",
      transitions: [
        {
          id: "in-the-act",
          when: "Sallow has been caught at the loading of the King's grain before witnesses who will swear to it (Kell, Hep's gang, Scrope, Hobb or the player), and Kell has arrested him, or he has been seized and is being held for her.",
          to: "caught-in-the-act",
        },
        bookInHand("midnight"), bookRead("midnight"),
        { id: "book-gone", when: "The true book has been destroyed: thrown in the brazier and burned, or gone into the river.", to: "midnight", establishes: [BOOK_GONE] },
        {
          id: "bluff-sallow", on: "attempt",
          when: "The player tries to fool Sallow to his face: passing as the Saltmere factor's agent, a buyer, someone sent from the palace, or one of the gang.",
          check: { reason: "to fool Master Sallow",
            skill: "deception", dc: 15,
            success: "Sallow believes it, for now, and treats them as what they claimed to be: he may even initial the page in front of them, or hand them the book to admire.",
            failure: "Sallow smiles thinly: he knows a liar, having been one professionally for years. 'Crake,' he says, and both of them move.",
            onSuccess: "midnight",
          },
        },
        {
          id: "face-down", on: "attempt",
          when: "The player confronts Sallow in front of his own people to break his nerve: naming the murder, the grain, the proof, the gallows.",
          check: { reason: "to break Sallow's nerve in front of his own people",
            skill: "intimidation", dc: 15,
            success: "The courtesy cracks. Sallow goes the colour of tallow and offers money too fast, and his own people see it: the gang stop working, and the Crakes look at each other.",
            failure: "Sallow hears them out with polite boredom, then says, 'Regrettably, the wharves are dangerous at night,' and the Crakes start forward.",
            onSuccess: "midnight",
          },
        },
        {
          id: "turn-witnesses", on: "attempt",
          when: "The player tries to turn Hep and her gang, Scrope or Hobb against the Master in front of him, so that they'll swear to what they've seen.",
          check: { reason: "to turn the Master's own people against him",
            skill: "persuasion", dc: 14,
            success: "Hep looks at her gang, then at the Master, and puts down her knife. 'We'll swear,' she says. 'All of us. For them.' One by one, the gang stand behind her.",
            failure: "Nobody moves: for now they're more frightened of him than of the gallows. Sallow smiles.",
            onSuccess: "midnight",
          },
        },
        {
          id: "snatch-book", on: "attempt",
          when: "The player makes a grab for the true book while Sallow or the Crakes have it, or as it goes towards the brazier, the river or the barge.",
          check: { reason: "to snatch the true book before it's lost",
            skill: "acrobatics", dc: 14,
            success: "They have it, singed or wet but whole, and everyone in the Heron is looking at them.",
            failure: "Sallow is quicker than he looks: the book goes into the brazier, over the side or down the chute, and it's going fast.",
            onSuccess: "midnight",
          },
        },
        { id: "overpowered", when: "The player has been overpowered and thrown in the river, or shut up somewhere in the Heron, by the Crakes or the gang, and nobody has got them out.", to: "caught" },
        { id: "cornered", on: "outcome", when: "Sallow, exposed with proof in front of witnesses he can't buy, has drawn the sword from his cane and set the Crakes on the player: blades are out and the fight has started.", to: "fight" },
        fight,
        { id: "cast-off", on: "cue", when: "The Master has been here a good while (at least six exchanges at this point), or the player is still hiding, waiting or dithering: the second bell, the last sacks go down, and the barge casts off on the ebb with the King's grain aboard.", to: "barge-sails" },
      ],
    },
  ],
  anytime: [
    { id: "away-with-book", on: "attempt", when: "The player leaves the Heron with the true book in their hands (out of a door, off the wharf, or over the side into the dark) and nobody is holding them.", to: "proof-taken" },
    { id: "ablaze", when: "Fire has taken hold of the Heron: a naked light in the grain dust, a brazier knocked over, a diversion got out of hand.", to: "up-in-smoke", establishes: [FIRE] },
    { id: "sunk", when: "The barge is going down with the King's grain in her: holed, swamped, or cut loose and swept onto the piers.", to: "up-in-smoke", establishes: [SUNK] },
    { id: "give-up", on: "attempt", when: "The player gives up and leaves the wharf without the proof, leaving the Heron to its night's work.", to: "barge-sails" },
  ],
  exits: [
    {
      id: "proof-taken", kind: "progress", title: "Out with the true book",
      next: "kings-morning",
      outcome: "The player has got out of the Heron alive with the true book: every 'lost' wagon by its Granary Roll number, with Sallow's initials on every page. Whatever becomes of the barge, the proof is in their hands.",
      closing: "Close on the player in the dark with the book under their arm: the Heron's lanterns behind them, the river running, and whoever is with them. Let Kell read one page by whatever light there is and say something dry that is very nearly triumph.",
      script: (world, outcome) => {
        world.player.addItem(world.newReadable(trueBookItem));
        world.setFlag("true_book", "taken");
        world.quest("heron-ledger").complete("Came out of the Heron warehouse with its true book.");
        world.quest("purveyors-man").advance("proof", "The Heron's true book, initialled 'J.S.' on every page, ties Master Sallow to the King's 'lost' grain. The case can go to the King.");
        world.character("kell").remember("The investigator came out of the Heron with the true book: every 'lost' wagon, initialled J.S.");
        if (has(outcome.established, MASTER_HERE)) world.character("sallow").remember("The King's investigator walked out of the Heron with the true book.");
        world.journal("We have the Heron's true book. Every page is initialled J.S.");
      },
    },
    {
      id: "caught-in-the-act", kind: "progress", title: "Caught in the act",
      next: "kings-morning",
      outcome: "Master Sallow has been caught at the Heron with the King's grain, before witnesses who'll swear to it, and Kell has arrested him (or he's being held for her) for theft from the Crown, and for Prout's murder if the proof will stretch that far.",
      closing: "Close on the arrest done by the book: Kell's proper words, Sallow's courtesy curdling into threats, the gang watching, Duchess growling at his ankles, the lavender. Land it on the player.",
      script: (world, outcome) => {
        const sallow = world.character("sallow");
        sallow.moveTo("watch-house");
        sallow.setAttitude("hostile", "Caught at the Heron with the King's grain by the King's investigator and a sergeant of the watch.");
        world.character("kell").remember("She arrested Master Josiah Sallow at the Heron warehouse, caught with the King's grain.");
        keepBook(world, outcome);
        bookFlag(world, outcome);
        world.quest("purveyors-man").advance("sallow_arrested", "Master Sallow was caught at the Heron warehouse with the King's grain, and Sergeant Kell arrested him.");
        world.quest("heron-ledger").complete("Caught Master Sallow at the Heron with the King's grain.");
        world.journal("We caught Sallow at the Heron with the King's grain, and Kell arrested him.");
      },
    },
    {
      id: "caught", kind: "other", title: "The wharves are dangerous at night",
      next: "kings-morning",
      outcome: "The player was caught at the Heron and has been thrown in the river or locked up in the warehouse by the Master's people, and the night's work goes on without them. They're alive, and they keep what they saw, and anything the Crakes didn't find on them.",
      closing: "Close on the cold: the black river closing over their head and the wharf lights sliding away, or a bolted door, grain dust settling and the sound of hatches going on. Leave them one thread to pull another night: something seen, something held, something overheard.",
      script: (world, outcome) => {
        const sallow = world.character("sallow");
        sallow.setAttitude("hostile", "The King's investigator got into the Heron and saw too much.");
        sallow.remember("He had the King's investigator thrown out of the Heron the hard way.");
        bookFlag(world, outcome, { lostIfCaught: true });
        world.quest("heron-ledger").advance("caught", "Caught at the Heron by Master Sallow's men and got rid of the hard way.");
        world.journal("Caught at the Heron. We're alive, which is something.");
      },
    },
    {
      id: "up-in-smoke", kind: "other", title: "Up in smoke",
      next: "kings-morning",
      outcome: "The Heron is burning (grain dust goes up like gunpowder) or the barge has gone down with the King's grain in her. Whatever the player didn't carry out is gone, the whole waterfront is awake, and on the eve of the Assembly somebody is going to have to explain it.",
      closing: "Close on the spectacle, played absolutely straight: the light on the water, the bells, bargees swearing in Saltmere, Saul hauling Duchess clear, the Master's lavender lost in the smoke. Kell, soot on her notebook, says what she'll have to write.",
      script: (world, outcome) => {
        if (has(outcome.established, FIRE)) {
          world.place({ asset: world.assets.get("smoke-plume"), at: world.anchor("heron-floor") });
          world.unsupported("The Heron warehouse burned down on the eve of the Assembly, with the King's grain in it.");
        }
        if (has(outcome.established, SUNK)) world.unsupported("The Saltmere barge Patience sank at the Heron's wharf with the King's grain in her.");
        keepBook(world, outcome);
        world.setFlag("true_book", bookSaved(outcome) ? "taken" : "burned");
        world.character("kell").remember("The Heron went up in smoke (or its barge went down) on the eve of the Assembly, with the investigator in the middle of it. She'll have to write it up.");
        if (bookSaved(outcome)) world.quest("heron-ledger").advance("up_in_smoke", "The Heron's grain is gone, but the true book came out with us.");
        else world.quest("heron-ledger").fail("The Heron's grain and its true book went up in smoke or down in the river.");
        world.journal("The Heron's night ended in fire and water, and all Caerwyn saw it.");
      },
    },
    {
      id: "barge-sails", kind: "leave", title: "The barge sails",
      next: "kings-morning",
      outcome: "The Patience has cast off on the ebb with the King's grain aboard (and anything Sallow sent with her), and is away downriver into the dark. By morning the Heron will be swept and empty. Whatever the player holds, they hold; the rest is gone.",
      closing: "Close on the barge's stern lantern dwindling down the black river, the bargees singing, and the Heron's doors swinging shut. Let Kell say one dry thing, and leave the player on the wharf with whatever they have.",
      script: (world, outcome) => {
        keepBook(world, outcome);
        bookFlag(world, outcome);
        if (!bookSaved(outcome)) world.quest("heron-ledger").fail("The Patience sailed with the King's grain before we could stop her.");
        world.journal("The Patience sailed on the ebb with the King's grain aboard.");
      },
    },
    {
      id: "fight", kind: "combat", title: "Roll for initiative",
      next: "kings-morning",
      outcome: "A fight breaks out in the Heron between the player (and Kell, if she's with them) and Master Sallow with his sword-cane and the Crakes (or Hep's gang, if Sallow hasn't come yet), in the grain dust and the swinging lantern light.",
      closing: "Close on the moment the blades come out: Sallow's cane sliding apart into a thin bright sword, the Crakes rolling their shoulders, the dust in the lantern light, the lanterns swinging dangerously close to it, and anyone with any sense stepping smartly out of the way. End with 'Roll for initiative!'",
      script: (world, outcome) => {
        world.startCombat({
          enemies: has(outcome.established, MASTER_HERE)
            ? [{ asset: world.assets.get("bandit"), count: 2, leader: "sallow" }]
            : [{ asset: world.assets.get("bandit"), count: 6, leader: "hep" }],
          allies: ["kell"],
          at: world.anchor("heron-floor"),
        });
      },
    },
  ],
  essentials: [
    {
      id: "way-in",
      what: "There's a way into the Heron without a key: the river door opens to anyone who shows a brass heron token at its grille; Saul at the land door is deaf on his left side and takes to whoever Duchess takes to; and Hep's gang is short-handed and puts anyone carrying a sack to work.",
      placedWith: ["Hobb's token, or Hobb himself", "Saul and Duchess at the land door", "Hep shouting for hands at the river door"],
      carriers: ["hobb", "saul", "hep"],
      unlocks: "getting inside",
    },
    {
      id: "kings-grain",
      what: "The Heron's grain is the King's: the gang are slitting sacks stamped with the palace wheat-ear and pouring them into heron sacks, and the empties are waiting to go in the river weighted with stones.",
      placedWith: ["the re-sacking floor", "the heap of empty wheat-ear sacks", "a sack split on the hoist"],
      carriers: ["hep", "hobb"],
      unlocks: "proof in plain sight, and witnesses who've handled it",
    },
    {
      id: "true-book",
      what: "Mister Scrope's true book, up in the counting-box, records every 'lost' wagon by its Granary Roll number with Sallow's initials on every page, and the Master comes at the midnight bell to initial tonight's.",
      placedWith: ["Scrope in his counting-box", "Hep, who wants the count right before the Master comes", "Hobb", "Saul, who must have the land door open for the Master at the bell"],
      carriers: ["scrope", "hep", "hobb", "saul"],
      unlocks: "the proof, and the moment to catch Sallow in the act",
    },
  ],
  limits: [
    "More help (constables, the river watch, the Watch Captain, the palace guard): the whole watch is lining the Assembly route through the night, and the Captain takes his orders from the Purveyor's office. Kell's whistle brings Kell. The help here is Kell, and whoever at the Heron can be turned.",
    "A warrant, a search order or anything in writing from the King: the palace is shut for the Assembly eve, and the King signs nothing that might upset anyone. What there is, is a sergeant who may arrest anyone she sees committing a crime.",
    "Another way into the Heron (a secret passage, a cellar, the roof): there's the land door, the river door and the loading hatch over the barge, and that's all. The roof is steep wet slate with no way in, and under the floor there's only the river.",
    "Holding the barge in port by law (harbour dues, an impound order, the harbourmaster): the harbourmaster's office is shut for the Assembly, and the bargees have a bill of lading from the Heron that says 'condemned grain, lawfully sold'. Stopping the barge means stopping it with hands.",
    "The bargees (Saltmere river-folk aboard the Patience): they speak little Caerwyn, care about the tide and nothing else, and won't hold it for anyone. They don't know or care whose grain it is.",
    "The Saltmere factor who buys the grain: he never comes to Caerwyn. The heron mark is his, and that's all there is of him tonight.",
    "Following the barge once she's gone (a boat, the towpath): there's no boat to be had on the wharves on Assembly eve, and the towpath ends at the city wall. Once the Patience is out on the ebb, she's gone.",
    "Coming back tomorrow: the barge sails on the ebb at the second bell, and by morning the Heron will be swept and empty and the Assembly procession will fill the wharves. It happens tonight or not at all.",
  ],
  anchors: ["wharf", "land-door", "sentry-box", "plank-walk", "river-door", "heron-floor", "counting-box", "chute", "hoist", "barge", "river"],
  lore: ["Places/Heron Warehouse.md"],
  assumes: [
    "Tonight's loading at the Heron is still going on: the barge hasn't sailed or been stopped, and the true book is still in the Heron.",
    "Master Sallow is still free (not arrested, not fled the city) and still coming to the Heron at the midnight bell. (The player suspecting him, or even naming him to the watch, doesn't change that: only his arrest or flight does.)",
  ],
  overtaken: "kings-morning",
  world: heronWorld,
};
