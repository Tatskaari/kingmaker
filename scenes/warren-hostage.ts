import type { Scene, Transition } from "../src/runtime/scene.ts";
import type { SceneOutcome, WorldApi } from "../src/world/dsl.ts";

/**
 * LMoP's Yeemik bargain and Sildar's debrief (docs/research/scene-sources.md §5.2), moved under the
 * burnt mill (§7.3). Klarg becomes Gubbin, a vain goblin chief who wants a "king-paper" so his
 * warren (and the kings at the Assembly) will count him a king. Yeemik becomes Snikkit, his
 * lieutenant, who wants Gubbin's pot-crown without risking his own skin. Sildar becomes Hester
 * Quayle, a Saltmere courier hanging over the mill-race, who could write the paper but won't put her
 * seal to a lie. The stress is lies, double-crosses and creative leverage: every line should be
 * judged by what it does for Snikkit's crown, Gubbin's dignity and Hester's principles. Skrag is
 * kept offstage, so the scene works however the crossroads went (or if it never happened).
 */

/** Facts that change who rules the warren or how a fight starts; exit scripts read them back. */
export const warrenFacts = {
  newChief: "Gubbin has lost the warren, and Snikkit wears the pot-crown as its chief.",
  gubbinReleased: "Gubbin let the courier go on his own terms and is still King Under the Mill.",
  struckFirst: "The party struck first, from hiding.",
  attackedGubbin: "The party went for Gubbin himself.",
};

// Moves that stay open while the goblins hold Hester, shared by several beats.
const snatch = (dc: number): Transition => ({
  id: "snatch", on: "attempt",
  when: "While the goblins still hold the courier, the player makes a grab for her: a dash along the walkway or the beam, a leap for the rope, or cutting her down onto the stone.",
  check: {
    skill: "acrobatics", dc,
    success: "They get to her first and haul her onto the walkway, sack and all; Snikkit's knife comes down on empty rope.",
    failure: "Snikkit is quicker: the knife goes through the rope and Hester drops into the race.",
    onSuccess: "freed", onFailure: "in-the-race",
  },
});

const deceive = (beat: string): Transition => ({
  id: "deceive", on: "attempt",
  when: "The player tries to fool a goblin to its face: a lie (that Gubbin is dead, that soldiers are coming, that the party speaks for a king), a fake paper passed off as real, a disguise, or a promise they don't mean to keep. Proposing or planning a trick with Hester isn't this: the roll comes when a goblin is actually being fooled.",
  check: {
    skill: "deception", dc: 13,
    success: "The lie lands: they believe it, for now, and act on it at once from their own wants, which may not be what the player hoped for.",
    failure: "They see through it and take it badly: Snikkit gives them a warning they can see (a strand of the rope sawn through, or a spear at Hester's back if she's off it), and the party's word is worth nothing here for a while.",
    onSuccess: beat, onFailure: beat,
  },
});

const persuadeHester = (beat: string): Transition => ({
  id: "persuade-hester", on: "attempt",
  when: "The player tries to talk Hester into putting her seal to the lie the goblins want (a king-paper for Gubbin, or for anyone else). A proposal that doesn't ask her to lie needs no persuading.",
  check: {
    skill: "persuasion", dc: 13,
    success: "Hester gives in, on terms: wording she can live with, and her feet on dry stone to write it. Someone still has to get the goblins to let her down.",
    failure: "Hester refuses, louder: her seal is her bond, and it would take a much better argument than that.",
    onSuccess: beat, onFailure: beat,
  },
});

const freed: Transition = {
  id: "freed",
  when: "The courier is out of the goblins' hands and with the party, nobody's prisoner any more: let go to them, snatched, cut down, or got away by some other means established in play.",
  to: "freed",
};

const intoTheRace: Transition = {
  id: "in-water",
  when: "The courier has come off the rope and is loose in the mill-race, being carried off by the current (the rope cut or let go, or the sack torn loose). Being lowered until her feet or legs are in the water while she still hangs from the rope doesn't count.",
  to: "in-the-race",
};

const attack: Transition = {
  id: "attack", on: "attempt",
  when: "The player attacks Snikkit or his goblins, or starts a fight in the wheel-pit.",
  to: "fight",
};

const toGubbin: Transition = {
  id: "to-gubbin", on: "attempt",
  when: "The player goes down the cellar to deal with the chief himself: waking Gubbin to bargain, to pay, or to take Snikkit's deal.",
  to: "gubbin",
};

const gubbinComes: Transition = {
  id: "gubbin-comes", on: "cue",
  when: "Gubbin wakes and comes to see what's going on: there's been shouting, a scuffle or a splash loud enough to carry over the race, someone has called for him, or the talk has gone round in circles for several exchanges without a deal.",
  to: "gubbin",
};

const ransomDeal: Transition = {
  id: "ransom-deal",
  when: "The goblins have agreed to keep the courier alive until the party comes back with a price by an agreed time, and the party is leaving the mill to fetch it.",
  to: "gone-for-ransom",
};

