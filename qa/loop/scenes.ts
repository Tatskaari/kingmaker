import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { campaigns, type Campaign } from "../../ai/service/campaigns.ts";
import { memoryStores } from "../../ai/service/memory-stores.ts";
import type { Exit, Scene } from "../../shared/scene/types.ts";

/**
 * The campaign's scenes as the AI service loads them, for the loop: the scene a reviewer is shown
 * the prep of, the scenes a round can play, and their endings, graded. They're loaded by the AI
 * service's own campaign loader (ai/service/campaigns.ts) from the files a stack installed, so the
 * loop reads a scene as the GM had it: the runtime Scene its .kmscene file makes (shared/scene/load.ts).
 */

/** A campaign version loaded, and its story's scenes in order (campaign.json's). */
export interface Loaded { campaign: Campaign; keys: string[] }

/**
 * The campaign in a folder, loaded as the AI service loads one PUT to it (in memory): a campaign
 * folder (campaigns/caerwyn) or the copy a stack's AI service keeps of a version it was given
 * (<stack>/ai/campaigns/caerwyn/0.1.0), which is the same files.
 */
export async function campaignAt(dir: string): Promise<Loaded> {
  const files = filesIn(dir);
  const file = JSON.parse(files["campaign.json"] ?? "{}") as { id?: string; version?: string; scenes?: string[] };
  if (!file.id || !file.version) throw new Error(`${dir} has no campaign.json with an id and a version.`);

  const stores = memoryStores();
  const loader = campaigns(stores.campaigns, stores.docs);
  await loader.put(file.id, file.version, files);
  return { campaign: loader.use(file.id, file.version), keys: file.scenes ?? [] };
}

/** A scene by its key, as the GM has it: its prep, its endings. */
export const sceneOf = (loaded: Loaded, key: string): Scene => loaded.campaign.scene(key);

/** The scenes a game can play: the story's, but the interludes (downtime the story passes over). */
export function playable(loaded: Loaded): string[] {
  return loaded.keys.filter(key => !sceneOf(loaded, key).interlude);
}

/** Every file under a folder, by its path in it with "/" between parts; dotfiles left out. */
function filesIn(dir: string): Record<string, string> {
  const paths = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter(path => !path.split("/").some(part => part.startsWith(".")));
  return Object.fromEntries(paths.map(path => [path, readFileSync(join(dir, path), "utf8")]));
}

// ---------------------------------------------------------------------------------------------
// Endings

/** How an ending went for the player, as the scene grades it (an ending's `result`). */
export type Grade = "good" | "mixed" | "bad";

/** An ending: its id and title, its grade, the story's kind of ending, and the scene it goes on to. */
export interface Ending { id: string; title: string; grade?: Grade; kind?: string; next?: string }

/** A scene's endings, in the order it has them, each graded by its `result`. */
export function endingsOf(scene: Pick<Scene, "exits">): Ending[] {
  return scene.exits.map((e: Exit) => {
    const grade = gradeOf(e.result);
    return { id: e.id, title: e.title, ...(grade ? { grade } : {}), kind: e.kind, ...(e.next ? { next: e.next } : {}) };
  });
}

/** An ending's grade: its `result`, which every ending of the scene format has (none for anything else). */
export function gradeOf(result: unknown): Grade | undefined {
  return result === "good" || result === "mixed" || result === "bad" ? result : undefined;
}

/**
 * The endings to end a scene on for QA, best first: its good and mixed ones in the scene's order (the
 * first is the one), then the rest, a fight's last whatever its grade, since a fight wants playing
 * (the stand-in) before the scene ends.
 */
export function skipOrder(endings: Ending[]): Ending[] {
  const rank = (e: Ending) => (e.kind === "combat" ? 2 : e.grade === "good" || e.grade === "mixed" ? 0 : 1);
  return [...endings].sort((a, b) => rank(a) - rank(b));
}

/** The ending a scene's "Scene ends: …" line names, by its title. */
export const endingTitled = (endings: Ending[], title: string): Ending | undefined => endings.find(e => e.title === title);
