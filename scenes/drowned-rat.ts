import type { Scene, Transition } from "../src/runtime/scene.ts";
import type { ItemSpec, SceneOutcome, WorldApi } from "../src/world/dsl.ts";
import { drownedRatWorld } from "./worlds/drowned-rat.ts";

/**
 * Scene two of the Purveyor's Man arc (docs/design/caerwyn-arc.md): hanged-clerk → drowned-rat →
 * heron-warehouse, chained by exit.next. The evening after Wendell Prout was found hanged, the player
 * and Sergeant Kell come down the river stairs after the big man with the bandaged hand, into a
 * dockside dive with posted house rules, a landlady who sells gossip by the measure and keeps a
 * cudgel called Manners, and a great many big men with bandages (it's the docks).
 *
 * Big Hobb Mallory, Sallow's frightened muscle, holds what the next scene needs: the loft, his
 * master, the Heron warehouse, the night routine and the river-door token. He can be won over, scared
 * off, tricked, taken in or turned. Other ways in: Nan's gossip (a gill, a half, a pint, never a
 * quart), Dilly Sparrow's card game, Arlo Quarry's challenge for the champion's chair, and Cob, Nan's
 * pot-boy for the night, who knows the big cove from the loft.
 *
 * Kell and Cob are written neutral to how the granary went: what they remember of the player comes
 * from the hand-off and their memories, not from these cards. Every ending chains into the Heron, so
 * each outcome says where Hobb is, what the player holds and whether Sallow has been warned.
 */

const IDENTIFIED = "The player has picked out Big Hobb Mallory, in the fireside corner, as the big man with the bandaged hand.";
const HERON = "The player knows that Hobb does night work at the Heron warehouse, at the downriver end of the wharves.";
const TALKED = "Big Hobb has broken and is telling the player what he knows: the loft, his master and the Heron.";
const TOKEN = "Hobb has handed over his brass river-door token for the Heron warehouse.";
const INSIDE = "Hobb has agreed to be the player's man inside the Heron tonight.";

const has = (facts: string[], fact: string) => facts.includes(fact);
const knowsHeron = (outcome: SceneOutcome) => has(outcome.established, HERON) || has(outcome.established, TALKED);

const tokenItem: Omit<ItemSpec, "content"> = {
  id: "heron-token", name: "Hobb's river-door token", kind: "key", asset: "key-iron",
  description: "A worn brass token on a greasy string, stamped with a heron. Shown at the grille of the Heron warehouse's river door, it lets the night gang in.",
};

/** The Heron is a lead once the player knows of it, however they came by it. */
function heronLead(world: WorldApi): void {
  world.setFlag("heron_known", true);
  world.quest("heron-ledger").start("The Heron Ledger", "Big Hobb Mallory works nights for a gentleman at the Heron warehouse, at the downriver end of the wharves. If the King's 'lost' grain goes anywhere, it goes through there.");
}

/** Hobb's token, if it changed hands before the scene ended. */
function keepToken(world: WorldApi, outcome: SceneOutcome): void {
  if (has(outcome.established, TOKEN)) world.player.addItem(world.newItem(tokenItem));
}

// Ways in to Hobb, open from the moment the player is at his table.
const winHobb: Transition = {
  id: "win-hobb", on: "attempt",
  when: "The player tries to talk Hobb into telling what he did and who he does it for, with an appeal, an argument, a bargain or a promise of protection, while he's still holding out and it could go either way. (Just asking isn't this; a kindness or a trade that truly answers his fear needs no dice.)",
  check: { reason: "to get Big Hobb to tell you what he did",
    skill: "persuasion", dc: 14,
    success: "Something gives. Hobb looks at his wrapped hand for a long moment and says, very quietly, 'I only held the rope.' The loft comes out first, haltingly; the rest will come as he's asked.",
    failure: "Hobb shakes his head and drinks, and his eyes go to the door: not here, not yet. He heard it, though, and he's closer to leaving.",
    onSuccess: "confession",
  },
};

const scareHobb: Transition = {
  id: "scare-hobb", on: "attempt",
  when: "The player tries to frighten Hobb into talking: threats, the noose, the watch, his mum, or looming over him.",
  check: { reason: "to frighten Big Hobb into talking",
    skill: "intimidation", dc: 15,
    success: "For a moment the player frightens him more than his master does, and the loft comes out in a terrified rush; the rest will come as he's asked. He won't forget who frightened it out of him.",
    failure: "His master frightens him more than anyone in this room. Hobb comes up out of his chair like a wall falling over and makes for the door.",
    onSuccess: "confession", onFailure: "on-his-feet",
  },
};

const trickHobb: Transition = {
  id: "trick-hobb", on: "attempt",
  when: "The player tries to fool Hobb: passing as sent by his master to check he's kept quiet, telling him his master has already sold him to the watch, or some other lie he might swallow.",
  check: { reason: "to fool Big Hobb into giving himself away",
    skill: "deception", dc: 13,
    success: "He swallows it whole and, in a panic, blurts out a piece more than they asked for (to prove he's kept faith, or to save his own skin), and he'll answer the next question too.",
    failure: "He sees through it, and that's the worst thing it could be: proof that people are asking. He's up out of his chair and making for the door.",
    onSuccess: "confession", onFailure: "on-his-feet",
  },
};

