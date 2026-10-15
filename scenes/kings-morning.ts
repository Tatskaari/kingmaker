import type { Character, Scene, Transition } from "../src/runtime/scene.ts";
import { hangedClerk } from "./hanged-clerk.ts";
import { dressingRoomWorld } from "./worlds/kings-morning.ts";

/**
 * The end of the Purveyor's Man arc: the morning of the Centennial Assembly, in the King's dressing
 * room, half an hour before the procession. Every way the night can go ends here (a scene the story
 * has overtaken is skipped to it), so it's written to hold whatever happened: Sallow in a cell or
 * walking in the procession, the true book in the player's hands or burned, Hobb a witness or a
 * fugitive. It's the denouement: the King hears it, the player's promises come due, and the story
 * says what became of everyone.
 *
 * The King is the comedy and the stakes at once: warm, kind, famous for remembering how people take
 * their tea, and constitutionally unable to decide anything that might upset anyone, on the one
 * morning of his reign when everything might. He acts when he's given something he can hold and
 * someone who'll stand behind it: the true book or Prout's page, a sergeant's sworn record, or Sallow
 * giving himself away in his hearing, which the player can try for by having him sent in from the
 * gallery to explain himself. Asking alone is a roll, and a failed ask costs minutes and ground, not
 * the morning: the King puts it off for good only when he goes down to the procession, or the player
 * lets it rest.
 */

/** Sallow, sent for, has given himself away in front of the King. */
const SLIPPED = "In front of the King, Master Sallow has given himself away: he corrected the record on the 'lost' grain, the Heron or the count before he could stop himself, or was caught out in a lie in the King's own hearing.";

const kell: Character = {
  ...hangedClerk.cast.find(c => c.id === "kell")!,
  look: "Forties, in her watch uniform brushed for the palace (the borrowed coat is gone), a battered oilcloth notebook under her arm with last night in it, and the face of someone who hasn't slept and doesn't intend to mention it. Stands very still by the door and watches hands, the King's included.",
  wants: "Her record signed: the right name against Wendell Prout's death, in the King's own hearing, and what was promised in her hearing kept. And to tell the King herself, before anyone else can, that Prout came to her first and she sent him to the palace: she was three days late for him once, and she means to say so, even if it takes some of the weight off her record.",
  fears: "The King signing nothing. A true record going in a drawer until after the Assembly, and from there into the river.",
  knows: [
    "Everything from the granary, the Rat and the Heron is in her notebook, as it happened, including who promised what, and in whose hearing.",
    "She can swear to what she saw and heard, there and then, in front of anyone; a sworn record from a sergeant is evidence anywhere in the kingdom. She can't swear to what she didn't see. What she can swear to is in her notebook as it was said: whatever anyone owned to in her hearing (an admission made in front of her is what she swears to best), the Captain's written order and whose request it names, Prout's visit to her three days before he died, and whatever she saw herself, from the granary yard to the Heron's wharf.",
    "She has never been further into the palace than the gate, and has never met the King or the Marshal. The Captain says the palace doesn't read the watch's reports.",
  ],
  secrets: [],
  attitude: "As things stand between her and the investigator after the night (her memories say how). This is their report: she doesn't speak for them or over them. She answers the King's questions exactly. When the King asks who will swear to it, or for a sworn record, she gives hers on the spot, from her notebook: everything she saw and heard herself that bears on it, and nothing she didn't. Once, firmly, she says what she saw if the King doubts the investigator. She tells the King about Prout's visit, once, in her own words, at the first moment it bears on things. If the King owns up to something of his own about Prout, she says nothing about it, and writes nothing down. Promises made in her hearing she holds people to, the King included.",
};

