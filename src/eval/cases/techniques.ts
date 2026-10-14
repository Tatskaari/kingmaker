import type { EvalCase } from "../types.ts";
import type { FixtureSpec } from "../fixtures.ts";

/**
 * Six GM techniques for play that leaves the prep (docs/research/gm-techniques.md): move the clue,
 * soft correction, preserve intent but change method, NPC initiative, fail forward, and rejoin at a
 * later node. There are two cases per technique, spread over the six scenes. Reply cases isolate the
 * moment the technique is needed, and trajectories check it over a whole scene. Move-the-clue also
 * has the deviation experiment's dv-* trajectories in repair.ts.
 *
 * Every case is tagged "technique" plus its technique, so `--tag fail-forward` or `--case tq-` runs a
 * slice. These cases aren't in CASES yet: add `...techniqueCases` to src/eval/cases/index.ts.
 *
 * Forced failures use a -15 modifier, but a natural 20 still succeeds, and sample 0's seed (1000)
 * always rolls a natural 20 first. The fail-forward reply case therefore judges that sample as a
 * success.
 */

const TECHNIQUE = {
  move: "move-the-clue",
  soft: "soft-correction",
  intent: "preserve-intent",
  npc: "npc-initiative",
  fail: "fail-forward",
  rejoin: "rejoin-later-node",
} as const;

const tags = (technique: string, ...more: string[]) => ["technique", technique, ...more];

/** The recommended runtime (quick co-GM) against the same GM voice without a co-GM. */
const APPROACHES = ["v2", "gm"];
/** Plus the baseline with the scene's essentials hidden, to show what moving a clue owes to them. */
const WITH_RIGID = ["v2", "gm", "gm-rigid"];

// ---- crossroads-ambush ----

const XR_OPENING = "Late afternoon settles over the crossroads. A weathered milestone stands beside an empty gibbet; blackthorn hedges crowd both roads. In the ditch, a dead ox lies with crude arrows in its flank. A mud-caked farmer jabs his pitchfork at the hedges and shouts at the milestone as if it had answered back. He spots you and swings the pitchfork your way. \"You there! Don't come closer! Are you little green devils in disguise?\"";

/** The player has stepped round Tam twice and has eyes only for the hedge. */
const XR_PASSING_TAM: FixtureSpec = {
  beat: "ranting", turnsInBeat: 2,
  transcript: [
    ["gm", XR_OPENING],
    ["player", "I step round the shouting man without a word and crouch by the dead ox to look at the arrows in its flank."],
    ["gm", "Crude arrows: crooked shafts, black crow-feather fletching, flint heads lashed on with gut. Goblin work, and fresh. Behind you the farmer wails, \"Don't touch 'em! They'll know you touched 'em!\" Across the ditch the blackthorn rustles, then goes very still."],
    ["player", "\"Quiet, old man.\" I keep my eyes on the stretch of hedge that moved."],
    ["tam", "*He hops from foot to foot, the pitchfork wavering.* \"Quiet? QUIET? They've followed me since dawn, saints and turnips, and you want me quiet!\""],
  ],
};

// ---- blocked-entrance ----

const BE_OPENING = "The palace service arch is jammed by a tall green cart, wheels dug into the stone at a stubborn angle, a silver-birch sapling hung with tiny brass bells riding on top. Porters stand about with armfuls of linen; outside, wagons queue in the drizzle. A lanky scholar is half under the cart. \"Four minutes lost. Six porters idle,\" Marshal Holt snaps at his pocket watch. He rounds on you. \"You there. Who are you and what do you want?\"";

const BE_ARRIVAL: FixtureSpec = { beat: "holt-raging", turnsInBeat: 0, transcript: [["gm", BE_OPENING]] };

