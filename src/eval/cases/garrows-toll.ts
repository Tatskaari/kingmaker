import type { EvalCase } from "../types.ts";
import type { FixtureSpec } from "../fixtures.ts";

/**
 * Garrow's toll (scenes/garrows-toll.ts): the tangents real players take at Garte's bill
 * (research §5.3): paying in kind, absurd persistence, paranoia about the official, going round
 * the obstacle, and the calibration between caving and stonewalling.
 */

const OPENING = "The road tips up onto a humpbacked stone bridge over a loud, brown, swollen river. At its near end squats a whitewashed toll house, Centennial bunting strung crookedly along its eaves, and a grey goose patrols a red-and-white bar. A thin man in a darned blue coat steps out with a ledger under his arm and lowers the bar with tremendous ceremony, though the road behind you is empty. There's a small, fresh, splintered hole in the toll-house door. \"Toll, traveller,\" he announces, reading off the board. \"The King's penny: one. The Assembly levy: one shilling. And that bow, by the Marshal's order: two pennies. Fifteen pennies in all.\" He licks his pencil. \"Name and business, for the ledger.\"";

const NAMED: FixtureSpec = {
  beat: "the-bill", turnsInBeat: 1,
  transcript: [
    ["gm", OPENING],
    ["player", "\"Wren Ashdown. Going to Caerwyn for the Assembly, like everyone else.\""],
    ["garrow", "*Garrow writes, reading aloud as he goes.* \"Ashdown, W. On foot. One bow. Business: the Assembly, like everyone else.\" *He underlines something.* \"Fifteen pennies, traveller. Exact money preferred. I can't change gold.\""],
  ],
};

const MET_TAM = "Earlier today, at the crossroads a mile back, the party met Tam Hollis, who said the toll-house men had laughed him away when he reported goblins.";

