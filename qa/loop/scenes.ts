import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { campaigns, type Campaign } from "../../ai/service/campaigns.ts";
import { memoryStores } from "../../ai/service/memory-stores.ts";

/**
 * The campaign's scenes as the AI service loads them, for the loop: the scene a reviewer is shown
 * the prep of, the scenes a round can play, and their endings, graded. They're loaded by the AI
 * service's own campaign loader (ai/service/campaigns.ts) from the files a stack installed, so the
 * loop reads a scene as the GM had it, whatever the scene files' format. Anything read here beyond
 * the scene's id is read loosely: a scene file format that adds or drops fields changes what's shown,
 * not whether it loads.
 */

/** A campaign version loaded, and its story's scenes in order (campaign.json's). */
export interface Loaded { campaign: Campaign; keys: string[] }

/** A field of a scene read without trusting its shape. */
export type Loose = Record<string, unknown>;

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

/** A scene by its key, loosely (see above): its prep, its endings. */
export const sceneOf = (loaded: Loaded, key: string): Loose => loaded.campaign.scene(key) as unknown as Loose;

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

/** How an ending went for the player, as the scene grades it (the M2 format's `result`). */
export type Grade = "good" | "mixed" | "bad";

/** An ending, whatever shape the scene keeps it in: its id and title, its grade when it has one, and the story's kind of ending. */
export interface Ending { id: string; title: string; grade?: Grade; kind?: string; next?: string }

/**
 * A scene's endings, in the order it has them: its exits (each with a `result` where the scene
 * grades them, and a `kind`), or, for a scene kept as nodes and routes, its exit nodes.
 */
export function endingsOf(scene: Loose): Ending[] {
  const exits = Array.isArray(scene.exits) ? scene.exits as Loose[] : [];
  const nodes = Array.isArray(scene.nodes) ? (scene.nodes as Loose[]).filter(n => (n.data as Loose | undefined)?.kind === "exit") : [];
  return [...exits.map(e => endingFrom(e, e)), ...nodes.map(n => endingFrom(n, n.data as Loose))].filter(e => e.id);
}

function endingFrom(at: Loose, data: Loose): Ending {
  const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const kind = text(data.kind) === "exit" ? text(data.exitKind) : text(data.kind) ?? text(data.exitKind);
  const grade = gradeOf(text(data.result), kind);
  return {
    id: text(at.id) ?? "", title: text(data.title) ?? text(at.id) ?? "",
    ...(grade ? { grade } : {}), ...(kind ? { kind } : {}), ...(text(data.next) ? { next: text(data.next)! } : {}),
  };
}

/**
 * An ending's grade: the scene's own `result`; or, for a scene that doesn't grade its endings (the
 * campaign's before M2), read from its kind: one that moves the story on (progress, persuaded) is
 * good, walking away is bad, and a fight or anything else isn't graded.
 */
export function gradeOf(result: string | undefined, kind: string | undefined): Grade | undefined {
  if (result === "good" || result === "mixed" || result === "bad") return result;
  if (kind === "progress" || kind === "persuaded") return "good";
  if (kind === "leave") return "bad";
  return undefined;
}

/**
 * The endings to end a scene on for QA, best first: its good and mixed ones in the scene's order (the
 * first is the one), then those not graded but a fight's, then the rest. A fight's comes last since
 * it wants the fight played before the scene ends.
 */
export function skipOrder(endings: Ending[]): Ending[] {
  const rank = (e: Ending) => (e.grade === "good" || e.grade === "mixed" ? 0 : e.grade === undefined && e.kind !== "combat" ? 1 : 2);
  return [...endings].sort((a, b) => rank(a) - rank(b));
}

/** The ending a scene's "Scene ends: …" line names, by its title. */
export const endingTitled = (endings: Ending[], title: string): Ending | undefined => endings.find(e => e.title === title);
