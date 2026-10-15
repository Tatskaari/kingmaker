import type { Scene, Transition } from "../src/runtime/scene.ts";
import type { ItemSpec, SceneOutcome, WorldApi } from "../src/world/dsl.ts";
import { drownedRatWorld } from "./worlds/drowned-rat.ts";
import { KELL_PROMISES, KELL_VOICE, pageItem } from "./hanged-clerk.ts";

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
 * each outcome says where Hobb is, what the player holds and whether Sallow has been warned. A
 * confession that stops short of the Master's name is still a confession: Hobb owning to the loft
 * and going to his night's work ends on what he told them, wherever the scene had got to, and
 * whatever he owned to is in Kell's notebook as he said it, however the scene ends. Once he has owned
 * to the loft, the rest (the name, the Heron, the token) comes as he's asked, each ask a route with no
 * dice. His mum's safety, the thing that would turn him (he says so himself as he goes to work), can
 * be got for her tonight from someone in the room (Kell, for a night; Dilly's barge; Nan, who knows
 * every bolt-hole on the stairs), on a roll where it could go either way; however it's got, it opens
 * him up.
 *
 * If the granary didn't give up Prout's page, it's still sewn into the boot on Cob's feet, and the
 * boundary brings it over (src/runtime/owed.ts): then it's one of this scene's essentials, with ways
 * in true to Cob, who is the same boy about his boots as at the granary (a kindness with nothing asked
 * back, real trust, or a promise that answers his fear, out of Hobb's sight), Nan (whose word he'd
 * take) and a roll when a polite ask in the scullery could go either way. Found at the granary, none
 * of it is here.
 */

const IDENTIFIED = "The player has picked out Big Hobb Mallory, in the fireside corner, as the big man with the bandaged hand.";
const HERON = "The player knows that Hobb does night work at the Heron warehouse, at the downriver end of the wharves.";
const TALKED = "Big Hobb has broken and begun to tell the player what he did, the loft first: he held the clerk while his master killed him, and hauled the rope. The rest (his master's name, the Heron) comes as he's asked.";
const NAMED = "Big Hobb has named his master to the player: Master Sallow of the Royal Purveyor's office.";
const MUM_SAFE = "Hobb's mum is to be kept safe tonight: someone here has agreed to take her in, out of the Master's reach, and she'll be fetched from the Shambles before he thinks to look.";
const TOKEN = "Hobb has handed over his brass river-door token for the Heron warehouse.";
const INSIDE = "Hobb has agreed to be the player's man inside the Heron tonight.";
const KIND = "Cob has had a kindness from the player with nothing asked back (his dinner or an extra bowl stood him with no strings): it counts with him.";
const PAGE = "Prout's page is out of the lining of Cob's left boot: razored from the Royal Granary Roll, a dozen King's Road grain wagons marked 'lost to goblins', each countersigned 'J. Sallow, for the Royal Purveyor', with Prout's pencilled river-warehouse weights and, at the foot, 'Not goblins. Who pays the hedge-folk?'";

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

/**
 * What Hobb owned to, in Kell's notebook as he said it, however the scene ends (`always`: the ending
 * is his telling it, so it's there even if the record missed the moment he broke).
 */
function kellRecords(world: WorldApi, outcome: SceneOutcome, options: { always?: boolean } = {}): void {
  if (!options.always && !has(outcome.established, TALKED)) return;
  const master = has(outcome.established, NAMED) ? "Master Sallow" : "his master (he wouldn't say the name)";
  world.character("kell").remember(`In the Drowned Rat, Big Hobb Mallory owned that he held Prout's arms in the tally loft while ${master} killed him, and hauled the rope. It's in her notebook as he said it.`);
}

/** Hobb's mum, if someone here agreed to take her in tonight. */
function mumKeptSafe(world: WorldApi, outcome: SceneOutcome): void {
  if (!has(outcome.established, MUM_SAFE)) return;
  world.promise({ by: "player", to: "hobb", what: "See his mum taken in somewhere safe tonight, out of the Master's reach." });
  world.journal("Hobb's mum is to be fetched from the Shambles tonight and kept somewhere safe, out of the Master's reach.");
}

/** Prout's page, if it came out of Cob's boot tonight. */
function keepPage(world: WorldApi, outcome: SceneOutcome): void {
  if (!has(outcome.established, PAGE)) return;
  world.player.addItem({ ...world.newReadable(pageItem), asset: "parchment-note" });
  world.journal("Prout's page was in Cob's boot all along: every 'lost' wagon countersigned 'J. Sallow, for the Royal Purveyor'.");
}

// Ways in to Hobb, open from the moment the player is at his table.
const winHobb: Transition = {
  id: "win-hobb", on: "attempt",
  when: "The player tries to talk Hobb into telling what he did and who he does it for, with an appeal, an argument, a bargain or a promise of protection, while he's still holding out and it could go either way. (Just asking isn't this; a kindness or a trade that truly answers his fear needs no dice.)",
  check: { reason: "to get Big Hobb to tell you what he did",
    skill: "persuasion", dc: 14,
    success: "Something gives. Hobb looks at his wrapped hand for a long moment and says, very quietly, 'I only held the rope.' The loft comes out first, haltingly; the rest will come as he's asked.",
    failure: "Hobb shakes his head and drinks, and his eyes go to the door: not here, not yet. He heard it, though, and he's closer to leaving.",
    onSuccess: "confession", establishes: { success: [TALKED] },
  },
};

const scareHobb: Transition = {
  id: "scare-hobb", on: "attempt",
  when: "The player tries to frighten Hobb into talking: threats, the noose, the watch, his mum, or looming over him.",
  check: { reason: "to frighten Big Hobb into talking",
    skill: "intimidation", dc: 15,
    success: "For a moment the player frightens him more than his master does, and the loft comes out in a terrified rush; the rest will come as he's asked. He won't forget who frightened it out of him.",
    failure: "His master frightens him more than anyone in this room. Hobb comes up out of his chair like a wall falling over and makes for the door.",
    onSuccess: "confession", onFailure: "on-his-feet", establishes: { success: [TALKED] },
  },
};

const trickHobb: Transition = {
  id: "trick-hobb", on: "attempt",
  when: "The player tries to fool Hobb: passing as sent by his master to check he's kept quiet, telling him his master has already sold him to the watch, or some other lie he might swallow.",
  check: { reason: "to fool Big Hobb into giving himself away",
    skill: "deception", dc: 13,
    success: "He swallows it whole and, in a panic, blurts out a piece more than they asked for (to prove he's kept faith, or to save his own skin), and he'll answer the next question too.",
    failure: "He sees through it, and that's the worst thing it could be: proof that people are asking. He's up out of his chair and making for the door.",
    onSuccess: "confession", onFailure: "on-his-feet", establishes: { success: [TALKED] },
  },
};

/**
 * Hobb's mum kept out of the Master's reach tonight: what would turn him, got for her from whoever
 * could give it (Kell for a night, Dilly's barge, Nan's bolt-holes), on a roll where it could go
 * either way. Asked for by the player, not promised with nothing behind it.
 */