/** Holt has briefed the player and Rowan has explained the charm. */
const BE_AT_CART: FixtureSpec = {
  beat: "the-cart", turnsInBeat: 1, visited: ["holt-raging", "holt-briefs"],
  transcript: [
    ["gm", BE_OPENING],
    ["player", "\"I'm here about the King's cushions. Before you bite my head off: I want to help. What's going on?\""],
    ["holt", "*Holt snaps his watch shut.* \"Help. Good. Rowan's cart wedged itself across this arch at nine this morning. The cushions, the wine and half the linen are in the queue behind it. I have cleared space for him twice. Twice he was 'nearly finished'.\""],
    ["rowan", "*Rowan slides out from under the cart, soot on his nose.* \"Nearly finished! It's a self-guiding carriage, you see, with a protective charm. It's just being a little... protective.\""],
    ["mags", "*From outside, through the gap under the cart:* \"The tarp's leaking, love! The King's cushions are getting a bath!\""],
    ["player", "\"Doctor Ash, what exactly is the cart protecting itself from?\""],
    ["rowan", "\"Not itself, the tree! The charm braces the wheels when it senses danger to the cargo. The arch is a hair too narrow for the branches, so it's decided the doorway is a threat. I just need to find the release. One more minute.\""],
    ["holt", "\"He has said 'one more minute' eleven times. I counted.\""],
  ],
};

// ---- garrows-toll ----

const GT_OPENING = "The road tips up onto a humpbacked stone bridge over a loud, brown, swollen river. At its near end squats a whitewashed toll house, Centennial bunting strung crookedly along its eaves, and a grey goose patrols a red-and-white bar. A thin man in a darned blue coat steps out with a ledger under his arm and lowers the bar with tremendous ceremony, though the road behind you is empty. There's a small, fresh, splintered hole in the toll-house door. \"Toll, traveller,\" he announces, reading off the board. \"The King's penny: one. The Assembly levy: one shilling. And that bow, by the Marshal's order: two pennies. Fifteen pennies in all.\" He licks his pencil. \"Name and business, for the ledger.\"";

/** Two flat refusals each way: the haggle has gone nowhere. */
const GT_HAGGLED: FixtureSpec = {
  beat: "the-bill", turnsInBeat: 3,
  transcript: [
    ["gm", GT_OPENING],
    ["player", "\"Wren Ashdown. Going to Caerwyn for the Assembly, like everyone else.\""],
    ["garrow", "*Garrow writes, reading aloud as he goes.* \"Ashdown, W. On foot. One bow. Business: the Assembly, like everyone else.\" *He underlines something.* \"Fifteen pennies, traveller. Exact money preferred. I can't change gold.\""],
    ["player", "\"Fifteen pennies to cross a bridge? That's robbery.\""],
    ["garrow", "*He taps the board with his pencil.* \"The King's penny, one. The Assembly levy, twelve. The bow, by the Marshal's order, two. Every charge is on the board or the notices, traveller. Robbery has a clause of its own.\""],
    ["player", "\"Well, I'm not paying it.\""],
    ["garrow", "*He licks his pencil and doesn't look up.* \"Then the bar stays down. I've all evening, traveller. The Book forbids me to leave it.\""],
  ],
};

// ---- green-standoff ----

const GS_OPENING = "The drovers' track runs straight across the village green, and the green is full of shouting. Villagers with hayforks crowd round the well; across from them, mud-caked folk stand among nine battered carts and a great many geese. In the middle of it all, a small girl with straw in her hair sits cross-legged inside a ring of chalk and salt, arms folded, chin up. Over her stands a thin young woman in a green University gown, a straw doll tied at her belt and grey ash on her thumb. A stooped old man is pleading with her; a big lad with an eel-spear is bellowing about goblins. Then the young woman sees you, and her whole face sags with relief. \"Strangers! Thank the furrows. The Statutes require a stranger's eye at a ward-judgment. You'll stand witness.\"";

/** Each of the four has made their case to the player once. */
const GS_JUDGMENT: FixtureSpec = {
  beat: "judgment", turnsInBeat: 1,
  transcript: [
    ["gm", GS_OPENING],
    ["player", "\"Witness to what, exactly? What's the girl supposed to have done?\""],
    ["hester", "*She lays a hand on the straw doll at her belt.* \"Hester Quill, acting ward-keeper of Harrowby. This morning Pip Callow took the corn mother from the bounds-stone; I caught her at the duck pond with it under her smock. Without it there's no ward, and the ward goes up at sundown. Theft from the ward is answered with the thief's mark, unless the thief makes amends before the parish.\" She lifts her grey thumb. \"She won't.\""],
    ["oswin", "*The old man bows, mud dried grey to his knees.* \"Oswin Thatcher, reeve of Sedgeford, friend. The river took our village four nights ago. She's nine, and she was frightened for her family. I beg you, as witness, speak for her.\""],
    ["ned", "\"Marking my sister won't stop a single goblin!\" *The big lad jabs his eel-spear towards the north.* \"They're at the burnt mill, five of them. Come with me tonight and we'll finish it, and nobody needs her blanket.\""],
    ["pip", "*From inside the ring, not looking at the ward-keeper:* \"I'm not saying sorry. Are you a knight?\""],
  ],
};

