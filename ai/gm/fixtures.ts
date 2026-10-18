import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { initialGm } from "../../shared/gm/state.ts";
import type { PlaceFile } from "../../shared/scene/files.ts";
import { effectiveScene, presentCast } from "../../shared/scene/graph.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { buildWorld, joinWorld } from "../../shared/world/scene-world.ts";
import { storyOf, type Story, type Vocabulary } from "./story.ts";
import type { TurnView } from "./view.ts";

/**
 * For the GM code's tests: the hanged clerk as the prototype played it and the goldens were recorded
 * on it, and a view of it a few exchanges in with its world as it opens (the prototype's tests'
 * `at()`), with no request or service in the way; and the story the prototype's tests play in, its
 * other scenes as they had them (testdata/scenes, written by the prototype's tools/record-golden.mts,
 * in git history at bc2ab1f: golden/README.md). The hanged clerk's is testdata/scenes/hanged-clerk.json:
 * campaigns/caerwyn's scene.json and Markdown before M2 re-authored it, loaded as the game loaded them
 * (the runtime's Scene, with every word), so these tests of the copied GM code keep the scene the
 * goldens were recorded on. Tests only.
 */

export const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const TESTDATA = join(import.meta.dirname, "testdata", "scenes");

/**
 * The tests' own hanged clerk as a scene file (shared/scene/testdata/hanged-clerk.kmscene): the
 * campaign's before M2 re-authored it, in the scene format. The AI service's tests install the
 * campaign with it in place of the campaign's own (withTestClerk), so the endpoints play the scene
 * their tests were written for (its beats, routes and endings by their ids: yard, catch-moll,
 * case-made…) whatever the campaign's content becomes.
 */
export const TEST_CLERK = join(import.meta.dirname, "..", "..", "shared", "scene", "testdata", "hanged-clerk.kmscene");

/** A campaign folder's files with the tests' own hanged clerk in place of its own. */
export const withTestClerk = (files: Record<string, string>): Record<string, string> => ({ ...files, "scenes/hanged-clerk.kmscene": readFileSync(TEST_CLERK, "utf8") });

/** A scene of testdata/scenes, as authored. */
export const testScene = (id: string): Scene => JSON.parse(readFileSync(join(TESTDATA, `${id}.json`), "utf8")) as Scene;

/** The hanged clerk with its words, as authored before M2. */
const authored = (): Scene => testScene("hanged-clerk");

/** The scene with its words, as play has it (an ending of its own added). */
export function hangedClerk(): Scene {
  return effectiveScene(authored(), []);
}

/**
 * The story the prototype's tests play in, as the AI service had it for the campaign: the hanged
 * clerk installed (its place as its world), the prototype's scenes of testdata/scenes as if
 * installed too, and the vocabulary as the campaign had it before M2 (testdata/vocabulary.json:
 * the prototype's 25 scenes, the interludes among them) for the rest.
 */
export function testStory(): Story {
  const scenes = new Map<string, Scene>([["hanged-clerk", { ...authored(), world: granaryYard() }]]);
  for (const f of readdirSync(TESTDATA).filter(f => f.endsWith(".json") && f !== "hanged-clerk.json").sort()) scenes.set(f.replace(/\.json$/, ""), testScene(f.replace(/\.json$/, "")));
  const vocabulary = JSON.parse(readFileSync(join(import.meta.dirname, "testdata", "vocabulary.json"), "utf8")) as Vocabulary;
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
    fought: [], owed: [], history: [], transcript: [], story: testStory(),
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
    fought: [], owed: [], history: [], transcript: [],
    ...extra,
  };
  const cast = presentCast(scene, view).map(c => ({ id: c.id, name: c.name }));
  view.world = buildWorld(scene.id, granaryYard(), cast, view.player);
  joinWorld(view.world, cast, 0);
  return view;
}
