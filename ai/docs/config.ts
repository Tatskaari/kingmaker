import { join } from "./paths.ts";
import { folderVolume } from "./volumes.ts";

/**
 * Where the docs service finds the docs: the authored lore, which it reads and never writes, and each
 * game's own copy of it, where every write goes (copy on write). Each is a volume: a folder on disk,
 * docs in memory (volumes.ts), or whatever else a host keeps them in. A host says where once, before
 * the first read. Until one does, they're the campaign's lore (campaigns/caerwyn/lore, the copy the
 * prototype's lore/ became) and runs/sessions/<game>/docs (KM_RUNS_DIR moves runs/), made when the
 * docs are first read: so importing this asks nothing of a file system, or of where this file is,
 * and a browser's host configures volumes of its own before it reads.
 */

/** A folder of docs, as the docs service reads it: synchronous, as the service is, by paths of its own ("Cast/Kell/private.md"). */
export interface DocsVolume {
  /** A doc's text, or undefined when there's none at that path. */
  read(path: string): string | undefined;
  /** A doc written at its path, in place of any there. */
  write(path: string, text: string): void;
  /** Every doc's path: Markdown, and nothing hidden. */
  list(): string[];
}

export interface DocsConfig {
  /** The authored lore: the campaign last served's, for what's read with no game (character creation's world, the cast's entries). */
  lore: DocsVolume;
  /** A game's own copy of the lore, by the game's id. */
  overlay: (game: string) => DocsVolume;
  /** The authored lore of a game's own campaign (docs/combat-gm.md: the zoo served beside the story), else `lore`. */
  loreOf: (game: string) => DocsVolume;
}

/** Where the docs are to be, as volumes, or as folders by their paths (as the prototype's adapters and the tests on folders say it). */
export interface DocsPlaces {
  lore?: DocsVolume;
  /** The authored lore's folder: lore, as a folderVolume. */
  loreRoot?: string;
  /** A game's own copy of the lore, by the game's id: a volume, or a folder's path. */
  overlay?: (game: string) => DocsVolume | string;
  /** The authored lore of one game's campaign, when it isn't `lore`'s (a service serving more than one). */
  gameLore?: { game: string; lore: DocsVolume };
}

let lore: DocsVolume | undefined;
let overlay: ((game: string) => DocsVolume) | undefined;
const byGame = new Map<string, DocsVolume>();

/** Where the docs are now: the folders, for what no host has said. */
export function docsConfig(): Readonly<DocsConfig> {
  lore ??= folderVolume(join(import.meta.dirname, "..", "..", "campaigns", "caerwyn", "lore"));
  overlay ??= game => folderVolume(join(globalThis.process?.env.KM_RUNS_DIR ?? "runs", "sessions", game, "docs"));
  const fallback = lore;
  return { lore, overlay, loreOf: game => byGame.get(game) ?? fallback };
}

/** Where the docs are, from now on: what isn't given stays as it was. */
export function configureDocs(changes: DocsPlaces): void {
  const given = changes.lore ?? (changes.loreRoot === undefined ? undefined : folderVolume(changes.loreRoot));
  if (given) lore = given;
  const place = changes.overlay;
  if (place) overlay = game => volumeAt(place(game));
  if (changes.gameLore) byGame.set(changes.gameLore.game, changes.gameLore.lore);
}

const volumeAt = (place: DocsVolume | string): DocsVolume => (typeof place === "string" ? folderVolume(place) : place);
