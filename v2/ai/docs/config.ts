import { join } from "node:path";

/**
 * Where the docs service finds the docs: the authored lore, which it reads and never writes, and each
 * game's own copy of it, where every write goes (copy on write). By default the repo's lore/ and
 * runs/sessions/<game>/docs (KM_RUNS_DIR moves runs/), where the prototype keeps them. A host that
 * keeps them elsewhere says so once, before the first read.
 */
export interface DocsConfig {
  /** The authored lore. */
  loreRoot: string;
  /** A game's own copy of the lore, by the game's id. */
  overlay: (game: string) => string;
}

/** The repo's lore/: the authored lore, unless configureDocs says otherwise. */
export const REPO_LORE = join(import.meta.dirname, "..", "..", "..", "lore");

const config: DocsConfig = {
  loreRoot: REPO_LORE,
  overlay: game => join(process.env.KM_RUNS_DIR ?? "runs", "sessions", game, "docs"),
};

/** Where the docs are now. */
export const docsConfig = (): Readonly<DocsConfig> => config;

/** Where the docs are, from now on: what isn't given stays as it was. */
export function configureDocs(changes: Partial<DocsConfig>): void {
  if (changes.loreRoot !== undefined) config.loreRoot = changes.loreRoot;
  if (changes.overlay !== undefined) config.overlay = changes.overlay;
}
