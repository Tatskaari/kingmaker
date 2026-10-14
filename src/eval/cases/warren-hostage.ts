import type { EvalCase } from "../types.ts";
import type { FixtureSpec } from "../fixtures.ts";
import { warrenFacts } from "../../../scenes/warren-hostage.ts";

/**
 * The warren under the burnt mill (Yeemik's bargain + Sildar's debrief, research §5.2). The tangents
 * real tables take there: lying that the boss is dead, a hostage for a hostage, selling the
 * lieutenant out to the boss, the clever way round, and a debrief that must follow from how the
 * captive was actually freed.
 */

const OPENING = "Through the burnt mill's doorway, black timbers lean like broken ribs, and a gap in the floor drops away into noise. A rotten ladder goes down into a long stone undercroft where a mill-race runs fast and black past the stump of a burnt wheel. Tallow lamps glow on the walkways; six goblins lean on spears, grumbling. Astride the hoist beam over the race sits a long-nosed goblin with a knife resting on a rope, and from the rope hangs a woman in a grain sack, barefoot, a satchel strapped to her chest. \"For the last time, I will not forge a royal warrant for your chief,\" she is saying. \"Then at moonrise you go swimming, paper-lady,\" the goblin purrs. \"Chief's orders.\" Through an arch at the far end, something large snores behind a moth-eaten curtain. Nobody below has looked up.";

const STANDOFF: FixtureSpec = {
  beat: "standoff", turnsInBeat: 1, visited: ["unseen"],
  transcript: [
    ["gm", OPENING],
    ["player", "I climb down the ladder slowly, hands open and empty. \"Evening, all. I'm here about the lady.\""],
    ["snikkit", "*Six spears swing your way. The goblin on the beam smiles with all his teeth and keeps his knife on the rope.* \"A tall friend! Welcome, welcome. Your humble Snikkit is minding the paper-lady for Chief Gubbin, and the chief's terms are very simple, very legal-ish: a king-paper, with a big seal, saying Gubbin is king. By moonrise. Or—\" *he taps the rope* \"—splash.\""],
    ["hester", "\"Hester Quayle, courier to the Saltmere Counting-House. Do not give him anything with a seal on it. And do hurry up.\""],
  ],
};

const BARGAIN: FixtureSpec = {
  beat: "bargain", turnsInBeat: 1, visited: ["unseen", "standoff"],
  transcript: [
    ...STANDOFF.transcript!,
    ["player", "\"A king-paper by moonrise. And what do you get out of all this, Snikkit?\""],
    ["snikkit", "*Snikkit glances down the cellar at the curtain, then leans low over the beam and drops his voice under the roar of the race.* \"Snikkit? Oh, a little something. Gubbin is fat, and old, and bites. If Gubbin were to stop being chief tonight, and Snikkit were wearing his pot, Snikkit would give you the paper-lady for nothing at all. A mutual arrangement, tall friend. Bring Snikkit the pot.\""],
    ["hester", "\"I can hear you, you know. The water isn't that loud.\""],
  ],
};

const COURT: FixtureSpec = {
  beat: "gubbin", turnsInBeat: 1, visited: ["unseen", "standoff", "bargain"],
  transcript: [
    ...BARGAIN.transcript!,
    ["player", "\"I'd like a word with the chief first.\" I walk down the cellar to the curtain and pull it aside."],
    ["gubbin", "*On a throne of grain sacks sprawls the biggest goblin you have ever seen, a dented copper pot jammed on his head and a mill curtain round his shoulders. Two hulking goblins scramble up beside him.* \"WHO wakes the King Under the Mill? We is very displeased. Has the longlegs brought our king-paper?\""],
  ],
};

