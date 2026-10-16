import { VOCABULARY, vocabularyOf, type Vocabulary, type VocabularyEntry } from "../../ai/gm/story.ts";
import { prepText } from "../../ai/gm/suggest.ts";
import type { CampaignPack, PlaceFile, SceneFile } from "../../shared/scene/files.ts";
import { sceneOf } from "../../shared/scene/load.ts";
import type { Scene } from "../../shared/scene/types.ts";
import type { CampaignFiles } from "./campaign.ts";

/**
 * A campaign's vocabulary (vocabulary.json, v5-design §3.8): what the AI service vets its suggested
 * lines against of the scenes it doesn't install. The prototype screens a line by the story's names
 * and places and by the words any scene might use, read from all of its scenes; the campaign installs
 * only the scenes built so far, so tools/v2/export-vocabulary.mts records each of the prototype's
 * scenes once: its id, hook, ways on (`next`), cast, world names and prep.
 *
 * The check: the file's shape (read as the AI service reads it, whose PUT refuses one that doesn't
 * read: ai/gm/story.ts), one entry an id, every way on leading to an entry or an installed scene, and
 * each installed scene equal to its entry as the tool would write it from the scene loaded with its
 * words. That last checks the conversion too: the scene.json and Markdown give back the prototype's
 * prep, hook, ways on, cast and world names, which the AI service reads in their place.
 */

/** The fields an installed scene's entry must have as the scene gives them, in the entry's order. */
const COMPARED = ["hook", "next", "cast", "worldNames", "prep"] as const;

/** What's wrong with a campaign's vocabulary, each problem a line naming where: [] when it's fit. */
export function vocabularyProblems(files: CampaignFiles, pack: CampaignPack): string[] {
  const text = files[VOCABULARY];
  if (text === undefined) return missingProblems(pack);
  const v = vocabularyOf(text);
  if (Array.isArray(v)) return v;

  return [
    ...twiceProblems(v),
    ...nextProblems(v, pack),
    ...pack.scenes.flatMap(({ scene }) => installedProblems(v, scene, files, pack)),
  ];
}

/** The entry the tool would write for a scene: its world is its place's, as a campaign keeps it. */
export function entryOf(scene: Scene, place?: PlaceFile): VocabularyEntry {
  return {
    id: scene.id,
    hook: scene.hook,
    next: [...new Set(scene.exits.flatMap(e => (e.next ? [e.next] : [])))],
    cast: scene.cast.map(c => ({ id: c.id, name: c.name, ...(c.called ? { called: c.called } : {}), ...(c.aka?.length ? { aka: c.aka } : {}) })),
    ...(place ? { worldNames: [...place.areas.map(a => a.name), ...place.things.map(t => t.name)] } : {}),
    ...(scene.companion ? { companion: scene.companion } : {}),
    prep: prepText(scene),
  };
}

// ---------------------------------------------------------------------------------------------
// The checks.

/**
 * No vocabulary is fine for a campaign whose scenes lead only to scenes it installs. When one leads
 * further, the lines' vetting needs the story's scenes beyond it, and only the vocabulary has them.
 */
function missingProblems(pack: CampaignPack): string[] {
  const installed = new Set(pack.campaign.scenes);
  return pack.scenes.flatMap(({ scene }) => {
    const beyond = [...new Set(Object.values(scene.exits).flatMap(e => (e.next && !installed.has(e.next) ? [e.next] : [])))];
    return beyond.length ? [`${VOCABULARY} is missing, and ${scene.id} leads to ${beyond.join(", ")}, which the campaign doesn't install (tools/v2/export-vocabulary.mts writes it)`] : [];
  });
}

function twiceProblems(v: Vocabulary): string[] {
  const ids = v.scenes.map(e => e.id);
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].map(id => `${VOCABULARY}: ${id} is there twice`);
}

/** Every way on leads to a scene the story can read: an entry, or one the campaign installs. */
function nextProblems(v: Vocabulary, pack: CampaignPack): string[] {
  const known = new Set([...v.scenes.map(e => e.id), ...pack.campaign.scenes]);
  return v.scenes.flatMap(e => e.next.filter(id => !known.has(id)).map(id => `${VOCABULARY}: ${e.id} leads to ${id}, which is neither an entry nor an installed scene`));
}

/**
 * An installed scene against its entry, field by field. A scene that doesn't load with its words is
 * passed over: the scene's own check says why.
 */
function installedProblems(v: Vocabulary, file: SceneFile, files: CampaignFiles, pack: CampaignPack): string[] {
  const entry = v.scenes.find(e => e.id === file.id);
  if (!entry) return [`${VOCABULARY}: no entry for ${file.id}, which the campaign installs`];
  const scene = withWords(file, files);
  if (!scene) return [];

  const want = entryOf(scene, file.place ? pack.places.find(p => p.key === file.place) : undefined);
  return COMPARED.filter(field => JSON.stringify(entry[field]) !== JSON.stringify(want[field]))
    .map(field => `${VOCABULARY}: ${file.id}'s ${field} isn't the installed scene's${whereTheyPart(entry[field], want[field])}`);
}

function withWords(file: SceneFile, files: CampaignFiles): Scene | undefined {
  try {
    return sceneOf(file, path => files[`scenes/${file.id}/${path}`]);
  } catch {
    return undefined;
  }
}

/** Where a field's text first differs, so a reader can find it: the line, the entry's, then the scene's. */
function whereTheyPart(kept: unknown, scene: unknown): string {
  if (typeof kept !== "string" || typeof scene !== "string") return "";
  const a = kept.split("\n"), b = scene.split("\n");
  const i = a.findIndex((line, n) => line !== b[n]);
  const at = i < 0 ? a.length : i;
  return ` (line ${at + 1}: ${clip(a[at])} in the entry, ${clip(b[at])} in the scene)`;
}

const clip = (line: string | undefined) => (line === undefined ? "nothing" : JSON.stringify(line.length > 80 ? `${line.slice(0, 77)}…` : line));