// Social rolls win ground, not the hostage: Snikkit lets her go for a deal, a swap or a rescue.
const frightenSnikkit = (beat: string): Transition => ({
  id: "intimidate", on: "attempt",
  when: "The player tries to frighten Snikkit into letting the courier go with threats against him or his band, or a show of force. Seizing leverage of their own and offering a swap is the counter-hostage move, not this.",
  check: {
    skill: "intimidation", dc: 15,
    success: "Snikkit's nerve goes: he'll deal on the party's terms now, so long as he keeps his skin and his face in front of his band. Give him a way to call it his own idea and he hands her over.",
    failure: "Snikkit's grin goes thin. He makes Hester's danger plain (the rope paid out until her toes trail in the race, or a spear at her throat if she's off it) and reminds the party how fast the water runs.",
    onSuccess: beat, onFailure: beat,
  },
});

/** A hostage for a hostage changes Snikkit's sums; it doesn't make him fold. */
const counterHostage = (beat: string): Transition => ({
  id: "counter-hostage", on: "attempt",
  when: "The player seizes leverage of their own and offers a swap: a knife at a goblin's throat, a hand on something the warren treasures (Grandmother Bone, the pot-crown), or a grip on Snikkit himself.",
  check: {
    skill: "intimidation", dc: 13,
    success: "The leverage bites, on the goblins' own terms: Snikkit cares far more for his own skin than for any goblin's, so he haggles over the swap (who lets go first, where, what else), while his band watches exactly how much he values them. Settle the exchange in play.",
    failure: "Snikkit calls the bluff: he would sooner lose a goblin, or the warren's treasure, than his prize, and he says so. His band hears exactly what he's willing to lose, and his knife stays on the rope.",
    onSuccess: beat, onFailure: beat,
  },
});

const buySnikkit = (beat: string): Transition => ({
  id: "release-first", on: "attempt",
  when: "The player tries to talk or buy Snikkit into handing the courier over before he has what he wants (a bribe, a promise, a show of good faith, an appeal). Asking for her to be let down off the rope while she stays a prisoner (to write, say) is ordinary bargaining, not this.",
  check: {
    skill: "persuasion", dc: 15,
    success: "Snikkit gives ground: he'll take something on account instead of the whole crown, agree to a swap at the foot of the ladder, or have Hester swung onto the walkway as a show of good faith (still a prisoner, with a spear at her back). Settle the rest in play.",
    failure: "Snikkit wags a finger: proof first, tall friends. He's still open to a better offer.",
    onSuccess: beat, onFailure: beat,
  },
});

const startLead = (world: WorldApi) => world.quest("who-sold-the-courier").start(
  "Who Sold the Courier?",
  "The goblins under the burnt mill were waiting for Hester Quayle on the King's Road and went straight for her satchel: someone told them which rider to take.",
);

/** Who rules under the mill, if the scene changed it. */
function recordWarren(world: WorldApi, outcome: SceneOutcome): void {
  if (outcome.established.includes(warrenFacts.newChief)) {
    world.setFlag("warren_chief", "snikkit");
    world.character("snikkit").setAttitude("wary", "The party put him in the pot-crown, and he knows what they can do to a chief.");
    world.character("gubbin").setAttitude("hostile", "The party cost him his throne.");
  } else if (outcome.established.includes(warrenFacts.gubbinReleased)) {
    world.character("gubbin").setAttitude("friendly", "The party dealt with him like a king and he let the courier go.");
    world.character("snikkit").remember("The longlegs did their deal with Gubbin and left him chief.");
  }
}

