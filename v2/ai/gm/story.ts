import { withImprovisedEnding } from "../../shared/scene/graph.ts";
import type { Scene } from "../../shared/scene/types.ts";

/**
 * The story a scene belongs to, as the GM code copied from the prototype reads it (v5-design §3.8):
 * what suggest.ts vets the suggested lines against (the scenes played, this one and those its ways on
 * reach; the words any other scene might use) and the scenes knowledge.ts names. The prototype read
 * them from its 25 scenes (SCENES, ZOO_SCENES, sceneById); the AI service holds only the scenes its
 * campaign installs, so the campaign carries vocabulary.json, each of the prototype's scenes in a few
 * fields (tools/v2/export-vocabulary.mts). A scene the campaign installs with its words is read from
 * the campaign: the vocabulary stands in for the rest.
 */

/** A scene of the vocabulary, as tools/v2/export-vocabulary.mts writes it. */
export interface VocabularyEntry {
  id: string;
  hook: string;
  /** The scenes its ways on lead to, in exit order, each once. */
  next: string[];
  cast: Array<{ id: string; name: string; called?: string; aka?: string[] }>;
  /** Its world's areas' names, then its things'. */
  worldNames?: string[];
  companion?: string;
  /** All its prep as one text (the prototype's prepText). */
  prep: string;
}

/** vocabulary.json: the prototype's commit it was written from, and its scenes in order. */
export interface Vocabulary { source: string; scenes: VocabularyEntry[] }

/** A scene of the story: one the campaign installs, or a stub of an entry, its prep as one text (suggest.ts's prepText reads it). */
export type StoryScene = Scene & { prep?: string };

export interface Story {
  /** The campaign version ("caerwyn@0.1.0"): what the copied code's caches are kept by. */
  id: string;
  /** A scene as play has it, with an ending of its own (the prototype's sceneById); undefined when the story hasn't got it. */
  scene(id: string): StoryScene | undefined;
  /** Every scene as authored, the vocabulary's in its order (the prototype's SCENES, then ZOO_SCENES), then any other the campaign installs. */
  all(): StoryScene[];
}

/** What the campaign installs: its scenes' keys, and each scene with its words (its place's world on it). */
export interface Installed { keys: string[]; scene(key: string): Scene }

/** The story of a campaign version: its installed scenes, and the vocabulary's stubs for the rest. */
export function storyOf(id: string, installed: Installed, vocabulary: Vocabulary): Story {
  const stubs = new Map(vocabulary.scenes.map(e => [e.id, stubOf(e)]));
  const authored = (key: string): StoryScene | undefined => (installed.keys.includes(key) ? installed.scene(key) : stubs.get(key));
  const keys = [...stubs.keys(), ...installed.keys.filter(k => !stubs.has(k))];
  return {
    id,
    scene: key => { const s = authored(key); return s && withImprovisedEnding(s); },
    all: () => keys.map(k => authored(k)!),
  };
}

/**
 * A scene of the vocabulary as the copied code reads one it doesn't play: its hook, its cast by
 * name, its ways on, its world by name (all as areas: the copied code reads areas then things, in the
 * vocabulary's order) and its prep. The rest of a scene is empty: nothing reads it of another scene.
 */
function stubOf(e: VocabularyEntry): StoryScene {
  return {
    id: e.id, title: e.id, summary: "", setting: "", premise: "", hook: e.hook, opening: "", start: "", beats: [],
    cast: e.cast.map(c => ({ ...c, look: "", voice: "", wants: "", knows: [], attitude: "" })),
    exits: e.next.map(next => ({ id: `to-${next}`, kind: "progress", title: next, outcome: "", closing: "", next })),
    ...(e.worldNames ? { world: { name: "", description: "", size: { w: 0, h: 0 }, areas: e.worldNames.map(name => ({ id: name, name, rect: { x: 0, y: 0, w: 0, h: 0 } })), things: [], people: {} } } : {}),
    ...(e.companion ? { companion: e.companion } : {}),
    prep: e.prep,
  };
}
