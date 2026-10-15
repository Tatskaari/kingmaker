import type { Scene } from "../src/runtime/scene.ts";
import { blockedEntrance } from "./blocked-entrance.ts";
import { crossroadsAmbush } from "./crossroads-ambush.ts";
import { garrowsToll } from "./garrows-toll.ts";

/**
 * Repair experiment: scenes with key routes removed. The endings still exist (with their
 * scripts) but nothing leads to them, so a player who takes that path is off the graph.
 * Does the GM accommodate it anyway, does the co-GM add the missing route, and does the
 * scene end through the right authored ending rather than the improvised fallback?
 */
function withoutRoutes(scene: Scene, id: string, remove: string[], note: string): Scene {
  return {
    ...scene,
    id,
    title: `${scene.title} (holed)`,
    summary: `${scene.summary} [Repair experiment: ${note}]`,
    beats: scene.beats.map(b => ({ ...b, transitions: b.transitions.filter(t => !remove.includes(t.id)) })),
    anytime: (scene.anytime ?? []).filter(t => !remove.includes(t.id)),
  };
}

/** No route for handing Grandmother Bone back: the most common peaceful ending is off the graph. */
export const crossroadsHoled = withoutRoutes(crossroadsAmbush, "crossroads-holed", ["idol-returned"],
  "no route for returning the idol, though the 'Grandmother Bone goes home' ending exists");

/** No route for remedies invented in play, nor the charm route: lifting the tree is off the graph. */
export const entranceHoled = withoutRoutes(blockedEntrance, "entrance-holed", ["other-remedy", "other-remedy-late", "release-charm"],
  "no route for freeing the cart by the player's own remedy, though the 'Freed' ending exists");

/** Garrow's toll with the evidence route removed: proving Tam right is off the graph. */
export const tollHoled = withoutRoutes(garrowsToll, "toll-holed",
  garrowsToll.beats.flatMap(b => b.transitions).filter(t => (t.to ?? t.check?.onSuccess) === "tam-was-right").map(t => t.id),
  "no route to the 'Tam was right' ending");