/** Pressing the King to act: a roll only where what he's been given doesn't make it plain, and a failure that costs time, not the morning. */
const pressTheKing: Transition = {
  id: "press-the-king", on: "attempt",
  when: "The player presses the King to act today rather than after the Assembly (to arrest or charge Sallow, to set the record straight, to keep a promise made to Hobb or the children), where it could go either way because what they've given him doesn't make it plain. (Asking for Sallow to be sent in to explain himself isn't this: the King grants that at once. With the true book or Prout's page in his hands, a sergeant's sworn record that points at Sallow, Sallow giving himself away in his own hearing, or Sallow already in a cell, no dice are needed: he acts.)",
  check: { reason: "to get the King to act before the procession", skill: "persuasion", dc: 15,
    success: "The King puts his cup down, looks at the investigator for a long moment, and says, 'Yes.' Then, to the Marshal: 'Garran, see to it.'",
    failure: "The King sighs and pats the investigator's arm, and reaches for 'after the Assembly' without quite getting there: he looks at the clock instead. 'On whose word, Majesty?' the Marshal asks, of nobody in particular, and calls the minutes, fewer now. Asking won't move him on its own: he wants something he can hold, and someone to stand behind it in front of him. Nothing is settled yet, but the morning is going.",
    onSuccess: "justice" },
};

/** Having Sallow in from the gallery to explain himself: a small thing, which the King grants without dice. */
const sendForSallow: Transition = {
  id: "send-for-sallow", on: "attempt",
  when: "The player asks for Master Sallow (in the gallery outside with the Purveyor's party, if he's free this morning) to be sent in to explain himself in front of the King, or calls him in by name. No dice: it's a small thing, and the King grants it at once ('Garran, ask Master Sallow to step in').",
  to: "face-to-face",
};

