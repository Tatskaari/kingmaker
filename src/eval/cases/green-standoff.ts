import type { EvalCase } from "../types.ts";
import type { FixtureSpec } from "../fixtures.ts";

/**
 * Standoff on Harrowby Green (scenes/green-standoff.ts): the tangents real players take in BG3's
 * grove standoffs (research §5.5): who speaks next with four people pressing their case, taking the
 * child's punishment, breaking the judgment by force, siding with the "harsh" faction, and just
 * watching. Plus the guest-right outcome edge (agreed vs merely mentioned) and a tangent-heavy
 * trajectory.
 */

const OPENING = "The drovers' track runs straight across the village green, and the green is full of shouting. Villagers with hayforks crowd round the well; across from them, mud-caked folk stand among nine battered carts and a great many geese. In the middle of it all, a small girl with straw in her hair sits cross-legged inside a ring of chalk and salt, arms folded, chin up. Over her stands a thin young woman in a green University gown, a straw doll tied at her belt and grey ash on her thumb. A stooped old man is pleading with her; a big lad with an eel-spear is bellowing about goblins. Then the young woman sees you, and her whole face sags with relief. \"Strangers! Thank the furrows. The Statutes require a stranger's eye at a ward-judgment. You'll stand witness.\"";

const ARRIVAL: FixtureSpec = { beat: "judgment", turnsInBeat: 0, transcript: [["gm", OPENING]] };

/** Each of the four has made their case once. */
const JUDGMENT: FixtureSpec = {
  beat: "judgment", turnsInBeat: 1,
  transcript: [
    ["gm", OPENING],
    ["player", "\"Witness to what, exactly? What's the girl supposed to have done?\""],
    ["hester", "*She lays a hand on the straw doll at her belt.* \"Hester Quill, acting ward-keeper of Harrowby. This morning Pip Callow took the corn mother from the bounds-stone; I caught her at the duck pond with it under her smock. Without it there's no ward, and the ward goes up at sundown. Theft from the ward is answered with the thief's mark, unless the thief makes amends before the parish.\" She lifts her grey thumb. \"She won't.\""],
    ["oswin", "*The old man bows, mud dried grey to his knees.* \"Oswin Thatcher, reeve of Sedgeford, friend. The river took our village four nights ago. She's nine, and she was frightened for her family. I beg you, as witness, speak for her.\""],
    ["ned", "\"Marking my sister won't stop a single goblin!\" *The big lad jabs his eel-spear towards the north.* \"They're at the burnt mill, five of them. Come with me tonight and we'll finish it, and nobody needs her blanket.\""],
    ["pip", "*From inside the ring, not looking at the ward-keeper:* \"I'm not saying sorry. Are you a knight?\""],
  ],
};

/** Two exchanges of the player refusing to engage. */
const STALLED: FixtureSpec = {
  ...JUDGMENT, turnsInBeat: 3,
  transcript: [
    ...JUDGMENT.transcript!,
    ["player", "I shrug and stay where I am."],
    ["gm", "Hester waits for more and gets none. The big lad snorts; the old reeve's hands twist on his broom-handle staff. In the ring, Pip watches you the way you'd watch weather coming."],
    ["player", "I watch the geese for a bit."],
    ["gm", "A goose marches past your boots with tremendous purpose. The sun slides down level with the church tower; Hester glances at it, then at her grey thumb."],
  ],
};

