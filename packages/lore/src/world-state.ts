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
  if (!lore.has(scenario)) throw new Error(`Missing scenario entry: ${scenario}`);
  const scenarioIndex = `Scenarios/${scenarioID}/index.md`;
  if (!lore.has(scenarioIndex)) throw new Error(`Missing scenario index: ${scenarioIndex}`);
  if (player !== undefined && !lore.has(player)) throw new Error(`Missing player document: ${player}`);
  const docs = Object.fromEntries([...lore].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, note]) => {
    try {
      if (name.startsWith("/") || name.includes("\\") || name.split("/").some(part => !part || part === "." || part === "..") || !name.endsWith(".md")) {
        throw new Error("Expected a vault-relative Markdown path");
      }
      if (note.error) throw new Error(note.error);
      const doc = fromJson(DocumentSchema, { body: note.body, frontmatter: note.metadata as JsonObject });
      doc.links = links(note.body).flatMap(link => {
        const target = resolveLink(lore, name, link);
        return target ? [create(DocumentLinkSchema, { target, source: link.target })] : [];
      });
      return [name, doc];
    } catch (error) {
      throw new Error(`${name}: ${String(error)}`, { cause: error });
    }
  }));
  const prefix = `Scenarios/${scenarioID}/Characters/`;
  const characters = [...new Set(docs[scenario]!.links.map(link => link.target)
    .filter(target => target.startsWith(prefix) && /^[^/]+\/character\.md$/.test(target.slice(prefix.length))))];
  return create(WorldStateSchema, { docs, characters, scenario, scenarioIndex, ...(player === undefined ? {} : { player }), map: clone(MapSchema, map) });
}