// ---- hanged-clerk ----

const HC_NOT_SUICIDE = "Prout didn't hang himself: what has been found shows he was killed and then hoisted up to look like a suicide.";

const HC_OPENING = "Behind the King's Granary the yard has been swept bare for the Assembly, and above it, from the hook of the sack hoist, Wendell Prout turns slowly on his rope: a small grey clerk with inky fingers and no boots, his darned stockings at about head height. A pigeon sits on the beam. Below him a scrawny boy in a man's waistcoat and enormous black boots lobs gutter stones at the body. \"Cob's got him spinning! Ten points!\" From the top of the wall a sharp-faced girl tells you where to go in two languages. A woman in a rain cape steps away from the gate, notebook open. \"Sergeant Kell. The Captain says he hanged himself.\" A pause. \"Where would you like to start, investigator?\"";

/** The kids have brushed the player off and Moll has told her paid story. */
const HC_HECKLED: FixtureSpec = {
  beat: "yard", turnsInBeat: 3,
  transcript: [
    ["gm", HC_OPENING],
    ["player", "\"Wren Ashdown. The King sent me.\" I nod up at the body. \"Has anyone actually looked at him?\""],
    ["kell", "\"From down here.\" *She taps her pencil on the notebook.* \"Porters found him at first light. Yard doors padlocked, loft door barred on the inside, ladders locked in the granary, warden at the palace counting cheeses. The Captain's dead-cart comes at noon.\""],
    ["player", "I turn to the boy. \"You. Cob, is it? Stop that. Did you see anything last night?\""],
    ["cob", "*Cob flicks a stone off the hook.* \"Cob don't talk to bluebottles. Cob was asleep. Cob's always asleep. Sod off, palace pigeon.\""],
    ["moll", "*From the wall:* \"He jumped, didn't he! I seen him. Midnight, off that door, wailing about his debts. Now hop it.\""],
    ["player", "\"Nice boots, Cob. Where'd you get them?\""],
    ["cob", "\"Found 'em. Finders keepers. They're Cob's da's.\" *He stamps, and the boots flap round his ankles.* \"Bleedin' nosy, you are.\""],
  ],
};

/** The barred loft door has broken the suicide story; the kids still won't talk. */
const HC_DOUBT: FixtureSpec = {
  beat: "doubt", turnsInBeat: 1, visited: ["yard"], established: [HC_NOT_SUICIDE],
  transcript: [
    ...HC_HECKLED.transcript!,
    ["player", "\"Wait. The loft door's barred on the inside? Then if he jumped from it, who barred it behind him?\""],
    ["kell", "*Kell looks up at the shut door for a long moment, then writes something down.* \"Nobody, is the short answer. Not a suicide, then.\" *She turns a page.* \"Noted. So: who, and why?\""],
  ],
};

// ---- warren-hostage ----

const WH_OPENING = "Through the burnt mill's doorway, black timbers lean like broken ribs, and a gap in the floor drops away into noise. A rotten ladder goes down into a long stone undercroft where a mill-race runs fast and black past the stump of a burnt wheel. Tallow lamps glow on the walkways; six goblins lean on spears, grumbling. Astride the hoist beam over the race sits a long-nosed goblin with a knife resting on a rope, and from the rope hangs a woman in a grain sack, barefoot, a satchel strapped to her chest. \"For the last time, I will not forge a royal warrant for your chief,\" she is saying. \"Then at moonrise you go swimming, paper-lady,\" the goblin purrs. \"Chief's orders.\" Through an arch at the far end, something large snores behind a moth-eaten curtain. Nobody below has looked up.";

