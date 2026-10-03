import { create } from "@bufbuild/protobuf";
import { DocumentLinkSchema, type WorldState } from "../../contracts/src/v2.js";
import { links, resolveLink } from "./markdown.js";

type Source = {
  body: string;
  references: ReturnType<typeof links>;
  resolved: { target: string; source: string }[];
};

/** Immutable parse/resolution cache. Failed drafts never change the published graph. */
export class DocumentGraph {
  private constructor(private readonly sources: ReadonlyMap<string, Source>) {}
  static build(state: WorldState): DocumentGraph { return new DocumentGraph(new Map()).update(state); }

  /** Populate a privately owned draft; parse only bodies that changed. */
  update(state: WorldState): DocumentGraph {
    const notes = new Map(Object.entries(state.docs));
    for (const [label, path] of [["scenario entry", state.scenario], ["scenario index", state.scenarioIndex], ["player document", state.player]]) {
      if (path !== undefined && !notes.has(path)) throw new Error(`Missing ${label}: ${path}`);
    }
    // Adding/removing a name can redirect or make shorthand links ambiguous.
    // Re-resolve cached references in that case; do not reparse unchanged Markdown.
    const namesChanged = notes.size !== this.sources.size || [...notes.keys()].some(path => !this.sources.has(path));
    const sources = new Map<string, Source>();
    for (const [name, doc] of notes) {
      if (name.startsWith("/") || name.includes("\\") || name.split("/").some(part => !part || part === "." || part === "..") || !name.endsWith(".md")) {
        throw new Error(`${name}: Expected a vault-relative Markdown path`);
      }
      try {
        const previous = this.sources.get(name);
        const bodyChanged = previous?.body !== doc.body;
        const references = bodyChanged ? links(doc.body) : previous!.references;
        const resolved = namesChanged || bodyChanged ? references.flatMap(link => {
          const target = resolveLink(notes, name, link);
          return target ? [{ target, source: link.target }] : [];
        }) : previous!.resolved;
        sources.set(name, { body: doc.body, references, resolved });
        // Keep published documents detached from the cache and other drafts.
        doc.links = resolved.map(link => create(DocumentLinkSchema, link));
      } catch (error) {
        throw new Error(`${name}: ${String(error)}`, { cause: error });
      }
    }
    const prefix = state.scenario.slice(0, state.scenario.lastIndexOf("/") + 1) + "Characters/";
    state.characters = [...new Set(state.docs[state.scenario]!.links.map(link => link.target)
      .filter(target => target.startsWith(prefix) && /^[^/]+\/character\.md$/.test(target.slice(prefix.length))))];
    return new DocumentGraph(sources);
  }
}
