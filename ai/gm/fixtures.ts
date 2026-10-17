import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { initialGm } from "../../shared/gm/state.ts";
import type { PlaceFile, SceneFile } from "../../shared/scene/files.ts";
import { effectiveScene, presentCast } from "../../shared/scene/graph.ts";
import { sceneOf } from "../../shared/scene/load.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { buildWorld, joinWorld } from "../../shared/world/scene-world.ts";
import { storyOf, type Story, type Vocabulary } from "./story.ts";
import type { TurnView } from "./view.ts";

/**
 * For the GM code's tests: the hanged clerk as campaigns/caerwyn has it, and a view of it a few
 * exchanges in with its world as it opens (the prototype's tests' `at()`), with no request or
 * service in the way; and the story the prototype's tests play in, its other scenes as they had
 * them (testdata/scenes, written by tools/v2/record-golden.mts). Tests only.
 */

export const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const DIR = join(CAERWYN, "scenes", "hanged-clerk");
const TESTDATA = join(import.meta.dirname, "testdata", "scenes");

/** The scene with its words, as authored. */
function authored(): Scene {
  const file = JSON.parse(readFileSync(join(DIR, "scene.json"), "utf8")) as SceneFile;
  return sceneOf(file, path => (existsSync(join(DIR, path)) ? readFileSync(join(DIR, path), "utf8") : undefined));
}

/** The scene with its words, as play has it (an ending of its own added). */
export function hangedClerk(): Scene {
  return effectiveScene(authored(), []);
}

/**
 * The story the prototype's tests play in, as the AI service has it for the campaign: the hanged
 * clerk installed (its place as its world), the prototype's scenes of testdata/scenes as if
 * installed too, and campaigns/caerwyn/vocabulary.json for the rest.
 */
export function testStory(): Story {
  const scenes = new Map<string, Scene>([["hanged-clerk", { ...authored(), world: granaryYard() }]]);
  for (const f of readdirSync(TESTDATA).filter(f => f.endsWith(".json")).sort()) {
    const scene = JSON.parse(readFileSync(join(TESTDATA, f), "utf8")) as Scene;
    scenes.set(scene.id, scene);
  }
  const vocabulary = JSON.parse(readFileSync(join(CAERWYN, "vocabulary.json"), "utf8")) as Vocabulary;
  return storyOf("caerwyn@test", { keys: [...scenes.keys()], scene: key => scenes.get(key)! }, vocabulary);
}

/** A scene of the test story as play has it (the prototype's sceneById). */
export const sceneById = (id: string): Scene => testStory().scene(id)!;

/**
 * A view of a scene of the test story, as the prototype's tests make a session: at the scene's
 * start, a turn in, with nobody's words yet and no world, unless `fields` say otherwise.
 */
export function stateIn(sceneId: string, fields: Partial<TurnView> = {}): TurnView {
  const scene = sceneById(sceneId);
  return {
    ...initialGm({ start: scene.start }), turnsInBeat: 1,
    id: `test-${sceneId}`, sceneId, turn: 1,
    player: { name: "Wren Ashdown", concept: "a hedge wizard", modifiers: {} },
    memory: { opened: [] }, rulings: [], fought: [], owed: [], history: [], transcript: [], story: testStory(),
    ...fields,
  };
}

export const granaryYard = (): PlaceFile => JSON.parse(readFileSync(join(CAERWYN, "places", "granary-yard.json"), "utf8")) as PlaceFile;

/** A view of the scene at a beat (its start by default), two exchanges in, with no transcript and the world as it opens. */
export function viewAt(scene: Scene, beat = scene.start, extra: Partial<TurnView> = {}): TurnView {
  const view: TurnView = {
    ...initialGm({ start: beat }), turnsInBeat: 2,
    id: "test-game", sceneId: scene.id, turn: 4,
    player: { name: "Nim Bramblefoot", concept: "a halfling cutpurse", modifiers: {} },
    memory: { opened: [] }, rulings: [], fought: [], owed: [], history: [], transcript: [],
    ...extra,
  };
  const cast = presentCast(scene, view).map(c => ({ id: c.id, name: c.name }));
  view.world = buildWorld(scene.id, granaryYard(), cast, view.player);
  joinWorld(view.world, cast, 0);
  return view;
}