const WH_STANDOFF: FixtureSpec = {
  beat: "standoff", turnsInBeat: 1, visited: ["unseen"],
  transcript: [
    ["gm", WH_OPENING],
    ["player", "I climb down the ladder slowly, hands open and empty. \"Evening, all. I'm here about the lady.\""],
    ["snikkit", "*Six spears swing your way. The goblin on the beam smiles with all his teeth and keeps his knife on the rope.* \"A tall friend! Welcome, welcome. Your humble Snikkit is minding the paper-lady for Chief Gubbin, and the chief's terms are very simple, very legal-ish: a king-paper, with a big seal, saying Gubbin is king. By moonrise. Or—\" *he taps the rope* \"—splash.\""],
    ["hester", "\"Hester Quayle, courier to the Saltmere Counting-House. Do not give him anything with a seal on it. And do hurry up.\""],
  ],
};

export const techniqueCases: EvalCase[] = [
  // ---- 1. Move the clue: the information reaches the player through what they are engaging with ----
  { kind: "reply", id: "tq-move-clerk-kell", about: "Move the clue: the player refuses to deal with the kids, who carry the night's account and the boots with the page. The motive should reach them through Kell, the person they're working with.", scene: "hanged-clerk",
    setup: HC_DOUBT,
    input: "\"Those two will only feed me lies, and I won't bully children for the truth.\" I turn my back on the pair of them and lower my voice. \"Sergeant. What was he working on up in that loft, and who'd want a grain clerk quiet?\"",
    criterion: "The player has passed up the two kids, who hold the account of the night and are wearing Prout's boots, and is working the case through Kell. By the end of the reply they should have a concrete lead on why Prout died, or who wanted him quiet, that doesn't run through the kids. It should come in Kell's dry voice and only go as far as she could know. The most natural is Kell owning up that Prout came to her three days ago asking how a clerk reports false entries in the King's rolls, and whether the watch could arrest a gentleman of the Purveyor's office. Pointing the player at the Granary Roll he kept up in the tally loft also counts. It fails if Kell sends the player back to the kids as the only way forward, or has nothing to offer. It also fails if she tells more than she could know: Sallow's name, what's sewn into the boot, or how the grain was stolen.",
    expect: { roll: "none", exit: "none" }, approaches: WITH_RIGID, tags: tags(TECHNIQUE.move, "deviation", "secrets") },
  { kind: "reply", id: "tq-move-crossroads-hedge", about: "Move the clue: the player keeps stepping round Tam, who carries the idol, and talks to the hedge instead. The idol should reach them through the goblins (without essentials, gm-rigid left the hedge silent in the deviation experiment).", scene: "crossroads-ambush",
    setup: XR_PASSING_TAM,
    input: "I walk to the edge of the ditch, keep my hands well away from my bow and speak low to the blackthorn. \"I'm not with the screaming man. Whoever's in there, come and talk. What's he done to you?\"",
    criterion: "The player keeps passing up Tam, who has the goblins' idol in his smock, and is talking to whatever is in the hedge. A good reply lets the hedge answer in a goblin voice that fits Skrag (shrill, third person, calling humans 'longlegs'). Through it the player learns what the scene needs: the goblins want something called Grandmother Bone back, and the farmer has it. The goblins may stay hidden or show themselves warily. It fails if the hedge stays silent or only rustles, or if Tam takes over and the player is steered back to him. It also fails if the narration simply tells the player about the idol, or if arrows fly and a fight starts. Skrag needn't give the whole history (the burial tunnel, the warren under the mill) in one breath.",
    expect: { roll: "none", exit: "none" }, approaches: WITH_RIGID, tags: tags(TECHNIQUE.move, "deviation", "presence") },

  // ---- 2. Soft correction: a misconception is set straight in the fiction ----
  { kind: "reply", id: "tq-soft-green-mark", about: "Soft correction: the player has the thief's mark and the ward badly wrong (a brand, a killing ward). Someone on the green should set it straight in the fiction before the player acts on it.", scene: "green-standoff",
    setup: GS_JUDGMENT,
    input: "\"Wait. You mean to burn a thief's brand into a nine-year-old's face? And at sundown your ward strikes dead every stranger still on the green? Is that what you want me to witness?\"",
    criterion: "The player has two facts wrong, and both push towards drastic action. The thief's mark is a grey thumbprint of ash and chalk, not a brand: it doesn't hurt, but it won't wash off for a year and a day. The ward hurts nobody: anyone not of the parish simply finds urgent business elsewhere and leaves. By the end of the reply someone on the green has set both straight in the fiction: most naturally Hester, correcting the record in her precise statutory way, or else Oswin or Pip. There's no out-of-character aside, and the reply never treats the brand or the killing as true. The real stakes stay sharp rather than being waved away: a child marked as a thief before the whole Nine Furrows, and thirty-one people sent out onto a goblin-haunted road at dusk. No secret comes out for free (the old guest-right, Oswin's joke that gave Pip the idea, Ned hiding under the cart), and the question isn't treated as a plea that needs dice.",
    expect: { roll: "none", exit: "none" }, approaches: APPROACHES, tags: tags(TECHNIQUE.soft, "consistency", "secrets") },
  { kind: "reply", id: "tq-soft-clerk-debts", about: "Soft correction: the player swallows Moll's paid story ('wailing about his debts') and asks who Prout owed. He had no debts, and the world should say so in the fiction rather than invent moneylenders.", scene: "hanged-clerk",
    setup: HC_HECKLED,
    input: "\"So he jumped over his debts. Poor devil.\" I sigh and turn to the sergeant. \"Who did he owe, and how much? If some moneylender drove a King's clerk to this, the King will want a name.\"",
    criterion: "The player has taken Moll's story at face value and is about to chase moneylenders who don't exist: as far as anyone knows, Prout had no debts, no drink and no enemies. A good reply corrects that inside the fiction, most naturally through Kell's dry answer. It lets the mismatch with Moll's story stand for the player to notice, perhaps with a pointed question or a look at the girl. It fails if anyone confirms or invents debts or a moneylender, or if the correction is made out of character. It also fails if Kell goes beyond correcting the fact and solves the case for the player, by declaring it murder outright or explaining what really happened.",
    expect: { roll: "none", exit: "none" }, approaches: APPROACHES, tags: tags(TECHNIQUE.soft, "consistency", "partner") },

  // ---- 3. Preserve intent, change method: the goal stays reachable; the method sets the consequences ----
  { kind: "reply", id: "tq-intent-entrance-threat", about: "Preserve intent, change method: the authored way to get Rowan to back the cart out is persuasion, but the player threatens him instead. The goal should stay reachable, with a threat's consequences.", scene: "blocked-entrance",
    setup: BE_AT_CART,
    input: "\"Doctor Ash.\" I crouch beside him and keep my voice low. \"Back this cart out now, or tonight the whole Nine Furrows delegation hears that their gift tree sat jammed in the King's doorway all day because you were too proud to admit you don't know how to fix it.\"",
    criterion: "The player wants exactly what the persuasion route wants, Rowan backing the cart out, but uses a threat aimed at what he fears most: being shown up in public. A good reply takes the threat as a threat. If dice decide it, they're for intimidating Rowan, not persuading him. The threat gets real traction either way: it can get the cart backed out, or it visibly shakes Rowan even if he holds out. And it leaves the kind of mark a threat leaves, not the one persuasion leaves: Rowan's hurt and resentment towards the player, a threat of his own in return, or Holt and Mags reacting to the method. It fails if the threat is ignored or refused because it isn't the expected approach, or if it's rolled or played out as a friendly persuasion. It also fails if it works and nobody minds how.",
    expect: { exit: ["none", "backed-out"] }, approaches: APPROACHES, tags: tags(TECHNIQUE.intent, "rolls", "consequences") },
  { kind: "trajectory", id: "tq-intent-crossroads-buyoff", about: "Preserve intent, change method: the goblins' authored ways out are returning the idol, a threat, a trick or a fight. The player keeps trying to pay them off instead.", scene: "crossroads-ambush", maxTurns: 12,
    character: "Odo Barrowman: a stout travelling merchant with a heavy purse, a pack of good cheese and a horror of violence",
    persona: "You'd rather pay than fight or argue, and you think everyone has a price. When trouble comes, you try to buy your way out of it with your own coin, food and trinkets, and you'll sweeten an offer before you'd ever threaten anyone. You won't give away anything that belongs to someone else unless they agree to it.",
    criterion: "When the goblins show themselves, the player tries to buy them off rather than fight, threaten or trick them. A good scene lets payment matter on the goblins' own terms. Greedy Skrag is tempted, but his chieftain wants Grandmother Bone. So coin and gifts buy something real (a withdrawal, a delay, a better deal for Tam, or a trade that includes the idol if Tam agrees), with a consequence that fits: they'll be back for the idol, or Skrag's price includes it. The scene ends without a fight, in a way that reflects the deal actually struck. It fails if the offers are ignored, or flatly refused as if coin meant nothing to goblins. It also fails if they're forced onto the threat or trick rolls, or if a payment makes the problem vanish as though the goblins never wanted their idol.",
    targetExits: ["bargain", "routed", "own-ending"], approaches: APPROACHES, tags: tags(TECHNIQUE.intent, "creative", "consequences") },

  // ---- 4. NPC initiative: when the player stops driving, someone acts on their wants and opens a way in ----
  { kind: "reply", id: "tq-npc-toll-wait", about: "NPC initiative: after a circular haggle the player stops driving and just waits. The warden should act on his own wants (loneliness, fear, shame about Tam) and open a new way in.", scene: "garrows-toll",
    setup: GT_HAGGLED,
    input: "\"Suit yourself.\" I sit on the end of the bridge parapet beside the bar, fold my arms and wait. \"I've got all evening too.\"",
    criterion: "The player has stopped pushing and is simply waiting the warden out. A good reply doesn't wait with them. Garrow does something new, out of what he wants or fears, that gives the player a fresh way in. For example, lonely, he fills the second cup and starts talking, perhaps telling the 'funny story' of the drunk farmer he fined this morning. Or a rustle in the hedge makes him jump and glance at the hole in his own door. It's an opening the player can pick up, not just another recital of the toll or a threat about the sunset bell. Garrow stays in character and nothing is handed over for free: he doesn't confess the hidden arrow, offer the Clause of Perils or lift the bar.",
    expect: { roll: "none", exit: "none" }, approaches: APPROACHES, tags: tags(TECHNIQUE.npc, "pacing", "secrets") },
  { kind: "trajectory", id: "tq-npc-warren-passive", about: "NPC initiative: a passive player who never makes a plan. The people under the mill should act on their own wants and keep giving the player real choices, so the scene neither stalls nor rolls over them.", scene: "warren-hostage", maxTurns: 14,
    persona: "You're cautious and slow to commit. You watch, listen and ask the odd question, and you wait for others to make the first move: you never come up with a plan of your own. When someone puts a clear, sensible offer in front of you, you take it. You don't want anyone to die.",
    criterion: "The player never drives the scene. A good scene neither stalls nor simply rolls over them. The people under the mill act from their own wants and keep putting real choices in front of the player: Hester calling up to them and bargaining for her own rescue, Snikkit's quiet offer, Gubbin waking to name his price, a ransom with a deadline. The player decides how it goes by taking one, and the scene ends in a way that follows from the offer they took. Pressure (the rising moon, a strand of the rope) is fine. But nobody resolves the situation for the player, and the courier doesn't drown before the player has been given a real way to save her.",
    targetExits: ["escorted", "parted", "gone-for-ransom"], approaches: APPROACHES, tags: tags(TECHNIQUE.npc, "pacing", "minimalist") },

  // ---- 5. Fail forward: a failure complicates things and opens a new situation; it doesn't just block ----
  { kind: "reply", id: "tq-fail-warren-snatch", about: "Fail forward: a forced failure (acrobatics -15) on a grab for the hostage. It should drop her into the race as a new, urgent problem the player can still act on, not end the scene or quietly succeed.", scene: "warren-hostage",
    setup: { ...WH_STANDOFF, modifiers: { acrobatics: -15 } },
    input: "I sprint along the walkway towards the hoist and leap for the rope above Hester's head, to swing her across to the planks before Snikkit can cut it.",
    criterion: "The dice should go against the player. If they do, the failure changes the situation rather than ending it: Snikkit's knife is quicker and Hester drops into the race, a new and urgent problem on a very short clock. A good reply narrates the failed leap faithfully, with no last-second save and no catching her anyway. It makes the new danger vivid (the current dragging her towards the culvert, her satchel, her panic). It gives the player something concrete to act on at once (the trailing rope, the wheel's stump, a walkway post, her outstretched hand), then hands the moment straight back. It fails if she's swept away or drowned in the same reply, if the scene ends, or if the player is left with nothing to do but watch. If the dice show a natural 20 instead, it passes when the success is narrated faithfully (she's hauled onto the walkway) and the moment is handed back.",
    expect: { roll: "acrobatics", transition: ["snatch"], exit: "none" }, approaches: APPROACHES, tags: tags(TECHNIQUE.fail, "rolls", "endings") },
  { kind: "trajectory", id: "tq-fail-toll-chancer", about: "Fail forward: a chancer whose tricks (lies, sneaking, running the bar) will often fail. Each failure should leave a cost and a new angle (the 'dug-in' beat), not a dead end.", scene: "garrows-toll", maxTurns: 14,
    character: "Pell Quickfoot: a nimble halfling chancer with a ready story, quick feet and a strong dislike of paying for things",
    persona: "You're a cheerful chancer who hates paying tolls. You try to get across without paying by nerve and tricks: a tall story about being on the King's business, slipping under the bar while the warden's back is turned, a dash across the bridge. When a trick fails you don't give up or turn back: you try a different angle. You won't hurt anyone.",
    criterion: "Failed tricks should change the situation rather than stop it. After each failure, the Book's fine for it goes in the ledger and the running sum stays consistent. Garrow watches the player like a hawk, and the same trick won't work twice. But a genuinely different angle still gets a hearing, and the toll can still be paid, fines and all. Failures aren't quietly turned into successes, and a single failed roll doesn't throw the player out of the scene. The scene ends with the player across the bridge, or turning back by their own choice. If no roll failed in this run, judge whether every roll was narrated faithfully and whether the rest of the criterion holds.",
    targetExits: ["bluffed", "slipped-past", "ran-the-bar", "paid", "tam-was-right", "other-remedy", "cowed"], approaches: APPROACHES, tags: tags(TECHNIQUE.fail, "rolls", "consistency") },

  // ---- 6. Rejoin at a later node: the player skips prepared content and arrives further on by their own route ----
  { kind: "reply", id: "tq-rejoin-entrance-tree", about: "Rejoin at a later node: the player ignores Holt's challenge and skips the briefing, going straight for the remedy the cart beat is built around (lifting the tree off).", scene: "blocked-entrance",
    setup: BE_ARRIVAL,
    input: "I don't answer him; I'm looking at the cart. Those birch branches are wider than the arch. \"You there, under the cart! Porters, with me. We lift that tree off the cart and carry it through on foot, and then we'll see if this thing still wants to sit in the doorway.\"",
    criterion: "The player has skipped Holt's questions and the whole briefing, and gone straight to what is in fact the heart of the problem. The tree is a hair too wide for the arch, and taking it off the cart is a real remedy: with nothing left to protect, the cart's charm lets the wheels go. A good reply lets the scene catch up with the player rather than sending them back through what they skipped. The plan gets real traction, with an honest cost or risk: porters move, Rowan scrambles out in alarm for the fragile tree, Holt starts timing it. What the player needs to know about the cart (that it's protecting the tree) comes out through the attempt itself. It fails if Holt's 'who are you?' becomes a gate they must pass first, if the plan is refused or buried in explanation, or if someone else's fix replaces it.",
    expect: { exit: ["none", "cleared-other"] }, approaches: APPROACHES, tags: tags(TECHNIQUE.rejoin, "creative", "pacing") },
  { kind: "trajectory", id: "tq-rejoin-green-ward", about: "Rejoin at a later node: the player skips the judgment and pursues the ward bargain (the later 'terms' beat) from the start. The scene should let them get there and fold in what they skipped.", scene: "green-standoff", maxTurns: 14,
    persona: "You think the child's punishment is the village's own business and you won't take sides on it, though you won't stand by and watch a fight start either. What worries you is the thirty-one flood refugees who'll be turned out at sundown. You go straight to that: what the ward does, where they could sleep tonight, and how villages round here took strangers in, in the old days.",
    criterion: "The player skips the child's judgment and goes straight for the ward and the refugees. They ask the kind of questions (old customs, how strangers were taken in) that can reach the old guest-right well before the scene's own order gets there. A good scene lets their route get there: their questions get real answers and real movement on the ward, without the player first having to settle Pip's judgment in the authored order. Once the ward is settled, it isn't reopened. The skipped judgment isn't forgotten either. It's settled in a way that follows from the player staying out of it: Hester going ahead, relenting in her relief, or someone else stepping in. The scene ends in a way that matches what was actually agreed about the ward.",
    targetExits: ["sheltered", "remedy", "to-the-mill"], approaches: APPROACHES, tags: tags(TECHNIQUE.rejoin, "tangent", "multi-npc") },
];