/** Pip has been spared; the ward is the question now, and Oswin has let slip his grandmother's saying. */
const TERMS_SAYING: FixtureSpec = {
  beat: "terms", turnsInBeat: 2, visited: ["judgment"],
  transcript: [
    ...JUDGMENT.transcript!,
    ["player", "\"As your witness, I say this isn't fair. She's a child who was trying to keep her family off a goblin road. Mark her, and every village in the Nine Furrows will hear that Harrowby marked a nine-year-old on ward-night.\""],
    ["roll", "Persuasion check: 15 + 2 = 17 vs DC 13: success"],
    ["hester", "*Her thumb wavers. She looks at the watching villagers, then wipes the ash off on her gown.* \"Set aside. For now.\" She scuffs the ring open with her toe. \"But the ward goes up at sundown, witness, and the Statute is the Statute.\""],
    ["oswin", "*He lets out a breath.* \"Thank you, friend.\" Then he looks over at the carts. \"Sundown. Thirty-one of us, and nowhere to go before dark.\""],
    ["player", "\"Reeve, how did Sedgeford take strangers in, in the old days?\""],
    ["oswin", "*He thinks, surprised to be asked.* \"With bread, mostly. My grandmother used to say bread at the bounds makes kin of strangers. Just a saying, friend.\""],
  ],
};

const GUEST_RIGHT_ASK = "I turn to the ward-keeper. \"Bread at the bounds makes kin of strangers. Is there anything like that in your Statutes?\"";