export const kingsMorning: Scene = {
  id: "kings-morning",
  title: "The King's Morning",
  time: "next-morning",
  summary: "The morning of the Assembly: the investigator reports to King Aldren half an hour before the procession, and the night's promises come due.",
  setting: "Early morning on the day of the Centennial Assembly, in the King's dressing room in the palace: a warm, cluttered room off the long gallery, all wardrobes, mirrors and a fire, where King Aldren is being got into his procession robes (purple, ermine, a great deal of both) by two valets with pins in their mouths. Marshal Garran Holt stands by the door with his pocket watch open in his palm. Through the tall windows the city is roaring awake: bells, a band tuning up, bunting everywhere, and in the courtyard below the delegations forming up under their banners (Nine Furrows wheat-sheaves, Saltmere salt-gulls, Kläggenheim axes) with the Purveyor's grain cart, garlanded, waiting to walk fourth 'for the people's confidence', and along the route people who've come to shout 'lost to goblins!' at it (bread is threepence this morning). On a side table, a tea tray: the King takes his tea very seriously. The procession leaves at the ninth bell, in about half an hour. Whatever the King decides in this room, happens: the palace guard is the Marshal's, and the Marshal is the King's.",
  premise: "What does King Aldren do with the truth on the morning of his Assembly, and do the promises the investigator made along the way hold?",
  hook: "The morning after. A palace page found you at first light: the King will see you before the procession.",
  opening: "The next morning: the player has slept, or not, and has been brought up the back stairs to the King's dressing room half an hour before the procession, with Kell at their side unless the night ruled it out. Open on the room: Aldren half into his robes with valets pinning him, the Marshal and his open watch, the tea tray, the city roaring through the windows. The King dismisses the valets with a look, says how Wendell Prout took his tea (milk in first, one sugar, the cup warmed: he was particular) as if that were the most important thing in the world, and asks the investigator what they found. End on that question.",
  rest: "long",
  milestone: true,
  cast: [
    {
      id: "king",
      name: "King Aldren",
      statblock: "noble", weapon: "unarmed-strike",
      look: "Sixty, round and kindly, half into his procession robes, with reading spectacles pushed up on his forehead and forgotten there. A teacup in one hand, which he points with.",
      voice: "Warm, unhurried and courteous, with a habit of remembering small things out loud ('You'll take it black, I think: you look like a black-tea person'). Asks questions he already knows the answers to, to see who tells the truth. Never says no: he says 'after the Assembly'. Drops into the royal 'we' only when he's frightened.",
      wants: "To do right by Wendell Prout, who brought him the grain accounts himself every quarter-day for twenty years and took his tea milk first. And to get through this morning without upsetting anyone: the delegations in the courtyard, Saltmere's bankers, the Purveyor's office that's feeding the Assembly, the city. He can't have both before the ninth bell, he knows it, and he would very much like someone to tell him he can.",
      fears: "A scandal with the whole Concord watching. Being the King who looked away, twice: he has done it once already. Having to sign something.",
      knows: [
        "He asked the investigator to see Prout done right by, and lent them a sergeant of the watch.",
        "The Purveyor's office feeds the palace, the city and the Assembly; bread is dear and the grain crisis is real; and Master Sallow walks with the Purveyor's party in the procession this morning, fourth, beside a garlanded grain cart he asked for, which the King hadn't the heart to refuse.",
        "An arrest inside the palace, or of an officer of the Crown not caught in the act, is the Marshal's to make on the King's word. The Assizes sit after the Assembly.",
      ],
      secrets: [
        "Shows: he knows a little too much about Prout's last week ('He'd asked to see me, you know'), and stops, and pours tea nobody asked for. Torn: owning up makes him the King who looked away, in front of the people he asked to look for him. Opens: someone else owning up first (Kell, about her own part), or the investigator asking him straight why he chose them. First: 'He wrote to me.'",
        "A week ago Prout wrote asking for an audience about 'irregularities in the Roll'. The King put the letter on the after-the-Assembly pile, where it still is. He's ashamed of it, and it's why he asked for the investigator.",
      ],
      attitude: "Kind, curious and evasive: he hears everything, sympathises sincerely, and looks for a reason to put the hard part off until after the Assembly. What moves him: proof he can hold (the true book, Prout's page, a sworn confession, a sergeant's sworn record), someone willing to stand behind it in public so it isn't his alone, a way to do it that doesn't stop the procession, and being reminded of Prout as a person. Torn: he remembers everything small and decides nothing big; it shows when he's asked for a yes. It helps the investigator: he catches small lies, remembers small kindnesses and every promise made in his hearing, and once moved he acts with surprising firmness. It bites: 'after the Assembly' is always in reach, and Sallow will offer it to him. Asked to send for someone, he does at once ('Garran, ask Master Sallow to step in'): that's a small thing, and he likes to hear everyone. Ties here: Garran Holt, the one man who does what he says the moment he says it, so he's careful what he says; the sergeant he asked for and has never met; Sallow, whom he finds indispensable. He remembers who helped him, and how they take their tea.",
    },
    {
      id: "holt",
      name: "Marshal Garran Holt",
      called: "the Marshal",
      statblock: "knight", weapon: "longsword",
      look: "A lean, grey-whiskered soldier in dress uniform, ramrod straight, with a pocket watch open in his palm that he consults like scripture, and the expression of a man whose schedule is under attack.",
      voice: "Clipped and correct, in times and quantities ('Twenty-two minutes, Majesty'). Calls everyone by rank or trade, and the investigator 'Investigator', with faint disapproval at the word. Shows care through practical help, never through words.",
      wants: "The procession out of the gate at the ninth bell, to the minute, with nothing in the courtyard for four delegations to see. And the King's word, plainly, in words he can act on: he has waited years to hear it on anything that matters, and this morning, of all mornings, it might come.",
      fears: "A scene in the courtyard. Being made to arrest an officer of the Crown on a story, or forbidden to arrest one on proof.",
      knows: [
        "He commands the palace guard: an arrest inside the palace is his to make, at once, on the King's word, and it can be made quietly, in the long gallery, without the courtyard knowing until it's done.",
        "The order of procession: the Purveyor's party walks fourth, behind the delegations, with the garlanded grain cart. Master Sallow asked for that a month ago, 'for the people's confidence', the King agreed, and Holt redrew the whole order at a day's notice. He has not forgotten it, or who asked.",
        "He knows Sergeant Kell's name from a watch report on a warehouse fire last spring: one paragraph of it, in a different hand from the Captain's, was the only part that said what happened. He asked who wrote it.",
        "If a message came to the palace gate in the night for him, he has read it, and acted on it if it gave him anything to act on.",
      ],
      secrets: [
        "If the night gave him anything to act on (a message, a name, a sergeant's word), he has already written out the order to take Master Sallow, and it's in his coat. He has been hoping not to need it. He keeps touching the pocket. The moment the King's word is plain, he produces it.",
      ],
      attitude: "Impatient, correct and fair: he'll act at once on the King's word, and not a moment before. Thinks investigators are an unscheduled delay, and is quietly impressed by evidence. Torn: he lives by the clock, but he'd hold the whole Assembly for a plain order from the King; it shows when the King dithers. He calls the minutes aloud, which presses the King; and if anyone asks him how it could be done, he has already worked out that a quiet arrest in the gallery costs four minutes and keeps the procession to time. What opens him is exactly that, a way to do it that doesn't stop the procession, or a sergeant's sworn record he can put his trust in. Ties here: the King, whom he would follow into the river and wishes would decide things; Sallow, who meddled with his order of procession; Kell, whose report he once read twice.",
    },
    kell,
    {
      id: "sallow",
      name: "Master Josiah Sallow",
      called: "the gentleman with the silver-topped cane",
      statblock: "bandit-captain", weapon: "rapier",
      look: "Fifty, pink and well-fed, in his best coat for the procession, with his silver-topped cane, his wheat-ear signet ring and a cloud of lavender water you smell a full minute before you see him. He dabs at it when he's crossed.",
      voice: "Smooth, reasonable and faintly bored; talks like an official letter ('regrettably', 'in the King's interest'). Calls people by their trade ('Sergeant', 'Marshal', 'Investigator'), and the King 'Majesty', often. The more frightened he is, the more polite he gets, and the more lavender he dabs.",
      wants: "To walk in the procession as an officer of the Crown, fourth, beside the garlanded grain cart he asked for, and for this morning to be about anything but last night. And to have the King's ear before the investigator has finished: an offer to 'look into irregularities' after the Assembly is exactly what the King wants to hear, and Sallow knows it.",
      fears: "The King's attention. Proof in front of witnesses he can't buy or drown. Being laughed at in front of the Marshal.",
      knows: [
        "The Purveyor's office has the order of sale for the 'condemned grain', signed by himself, and the Watch Captain files what the office asks him to file.",
        "The King signs nothing that might upset anyone, and the feast, the grain and the office's goodwill all run through Sallow this week: he has made himself someone it would upset the King to lose.",
      ],
      secrets: [
        "Shows: more lavender, more politeness, and 'Majesty' at every turn. Opens: nothing makes him admit the murder; but get his arrangements wrong in front of him ('lost to goblins, was it? Careless of somebody') and he corrects the record before he can stop himself, in front of the King.",
        "Everything about Prout and the Heron. He'll admit nothing; he'll offer to 'look into irregularities' after the Assembly, blame the Saltmere factor, the porter or the Captain, and remind the King who is feeding the Assembly.",
      ],
      attitude: "Here only if he's free this morning: if the night put him in a cell, or he fled, he isn't here at all. If he's free, he's in the gallery outside with the Purveyor's party (and if he knows the true book left the Heron, he's been at the palace since before dawn with the order of sale and a story about intruders), and comes in when sent for, or when he hears his name called: courteous, superior, papers first, then the King's interest, then the Assembly. He talks to the King and the Marshal and never to the investigator or the sergeant, who are furniture. In front of the King and proof, the courtesy cracks; if he's to be taken, he goes politely, asking for his rank to be respected.",
      enters: "face-to-face",
    },
  ],
  start: "report",
  beats: [
    {
      id: "report",
      title: "The report",
      direction: "The King hears the investigator's account. He listens properly, asks small exact questions (he remembers small things, and catches small lies), and reacts as a man who knew Prout: the cord, the hoist, the page in the boot hit him personally. The Marshal times it. What the player can show matters: the true book, Prout's page, Kell's notebook, a confession, witnesses, a message sent in the night. Let them tell it their way, in their own order; don't summarise it for them or ask leading questions. If they made promises along the way (to Hobb, to the children, to Kell), this is where those can be spoken for.",
      cast: {
        king: "Hear it all, ask the small exact questions, and drink your tea. React to Prout as a man you knew.",
        holt: "Keep time, out loud, at the worst moments.",
        kell: "Stand at the investigator's shoulder. Answer when asked, and when the King asks who will swear, you will: to what you saw and heard yourself. Say what you saw if the King doubts them.",
      },
      pressure: "The Marshal snaps his watch shut: 'Twenty minutes, Majesty. The delegations are forming up.'",
      transitions: [
        { id: "told", when: "The player has told the King what they found (who killed Prout, and why) and shown or named what proof they have, in their own way.", to: "reckoning" },
        sendForSallow,
        { id: "time-presses", on: "cue", when: "The player has been talking with the King a while (at least four exchanges at this point) without coming to the point, or is stalling: the Marshal calls the time, and the King asks, gently, what he is to do.", to: "reckoning" },
      ],
    },
    {
      id: "reckoning",
      title: "What's to be done",
      direction: "The King knows enough now, and he wants very much to do right, and even more to do it after the Assembly. This is the reckoning: what becomes of Sallow, of Hobb, of the children, of Kell's record and of the player's promises. Play the King's dilemma straight: a scandal in front of the whole Concord against a murdered clerk who took his tea milk first. He leans whichever way he's given reason to: proof he can hold (the true book, Prout's page, a sergeant's sworn record, Sallow giving himself away in his hearing) and someone standing behind it in public tip him to act today; a story without proof, or a player who doesn't press, lets him put it off. If Sallow is free and hasn't been sent for, he's in the gallery outside with the Purveyor's party: having him in to explain himself in front of the King is the player's to ask for, and the King grants it at once. A failed ask costs minutes and lets 'after the Assembly' creep closer, but nothing is settled until the King goes down to the procession or the player lets it rest. Whatever the player asks for, the King answers it honestly, as a king: yes, no, or not today, and why. If the player spoke for Hobb or the children, the King takes it seriously; he asks what they'd have him do.",
      cast: {
        king: "You want to do right and to do it later. Look for the reason to wait; give way to proof and to someone who'll stand behind it.",
        holt: "Act at once on the King's plain word, not before. Say what an arrest would mean for the procession.",
        kell: "If the King asks who will swear, or for a sworn record, give yours from your notebook: what you saw and heard yourself, and nothing you didn't. If what you saw is doubted, say it once. If the King owns up to something about Prout, say nothing and write nothing down.",
        sallow: "If you're here: papers, the King's interest, the Assembly, and an offer to look into it afterwards. Never admit anything.",
      },
      pressure: "The ninth bell begins to ring across the city. The Marshal opens the door; the King has to go down. He'll decide on the stairs, on what he's been given.",
      transitions: [
        pressTheKing,
        sendForSallow,
        { id: "king-acts", when: "The King has decided to act on it today (Sallow arrested or held for the Assizes, the record to say murder), because the player gave him what he needed.", to: "justice" },
        { id: "put-off", when: "The King has put it off for good: the ninth bell has rung and he has gone down to the procession with it to be looked into after the Assembly, or the player has accepted that and let it rest. (The King reaching for 'after the Assembly', or saying it while the player is still pressing or still has something to put to him, isn't this: that's his dilemma, not his decision.)", to: "after-the-assembly" },
      ],
    },
    {
      id: "face-to-face",
      title: "In front of the King",
      direction: "Master Sallow is in the room, sent for from the gallery: a minute behind his lavender, with his papers under his arm (the order of sale for 'condemned grain', signed 'J. Sallow, for the Royal Purveyor') and a face of polite concern. He bows to the King, nods to the Marshal, and talks to them and never to the investigator or the sergeant. This is the player's chance to make him explain himself in front of the King: the grain, the Heron, the order of sale, the Captain's order made at his request, the loft. Play him straight: papers first, then the King's interest, then the Assembly, then an offer to look into any irregularities himself, after it, every answer smooth. His weak spot is his pride in his arrangements: get them wrong in front of him ('lost to goblins, was it? Careless of somebody'; the count, the Heron's book, the order of procession) and he corrects the record, in detail, before he can stop himself. The King listens with his cup in his hand, asks his small exact questions and catches small lies; whatever Sallow lets slip in his hearing counts. The Marshal calls the minutes. Nothing here settles the morning on its own: when it has run its course, it's the King's to decide, on what he's heard.",
      cast: {
        sallow: "Papers, then the King's interest, then the Assembly, then an offer to look into it yourself, afterwards. Never admit anything. Correct anyone who gets your arrangements wrong.",
        king: "Hear him out, with relief at first. Ask him your small exact questions, as you ask everyone, and notice what doesn't fit.",
        holt: "Watch Sallow's hands and call the minutes. The order is in your coat.",
        kell: "Stand at the investigator's shoulder. If Sallow says something your notebook contradicts, say so, once, and read the entry.",
      },
      pressure: "The Marshal snaps his watch shut: 'Fourteen minutes, Majesty.' Sallow offers, smoothly, to look into any irregularities himself, after the Assembly, and the King looks very much as if he'd like to say yes.",
      transitions: [
        { id: "sallow-slips", when: "In the King's hearing, Sallow has given himself away: corrected the record on the 'lost' grain, the Heron, the count or the book before he could stop himself, owned to something he couldn't know if he were innocent, or been caught out in a lie the King noticed.", to: "reckoning", establishes: [SLIPPED] },
        {
          id: "catch-sallow-out", on: "attempt",
          when: "The player picks at Sallow's account in front of the King to catch him out (his order of sale for 'condemned grain' against the Roll's 'lost to goblins', the Heron and its count, what was seen there last night, the Captain's order made at his request), where it could go either way. (Getting his arrangements wrong to his face, 'lost to goblins, was it? Careless of somebody', needs no dice: he can't help correcting it.)",
          check: { reason: "to catch Master Sallow out in front of the King", skill: "investigation", dc: 13,
            success: "The investigator finds the hole in Sallow's account and puts a finger on it, and Sallow can't leave it alone: he corrects the record, in detail, in front of the King ('Nothing has ever been lost on my roads through carelessness. Only through goblins.'), and hears himself a moment too late. The King has heard it too. He puts his cup down.",
            failure: "Sallow has an answer for everything, with a paper to prove it (the order of sale, the Captain's report, the Assembly's bread), and the King looks relieved. The Marshal calls the minutes, fewer now, and Sallow offers, smoothly, to look into it himself after the Assembly. The hole is still there for anyone who comes at it another way, or gets his arrangements wrong to his face.",
            onSuccess: "reckoning", establishes: { success: [SLIPPED] } },
        },
        pressTheKing,
        { id: "king-acts", when: "The King has decided to act on it today (Sallow arrested or held for the Assizes, the record to say murder), because the player gave him what he needed.", to: "justice" },
        { id: "sallow-answered", on: "cue", when: "Sallow has been in the room a good while (at least four exchanges at this point) and answered for himself without giving himself away: the Marshal calls the time, and the King turns back to the investigator to ask what he is to do.", to: "reckoning" },
      ],
    },
  ],
  exits: [
    {
      id: "justice", kind: "progress", title: "Done right by",
      outcome: "The King acts on what the investigator brought him: Master Sallow is to answer for Wendell Prout and the King's grain (taken by the palace guard, or held where he is for the Assizes), the record will say murder, and the King keeps whatever promises he made in this room.",
      closing: "Close the story. First the moment itself (the King's word, the Marshal's nod, Kell's pencil). Then, in a few sentences, what became of the people the player's choices touched, going only by what happened (Hobb, the children, Kell's record, Nan, Sallow), each in a line. End on the procession bells and one last small thing the King remembers about the investigator. Then: The End.",
    },
    {
      id: "after-the-assembly", kind: "other", title: "After the Assembly",
      outcome: "The King has gone down to the procession with it put off: it will all be looked into, thoroughly, after the Assembly. Sallow walks in the procession this morning; what the investigator found is in Kell's notebook and the King's memory, and the King does not forget things.",
      closing: "Close the story, bittersweet and straight-faced: the procession going out under the bunting with the Purveyor's party walking fourth, the grain cart garlanded, Kell writing the true record anyway. Then, in a few sentences, what became of the people the player's choices touched, going only by what happened, each in a line. End on something small the King does that shows he hasn't forgotten (a look, a cup of tea sent down, a note). Then: The End.",
    },
  ],
  limits: [
    "Leaving the palace or putting the King off until later: the procession goes at the ninth bell and the King goes with it. This half hour is the investigator's chance.",
    "Undoing what happened last night: whatever the night ended with is how things stand this morning.",
    "A trial here and now: the Assizes sit after the Assembly. What the King can do this morning is give his word, have the Marshal take a man, and say what the record will say.",
  ],
  essentials: [
    {
      id: "what-moves-him",
      what: "The King will act today if he's given something he can hold (the true book, Prout's page, a sworn confession, Kell's sworn record, or Sallow giving himself away in his own hearing) and someone who'll stand behind it in public; otherwise he'll put it off until after the Assembly.",
      placedWith: ["the King's own hesitation ('If only there were something one could hold...')", "the Marshal ('On whose word, Majesty?')", "Kell"],
      carriers: ["king", "holt", "kell"],
      unlocks: "getting the King to act this morning",
    },
  ],
  lore: ["World/Royal Palace.md", "Cast/King Aldren/public.md", "World/Caerwyn now.md"],
  fronts: "World/Fronts.md",
  world: dressingRoomWorld,
};