const mumSafe = (onSuccess: string): Transition => ({
  id: "mum-safe", on: "attempt",
  when: "The player tries to get Hobb's mum kept safe tonight, out of the Master's reach, by asking someone here who could give her that to take her in (Kell, for a night in her own room or at the watch house; Dilly, aboard the Dabchick at the foot of the stairs; Nan, who knows every bolt-hole on the stairs), where it could go either way. (Promising it with nothing behind it isn't this, and nor is the player going across the city themselves before the bell.)",
  check: { reason: "to get someone to take Hobb's mum in tonight",
    skill: "persuasion", dc: 12,
    success: "Whoever was asked grumbles and gives way: Kell, for one night in her own room, and it goes in the book ('One night. It's written down.'); or Dilly, aboard the Dabchick under the onions, as long as nobody in a uniform sets foot on her; or Nan, who has a word with a widow on the landing who owes her. Someone will fetch her from the Shambles tonight, before the Master thinks to look. Hobb looks from one of them to the other for a long moment, and his shoulders come down: he believes it. If he hasn't told it yet, it starts now, very quietly: 'I only held the rope.'",
    failure: "Whoever was asked won't, not like that and not tonight (Kell won't call her room a safe house or keep it from her own notebook; Dilly won't have the watch anywhere near her barge; Nan won't have the gentleman's trouble on her stairs), and Hobb heard the no: he's nearer the door for it. But the need is out in the open now, and the others in the room haven't been asked.",
    onSuccess, establishes: { success: [MUM_SAFE, TALKED] },
  },
});

/**
 * His mum taken in, however it came about (the roll above, a ruling standing in for it, someone
 * here offering of their own accord): what it does to Hobb comes with it, so a ruling that counts as
 * it can't drop the payoff. Only someone else can give it, so it's judged after the reply.
 */
