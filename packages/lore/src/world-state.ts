import { clone, create, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { WorldStateSchema as MapSchema, type WorldState as MapState } from "../../contracts/src/index.js";
import { DocumentSchema, WorldStateSchema, type WorldState } from "../../contracts/src/v2.js";
import { parseMarkdown } from "./markdown.js";

import { DocumentGraph } from "./document-graph.js";

/** Build editable GM state without interpreting prose or recursively expanding context.
 * scenarioID is the existing directory name beneath Scenarios (e.g. Centennial Assembly).
 * Character entrypoints come from the selected scenario's direct Markdown links.
 */
export function worldState(map: MapState, markdown: ReadonlyMap<string, string>, scenarioID: string, player?: string): WorldState {
  if (!scenarioID || /[/\\]/.test(scenarioID) || scenarioID === "." || scenarioID === "..") {
    throw new Error("scenarioID must be a single scenario directory name");
  }
  const lore = new Map([...markdown].map(([name, source]) => [name, parseMarkdown(source)]));
  const scenario = `Scenarios/${scenarioID}/scenario.md`;
  const scenarioIndex = `Scenarios/${scenarioID}/index.md`;
  const docs = Object.fromEntries([...lore].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, note]) => {
    try {
      if (note.error) throw new Error(note.error);
      const doc = fromJson(DocumentSchema, { body: note.body, frontmatter: note.metadata as JsonObject });
      return [name, doc];
    } catch (error) {
      throw new Error(`${name}: ${String(error)}`, { cause: error });
    }
  }));
  return refreshDocumentGraph(create(WorldStateSchema, { docs, scenario, scenarioIndex, ...(player === undefined ? {} : { player }), map: clone(MapSchema, map) }));
}

/** Rebuild on initial load; live document services retain an incremental graph. */
export function refreshDocumentGraph(state: WorldState): WorldState {
  DocumentGraph.build(state);
  return state;
}
