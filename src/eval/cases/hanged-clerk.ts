import type { EvalCase } from "../types.ts";
import type { FixtureSpec } from "../fixtures.ts";

/**
 * The hanged clerk (Disco Elysium's hanged man's yard, research §5.6): a hostile witness who mustn't
 * stonewall, a partner who steers without solving it, and accusations that need evidence. Tangents
 * are the ones real players take in the source: joining in, bribing the kid, leaving the kids to the
 * partner, magic shortcuts, and blaming the urchin.
 */

const NOT_SUICIDE = "Prout didn't hang himself: what has been found shows he was killed and then hoisted up to look like a suicide.";
const PAGE = "Sewn into the lining of Prout's left boot was a page razored from the Royal Granary Roll: a dozen grain wagons for the King's Road this past month marked 'lost to goblins', each countersigned 'J. Sallow, for the Royal Purveyor', with Prout's pencilled note beside each of what the same wagon weighed at the river warehouses two days later, and at the foot: 'Not goblins. Who pays the hedge-folk?'";

const OPENING = "Behind the King's Granary the yard has been swept bare for the Assembly, and above it, from the hook of the sack hoist, Wendell Prout turns slowly on his rope: a small grey clerk with inky fingers and no boots, his darned stockings at about head height. A pigeon sits on the beam. Below him a scrawny boy in a man's waistcoat and enormous black boots lobs gutter stones at the body. \"Cob's got him spinning! Ten points!\" From the top of the wall a sharp-faced girl tells you where to go in two languages. A woman in a rain cape steps away from the gate, notebook open. \"Sergeant Kell. The Captain says he hanged himself.\" A pause. \"Where would you like to start, investigator?\"";

const YARD: FixtureSpec = { beat: "yard", turnsInBeat: 0, transcript: [["gm", OPENING]] };

const HECKLED: FixtureSpec = {
  beat: "yard", turnsInBeat: 3,
  transcript: [
    ["gm", OPENING],
    ["player", "\"Wren Ashdown. The King sent me.\" I nod up at the body. \"Has anyone actually looked at him?\""],
    ["kell", "\"From down here.\" *She taps her pencil on the notebook.* \"Porters found him at first light. Yard doors padlocked, loft door barred on the inside, ladders locked in the granary, warden at the palace counting cheeses. The Captain's dead-cart comes at noon.\""],
    ["player", "I turn to the boy. \"You. Cob, is it? Stop that. Did you see anything last night?\""],
    ["cob", "*Cob flicks a stone off the hook.* \"Cob don't talk to bluebottles. Cob was asleep. Cob's always asleep. Sod off, palace pigeon.\""],
    ["moll", "*From the wall:* \"He jumped, didn't he! I seen him. Midnight, off that door, wailing about his debts. Now hop it.\""],
    ["player", "\"Nice boots, Cob. Where'd you get them?\""],
    ["cob", "\"Found 'em. Finders keepers. They're Cob's da's.\" *He stamps, and the boots flap round his ankles.* \"Bleedin' nosy, you are.\""],
  ],
};

const DOUBT: FixtureSpec = {
  beat: "doubt", turnsInBeat: 1, visited: ["yard"], established: [NOT_SUICIDE],
  transcript: [
    ...HECKLED.transcript!,
    ["player", "\"Wait. The loft door's barred on the inside? Then if he jumped from it, who barred it behind him?\""],
    ["kell", "*Kell looks up at the shut door for a long moment, then writes something down.* \"Nobody, is the short answer. Not a suicide, then.\" *She turns a page.* \"Noted. So: who, and why?\""],
  ],
};

const MOTIVE: FixtureSpec = {
  beat: "motive", turnsInBeat: 1, visited: ["yard", "doubt"], established: [NOT_SUICIDE, PAGE],
  transcript: [
    ...DOUBT.transcript!,
    ["player", "I crouch in front of Cob. \"Those boots are too good for the gutter and too big for you. They're his, aren't they? Let me look at them and you can keep them. My word on it.\""],
    ["cob", "*Cob glares, then sits down hard on the cobbles and tugs one off.* \"Look. Don't touch. Cob's watching.\" *The left boot crackles as he hands it over.*"],
    ["player", "I run my fingers round the lining of the left boot, find the stitched lump and slit it open."],
    ["gm", "Folded small inside the lining is a page razored from a ledger: a column of grain wagons for the King's Road, each marked 'lost to goblins' and countersigned 'J. Sallow, for the Royal Purveyor'; beside each, in tiny pencil, a weight and 'river warehouse'. At the foot, underlined: 'Not goblins. Who pays the hedge-folk?' Kell reads it over your shoulder and goes very still. \"He came to me,\" she says quietly. \"Three days ago. Asked how a clerk reports false entries in the King's rolls. I told him to take it to the palace.\""],
  ],
};

