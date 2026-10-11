import { create } from "@bufbuild/protobuf";
import { DocumentSchema } from "../../contracts/src/v2.js";
import { memoryIndexPath } from "./memories.js";
import type { WorldStore } from "./world-store.js";
import type { HookBroadcast } from "../../hooks/src/services.js";

/** One durable milestone, private memory per entry, and a GM-only review job. */
export function broadcastMemory(store: WorldStore, id: string, input: HookBroadcast, guard: () => void) {
  return store.write(async () => {
    guard();
    if (!/^[a-z][a-z0-9-]*$/.test(id) || id.length > 100) throw new Error("Invalid broadcast ID");
    for (const key of ["title", "context", "content", "review"] as const) {
      if (typeof input[key] !== "string" || !input[key].trim()) throw new Error(`Broadcast requires ${key}`);
    }
    const path = `Reviews/${id}.md`;
    if (store.state.docs[path]) return;
    const docs = { ...store.state.docs }, actors = Object.values(store.state.simulation!.runtimeCharacters);
    for (const actor of actors) {
      const indexPath = memoryIndexPath(actor.document), memory = indexPath.replace("index.md", `${id}.md`);
      if (docs[memory]) continue;
      const index = docs[indexPath];
      if (!index) throw new Error(`Missing memory index: ${indexPath}`);
      docs[memory] = create(DocumentSchema, { frontmatter: { visibility: "private", readers: index.frontmatter!.readers!,
        title: input.title, context: input.context, summary: input.content }, body: input.content });
      docs[indexPath] = { ...index, body: index.body.trimEnd() + `\n\n- [${id}](${id}.md) — ${input.context.replace(/[\r\n\[\]]/g, " ")}\n` };
    }
    docs[path] = create(DocumentSchema, { frontmatter: { visibility: "gm", summary: input.context,
      pending: actors.filter(actor => actor.characterId !== "player").map(actor => actor.id) }, body: input.review });
    store.publishDocuments({ ...store.state, docs });
  });
}
