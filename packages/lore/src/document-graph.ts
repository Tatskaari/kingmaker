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
        // Replace changed link lists without mutating documents shared with live state.
        const intent = [doc.frontmatter?.activity, doc.frontmatter?.wait,
          ...(Array.isArray(doc.frontmatter?.activities) ? doc.frontmatter.activities : [])]
          .filter(value => value !== undefined && value !== null);
        for (const path of intent) {
          if (typeof path !== "string" || !notes.has(path)) throw new Error(`Missing intent document: ${String(path)}`);
        }
        const nextLinks = [...intent.map(path => create(DocumentLinkSchema, { target: path as string, source: path as string })),
          ...resolved.map(link => create(DocumentLinkSchema, link))];
        if (doc.links.length !== nextLinks.length || doc.links.some((link, index) =>
          link.target !== nextLinks[index]!.target || link.source !== nextLinks[index]!.source)) {
          state.docs[name] = { ...doc, links: nextLinks };
        }
      } catch (error) {
        throw new Error(`${name}: ${String(error)}`, { cause: error });
      }
    }
    const prefix = state.scenario.slice(0, state.scenario.lastIndexOf("/") + 1) + "Characters/";
    state.characters = [...new Set(state.docs[state.scenario]!.links.map(link => link.target)
      .filter(target => target.startsWith(prefix) && /^[^/]+\/character\.md$/.test(target.slice(prefix.length))))];
    for (const actor of Object.values(state.runtimeCharacters)) for (const path of [actor.document, actor.activity, actor.wait]) {
      if (path !== undefined && !notes.has(path)) throw new Error(`Missing intent document: ${path}`);
    }
    return new DocumentGraph(sources);
  }
}
