import type { DocsVolume } from "./config.ts";
import { dirname, join } from "./paths.ts";

/**
 * The docs' volumes (config.ts): a folder on disk, and docs in memory.
 *
 * A folder asks for Node's fs when it's first read or written (process.getBuiltinModule), rather
 * than importing it, so the docs service bundles for a browser with no node: import. A host there
 * keeps its docs in memory volumes (written behind to wherever it keeps them), and a folder read
 * there fails, saying why.
 */

/** The docs in a folder, by their paths in it. */
export function folderVolume(root: string): DocsVolume {
  const file = (path: string) => join(root, path);
  return {
    read(path) {
      const fs = nodeFs();
      return fs.existsSync(file(path)) ? fs.readFileSync(file(path), "utf8") : undefined;
    },
    write(path, text) {
      const fs = nodeFs();
      fs.mkdirSync(dirname(file(path)), { recursive: true });
      fs.writeFileSync(file(path), text);
    },
    list: () => walk(nodeFs(), root, ""),
  };
}

/** The docs in a map, by path: each write is handed on to `onWrite` too (a host's write-behind). */
export function memoryVolume(docs = new Map<string, string>(), onWrite?: (path: string, text: string) => void): DocsVolume {
  return {
    read: path => docs.get(path),
    write(path, text) {
      docs.set(path, text);
      onWrite?.(path, text);
    },
    list: () => [...docs.keys()].filter(isDoc),
  };
}

/** A doc's path, as a volume lists it: Markdown, and nothing on the way to it hidden. */
export const isDoc = (path: string): boolean => path.endsWith(".md") && !path.split("/").some(part => part.startsWith("."));

type NodeFs = typeof import("node:fs");

/** Every doc in a folder's `dir` and below, by its path from the folder. */
function walk(fs: NodeFs, root: string, dir: string): string[] {
  const base = join(root, dir);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith(".")) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(fs, root, path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

/** Node's fs, asked for rather than imported (above). */
function nodeFs(): NodeFs {
  const fs = globalThis.process?.getBuiltinModule?.("node:fs");
  if (!fs) throw new Error("there's no file system here to read a folder from: a host without one gives the docs service volumes in memory (configureDocs), and the prompts a source (configurePrompts)");
  return fs;
}
