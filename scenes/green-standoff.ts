import type { Scene } from "../src/runtime/scene.ts";
import type { SceneOutcome, WorldApi } from "../src/world/dsl.ts";

/**
 * BG3's Emerald Grove standoffs (Aradin vs Zevlor at the gate, Kagha judging Arabella) moved to a
 * Nine Furrows village green (docs/research/scene-sources.md §5.5, §7.3). Four people with
 * conflicting wants each make their case to the party, who arrive just in time to be the
 * "stranger's eye" a ward-judgment needs. Two linked knots: a refugee child who stole the ward's
 * corn mother faces the thief's mark (BG3's two appeals: a failed appeal opens one last, different
 * chance, and a second failure is final), and at sundown the ward will turn thirty-one flood
 * refugees out. The clever routes live in secrets: Pip's apology is Hester's face-saving way out,
 * and the Statutes' old guest-right (bread and salt at the bounds-stone) would let the ward take the
 * refugees in; Oswin half-remembers it as a saying. Escalation runs soft to hard (a flashpoint beat
 * before any brawl), and a party that only watches gets the default: the mark, then the ward.
 */

/** Recorded when the mark is actually set, so every ending can carry it into the world. */
const PIP_MARKED = "Hester has set the thief's mark on Pip's brow: a grey thumbprint that won't wash off for a year and a day.";

function carryMark(world: WorldApi, outcome: SceneOutcome): void {
  if (!outcome.established.includes(PIP_MARKED)) return;
  world.mark({ text: "The thief's mark: a grey thumbprint of ash and chalk, for a year and a day", on: world.character("pip"), how: "chalked" });
  world.setFlag("pip_marked", true);
}