/** The Rat's own sport: elbows on the table, Nan referees. Open while Hobb is still in his chair. */
const armWrestle = (beat: string): Transition => ({
  id: "arm-wrestle", on: "attempt",
  when: "The player arm-wrestles someone in the Rat (Arlo for the champion's chair, a regular for a wager, or Hobb if he can be got to the table), elbows down and Nan refereeing, where it could go either way.",
  check: { reason: "to win an arm-wrestle in front of the whole Rat",
    skill: "athletics", dc: 14,
    success: "Their opponent's knuckles hit the table. The Rat roars, Nan pays out the wagers, and the regulars stop clamming up around whoever just did that. If it was Hobb, the rag tore loose as his arm went over: his right palm is skinned raw in a stripe straight across, like a rope burn, and he hides it at once.",
    failure: "Their own knuckles hit the table, and the Rat roars anyway. Their arm will ache till morning, whoever beat them is unbearable about it, and the room has a new story about the sergeant's friend. If it was Hobb, he won through his teeth with the bad hand, and the rag came loose: his palm is skinned raw in a stripe straight across, like a rope burn, and he hides it at once.",
    onSuccess: beat,
  },
});

const bell = (when: string): Transition => ({ id: "bell", on: "cue", when, to: "on-his-feet" });

export const drownedRat: Scene = {
  id: "drowned-rat",
  title: "The Drowned Rat",
  time: "evening",
  summary: "A dockside dive with house rules, a landlady who sells gossip by the measure, and a big frightened man with a bandaged hand.",
  setting: "Evening on the eve of the Centennial Assembly, halfway down the river stairs at Caerwyn's docks. Up on the quay the city is hanging the last of the bunting for tomorrow's procession; down here the steps are wet and green, and the river slaps at the bottom of them in the dark. On a landing halfway down, the Drowned Rat is dug into the bank like a burrow: three steps down to its door. Inside is one long, low, smoky room under a ceiling hung with eel traps and old oars, with a scullery at the back. A driftwood fire burns blue with salt in the corner. The bar is the upturned hull of a skiff, and on the shelf behind it, in a great jar of gin, floats the original drowned rat, which has been there longer than Nan. Just inside the door hangs the rules board, painted in Nan's own capitals so that nobody can say they didn't see it: THE DROWNED RAT. RULES OF THE HOUSE. 1. No credit. 2. No blades out. 3. No fighting indoors. 4. No watch on duty. 5. No singing before the ninth bell. 6. What's said in the Rat stays in the Rat. 7. Gossip sold by the measure. By order, N. Quill. Enforced by Manners. (Nan sees no contradiction between six and seven: the gossip is sold in the Rat.) Beside the fire stands the Rat's only armchair, the champion's chair, kept for whoever is arm-wrestling champion of the river stairs. Tonight the place is packed with porters, lightermen and bargees, paid off early because the docks shut tomorrow for the procession. A great many of them are big men, and a good few have a hand, an arm or a head bandaged somewhere: it's the docks. Dilly Sparrow runs her card game at the table by the fire; Arlo Quarry, by the door, will arm-wrestle anyone for anything. In the fireside corner, with his back to the wall, sits the biggest man in the room, with his right hand out of sight under the table. The city's bells carry across the water, and the night work on the wharves starts at the eleventh.",
  premise: "Can the player find the big man with the bandaged hand and get out of him what he knows (who he works for, what happened in the loft, the Heron warehouse and how to get in), and what becomes of Big Hobb when they do?",
  hook: "This morning a palace clerk, Wendell Prout, was found hanged behind the King's Granary. He had company the night he died: a gentleman with a silver-topped cane, and a big man with a bandaged hand. Sergeant Kell, the watch sergeant the King lent you, reckons a bandaged hand on a big man means rope burn, and rope burn means a porter; and the porters who do night work for gentlemen drink at the Drowned Rat, halfway down the river stairs. It's evening on the eve of the Assembly. She has come with you, in a borrowed coat over her uniform that fools nobody.",
  background: [
    "This is the evening of the day Wendell Prout was found hanged behind the King's Granary. What the player and Kell found there, and how they left it, is in what happened just before this scene, and that wins. If nothing happened before: they know a gentleman with a silver-topped cane (the granary children's 'Silvertop') and a big man with a bandaged hand were in the tally loft the night Prout died, and they've come looking for the big man.",
  ],
  opening: "Hours have passed since the granary: it's dusk on the eve of the Assembly, and the trail of the big man with the bandaged hand has brought the player and Kell down the river stairs. Open at the Rat's door: the bunting on the quay above, the river slapping at the foot of the stairs, the din inside. As they step down into the room the din drops by half: the regulars have made Kell for watch before she's through the door (it's the boots). Show what a first glance would, by look rather than by name: the long smoky room, the rules board just inside the door, a small square landlady behind the bar with a cudgel to hand, an ancient bargewoman dealing cards by the fire, a young lighterman by the door with his elbow on a table, a great many big men with a great many bandages between them, and the biggest of them all in the fireside corner, back to the wall, one hand out of sight. Nobody gets a name until someone says it, and Cob stays out of it: he's in the scullery. End on Nan, with a look at the rules board, asking the sergeant whether she's on duty.",
  cast: [
    {
      id: "hobb",
      name: "Big Hobb Mallory",
      statblock: "tough", weapon: "unarmed-strike",
      look: "A dock-porter the size of a door: a head like a bollard, a nose broken more than once, shoulders that fill the corner, a leather porter's hood pushed back. His right hand is wrapped in a tarry rag, and he keeps it under the table. A greasy string round his thick neck disappears into his shirt.",
      voice: "Slow, low and polite: 'sir', 'missus', 'Mrs Quill'. Says as little as he can, then far too much all at once. When frightened he goes very quiet and very still, like a dray-horse in thunder.",
      wants: "To forget last night. Not to hang. To get through tonight's loading without his master looking at him. For his mum in the Shambles never to know.",
      fears: "His master, who has told him how patient the river is with men who talk. The noose, and the watch who'd put him in it. His hand being seen. What he did.",
      knows: [
        "He's Hobb Mallory, porter, champion of the Rat at the arm-wrestling these eleven years. He won't wrestle tonight and won't say why.",
        "He has a night job for a gentleman that pays double, in new silver. He'll own to that much, and not to what it is.",
        "He's due at work at the eleventh bell. If he isn't there when his master comes, his master will know something's wrong.",
      ],
      secrets: [
        "'I only held the rope.' He was in the granary tally loft last night when the clerk died, and he hauled the clerk up on the sack hoist after: that's where his palm went. That comes out first, and then he stops dead, with the room listening and a sergeant writing. The rest needs somewhere the Rat can't hear (the scullery, the stairs, a quiet corner), or a reason to tell that outweighs his fear.",
        "His master, 'the Master' (never to his face), took him there 'to have a word with a clerk'. The clerk wouldn't give up a page he'd cut from the big book. The Master struck him with the head of his cane and strangled him with a cord while Hobb held his arms, then had Hobb haul him up 'so it looks like he did it himself'. Hobb has been sick twice since. He gives the Master's name, Master Sallow of the Royal Purveyor's office, only when asked for it straight, and in a whisper.",
        "At first light the Master went back to look, and paid a granary girl a silver crown to say she'd seen the clerk jump.",
        "He works nights at the Heron warehouse, at the downriver end of the wharves, where the work is re-sacking ('It's the King's grain, sir. Everyone knows. Nobody says.'). Tonight's a loading night, a barge for Saltmere, and the Master comes at the midnight bell to see it off. He's due on the hoist at the eleventh.",
        "His way in is a brass heron token on the string round his neck, shown at the grille of the river door off the plank walk. He knows his own part of the night and little else: the hoist, the door, the bell. The watchman, the clerk's book and how the rest of it works are for whoever goes there to find out.",
        "He'd give a great deal to put it right, and can't see how: the watch would hang him and the Master would drown him.",
      ],
      attitude: "Polite, slow and closed: he wants to be left alone with his drink. No fighter unless cornered, and then a door falling on you. More frightened of his master than of anyone in this room, until someone gives him reason to be otherwise. Kindness is harder for him to bear than threats, because it makes him want to tell.",
    },
    {
      id: "nan-quill",
      name: "Nan Quill",
      statblock: "tough", weapon: "club",
      look: "A small, square woman of sixty with forearms like hams, a man's flat cap pinned to her grey bun and a leather apron with a coin pouch on it. Behind the bar, on two nails, hangs Manners: a blackthorn cudgel polished by use. Beside it, on hooks, a row of pewter measures from a gill to a quart, which she uses for beer and gossip alike.",
      voice: "Flat, unhurried river-stairs talk. Speaks in rules and prices and quotes rule numbers. Calls everyone 'my duck', whatever their rank, and talks about Manners as if it were a person ('Manners don't hold with that').",
      wants: "A full, paying, peaceful house on the busiest night of the year; her rules kept; nobody's blood on her floor; and a fair price for what she knows.",
      fears: "Losing the Rat: the river watch shutting her down, a fire, or a gentleman's kind of trouble coming down the stairs. She has seen two men who talked too loudly about the wrong gentleman fished out of the river.",
      knows: [
        "She enforces the house rules to the letter: one warning for small things (a raised voice, a threat, a song before the ninth bell), and none for a fist or a blade. Nobody is stopped at her door; outside it is the river's business.",
        "Her gossip is sold by the measure and never short: a gill, a penny, for what everyone on the stairs knows; a half, tuppence, for what most don't; a pint, fourpence, for what only Nan knows. She doesn't sell quarts: a quart'll get you drowned. Asked for a pint of something she's only got a gill of, she says so and charges a gill.",
        "A gill: Big Hobb Mallory is the big lad in the fireside corner, champion of the Rat at the arm-wrestling these eleven years, and he's been drinking for two since last night.",
        "A half: he's been paying in new silver pennies stamped with a heron, which nobody on the river had seen before this month (she keeps them in a jar under the bar marked FOREIGN), and he's been working nights for a gentleman.",
        "A pint: the gentleman's work is at the Heron warehouse, at the downriver end of the wharves; Hobb's due there at the eleventh bell, and tonight's a loading night, with a Saltmere barge in. And last night he went out before the midnight bells, which he never does, and came in tonight with his right hand in a rag he won't let her look at.",
        "Hobb sends his wages to his mum in the Shambles every week, without fail. That one's free; everybody knows it.",
        "Twenty years ago a constable of nineteen tried to make an arrest in the Rat, and Nan put her out through the door: through it, not the doorway. The constable was Agnes Kell. Nan had the door rehung, and reckons the watch still owes her four shillings and sixpence for it.",
        "Cob is her pot-boy on busy nights, for a penny and a bowl of eel stew. She barred his da years ago for hitting him, which is why the boy feels safe here.",
      ],
      secrets: [
        "The quart: the gentleman Hobb works for is Master Sallow of the Royal Purveyor's office, and the porters say the Heron's grain is the King's own, come the long way round. She won't sell it at any price, and won't say the name aloud in her own house.",
        "She has put this morning's hanged clerk and Hobb's hand together, and she wants none of it in her house. She's fond of Hobb in her way (he's carried her barrels since he was Cob's size), and she'd sooner see him taken quietly up the stairs by the watch than see the gentleman's sort come asking for him in here.",
      ],
      attitude: "Even-handed and unimpressed: anyone who keeps the rules and pays is welcome, and nobody gets more than their money's worth. Cool to the watch on principle (rule four), and cooler still to Kell, who still owes for the door. Respects people who respect the house.",
    },
    {
      id: "kell",
      name: "Sergeant Agnes Kell",
      statblock: "guard", weapon: "club",
      look: "Forties, in a borrowed brown coat over her watch uniform that fools nobody (it's the boots, and the way she stands). A battered oilcloth notebook and a pencil stub she sharpens with a clasp knife; a truncheon she has never been seen to draw. Stands very still and watches people's hands.",
      voice: "Dry, calm, precise and sparing: short sentences, the odd 'Noted.' Calls the player 'investigator'. Finds them funny and lets a joke land with a twitch of the mouth, then steers back with a question. Taps her pencil on the notebook when time is being wasted.",
      wants: "To find out who really killed Wendell Prout and write it down true, whatever the Captain's book says; tonight, to find the big man with the bandaged hand and hear what he knows before he drinks it away or somebody shuts his mouth for good. If anyone is sitting in a cell for Prout who shouldn't be, to get them out.",
      fears: "Putting a wrong name in her notebook. A witness who could hang a gentleman ending up in the river. Being the sergeant who let a murder stay a suicide.",
      knows: [
        "Since the morning she has kept at Prout's case on her own account: a granary porter told her, for the price of a pie, that a big dock-man with a bandaged right hand was seen at the granary in the night with a gentleman's lantern. Rope burn across a palm is a porter's wound, or a hoist man's, and the porters who do night work for gentlemen drink at the Drowned Rat.",
        "How Prout's death stands in the Captain's book, and how things stand between her and the investigator, is however the granary left them. Either way it's her case, and she means to finish it.",
        "The river stairs aren't her patch. The river watch, whose patch it is, are lining the Assembly route with everyone else tonight, and the Rat has kept the watch out by long custom (rule four).",
        "Twenty years ago, as a constable of nineteen, she tried to arrest a pickpocket in the Rat, and Nan Quill put her out through the door. She hasn't been back. She has been told she owes for the door.",
        "She can arrest a man for murder on real evidence (his own admission, a witness who saw him, a wound that matches) and take him to the watch-house cells. She'd do it by the book, outside Nan's door: an arrest is watch on duty.",
        "Nobody can take this to the King tonight: the palace is shut for the Assembly eve.",
      ],
      secrets: [
        "Three days ago Prout came to the watch house and asked her how a clerk reports 'false entries in the King's rolls', and whether the watch could arrest 'a gentleman of the Purveyor's office'. She told him to take it to the palace and forgot him until this morning. It's why this one matters to her. If it came out at the granary, it's no secret now.",
      ],
      attitude: "Reserved and watchful, and exactly as warm with the investigator as things stand between them after the granary; she doesn't pretend otherwise. Off her patch and conspicuous, she keeps still and lets the investigator lead. She notices things (a hand, a flinch, a coin) and asks the investigator what they make of them rather than saying it for them. She won't lie: asked if she's on duty, she says she's lent, which is true. She won't arrest on a hunch, and asks 'On what evidence?' before she arrests anyone. She'll step outside if the investigator wants her out of the way, and she steps in, once and firmly, if anyone hurts a child or a man who can't fight back.",
    },
    {
      id: "cob",
      name: "Cob",
      statblock: "commoner", weapon: "unarmed-strike",
      look: "A scrawny boy of about eleven in a man's waistcoat, with a pot-boy's sacking apron over it that reaches his ankles. On his feet, either Prout's good black clerk's boots, three sizes too big and laced on with string, or nothing much, depending on how the morning went. Scabbed knuckles, a yellowing bruise on one cheek, a tray of empty pots.",
      voice: "Loud and cocky, and talks about himself in the third person ('Cob don't talk to bluebottles'). Foul-mouthed in an inventive gutter way (sod off, bleedin', bum-faced palace pigeon) but never truly obscene. Brags, mocks and dares; goes very quiet and very young when he's frightened.",
      wants: "Respect, and to be left alone. Something to eat: Nan pays her pot-boy in eel stew and a penny. Never to go home to his da. Moll safe, wherever the morning left her. And the big cove from the loft to get what's coming to him, without ever finding out Cob was there.",
      fears: "The big cove by the fire, and the gentleman he works for. His father. Being sent to the Mending House. Being called a liar.",
      knows: [
        "He's Nan's pot-boy tonight. Whether he came for the stew or because he's been tailing the investigator since the granary, he won't say.",
        "The Rat is the one place in Caerwyn his da can't come: Nan barred him for hitting Cob.",
        "Everybody on the river stairs knows Big Hobb: champion of the Rat at the arm-wrestling, never been beaten.",
      ],
      secrets: [
        "Big Hobb is the big cove from the loft last night. Cob knew him by the lantern light (the size of him, and his voice saying 'Yes, Master'), and he's seen him in here for years. He saw Hobb come in tonight and has been hiding in the scullery since. He'll tell it to someone he trusts, or point, from behind something; never where Hobb can see.",
        "He pinched one of Hobb's new silver pennies off the pot tray. It's got a heron on it, not the King.",
      ],
      attitude: "How he takes the investigator and the sergeant tonight is as things stand between them after the granary. Whatever that is, with the big cove in the room he's quieter and jumpier than he was, and sticks near the scullery door. Bought attention isn't trust: food or coin gets boasts and bargaining; respect, kindness or a laugh at his jokes gets real talk; only believing someone will keep him safe from the men gets what he knows. If grabbed, he bolts for the scullery. (If what happened before has him locked up in the watch house, he isn't here tonight: Nan has no pot-boy, and the scene doesn't need him.)",
    },
    {
      id: "arlo",
      name: "Arlo Quarry",
      statblock: "tough", weapon: "unarmed-strike",
      look: "A young lighterman built like a water butt, with rolled sleeves, a fresh black eye and forearms he keeps flexing. His elbow is on the nearest table at all times, in case.",
      voice: "Loud, cheerful and spoiling for it. Talks in challenges and wagers ('Penny says I'd have you'). Calls everyone 'champ', sarcastically. Goes quiet and sulky when he's laughed at.",
      wants: "The champion's chair, tonight, while Big Hobb won't wrestle. A champion who refuses three challenges in one night gives the chair up, by house custom, and Hobb is on two.",
      fears: "Being laughed at. Being thought yellow. Nan, who has already given him his one warning tonight.",
      knows: [
        "Hobb has been champion eleven years and has never refused a match until tonight. He keeps his right hand under the table.",
        "Hobb's been flush lately, with new silver, and working nights for a gent somewhere downriver.",
        "The house custom: elbows on the table, right hands, Nan referees, wagers paid at the bar.",
      ],
      secrets: [
        "This evening, at the pump on the stairs, he saw Hobb unwrap his right hand: the palm is skinned raw in a stripe straight across, like rope burn. He's saving it to shame Hobb with in front of the whole Rat if he refuses again.",
      ],
      attitude: "Friendly to anyone who'll wrestle him, back him or stand him a pint; scornful of the watch, and of anyone who drinks with it.",
    },
    {
      id: "dilly",
      name: "Dilly Sparrow",
      statblock: "commoner", weapon: "unarmed-strike",
      look: "A tiny, ancient bargewoman in a man's coat and three shawls, with a clay pipe, a pack of cards worn soft as cloth, and a pile of coppers and new silver in front of her. Her barge, the Dabchick, is tied up at the foot of the stairs.",
      voice: "Croaky, sly and motherly at once. Calls everyone 'my lamb'. Deals as she talks and never looks at her cards.",
      wants: "Her nightly game of Tuppenny Bargee and her winnings. Hobb to stop drinking like a man who's going to be hanged. Tonight, also, the watch to go away.",
      fears: "The watch finding the six casks of Saltmere brandy under the onions on the Dabchick. The river, which has had two husbands off her already.",
      knows: [
        "Hobb plays at her table every night, and since last night he's been playing like a man trying to lose: he's lost a pile of new silver to her, every penny stamped with a heron.",
        "He told her tonight he's due at work at the eleventh bell, 'at the Heron', and that he'd sooner be dead.",
        "She's fed him since he was a lad carrying Nan's barrels.",
      ],
      secrets: [
        "The brandy. She's certain the sergeant has come for it.",
      ],
      attitude: "Sweet as treacle to anyone who sits down and plays fair; flinty to the watch; protective of Hobb. Cheats only those who cheat.",
    },
  ],
  start: "the-rat",
  beats: [
    {
      id: "the-rat",
      title: "Rules of the house",
      direction: "The room has clammed up for the watch. This beat is for the Rat itself: Nan and her rules, the regulars, and a crowd of big men at a docks where everyone is bandaged somewhere. Let the player look about, answer Nan, buy a drink or a measure of gossip, sit in at Dilly's game, take Arlo up on a wager, or go straight for the biggest man by the fire. Play the rules absolutely straight: rule four makes Kell a problem the whole Rat expects someone to solve, and rule one means money on the bar. The regulars talk to anyone who keeps the house rules, plays, pays or wins, and dry up whenever Kell's notebook comes out. Hobb, meanwhile, is trying to be invisible, and he is the size of a door.",
      cast: {
        "nan-quill": "You want the rules kept and the newcomers paying. Point them at the board with Manners, ask the sergeant whether she's on duty, and remember the door. Sell what's asked for at the posted measure, and not a drop more.",
        kell: "Stand still and watch hands. Answer Nan truthfully. Let the investigator lead.",
        hobb: "You want to be invisible: back to the wall, right hand under the table, eyes in your pot. The door makes you flinch.",
        arlo: "You want Hobb's chair tonight: call him out for it, loudly, and wager with anyone who'll listen.",
        dilly: "Deal, win, and keep an eye on the sergeant and your casks.",
        cob: "You're Nan's pot-boy tonight, and you saw the big cove come in: you've been in the scullery since. Come out with your tray once the newcomers have been here a little while, and take them as things stand between you.",
      },
      pressure: "Arlo slaps his elbow down on Hobb's table and calls him out for the champion's chair in front of everyone. Hobb won't, and won't bring his right hand out from under the table, and the Rat starts to jeer.",
      transitions: [
        {
          id: "found-him",
          when: "The player has picked out Big Hobb as the big man they're after (by his hidden hand, Arlo's challenge, Nan's gossip, Cob, or the way he flinches at the door) and has gone over to him, sat down with him or spoken to him.",
          to: "big-hobb", establishes: [IDENTIFIED],
        },
        { id: "heron-learned", when: "The player has learned that Hobb does night work at the Heron warehouse downriver (from Nan's gossip, Dilly, the regulars, or the heron on the new pennies).", to: "the-rat", establishes: [HERON] },
        winHobb, scareHobb, trickHobb, armWrestle("the-rat"),
        bell("The player has been in the Rat a long while (at least eight exchanges at this point) without getting anywhere with Hobb, or is idling or going round in circles: the eleventh bell rings across the water, and Hobb gets up to go to work."),
      ],
    },
    {
      id: "big-hobb",
      title: "The big man by the fire",
      direction: "The player is at Hobb's table. He is drunk, frightened, guilty and polite, and he wants to be left alone with his pot: he says as little as he can and watches the door. He isn't a monster and he isn't a fool. He knows exactly what he did, and any mention of the loft, the granary, the clerk, a silver-topped cane or the name Sallow turns him grey and still. Kell's presence makes him sweat, because the watch hangs people. Whatever the player tries (drink, cards, kindness, fear, a trick, the arm-wrestling, his mum, a deal) gets a real reaction and some ground, but what he knows comes out only when something actually gets through to him: a reason to tell that outweighs his fear of his master, or a fright that does. The Rat carries on around them: Nan's rules, Arlo's challenge, Dilly's game, Cob somewhere with a tray.",
      cast: {
        hobb: "You want to get through this without saying anything and be at work by the bell. Deflect, drink, lose at cards. At any mention of the loft or your master, freeze.",
        kell: "Let the investigator work. Stay where Hobb can see you, or step away if asked. When he says something that matters, write it down where he can watch you do it.",
        "nan-quill": "You want the room civil: one warning for a raised voice or a threat, and Manners for a fist.",
        arlo: "You want your match. Push for it when it will hurt Hobb most.",
        dilly: "Look after Hobb in your fashion: deal him in, and tell the newcomers to let him be.",
        cob: "Stay out of Hobb's sight. If someone has your trust, find a way to tell them what you know without him seeing.",
      },
      pressure: "The tenth bell goes. Hobb counts his last heron pennies onto the table, looks at the door, and tells nobody in particular that he's due at work at the eleventh.",
      transitions: [
        {
          id: "hobb-breaks",
          when: "Hobb has broken and begun to tell what he did or who he does it for (the loft, his master, the Heron), however it came out: a kindness or a trade that answered his fear, a promise he believed, a fright, a trick he swallowed, or something put in front of him that he couldn't deny.",
          to: "confession", establishes: [TALKED],
        },
        { id: "heron-learned", when: "The player has learned that Hobb does night work at the Heron warehouse downriver (from Hobb, Nan's gossip, Dilly, the regulars, or the heron on the new pennies).", to: "big-hobb", establishes: [HERON] },
        winHobb, scareHobb, trickHobb, armWrestle("big-hobb"),
        bell("The player has been at Hobb a good while (at least six exchanges at this point) without him breaking, or is going round in circles: the eleventh bell rings across the water, and Hobb gets up to go to work."),
      ],
    },
    {
      id: "on-his-feet",
      title: "Out of his chair",
      direction: "Hobb is up and leaving, one way or the other: bolting in a panic because someone pushed too hard or too clumsily, or going to his night's work at the bell, as he must, because if he isn't at the river door when his master comes, his master will know something is wrong. This is a short, sharp moment: the door, the wet stairs and the dark are a few strides away. The player can let him go, follow him, stop him, or try one last time, and Kell will back a lawful arrest if there's evidence for one. Indoors, rule three holds; out on the stairs, it doesn't.",
      cast: {
        hobb: "You want out: up the stairs into the dark if you're bolting, down to the wharves if you're going to work.",
        kell: "If he's bolting and the investigator goes after him, go too. If he's going to work, ask the investigator, quietly, what they want done.",
        "nan-quill": "Nobody fights in your house. Outside is the river's business.",
      },
      pressure: "Hobb is through the door and onto the wet stairs, and in a moment he'll be gone.",
      transitions: [
        {
          id: "catch-him", on: "attempt",
          when: "Hobb is bolting, and the player goes after him to stop him: a tackle on the stairs, a grab at his coat, a sprint to cut him off.",
          check: { reason: "to catch Big Hobb before he's gone into the dark",
            skill: "athletics", dc: 13,
            success: "They bring him down on the wet steps, or pin him against the river wall. He doesn't fight. He sits there in the drizzle like a felled tree, and it starts coming out of him, the loft first.",
            failure: "He's faster than he looks and more frightened than they are: up the stairs, through the bunting and gone into the dark.",
            onSuccess: "confession", onFailure: "hobb-fled",
          },
        },
        {
          id: "last-word", on: "attempt",
          when: "Hobb is going to his night's work (not bolting), and the player makes one last real appeal to stop him and get him to tell what he knows, where it could go either way.",
          check: { reason: "to stop Big Hobb at the door and get the truth out of him",
            skill: "persuasion", dc: 14,
            success: "Hobb stops with his hand on the door. His shoulders go down. He comes back to the corner, sits, and says, 'I only held the rope.'",
            failure: "He shakes his head, says he's sorry, and goes out into the dark, down the stairs towards the wharves.",
            onSuccess: "confession", onFailure: "gone-to-work",
          },
        },
        { id: "sat-down", when: "Hobb has sat back down, or been talked back to his corner, without having told what he knows.", to: "big-hobb" },
        { id: "gone", when: "Hobb has gone out of the Rat to his night's work (not bolting) without telling what he knows, and the player has let him go or gone out after him to follow.", to: "gone-to-work" },
        { id: "got-away", when: "Hobb has bolted out of the Rat and away up the stairs into the dark, and nobody went after him, or they've lost him.", to: "hobb-fled" },
      ],
    },
    {
      id: "confession",
      title: "I only held the rope",
      direction: "Hobb is talking, or starting to. He begins where it hurts, with the rope, slowly and in pieces, wiping his face with his good hand, and he won't say more where the whole Rat can hear: the player has to find him somewhere quieter or give him a reason. The rest (his master, the Heron and tonight's loading, his token: see his secrets) comes out as the player asks for it, one thing per reply and in his own words. He knows only his own part of the night, so he doesn't brief anyone on the Heron. Answer what they actually ask, and never put questions in their mouth or run the interview for them. If he thinks he's talking to his master's people (a trick that worked), he tells it as proof he has kept faith, and it's the same truth. Kell writes it all down. When it's out, he asks what's to become of him: he's terrified of the noose and more terrified of his master, and he has to be at the river door at the eleventh bell or his master will know something is wrong. The beat ends on the player's choice: Kell takes him in, he goes to work (as their man inside, or keeping his head down), or he runs. Don't decide it for them.",
      cast: {
        hobb: "Tell the loft first, then answer what you're asked, one thing at a time. When it's out, ask what's to become of you. The token's only brass: give it up if asked.",
        kell: "Write it down. You have enough to take him in now, and you'll say so, once; whether you do it tonight is the investigator's call. If you do, it's by the book, outside Nan's door.",
        "nan-quill": "Keep the room off his back, and keep your ears open.",
        dilly: "Sit with him. Glare at anyone who frightened it out of him.",
        cob: "If you're near enough to hear, listen from behind something.",
      },
      pressure: "The eleventh bell rings across the water. Hobb gets to his feet, because he has to be at the river door when it stops.",
      transitions: [
        { id: "told-heron", when: "Hobb has told the player about the Heron warehouse: what goes on there, tonight's loading, or how to get in.", to: "confession", establishes: [HERON] },
        { id: "token-given", when: "Hobb has handed over his brass river-door token for the Heron (to the player or to Kell).", to: "confession", establishes: [TOKEN] },
        { id: "inside-man", when: "Hobb has agreed to help the player at the Heron tonight: to open the river door to them, keep the gang off them, or point out the clerk's book.", to: "confession", establishes: [INSIDE] },
        {
          id: "turn-hobb", on: "attempt",
          when: "The player tries to talk Hobb into going back into the Heron tonight as their man inside, where his fear of his master could still win. (A promise that truly answers his fear needs no dice.)",
          check: { reason: "to talk Hobb into being your man inside the Heron",
            skill: "persuasion", dc: 14,
            success: "Hobb swallows, nods and says he'll do it: he'll open the river door to their knock and keep the gang off them, for as long as his nerve holds.",
            failure: "He can't. He'll go to work, because not going would tell his master everything, but in there he'll keep his head down and pray; he won't lift a finger for them.",
            onSuccess: "confession",
          },
        },
        { id: "let-him-go", on: "attempt", when: "The player is done at the Rat: they leave with what Hobb told them, letting him go to his night's work (or taking him along), without having him arrested.", to: "hobb-talks" },
        { id: "hobb-runs", when: "Hobb's nerve has gone and he's bolting for the door (at the word 'arrest', or at the thought of his master).", to: "on-his-feet" },
        { id: "bell-talked", on: "cue", when: "The player has had Hobb's story a while (at least five exchanges at this point) without deciding what becomes of him: the eleventh bell, and Hobb has to go to work.", to: "hobb-talks" },
      ],
    },
  ],
  anytime: [
    {
      id: "taken",
      when: "Kell has arrested Big Hobb, on evidence she accepts (his own words, a witness to the loft, the rope burn set beside them), and is taking him out of the Rat for the watch-house cells.",
      to: "taken-in",
    },
    { id: "brawl", on: "attempt", when: "The player starts a real fight in the Rat (throws a punch, goes for someone to hurt them, draws a blade on someone), or breaks a house rule again after Nan's one warning.", to: "thrown-out" },
    { id: "thrown", when: "Nan has put the player out of the Rat with Manners and barred them.", to: "thrown-out" },
    { id: "walk-out", on: "attempt", when: "The player leaves the Rat without Hobb and without his story (giving up on him, or going to wait for him outside).", to: "gone-to-work" },
  ],
  exits: [
    {
      id: "hobb-talks", kind: "progress", title: "What Big Hobb knows",
      outcome: "Big Hobb has told the player what he knows (his master, the loft, the Heron warehouse and how to get in at night), and the player is leaving the Rat with it. Hobb isn't under arrest and hasn't run: he's going to his night's work at the Heron, as their man inside if he agreed to be, or keeping his head down if not.",
      closing: "Close on the player leaving the Rat with what they came for: Hobb's face as they go (or his broad back going down the stairs ahead of them at the bell), Nan's look, the river below. Kell closes her notebook on it.",
      next: "wharf-night",
      script: (world, outcome) => {
        const hobb = world.character("hobb");
        hobb.moveTo("heron-warehouse");
        hobb.remember("He told the King's investigator what happened in the tally loft, who his master is, and how to get into the Heron.");
        if (has(outcome.established, INSIDE)) world.promise({ by: "hobb", to: "player", what: "Open the Heron's river door to the player tonight and keep the gang off them." });
        keepToken(world, outcome);
        world.character("kell").remember("In the Drowned Rat, Big Hobb Mallory said he held Prout while Master Sallow killed him, and told us about the Heron warehouse. She wrote it all down.");
        world.setFlag("hobb_identified", true);
        heronLead(world);
        world.quest("purveyors-man").advance("hobb_talked", "Big Hobb Mallory says Master Sallow killed Prout in the tally loft and had Hobb hoist him; the stolen grain goes through the Heron warehouse.");
        world.journal("Big Hobb talked. The grain goes through the Heron warehouse, and tonight a barge is loading there.");
      },
    },
    {
      id: "taken-in", kind: "progress", title: "Taken in",
      outcome: "Sergeant Kell has arrested Big Hobb, on evidence she accepts, and is taking him up the river stairs to the watch-house cells. Whatever he told the player before he was taken, they have; he won't be at the Heron tonight.",
      closing: "Close on the arrest done by the book outside Nan's door: Kell's proper words, Hobb's great shoulders going down, the Rat silent behind them, the river below. Kell will see him locked up and come on to wherever the investigator is going next.",
      next: "wharf-night",
      script: (world, outcome) => {
        const hobb = world.character("hobb");
        hobb.moveTo("watch-house");
        hobb.remember("Sergeant Kell arrested him outside the Drowned Rat for the clerk's death, with the King's investigator there.");
        world.character("kell").remember("She arrested Big Hobb Mallory for Prout's murder outside the Drowned Rat and took him to the watch-house cells.");
        keepToken(world, outcome);
        world.setFlag("hobb_identified", true);
        if (knowsHeron(outcome)) heronLead(world);
        world.quest("purveyors-man").advance("hobb_arrested", "Big Hobb Mallory, the big man with the bandaged hand, is in the watch-house cells.");
        world.journal("Kell took Big Hobb in. He's in the watch-house cells tonight.");
      },
    },
    {
      id: "hobb-fled", kind: "other", title: "Hobb runs",
      outcome: "Big Hobb has run from the Rat and got away into the dark. Frightened out of his wits, he's gone where his feet always take him: to his master, to warn him that the King's investigator and a watch sergeant are asking about the loft. Whatever he told the player before he ran, they have.",
      closing: "Close on the empty doorway, the wet stairs and the dark; the Rat's silence, and Nan's look, which says whose fault that was.",
      next: "wharf-night",
      script: (world, outcome) => {
        const hobb = world.character("hobb");
        hobb.leaveScene("ran off down the river stairs towards the wharves, to warn his master");
        hobb.setAttitude("unfriendly", "The King's investigator frightened him out of the Drowned Rat.");
        hobb.remember("He ran from the Drowned Rat to warn Master Sallow that the King's investigator and a watch sergeant are asking about the loft.");
        world.setFlag("hobb_identified", true);
        world.setFlag("sallow_warned", true);
        if (knowsHeron(outcome)) heronLead(world);
        world.journal("Big Hobb ran from the Drowned Rat, and he'll have gone straight to his master.");
      },
    },
    {
      id: "thrown-out", kind: "other", title: "Manners",
      outcome: "Nan Quill has thrown the player (and anyone who sided with them) out of the Drowned Rat with Manners, and barred them. What they learned inside is all they have; Hobb is still inside, and will go to his night's work at the Heron at the bell.",
      closing: "Close on the wet river stairs outside the barred door, the din starting up again inside, and whatever the player is nursing (an ear, a shin, their pride). If Kell is out there with them, she says something dry about doors.",
      next: "wharf-night",
      script: (world, outcome) => {
        const nan = world.character("nan-quill");
        nan.setAttitude("unfriendly", "Broke the house rules in the Drowned Rat.");
        nan.remember("She threw the King's investigator out of the Rat with Manners, and barred them.");
        world.character("hobb").moveTo("heron-warehouse");
        if (has(outcome.established, IDENTIFIED) || has(outcome.established, TALKED)) world.setFlag("hobb_identified", true);
        if (knowsHeron(outcome)) heronLead(world);
        world.journal("Thrown out of the Drowned Rat by Nan Quill and her cudgel, Manners.");
      },
    },
    {
      id: "gone-to-work", kind: "leave", title: "Hobb goes to work",
      outcome: "Hobb has gone off to his night's work at the Heron without telling the player what he knows, and the player has left the Rat too: after him to follow, or before him to wait in the dark.",
      closing: "Close on Hobb's broad back going down the river stairs towards the wharves, his lantern swinging, and the player at the top of the steps in the dark.",
      next: "wharf-night",
      script: (world, outcome) => {
        world.character("hobb").moveTo("heron-warehouse");
        if (has(outcome.established, IDENTIFIED)) world.setFlag("hobb_identified", true);
        if (knowsHeron(outcome)) heronLead(world);
        world.journal("Big Hobb went off to his night's work at the bell without telling us what he knows.");
      },
    },
  ],
  essentials: [
    {
      id: "which-man",
      what: "Which of the Rat's many big men is the one: Big Hobb Mallory in the fireside corner, who keeps his bandaged right hand out of sight and won't arm-wrestle tonight.",
      placedWith: ["Hobb himself (the hidden hand, the flinch at the door)", "Arlo's challenge for the champion's chair", "Nan's gossip, a gill", "Cob, who knows him from the loft"],
      carriers: ["arlo", "nan-quill", "cob"],
      unlocks: "working on Hobb",
    },
    {
      id: "heron",
      what: "Hobb does night work for a gentleman at the Heron warehouse, at the downriver end of the wharves, paid in new silver pennies stamped with a heron; tonight's a loading night.",
      placedWith: ["Nan's gossip (a half and a pint) and her jar of heron pennies", "Dilly, who has won a pile of those pennies off him", "Cob's pinched penny", "Hobb"],
      carriers: ["nan-quill", "dilly", "cob", "hobb"],
      unlocks: "where the grain goes, and where Hobb goes at the bell",
    },
    {
      id: "way-in",
      what: "How to get into the Heron at night: the river door off the plank walk opens to a brass heron token shown at its grille (Hobb wears one round his neck), and the Master comes at the midnight bell to see a Saltmere barge off.",
      placedWith: ["Hobb, once he talks, and the token on the string round his neck"],
      carriers: ["hobb"],
      unlocks: "getting into the Heron tonight, and catching its master at it",
    },
  ],
  limits: [
    "Seeing the King, or getting a warrant or men from the palace tonight: on the eve of the Assembly the palace is shut to everyone but the procession rehearsal and the delegations' dinner, and the Captain takes his orders from the Purveyor's office. The gate guard will take a written message for the Marshal, and the King will see the investigator in the morning. Tonight it's the player and Kell.",
    "More watch (constables, the river watch, anyone to hold the stairs): the whole watch is lining the Assembly route through the night, the river watch with them. Kell is the watch here, off her patch.",
    "Credit, IOUs or 'the King will pay': rule one. Money on the bar, goods Nan will take at her own valuation, or nothing.",
    "Master Sallow himself, or anyone who'll say his name aloud for money: he wouldn't be seen dead on the river stairs, nobody in the Rat will say where he is, and Nan doesn't sell quarts.",
    "Another way out of the Rat, or a private room to talk in: it's one long room and a scullery. The only door opens onto the stairs; the scullery's slop hatch onto the river is just big enough for Cob, and the river under it is fast and cold.",
    "Going anywhere else tonight before the bell (Hobb's lodgings, the palace offices, the watch house for help): the trail is here, and at the bell it goes downriver with Hobb. His lodging is a room in the Shambles across the city, with his mum in it.",
    "Buying magic here (truth potions, charms, a hedge-wizard for hire): there's none to be had on the river stairs, and Nan sells gossip, not truth. (The player's own spells are theirs, and work as the rules say.)",
  ],
  anchors: ["river-stairs", "rat-door", "bar", "rules-board", "fireside-corner", "card-table", "champions-chair", "scullery", "slop-hatch"],
  lore: ["Places/The Drowned Rat.md"],
  assumes: ["The player hasn't already found Big Hobb Mallory, the big man with the bandaged hand, and got what he knows."],
  world: drownedRatWorld,
  overtaken: "wharf-night",
};