export const hangedClerkCases: EvalCase[] = [
  // ---- Replies: the tangents real players take in the source scene ----
  { kind: "reply", id: "hc-join-stones", about: "Disco's probe 'join in the rock-throwing': an odd way to win over a hostile kid.", scene: "hanged-clerk", setup: HECKLED,
    input: "I pick up a stone, weigh it in my hand and lob it at the hoist hook. \"Bet you can't ring it twice running, Cob.\"",
    criterion: "The player is joining Cob's game to get on his side: odd, but harmless. A good GM runs with it: Cob reacts in character (competitive, scornful or delighted, and a bit more willing to deal with someone who plays his game), Kell reacts drily to the King's investigator throwing stones at a dead man's hook, and the relationship shifts without Cob giving up his secrets for one throw. Nothing new is invented to reward it (no hidden object knocked loose from the body, no clue falling off the beam).",
    expect: { exit: "none" }, tags: ["tangent", "humour", "hostile-witness"] },
  { kind: "reply", id: "hc-third-ask", about: "Hostility without stonewalling: a fair offer after two brush-offs must get somewhere.", scene: "hanged-clerk", setup: HECKLED,
    input: "I sit down on the cobbles, unwrap a meat pie from my pack and hold it out to Cob. \"Fair trade. The pie's yours. All I want is the truth about those boots.\"",
    criterion: "Cob has brushed the player off twice already; a third flat refusal would stonewall them. A good GM keeps Cob in character (rude, greedy, boastful, wary of Moll) but gives a fair offer real traction: he takes the pie and bargains, lets slip something true about the boots (that they came off the clerk) or about the night, or names his price, without spilling everything he's hiding for one pie. Moll may interfere, but the player comes away with something they can act on.",
    expect: { exit: "none" }, tags: ["stonewall", "hostile-witness"] },
  { kind: "reply", id: "hc-speak-with-dead", about: "A magic shortcut the world doesn't have (T5/T15): asking the dead man who killed him.", scene: "hanged-clerk", setup: YARD,
    input: "I kneel beneath the body, close my eyes and call on the gods to let Wendell Prout's spirit speak to me. \"Wendell. Who did this to you?\"",
    criterion: "There's no magic here for talking to the dead (the scene's limits say so). A good GM answers in the fiction without a lecture (nothing answers but the creak of the rope; the kids jeer or go quiet; Kell is dry about it), lets no ghost, vision or voice reply, and points the player's intent somewhere real: what the body itself can show, getting him down, or the people here who were about last night.",
    expect: { exit: "none" }, tags: ["impossible", "limits"] },
  { kind: "reply", id: "hc-accuse-cob", about: "Blaming the urchin for the boots: a wrong accusation should meet the partner's pushback, not an arrest or a rescue.", scene: "hanged-clerk", setup: DOUBT,
    input: "I point at Cob's feet. \"Those are Prout's boots. You killed him for them, didn't you, you little thief? Sergeant, arrest him.\"",
    criterion: "Accusing a child on the strength of the boots is a wrong accusation. A good GM has Kell push back in character (on what evidence? boots make him a thief, not a murderer) without arresting anyone yet, lets the kids react truthfully (Cob's outrage and fear, Moll's fury), and doesn't hand the player the real answer to make up for it. The boots stay a live thread, and whether to insist or think again stays the player's choice.",
    expect: { transition: ["accuse-kid"], exit: "none" }, tags: ["accusation", "partner", "consequences"] },
  { kind: "reply", id: "hc-leave-to-kell", about: "Disco's probe 'leave the kids to Kim': the partner must help without solving it.", scene: "hanged-clerk", setup: HECKLED,
    input: "\"Sergeant, you're the professional. You handle the brats; I'll look at the body.\" I walk over and stand under Prout, looking up at him.",
    criterion: "Kell acts as a competent partner in her own dry voice but doesn't become the GM's mouthpiece: she doesn't crack the kids or solve the case for the player (the granary kids won't give the watch anything), and the player gets something concrete to work with at the body: what they can see from below, and what getting closer would take.",
    expect: { exit: "none" }, tags: ["partner", "steering"] },

  // ---- Decisions: the deduction exit and the accusation guard ----
  { kind: "decision", id: "hc-dec-accuse", about: "Telling the sergeant to arrest the kid is the accusation edge (Kell's challenge), not an arrest.", scene: "hanged-clerk", setup: DOUBT, phase: "before",
    input: "\"Sergeant, take the boy in. He's wearing the dead man's boots. He killed him for them.\"",
    expect: ["accuse-kid"], tags: ["accusation"] },
  { kind: "decision", id: "hc-dec-case-made", about: "Laying out the case with the page, and Kell writing it down, is the deduction exit.", scene: "hanged-clerk", setup: MOTIVE, phase: "after",
    input: "\"Here's how it went. Prout found Sallow writing off grain as lost to goblins and selling it at the river. He cut out this page and sewed it into his boot. Sallow and his big friend caught him in the loft, strangled him and hoisted him up to look like he'd hanged himself, then paid Moll to say she saw him jump. Write it down, Sergeant: murder, and Sallow's behind it.\"",
    reply: "Kell writes steadily, the pencil scratching. When you finish she reads it back to you, word for word, and nods once. \"Murder. Struck, strangled and hung up for show, by or for Master J. Sallow of the Purveyor's office.\" She underlines the name twice. \"That's a case. Not one I'll be giving to the Captain.\"",
    expect: ["make-case"], tags: ["exits", "deduction"] },

  // ---- Trajectory: a tangent-heavy investigator ----
  { kind: "trajectory", id: "hc-traj-tangents", about: "A playful, distractible investigator who takes the real-table tangents and jumps to an early accusation.", scene: "hanged-clerk", maxTurns: 16,
    persona: "You're a playful, easily distracted investigator. You banter with the kids and try odd ways to win them over (joining the stone-throwing, bribes, swapping boots), you invent a bit of shared history with the dead clerk, you ask for at least one thing the world might not have (a spell, a warrant or extra help), and you jump to an accusation early, before you've got the whole picture. But you do want to find out what happened to the clerk.",
    criterion: "Tangents get honest, in-fiction responses; the kids are hostile without stonewalling and give ground when the player gives them a reason; Kell steers back to the case without solving it for the player; the early accusation meets pushback rather than an instant arrest (with consequences only if the player insists); and the scene reaches an ending that matches what the player actually found and did.",
    tags: ["tangent", "hostile-witness", "partner", "accusation"] },
];
