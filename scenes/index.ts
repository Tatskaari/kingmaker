import type { Scene } from "../src/runtime/scene.ts";
import { withImprovisedEnding } from "../src/runtime/brief.ts";
import { strangerCrossroads } from "./stranger-crossroads.ts";
import { crossroadsAmbush } from "./crossroads-ambush.ts";
import { crossroadsAftermath } from "./crossroads-aftermath.ts";
import { crossroadsSituation } from "./crossroads-situation.ts";
import { garrowsToll } from "./garrows-toll.ts";
import { warrenHostage } from "./warren-hostage.ts";
import { blockedEntrance } from "./blocked-entrance.ts";
import { greenStandoff } from "./green-standoff.ts";
import { hangedClerk } from "./hanged-clerk.ts";
import { hangedClerkBeats } from "./hanged-clerk-beats.ts";
import { drownedRat } from "./drowned-rat.ts";
import { kingsMorning } from "./kings-morning.ts";
import { heronWarehouse } from "./heron-warehouse.ts";
import { caerwynAfternoon, wharfNight } from "./interludes.ts";
import { crossroadsHoled, entranceHoled, tollHoled } from "./holed.ts";
import { talkScene } from "./talk.ts";
import { ZOO_SCENES } from "./zoo/index.ts";

export const SCENES: Scene[] = [
  strangerCrossroads, crossroadsAmbush, crossroadsAftermath, crossroadsSituation,
  garrowsToll, warrenHostage, blockedEntrance, greenStandoff, hangedClerk, caerwynAfternoon, drownedRat, wharfNight, heronWarehouse, kingsMorning,
  crossroadsHoled, entranceHoled, tollHoled,
];

export { ZOO_SCENES };

/**
 * Representation experiments the harness and evals can play by id, kept out of SCENES: they share
 * an authored scene's people and words, and what reads the authored scenes as a set (the suggested
 * lines' screen, the story's cards) shouldn't count them twice.
 */
export const EXPERIMENT_SCENES: Scene[] = [hangedClerkBeats];

/**
 * Scenes as the runtime sees them: authored (or a talk with a companion, or one of the zoo's own,
 * which the story never leads to), plus the built-in "ending of their own".
 */
export function sceneById(id: string): Scene {
  const scene = SCENES.find(s => s.id === id) ?? ZOO_SCENES.find(s => s.id === id) ?? EXPERIMENT_SCENES.find(s => s.id === id) ?? talkScene(id, castCard);
  if (!scene) throw new Error(`Unknown scene ${id}. Known: ${SCENES.map(s => s.id).join(", ")}`);
  return withImprovisedEnding(scene);
}

/** Someone's card in the authored scenes (a talk takes the rules' stats from it). */
const castCard = (id: string) => SCENES.flatMap(s => s.cast).find(c => c.id === id);
