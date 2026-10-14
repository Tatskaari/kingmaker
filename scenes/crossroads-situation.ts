import type { Scene, Transition } from "../src/runtime/scene.ts";
import { crossroadsAmbush } from "./crossroads-ambush.ts";

/**
 * Representation experiment: the same crossroads scene as a situation, not a beat graph.
 * Same cast, secrets, limits and endings; no authored sequence. The GM gets one "situation"
 * with every route to an ending, and a single escalating pressure. Compare with the beat graph
 * (crossroads-ambush) to see how much the authored beats actually contribute.
 */
const endingRoutes: Transition[] = crossroadsAmbush.beats
  .flatMap(b => b.transitions)
  .filter(t => {
    const target = t.check ? t.check.onSuccess : t.to;
    return crossroadsAmbush.exits.some(e => e.id === target) || (t.check?.onFailure && crossroadsAmbush.exits.some(e => e.id === t.check!.onFailure));
  });

export const crossroadsSituation: Scene = {
  ...crossroadsAmbush,
  id: "crossroads-situation",
  title: "The Mad Farmer at the Crossroads (situation)",
  summary: "The crossroads scene authored as a situation (people, secrets, pressures, endings) without a beat sequence.",
  cast: crossroadsAmbush.cast.map(c => {
    const { enters: _enters, ...rest } = c;
    return { ...rest, knows: c.id === "skrag" ? [...c.knows, "He and his goblins are hidden in the blackthorn hedge, watching, until they choose to show themselves."] : c.knows };
  }),
  start: "situation",
  beats: [{
    id: "situation",
    title: "The crossroads",
    direction: "Tam is raving at the milestone, terrified of the goblins following him; he won't make sense until someone calms him or takes him seriously. He's carrying the idol the goblins want and doesn't connect the two. Skrag's goblins are hidden in the hedge and want Grandmother Bone back; they'd rather bargain than die, but they're short-tempered and greedy. Let things unfold from what the player does: the goblins show themselves when the moment is right (the idol comes out, the party tries to leave with Tam, or the talk drags on).",
    cast: {
      tam: "Wants to get home alive and to be believed. Hides the idol out of embarrassment; gives it up if the party insists or explains.",
      skrag: "Watches from the hedge. Wants Grandmother Bone back; will posture, threaten, bargain, flee if cowed, attack if insulted or ignored.",
    },
    pressure: "The hedges rustle; a crude arrow thunks into the milestone; Skrag's rattle sounds; then he steps out and demands Grandmother Bone.",
    transitions: endingRoutes,
  }],
};