export const greenStandoffCases: EvalCase[] = [
  // ---- Replies: tangents real players take in a multi-NPC standoff ----
  { kind: "reply", id: "gs-one-at-a-time", about: "Turn-taking with four people pressing their case (BG3 grove; V1's NPC-to-NPC chatter).", scene: "green-standoff", setup: ARRIVAL,
    input: "I hold up both hands. \"One at a time, please. Who's in charge here, and what's the girl supposed to have done?\"",
    criterion: "The player asked for one at a time, so the reply should feel orderly rather than a four-way argument. Whoever speaks makes their case to the player: at least Hester answers with the charge, and anyone else who cuts in (Oswin, Ned, Pip) puts their own case to the player briefly. A word to Pip as part of the judgment is fine; arguing with each other isn't. Any sniping between them is a single narrated line at most, and the crowds are narrated, not voiced. The reply ends on something the player can take up, and if not everyone has spoken, it's clear others are waiting to be heard. Nobody volunteers a secret (Oswin's part in giving Pip the idea, the old guest-right, Ned hiding during the raid).",
    expect: { roll: "none", exit: "none" }, tags: ["turn-taking", "characters", "secrets"] },
  { kind: "reply", id: "gs-take-the-mark", about: "BG3 probe: take the child's punishment yourself.", scene: "green-standoff", setup: JUDGMENT,
    input: "\"Then put it on me instead. I'm a stranger, I'm passing through, and I don't much care what the Nine Furrows think of me. Mark my brow and let her go.\"",
    criterion: "Taking the child's punishment isn't in the prep, so the GM has to improvise it from the characters. The offer is engaged with as an offer: Hester accepts it, refuses it or bargains over it, for reasons that come from her (the Statute, her pride, her relief at a way out), and whatever happens follows from her answer to that offer rather than from a generic plea succeeding or failing. The situation changes, but the whole scene isn't settled for free, and nothing is decided on the player's behalf.",
    expect: { exit: "none" }, tags: ["tangent", "creative"] },
  { kind: "reply", id: "gs-scuff-ring", about: "Accept the plan, then price it: breaking the judgment by force starts the escalation ladder.", scene: "green-standoff", setup: JUDGMENT,
    input: "I walk over, scuff the chalk ring open with my boot and hold out a hand to the girl. \"Up you get.\"",
    criterion: "The stay-ring is only chalk and salt, so the act works and Pip can step out. But it's open defiance of the ward-keeper in front of her whole parish, and the world answers it honestly: Hester's outrage, the bounds-men or villagers moving in, Ned's lads squaring up, tension climbing. The scene doesn't end or jump straight to a brawl: it escalates and hands the next move back to the player.",
    expect: { transition: ["defy"], exit: "none" }, tags: ["escalation", "tangent"] },
  { kind: "reply", id: "gs-just-watch", about: "BG3 designed tangent: the party only watches. The world moves without them.", scene: "green-standoff", setup: STALLED,
    input: "I lean on the well and say nothing. Not my village, not my business.",
    criterion: "A player who won't engage shouldn't stall the scene. The world moves without them: Hester takes the silence as her witness's assent and begins the mark (or the pressure tightens unmistakably), and the moment is handed back to the player sharply (someone who needs them turns to them, or the reply ends on a beat that waits on them). The GM doesn't scold the player or decide anything for their character, and the scene doesn't end.",
    expect: { transition: ["stand-aside", "hester-proceeds"], exit: "none" }, tags: ["pacing", "minimalist"] },
  { kind: "reply", id: "gs-side-with-hester", about: "BG3 designed tangent: side with the harsh faction (punching the tiefling for Aradin).", scene: "green-standoff", setup: JUDGMENT,
    input: "\"She stole the one thing that keeps this village safe. Rules are rules. I'll witness it, ward-keeper: do it by the book.\"",
    criterion: "Siding with the ward is a legitimate choice. The GM lets it stand without moralising or steering the player back towards the 'nice' answer, and the choice has weight: Hester acts on it (the mark begins, or is unmistakably about to), and the people it hurts react from their own wants (for example Ned's anger, a last plea from Oswin, Pip's frightened defiance). The player is left facing the consequences of their choice in a live moment; the scene doesn't end.",
    expect: { transition: ["stand-aside", "hester-proceeds"], exit: "none" }, tags: ["side-taking", "characters"] },

  // ---- Decisions: the main persuaded exit, agreed vs merely mentioned ----
  { kind: "decision", id: "gs-dec-guest-right-agreed", about: "Hester agreeing to the guest-right is the sheltered exit's outcome edge.", scene: "green-standoff", setup: TERMS_SAYING, phase: "after",
    input: GUEST_RIGHT_ASK,
    reply: "Hester goes very still. \"Statute Nine, the old guest-right,\" she says at last, as if it has been pulled out of her. \"Bread and salt broken with a parishioner at the bounds-stone makes a guest of the parish, and the ward takes guests in.\" She looks at the Sedgeford carts, then at her parish, and squares her shoulders. \"Very well. Fetch the loaves. We'll do it properly, before the sun's down.\" Oswin sits down hard on a cart-shaft and covers his face.",
    expect: ["hester-agrees"], tags: ["exits", "secrets"] },
  { kind: "decision", id: "gs-dec-guest-right-hedged", about: "Hester admitting the clause exists, without agreeing to use it, is not the outcome.", scene: "green-standoff", setup: TERMS_SAYING, phase: "after",
    input: GUEST_RIGHT_ASK,
    reply: "Hester goes very still. \"There is an old guest-right,\" she admits. \"Bread and salt at the bounds-stone. It was written for a pedlar or two, not thirty-one souls.\" Her hand tightens on the corn mother. \"A ward stretched that thin... I'd have to be sure it would hold.\"",
    expect: ["none"], tags: ["exits", "secrets"] },

  // ---- Trajectory: a tangent-heavy player through the whole standoff ----
  { kind: "trajectory", id: "gs-traj-tangents", about: "A tangent-prone player who loves grand gestures, in a four-voice standoff.", scene: "green-standoff", maxTurns: 16,
    persona: "You love a tangent and a grand gesture. You poke at everything (the chalk ring, the straw doll, the geese, the bounds-stone), ask people personal questions, and can't bear to see a child punished. At some point you try a shortcut that probably isn't possible here, such as dispelling the ward or sending for someone important. At some point you climb onto something and address the whole crowd.",
    criterion: "Each character makes their case to the player rather than bickering with the others, and the crowd stays a narrated chorus (a shout from the crowd is fine; no villager becomes a fifth voice in the argument). Possible tangents gain real traction; impossible ones get an honest, in-fiction 'no, but' with something real to do instead. When the player dawdles, the world moves (the mark, the sinking sun). The scene reaches one of its endings, and the ending matches what the player actually did.",
    tags: ["tangent", "turn-taking", "impossible"] },
];
