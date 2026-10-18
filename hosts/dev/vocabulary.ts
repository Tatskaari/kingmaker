import { VOCABULARY, vocabularyOf, type Vocabulary, type VocabularyEntry } from "../../ai/gm/story.ts";
import { prepText } from "../../ai/gm/suggest.ts";
import { isEnding } from "../../shared/scene/document.ts";
import type { CampaignPack, PlaceFile } from "../../shared/scene/files.ts";
import type { Scene } from "../../shared/scene/types.ts";
import type { CampaignFiles } from "./campaign.ts";

/**
 * A campaign's vocabulary (vocabulary.json, v5-design §3.8): what the AI service vets its suggested
 * lines against of the scenes it doesn't install. The prototype screens a line by the story's names
 * and places and by the words any scene might use, read from all of its scenes; the campaign installs
 * only the scenes built so far, so tools/v2/export-vocabulary.mts (the prototype's tool, in git
 * history at bc2ab1f) recorded each of the prototype's scenes once: its id, hook, ways on (`next`),
 * cast, world names and prep.
 *
 * The check: the file's shape (read as the AI service reads it, whose PUT refuses one that doesn't
 * read: ai/gm/story.ts), one entry an id, every way on leading to an entry or an installed scene, and
 * no entry for a scene the campaign installs: the AI service reads an installed scene from its file
 * (since M2, scenes/<id>.kmscene) in its entry's place, so an entry for one is only ever out of date.
 */

/** What's wrong with a campaign's vocabulary, each problem a line naming where: [] when it's fit. */
export function vocabularyProblems(files: CampaignFiles, pack: CampaignPack): string[] {
  const text = files[VOCABULARY];
  if (text === undefined) return missingProblems(pack);
  const v = vocabularyOf(text);
  if (Array.isArray(v)) return v;

  return [
    ...twiceProblems(v),
    ...nextProblems(v, pack),
    ...v.scenes.filter(e => pack.campaign.scenes.includes(e.id)).map(e => `${VOCABULARY}: ${e.id} has an entry, but the campaign installs it: the AI service reads it from its file, so drop the entry`),
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
  return pack.scenes.flatMap(scene => {
    const beyond = [...new Set(scene.nodes.filter(isEnding).flatMap(n => (n.data.next && !installed.has(n.data.next) ? [n.data.next] : [])))];
    return beyond.length ? [`${VOCABULARY} is missing, and ${scene.id} leads to ${beyond.join(", ")}, which the campaign doesn't install (the prototype's tools/v2/export-vocabulary.mts wrote it: git show bc2ab1f:tools/v2/export-vocabulary.mts)`] : [];
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
