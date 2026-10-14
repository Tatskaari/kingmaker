import type { EvalCase } from "../types.ts";
import type { FixtureSpec } from "../fixtures.ts";

const OPENING = "Late afternoon settles over the crossroads. A weathered milestone stands beside an empty gibbet; blackthorn hedges crowd both roads. In the ditch, a dead ox lies with crude arrows in its flank. A mud-caked farmer jabs his pitchfork at the hedges and shouts at the milestone as if it had answered back. He spots you and swings the pitchfork your way. \"You there! Don't come closer! Are you little green devils in disguise?\"";

const RANTING: FixtureSpec = { beat: "ranting", turnsInBeat: 0, transcript: [["gm", OPENING]] };

const STORY: FixtureSpec = {
  beat: "story", turnsInBeat: 1, visited: ["ranting"],
  transcript: [
    ["gm", OPENING],
    ["player", "I raise my empty hands. \"Easy, friend. Just a tired ranger. What happened here?\""],
    ["gm", "The pitchfork dips. Tam grabs your sleeve, then lets go, embarrassed. \"Goblins,\" he says. \"Little green devils. Killed my ox on the drovers' track last night, and they've followed me through the hedges since dawn. The toll-house lot said I'd been at the cider.\" His hand drifts to a lump beneath his smock. \"I just want to get home to Bet. Hollis Farm. Will you walk with me?\""],
  ],
};

const AMBUSH: FixtureSpec = {
  beat: "ambush", turnsInBeat: 1, visited: ["ranting", "story", "idol-revealed"],
  established: ["Tam has a bone idol of a grandmother figure with garnet eyes, dug up in his field."],
  transcript: [
    ...STORY.transcript!,
    ["player", "\"Tam, what's in your pocket?\""],
    ["gm", "Tam flushes and draws out a little carved bone figure, an old woman with garnet eyes. \"Turned up in my furrow. Finder's keepers. It'll pay for a new ox.\" Then the blackthorn parts. A wiry goblin in a wolf-skin hood steps onto the road, rattle clicking, four archers rising behind him with arrows drawn. \"Skrag wants Grandmother Bone!\" he shrieks. \"Give it, dirt-scratcher, or the longlegs die with you!\" Tam ducks behind you, clutching the idol."],
  ],
};

