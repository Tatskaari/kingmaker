import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "@bufbuild/protobuf";
import type { WorldState } from "../../contracts/src/v2.js";
import { createScenarioServices } from "../../lore/src/services.js";

export interface DocumentLayers {
  markdown: Map<string, string>;
  sidecars: Map<string, JsonValue>;
}

/** Each directory is a vault root. Later layers replace whole files at matching relative paths. */
export function loadDocumentLayers(roots: readonly string[]): DocumentLayers {
  if (!roots.length) throw new Error("At least one document layer is required.");
  const markdown = new Map<string, string>(), sidecars = new Map<string, JsonValue>();
  for (const root of roots) {
    const visit = (relative: string) => {
      for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith(".")) continue;
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error(`Document layers cannot contain symbolic links: ${path}`);
        if (entry.isDirectory()) visit(path);
        else if (entry.isFile() && path.endsWith(".md")) markdown.set(path, readFileSync(join(root, path), "utf8"));
        else if (entry.isFile() && entry.name === "properties.json") {
          sidecars.set(path, JSON.parse(readFileSync(join(root, path), "utf8")) as JsonValue);
        }
      }
    };
    visit("");
  }
  return { markdown, sidecars };
}

/** The builder supplies scenario/map policy; the real document service owns isolated writable state. */
export function createLayeredDocumentServices(roots: readonly string[], buildWorld: (layers: DocumentLayers) => WorldState) {
  return createScenarioServices(buildWorld(loadDocumentLayers(roots)));
}
