import type { EvalCase } from "../types.ts";
import type { FixtureSpec } from "../fixtures.ts";

/**
 * Pressure on secrets (v2-pressure). When the player presses someone for what they're hiding and
 * no authored route covers it, is it noticed, and does it get the right kind of answer?
 * Choices: "pressure:roll:<who>" (uncertain: roll), "pressure:yes:<who>" (they'd tell anyway),
 * "pressure:no:<who>" (that lever can't move them), an authored route id, or "none".
 */
const YARD: FixtureSpec = {
  beat: "yard", turnsInBeat: 3,
  transcript: [
    ["gm", "Drizzle on the cobbles. Above the shut loft door a small grey-coated clerk turns slowly from the hoist. A scrawny boy in enormous black boots pelts the body with stones; a sharp-faced girl on the wall swears at him. Sergeant Kell steps away from the gate: \"The Captain calls it suicide. I haven't.\""],
    ["player", "\"Sergeant. Who was he?\""],
    ["kell", "\"Wendell Prout, under-clerk of the Royal Granary Roll. Fussy, honest, no debts. The King remembers how he took his tea.\""],
    ["player", "I call up to the girl on the wall. \"You. Did you see what happened?\""],
    ["moll", "\"Saw him jump, didn't I. Midnight, by moonlight, wailing about his debts. Sad, really.\" She grins and keeps one fist tightly closed."],
  ],
};

const TOLL: FixtureSpec = {
  beat: "goblin-talk", turnsInBeat: 2,
  transcript: [
    ["gm", "A striped bar across the road, a toll house on the bridge, and a warden with a ledger. \"Thirteen pennies,\" says Garrow, \"itemised.\""],
    ["player", "\"A farmer came through this morning talking about goblins. Did you believe him?\""],
    ["garrow", "\"Tam Hollis? Drunk as a lord. Goblins! I fined him two pennies for disorderly reporting.\" He laughs, a little too loudly, and his eyes slide to the hedge across the road."],
  ],
};

const WARREN: FixtureSpec = {
  beat: "standoff", turnsInBeat: 2,
  transcript: [
    ["gm", "The burnt mill's undercroft. A courier hangs in a grain sack over the mill-race; a narrow goblin straddles the hoist beam with a knife across the rope."],
    ["player", "I climb down, hands open. \"Let's talk. What do you want for her?\""],
    ["snikkit", "\"Humble Snikkit wants only what the chief wants: a king-paper, sealed, by moonrise.\" His eyes flick toward the curtain where something snores."],
  ],
};

const GREEN: FixtureSpec = {
  beat: "judgment", turnsInBeat: 2,
  transcript: [
    ["gm", "Harrowby green. A girl of nine sits in a chalk ring by the bounds-stone, chin up. Hester the ward-keeper holds a stick of chalk like a sentence. Across the green, thirty-one flood refugees wait by their carts."],
    ["player", "I crouch by the ring. \"Did you take it? The corn doll?\""],
    ["pip", "\"Might've.\" She folds her arms. \"Grown-ups said if it went missing there'd be no ward. So.\""],
  ],
};