const mumTakenIn: Transition = {
  id: "mum-taken-in", given: true,
  when: "Someone here has agreed to take Hobb's mum in tonight, out of the Master's reach (Kell, for a night in her own room; Dilly, aboard the Dabchick; Nan, with the widow on the landing who owes her), and Hobb has heard it. He believes it, and his shoulders come down: if he hasn't told it yet, it starts now, very quietly ('I only held the rope.'), and the rest comes as he's asked.",
  to: "confession", establishes: [MUM_SAFE, TALKED],
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

// Prout's page, if the granary didn't give it up: still sewn into the left boot on Cob's feet. These
// routes are the scene's only while the page is (the boundary brings `prouts-page` over), and go once
// the player has come across it. Cob is the same boy about his boots as at the granary: coin or stew
// offered as the price of a look is a bribe (haggling, and no boot), a kindness with nothing asked
// back counts towards trust, a polite ask out of the big cove's sight can go either way, and real
// trust needs no dice. Each has a route of its own, so the decider can tell them apart; the bribe and
// the kindness are ways towards the page that don't bring it.
const bribeCob = (beat: string): Transition => ({
  id: "bribe-cob", towards: "prouts-page",
  when: "The player offers coin, or more stew, as the price of a look in Cob's boot (to Cob, or to Nan for him), and nothing more (no appeal to what he's afraid of, no promise that answers it): Cob haggles, boasts and takes what's going, but the boot stays on, and Nan won't sell a look in a child's boot either. Bought attention isn't trust. What's really wrong comes out instead, his way: not out here, not with the big cove looking, and what happens to Cob after? (A meal stood him with nothing asked back is a kindness, not this.)",
  to: beat,
});

const kindToCob = (beat: string): Transition => ({
  id: "kind-to-cob", towards: "prouts-page",
  when: "The player does Cob a kindness with nothing asked back: stands him his dinner or an extra bowl with no strings, or gives it freely after he's eaten. He takes it with bad grace and a boast, and it counts with him: after it, a polite ask for a look in his boot, out of the big cove's sight, gets a yes.",
  to: beat, establishes: [KIND],
});

const coaxCob = (beat: string): Transition => ({
  id: "coax-cob", on: "attempt", essential: "prouts-page",
  when: "Out of the big cove's sight (in the scullery, or anywhere the fireside can't see), before Cob has any reason to trust them (no kindness with nothing asked back done him yet tonight, no promise that answers what he's afraid of, no yes from him already), the player asks Cob to show them what crackles in his left boot (taking it off, or letting them unpick the lining), politely and with the boots staying his, or tries to win him round to it by reaching him (an appeal to what he cares about: Mister Prout, the men from the loft, his own skin; or a tale he might swallow), where it could go either way. Paying for a look isn't this. (After a kindness with nothing asked back, for someone he really trusts, for a promise that truly answers what he's afraid of, or once he's said they can look, it needs no dice. Out in the room, under the big cove's eye, he won't, and says so his way: not out here.)",
  check: { reason: "to get Cob to show you what's in his boot",
    skill: "persuasion", dc: 13,
    success: "Cob looks past them at the scullery door, and the fire beyond it, for a long moment. Then he sits on an upturned pot, unlaces the left boot and picks the lining open with a dirty thumbnail, muttering that if this is a trick Cob'll know. Out comes a page, folded small and gone soft at the corners, and he holds it out like it might bite: 'That's Mister Prout's writing. That's why it crackled.' He can't read it; anyone who can sees a dozen grain wagons 'lost to goblins', each countersigned 'J. Sallow, for the Royal Purveyor'. If he heard the posh cove ask for 'the page' that night, it comes together for him now, and he goes white.",
    failure: "Cob won't, and it costs, whichever fits where and how they tried: in the scullery, he's out through the slop hatch Nan told him never to use and down onto the wet steps under it, and her face says whose fault that is; or he yells for Mrs Q, and Nan comes round the bar to ask what the player wants with her pot-boy's boots; or, out in the room, his yelp turns heads, and in the fireside corner Hobb looks up and sees who's bothering the boy. The boot isn't lost: Cob comes back for his stew, warier, and real trust or Nan's word can still open it.",
    onSuccess: beat,
  },
});

const nanVouches = (beat: string): Transition => ({
  id: "nan-vouches", on: "attempt", essential: "prouts-page",
  when: "The player asks Nan to tell Cob to show them what's in his boot (or to vouch for them to the boy), giving her a reason, where it could go either way. Paying her for it isn't this. (A reason plainly good for the boy, his name kept out of it and the big man's sort kept off him, needs no dice.)",
  check: { reason: "to get Nan to tell Cob to show you his boot",
    skill: "persuasion", dc: 12,
    success: "Nan looks at the player for a long moment, then wipes her hands and calls through to the scullery: 'Cob. Here, my duck. Show them your boot.' And because it's Nan, he does, sulking: the left one off, the lining picked open, a folded page held out at arm's length. 'That's Mister Prout's.'",
    failure: "Nan says the boy's boots are the boy's business, and that's a rule of the house now if it wasn't before. She keeps Cob by her behind the bar the rest of the night, and an eye on the player. The boy himself might still be won, if he's given real reason.",
    onSuccess: beat,
  },
});

// What needs no dice gets a route of its own too, so the decider can see a kindness simply work.
const trustCob = (beat: string): Transition => ({
  id: "trust-cob", essential: "prouts-page",
  when: "Out of the big cove's sight (in the scullery, or anywhere the fireside can't see), the player asks Cob for a look after giving him real reason to trust them (a kindness with nothing asked back, like his dinner stood him with no strings), or makes him a promise, now or before, that truly answers what he's afraid of (his name kept out of it, the big cove put away where he can't come back for him, the boots his to keep, whatever's in the boot going to the King and not the watch), or he has already told them they can look; or Nan, given a reason plainly good for the boy, tells him to. No dice, however it's put: Cob takes the left boot off and lets them unpick the lining: Prout's page is out.",
  to: beat, establishes: [PAGE],
});

const pageShown = (beat: string): Transition => ({
  id: "page-shown", essential: "prouts-page", given: true,
  when: "Prout's page has come out of the lining of Cob's left boot and the player has it in hand or has read it: Cob unpicked it for them or let them (trusting them, for a promise that answered his fear, or on Nan's word), or it came out some other way.",
  to: beat, establishes: [PAGE],
});

/** The page's ways in, on a beat where Cob is about (and the bribe that isn't one). */
const pageRoutes = (beat: string): Transition[] => [bribeCob(beat), kindToCob(beat), trustCob(beat), coaxCob(beat), nanVouches(beat), pageShown(beat)];

export const drownedRat: Scene = {
  id: "drowned-rat",
  title: "The Drowned Rat",
  time: "evening",
  summary: "A dockside dive with house rules, a landlady who sells gossip by the measure, and a big frightened man with a bandaged hand.",
  setting: "Evening on the eve of the Centennial Assembly, halfway down the river stairs at Caerwyn's docks. Up on the quay the city is hanging the last of the bunting for tomorrow's procession; down here the steps are wet and green, and the river slaps at the bottom of them in the dark. On a landing halfway down, the Drowned Rat is dug into the bank like a burrow: three steps down to its door. Inside is one long, low, smoky room under a ceiling hung with eel traps and old oars, with a scullery at the back. A driftwood fire burns blue with salt in the corner. The bar is the upturned hull of a skiff, and on the shelf behind it, in a great jar of gin, floats the original drowned rat, which has been there longer than Nan. Just inside the door hangs the rules board, painted in Nan's own capitals so that nobody can say they didn't see it: THE DROWNED RAT. RULES OF THE HOUSE. 1. No credit. 2. No blades out. 3. No fighting indoors. 4. No watch on duty. 5. No singing before the ninth bell. 6. What's said in the Rat stays in the Rat. 7. Gossip sold by the measure. By order, N. Quill. Enforced by Manners. (Nan sees no contradiction between six and seven: the gossip is sold in the Rat.) Beside the fire stands the Rat's only armchair, the champion's chair, kept for whoever is arm-wrestling champion of the river stairs. Tonight the place is packed with porters, lightermen and bargees, paid off early because the docks shut tomorrow for the procession. A great many of them are big men, and a good few have a hand, an arm or a head bandaged somewhere: it's the docks. Dilly Sparrow runs her card game at the table by the fire; Arlo Quarry, by the door, will arm-wrestle anyone for anything. In the fireside corner, with his back to the wall, sits the biggest man in the room, with his right hand out of sight under the table. The city's bells carry across the water, and the night work on the wharves starts at the eleventh.",
  premise: "Can the player find the big man with the bandaged hand and get out of him what he knows (who he works for, what happened in the loft, the Heron warehouse and how to get in), and what becomes of Big Hobb when they do?",
  hook: "This morning a palace clerk, Wendell Prout, was found hanged from the sack hoist behind the King's Granary. At the noon break Sergeant Kell, the watch sergeant the King lent you, saw a gentleman with a silver-topped cane walking beside the Purveyor's wagons, and at his elbow a big dock-man nursing a bandaged hand, who called him 'Master'. Prout went up on a hoist rope, and Kell reckons a rope takes the skin off the palm of whoever hauls on it. She followed the big man down the river stairs to the Drowned Rat. It's evening on the eve of the Assembly, and she has come back down with you, in a borrowed coat over her uniform that fools nobody.",
  background: [
    "This is the evening of the day Wendell Prout was found hanged behind the King's Granary. What the player and Kell found there, and how they left it, is in what happened just before this scene, and that wins. Whatever they found, Kell saw the big man with the bandaged hand at a gentleman's elbow by the Purveyor's wagons at noon, and followed him here (her card says how): that's how they know where he drinks. If nothing happened before: they also know a gentleman with a silver-topped cane (the granary children's 'Silvertop') and a big man with a bandaged hand were in the tally loft the night Prout died, and they've come looking for the big man.",
    "If Prout went into the Captain's book as a murder with no granary child taken in for it, Master Sallow has heard of it from the Captain by evening and sent the Crake brothers down the river stairs to find out who's been asking after his porter. They're barred from the Rat (rule three, once each), so they ask at the pump on the stairs and come no further.",
  ],
  opening: "Hours have passed since the granary: it's dusk on the eve of the Assembly, and the trail of the big man with the bandaged hand has brought the player and Kell down the river stairs. Open at the Rat's door: the bunting on the quay above, the river slapping at the foot of the stairs, the din inside. As they step down into the room the din drops by half: the regulars have made Kell for watch before she's through the door (it's the boots). Show what a first glance would, by look rather than by name: the long smoky room, the rules board just inside the door, a small square landlady behind the bar with a cudgel to hand, an ancient bargewoman dealing cards by the fire, a young lighterman by the door with his elbow on a table, a great many big men with a great many bandages between them, and the biggest of them all in the fireside corner, back to the wall, one hand out of sight. Nobody gets a name until someone says it, and Cob stays out of it: he's in the scullery. End on Nan, with a look at the rules board, asking the sergeant whether she's on duty.",
  cast: [
    {
      id: "hobb",
      name: "Big Hobb Mallory",
      called: "the big man with the bandaged hand",
      statblock: "tough", weapon: "unarmed-strike",
      look: "A dock-porter the size of a door: a head like a bollard, a nose broken more than once, shoulders that fill the corner, a leather porter's hood pushed back. His right hand is wrapped in a tarry rag, and he keeps it under the table. A greasy string round his thick neck disappears into his shirt, and every time the door opens, he flinches.",
      voice: "Slow, low and polite: 'sir', 'missus', 'Mrs Quill', and 'Master', which he can't stop saying and stops himself after. Says as little as he can; when it spills, what spills is how he feels (the clerk's stockinged feet, the rope, his mum), not how anything works. Frightened, he goes very quiet and very still, like a dray-horse in thunder. 'Not tonight, Arlo.'",
      wants: "Tonight: to lose every heron penny he has at Dilly's table, because he can't bear to keep them, and to drink until he stops seeing the clerk's stockinged feet; and still to be at the river door at the eleventh bell, so his master never looks at him twice. Underneath, to put it right, if anyone could show him a way that isn't the noose or the river.",
      fears: "His master, who has told him how patient the river is with men who talk, and who knows where his mum lives. The noose, and the watch who'd put him in it. His hand being seen. His mum finding out what he did.",
      knows: [
        "He's Hobb Mallory, porter, champion of the Rat at the arm-wrestling these eleven years. He won't wrestle tonight and won't say why.",
        "He has a night job for a gentleman that pays double, in new silver. He'll own to that much, and not to what it is.",
        "He's due at work at the eleventh bell, and if he isn't there when his master comes, his master will know something's wrong.",
      ],
      secrets: [
        "Shows: he won't wrestle tonight; his right hand stays under the table; he flinches at the door, and says 'Master' and stops himself. Torn: telling hangs him, and not telling leaves him the Master's for good. Opens: a way to put it right that isn't the noose (he doesn't know a man can swear for the Crown), someone who'll see his mum safe whatever happens to him, or a kindness he can't stand up to; a fright worse than the Master works too, and he never forgets who frightened it out of him. First: 'I only held the rope.'",
        "The loft, haltingly, and not where the whole Rat can hear: last night after the midnight bells he held a clerk's arms in the granary tally loft while the clerk was struck and strangled, then hauled him up on the sack hoist 'so it looks like he did it himself'. The rope took the skin off his palm. 'I only held him. I only held the rope.' He has been sick twice since.",
        "Who, which costs him most: he says 'the Master', and gives the name only when asked for it straight, in a whisper: Master Sallow of the Royal Purveyor's office, who struck the clerk with the head of his cane and used the cord.",
        "Only if asked: at first light the Master went back to look, and paid a granary girl a silver crown to say she'd seen the clerk jump.",
        "His night work, if asked: the Heron warehouse, at the downriver end of the wharves, re-sacking ('It's the King's grain, sir. Everyone knows. Nobody says.'). Tonight's a loading night, a barge for Saltmere; he's due on the hoist at the eleventh bell, and the Master comes at the midnight bell to see it off.",
        "How he gets in, if asked: a brass heron token on the string round his neck, shown at the grille of the river door off the plank walk. It's only brass, and the gang know his face at the grille, so he has no need of it tonight: he'll give it up if asked. He knows his own part of the night (the hoist, the door, the bell) and not how the rest of it works.",
      ],
      attitude: "Polite, slow and closed: he wants to be left alone with his drink. More frightened of his master than of anyone in this room, until someone gives him reason to be otherwise. Torn: the strongest man on the river stairs, and the most frightened man in the Rat. Threats he can stand (he's been threatened all his life); kindness undoes him, because it makes him want to tell. Push him clumsily and he bolts, and frightened men run to their masters. Arlo's challenge presses it: wrestle, and the hand shows; refuse a third time, and he gives up the chair in front of everyone. No fighter unless cornered, and then a door falling on you. Ties here: Mrs Quill, whose barrels he's carried since he was Cob's size; Dilly, who feeds him and is winning his silver; Arlo, who could have the chair and welcome, if it didn't mean showing the hand; Nan's loud little pot-boy, whom he once gave the end of his pie (he doesn't know the boy was in the loft).",
    },
    {
      id: "nan-quill",
      name: "Nan Quill",
      called: "the landlady",
      statblock: "tough", weapon: "club",
      look: "A small, square woman of sixty with forearms like hams, a man's flat cap pinned to her grey bun and a leather apron with a coin pouch on it. Behind the bar, on two nails, hangs Manners: a blackthorn cudgel polished by use. Beside it, on hooks, a row of pewter measures from a gill to a quart, which she uses for beer and gossip alike.",
      voice: "Flat, unhurried river-stairs talk. Speaks in rules and prices and quotes rule numbers. Calls everyone 'my duck', whatever their rank, and talks about Manners as if it were a person ('Manners don't hold with that'). 'Rule four, my duck. Are you on duty?'",
      wants: "A full, paying, peaceful house on the busiest night of the year, by the rules, and a fair price for what she knows, by the measure, never short. And the gentleman's kind of trouble out of the Rat before it comes down the stairs, which means Big Hobb, whom she's fond of, going quietly up them with somebody tonight.",
      fears: "Losing the Rat: the river watch shutting her down, a fire, or a gentleman's kind of trouble coming down the stairs. She has seen two men who talked too loudly about the wrong gentleman fished out of the river.",
      knows: [
        "She enforces the house rules to the letter: one warning for small things (a raised voice, a threat, a song before the ninth bell), and none for a fist or a blade. Nobody is stopped at her door; outside it is the river's business.",
        "Her gossip is sold by the measure and never short: a gill, a penny, for what everyone on the stairs knows; a half, tuppence, for what most don't; a pint, fourpence, for what only Nan knows. She doesn't sell quarts: a quart'll get you drowned. Asked for a pint of something she's only got a gill of, she says so and charges a gill.",
        "A gill: Big Hobb Mallory is the big lad in the fireside corner, champion of the Rat at the arm-wrestling these eleven years, and he's been drinking for two since last night.",
        "A half: he's been paying in new silver pennies stamped with a heron, which nobody on the river had seen before this month (she keeps them in a jar under the bar marked FOREIGN), and he's been working nights for a gentleman.",
        "A pint: the gentleman's work is at the Heron warehouse, at the downriver end of the wharves; Hobb's due there at the eleventh bell, and tonight's a loading night, with a Saltmere barge in. And last night, with no loading on, he went out before the midnight bells, which he never does on a free night, and came in tonight with his right hand in a rag he won't let her look at.",
        "Hobb sends his wages to his mum in the Shambles every week, without fail. That one's free; everybody knows it. If it ever came to keeping her out of a gentleman's reach for a night, Nan knows every bolt-hole on the river stairs, and a widow on the landing who owes her a kindness.",
        "Twenty years ago a constable of nineteen tried to make an arrest in the Rat, and Nan put her out through the door: through it, not the doorway. The constable was Agnes Kell. Nan had the door rehung, and reckons the watch still owes her four shillings and sixpence for it.",
        "Cob is her pot-boy on busy nights, for a penny and a bowl of eel stew. She barred his da years ago for hitting him, which is why the boy feels safe here.",
        "Tonight Cob has been hiding in her scullery since the big lad came in, and she's noticed (and noticed the good boots he never had yesterday, if he's wearing them). Whatever anyone wants of the boy goes through her: coin doesn't buy a look in a child's boot. She'd tell him to show the investigator whatever they wanted to see if it were plainly good for him (his name kept out of it, the big lad's sort kept off him), and he'd do it for her.",
      ],
      secrets: [
        "Shows: her eyes go to Hobb's corner every time the door opens, and she won't take a pint measure down for anything about the gentleman Hobb works for. Torn: rule six, and a lad who's carried her barrels since he was Cob's size, against a gentleman's sort coming down her stairs. Opens: respect for the house, a fair price, and, though she'd deny it, something that's plainly good for Hobb or for Cob. First: 'That's a quart, my duck. I don't sell quarts.'",
        "The quart: the gentleman Hobb works for is Master Sallow of the Royal Purveyor's office, and the porters say the Heron's grain is the King's own, come the long way round. She won't sell it at any price, and won't say the name aloud in her own house.",
        "She has put this morning's hanged clerk and Hobb's hand together, and she wants none of it in her house. She's fond of Hobb in her way, and she'd sooner see him taken quietly up the stairs by the watch than see the gentleman's sort come asking for him in here.",
      ],
      attitude: "Even-handed and unimpressed: anyone who keeps the rules and pays is welcome, and nobody gets more than their money's worth. Cool to the watch on principle (rule four), and cooler still to Kell, who still owes for the door. Respects people who respect the house. Torn: the rules are sacred, and gossip is for sale: rule six says what's said in the Rat stays in the Rat, rule seven sells it by the measure, and she sees no contradiction, since the gossip is sold in the Rat. She plays both absolutely straight. Ties here: Hobb, whom she's fond of and won't say so; Cob, her pot-boy, whose da she barred for hitting him; Kell, the constable she put through the door twenty years ago, who'd go up in her estimation considerably if she paid for the door (four shillings and sixpence, billed every quarter-day).",
    },
    {
      id: "kell",
      name: "Sergeant Agnes Kell",
      statblock: "guard", weapon: "club",
      look: "Forties, in a borrowed brown coat over her watch uniform that fools nobody (it's the boots, and the way she stands). A battered oilcloth notebook and a pencil stub she sharpens with a clasp knife; a truncheon she has never been seen to draw. She stands just inside the door, very still, watching hands.",
      voice: KELL_VOICE,
      wants: "To hear what the big man with the bandaged hand knows, tonight, before he drinks it away or somebody shuts his mouth for good, and to write it down where he can watch her write it. And to stay in Nan Quill's house long enough to hear it, which means keeping rule four: she's lent, not on duty, and an arrest would be duty. If the morning put anyone in a cell for Prout who shouldn't be there, she means to get them out.",
      fears: "A witness who could hang a gentleman ending up in the river. A wrong name in her notebook. Going out through Nan's door twice in one lifetime.",
      knows: [
        "Since the morning she has kept at Prout's case on her own account. At the noon break, eating a pie with the granary porters, she saw the Purveyor's flour wagons go by with a gentleman walking beside them (a silver-topped cane, a wheat-ear ring, lavender water), and at his elbow a big dock-man nursing a bandaged right hand, who called him 'Master' and stopped himself. She doesn't know either of them by name, or the gentleman by sight. Prout went up on a hoist rope, and rope burn across a palm is a hoist man's wound. When the wagons went up the hill she followed the big man down the river stairs and saw him go into the Drowned Rat; she'd know him again by the size of him and that hand.",
        "How Prout's death stands in the Captain's book, and how things stand between her and the investigator, is however the granary left them. Either way it's her case, and she means to finish it.",
        "The river stairs aren't her patch. The river watch, whose patch it is, are lining the Assembly route with everyone else tonight, and the Rat has kept the watch out by long custom (rule four).",
        "Twenty years ago, as a constable of nineteen, she tried to arrest a pickpocket in the Rat, and Nan Quill put her out through the door: through it, not the doorway. She hasn't been back. She has been told she owes for the door.",
        "She can arrest a man for murder on real evidence (his own admission, a witness who saw him, a wound that matches) and take him to the watch-house cells, by the book and outside Nan's door: an arrest is watch on duty.",
        "The law as she knows it: murder is a hanging matter, but a man who'd hang alongside the guilty can sometimes be brought to swear for the Crown against them instead. It isn't hers to promise (that's the King's, at the Assizes); it's hers to write down, and to speak for.",
        "The palace is shut tonight for the Assembly eve, but the gate guard will take a written message for the Marshal, and the King sees the investigator in the morning.",
        "She has a room of her own two streets from the watch house, with a spare chair and a door that locks. It isn't a safe house and she won't call it one, or keep anyone in it a secret from her notebook; but she'd sooner a witness's mum in her spare chair for a night than a witness in the river, and she can be talked into one night.",
      ],
      secrets: [
        "Prout's visit three days ago, and her sending him to the palace. If it came out at the granary, it's told, and she doesn't tell it again. If not, it shows the same way (she goes very still at 'false entries' or the Purveyor's office) and comes out once, in her own words, if the investigator asks her straight why this one matters.",
      ],
      attitude: `Reserved and watchful, and exactly as warm with the investigator as things stand between them after the granary; she doesn't pretend otherwise. Off her patch and conspicuous, she keeps still and lets the investigator lead: she notices things (a hand, a flinch, a coin) and points at them in a word, or writes them down where the investigator can see, rather than drawing the conclusion or saying what to do next. She won't lie: asked if she's on duty, she says she's lent, which is true. When she has enough to take Hobb in, she says so, once. Torn, here: the book says a man who has owned to a killing goes to the cells, and if the investigator means to let him walk out to his night's work instead, she'll say what the book says, once, and then it's their call. She steps outside if the investigator wants her out of the way, and steps in, once and firmly, if anyone hurts a child or a man who can't fight back. Ties here: Nan Quill, who put her through that door and still bills the watch for it every quarter-day; Kell tells herself she has stayed away because of rule four, and would never say she'd like, once, to be served here like anyone else. ${KELL_PROMISES}`,
    },
    {
      id: "cob",
      name: "Cob",
      called: "the pot-boy",
      statblock: "commoner", weapon: "unarmed-strike",
      look: "A scrawny boy of about eleven in a man's waistcoat, with a pot-boy's sacking apron over it that reaches his ankles. On his feet, either Prout's good black clerk's boots, three sizes too big and laced on with string, or nothing much, depending on how the morning went. Scabbed knuckles, a yellowing bruise on one cheek, a tray of empty pots.",
      voice: "Loud and cocky, and talks about himself in the third person ('Cob don't talk to bluebottles'). Foul-mouthed in an inventive gutter way (sod off, bleedin', bum-faced palace pigeon) but never truly obscene. Brags, mocks and dares; goes very quiet and very young when he's frightened.",
      wants: "To earn his penny and his bowl of eel stew without the big cove by the fire ever clapping eyes on him. And to see the big cove get what's coming to him for Mister Prout, as long as it never comes back to Cob. Moll safe, wherever the morning left her.",
      fears: "The big cove by the fire, and the gentleman he works for. His father. Being sent to the Mending House. Being called a liar.",
      knows: [
        "He's Nan's pot-boy tonight. Whether he came for the stew or because he's been tailing the investigator since the granary, he won't say.",
        "The Rat is the one place in Caerwyn his da can't come: Nan barred him for hitting Cob.",
        "Everybody on the river stairs knows Big Hobb: champion of the Rat at the arm-wrestling, never been beaten. He gave Cob the end of his pie once.",
      ],
      secrets: [
        "Shows: he won't come out of the scullery while the big man is in the room, and when he does, he keeps the bar between them and won't look at the fireside corner. Opens: someone he trusts, somewhere Hobb can't see. First: a jerk of the head towards the fire, from behind something.",
        "Big Hobb is the big cove from the loft last night. Cob knew him by the lantern light (the size of him, and his voice saying 'Yes, Master'), and he's seen him in here for years. He saw Hobb come in tonight and has been hiding in the scullery since. He'll tell it to someone he trusts, or point, from behind something; never where Hobb can see.",
        "He pinched one of Hobb's new silver pennies off the pot tray. It's got a heron on it, not the King.",
        "Only if Prout's page is still sewn into his left boot (the world has it there, and it's among what the player needs to come across): he doesn't know it's there; the crackle is what good boots do. The boots are the first good thing he's ever owned, and he's the same about them as at the granary. Coin or stew offered as the price of a look buys boasts and haggling, never the boot, and he says, his way, what's wrong instead (not out here, not with the big cove looking, and what happens to Cob after?). A kindness with nothing asked back (his dinner stood him with no strings) counts with him. Asked politely out of the big cove's sight (the scullery), the boots staying his, he might (it could go either way). For someone he trusts, after a kindness like that, or for a promise that answers what he's afraid of (his name kept out of it, the big cove put away where he can't come back for him, whatever's in there going to the King and not the watch), he takes the left one off and lets them unpick it; and if Nan tells him to, he does it for her.",
      ],
      attitude: "How he takes the investigator and the sergeant tonight is as things stand between them after the granary. Whatever that is, with the big cove in the room he's quieter and jumpier than he was, and sticks near the scullery door. Bought attention isn't trust: food or coin offered as a price gets boasts and bargaining; a kindness with nothing asked back, respect or a laugh at his jokes gets real talk and counts towards trust; only believing someone will keep him safe from the men gets what he knows. If grabbed, he bolts for the scullery. Ties here: Nan, the only grown-up who ever did anything about his da (he'd die before saying so); Hobb, who gave him the end of his pie once, which makes it worse. (If what happened before has him locked up in the watch house, he isn't here tonight: Nan has no pot-boy, and the scene doesn't need him.)",
    },
    {
      id: "arlo",
      name: "Arlo Quarry",
      called: "the young lighterman with the black eye",
      statblock: "tough", weapon: "unarmed-strike",
      look: "A young lighterman built like a water butt, with rolled sleeves, a fresh black eye and forearms he keeps flexing. His elbow is on the nearest table at all times, in case.",
      voice: "Loud, cheerful and spoiling for it. Talks in challenges and wagers ('Penny says I'd have you'). Calls everyone 'champ', sarcastically. Goes quiet and sulky when he's laughed at.",
      wants: "The champion's chair, tonight, while Big Hobb won't wrestle: a champion who refuses three challenges in one night gives the chair up, by house custom, and Hobb is on two. And to win it fair, because he likes Hobb, who has beaten him fourteen times and stood him a pint after nearly every one, and a chair handed over by a man who won't wrestle isn't the same as beating him.",
      fears: "Being laughed at. Being thought yellow. Nan, who has already given him his one warning tonight.",
      knows: [
        "Hobb has been champion eleven years and has never refused a match until tonight. He keeps his right hand under the table.",
        "Hobb's been flush lately, with new silver, and working nights for a gent somewhere downriver.",
        "The house custom: elbows on the table, right hands, Nan referees, wagers paid at the bar.",
      ],
      secrets: [
        "Shows: he keeps grinning at Hobb's hidden hand, like a man with a card up his sleeve. Opens: a wager, flattery or a sympathetic ear gets it out of him early; otherwise he saves it for the moment it will hurt Hobb most, the third refusal. First: 'I know what's under that rag, champ.'",
        "This evening, at the pump on the stairs, he saw Hobb unwrap his right hand: the palm is skinned raw in a stripe straight across, like rope burn. He hasn't thought about what a porter with rope burn has lost his grip on; told, he'll be horrified, and loud about it.",
      ],
      attitude: "Friendly to anyone who'll wrestle him, back him or stand him a pint; scornful of the watch, and of anyone who drinks with it. Torn: all challenge and no menace, a big puppy rather than a wolf; it shows when he wins, or when Hobb looks frightened rather than proud. Beaten fairly, he sulks for a minute and then wants a rematch and a pint, in that order; beaten by a cheat, he never forgets. Ties here: Hobb, whose chair he wants and whom he doesn't want hurt.",
    },
    {
      id: "dilly",
      name: "Dilly Sparrow",
      called: "the old bargewoman with the cards",
      statblock: "commoner", weapon: "unarmed-strike",
      look: "A tiny, ancient bargewoman in a man's coat and three shawls, with a clay pipe, a pack of cards worn soft as cloth, and a pile of coppers and new silver in front of her. Her barge, the Dabchick, is tied up at the foot of the stairs.",
      voice: "Croaky, sly and motherly at once. Calls everyone 'my lamb', sergeants included. Deals as she talks and never looks at her cards. 'Sit down, my lamb, and lose a little. It's good for the soul.'",
      wants: "To keep winning Hobb's heron silver off him, because if she doesn't someone worse will, and to get him to stop drinking like a man who's going to be hanged. And the sergeant out of the Rat before anybody mentions onions.",
      fears: "The watch finding the six casks of Saltmere brandy under the onions on the Dabchick. The river, which has had two husbands off her already.",
      knows: [
        "Hobb plays at her table every night, and since last night he's been playing like a man trying to lose: he's lost a pile of new silver to her, every penny stamped with a heron.",
        "He told her tonight he's due at work at the eleventh bell, 'at the Heron', and that he'd sooner be dead.",
        "She's fed him since he was a lad carrying Nan's barrels: bread and dripping on the Dabchick's deck. There's a cabin aft on the Dabchick, and she has hidden strays in it before; for her lamb's old mum she would, as long as nobody in a uniform sets foot aboard (the onions).",
        "What she reckons is wrong with him: he's got himself mixed up in some Saltmere smuggling at the Heron, past the tide-waiters, and it's frightened the life out of him. She'd tell him there's no rope for a bit of smuggling, if he'd only say. (She's wrong about what it is.)",
      ],
      secrets: [
        "Shows: she protests about onions before anyone has asked, and keeps an eye on the sergeant's boots. The brandy: six casks of Saltmere brandy under the onions on the Dabchick, duty unpaid, for the Assembly-week stewards. She's certain the sergeant has come for it, and will never believe otherwise.",
      ],
      attitude: "Sweet as treacle to anyone who sits down and plays fair; flinty to the watch; protective of Hobb. Cheats only those who cheat, and then thoroughly. Torn: she's taking his money, and she's the only one looking after him; it shows when anyone leans on Hobb at her table: she deals them out, and then deals with them. Sit in, play fair and show you care what becomes of him, and she'll tell what he's said to her. Ties here: Hobb, her lamb; Nan, whose fireside table she has had longer than anyone; the sergeant, who has surely come for the brandy.",
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
        winHobb, scareHobb, trickHobb, armWrestle("the-rat"), ...pageRoutes("the-rat"),
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
        winHobb, scareHobb, trickHobb, mumSafe("confession"), mumTakenIn, armWrestle("big-hobb"), ...pageRoutes("big-hobb"),
        bell("The player has been at Hobb a good while (at least six exchanges at this point) without him breaking, or is going round in circles: the eleventh bell rings across the water, and Hobb gets up to go to work."),
      ],
    },
    {
      id: "on-his-feet",
      title: "Out of his chair",
      direction: "Hobb is up and leaving, one way or the other: bolting in a panic because someone pushed too hard or too clumsily, or going to his night's work at the bell, as he must, because if he isn't at the river door when his master comes, his master will know something is wrong. This is a short, sharp moment: the door, the wet stairs and the dark are a few strides away. The player can let him go, follow him, stop him, or try one last time, and Kell will back a lawful arrest if there's evidence for one. Indoors, rule three holds; out on the stairs, it doesn't.",
      cast: {
        hobb: "You want out: up the stairs into the dark if you're bolting, down to the wharves if you're going to work. Going to work, if anyone tries to stop you, you say why you must, once, before you go: if you're not at the river door when the Master comes, he'll know, and he knows where your mum lives.",
        kell: "If he's bolting and the investigator goes after him, go too. If he's going to work, say once, quietly, whether you have enough to take him in, and wait for the investigator's word.",
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
            onSuccess: "confession", onFailure: "hobb-fled", establishes: { success: [TALKED] },
          },
        },
        {
          id: "last-word", on: "attempt",
          when: "Hobb is going to his night's work (not bolting), and the player makes one last real appeal to stop him and get him to tell what he knows, where it could go either way.",
          check: { reason: "to stop Big Hobb at the door and get the truth out of him",
            skill: "persuasion", dc: 14,
            success: "Hobb stops with his hand on the door. His shoulders go down. He comes back to the corner, sits, and says, 'I only held the rope.'",
            failure: "He shakes his head and says he's sorry, and why, at the door: if he isn't at the river door when the Master comes, the Master will know, and the Master knows where his mum lives. Then he goes out into the dark, down the stairs towards the wharves.",
            onSuccess: "confession", onFailure: "gone-to-work", establishes: { success: [TALKED] },
          },
        },
        mumSafe("confession"), mumTakenIn,
        {
          id: "hobb-breaks",
          when: "Hobb, on his feet or in the doorway, has broken and begun to tell what he did or who he does it for (the loft, his master, the Heron), however it came out.",
          to: "confession", establishes: [TALKED],
        },
        { id: "sat-down", when: "Hobb has sat back down, or been talked back to his corner, without having told what he knows.", to: "big-hobb" },
        { id: "gone-talked", when: "Hobb has gone out of the Rat to his night's work (not bolting) after owning to some of it (the loft and his part in it, his master, the Heron or his token), and the player has let him go or gone out after him to follow.", to: "hobb-talks" },
        { id: "gone", when: "Hobb has gone out of the Rat to his night's work (not bolting) without having owned to any of it (not the loft, his master or the Heron), and the player has let him go or gone out after him to follow.", to: "gone-to-work" },
        { id: "got-away", when: "Hobb has bolted out of the Rat and away up the stairs into the dark, and nobody went after him, or they've lost him.", to: "hobb-fled" },
      ],
    },
    {
      id: "confession",
      title: "I only held the rope",
      direction: "Hobb is talking, or starting to. He begins where it hurts, with the rope, slowly and in pieces, wiping his face with his good hand, and he won't say more where the whole Rat can hear: the player has to find him somewhere quieter or give him a reason. The rest (his master, the Heron and tonight's loading, his token: see his secrets) comes out as the player asks for it, with no dice, one thing per reply and in his own words. He knows only his own part of the night, so he doesn't brief anyone on the Heron. Answer what they actually ask, and never put questions in their mouth or run the interview for them. If he thinks he's talking to his master's people (a trick that worked), he tells it as proof he has kept faith, and it's the same truth. Kell writes it all down. When it's out, he asks what's to become of him: he's terrified of the noose and more terrified of his master, and he has to be at the river door at the eleventh bell or his master will know something is wrong. The beat ends on the player's choice: Kell takes him in, he goes to work (as their man inside, or keeping his head down), or he runs. Don't decide it for them.",
      cast: {
        hobb: "Tell the loft first, then answer what you're asked, one thing at a time: asked straight for the Master's name, you give it, in a whisper. When it's out, ask what's to become of you. The token's only brass: give it up if asked.",
        kell: "Write it down. You have enough to take him in now, and you'll say so, once; whether you do it tonight is the investigator's call. If you do, it's by the book, outside Nan's door.",
        "nan-quill": "Keep the room off his back, and keep your ears open.",
        dilly: "Sit with him. Glare at anyone who frightened it out of him.",
        cob: "If you're near enough to hear, listen from behind something.",
      },
      pressure: "The eleventh bell rings across the water. Hobb gets to his feet, because he has to be at the river door when it stops.",
      transitions: [
        // The rest comes as he's asked, so each ask has a route the decider can match to the player's
        // words, with no dice: "who's the Master?" isn't a push to roll for once the loft is out.
        {
          id: "told-heron",
          when: "The player asks Hobb where he works, or where he's due at the bell, what goes on there tonight or how a body gets in, or Hobb tells it. No dice: the loft is out, and the rest comes as he's asked. He tells his own part of the night as he knows it: the Heron warehouse, at the downriver end of the wharves, re-sacking ('It's the King's grain, sir. Everyone knows. Nobody says.'); tonight's a loading night, with a barge for Saltmere; he's due on the hoist at the eleventh bell, the gang go in at the river door off the plank walk, showing a brass heron token at its grille, and the Master comes at the midnight bell to see the barge off.",
          to: "confession", establishes: [HERON],
        },
        {
          id: "told-master",
          when: "The player asks Hobb straight for his master's name (who he is, who he does it for, who 'the Master' is), or Hobb gives it. No dice: the loft is out, and the rest comes as he's asked. It costs him most, so it comes in a whisper, with a look at the door: Master Sallow of the Royal Purveyor's office, who struck the clerk with the head of his cane and used the cord.",
          to: "confession", establishes: [NAMED],
        },
        {
          id: "token-given",
          when: "The player asks Hobb for his brass river-door token (the heron on the greasy string round his neck), or Hobb hands it over, to the player or to Kell. No dice: it's only brass, and the gang know his face at the grille, so he has no need of it tonight. He pulls it over his head and holds it out: shown at the grille of the Heron's river door, it gets the bolt drawn.",
          to: "confession", establishes: [TOKEN],
        },
        {
          id: "inside-man",
          when: "The player asks Hobb to be their man inside the Heron tonight (to open the river door to their knock, keep the gang off them, or point out the clerk's book) once his mum is to be kept safe tonight or they've made him a promise that truly answers his fear, or Hobb agrees to it of his own accord. No dice: he swallows, nods and says he'll do it, for as long as his nerve holds.",
          to: "confession", establishes: [INSIDE],
        },
        {
          id: "turn-hobb", on: "attempt",
          when: "The player tries to talk Hobb into going back into the Heron tonight as their man inside, while his fear of his master could still win: his mum isn't safe yet, and nothing they've promised answers his fear. (Once his mum is to be kept safe tonight, or for a promise that truly answers his fear, it needs no dice: that isn't this.)",
          check: { reason: "to talk Hobb into being your man inside the Heron",
            skill: "persuasion", dc: 14,
            success: "Hobb swallows, nods and says he'll do it: he'll open the river door to their knock and keep the gang off them, for as long as his nerve holds.",
            failure: "He can't. He'll go to work, because not going would tell his master everything, but in there he'll keep his head down and pray; he won't lift a finger for them.",
            onSuccess: "confession",
          },
        },
        { id: "let-him-go", on: "attempt", when: "The player is done at the Rat: they leave with what Hobb told them, letting him go to his night's work (or taking him along), without having him arrested.", to: "hobb-talks" },
        { id: "hobb-runs", when: "Hobb's nerve has gone and he's bolting for the door (at the word 'arrest', or at the thought of his master).", to: "on-his-feet" },
        mumSafe("confession"), mumTakenIn,
        ...pageRoutes("confession"),
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
      outcome: "Big Hobb has told the player what he knows, or the heart of it: at the least, his part in the loft (he held the clerk's arms while his master killed him, then hauled him up on the rope), and as much of the rest as they asked for (his master's name, the Heron warehouse and how to get in at night). The player is leaving the Rat with it, and it's in Kell's notebook as he said it. Hobb isn't under arrest and hasn't run: he's going to his night's work at the Heron, as their man inside if he agreed to be, or keeping his head down if not.",
      closing: "Close on the player leaving the Rat with what they came for: Hobb's face as they go (or his broad back going down the stairs ahead of them at the bell), Nan's look, the river below. Kell closes her notebook on it.",
      next: "wharf-night",
      script: (world, outcome) => {
        const hobb = world.character("hobb");
        const named = has(outcome.established, NAMED);
        hobb.moveTo("heron-warehouse");
        hobb.remember(named ? "He told the King's investigator what happened in the tally loft, and who his master is." : "He told the King's investigator what he did in the tally loft. He didn't say his master's name.");
        if (has(outcome.established, INSIDE)) world.promise({ by: "hobb", to: "player", what: "Open the Heron's river door to the player tonight and keep the gang off them." });
        keepToken(world, outcome);
        kellRecords(world, outcome, { always: true });
        world.setFlag("hobb_identified", true);
        heronLead(world);
        world.quest("purveyors-man").advance("hobb_talked", `Big Hobb Mallory says ${named ? "Master Sallow" : "his master"} killed Prout in the tally loft while Hobb held his arms, and had Hobb hoist him; the stolen grain goes through the Heron warehouse.`);
        world.journal(`${named ? "Big Hobb talked: he held Prout in the loft while Master Sallow killed him." : "Big Hobb owned to the loft: he held Prout while his master killed him, and hauled the rope."} The grain goes through the Heron warehouse, and tonight a barge is loading there.`);
        mumKeptSafe(world, outcome);
        keepPage(world, outcome);
      },
    },
    {
      id: "taken-in", kind: "progress", title: "Taken in",
      outcome: "Sergeant Kell has arrested Big Hobb, on evidence she accepts, and is taking him up the river stairs to the watch-house cells. Whatever he told the player before he was taken, they have, and whatever he owned to is in Kell's notebook as he said it; he won't be at the Heron tonight.",
      closing: "Close on the arrest done by the book outside Nan's door: Kell's proper words, Hobb's great shoulders going down, the Rat silent behind them, the river below. Kell will see him locked up and come on to wherever the investigator is going next.",
      next: "wharf-night",
      script: (world, outcome) => {
        const hobb = world.character("hobb");
        hobb.moveTo("watch-house");
        hobb.remember("Sergeant Kell arrested him outside the Drowned Rat for the clerk's death, with the King's investigator there.");
        world.character("kell").remember("She arrested Big Hobb Mallory for Prout's murder outside the Drowned Rat and took him to the watch-house cells.");
        kellRecords(world, outcome);
        keepToken(world, outcome);
        world.setFlag("hobb_identified", true);
        if (knowsHeron(outcome)) heronLead(world);
        world.quest("purveyors-man").advance("hobb_arrested", "Big Hobb Mallory, the big man with the bandaged hand, is in the watch-house cells.");
        world.journal("Kell took Big Hobb in. He's in the watch-house cells tonight.");
        mumKeptSafe(world, outcome);
        keepPage(world, outcome);
      },
    },
    {
      id: "hobb-fled", kind: "other", title: "Hobb runs",
      outcome: "Big Hobb has run from the Rat and got away into the dark. Frightened out of his wits, he's gone where his feet always take him: to his master, to warn him that the King's investigator and a watch sergeant are asking about the loft. Whatever he told the player before he ran, they have, and whatever he owned to is in Kell's notebook as he said it.",
      closing: "Close on the empty doorway, the wet stairs and the dark; the Rat's silence, and Nan's look, which says whose fault that was.",
      next: "wharf-night",
      script: (world, outcome) => {
        const hobb = world.character("hobb");
        hobb.leaveScene("ran off up the river stairs into the city, to warn his master");
        hobb.setAttitude("unfriendly", "The King's investigator frightened him out of the Drowned Rat.");
        hobb.remember("He ran from the Drowned Rat to warn Master Sallow that the King's investigator and a watch sergeant are asking about the loft.");
        world.setFlag("hobb_identified", true);
        world.setFlag("sallow_warned", true);
        if (knowsHeron(outcome)) heronLead(world);
        kellRecords(world, outcome);
        world.journal("Big Hobb ran from the Drowned Rat, and he'll have gone straight to his master.");
        mumKeptSafe(world, outcome);
        keepPage(world, outcome);
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
        kellRecords(world, outcome);
        world.journal("Thrown out of the Drowned Rat by Nan Quill and her cudgel, Manners.");
        mumKeptSafe(world, outcome);
        keepPage(world, outcome);
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
        kellRecords(world, outcome);
        world.journal("Big Hobb went off to his night's work at the bell without telling us what he knows.");
        mumKeptSafe(world, outcome);
        keepPage(world, outcome);
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
    // Only if the player missed it at the granary: the boundary brings it over, with its routes.
    {
      id: "prouts-page", missed: "hanged-clerk:page",
      what: "Prout's page, still sewn into the lining of the left boot on Cob's feet: razored from the Royal Granary Roll, a dozen King's Road grain wagons marked 'lost to goblins', each countersigned 'J. Sallow, for the Royal Purveyor', with Prout's pencilled river-warehouse weights and, at the foot, 'Not goblins. Who pays the hedge-folk?'",
      placedWith: [
        "the left boot on Cob's feet, which crackles when he stamps (he thinks that's what good boots do)",
        "Cob, in the scullery out of the big cove's sight, for someone he trusts or a promise that answers what he's afraid of",
        "Nan, whose word Cob would take, for a reason plainly good for the boy",
      ],
      carriers: ["cob", "nan-quill"],
      unlocks: "Sallow's countersignature in writing, beside Prout's weights: the motive, and proof the King can hold",
    },
  ],
  limits: [
    "Seeing the King, or getting a warrant or men from the palace tonight: on the eve of the Assembly the palace is shut to everyone but the procession rehearsal and the delegations' dinner, and the Captain files what the Purveyor's office asks him to file. The gate guard will take a written message for the Marshal, and the King will see the investigator in the morning. Tonight it's the player and Kell.",
    "More watch (constables, the river watch, anyone to hold the stairs): the whole watch is lining the Assembly route through the night, the river watch with them. Kell is the watch here, off her patch.",
    "Credit, IOUs or 'the King will pay': rule one. Money on the bar, goods Nan will take at her own valuation, or nothing.",
    "Master Sallow himself, or anyone who'll say his name aloud for money: he wouldn't be seen dead on the river stairs, nobody in the Rat will say where he is, and Nan doesn't sell quarts.",
    "Another way out of the Rat, or a private room to talk in: it's one long room and a scullery. The only door opens onto the stairs; the scullery's slop hatch onto the river is just big enough for Cob, and the river under it is fast and cold.",
    "The player going anywhere else themselves before the bell (Hobb's lodgings, the palace offices, the watch house for help): the trail is here, and at the bell it goes downriver with Hobb. His lodging is a room in the Shambles across the city, with his mum in it. Sending is another matter, and not this: a written message to the Marshal by the palace gate, or someone to fetch Hobb's mum tonight and take her somewhere safe, if someone here will.",
    "Buying magic here (truth potions, charms, a hedge-wizard for hire): there's none to be had on the river stairs, and Nan sells gossip, not truth. (The player's own spells are theirs, and work as the rules say.)",
  ],
  anchors: ["river-stairs", "rat-door", "bar", "rules-board", "fireside-corner", "card-table", "champions-chair", "scullery", "slop-hatch"],
  lore: ["Places/The Drowned Rat.md", "World/Caerwyn now.md"],
  fronts: "World/Fronts.md",
  assumes: ["Big Hobb Mallory, the big man with the bandaged hand, is still at large and hasn't told the player what he knows (he hasn't been caught, arrested or questioned yet). The player knowing who his master is doesn't change that."],
  world: drownedRatWorld,
  overtaken: "wharf-night",
};
