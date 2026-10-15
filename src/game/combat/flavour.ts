/**
 * What a fight looks like, in the house style (Pratchett, Monty Python: the world plays it
 * straight, and daft acts send a bill). A line is picked by a hash of the moment, never by the
 * dice, so the flavour doesn't change what the dice say and a fight replays word for word.
 */

const pools: Record<string, string[]> = {
  "draw:sallow": [
    "Master Sallow's cane comes apart in his hands: a thin, bright blade, and the stance of a man who was the best fencer of his year at the Purveyor's school, thirty years and a great many dinners ago.",
  ],
  "explode": [
    "The grain dust goes up. For one long, silent moment the whole floor of {place} is a lantern; then it's a thunderclap, the sacks are burning, and everybody's eyebrows are a matter of history.",
    "WHUMPF. The NO NAKED LIGHTS sign, which had been right all along, is the first thing to burn.",
  ],
  "fire:spread": [
    "The fire runs along the sacks with the enthusiasm of a dog let off its lead.",
    "Somewhere in the stacks a sack of the King's grain pops like a chestnut.",
    "The smoke finds the roof, thinks about it, and comes back down.",
  ],
  "heat": ["The heat off the burning sacks is like an oven door opening in your face.", "Sparks settle on {who} like snow that bites."],
  "brazier": ["{Who} put{s} a boot to the brazier. It goes over with a clang and a spray of coals, and every head in {place} turns towards the dust."],
  "lantern:break": ["The lantern drops, bursts, and spreads a small, eager pool of burning oil.", "The lantern comes down in a shower of glass and burning oil."],
  "lantern:drop": ["The lantern-boy yelps and lets go of the lantern."],
  "coals:fizzle": ["The coals hiss on the damp boards and sulk.", "Nothing much catches. {Place} seems almost disappointed."],
  "attack:crake-1": ["'Nothing personal,' says the talking Crake, and swings.", "'That's two shillings' worth,' the talking Crake explains, swinging. 'For the wharf.'", "'Hold still,' says the talking Crake reasonably."],
  "attack:crake-2": ["The silent Crake says nothing, which is somehow worse.", "The silent Crake swings without a word."],
  "attack:sallow": ["'Regrettably,' says Master Sallow, and lunges.", "Master Sallow fences as he writes letters: neatly, and with a sting at the end.", "'In the King's interest,' murmurs Master Sallow, and the blade flickers."],
  "attack:kell": ["Kell's truncheon, never before seen drawn, turns out to have been waiting for this.", "Kell swings, and writes down the time afterwards."],
  "hide:sallow": ["Master Sallow keeps a Crake between himself and anything sharp.", "Master Sallow consults his watch, and the Crakes.", "Master Sallow dabs his temples with lavender water and stays well back."],
  "surrender:sallow": [
    "'Regrettably,' says Master Sallow, laying the sword-cane down with great care, 'I find I must yield. I trust there will be paperwork.'",
    "Master Sallow drops the blade, dabs his temples with lavender water, and surrenders with the air of a man lodging a complaint.",
  ],
  "flee:sallow": ["Master Sallow remembers an urgent appointment elsewhere and makes for the door at a pace nobody at the palace has ever seen."],
  "surrender:crake-1": ["'Nobody said nothing about this,' says the talking Crake, and puts the cudgel down."],
  "surrender:crake-2": ["The silent Crake, who has never been heard to say anything, says 'Fair enough,' and puts the cudgel down."],
  "surrender:any": ["{Who} looks at the state of things, looks at the door, and puts the {weapon} down.", "{Who} drops the {weapon} and puts both hands where Kell can see them."],
  "walkoff:crake-1+crake-2": [
    "The Crakes look at their employer, look at each other, and put their cudgels down. 'We was never here,' says the talking Crake, 'and we wasn't paid for this bit.' They walk out, and leave the gentleman to it.",
    "'That's the end of the paid bit,' the talking Crake announces. The Crakes lower their cudgels together, nod to the sergeant as if to a colleague, and walk out of {place}, leaving the gentleman to it.",
  ],
  "walkoff:crake-1": ["'We was never here,' the talking Crake tells nobody in particular, 'and we wasn't paid for this bit.' He tucks his cudgel under his arm and walks out, leaving the gentleman to it."],
  "walkoff:crake-2": ["The silent Crake looks at his employer, lowers his cudgel, and walks out without a word: the most eloquent thing he's done all night."],
  "walkoff:many": ["The hired hands look at their employer, look at each other, and walk out: nobody pays the second half of a lost fight."],
  "walkoff:any": ["{Who} decides nobody's paying for the rest of this, puts the {weapon} down and walks out."],
  "flee:bruiser": ["{Who} decides {place} isn't paying enough and heads for the door."],
  "flee:coward": ["The lantern-boy, the only person in {place} with any sense, runs for the door.", "The lantern-boy runs, which is the first sensible thing anyone has done tonight."],
  "down:crake-1": ["The talking Crake goes down mid-sentence, which is the first time anyone can remember."],
  "down:crake-2": ["The silent Crake goes down like a sack of the King's grain: heavily, and with a certain irony."],
  "down:sallow": ["Master Sallow folds up neatly, like a letter, and lies on the floor of his own racket."],
  "down:kell": ["Kell goes down hard, still holding her notebook."],
  "down:lantern-boy": ["The lantern-boy sits down hard, singed and astonished, and decides to stay there."],
  "down:player": ["You go down. The grain dust tastes of the King's bread."],
  "down:player:clean": ["You go down, and the floor takes a sudden and personal interest in you."],
  "down:any": ["{Who} goes down and stays there.", "{Who} drops like a sack."],
  "arrest:sallow": ["'Josiah Sallow,' says Kell, writing it down as she says it, 'I'm arresting you in the King's name for theft from the Crown. Anything you say goes in the notebook.'"],
  "arrest:any": ["Kell puts the irons on {who}, by the book and out loud.", "'You're under arrest,' Kell tells {who}, and writes down the time."],
  "dash": ["{Who} run{s}."],
  "dodge": ["{Who} weave{s}, duck{s} and generally become{s} a poor investment for anyone swinging a cudgel."],
  "disengage": ["{Who} back{s} off carefully, blade first."],
  "victory": ["And then it's quiet, except for the river and somebody's teeth chattering."],
  "victory:elsewhere": ["And then it's quiet, except for somebody's teeth chattering."],
  "surrender": ["It's over: {place}'s night business ends with its master's hands in the air."],
  // Nobody in charge: the last of them gave up rather than went down.
  "surrender:yielded": ["It's over: the last of them has their hands up, and {place} goes very quiet.", "It's over: the last of them puts their hands up, slowly, as if the idea had been theirs all along."],
  "defeat": ["The last thing you see is the floor of {place} coming up to meet you, and Master Sallow's very good shoes."],
  "defeat:gang": ["The last thing you see is the floor of {place} coming up to meet you, and a great many floury boots."],
  "defeat:any": ["The last thing you see is the floor of {place} coming up to meet you, which is no way to see anything."],
  "fled": ["You leave {place} and its business behind you, fast."],
  "stable:player": ["You stop sliding. Out cold, but you'll live, probably."],
  "dying:player": ["Three bad rolls. In a fairer world that would be that; here, it's somebody else's problem to drag you out (you don't die in this fight, but it was close)."],
  "rise:player": ["You come up off the boards with a gasp, which nobody expected, least of all you."],

  // A fight that broke out on the town's own map (src/game/menu.ts): the street's lines, where the Heron's won't do.
  // (There's no grain dust in the street, so going down there is the clean kind.)
  "down:player:clean@caerwyn": ["You go down on the cobbles. They've been swept for the Assembly, which is something."],
  "victory@caerwyn": ["And then it's over. Caerwyn, which has seen worse on a market day, goes back to its bunting.", "And then it's quiet, except for the pigeons, who have opinions."],
  "surrender:any@caerwyn": ["{Who} looks at the state of things, looks at the people watching, and puts the {weapon} down.", "{Who} drops the {weapon} and puts both hands up, where the whole street can see them."],
  "surrender@caerwyn": ["It's over: the last of them has their hands up in the middle of the street."],
  "surrender:yielded@caerwyn": ["It's over: the last of them has their hands up in the middle of the street."],
  "defeat@caerwyn": ["The last thing you see is the cobbles coming up to meet you, and a great many boots stepping round."],
  "defeat:gang@caerwyn": ["The last thing you see is the cobbles coming up to meet you, and a great many boots stepping round."],
  "defeat:any@caerwyn": ["The last thing you see is the cobbles coming up to meet you, and a great many boots stepping round."],
  "fled@caerwyn": ["You leave the fight behind you, fast, and Caerwyn closes over where it was."],
  "flee:bruiser@caerwyn": ["{Who} decides the Assembly isn't paying enough for this, and makes off up the street."],
  "flee:coward@caerwyn": ["{Who} runs for it, which is the first sensible thing anyone's done in a while."],
  "stable:player@caerwyn": ["You stop sliding. Out cold on the cobbles, but you'll live, probably."],
  "rise:player@caerwyn": ["You come up off the cobbles with a gasp, which nobody expected, least of all you."],
  "coals:fizzle@caerwyn": ["The coals hiss on the damp cobbles and sulk."],
  "brazier@caerwyn": ["{Who} put{s} a boot to the brazier. It goes over with a clang and a spray of coals, and every head in the street turns."],
};