export const greenStandoff: Scene = {
  id: "green-standoff",
  title: "Standoff on Harrowby Green",
  summary: "A child in a chalk ring, a ward that will turn thirty-one flood refugees out at sundown, and four people who all want the stranger on their side.",
  setting: "Harrowby, a Nine Furrows village where the drovers' track runs straight across a broad common green, an hour before sundown on ward-night, the eve of the Centennial Assembly. Round the green: a duck pond, a well with a stone head, a spreading old moot-oak, a bakehouse breathing out the smell of the day's loaves, and the church tower throwing a long shadow. Where the track enters the parish stands the bounds-stone, a waist-high grey stone with an empty niche cut in its face. On the far side of the green, nine mud-caked carts from flooded Sedgeford stand in a half-circle with tarpaulins strung between them: washing on lines, a smoky cooking fire, two cows, and a great many geese who go wherever they like. Forty-odd villagers with hayforks and rakes are bunched by the well; the Sedgeford folk stand by their carts, a few lads gripping eel-spears. Two bounds-men, Abel Furlong the smith and his son Cob, stand at the ward-keeper's back with cudgels. In the middle of it all a child sits in a ring of chalk and salt. Woodsmoke, wet goose, and somebody's porridge catching.",
  premise: "Before the sun goes down and the ward goes up, can the party find a way through Harrowby's fear and Sedgeford's need? Will the child who stole the corn mother be marked a thief, and will thirty-one flood refugees be turned out onto a goblin-haunted road?",
  hook: "The drovers' track brings you into Harrowby, a Nine Furrows village, an hour before sundown on the eve of the Centennial Assembly. The track runs straight across the village green, and the green is full of shouting.",
  opening: "Describe the green in the low sun and the two crowds facing each other across it: villagers with hayforks by the well, mud-caked refugees among their carts and geese. In the middle, a small girl sits cross-legged inside a ring of chalk and salt, arms folded, chin up. Over her stands a thin young woman in a green University gown, a straw doll tied at her belt and grey ash on her thumb; a stooped old man pleads with her; a big lad with an eel-spear shouts about goblins. Don't explain the quarrel or name anyone yet. End with the young woman noticing the party and claiming them, with visible relief, as the stranger's eye her Statutes require at a ward-judgment.",
  cast: [
    {
      id: "hester",
      name: "Hester Quill",
      look: "Late twenties, thin and upright in a moss-green University gown hitched up out of the mud, ink on her fingers, a chain of nine little iron ploughshares at her neck, grey ash-and-chalk on her right thumb. The corn mother, a plaited straw doll with an ear of wheat for a heart, is tied at her belt, and one hand is always on it.",
      voice: "Precise and statutory, with a Statute for most occasions (by chapter and furrow). Gets more formal, not louder, when she's frightened. Dry, and sometimes very funny without meaning to be.",
      wants: "To raise the bounds-ward at sundown exactly by the book, so that Harrowby is safe from the goblins on the one night she's in charge; and to see the theft of the corn mother answered, so nobody thinks the ward can be trifled with.",
      fears: "Goblins in the village on her watch. Getting the ward wrong in front of the whole parish. The Master Warden hearing that she made a mess of it.",
      knows: [
        "She is acting ward-keeper: the Master Warden, old Bede Applegarth, is at the Centennial Assembly in Caerwyn with the Nine Furrows delegation. On ward-night the ward-keeper speaks for the parish.",
        "The bounds-ward goes up at sundown on ward-night, which is tonight: the ward-keeper walks the parish bounds with the corn mother and sets it in the niche of the bounds-stone. It hurts nobody. Anyone inside the bounds who isn't of the parish simply remembers urgent business elsewhere and leaves, and can't settle to stay until the ward comes down at spring sowing. Goblins included, which is the point. Outside the bounds it does nothing at all.",
        "The Sedgeford folk aren't of the parish, so the ward will turn them out. She's sorry about it, in a dry way, but a ward with holes in it is no ward.",
        "Goblins have been seen in Harrowby's turnip field two nights running; a goose and a sack of turnips are gone.",
        "This morning Pip Callow took the corn mother from the bounds-stone, and Hester caught her at the duck pond with it under her smock. Under the Statutes, theft from the ward is answered with the thief's mark (a grey thumbprint of ash and chalk on the brow that won't wash off for a year and a day, so everyone in the Nine Furrows knows), unless the thief makes amends before the parish. Pip won't apologise.",
        "A ward-judgment needs a stranger's eye: someone not of the parish must witness it, and may speak to its fairness before it's done. A witness's objection doesn't stop the judgment; it has to be written in the parish book for the Master Warden to read, which is all it does (and which Hester dreads). She has been waiting all afternoon for a stranger to come down the track.",
        "Pip is in a stay-ring, the chalk-and-salt circle wardens use to keep a straying cow in one place. It doesn't hurt; you just don't feel like stepping over the line. Anyone outside it can scuff it open.",
      ],
      secrets: [
        "She has never set a thief's mark, or raised the bounds-ward on her own: the Master Warden always did both. She announced the mark in a temper in front of the whole village and is praying Pip will take the way out and apologise, because she doesn't want to mark a child and can't see how to back down without looking weak. An apology, or any face-saving reason, would let her stop with relief.",
        "The Statutes have an old guest-right: anyone who has broken the parish's bread and salt with a parishioner at the bounds-stone is of the parish to the ward for as long as it stands. It has to be a parishioner's bread (any Harrowby household, Hester included): a stranger's bread counts for nothing. Making the Sedgeford folk guests would let the ward take them in. She knows it and hasn't said, because she's afraid a ward stretched over thirty-one more souls will run thin and she isn't sure she can hold it (in truth it would hold: the Master Warden once stretched it over a whole harvest fair; it's her nerve that's thin), and because half the village already grumbles about feeding them. A general plea or question about shelter or letting them stay gets a deflection (the ward knows its own). She won't bring the clause up or hint at it herself, however moving the plea. She admits it only if someone asks about guests, bread and salt or old customs in so many words (then she won't lie about the Statutes), or once a roll to win her over has succeeded.",
      ],
      attitude: "Relieved a stranger has turned up to witness; brisk and defensive, and expects them to back the Statutes.",
    },
    {
      id: "oswin",
      name: "Oswin Thatcher",
      look: "Sixty, tall and stooped, river mud dried grey to the knees, the brass head of his reeve's staff fixed to a broom handle (the staff itself floated away), and a careful, much-mended courtesy.",
      voice: "Soft, slow and formal. Apologises before he asks for anything, calls people 'friend', and measures time in river terms: when the water goes down.",
      wants: "One more week on Harrowby green for his thirty-one people, until the water goes down at Sedgeford; Pip spared the mark; and nobody blaming Sedgeford for the goblins.",
      fears: "Being turned out onto the drovers' track at night with the old and the little ones and goblins about. Ned getting the lads killed. Losing what's left of Harrowby's goodwill by making a scene.",
      knows: [
        "He is the reeve of Sedgeford, a river village a day downstream. The river came over its banks four nights ago and the water's still in the houses; in a week or two they can go back and dig out.",
        "Thirty-one people, nine carts, two cows and a great many geese. Harrowby gave them the green two days ago, kindly enough, but everyone understood it was only until ward-night.",
        "Goblins hit their carts on the drovers' track two nights ago and took the seed-grain, Sedgeford's seed for next spring. Nobody was badly hurt. Ned Callow hasn't been the same since.",
        "Pip is Ned's little sister. Their mother is down with a fever in the second cart and doesn't know about any of this.",
        "There's no other roof for so many: the farms round about are single households, and Caerwyn is a day off and full to the rafters for the Assembly.",
      ],
      secrets: [
        "The day they arrived he said, within Pip's hearing and half as a joke, that if that corn doll went missing there'd be no ward and no turning them out. He's sick with guilt that she took him at his word. He'll confess it if pressed, or if it might spare her; he would take the mark himself.",
        "His grandmother used to say 'bread at the bounds makes kin of strangers'. He thinks it's just an old saying about hospitality, and it doesn't occur to him that it might be ward-lore. It only comes up if the talk turns to old customs, guests, or how things were done in Sedgeford.",
      ],
      attitude: "Courteous and desperate; treats the party as the best hope he's had in four days.",
    },
    {
      id: "ned",
      name: "Ned Callow",
      look: "Twenty, big and raw-handed, an eel-catcher's leather apron, an eel-spear he holds as if daring someone, and a black eye going yellow at the edges.",
      voice: "Loud, fast and certain, with an insult ready for the ward and the villagers. Goes quiet and young when his sister is mentioned.",
      wants: "To march on the goblins at the burnt mill tonight with any lad who'll come, get Sedgeford's seed-grain back and make the ward pointless; and to get Pip out of that ring. He'd give anything to have armed strangers lead the march.",
      fears: "That everyone will see he's a coward. That Pip gets marked because he wasn't there to stop her.",
      knows: [
        "The goblins that hit the carts two nights ago took the seed-grain sacks. Next morning he followed their tracks as far as the river path, heading north towards the burnt mill.",
        "There were only five of them, small as children and more scared than fierce. He reckons half a dozen lads with eel-spears could take them.",
        "Four or five of the Sedgeford lads will follow him if he goes. He means to go at dark, ward or no ward.",
      ],
      secrets: [
        "When the goblins came he hid under the seed-cart and banged his eye on the axle: that's the black eye. Nobody knows but Pip. Everything loud he says is because of it.",
      ],
      attitude: "Sizes the party up as fighters; friendly if they'll march, scornful if they side with the ward.",
    },
    {
      id: "pip",
      name: "Pip Callow",
      look: "Nine, small and wiry, soaked to the knees from the duck pond, straw still in her hair, sitting cross-legged in the stay-ring with her arms folded and her chin up.",
      voice: "Short, fierce sentences; won't cry in front of the ward-keeper. Blunt with strangers, and curious about anything with a blade.",
      wants: "For her family and the rest of Sedgeford not to be turned out; to be as brave as she thinks Ned is; not to cry in front of everyone.",
      fears: "The mark. Being the reason everyone gets turned out. Her mum finding out.",
      knows: [
        "She took the corn mother from the bounds-stone this morning, because no corn doll means no ward, and no ward means nobody can make them go. She was going to put it back after ward-night. She says she isn't sorry (she is, a bit).",
        "The ward-keeper caught her at the duck pond.",
        "Her mum is ill in the second cart.",
      ],
      secrets: [
        "She got the idea from Reeve Oswin, who said it as a joke. She won't tell on him unless someone convinces her it would help.",
        "She saw Ned hide under the cart when the goblins came. She'd never tell, but she might blurt it out if someone is shaming Ned, or if a stranger she trusts asks what really happened.",
        "She would say sorry to the ward-keeper, properly, in front of everyone, if someone she trusts asked her to and promised it would help her family. She won't do it for the ward-keeper's sake.",
      ],
      attitude: "Suspicious of grown-ups, curious about armed strangers, and quick to warm to anyone who treats her as brave.",
    },
  ],
  start: "judgment",
  beats: [
    {
      id: "judgment",
      title: "A judgment on the green",
      direction: "Hester has claimed the party as her stranger's eye, Pip is in the stay-ring, and the thief's mark is a threat on the table, not yet begun. This beat is for the party to find out what's at stake and who wants what. Let each of the four make their case to the party in their own voice, one at a time: Hester the charge and the Statute, Oswin his plea, Ned his goblins, Pip her defiance. They speak to the strangers, not to each other; if two start on each other, give it one narrated line and turn it back to the party. Narrate the crowds rather than voicing them. Play Hester as frightened under the bluster, not cruel. The party can ask anyone anything, and secrets come out only when earned.",
      cast: {
        hester: "Lay out the charge and the Statute once: the mark is the law, and the way out (amends before the parish) is Pip's to take. After that, answer questions and press Pip or your witnesses for an answer rather than reciting it again. Bristle at defiance; ease a little at real courtesy.",
        oswin: "Make your plea to the party once, quietly: Pip spared, and one more week on the green. After that, help where you can. Flinch whenever the corn doll comes up.",
        ned: "Tell the party once that the goblins at the burnt mill are the real problem, not your sister, and ask them to march with you tonight. After that, watch Pip and Hester's thumb, and needle anyone who sides with the ward.",
        pip: "Refuse to Hester's face to apologise. Be blunt and curious with the strangers. Glance at Ned or Oswin when anyone asks why you did it.",
      },
      pressure: "Hester glances at the sun, now level with the church tower, and flexes her ash-grey thumb. Ned plants his eel-spear in the turf, two Sedgeford lads drift to his side, and the villagers tighten their grip on their hayforks.",
      transitions: [
        {
          id: "appeal", on: "attempt",
          when: "The player pleads, argues or bargains with Hester to spare Pip the mark (mercy, fairness, the parish's good name, speaking as witness to the fairness of it, or offering to pay a price or take Pip's place), in a way where her answer could go either way.",
          check: { reason: "to persuade Hester to spare Pip the mark",
            skill: "persuasion", dc: 13,
            success: "Hester hesitates, looks at her watching parish, and gives way in her own fashion: she sets the mark aside, or takes what the player offered in its place, and finds her own face-saving words for it (without claiming Pip has said or done anything she hasn't). Pip is let out of the ring, stiffly. The ward is another matter.",
            failure: "Hester refuses, answering what the player actually said or offered in her own terms (the Statute, her watching parish, her own nerve), and steps up to the ring with her thumb raised. The green goes quiet.",
            onSuccess: "terms", onFailure: "the-mark",
          },
        },
        {
          id: "threaten", on: "attempt",
          when: "The player tries to frighten Hester out of marking Pip: threats, a hand on a weapon, a show of force.",
          check: { reason: "to frighten Hester into letting Pip go",
            skill: "intimidation", dc: 12,
            success: "Hester goes white and steps back from the ring. She lets Pip out without a word, and the villagers mutter about strangers with steel.",
            failure: "Hester's voice cracks, but she won't be bullied in front of her parish: she calls the Furlongs to her shoulders and steps up to the ring with her thumb raised.",
            onSuccess: "terms", onFailure: "the-mark",
          },
        },
        {
          id: "ward-first", on: "attempt",
          when: "The player argues with Hester to let the Sedgeford folk stay (inside the ward, or with it held off), with a real argument for why it serves Harrowby, where her answer could go either way. (Pleas for Pip herself are the appeal above.)",
          check: { reason: "to convince Hester the Sedgeford folk should stay",
            skill: "persuasion", dc: 14,
            success: "Hester gives way on the ward in her own statutory fashion: the Sedgeford folk can stay, and if nobody has found the old guest-right yet she admits it now. Pip's judgment is a separate matter, and it stands until it's settled.",
            failure: "Hester won't, and says why in her own terms (the goblins, a ward with holes in it, her parish watching). She's still listening; a better reason or the parish's own say-so might yet move her.",
            onSuccess: "judgment",
          },
        },
        { id: "spared", when: "Hester has set the mark aside and Pip is no longer about to be marked, whatever did it: Pip's apology before the parish, a price or substitute Hester accepted, a face-saving way out she took. (The party's own pleas and threats are the rolls above until they've worked.)", to: "terms" },
        { id: "defy", on: "attempt", when: "The party defies the judgment by force: openly scuffs or breaks the stay-ring, pulls Pip out of it, or lays hands on Hester or the corn mother.", to: "flashpoint" },
        { id: "stand-aside", on: "attempt", when: "The player backs the judgment (calls it fair, or tells Hester to go ahead) or makes clear they won't intervene, while staying on the green.", to: "the-mark" },
        { id: "hester-proceeds", on: "cue", when: "Several exchanges have passed in this beat and nobody is trying to change Hester's mind or Pip's: the party is watching, stalling or busy with something else. Hester decides her witnesses have seen enough and begins the mark.", to: "the-mark" },
      ],
    },
    {
      id: "the-mark",
      title: "The thief's mark",
      direction: "Hester has begun the mark: thumb raised over Pip's brow, the old words started, the whole green holding its breath. This beat is the party's last chance to stop it, and it should feel like one. An appeal that has already failed won't work twice, but a genuinely new angle might, and so might anything that gives Hester a way to stop without looking weak. Pip's courage wobbles but she won't cry; Ned is a heartbeat from doing something stupid; Oswin keeps starting to say something and stopping. Hester only finishes the mark if the dice say so or the party lets her.",
      cast: {
        hester: "Speak the words slowly and by the book. Stop for a real reason or a way out you can take with dignity; harden at bullying.",
        pip: "Squeeze your eyes shut and stick your chin out. Don't cry.",
        ned: "Grip the eel-spear and demand that the party do something.",
        oswin: "Try to confess something and lose your nerve; look to the party for help.",
      },
      transitions: [
        {
          id: "fresh-appeal", on: "attempt",
          when: "The player makes a new appeal to Hester to stop the mark: an argument, offer or plea that hasn't already been tried and failed in this scene.",
          check: { reason: "to make Hester reconsider marking Pip",
            skill: "persuasion", dc: 14,
            success: "Hester's thumb stops a finger's width from Pip's brow. She lowers it and gives way, setting the mark aside or taking what the player offered in its place, in her own face-saving words (without claiming Pip has said or done anything she hasn't); Pip is let out of the ring.",
            failure: "Hester shakes her head at what the player said or offered, without stopping the words, and presses her thumb to Pip's brow: the mark is made, grey and plain for the whole green to see.",
            onSuccess: "terms",
          },
        },
        {
          id: "fresh-threat", on: "attempt",
          when: "The player threatens Hester to stop the mark (steel, violence, ruin), in words rather than by laying hands on her.",
          check: { reason: "to threaten Hester into stopping the mark",
            skill: "intimidation", dc: 14,
            success: "Hester's hand shakes and drops. She stands back from the ring without a word, and the villagers' muttering turns ugly.",
            failure: "Hester flinches but finishes the words, and the Furlongs step in at the player's elbows as her thumb comes down: the mark is made.",
            onSuccess: "terms",
          },
        },
        { id: "mark-stopped", when: "Hester has stopped the mark and set it aside, whatever did it: Pip's apology before the parish, a confession, someone taking Pip's place, a face-saving way out she took. (The party's own pleas and threats are the rolls above until they've worked.)", to: "terms" },
        { id: "mark-made", when: "Hester has finished the mark: the grey thumbprint is on Pip's brow.", to: "flashpoint", establishes: [PIP_MARKED] },
        { id: "stop-by-force", on: "attempt", when: "The party physically stops the mark: grabs or knocks away Hester's hand, scuffs or breaks the stay-ring, pulls Pip out, or lays hands on the corn mother. (Stepping in front of Pip with open hands, an offer or a plea is an appeal, not force.)", to: "flashpoint" },
        { id: "let-it-happen", on: "attempt", when: "The player lets the mark go ahead: tells Hester to finish it, or stands back and does nothing to stop it.", to: "flashpoint", establishes: [PIP_MARKED] },
        { id: "hester-finishes", on: "cue", when: "Nobody is doing anything to stop the mark (the party is standing back, stalling, or has nothing new to offer): Hester speaks the last words and sets it on Pip's brow.", to: "flashpoint", establishes: [PIP_MARKED] },
      ],
    },
    {
      id: "flashpoint",
      title: "The green boils over",
      direction: "The quarrel has tipped into a shoving match: hayforks on one side, eel-spears on the other, the Furlongs in the middle, Hester shouting Statutes and Oswin trying to hold his people back. Whatever tipped it (the mark on Pip's brow, the ring broken, the ward-keeper defied) is what everyone is shouting about. This beat is the escalation ladder: things get worse each exchange the party lets them (a shove, a hayfork shaft cracking on an eel-spear, a goose underfoot), but nobody is badly hurt yet, and one clear voice or one clear act could still stop it. Let the party feel the first real blow is a breath away, and leave them room to act.",
      cast: {
        ned: "Square up to the Furlongs; you've had enough. Back down only for Pip or for the party.",
        hester: "Order the bounds-men about and cite the Statutes, one hand clamped on the corn mother.",
        oswin: "Try to hold your people back, and beg the party to stop it.",
        pip: "Hang on to Ned's apron and shout at him to stop.",
      },
      pressure: "A hayfork handle clips a Sedgeford lad's ear; there's blood, a roar, and both crowds surge a step closer.",
      transitions: [
        {
          id: "calm-all", on: "attempt",
          when: "The player tries to calm both sides at once with words: a call for order, an appeal, a speech.",
          check: { reason: "to calm the villagers and Sedgeford folk",
            skill: "persuasion", dc: 15,
            success: "The player's voice cuts through. Hayforks and eel-spears come down, sheepishly; people remember they're neighbours, more or less, and the green goes quiet enough to talk.",
            failure: "The noise swallows the player's words; somebody shoves somebody, and both crowds lean in. One more push and it's a brawl.",
            onSuccess: "terms",
          },
        },
        {
          id: "cow-all", on: "attempt",
          when: "The player tries to cow both sides into backing down with a show of force or a threat.",
          check: { reason: "to cow both sides into backing down",
            skill: "intimidation", dc: 12,
            success: "The green goes silent. Nobody wants to be first against the armed stranger; hayforks and eel-spears lower, sullenly.",
            failure: "Someone laughs, someone swings, and a hayfork handle comes down on an eel-spear.",
            onSuccess: "terms", onFailure: "brawl",
          },
        },
        { id: "defused", when: "The crowds have actually pulled back from the brink (weapons lowered, people talking instead of shoving), whatever did it: Pip or Oswin stepping between them, Hester or Ned backing off, an offer that changes things, or something the party did. (The party's own calming words and threats are the rolls above until they've worked.)", to: "terms" },
        { id: "let-it-boil", on: "attempt", when: "The player stands back to let the two crowds fight it out, or eggs them on.", to: "brawl" },
        { id: "first-blow", on: "cue", when: "Nobody is trying to stop it: the party's last attempt to calm things failed and they've tried nothing new since, or they're busy with something else. Someone throws the first real punch.", to: "brawl" },
      ],
    },
    {
      id: "terms",
      title: "The price of the ward",
      direction: "Pip's part is settled for now (spared, marked or snatched from the ring), and the bigger question is out in the open: at sundown the ward goes up, and everyone inside the bounds who isn't of the parish will find urgent business elsewhere, Sedgeford included. This beat is for the bargain; if the ward was already settled in play (the guest-right made, or Hester's word given), don't reopen it, and play out what's left. Each of the three adults presses their case on the party again, with new arguments rather than old ones: Hester wants the ward whole and Harrowby safe, Oswin wants one more week, Ned wants to march on the mill. Hester needs a reason that serves the parish and a way to say yes without looking weak; reward real arguments and real offers with real movement. The sun keeps sinking.",
      cast: {
        hester: "Defend the ward: tonight it's all that stands between Harrowby and the goblins. Deflect general pleas to let Sedgeford stay, but listen to anything new that serves the parish, and keep your word if you've already given it. Keep a hand on the corn mother.",
        oswin: "Offer what Sedgeford has (hands for the last of the harvest, the night watch, the cows' milk) rather than repeating your plea.",
        ned: "Push the march on the mill, tonight, with the party leading. Sulk if refused; brighten if anyone takes the goblins seriously.",
        pip: "Stick close to the party and ask what's going to happen to everyone.",
      },
      pressure: "The sun touches the hill. Hester unties the corn mother from her belt and looks towards the bounds-stone; over by the carts, someone starts packing pots, just in case.",
      transitions: [
        {
          id: "persuade-hester", on: "attempt",
          when: "The player argues with Hester to let the Sedgeford folk stay (inside the ward, or with it held off), with a real argument for why it serves Harrowby, where her answer could go either way.",
          check: { reason: "to convince Hester the Sedgeford folk should stay",
            skill: "persuasion", dc: 14,
            success: "Hester lets out a long breath and gives way, in her own statutory fashion: the Sedgeford folk can stay. If nobody has found the old guest-right yet, she admits it now: the parish's own bread and salt, broken with them at the bounds-stone, makes them guests of the parish, and the ward will take them in.",
            failure: "Hester won't, and says why in her own terms (the goblins, a ward with holes in it, her parish watching). But she's still listening, and a better reason or the parish's own say-so might yet move her.",
            onSuccess: "sheltered",
          },
        },
        {
          id: "rouse-the-green", on: "attempt",
          when: "The player appeals to the whole crowd, villagers and Sedgeford folk together, to take the refugees in: a speech, a song or a show for the whole green.",
          check: { reason: "to win the crowd over to taking in the refugees",
            skill: "performance", dc: 13,
            success: "Something turns in the crowd: a laugh, a shout of agreement from the village side, hayforks coming down. Hester looks at her parish, sees its answer, and gives way: the Sedgeford folk can stay.",
            failure: "The villagers mutter and look at their boots, and a few drift off home to bar their doors. Hester takes it as the parish's answer, for now.",
            onSuccess: "sheltered",
          },
        },
        {
          id: "cow-hester", on: "attempt",
          when: "The player threatens Hester to make her let the Sedgeford folk stay.",
          check: { reason: "to threaten Hester into letting the Sedgeford folk stay",
            skill: "intimidation", dc: 13,
            success: "Hester gives way with her hand shaking on the corn mother: the Sedgeford folk can stay. Nobody on the village side will look the party in the eye.",
            failure: "Hester calls for the Furlongs, the villagers raise their hayforks, and Ned's lads surge to meet them.",
            onSuccess: "cowed", onFailure: "flashpoint",
          },
        },
        { id: "seize-ward", on: "attempt", when: "The party tries to stop the ward by force: snatching the corn mother, laying hands on Hester, or blocking her way to the bounds-stone.", to: "flashpoint" },
        { id: "sent-on", when: "It has been settled, with the party's backing, that the Sedgeford folk will go: Oswin has agreed to lead his people out before sundown, or the party has sided with the ward.", to: "turned-out" },
        { id: "sundown", on: "cue", when: "The bargaining has gone round for several exchanges with no settlement and nothing new on the table, or the party has stopped trying to find one: the sun is on the hill, and Hester sets off for the bounds-stone to raise the ward.", to: "the-ward" },
      ],
    },
    {
      id: "the-ward",
      title: "Sundown at the bounds-stone",
      direction: "Hester has set off to raise the ward: the corn mother in both hands, walking the bounds in the last of the light towards the bounds-stone, half the green trailing after her and the Sedgeford folk loading their carts. This beat is the party's last chance to change who the ward counts, and it should feel like one. Something genuinely new (the guest-right, the parish's say-so, an offer Hester can accept with dignity) can still stop her or change the rite; an old plea repeated can't, and neither can wishing. If Hester herself offers a way in at the last moment, let the party take it. She only sets the corn mother in the niche if nothing they try works, or they let her.",
      cast: {
        hester: "Walk the bounds by the book. Stop for something genuinely new; if you've been given a way to take them in that you can live with, take it.",
        oswin: "Get your people ready to go with what dignity they have left, and thank the party for trying.",
        ned: "Gather the angriest lads and look north towards the mill.",
        pip: "Hold on to the party's sleeve and watch the corn mother.",
      },
      transitions: [
        {
          id: "last-plea", on: "attempt",
          when: "The player makes a last, new appeal (to Hester, or to the whole green) to take the Sedgeford folk in or hold the ward off: an argument, offer or plea that hasn't already been tried and failed.",
          check: { reason: "to make a fresh appeal for the Sedgeford folk to stay",
            skill: "persuasion", dc: 15,
            success: "Hester stops with the corn mother a hand's breadth from the niche, and gives way: the Sedgeford folk can stay. If nobody has found the old guest-right yet, she admits it now, and Harrowby's bread and salt are fetched at a run.",
            failure: "Hester hears the player out, shakes her head, and lifts the corn mother towards the niche.",
            onSuccess: "sheltered", onFailure: "turned-out",
          },
        },
        { id: "seize-ward", on: "attempt", when: "The party tries to stop the ward by force: snatching the corn mother, laying hands on Hester, or blocking her way to the bounds-stone.", to: "flashpoint" },
        { id: "ward-rises", on: "cue", when: "Nobody is offering anything new (the party is standing back, stalling, or repeating an old plea): Hester sets the corn mother in the niche and the ward rises.", to: "turned-out" },
      ],
    },
  ],
  anytime: [
    { id: "goblin-errand", on: "attempt", when: "The party sets off now for the burnt mill to deal with the goblins, and Hester has given her word to hold the ward (and let the Sedgeford folk stay) until they're back.", to: "to-the-mill" },
    { id: "walk-away", on: "attempt", when: "The party leaves Harrowby green with the quarrel still unsettled: on down the road, or off to the burnt mill without Hester's word to hold the ward.", to: "walked-away" },
    { id: "attack", on: "attempt", when: "The party attacks someone on the green (Hester, a bounds-man, Ned, a villager) or throws the first punch.", to: "brawl" },
    { id: "hester-agrees", when: "Hester has agreed that the Sedgeford folk can stay tonight (made guests of the parish by the old guest-right or a rite like it, or with the ward held off), and Pip is no longer waiting on the mark (she has been spared, or it has already been set).", to: "sheltered" },
    { id: "remedy", when: "The quarrel has actually been resolved by some other means established in play than Hester agreeing to take the Sedgeford folk in or hold the ward off: Pip isn't about to be marked, nobody will be sent off down the drovers' track tonight, and nobody is about to come to blows (for example, the Sedgeford folk camping just outside the bounds for the night under guard).", to: "remedy" },
  ],
  exits: [
    {
      id: "sheltered", kind: "persuaded", title: "Guests of Harrowby",
      outcome: "Hester agrees that the Sedgeford folk can stay: at sundown the ward goes up with them counted as guests of the parish, or it's held off for now, and nobody is turned out tonight.",
      closing: "Relief with a dry edge, at sundown. If the guest-right is used: Harrowby households breaking bread and salt with the Sedgeford folk at the bounds-stone, a family at a time, then Hester walking the last of the bounds and setting the corn mother in its niche, and the ward going up like heat-shimmer along the hedges while its new guests feel nothing at all. A last moment for whoever matters most to how it went, and a dry word from Hester to her witnesses.",
      script: (world, outcome) => {
        world.setFlag("sedgeford_refugees", "sheltered at Harrowby");
        world.character("oswin").setAttitude("devoted", "The party kept Sedgeford from being turned out onto the drovers' track.");
        world.character("hester").setAttitude("friendly", "The party found her a way to keep both the ward and her conscience.");
        carryMark(world, outcome);
        world.journal("Harrowby green: the Sedgeford flood-folk stay, and nobody was turned out at sundown.");
      },
    },
    {
      id: "cowed", kind: "persuaded", title: "At sword's point",
      outcome: "Hester gave way under threat: the Sedgeford folk can stay, but Harrowby watched strangers bully its ward-keeper and won't forget it.",
      closing: "A sullen sundown: villagers going home without a word, Hester doing what she was made to do with her hands shaking, Oswin's thanks a little ashamed.",
      script: (world, outcome) => {
        world.setFlag("sedgeford_refugees", "staying at Harrowby");
        world.setFlag("harrowby_resents_party", true);
        world.character("hester").setAttitude("unfriendly", "The party forced her hand with threats in front of her parish.");
        world.character("oswin").setAttitude("friendly", "His people can stay, though he didn't like how it was done.");
        carryMark(world, outcome);
        world.journal("We made Harrowby's ward-keeper let the Sedgeford flood-folk stay. The village won't forget how.");
      },
    },
    {
      id: "to-the-mill", kind: "progress", title: "To the burnt mill",
      outcome: "The party sets off up the river path for the goblin warren under the burnt mill, to deal with the goblins and Sedgeford's seed-grain. Hester holds the ward until they're back, so the Sedgeford folk stay on the green for now.",
      closing: "Purpose in the last light: the party leaving the green with whoever is going with them, Hester calling the exact terms after them, and the whole green watching them go.",
      script: (world, outcome) => {
        world.quest("burnt-mill").start("The Burnt Mill", "Goblins raiding the drovers' track took Sedgeford's seed-grain to their warren under the burnt mill. Harrowby's ward-keeper is holding the ward, and letting the Sedgeford folk stay on the green, until we're back.");
        world.promise({ by: "hester", to: "player", what: "Hold Harrowby's ward, and let the Sedgeford folk stay on the green, until the party is back from the burnt mill." });
        world.promise({ by: "player", to: "hester", what: "Deal with the goblins raiding from the burnt mill." });
        world.setFlag("sedgeford_refugees", "waiting on Harrowby green");
        world.character("oswin").setAttitude("friendly", "The party bought his people time.");
        carryMark(world, outcome);
      },
    },
    {
      id: "remedy", kind: "other", title: "Settled another way",
      outcome: "The quarrel is settled by a remedy found in play: nobody is sent off down the drovers' track tonight and nobody comes to blows.",
      closing: "The sun goes down on something nobody planned: the remedy taking hold, Hester checking it against the Statutes, Oswin's relief, Ned's grudging grin. Let Pip have the last word.",
      script: (world, outcome) => {
        world.setFlag("sedgeford_refugees", "safe for tonight");
        world.character("oswin").setAttitude("devoted", "The party found a way to keep his people off the road.");
        carryMark(world, outcome);
        world.journal("Harrowby green: we found another way, and nobody was turned out onto the road at sundown.");
      },
    },
    {
      id: "turned-out", kind: "other", title: "Turned out at sundown",
      outcome: "The ward goes up at sundown without the Sedgeford folk inside it. They find they have urgent business elsewhere, hitch up their carts and trundle out past the bounds-stone onto the drovers' track at dusk, goblins or no goblins.",
      closing: "Quiet and wrong: the ward rising like heat-shimmer along the hedges, the carts creaking out into the dusk, everyone suddenly and politely sure they ought to be somewhere else. The party feels the same tug, being strangers here too. Give Oswin a last courteous word; unless the party talked him round, Ned takes the angriest lads off towards the burnt mill.",
      script: (world, outcome) => {
        world.setFlag("sedgeford_refugees", "turned out of Harrowby");
        world.place({ asset: world.assets.get("magic-glow"), at: world.anchor("bounds-stone"), note: "Harrowby's bounds-ward, up until spring sowing." });
        world.scatter({ asset: world.assets.get("wheel-ruts"), count: 3, around: world.anchor("drovers-track") });
        for (const id of ["oswin", "pip", "ned"]) world.character(id).leaveScene("out past Harrowby's bounds-stone, at dusk");
        world.character("oswin").setAttitude("wary", "Harrowby turned his people out at sundown, and the party didn't stop it.");
        carryMark(world, outcome);
        world.journal("Harrowby raised its ward at sundown and the Sedgeford flood-folk were turned out onto the drovers' track.");
      },
    },
    {
      id: "brawl", kind: "combat", title: "Brawl on the green",
      outcome: "A brawl breaks out on Harrowby green: villagers with hayfork handles and the two bounds-men against Sedgeford lads with eel-spears, geese everywhere, and the party in the thick of it. Nobody meant it to be a killing fight.",
      closing: "Chaos with a comic edge: a hayfork handle cracking on an eel-spear, geese exploding upwards, Hester shrieking Statutes. End with 'Roll for initiative!'",
      script: (world) => {
        world.startCombat({ enemies: [{ asset: world.assets.get("town-guard"), count: 2 }], allies: ["ned"], at: world.anchor("green") });
        world.unsupported("The rest of the brawl: Harrowby villagers with hayfork handles and Sedgeford lads with eel-spears, all non-lethal. The catalogue has no villager creature, and which side counts as the party's enemy depends on the side they took.");
        world.setFlag("harrowby_brawl", true);
      },
    },
    {
      id: "walked-away", kind: "leave", title: "Left to it",
      outcome: "The party leaves Harrowby green with the quarrel unsettled, and without them it goes the way it was heading: the ward goes up at sundown and the Sedgeford folk are turned out onto the drovers' track.",
      closing: "The green behind them as they go (down the road, or up the river path towards the mill): voices rising, Hester's thumb lifting, the sun on the hill. Don't resolve it on stage.",
      script: (world) => {
        world.setFlag("sedgeford_refugees", "turned out of Harrowby");
        world.setFlag("party_left_harrowby_green", true);
        world.journal("We left Harrowby green in the middle of a quarrel over a ward, a stolen corn doll and thirty-one flood-folk, with the sun going down.");
      },
    },
  ],
  limits: [
    "Sending for the Master Warden, or any senior Nine Furrows wizard, to rule on it: old Bede Applegarth is at the Centennial Assembly in Caerwyn with the Nine Furrows delegation, a long day's walk away. Nobody can bring him or his word back before sundown, and on ward-night the ward-keeper speaks for the parish.",
    "Another roof for thirty-one people tonight: there's none within reach before dark. The farms round about are single households, Garrow's toll house is a cramped lodge miles back on the King's Road, Caerwyn is a day off and packed for the Assembly, and the burnt mill is where the goblins are.",
    "Help from outside the green (soldiers, the King's men, the toll-house men, another village, the Assembly): nobody is coming. The track is empty at dusk and everyone with any authority is in Caerwyn for the Assembly; the people on this green are all there is.",
    "Raising, reshaping, dispelling or blocking the bounds-ward with the party's own magic or know-how: it's a parish working. Only Harrowby's ward-keeper can raise it, by walking the bounds with the corn mother and setting it in the bounds-stone, and nobody else's spell or trick can touch it. Who it counts as 'of the parish' is settled by the Statutes, not by anyone's magic.",
    "Hiding the Sedgeford folk from the ward (in a barn, the church, a cellar, under the hay): the ward knows who is of the parish wherever they are inside the bounds, and hidden strangers still find urgent business elsewhere.",
    "Taking the corn mother quietly (lifting it, swapping it, snatching it unseen): Hester keeps it tied at her belt with a hand on it, and the whole parish is watching her. Taking it at all means laying hands on the ward-keeper, and the green will rise at that.",
    "Reaching the goblins or Sedgeford's seed-grain from here: the warren is under the burnt mill, hours up the river path to the north. The party can set off for it, but it can't be reached within this scene.",
    "Washing off or lifting the thief's mark once it's set: it doesn't scrub off. Only a year and a day, or the Master Warden, can lift it.",
  ],
  anchors: ["green", "bounds-stone", "stay-ring", "duck-pond", "moot-oak", "well", "bakehouse", "church", "sedgeford-carts", "drovers-track"],
};
