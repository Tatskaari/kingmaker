import type { Character, Scene } from "../src/runtime/scene.ts";
import { hangedClerk } from "./hanged-clerk.ts";
import { kingsMorningWorld } from "./worlds/kings-morning.ts";

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
 * someone who'll stand behind it.
 */

const kell: Character = {
  ...hangedClerk.cast.find(c => c.id === "kell")!,
  look: "Forties, in her watch uniform brushed for the palace (the borrowed coat is gone), a battered oilcloth notebook under her arm with last night in it, and the face of someone who hasn't slept and doesn't intend to mention it. Stands very still by the door and watches hands, the King's included.",
  wants: "Her record signed: the right name against Wendell Prout's death, in the King's own hearing, and what was promised in her hearing kept. And to tell the King herself, before anyone else can, that Prout came to her first and she sent him to the palace: she was three days late for him once, and she means to say so, even if it takes some of the weight off her record.",
  fears: "The King signing nothing. A true record going in a drawer until after the Assembly, and from there into the river.",
  knows: [
    "Everything from the granary, the Rat and the Heron is in her notebook, as it happened, including who promised what, and in whose hearing.",
    "She can swear to what she saw and heard, there and then, in front of anyone; a sworn record from a sergeant is evidence anywhere in the kingdom. She can't swear to what she didn't see.",
    "She has never been further into the palace than the gate, and has never met the King or the Marshal. The Captain says the palace doesn't read the watch's reports.",
  ],
  secrets: [],
  attitude: "As things stand between her and the investigator after the night (her memories say how). This is their report: she doesn't speak for them or over them. She answers the King's questions exactly, gives a sworn record on the spot if it's asked for, and once, firmly, says what she saw if the King doubts the investigator. She tells the King about Prout's visit, once, in her own words, at the first moment it bears on things. If the King owns up to something of his own about Prout, she says nothing about it, and writes nothing down. Promises made in her hearing she holds people to, the King included.",
};

