import type { WorldState } from "../../contracts/src/v2.js";
import type { CompiledHook } from "../../hooks/src/compiler.js";
import { compileConversationTree } from "./conversation-tree.js";
import { DocumentValidationError } from "./document-audit.js";

/** Validate the whole draft's references, including deletion of previously bound source. */
export function validateHookBindings(world: WorldState, hooks: ReadonlyMap<string, CompiledHook>): void {
  for (const [path, doc] of Object.entries(world.docs)) {
    if (!/^Conversations\/[^/]+\.md$/.test(path)) continue;
    try {
      const tree = compileConversationTree({ body: doc.body, metadata: doc.frontmatter ?? {} });
      for (const name of Object.values(tree.scripts)) if (!hooks.has(name)) throw new Error(`Missing hook document: Hooks/${name}`);
    } catch (error) { throw new DocumentValidationError([{ kind: "invalid", trail: [path], detail: String(error) }]); }
  }
}
