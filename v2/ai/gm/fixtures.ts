import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { initialGm } from "../../shared/gm/state.ts";
import type { PlaceFile, SceneFile } from "../../shared/scene/files.ts";
import { effectiveScene, presentCast } from "../../shared/scene/graph.ts";
import { sceneOf } from "../../shared/scene/load.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { buildWorld, joinWorld } from "../../shared/world/scene-world.ts";
import type { TurnView } from "./view.ts";

/**
 * For the GM code's tests: the hanged clerk as campaigns/caerwyn has it, and a view of it a few
 * exchanges in with its world as it opens (the prototype's tests' `at()`), with no request or
 * service in the way. Tests only.
 */

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const DIR = join(CAERWYN, "scenes", "hanged-clerk");

/** The scene with its words, as play has it (an ending of its own added). */
export function hangedClerk(): Scene {
  const file = JSON.parse(readFileSync(join(DIR, "scene.json"), "utf8")) as SceneFile;
  return effectiveScene(sceneOf(file, path => (existsSync(join(DIR, path)) ? readFileSync(join(DIR, path), "utf8") : undefined)), []);
}

export const granaryYard = (): PlaceFile => JSON.parse(readFileSync(join(CAERWYN, "places", "granary-yard.json"), "utf8")) as PlaceFile;

/** A view of the scene at a beat (its start by default), two exchanges in, with no transcript and the world as it opens. */
export function viewAt(scene: Scene, beat = scene.start, extra: Partial<TurnView> = {}): TurnView {
  const view: TurnView = {
    ...initialGm({ start: beat }), turnsInBeat: 2,
    id: "test-game", sceneId: scene.id, turn: 4,
    player: { name: "Nim Bramblefoot", concept: "a halfling cutpurse", modifiers: {} },
    memory: { opened: [] }, rulings: [], fought: [], history: [], transcript: [],
    ...extra,
  };
  const cast = presentCast(scene, view).map(c => ({ id: c.id, name: c.name }));
  view.world = buildWorld(scene.id, granaryYard(), cast, view.player);
  joinWorld(view.world, cast, 0);
  return view;
}