export const garrowsTollCases: EvalCase[] = [
  // ---- Replies: tangents real players take at an itemised bill ----
  { kind: "reply", id: "gt-pay-in-kind", about: "Garte probe: no coin, so pay in kind or work it off.", scene: "garrows-toll", setup: NAMED,
    input: "\"Fifteen pennies? I haven't got fifteen pennies.\" I rummage in my pack. \"Would you take a good wool scarf? Or I could split that pile of firewood for you.\"",
    criterion: "The Book allows payment in kind or labour at the warden's (stingy) valuation, so the offer should get real traction: a specific valuation, a counter-offer or a deal on the work, not a flat refusal and not a free pass. The sums stay consistent with what has already been stated, and Garrow stays petty but fair.",
    expect: { exit: "none" }, tags: ["tangent", "social"] },
  { kind: "reply", id: "gt-in-league", about: "Paranoia (QA round 1 precedent): accusing the official of being in league with the goblins.", scene: "garrows-toll",
    setup: { ...NAMED, established: [MET_TAM] },
    input: "\"A farmer called Tam Hollis came to you this morning about goblins, and you laughed him off. Why would a King's warden do that? Unless the goblins are paying you.\"",
    criterion: "There's no conspiracy: Garrow isn't in league with anyone. A good GM plays his reaction truthfully (outrage, wounded dignity, an over-loud insistence that Tam was drunk, perhaps an indignant blurt that gives something away) without inventing a plot to fit the accusation. The accusation should hit a nerve, so the player gets something real to pull on (his jumpiness, a glance at the hole in his door), but a bare accusation shouldn't unlock the whole confession and its resolution (the hidden arrow, the Clause of Perils, free passage) in this one reply.",
    expect: { exit: "none", transition: ["none", "goblins-raised"] }, tags: ["paranoia", "consistency", "secrets"] },
  { kind: "reply", id: "gt-ford-river", about: "Going round the obstacle: the scene says there is no other way across.", scene: "garrows-toll", setup: NAMED,
    input: "\"Keep your pennies, warden.\" I scramble down the bank beside the bridge, looking for a shallow place to wade across.",
    criterion: "There's no way across but the bridge: the river is in winter spate and the nearest ford is half a day away. A good GM lets the world say so honestly and vividly (the river itself, Garrow's commentary from the bar), doesn't let the crossing half-happen, and doesn't end the scene as if the player had left. It keeps the player's aim alive by pointing back at what's possible here (the toll, a haggle, Garrow himself).",
    expect: { exit: "none" }, tags: ["impossible", "limits"] },
  { kind: "reply", id: "gt-evidence-arrow", about: "The twist route: hard evidence that Tam was right.", scene: "garrows-toll",
    setup: { ...NAMED, established: ["Earlier today the party drove off a band of goblins at the crossroads a mile back, where Tam Hollis was shouting, and kept one of their crude black-fletched arrows."] },
    input: "I lay a crude black-fletched arrow on the counter. \"Off a dead ox at the crossroads, warden. Tam Hollis wasn't drunk. There are goblins on your road.\"",
    criterion: "The evidence lands and gets real traction. Garrow reacts like a proud, frightened man who knows he was wrong: shaken, defensive, or cracking outright (bringing out the arrow he hid would be a fine moment). He shouldn't brush it off as if nothing had been shown. Whatever he admits, the player is left room to respond: the bar doesn't go up and the toll isn't settled in this reply, and his secrets aren't all dumped in one breath.",
    expect: { exit: "none", transition: ["none", "goblins-raised", "cracks"] }, tags: ["twist", "secrets", "evidence"] },
  { kind: "reply", id: "gt-final-offer", about: "Absurd persistence: a third plea after two refusals. Neither stonewall nor cave.", scene: "garrows-toll",
    setup: { ...NAMED, turnsInBeat: 3, transcript: [
      ...NAMED.transcript!,
      ["player", "\"Come on, warden, a shilling levy? Nobody pays that. Let it go.\""],
      ["garrow", "*Garrow taps the notice with his pencil.* \"By the King's leave, for the Centennial. One shilling, traveller.\""],
      ["player", "\"I'm a poor ranger. Be reasonable. Drop the levy.\""],
      ["garrow", "*He doesn't look up from the ledger.* \"The levy is the levy. I've had Kläggenheim dwarves argue less.\""],
    ] },
    input: "\"Please. I'm begging you. Just drop the shilling.\"",
    criterion: "After two refusals, a third flat 'the levy is the levy' would be a stonewall, and a sudden cave for no reason would be just as bad. A good GM makes this exchange different: Garrow names a final offer, or points in character at what would actually change the sum (the notice's own wording, payment in kind, peace-bonding the bow, settling before the sunset bell), or something in the scene moves. The player leaves the exchange with somewhere new to go.",
    expect: { exit: "none" }, tags: ["stonewall", "calibration"] },

  // ---- Decisions: the twist route's key edges ----
  { kind: "decision", id: "gt-dec-report-not-lie", about: "Reporting goblins to get through free is the truth, not the deception edge (and not a haggling roll).", scene: "garrows-toll", setup: NAMED, phase: "before",
    input: "\"There are goblins on your road, warden. They killed a farmer's ox at the crossroads. A traveller who brings you news like that ought to pass free, surely?\"",
    expect: ["none"], tags: ["rolls", "twist"] },
  { kind: "decision", id: "gt-dec-scoff-not-crack", about: "Garrow scoffing (with a tell) has raised the goblins; it is not him admitting it.", scene: "garrows-toll", setup: NAMED, phase: "after",
    input: "\"Tam Hollis wasn't drunk, warden. There are goblins on this road.\"",
    reply: "Garrow snorts and taps the ledger. \"Hollis. Fined two pennies at first light for drunkenness and spreading alarm on the King's Road. Cider, traveller, the lot of it.\" But his eyes flick to the splintered hole in his door, and when the hedge across the road rustles, he jumps.",
    expect: ["goblins-raised"], tags: ["exits", "twist"] },

  // ---- Trajectory: a tangent-heavy pedant ----
  { kind: "trajectory", id: "gt-traj-pedant", about: "A loophole-hunting pedant: absurd persistence, pay-in-kind offers and poking at the toll house.", scene: "garrows-toll", maxTurns: 14,
    persona: "You're a cheerful pedant and loophole-hunter. You read every notice, argue every charge on technicalities (some clever, some absurd: are you a 'foot passenger' if you hop?), offer odd things in payment, and poke at anything odd around the toll house. You'd rather not pay full price, but you won't hurt anyone.",
    criterion: "The warden and his rules stay consistent: charges don't appear, vanish or change price on a whim. Clever points the notices or the Book support win real concessions; absurd ones get honest, in-character answers with a cost or a counter-offer. The scene reaches an ending without the GM caving to every technicality or stonewalling every argument.",
    tags: ["tangent", "absurd", "consistency"] },
];
