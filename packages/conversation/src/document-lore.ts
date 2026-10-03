import type { ScenarioService } from "../../lore/src/services.js";
import { permitted } from "../../../scripts/lib/lore-access.js";
import type { LoreService } from "./services.js";

/** Character-scoped view of the authoritative GM document service. */
export async function documentLore(scenario: ScenarioService, characterId: string): Promise<LoreService> {
  const entry = scenario.info().characters.find(path => path.endsWith(`/Characters/${characterId}/character.md`));
  if (!entry) throw new Error(`Unknown scenario character: ${characterId}`);
  const allowed = (path: string, document: { body: string; frontmatter?: Record<string, unknown> | undefined }) => {
    if (!permitted(path, { body: document.body, metadata: document.frontmatter ?? {} }, entry, { character: characterId })) {
      throw new Error(`No read access: ${path}`);
    }
  };
  const read = async (path: string) => {
    const { document } = await scenario.getDocument(path);
    allowed(path, document);
    return { path, markdown: document.body };
  };
  const character = await scenario.getDocument(entry);
  const identity = character.document.links.find(link => /^Cast\/.+\/private\.md$/.test(link.target));
  if (!identity) throw new Error(`No private Cast reference in ${entry}`);
  return {
    initial: [await read(identity.target), await read(entry)],
    links(opened) {
      const state = scenario.snapshot();
      const seen = new Set(opened.map(doc => doc.path));
      return opened.flatMap(source => (state.docs[source.path]?.links ?? []).flatMap(link => {
        if (seen.has(link.target)) return [];
        const target = state.docs[link.target];
        if (!target) throw new Error(`Missing document: ${link.target}`);
        allowed(link.target, target);
        seen.add(link.target);
        return [{ from: source.path, path: link.target }];
      }));
    },
    async open(link, signal) { signal.throwIfAborted(); return read(link.path); },
  };
}