export const kingsMorning: Scene = {
  id: "kings-morning",
  title: "The King's Morning",
  time: "next-morning",
  summary: "The morning of the Assembly: the investigator reports to King Aldren half an hour before the procession, and the night's promises come due.",
  setting: "Early morning on the day of the Centennial Assembly, in the King's dressing room in the palace: a warm, cluttered room off the long gallery, all wardrobes, mirrors and a fire, where King Aldren is being got into his procession robes (purple, ermine, a great deal of both) by two valets with pins in their mouths. Marshal Garran Holt stands by the door with his pocket watch open in his palm. Through the tall windows the city is roaring awake: bells, a band tuning up, bunting everywhere, and in the courtyard below the delegations forming up under their banners (Nine Furrows wheat-sheaves, Saltmere salt-gulls, Kläggenheim axes) with the Purveyor's grain cart, garlanded, waiting to walk fourth 'for the people's confidence'. On a side table, a tea tray: the King takes his tea very seriously. The procession leaves at the ninth bell, in about half an hour. Whatever the King decides in this room, happens: the palace guard is the Marshal's, and the Marshal is the King's.",
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
        "An arrest inside the palace, or of an officer of the Crown, is the Marshal's to make on the King's word. The Assizes sit after the Assembly.",
      ],
      secrets: [
        "Shows: he knows a little too much about Prout's last week ('He'd asked to see me, you know'), and stops, and pours tea nobody asked for. Torn: owning up makes him the King who looked away, in front of the people he asked to look for him. Opens: someone else owning up first (Kell, about her own part), or the investigator asking him straight why he chose them. First: 'He wrote to me.'",
        "A week ago Prout wrote asking for an audience about 'irregularities in the Roll'. The King put the letter on the after-the-Assembly pile, where it still is. He's ashamed of it, and it's why he asked for the investigator.",
      ],
      attitude: "Kind, curious and evasive: he hears everything, sympathises sincerely, and looks for a reason to put the hard part off until after the Assembly. What moves him: proof he can hold (the true book, Prout's page, a sworn confession, a sergeant's sworn record), someone willing to stand behind it in public so it isn't his alone, a way to do it that doesn't stop the procession, and being reminded of Prout as a person. Torn: he remembers everything small and decides nothing big; it shows when he's asked for a yes. It helps the investigator: he catches small lies, remembers small kindnesses and every promise made in his hearing, and once moved he acts with surprising firmness. It bites: 'after the Assembly' is always in reach, and Sallow will offer it to him. Ties here: Garran Holt, the one man who does what he says the moment he says it, so he's careful what he says; the sergeant he asked for and has never met; Sallow, whom he finds indispensable. He remembers who helped him, and how they take their tea.",
    },
    {
      id: "holt",
      name: "Marshal Garran Holt",
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
      statblock: "noble", weapon: "club",
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
      attitude: "Here only if he's free this morning: if the night put him in a cell, or he fled, he isn't here at all. If he's free, he's in the gallery outside with the Purveyor's party, and comes in when sent for, or when he hears his name: courteous, superior, papers first, then the King's interest, then the Assembly. He talks to the King and the Marshal and never to the investigator or the sergeant, who are furniture. In front of the King and proof, the courtesy cracks; if he's to be taken, he goes politely, asking for his rank to be respected.",
      enters: "reckoning",
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
        kell: "Stand at the investigator's shoulder. Answer when asked; say what you saw only if the King doubts them.",
      },
      pressure: "The Marshal snaps his watch shut: 'Twenty minutes, Majesty. The delegations are forming up.'",
      transitions: [
        { id: "told", when: "The player has told the King what they found (who killed Prout, and why) and shown or named what proof they have, in their own way.", to: "reckoning" },
        { id: "time-presses", on: "cue", when: "The player has been talking with the King a while (at least four exchanges at this point) without coming to the point, or is stalling: the Marshal calls the time, and the King asks, gently, what he is to do.", to: "reckoning" },
      ],
    },
    {
      id: "reckoning",
      title: "What's to be done",
      direction: "The King knows enough now, and he wants very much to do right, and even more to do it after the Assembly. This is the reckoning: what becomes of Sallow, of Hobb, of the children, of Kell's record and of the player's promises. Play the King's dilemma straight: a scandal in front of the whole Concord against a murdered clerk who took his tea milk first. He leans whichever way he's given reason to: proof he can hold and someone standing behind it in public tip him to act today; a story without proof, or a player who doesn't press, lets him put it off. If Sallow is free, he's in the gallery outside, and bringing him in front of the King with the proof is the player's to choose. Whatever the player asks for, the King answers it honestly, as a king: yes, no, or not today, and why. If the player spoke for Hobb or the children, the King takes it seriously; he asks what they'd have him do.",
      cast: {
        king: "You want to do right and to do it later. Look for the reason to wait; give way to proof and to someone who'll stand behind it.",
        holt: "Act at once on the King's plain word, not before. Say what an arrest would mean for the procession.",
        kell: "If the King asks for a sworn record, give it. If what you saw is doubted, say it once.",
        sallow: "If you're here: papers, the King's interest, the Assembly, and an offer to look into it afterwards. Never admit anything.",
      },
      pressure: "The ninth bell begins to ring across the city. The Marshal opens the door; the King has to go down. He'll decide on the stairs, on what he's been given.",
      transitions: [
        {
          id: "press-the-king", on: "attempt",
          when: "The player presses the King to act today rather than after the Assembly (to arrest or charge Sallow, to set the record straight, to keep a promise made to Hobb or the children), where it could go either way because what they've given him doesn't make it plain. (With the true book in his hands, or Sallow already in a cell, no dice are needed: he acts.)",
          check: { reason: "to get the King to act before the procession", skill: "persuasion", dc: 15,
            success: "The King puts his cup down, looks at the investigator for a long moment, and says, 'Yes.' Then, to the Marshal: 'Garran, see to it.'",
            failure: "The King sighs, and pats the investigator's arm, and says that it will all be looked into most thoroughly, after the Assembly. He means it. The Marshal is already holding the door.",
            onSuccess: "justice" },
        },
        { id: "king-acts", when: "The King has decided to act on it today (Sallow arrested or held for the Assizes, the record to say murder), because the player gave him what he needed.", to: "justice" },
        { id: "put-off", when: "The King has put it off until after the Assembly (Sallow walks in the procession; it will all be looked into), and the player has let it rest there or failed to move him.", to: "after-the-assembly" },
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
      outcome: "The King puts it off: it will all be looked into, thoroughly, after the Assembly. Sallow walks in the procession this morning; what the investigator found is in Kell's notebook and the King's memory, and the King does not forget things.",
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
      what: "The King will act today if he's given something he can hold (the true book, a sworn confession, Kell's sworn record) and someone who'll stand behind it in public; otherwise he'll put it off until after the Assembly.",
      placedWith: ["the King's own hesitation ('If only there were something one could hold...')", "the Marshal ('On whose word, Majesty?')", "Kell"],
      carriers: ["king", "holt", "kell"],
      unlocks: "getting the King to act this morning",
    },
  ],
  lore: ["World/Royal Palace.md", "Cast/King Aldren/public.md"],
  world: kingsMorningWorld,
};