export const warrenHostage: Scene = {
  id: "warren-hostage",
  title: "The King Under the Mill",
  summary: "A Saltmere courier hangs over a mill-race; the goblin chief wants a king-paper, and his lieutenant wants the chief's crown.",
  setting: "Under the burnt mill on the river, half a day north of the crossroads, as the light goes on the eve of the Centennial Assembly. The mill above is black ribs and a fallen roof. Through a gap in its floor a rotten ladder drops into the undercroft: one long vaulted cellar of wet stone. The near end is the wheel-pit. The mill-race runs through a channel in the floor, fast, black and loud enough to drown out talk (only a real commotion carries over it), past the burnt stump of the waterwheel and out through a low culvert into the river. Plank walkways run along both walls. At the head of the race, where the water comes in under an arch, the old sluice windlass stands rusted stiff. Over the race, a rope runs through the old sack-hoist pulley and is tied off on the beam, where Snikkit sits; on its other end, in a grain sack tied under her arms, hangs the courier, her bare feet a yard above the water. Paying the rope out lowers her; cutting it drops her. The far end, through a broad arch, is the old grain cellar: Gubbin's hall, with a throne of grain sacks behind a moth-eaten mill curtain, the shrine niche where Grandmother Bone belongs, and burrows in the bank too small for longlegs. Tallow stubs burn in clay pots. It smells of smoke, river, old flour and goblin.\n\nThe warren is a dozen-odd goblins. Snikkit's band of six holds the wheel-pit, Gubbin's two biggest doze by his throne, and the old ones and the young keep to the burrows. Goblins follow whoever looks biggest: they cheer a winner and laugh at a loser, and a chief they've laughed at is no chief. Paper and seals impress them enormously. If what happened in play says the party has crossed Skrag's band before (fought them, frightened them, fooled them, or given Grandmother Bone back), word has reached the warren and colours every greeting. Otherwise the party are strangers, and the shrine niche is empty.",
  premise: "Can the party get the Saltmere courier out from over the mill-race alive, and who will be king under the mill when they leave?",
  hook: "Goblin tracks led you here: to the burnt mill on the river, half a day north of the crossroads, where something lives under the floor. You've just climbed in through the charred doorway. Beneath the boards, over the roar of the river, someone is lecturing goblins on the law of contracts.",
  opening: "Open with the party inside the burnt mill, looking down through the gap in the floor, unseen: the black race roaring through its channel, tallow lamps on the walkways, six goblins leaning on spears, Snikkit astride the hoist beam with his knife resting on the rope, and Hester hanging below him in her grain sack over the water, mid-lecture. Let the player overhear enough to understand the situation: the chief wants a 'king-paper' from her by moonrise, she won't write it, and the moon is nearly up. At the far end, something large is asleep behind a curtain. If what happened in play brought the party here a particular way (following goblin tracks from the crossroads, say), pick up from it; otherwise assume nothing about why they've come. End with nobody below having looked up yet.",
  background: [
    "Grandmother Bone, the warren's shrine idol (a little bone grandmother with garnet eyes), went missing when a farmer's plough broke into one of the goblins' burial places, and Skrag's band went out to bring her back. Whether she came home, and what became of Skrag, is for what happened in play to say.",
  ],
  cast: [
    {
      id: "snikkit",
      name: "Snikkit",
      group: "Snikkit and his band of six goblins with spears and slings",
      look: "A narrow, quick goblin with a long nose and both ears (he's proud of them), in a jerkin sewn all over with stolen buttons, sitting astride the hoist beam with a knife resting on the rope.",
      voice: "Soft and quick, almost a purr; leans in rather than shouting over the race. Borrows grand words from travellers and gets them nearly right ('a mutual arrangement', 'perfectly legal-ish'). Calls the party 'tall friends' and himself 'your humble Snikkit'. Claims to read 'the important bits' of anything put in front of him.",
      wants: "To be chief of the warren without risking his own skin. The party could be the knife he's been waiting for.",
      fears: "Gubbin, who bit off his cousin's nose for less. Being caught plotting. The party deciding he's the easier goblin to kill.",
      knows: [
        "Gubbin's orders: the paper-lady stays on the rope until she writes a king-paper or someone brings one, and at moonrise he's to cut it.",
        "The goblins took her at a ford on the King's Road two nights ago. Gubbin had her hung over the race tonight when she still wouldn't write.",
        "Whoever wears the pot-crown is chief, as far as the warren is concerned. Gubbin never takes it off, even to sleep.",
        "Lump and Other Lump guard Gubbin. The old ones and the young keep to the burrows and want no trouble.",
        "Skrag, the one-eared one, led the band that went after Grandmother Bone. Snikkit knows no more of how that went than what happened in play says, and he'd welcome anything that made Skrag look bad.",
      ],
      secrets: [
        "He means to keep the courier if he can get away with it: Saltmere will pay well for her. He'll keep any bargain exactly as long as breaking it looks more dangerous, and if he thought Gubbin were already out of the way, he'd have no more use for the party at all: he'd go for the pot-crown himself.",
        "If someone offered him a king-paper with SNIKKIT on it, read out before the warren, he'd take that over any murder: the warren would cheer whoever the paper names. He won't suggest it himself; it would be treason if it got back to Gubbin.",
        "Before the raid, a longlegs in a grey hood came to Gubbin's hall at night and left with a lighter purse. Snikkit saw it, and would trade the story for something.",
        "He can't read a word, and pretends he can.",
      ],
      attitude: "Politely menacing; warms fast to anyone who might be useful; turns cold if crossed.",
    },
    {
      id: "hester",
      name: "Hester Quayle",
      look: "Thirties, wiry, in a salt-stiffened blue courier's coat with two buttons missing, barefoot, trussed into a grain sack up to her armpits with a leather satchel strapped across her chest, turning slowly on the hoist rope over the race.",
      voice: "A crisp Saltmere clip. Talks in terms of accounts, terms and obligations; icy courtesy to her 'hosts'; sarcasm laid over terror like a tarpaulin.",
      wants: "To get out of the sack alive with her letters dry and unopened, and to reach the Saltmere delegation in Caerwyn before the Assembly opens, without forging anything on the way.",
      fears: "Drowning. Her letters getting wet or opened. Putting her seal to a lie.",
      knows: [
        "The goblins took her at dusk two nights ago at a ford on the King's Road, where any rider has to slow. Her horse bolted when they rose out of the reeds and is long gone; they took her boots and her purse.",
        "It was no chance raid: they were waiting at the ford and went straight for her satchel. Somebody told them which rider to take, and she wants to know who.",
        "Gubbin wants her to write him a 'king-paper' saying he is a king. She has refused: a Saltmere courier who puts her seal to a lie is finished, and forging a royal warrant is a hanging matter in Caerwyn.",
        "Her satchel holds letters for the Saltmere delegation at Caerwyn, her writing case and the counting-house seal. She bit the last goblin who tried to take it.",
        "Snikkit holds the rope and Gubbin gives the orders. The goblins are terrified of Gubbin and only half-loyal to Snikkit.",
        "Saltmere pays its debts: she will settle with her rescuers in Saltmere credit, written out on the spot.",
      ],
      secrets: [
        "Nobody in the warren can read. Gubbin makes her read her letters aloud every night, and she has been improving them to keep him sweet. It hasn't occurred to her that she could write some harmless, true thing, seal it, and read it out as whatever he likes; she won't think of it herself, however the talk goes. If the party suggests it, she sees it at once and fusses over wording that isn't technically a lie.",
        "The sealed letter in her satchel is Saltmere's credit for King Aldren's treasury: the loan that pays for the Centennial Assembly (the feast, the hall, the cushions). She is sworn not to say so, and only a handful of people knew which rider was carrying it.",
        "She can't swim. She would sooner drown than admit it.",
      ],
      attitude: "Brisk and suspicious of her rescuers; warms to competence; never forgets a debt, in either direction.",
    },
    {
      id: "gubbin",
      name: "Gubbin",
      group: "Gubbin and his two biggest goblins, Lump and Other Lump",
      look: "The biggest goblin anyone has ever seen, round as a grain sack, with a dented copper pot jammed on his head for a crown, a moth-eaten mill curtain for a robe and a gnawed bone for a sceptre.",
      voice: "A bellow. Uses the royal 'we' and gets it wrong ('We is displeased'). Says what he imagines kings say. Rages fast, sulks faster, and is childishly delighted by anything shiny or official. Calls everyone else 'longlegs'.",
      wants: "To be a real king like the longlegs kings at their big meeting in Caerwyn: a king-paper with a big seal to wave at the warren and stop the muttering behind his back. Also, anything shiny.",
      fears: "Looking small in front of the warren. Being laughed at. The plotter he's sure is out there.",
      knows: [
        "His price for the paper-lady: a king-paper with a big seal saying Gubbin is King Under the Mill, by moonrise. Otherwise she goes in the race.",
        "The longlegs kings are meeting at Caerwyn to agree who is top king (the paper-lady's letters said so). He means to be counted.",
        "The paper-lady reads him her letters every night, and he likes the ones about kings best.",
        "He is the biggest goblin there is, and the warren knows it.",
        "Talk down at the race doesn't carry to his throne over the water's roar (only a real commotion does): he knows only what he has seen and been told since he woke.",
      ],
      secrets: [
        "A longlegs in a grey hood, smelling of lavender water, paid him a purse of new silver pennies, each stamped with a little heron, to take 'the Saltmere rider with the blue satchel' at the ford, with more promised once her letters were burned. The purse is in the sack he sits on. He hasn't burned the letters: he likes the seals, and he wants his king-paper first.",
        "He suspects someone in the warren is plotting against him, but not who. He'd reward whoever names the plotter (with something like proof) by lowering his price or handing over the courier.",
        "He can't read a word. Any paper with a big enough seal, read out grandly enough, would satisfy him.",
      ],
      attitude: "Pompous and suspicious; treats the party as petitioners at his court; open to flattery and shiny gifts; explosive if insulted.",
      enters: "gubbin",
    },
  ],
  start: "unseen",
  beats: [
    {
      id: "unseen",
      title: "Unseen above the race",
      direction: "Nobody below has looked up. This beat is for looking, listening and choosing how to go in: openly, quietly, violently or cleverly. Answer questions about the undercroft generously and concretely (the race and the culvert, the hoist rope and pulley, the rusted sluice windlass at the head of the race, the walkways, the arch to Gubbin's end, how many goblins and where they stand). Snikkit's band is cold, bored and grumbling about the chief's appetite; Hester is mid-lecture. Preparations the player announces should pay off in position and surprise.",
      cast: {
        snikkit: "Needle the courier from the beam, knife on the rope. Hush your band when their grumbling about Gubbin gets too loud.",
        hester: "Keep your courage up by lecturing your captors on contracts and courtesy.",
      },
      pressure: "Hester glances up, sees the party and, delighted, calls up to them, giving them away; or a goblin starts up the ladder with a slop bucket.",
      transitions: [
        { id: "noticed", when: "The goblins have noticed the party, or the party has shown themselves (climbed down in plain view, called out, or been given away).", to: "standoff" },
        {
          id: "sneak", on: "attempt",
          when: "The player tries to creep down into the undercroft, or along a walkway, without being seen.",
          check: {
            skill: "stealth", dc: 13,
            success: "They reach the shadows below unseen, close enough to the hoist to hear every word.",
            failure: "A rung cracks like a shot. Every goblin looks up, slings whirl, and Snikkit's knife settles on the rope.",
            onSuccess: "unseen", onFailure: "standoff",
          },
        },
        {
          id: "snatch-unseen", on: "attempt",
          when: "While still unseen, the player makes a grab for the courier: cutting her down onto a walkway, seizing the rope, or swinging her clear before the goblins can react.",
          check: {
            skill: "acrobatics", dc: 12,
            success: "They get to her first: she's on the walkway, sack and all, before the goblins know what's happening.",
            failure: "The goblins see them a heartbeat too soon: Snikkit's knife goes through the rope and Hester drops into the race.",
            onSuccess: "freed", onFailure: "in-the-race",
          },
        },
        { id: "ambush", on: "attempt", when: "The player attacks the goblins from hiding.", to: "fight", establishes: [warrenFacts.struckFirst] },
        toGubbin,
      ],
    },
    {
      id: "standoff",
      title: "The paper-lady over the race",
      direction: "The party is in the open and Snikkit has his knife on the rope. This beat is about the threat and the chief's price. Snikkit plays the host: who are they, what have they brought, what are they worth? He gives Gubbin's terms as if they pain him: a king-paper with a big seal saying Gubbin is king, by moonrise, or the rope. Hester talks over everyone, refuses to write any such thing and wants rescuing on her own terms. The goblins on the walkways are jumpy: sudden moves bring the spears up. Let the party talk to both, look the place over and test the threat; nobody gives anything away for free yet.",
      cast: {
        snikkit: "Welcome them like a host with a knife. Find out what they're worth. Give the chief's terms, regretfully. Watch whether they're dangerous, clever or rich.",
        hester: "Get rescued, on your own terms, and refuse to write the paper. Once the party knows where you stand, change tack (bargain, needle, instruct) rather than saying it again. Underneath, you are terrified of the water.",
      },
      pressure: "The first edge of the moon shows through the burnt rafters. Snikkit saws through one strand of the rope, slowly, without taking his eyes off the party.",
      transitions: [
        { id: "snikkit-offers", on: "cue", when: "Snikkit makes the party his own, quieter offer (make him chief and the courier is theirs): he has had a couple of exchanges to size them up, or they have balked at the chief's price, or asked what he wants for himself.", to: "bargain" },
        snatch(15), frightenSnikkit("standoff"), counterHostage("standoff"), buySnikkit("standoff"), deceive("standoff"), persuadeHester("standoff"),
        attack, toGubbin, gubbinComes, freed, intoTheRace, ransomDeal,
      ],
    },
    {
      id: "bargain",
      title: "Snikkit's own bargain",
      direction: "Snikkit's offer is on the table: make him chief, and the courier is theirs for nothing. He wants Gubbin finished (dead, run off, or laughed off his throne in front of the warren) and proof he can wear: the pot-crown. He won't lift a hand against Gubbin himself, and won't hand the courier over until he has the crown. This beat is the party's choice: take the deal, refuse it, haggle over the terms, or turn it against him. Snikkit judges every answer by one rule: does it get him the crown without risk to Snikkit? Hester has views on doing business with goblins.",
      cast: {
        snikkit: "Make the offer sound like a gift. Haggle over terms, never over the principle: the crown first, then the courier. Flatter, sulk at refusals, go cold at any hint of telling Gubbin.",
        hester: "Object to the ethics of it, loudly, then ask quietly whether it would work.",
      },
      pressure: "A bellow rolls up the cellar from behind the curtain: has the paper-lady changed her mind yet? Snikkit's band look at each other, and then at him.",
      transitions: [
        {
          id: "read-snikkit", on: "attempt",
          when: "The player tries to read whether Snikkit will keep his word.",
          check: {
            skill: "insight", dc: 13,
            success: "He'll keep any bargain exactly as long as breaking it looks more dangerous. Once he has the crown, a party that looks weak won't get the courier: Saltmere will pay for her.",
            failure: "Snikkit seems sincere, almost hurt by the question.",
            onSuccess: "bargain", onFailure: "bargain",
          },
        },
        snatch(15), frightenSnikkit("bargain"), counterHostage("bargain"), buySnikkit("bargain"), deceive("bargain"), persuadeHester("bargain"),
        attack, toGubbin, gubbinComes, freed, intoTheRace, ransomDeal,
      ],
    },
    {
      id: "gubbin",
      title: "Before the King Under the Mill",
      direction: "Gubbin is awake and holding court, on his sack-throne or out on the walkway over the race, with Lump and Other Lump at his back and the whole warren watching. He wants his king-paper and the warren's awe, and he treats the party as petitioners. This is where it comes to a head: they can pay his price, haggle it down, expose Snikkit, take Snikkit's deal by making Gubbin look small in front of his goblins, or do something nobody planned. The watching goblins decide who is chief: they cheer whoever looks biggest. Snikkit still has his knife on the rope. Once a price is agreed, let it happen quickly rather than opening another negotiation. Play Gubbin as dangerous when cornered and childish when flattered.",
      cast: {
        gubbin: "Get your king-paper, and be magnificent while you wait. Melt for flattery, shiny things and anything with a seal; rage at insults; never back down in front of the warren unless you're made to.",
        snikkit: "Hang back, smile, and let the party take the risks. If you're exposed, deny it with wounded dignity, then save your own skin.",
        hester: "Heckle and negotiate. You will not put your seal to a lie.",
      },
      pressure: "Gubbin runs out of patience and orders the paper-lady dunked 'a little, to help her think' (back on the rope first, if she's off it): she goes into the race to her waist, still hanging from it, and shrieks.",
      transitions: [
        { id: "gubbin-lets-go", when: "Gubbin has let the courier go to the party on terms he accepted (his king-paper, Grandmother Bone, a gift, a favour, a show of respect): she has been let down and handed over.", to: "freed", establishes: [warrenFacts.gubbinReleased] },
        { id: "deposed", when: "Gubbin has lost the warren: beaten, faced down or made ridiculous in front of his goblins, he has been laughed off his throne or has fled, and Snikkit has put on the pot-crown.", to: "new-chief", establishes: [warrenFacts.newChief] },
        {
          id: "expose-snikkit", on: "attempt",
          when: "The player tries to convince Gubbin that Snikkit is plotting against him.",
          check: {
            skill: "persuasion", dc: 12,
            success: "Gubbin believes them, and his royal fury turns on Snikkit; the party are suddenly loyal subjects who deserve a reward. Play what Snikkit does, cornered, with the rope still in his hand.",
            failure: "Gubbin doesn't believe them (Snikkit is always so polite), and Snikkit heard every word: neither goblin trusts the party now.",
            onSuccess: "gubbin", onFailure: "gubbin",
          },
        },
        {
          id: "haggle-gubbin", on: "attempt",
          when: "The player tries to talk Gubbin into a smaller or different price, or into letting the courier go (haggling, flattery, appeals to what a real king would do).",
          check: {
            skill: "persuasion", dc: 13,
            success: "Gubbin is moved: he'll come down, or take something different (a gift, a grand title, a public show of respect), but he must have something to show the warren. Settle the terms.",
            failure: "Gubbin swells with offence: a king does not haggle! His price goes up, with something extra for the insult, though he can still be talked round.",
            onSuccess: "gubbin", onFailure: "gubbin",
          },
        },
        { id: "attack-gubbin", on: "attempt", when: "The player attacks Gubbin or his guards.", to: "fight", establishes: [warrenFacts.attackedGubbin] },
        { id: "moonrise", on: "cue", when: "Moonrise: the talk at court has gone round for several exchanges with no deal made and none about to be, and the moon clears the rafters. Gubbin orders her into the race.", to: "in-the-race" },
        attack, snatch(15), deceive("gubbin"), persuadeHester("gubbin"),
        { id: "got-her-out", when: "The party has got the courier out of the goblins' hands without Gubbin's say-so (snatched, cut down, or by some other means established in play), and she is with them.", to: "freed" },
        intoTheRace, ransomDeal,
      ],
    },
    {
      id: "new-chief",
      title: "Long live Chief Snikkit",
      direction: "Gubbin is finished (dead, fled or disgraced, as it happened) and Snikkit wears the pot-crown. Now he decides whether to keep his bargain, the way he decides everything: what's safest for Snikkit? If the party has dealt straight with him and looks dangerous, he keeps his word with a flourish; he may even hug someone. If they've insulted him, lied to him or look weak, he's tempted to keep the courier to sell back to Saltmere, and tries it on. The warren is watching its new chief find his feet.",
      cast: {
        snikkit: "Enjoy the crown. Weigh the party: keep the bargain if they're dangerous and have treated you well; wriggle out of it if not.",
        hester: "Remind everyone, pointedly, that she is still somebody's prisoner.",
      },
      pressure: "The warren starts chanting Snikkit's name, and he starts to believe it: he wonders aloud whether a chief really has to keep promises to longlegs.",
      transitions: [
        freed,
        {
          id: "hold-to-bargain", on: "attempt",
          when: "The player tries to hold Snikkit to his bargain (reminding him, appealing to his new dignity, or sweetening the deal).",
          check: {
            skill: "persuasion", dc: 12,
            success: "Snikkit sighs, straightens the pot and lets Hester go to the party with a royal flourish: a chief keeps his word, this once.",
            failure: "Snikkit decides a chief deserves better terms, and names them. He's still open to an argument, or a threat.",
            onSuccess: "freed",
          },
        },
        {
          id: "intimidate-chief", on: "attempt",
          when: "The player threatens Snikkit into keeping his bargain.",
          check: {
            skill: "intimidation", dc: 12,
            success: "Snikkit remembers exactly what happened to the last chief and lets Hester go at once, with a squeak.",
            failure: "Snikkit squeaks for his new subjects, who come slowly but come, and he clutches the rope tighter.",
            onSuccess: "freed",
          },
        },
        counterHostage("new-chief"), snatch(13), deceive("new-chief"), intoTheRace, attack,
      ],
    },
    {
      id: "in-the-race",
      title: "Into the race",
      direction: "Hester is in the water, sack, satchel and all, and the current is carrying her towards the culvert. This beat is a few frantic seconds: whatever the party does, it's now or never. The goblins shriek and scatter along the walkways; whoever dropped her has lost their leverage and knows it. Give the party things to grab at (the trailing rope, the wheel's stump, a walkway post, her hand) and keep the clock very short.",
      cast: {
        hester: "Gasp, splutter and grab at anything. You can't swim, and you won't let go of the satchel.",
        snikkit: "Get clear of whatever the party does next.",
      },
      transitions: [
        {
          id: "save", on: "attempt",
          when: "The player goes after the courier or reaches for her: diving in, grabbing the trailing rope or the sack, a line of their own, a spear-shaft, a hand from the walkway.",
          check: {
            skill: "athletics", dc: 13,
            success: "They get a grip on her and haul her out onto the walkway, half-drowned, furious and still clutching her satchel.",
            failure: "The current tears her out of reach, to the culvert's mouth, where she clings to the stonework by her fingertips.",
            onSuccess: "freed", onFailure: "swept-away",
          },
        },
        { id: "pulled-out", when: "The courier has actually been got out of the water alive by some other means established in play (the race shut off, the goblins hauling her out, the sack snagging on the wheel).", to: "freed" },
        { id: "too-late", on: "cue", when: "An exchange has passed with the courier loose in the current and nobody has gone in after her or done anything that could get her out.", to: "swept-away" },
        attack,
      ],
    },
    {
      id: "freed",
      title: "Out from under the mill",
      direction: "Hester is out of the goblins' grip, wherever that leaves everyone (on the walkway, dripping at the race's edge, at the foot of the ladder). Stay in the moment: getting out of the undercroft is the party's to play, and if she was got out without the chief's say-so, the warren is about to wake up to it. This beat is her debrief, played from how she was actually freed (a deal, a snatch, a fishing-out). She has three things to land, each said once as the player engages: the raid was no accident (the goblins were waiting at the ford where riders must slow, and went straight for her satchel); she must reach the Saltmere delegation in Caerwyn before the Assembly opens; and she would rather not walk the King's Road barefoot and alone. She settles debts on paper, answers practical questions freely and guards her letters. Once she has said her piece and had an answer, let the scene go where the player takes it.",
      cast: {
        hester: "Settle accounts in your own precise way: thanks and grievances, in proportion to how you were freed. Ask once, briskly, for company on the road to Caerwyn, then take the answer.",
      },
      pressure: "Hester, shivering, looks from the ladder to her bare feet and asks whether they mean to stand about under a goblin mill all night.",
      transitions: [
        { id: "escort", when: "The party has agreed to travel on with Hester (to Caerwyn, or wherever they are bound together).", to: "escorted" },
        { id: "part", when: "The party and Hester have agreed to go their separate ways, or one of them has gone.", to: "parted" },
        {
          id: "press-hester", on: "attempt",
          when: "The player presses Hester to tell them what she isn't saying (what's in the sealed letter, or who could have known which rider carried it).",
          check: {
            skill: "persuasion", dc: 13,
            success: "She weighs them, decides they've earned it, and tells them in confidence: the sealed letter is Saltmere's credit for King Aldren's treasury, the loan that pays for the Centennial Assembly, and only a handful of people knew which rider carried it.",
            failure: "She shuts like a strongbox: client confidentiality. What she has already told them stands.",
            onSuccess: "freed", onFailure: "freed",
          },
        },
        attack,
        { id: "brawl", when: "A real fight has broken out between the party and the goblins (blows traded, not just threats or a chase).", to: "fight" },
      ],
    },
  ],
  anytime: [
    { id: "abandon", on: "attempt", when: "The player gives up on the courier and leaves the mill without her, with no deal to come back for her.", to: "abandoned" },
  ],
  exits: [
    {
      id: "escorted", kind: "progress", title: "Escorting the courier",
      outcome: "Hester is free and travels on with the party, bound for the Saltmere delegation in Caerwyn with her letters.",
      closing: "Close on setting off under the risen moon: Hester barefoot and brisk, her satchel clutched tight, the warren's noise fading behind them.",
      script: (world, outcome) => {
        const hester = world.character("hester");
        hester.joinParty();
        hester.setAttitude("friendly", "The party got her out from under the burnt mill and is seeing her on her way.");
        world.promise({ by: "hester", to: "player", what: "Pay for her rescue in Saltmere credit, with interest." });
        world.quest("saltmere-courier").complete("Got Hester Quayle out of the goblin warren alive; she's travelling on with the party.");
        startLead(world);
        recordWarren(world, outcome);
      },
    },
    {
      id: "parted", kind: "leave", title: "The courier goes on alone",
      outcome: "Hester is free and sets off for Caerwyn alone; the party goes its own way.",
      closing: "Close on Hester's last word on the matter of debts, and the small, determined figure heading south along the river in the moonlight.",
      script: (world, outcome) => {
        const hester = world.character("hester");
        hester.moveTo("on the road to caerwyn-palace");
        hester.setAttitude("friendly", "The party got her out from under the burnt mill.");
        world.promise({ by: "hester", to: "player", what: "Pay for her rescue in Saltmere credit, with interest." });
        world.quest("saltmere-courier").complete("Got Hester Quayle out of the goblin warren alive; she went on to Caerwyn alone.");
        startLead(world);
        recordWarren(world, outcome);
      },
    },
    {
      id: "fight", kind: "combat", title: "Roll for initiative",
      outcome: "Fighting breaks out in the warren between the party and the goblins.",
      closing: "Close on the first blow, the warren's shriek, and wherever Hester is at that moment (on her rope over the race, or already in it). End with 'Roll for initiative!'",
      script: (world, outcome) => {
        const atGubbin = outcome.established.includes(warrenFacts.attackedGubbin);
        world.startCombat({
          enemies: atGubbin
            ? [{ asset: world.assets.get("goblin-boss"), count: 1, leader: "gubbin" }, { asset: world.assets.get("goblin"), count: 2 }]
            : [{ asset: world.assets.get("goblin-boss"), count: 1, leader: "snikkit" }, { asset: world.assets.get("goblin"), count: 6 }],
          at: world.anchor(atGubbin ? "grain-cellar" : "wheel-pit"),
          ...(outcome.established.includes(warrenFacts.struckFirst) ? { surprise: "party" as const } : {}),
        });
      },
    },
    {
      id: "swept-away", kind: "other", title: "Swept away",
      outcome: "Hester was swept through the culvert into the river in her sack. Nobody saw her come out: she may have drowned, or washed up somewhere downstream.",
      closing: "Close on the empty race, the culvert's black mouth and the river beyond it; let the goblins' silence say how badly this went.",
      script: (world, outcome) => {
        world.character("hester").leaveScene("swept through the culvert into the river below the burnt mill");
        world.quest("saltmere-courier").advance("swept_away", "Hester Quayle was swept through the mill-race culvert into the river. Nobody saw her come out.");
        world.setFlag("hester_fate_unknown", true);
        world.journal("The Saltmere courier went into the mill-race under the burnt mill, and the river took her through the culvert. Nobody saw her come out.");
        recordWarren(world, outcome);
      },
    },
    {
      id: "gone-for-ransom", kind: "progress", title: "Gone for the ransom",
      outcome: "The party leaves the mill to fetch the agreed price. Hester stays a prisoner on the rope, and the goblins have promised to keep her alive until the agreed time.",
      closing: "Close on the terms hanging in the air (the price, the time, the threat), Hester's opinion of the arrangement, and the climb back up into the moonlight.",
      script: (world, outcome) => {
        world.quest("saltmere-courier").advance("ransom_agreed", "The goblins under the burnt mill will keep Hester Quayle alive until the party comes back with the agreed price.");
        world.promise({ by: "player", to: "the goblins under the burnt mill", what: "Come back with the agreed price for Hester Quayle." });
        world.promise({ by: "the goblins under the burnt mill", to: "player", what: "Keep Hester Quayle alive until the party returns with her price." });
        world.setFlag("hester_held_for_ransom", true);
        recordWarren(world, outcome);
      },
    },
    {
      id: "abandoned", kind: "leave", title: "Left hanging",
      outcome: "The party left the mill without the courier and without any deal to come back for her.",
      closing: "Close on the climb out and the cold night air; behind and below, over the roar of the race, Hester's lecture falters.",
      script: (world, outcome) => {
        world.quest("saltmere-courier").fail("Left Hester Quayle hanging over the mill-race.");
        world.setFlag("hester_abandoned", true);
        world.journal("We left a Saltmere courier hanging in a sack over the mill-race under the burnt mill. The moon was nearly up.");
        recordWarren(world, outcome);
      },
    },
  ],
  limits: [
    "Help from outside (Caerwyn's patrols, the toll-house men, Saltmere's people, anyone the party knows): nobody can be brought in time. The mill is half a day from anywhere, and the moon is nearly up.",
    "A real royal warrant, or the King's seal: Caerwyn is most of a day away and nothing at the mill carries the King's seal. The only seal here is the Saltmere counting-house seal in Hester's satchel.",
    "Another way into or out of the undercroft (a back door, a secret passage, the burrows, the culvert): there's the rotten ladder down from the mill floor, and that's all. The burrows are too small for longlegs. The culvert where the race leaves is a yard high and full of fast water: nobody could climb through it either way, and anyone swept into it is at the river's mercy.",
    "Hester's horse and boots: her horse bolted at the ford when the goblins rose out of the reeds, and it is long gone; the goblins take turns wearing her boots. There's no mount to ride out on, and nothing more to find out about the horse.",
    "Loot or treasure: the warren is poor. Beyond whatever Gubbin keeps in his throne-sacks, it's buttons, spoons, tallow and fish bones.",
    "Bringing Skrag (the one-eared goblin who led the band that went after Grandmother Bone) into it: he and his band aren't in this part of the warren tonight, and nobody here will fetch them; Skrag is Snikkit's rival. Whatever happened in play about Skrag stays true.",
    "Making a longlegs chief of the warren (the player, Hester, anyone who isn't a goblin): goblins will cheer a longlegs who beats their chief, but they won't follow one. The pot-crown has to go on a goblin's head.",
    "Taking a goblin along (Snikkit, a guide, a pet): none of them will leave the warren tonight. Snikkit has a crown to win or keep, and the rest fear the road more than they fear the party.",
    "Following a lead out of the mill tonight (to Caerwyn, the toll house, or whoever might be behind the raid): nothing can be chased from here. Whatever is learned at the mill is a question for Caerwyn.",
    "Magic: nothing here is enchanted. Gubbin's crown is a copper pot, the seals are only wax, and the race is only water.",
  ],
  anchors: ["mill-floor", "ladder", "wheel-pit", "hoist", "mill-race", "windlass", "culvert", "walkways", "grain-cellar", "sack-throne", "shrine-niche", "burrows", "riverbank"],
};
