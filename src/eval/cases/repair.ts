import type { EvalCase } from "../types.ts";

/**
 * Repair experiment. Two kinds of off-graph play:
 * - ablated: the scene's route for a common approach is removed (scenes/holed.ts), though its
 *   ending still exists; the player pursues exactly that approach.
 * - dreamed: on an intact graph, the player pursues an approach Luna invented that none of the
 *   routes describes (generated once, kept here as data).
 * Scored on whether the scene resolves through the right ending (targetExits), the judge's
 * criterion, how many co-GM patches it took, and latency.
 */
export const repairCases: EvalCase[] = [
  { kind: "trajectory", id: "rp-ablated-idol", about: "Returning the idol has no route (crossroads-holed).", scene: "crossroads-holed", maxTurns: 12,
    persona: "You want to end this peacefully. Once you work out what the goblins want, you'll persuade whoever has it to give it back to them, and hand it over yourself if you must. You'd rather talk than fight.",
    criterion: "The player resolves the standoff by giving the goblins their idol back. A good scene lets that work: the goblins take it and leave peacefully, the scene ends that way, and nobody stonewalls the handover or forces a fight.",
    targetExits: ["bargain"], tags: ["repair", "ablated"] },
  { kind: "trajectory", id: "rp-ablated-tree", about: "Freeing the cart by the player's own remedy has no route (entrance-holed).", scene: "entrance-holed", maxTurns: 12,
    persona: "You like practical, physical fixes. You'll work out what the cart's charm is protecting and free the cart your own way (for example, take the tree off and carry it through by hand), recruiting whoever is around to help.",
    criterion: "The player's own remedy, dealing with what the charm protects, should be able to free the cart and end the scene with the cart freed by that remedy, without being refused, buried in procedure, or replaced by someone else's fix.",
    targetExits: ["cleared-other"], tags: ["repair", "ablated"] },
  { kind: "trajectory", id: "rp-ablated-toll", about: "Proving Tam right has no route (toll-holed).", scene: "toll-holed", maxTurns: 12,
    persona: "You believe the farmer Tam about the goblins, and you want Garrow to admit he was wrong to laugh him away. You'll look for signs of goblins around the toll house and use what you find to get through without paying.",
    criterion: "The player's evidence that Tam was right should matter: Garrow can be brought round by it and let them through on that basis, ending the scene that way, without the evidence being ignored or the player being forced to pay anyway.",
    targetExits: ["tam-was-right"], tags: ["repair", "ablated"] },
  { kind: "trajectory", id: "rp-dreamed-guarantor", about: "Dreamed approach: Offer to act as guarantors: you’ll accompany Skrag and the idol to the burnt mill so he can show his chieftain it was recovered, while one of you walks Tam toward Hollis Farm. Ask Skrag to let Tam go now, rather than take him along or make trouble for him.", scene: "crossroads-ambush", maxTurns: 12,
    persona: "You want to protect Tam while making Skrag confident he can answer to his chieftain; you'll offer your own presence as a guarantee and split the party if needed.",
    criterion: "The player's guarantor plan is a reasonable, unplanned way through. A good scene lets it work on its own terms, or gives an honest in-fiction reason it can't and a real alternative, and ends the scene through the outcome the player built, without stonewalling or quietly forcing a different solution.",
    targetExits: ["bargain", "own-ending"], tags: ["repair", "dreamed"] },
  { kind: "trajectory", id: "rp-dreamed-skids", about: "Dreamed approach: Make a low skid beneath the trapped wheels from available timber or wagon poles. Have the porters lever the cart up a little at a time while others slide the skids into place, then push it sideways onto clear ground.", scene: "blocked-entrance", maxTurns: 12,
    persona: "You want a slow, controlled way to free the cart. You’ll organize the porters to use poles as levers and slide timber under the buried wheels, creating a track the cart can move across.",
    criterion: "The skid-and-lever plan is a practical, unplanned way through. A good scene lets it gain real traction (with honest cost or risk) and ends with the cart freed by the player's plan, without stonewalling or swapping in an authored fix the player didn't choose.",
    targetExits: ["cleared-other"], tags: ["repair", "dreamed"] },
  { kind: "trajectory", id: "rp-dreamed-workdetail", about: "Dreamed approach: Ask Oswin and the Sedgeford adults to organize an immediate work detail: secure the carts and livestock, then help Harrowby with ward-night preparations. Invite Harrowby villagers to join in, making the refugees’ presence a practical exchange of help rather than another debate about whether they deserve it.", scene: "green-standoff", maxTurns: 12,
    persona: "You want to show that the Sedgeford folk can be useful neighbours tonight, not a burden; you’ll get Oswin and the villagers working side by side and let Hester see the change for herself.",
    criterion: "Organising the refugees into a work detail that helps Harrowby is an unplanned but sensible way to change the standoff. A good scene lets it matter, so people's attitudes shift because of it, and lets it carry the scene to a fitting ending, without stonewalling or ignoring it.",
    targetExits: ["sheltered"], tags: ["repair", "dreamed"] },
  // ---- Deviations from where the author placed things (the essential has to move) ----
  { kind: "trajectory", id: "dv-ignore-tam", about: "The player ignores Tam, who carries the idol (essential placed with him).", scene: "crossroads-ambush", maxTurns: 12,
    persona: "You think the shouting farmer is a drunk and you don't want to get involved: you ignore his ravings and don't ask him anything. You go straight to the dead ox and the hedges where something keeps moving, and you're happy to talk to whatever you find there.",
    criterion: "The player never engages with Tam, so the idol has to reach them another way (the goblins, the world, Tam acting on his own), and the scene should still come to a fitting ending through what the player chose to do, without forcing them back to Tam or stalling.",
    targetExits: ["bargain", "routed", "tricked", "fight", "own-ending"], tags: ["repair", "deviation"] },
  { kind: "trajectory", id: "dv-no-rowan", about: "The player won't deal with Rowan, who holds the key insight about the charm.", scene: "blocked-entrance", maxTurns: 12,
    persona: "You don't trust scholars: you refuse to deal with the man under the cart at all. You work with Holt, the porters and the head porter outside to get the entrance cleared, and you want a practical answer from them.",
    criterion: "Without Rowan, the insight into why the cart braces has to reach the player through someone or something else, and the player's way of working (through Holt and the porters) should be able to get the entrance cleared, without the scene insisting they talk to Rowan.",
    targetExits: ["cleared-other", "smashed", "backed-out", "own-ending"], tags: ["repair", "deviation"] },
  { kind: "trajectory", id: "dv-ignore-door", about: "The player never looks at the toll house, where the arrow evidence was placed.", scene: "garrows-toll", maxTurns: 12,
    persona: "You never inspect the toll house or its surroundings. You stay on the road and argue with the warden about the toll, about fairness, and about the farmer Tam he laughed at this morning.",
    criterion: "The arrow and Garrow's fear were placed in the toll house; the player never looks. A good scene lets that truth come out through the argument the player is actually having (Garrow's manner, a slip, a sound from the hedge), so the player can still get somewhere satisfying, rather than leaving it buried.",
    targetExits: ["tam-was-right", "paid", "bluffed", "cowed", "own-ending"], tags: ["repair", "deviation"] },
  { kind: "trajectory", id: "dv-no-search", about: "The player won't search bodies or belongings; the motive is sewn into a boot.", scene: "hanged-clerk", maxTurns: 14,
    persona: "You never search bodies, clothes or belongings: you think it's beneath you. You only question people (the sergeant, the children, the constable) and reason from what they tell you. You want to know who did this.",
    criterion: "The page with the motive was placed in the dead man's boot and the tally book; the player never searches. A good scene lets the motive and the name surface through the people the player questions, so the case can still be made, rather than stalling until they search.",
    targetExits: ["case-made", "open-case", "own-ending"], tags: ["repair", "deviation"] },
];