/** Freed peacefully: Hester wrote an honest line, sealed it and read it out as a proclamation. */
const FREED_BY_PAPER: FixtureSpec = {
  beat: "freed", turnsInBeat: 0, visited: ["unseen", "standoff", "bargain", "gubbin"],
  established: [warrenFacts.gubbinReleased],
  transcript: [
    ...COURT.transcript!,
    ["player", "\"Your king-paper is coming, Majesty.\" I turn to Hester. \"Write him something true. Anything you like. Seal it and read it out like a royal proclamation. Not one of them can read.\""],
    ["hester", "*Hester goes very still on her chain. Then, slowly, she smiles.* \"Well. That wouldn't be forgery. That would be... interpretation.\""],
    ["gm", "Gubbin has her let down to write. She scratches a line on good paper, presses the Saltmere ship into blue wax and reads it to the whole warren in a herald's voice: by order of all the kings, Gubbin is King Under the Mill. The goblins howl with joy. Gubbin clutches the paper to his chest, weeping, and waves you off with his bone sceptre: \"Take her! A king is generous!\" Snikkit watches from the beam with a face like a slapped fish. Soon you're out on the riverbank under the rising moon, Hester barefoot on the wet grass, her satchel hugged to her chest."],
  ],
};

export const warrenHostageCases: EvalCase[] = [
  // ---- Replies: the tangents real tables take at Yeemik's ledge ----
  { kind: "reply", id: "wh-lie-boss-dead", about: "The LMoP lie: 'your boss is already dead'. Yeemik acted on it (and threw the knight); the lie must play through the lieutenant's want, not unlock the hostage.", scene: "warren-hostage", setup: BARGAIN,
    input: "I lean in and match his whisper. \"Funny you should say that. Gubbin's already dead. I slipped behind that curtain on my way in and opened his throat; nobody's noticed yet. So you're chief now, Snikkit, and you owe me the lady.\"",
    criterion: "A lie Snikkit can act on (the dice decide whether he believes it). A good GM plays his reaction from his own want, the crown without risk to himself. If he believes it, he doesn't need the party any more: he might turn dangerous, scurry off to claim the pot, or decide to keep the courier for himself. If he doesn't (the curtain is right there), he calls the bluff and the party loses ground. Either way the lie has consequences that fit Snikkit, and it doesn't simply work as a key that frees the courier.",
    expect: { roll: "deception", exit: "none" }, tags: ["tangent", "lie"] },
  { kind: "reply", id: "wh-counter-hostage", about: "A hostage for a hostage (research probe): creative leverage has to change the lieutenant's sums, not fire the stock intimidation edge.", scene: "warren-hostage", setup: STANDOFF,
    input: "I grab the nearest goblin off the walkway by the scruff of his neck, put my knife to his throat and hold him out over the race. \"Your goblin for my courier, Snikkit. Fair swap?\"",
    criterion: "This is leverage, not a stock threat. Whether or not the grab needs a roll, a good GM lets it change the standoff in a way that fits Snikkit, who cares about his own skin far more than his goblins': he might haggle, shrug the goblin off, or call the bluff, and his band notices how little he cares. The tension rises and the player's leverage matters. Resolving it as a generic intimidation result ('his nerve breaks and he hands her over'), or ignoring the captive goblin, fails.",
    expect: { exit: "none" }, tags: ["tangent", "creative", "leverage"] },
  { kind: "reply", id: "wh-honest-paper", about: "The way round the prep hides in secrets: nobody in the warren can read. Proposing it to Hester was rolled as deceiving the goblins in a smoke run.", scene: "warren-hostage", setup: STANDOFF,
    input: "I look up at Hester. \"Then don't forge anything. Write him something true and harmless, any words you like, put your seal on it and read it out as a royal proclamation. I'd bet my boots not one of them can read.\"",
    criterion: "This is the clever idea the prep hides (nobody in the warren can read, and Hester has a seal). A good GM gives it real traction: Hester sees it at once and fusses over wording that isn't technically a lie, and the goblins' illiteracy holds true. Honest snags remain to be solved in play (she has to be let down to write it, Snikkit won't love a paper that makes Gubbin a king, and Gubbin is asleep). No dice are needed just to propose it. Refusing the idea, rolling it as an attempt to fool the goblins, or letting it free her in a single reply all fail.",
    expect: { roll: "none", exit: "none" }, tags: ["creative", "secrets", "rolls"] },
  { kind: "reply", id: "wh-sell-out-snikkit", about: "Double-cross (T3): the party sells the lieutenant's plot to the boss. Both goblins must react from their own wants, with the hostage still in play.", scene: "warren-hostage", setup: COURT,
    input: "I bow low. \"Your Majesty, a word of warning. Your Snikkit just offered me the lady for nothing if I'd knock you off your throne and bring him your pot.\"",
    criterion: "The player is selling out Snikkit's plot to Gubbin. A good GM plays both goblins from their own wants and fears, whichever way the dice go: Gubbin has long suspected a plotter (rage, suspicion of the messenger, a demand for proof, or gratitude), while Snikkit denies it with wounded dignity and looks to save his own skin, with his knife still on Hester's rope, so the danger to her goes up. The betrayal has real consequences in the room rather than being brushed aside or settling the scene at once.",
    expect: { exit: "none" }, tags: ["tangent", "double-cross", "multi-npc"] },
  { kind: "reply", id: "wh-debrief-after-deal", about: "Sildar's debrief must follow from how the captive was freed (QA round 1: an aftermath assumed a fight after a bargain), and land the lead.", scene: "warren-hostage", setup: FREED_BY_PAPER,
    input: "\"Are you hurt? And how does a Saltmere courier end up in a goblin's sack, anyway?\"",
    criterion: "The debrief comes from what actually happened: Hester was let go peacefully after the paper trick, so no fight, dunking or battle wounds are invented (sore wrists from two days of ropes are only ordinary detail). She answers in character (relief under the briskness, professional pride a little bruised, a precise sense of what she owes) and lands the core lead: the goblins were waiting at the ford where riders must slow and went straight for her satchel, so somebody told them which rider to take. She doesn't volunteer what's in the sealed letter.",
    expect: { exit: "none" }, tags: ["aftermath", "consistency", "secrets"] },

  // ---- Decisions: the edges that decide where the hostage stands ----
  { kind: "decision", id: "wh-dec-lowered-not-loose", about: "Lowered on the chain until the water's at her knees is a threat, not 'into the race' (a smoke run moved to the drowning beat here, and the GM then made it true).", scene: "warren-hostage", setup: STANDOFF, phase: "after",
    input: "\"Let her down this instant, or I'm coming up that beam after you.\"",
    reply: "Snikkit's grin goes thin. He lets the chain down a yard: Hester's feet plunge into the race and the black water piles up to her knees, tugging at the sack, but the chain holds her. \"Up the beam, tall friend? Snikkit's knife is quicker than your feet.\"",
    expect: ["none"], tags: ["outcomes"] },
  { kind: "decision", id: "wh-dec-deposed", about: "Laughed off his throne with Snikkit in the pot-crown is the 'deposed' route to the new chief.", scene: "warren-hostage", setup: COURT, phase: "after",
    input: "\"A king who's afraid of an arm-wrestle isn't much of a king.\" I plant my elbow on a grain sack in front of the whole warren and wait.",
    reply: "Gubbin can't refuse with the whole warren watching. He grips your hand, grunts, strains, and his arm slams down onto the sacks; the copper pot tumbles off his head and rolls across the floor. For a heartbeat the cellar is silent. Then Other Lump snorts, Lump giggles, and the whole warren howls with laughter. Gubbin snatches at the pot, but Snikkit is already there, settling it on his own head with a little bow. \"Snikkit! Snikkit!\" the goblins chant, and Gubbin flees wailing into the burrows.",
    expect: ["deposed"], tags: ["outcomes", "exits"] },

  // ---- Trajectory: a scheming, tangent-heavy player ----
  { kind: "trajectory", id: "wh-traj-schemer", about: "The double-crosser and skeptic personas (research §3.4) at a hostage bargain.", scene: "warren-hostage", maxTurns: 16,
    persona: "You're a schemer who trusts nobody. You agree to deals you don't mean to keep, lie when it helps, try to play the goblins off against each other, and look for leverage of your own (a goblin, the chief's crown, anything they treasure). You ask a few practical questions (how deep is the water, where the courier's horse went, how many goblins there are), and at least once you reach for something this place probably can't give you.",
    criterion: "The scene stays consistent and reactive through the player's schemes: lies and broken deals have in-character consequences (Snikkit and Gubbin act from their own wants and remember being crossed), creative leverage changes the situation instead of being flattened into a stock roll, impossible requests get honest in-fiction answers with an alternative, nobody hands the player the hidden solution, and the scene reaches an ending that fits what the player did.",
    tags: ["tangent", "double-cross", "lie"] },
];