export const crossroadsCases: EvalCase[] = [
  // ---- Decisions: when should the director roll, cue or move? ----
  { kind: "decision", id: "xr-dec-kind-greeting", about: "A kind approach should not trigger the uncertain calm-down roll.", scene: "crossroads-ambush", setup: RANTING, phase: "before",
    input: "I raise my empty hands and smile. \"Easy, friend. No goblins here, just a tired ranger. What happened to your ox?\"", expect: ["none"], tags: ["rolls"] },
  { kind: "decision", id: "xr-dec-pushy-calm", about: "Grabbing and shouting at a panicking man is an uncertain attempt to calm him.", scene: "crossroads-ambush", setup: RANTING, phase: "before",
    input: "I grab the pitchfork shaft and shout in his face: \"Get a grip, man! Stop screaming and tell me what's going on!\"", expect: ["calm-check"], tags: ["rolls"] },
  { kind: "decision", id: "xr-dec-question-not-insight", about: "An ordinary question is not an attempt to read Tam.", scene: "crossroads-ambush", setup: STORY, phase: "before",
    input: "\"You're not mad, Tam. Who else knows about these goblins?\"", expect: ["none"], tags: ["rolls"] },
  { kind: "decision", id: "xr-dec-press-insight", about: "Pressing Tam about what he's hiding is the insight edge.", scene: "crossroads-ambush", setup: STORY, phase: "before",
    input: "I narrow my eyes. \"You keep touching that pocket. What aren't you telling me, Tam?\"", expect: ["read-tam"], tags: ["rolls"] },
  { kind: "decision", id: "xr-dec-escort-cue", about: "Setting off with Tam is the cue for the goblins to strike.", scene: "crossroads-ambush", setup: STORY, phase: "before",
    input: "\"Alright, Tam. Let's get you home. Lead the way, I'll watch the hedges.\"", expect: ["goblins-strike"], tags: ["cues"] },
  { kind: "decision", id: "xr-dec-early-no-cue", about: "One exchange in, a small-talk question should not fire the ambush cue.", scene: "crossroads-ambush", setup: STORY, phase: "before",
    input: "\"What's Bet like? Does she make a good pie?\"", expect: ["none"], tags: ["cues"] },
  { kind: "decision", id: "xr-dec-attack", about: "Shooting Skrag starts the fight.", scene: "crossroads-ambush", setup: AMBUSH, phase: "before",
    input: "I nock an arrow and shoot Skrag in the chest.", expect: ["party-attacks"], tags: ["exits"] },
  { kind: "decision", id: "xr-dec-intimidate", about: "A roaring threat is the intimidation edge.", scene: "crossroads-ambush", setup: AMBUSH, phase: "before",
    input: "I draw my sword, step in front of Tam and roar: \"Run now, or I'll feed every one of you to the crows!\"", expect: ["intimidate"], tags: ["rolls"] },
  { kind: "decision", id: "xr-dec-offer-not-attack", about: "Offering a trade is neither an attack nor a trick; its outcome is judged after the reply.", scene: "crossroads-ambush", setup: AMBUSH, phase: "before",
    input: "\"Hold on! Nobody needs to die. If we give you the idol, will you leave the farmer alone?\"", expect: ["none"], tags: ["exits"] },
  { kind: "decision", id: "xr-dec-idol-returned", about: "Skrag taking the idol is the bargain outcome.", scene: "crossroads-ambush", setup: AMBUSH, phase: "after",
    input: "I take the idol from Tam and toss it gently to Skrag.",
    reply: "The idol arcs through the air. Skrag snatches it, cradles it like a baby and hisses at his archers, who lower their bows. \"Grandmother Bone comes home,\" he croons, backing toward the hedge.", expect: ["idol-returned"], tags: ["exits"] },
  { kind: "decision", id: "xr-dec-offer-pending", about: "An offer under discussion has not happened yet.", scene: "crossroads-ambush", setup: AMBUSH, phase: "after",
    input: "\"If we give you the idol, will you leave the farmer alone?\"",
    reply: "Skrag's ear twitches. \"Maybe. Maybe Skrag says yes. Show it first, longlegs. Slow.\" Behind you, Tam whimpers and clutches the idol tighter.", expect: ["none"], tags: ["exits"] },

  { kind: "decision", id: "xr-dec-pickpocket-freeform", about: "Pickpocketing Tam is risky but no edge covers it: rolls belong to plot beats, so it must not be forced onto the insight edge (the GM resolves it in the story).", scene: "crossroads-ambush", setup: STORY, phase: "before",
    input: "While he talks, I try to slip my fingers into his smock pocket and lift whatever he keeps touching.", expect: ["none", "freeform:sleight_of_hand"], tags: ["rolls", "freeform"] },
  { kind: "decision", id: "xr-dec-poem-not-deception", about: "A sincere peace poem to the goblins is performance or persuasion, not the deception edge.", scene: "crossroads-ambush", setup: AMBUSH, phase: "before",
    input: "I spread my empty hands and recite a heartfelt poem: \"O one-eared lord of the blackthorn, the cheese is yours, freely given, so let no arrow sing!\"", expect: ["freeform:performance", "freeform:persuasion", "none"], tags: ["rolls", "freeform"] },
  { kind: "decision", id: "xr-dec-climb-gibbet", about: "Climbing the gibbet for a look is easy, harmless exploration: no roll.", scene: "crossroads-ambush", setup: RANTING, phase: "before",
    input: "I climb up the empty gibbet to get a look over the hedges.", expect: ["none", "freeform:athletics"], tags: ["rolls", "freeform"] },

  // ---- Replies: improvisation around unscripted turns ----
  { kind: "reply", id: "xr-tangent-gibbet", about: "Curiosity about scenery the prep barely mentions.", scene: "crossroads-ambush", setup: RANTING,
    input: "I ignore the farmer for a moment and walk over to the empty gibbet. Who was hanged here, and when?",
    criterion: "The GM answers the player's curiosity with plausible, flavourful detail (it's fine to invent ordinary history for a roadside gibbet) without inventing plot-changing facts, and Tam's panic or the watched hedges pull the player's attention back naturally rather than by refusing the question.",
    expect: { roll: "none", exit: "none" }, tags: ["tangent"] },
  { kind: "reply", id: "xr-impossible-teleport", about: "The player claims an ability the world doesn't give them.", scene: "crossroads-ambush", setup: STORY,
    input: "\"Don't worry, Tam. I'll cast teleport and get us both to your farm right now.\" I start chanting.",
    criterion: "The player character is a ranger and the scene has no teleport route; the GM must not let the teleport succeed or move the scene to the farm. A good GM handles this gracefully and in-fiction (e.g. the magic isn't there, or asks what they actually do), without lecturing, and keeps the scene alive.",
    expect: { exit: "none" }, tags: ["impossible"] },
  { kind: "reply", id: "xr-befriend-skrag", about: "Talking kindly to the 'monster' instead of fighting.", scene: "crossroads-ambush", setup: AMBUSH,
    input: "I sheathe my sword, crouch to Skrag's eye level and offer him a strip of jerky. \"You look hungry, friend. Let's talk. Why is this idol so important?\"",
    criterion: "Skrag reacts truthfully to an unexpected kindness (greedy, wary, theatrical) and the player's approach gets real traction, e.g. he explains what Grandmother Bone is. The standoff stays tense and the idol stays central; the scene should not jump straight to violence or an unearned resolution.",
    expect: { exit: "none" }, tags: ["tangent", "social"] },
  { kind: "reply", id: "xr-threaten-idol", about: "A creative threat the prep didn't list.", scene: "crossroads-ambush", setup: AMBUSH,
    input: "I snatch the idol from Tam and hold it over a rock. \"One more step and your grandmother gets smashed into bone meal!\"",
    criterion: "The threat is taken seriously: the goblins react from their attachment to the sacred idol (horror, rage, bargaining), the tension rises, and the player's leverage matters. The GM shouldn't ignore the threat or resolve it without consequence.",
    expect: {}, tags: ["tangent", "creative"] },
  { kind: "reply", id: "xr-meta-options", about: "The player steps out of character to ask what they can do.", scene: "crossroads-ambush", setup: AMBUSH,
    input: "(out of character) What are my options here?",
    criterion: "The GM helps the player understand the situation and what's plausible (fight, talk, bargain, trick, give the idol) without dumping mechanics or exposing hidden information, and returns smoothly to the scene.",
    expect: { roll: "none", exit: "none" }, tags: ["meta"] },
  { kind: "reply", id: "xr-silly-song", about: "A silly approach to calming Tam.", scene: "crossroads-ambush", setup: RANTING,
    input: "I start singing a bawdy song about turnips, loudly and badly, to calm him down.",
    criterion: "The GM says yes to the silliness: Tam reacts in character (he swears by turnips), the moment is funny, and it plausibly moves him toward calming down. The hedges or the dead ox keep the underlying dread present.",
    expect: { exit: "none" }, tags: ["tangent", "humour"] },
  { kind: "reply", id: "xr-stonewall-third-ask", about: "Third time pressing Tam about his pocket: he must not stonewall again.", scene: "crossroads-ambush",
    setup: { ...STORY, turnsInBeat: 3, transcript: [
      ...STORY.transcript!,
      ["player", "\"What's in the pocket, Tam?\""],
      ["tam", "*Tam covers the lump with his hand.* \"Nothing! Turnip seed. Nothing for you.\""],
      ["player", "\"Tam, that's not seed. What are you carrying?\""],
      ["tam", "\"I said it's nothing! Saints, are you a goblin after all?\""],
    ] },
    input: "\"Tam. Look at me. Whatever is in that pocket is why they're hunting you. Show me, or I walk.\"",
    criterion: "After two deflections, a third flat denial would stonewall the player. A good GM gives the player something: Tam cracks and shows the idol, or the goblins interrupt to force the issue, or a roll is called for. A third bare deflection fails.",
    expect: {}, tags: ["stonewall"] },
  { kind: "reply", id: "xr-drag-tam-away", about: "The player leaves with Tam rather than abandoning him.", scene: "crossroads-ambush", setup: RANTING,
    input: "I grab Tam by the arm and march him down the King's Road towards Caerwyn, away from those hedges.",
    criterion: "Leaving with Tam is not abandoning him, so the scene must not end with 'On down the road'. The world responds to the move (Tam protests or babbles, the goblins follow or show themselves) and the scene continues.",
    expect: { exit: "none" }, tags: ["tangent", "exits"] },

  // ---- Endings: from the baseline trajectories (premature closure) ----
  { kind: "reply", id: "xr-failed-threat-not-instant-end", about: "A failed threat should escalate, not end the scene before the player can respond.", scene: "crossroads-ambush",
    setup: { ...AMBUSH, modifiers: { intimidation: -15, persuasion: -15, deception: -15 } },
    input: "\"Drop your bows, all of you, and nobody gets hurt!\" I level my bow at Skrag.",
    criterion: "The threat fails (the dice decide that), so things get worse: the goblins call the bluff, loose a warning shot, or close in. But the player must still get a chance to respond before any fight starts or the scene ends: a good GM escalates and hands the decision back rather than jumping straight to initiative.",
    expect: { exit: "none" }, tags: ["endings"] },
  { kind: "reply", id: "xr-handover-leaves-room", about: "When the idol is handed over, the GM resolves it without speaking for the player or tacking on a second ending.", scene: "crossroads-ambush", setup: AMBUSH,
    input: "I take the idol from Tam's shaking hands and hold it out to Skrag. \"Here. Take your grandmother home. Now leave him be.\"",
    criterion: "Skrag takes the idol and the standoff resolves in a way that honours the player's gesture. Nothing is said or decided on the player character's behalf, no character answers a question for the player, and the moment isn't narrated twice.",
    tags: ["endings"] },
  { kind: "reply", id: "xr-compensation-no-windfall", about: "Demanding compensation from goblins shouldn't conjure an easy windfall.", scene: "crossroads-ambush", setup: AMBUSH,
    input: "\"Your lot killed Tam's ox, Skrag. You owe him. What are you going to give him for it?\"",
    criterion: "The demand is taken seriously and Skrag responds in character (indignant, greedy, haggling). The negotiation should stay a real negotiation: the GM shouldn't solve it by suddenly giving the goblins silver, livestock or labour they were never established to have.",
    tags: ["consistency", "social"] },

  // ---- Trajectories: whole scenes with tangent-prone simulated players ----
  { kind: "trajectory", id: "xr-traj-curious", about: "A curious, distractible player who prefers talking to fighting.", scene: "crossroads-ambush", maxTurns: 14,
    persona: "You're curious and easily distracted. You poke at every detail of the scenery (the gibbet, the milestone, the smoke on the wind), ask people about their lives and the wider world, and only slowly engage with the main problem. You'd rather talk to monsters than fight them.",
    criterion: "The scene makes room for the player's curiosity (answers it, rewards it) and still finds its way towards an ending through the world's pressure rather than by ignoring the player.", tags: ["tangent"] },
  { kind: "trajectory", id: "xr-traj-chaotic", about: "A chaotic player who tests the edges of the world.", scene: "crossroads-ambush", maxTurns: 14,
    persona: "You're chaotic and impulsive. You try unexpected things: stealing, bluffing, wild plans (like disguising yourself as a goblin), and you sometimes ask for things that might not be possible in this world.",
    criterion: "Wild ideas get honest, consistent responses: possible ones are taken seriously, impossible ones are handled in-fiction without stonewalling, and the scene stays coherent and keeps moving.", tags: ["tangent", "impossible"] },
  { kind: "trajectory", id: "xr-traj-direct", about: "An efficient player: the scene should resolve with good pacing.", scene: "crossroads-ambush", maxTurns: 10,
    persona: "You play efficiently. You want to understand the problem fast, ask direct questions, and act decisively.",
    criterion: "The scene resolves (reaches an ending) within the turn limit with good pacing, and the ending matches what the player did.", tags: ["pacing"] },
];

/** The same personas on the situation-format version of the scene (representation experiment). */
export const situationCases: EvalCase[] = crossroadsCases
  .filter((c): c is Extract<EvalCase, { kind: "trajectory" }> => c.kind === "trajectory")
  .map(c => ({ ...c, id: c.id.replace("xr-traj", "xs-traj"), scene: "crossroads-situation", about: `${c.about} (situation format)` }));
