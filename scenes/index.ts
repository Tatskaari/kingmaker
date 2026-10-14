import type { Scene } from "../src/runtime/scene.ts";
import { crossroadsAmbush } from "./crossroads-ambush.ts";
import { crossroadsAftermath } from "./crossroads-aftermath.ts";
import { strangerCrossroads } from "./stranger-crossroads.ts";
import { blockedEntrance } from "./blocked-entrance.ts";

export const SCENES: Scene[] = [strangerCrossroads, crossroadsAmbush, crossroadsAftermath, blockedEntrance];

export function sceneById(id: string): Scene {
  const scene = SCENES.find(s => s.id === id);
  if (!scene) throw new Error(`Unknown scene ${id}. Known: ${SCENES.map(s => s.id).join(", ")}`);
  return scene;
}