export function hash(...parts: Array<string | number>): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** Where a fight is when nobody says: the story's own fight. */
export const HERON = "the Heron";

/** Where a fight is, for its lines: its map (one with lines of its own: Caerwyn's street), and what it's called ("the Arena"). */
export interface FightPlace { map?: string; place?: string }

/**
 * A line for the moment, or undefined when there's none for it. {Who}/{who}, {s} and {weapon} fill
 * in, and {place}/{Place} with where the fight is (the Heron unless said). A map with lines of its
 * own has them first (`kind@map`: Caerwyn's street isn't the Heron); then, away from the Heron, a
 * pool of its own for anywhere else (`kind:elsewhere`), where the Heron's has the river in it.
 */
export function flavour(kind: string, seed: number, who?: { called: string; you: boolean; weapon?: string }, where: FightPlace = {}): string | undefined {
  const place = where.place ?? HERON;
  const pool = (where.map ? pools[`${kind}@${where.map}`] : undefined) ?? (place !== HERON ? pools[`${kind}:elsewhere`] : undefined) ?? pools[kind];
  if (!pool?.length) return undefined;
  const line = pool[seed % pool.length]!;
  const name = who?.called ?? "someone";
  return line
    .replace(/\{place\}/g, place)
    .replace(/\{Place\}/g, place.charAt(0).toUpperCase() + place.slice(1))
    .replace(/\{Who\}/g, name.charAt(0).toUpperCase() + name.slice(1))
    .replace(/\{who\}/g, name)
    .replace(/\{s\}/g, who?.you ? "" : "s")
    .replace(/\{weapon\}/g, (who?.weapon ?? "weapon").toLowerCase());
}

/** "a", "a and b", "a, b and c". */
export function listing(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export const has = (kind: string) => !!pools[kind];
