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

/** Where a campaign keeps its vocabulary, in its folder. */
export const VOCABULARY = "vocabulary.json";

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

// ---------------------------------------------------------------------------------------------
// Reading vocabulary.json: the AI service's PUT refuses one that doesn't read, and the campaign
// check (hosts/dev/vocabulary.ts) reads it here too.

/** The file as a vocabulary, or what's wrong with its JSON or its shape, each problem a line naming where. */
export function vocabularyOf(text: string): Vocabulary | string[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return [`${VOCABULARY} isn't JSON: ${(e as Error).message}`];
  }
  const problems = shapeProblems(value);
  return problems.length ? problems : (value as Vocabulary);
}

/** `{ source, scenes }`, each entry with the tool's fields and types. */
function shapeProblems(v: unknown): string[] {
  if (!isObject(v) || typeof v.source !== "string" || !v.source || !Array.isArray(v.scenes)) return [`${VOCABULARY}: isn't { source, scenes: [...] }`];
  return v.scenes.flatMap((entry, i) => {
    const at = `${VOCABULARY}: scenes[${i}]${isObject(entry) && typeof entry.id === "string" ? ` (${entry.id})` : ""}`;
    return entryShapeProblems(entry).map(p => `${at}: ${p}`);
  });
}

function entryShapeProblems(e: unknown): string[] {
  if (!isObject(e)) return ["isn't an object"];
  const problems: string[] = [];
  if (typeof e.id !== "string" || !e.id) problems.push("no id");
  if (typeof e.hook !== "string") problems.push("no hook");
  if (!strings(e.next)) problems.push("next isn't a list of scene ids");
  if (!Array.isArray(e.cast) || !e.cast.every(castShape)) problems.push("cast isn't a list of { id, name, called?, aka? }");
  if (e.worldNames !== undefined && !strings(e.worldNames)) problems.push("worldNames isn't a list of names");
  if (e.companion !== undefined && typeof e.companion !== "string") problems.push("companion isn't a cast id");
  if (typeof e.prep !== "string" || !e.prep) problems.push("no prep");
  return problems;
}

const castShape = (c: unknown) => isObject(c) && typeof c.id === "string" && typeof c.name === "string"
  && (c.called === undefined || typeof c.called === "string") && (c.aka === undefined || strings(c.aka));

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const strings = (v: unknown) => Array.isArray(v) && v.every(s => typeof s === "string");