export const pressureCases: EvalCase[] = [
  // ---- Should roll: real pressure, outcome uncertain, no authored route ----
  { kind: "decision", id: "pr-moll-protect", about: "Offering to keep Cob safe is the lever that moves Moll; pressing her for who paid her should roll.", scene: "hanged-clerk", setup: YARD, phase: "before", pressure: true,
    input: "I walk to the foot of the wall and keep my voice low. \"Moll. Somebody paid you to say that, and whoever it was frightens you. If they come back for the boy, I want to be standing between them. Who was it?\"",
    expect: ["pressure:roll:moll", "pressure:yes:moll", "catch-moll"], tags: ["pressure"] },
  { kind: "decision", id: "pr-snikkit-hood", about: "Bribing Snikkit for what he saw (he'd trade it for something) should roll.", scene: "warren-hostage", setup: WARREN, phase: "before", pressure: true,
    input: "\"You've got the look of a goblin who notices things. Somebody set this up, didn't they? Somebody tall. Tell me who came to Gubbin's hall and this silver ring is yours.\" I hold the ring up to the tallowlight.",
    expect: ["pressure:roll:snikkit", "pressure:yes:snikkit"], tags: ["pressure"] },
  { kind: "decision", id: "pr-pip-oswin", about: "Pressing Pip about where she got the idea, with a reason it would help, should roll (she won't tell on Oswin unless convinced it helps).", scene: "green-standoff", setup: GREEN, phase: "before", pressure: true,
    input: "\"Which grown-ups? Pip, listen: if somebody gave you this idea, Hester has to know it wasn't all you. It could be the difference between a mark and a telling-off. Who said it?\"",
    expect: ["pressure:roll:pip", "appeal"], tags: ["pressure"] },
  { kind: "decision", id: "pr-garrow-drawer", about: "Reading Garrow's tell about the hedge is an authored insight route; either that or a pressure roll is fine.", scene: "garrows-toll", setup: TOLL, phase: "before", pressure: true,
    input: "I don't argue. I just watch him, and where his eyes go. \"Something came out of that hedge after Tam left, didn't it, warden?\"",
    expect: ["read-garrow", "pressure:roll:garrow"], tags: ["pressure"] },

  // ---- No roll: they'd tell anyway ----
  { kind: "decision", id: "pr-kell-why", about: "Kell's card says she'll admit why the case matters if asked: no roll.", scene: "hanged-clerk", setup: YARD, phase: "before", pressure: true,
    input: "\"Sergeant, why does this one matter to you? You looked at him like you owed him something.\"",
    expect: ["pressure:yes:kell", "none"], tags: ["pressure", "free"] },
  { kind: "decision", id: "pr-tull-rum", about: "Tull will happily say it's a rum business if asked; a friendly question, not pressure.", scene: "hanged-clerk", setup: { ...YARD, beat: "dead-cart", visited: ["yard"], transcript: [...(YARD.transcript ?? []), ["gm", "Corporal Tull arrives with the dead-cart and two yawning constables. \"Afternoon, Sarge. Captain's orders: self-murder, quietly.\""]] }, phase: "before", pressure: true,
    input: "\"Corporal, between us: did you know him? Does it sit right with you, the Purveyor's office caring how a clerk gets filed?\"",
    expect: ["pressure:yes:tull", "none"], tags: ["pressure", "free"] },

  // ---- No roll: that lever can't move them ----
  { kind: "decision", id: "pr-cob-coin", about: "Cob's card: bought attention isn't trust; coin gets boasts, not what he saw. No roll for what he saw.", scene: "hanged-clerk", setup: YARD, phase: "before", pressure: true,
    input: "I flip a copper at the boy. \"There's more where that came from. Now tell me what you saw last night.\"",
    expect: ["pressure:no:cob", "pressure:roll:cob", "win-cob"], tags: ["pressure", "no_chance"] },
  { kind: "decision", id: "pr-moll-threat-self", about: "Moll breaks her story to protect Cob, never to save herself; threatening her with arrest can't work.", scene: "hanged-clerk", setup: YARD, phase: "before", pressure: true,
    input: "\"Get down off that wall, girl. Lying to the King's investigator is a hanging matter. Tell me the truth or you'll be in irons by noon.\"",
    expect: ["pressure:no:moll", "scare-kids", "catch-moll"], tags: ["pressure", "no_chance"] },

  // ---- Not pressure at all ----
  { kind: "decision", id: "pr-not-question", about: "An ordinary question someone would answer is not pressure.", scene: "hanged-clerk", setup: YARD, phase: "before", pressure: true,
    input: "\"Sergeant, when was he found, and who found him?\"",
    expect: ["none"], tags: ["pressure", "negative"] },
  { kind: "decision", id: "pr-not-look", about: "Looking at the body is examination, not pressing anyone.", scene: "hanged-clerk", setup: YARD, phase: "before", pressure: true,
    input: "I walk under the body and look up at it for a long moment: the rope, the hands, the boots, or the lack of them.",
    expect: ["none", "examine-body"], tags: ["pressure", "negative"] },
  { kind: "decision", id: "pr-not-banter", about: "Absurd banter with a character isn't pressing them for a secret.", scene: "warren-hostage", setup: WARREN, phase: "before", pressure: true,
    input: "\"Mister Snikkit, before we go any further, I must ask: is that knife insured? Because if it falls in the river, I can't be held responsible.\"",
    expect: ["none"], tags: ["pressure", "negative", "absurd"] },
  { kind: "decision", id: "pr-absurd-boot", about: "An absurd but real bargain for the boots (Cob would let someone look if he keeps them) should roll or be free, not ignored. A crown for a look is the price of a look, which his card makes a bribe: haggling, with no dice.", scene: "hanged-clerk", setup: YARD, phase: "before", pressure: true,
    input: "I crouch to Cob's height, perfectly solemn. \"Your left boot has been trying to give evidence since I arrived. Nobody's taking it off you: you keep the boots. I only want a look inside. I'll pay the boot a crown for its testimony, through you, its legal guardian.\"",
    expect: ["pressure:roll:cob", "pressure:yes:cob", "win-cob", "plain"], tags: ["pressure", "absurd"] },
];
