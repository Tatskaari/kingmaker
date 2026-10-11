import type { WorldState } from "../../contracts/src/v2.js";
import { compileConversationTree } from "../../lore/src/conversation-tree.js";

/** Grade committed source and bindings, never the reviewer's summary or baseline hooks. */
export function hookAuthoringEvidence(before: WorldState, after: WorldState) {
  const sources = Object.entries(after.docs).filter(([path, doc]) => /^Hooks\/[^/]+\.ts$/.test(path)
    && doc.body !== before.docs[path]?.body).map(([path]) => path);
  const bindings = Object.entries(after.docs).filter(([path]) => /^Conversations\/[^/]+\.md$/.test(path)).flatMap(([path, doc]) => {
    const tree = compileConversationTree({ body: doc.body, metadata: doc.frontmatter ?? {} });
    return Object.entries(tree.scripts).filter(([, name]) => sources.includes(`Hooks/${name}`))
      .map(([transitionId, name]) => ({ path, transitionId, source: `Hooks/${name}` }));
  });
  return { sources, bindings };
}
