import { clone, create, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { WorldStateSchema as MapSchema, type WorldState as MapState } from "../../contracts/src/index.js";
import { DocumentLinkSchema, DocumentSchema, WorldStateSchema, type WorldState } from "../../contracts/src/v2.js";
import { links, parseMarkdown, resolveLink } from "./markdown.js";

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

/** Validate and rebuild derived references in a privately owned draft before publishing it. */
export function refreshDocumentGraph(state: WorldState): WorldState {
  const notes = new Map(Object.entries(state.docs));
  for (const [label, path] of [["scenario entry", state.scenario], ["scenario index", state.scenarioIndex], ["player document", state.player]]) {
    if (path !== undefined && !notes.has(path)) throw new Error(`Missing ${label}: ${path}`);
  }
  for (const [name, doc] of notes) {
    if (name.startsWith("/") || name.includes("\\") || name.split("/").some(part => !part || part === "." || part === "..") || !name.endsWith(".md")) {
      throw new Error(`${name}: Expected a vault-relative Markdown path`);
    }
    try {
      doc.links = links(doc.body).flatMap(link => {
        const target = resolveLink(notes, name, link);
        return target ? [create(DocumentLinkSchema, { target, source: link.target })] : [];
      });
    } catch (error) {
      throw new Error(`${name}: ${String(error)}`, { cause: error });
    }
  }
  const prefix = state.scenario.slice(0, state.scenario.lastIndexOf("/") + 1) + "Characters/";
  state.characters = [...new Set(state.docs[state.scenario]!.links.map(link => link.target)
    .filter(target => target.startsWith(prefix) && /^[^/]+\/character\.md$/.test(target.slice(prefix.length))))];
  return state;
}
