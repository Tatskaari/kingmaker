import { create } from "@bufbuild/protobuf";
import { stringify } from "yaml";
import { DocumentSchema, type WorldState } from "../../contracts/src/v2.js";
import { runtimeActor } from "./runtime-actor.js";
import type { DocsService, ScenarioService } from "./service-types.js";

export const memoryIndexPath = (entry: string) => entry.slice(0, entry.lastIndexOf("/") + 1) + "memories/index.md";

/** Fresh characters get a private index; saved worlds retain their authored documents. */
export function seedMemories(world: WorldState, entry: string, characterId: string) {
  const path = memoryIndexPath(entry);
  if (world.docs[path]) return;
  world.docs[path] = create(DocumentSchema, { frontmatter: { visibility: "private", readers: [`character:${characterId}`],
    summary: `An index of ${characterId}'s saved memories and the context in which they were recorded.` }, body: "# Memories\n" });
  world.docs[entry] = { ...world.docs[entry]!, body: world.docs[entry]!.body + `\n[Memories](memories/index.md)\n` };
}

export interface MemoryInput { title: string; context: string; content: string }

/** Stage only the new memory and its index, then publish both through the document CAS boundary. */
export async function saveMemory(services: { docs: DocsService; scenario: ScenarioService }, characterId: string, input: MemoryInput) {
  for (const key of ["title", "context", "content"] as const) {
    if (typeof input[key] !== "string" || !input[key].trim()) throw new Error(`Memory requires ${key}.`);
  }
  if (Object.keys(input).some(key => !["title", "context", "content"].includes(key))) throw new Error("Unexpected memory argument.");
  const actor = runtimeActor(services.scenario.read(), characterId);
  const index = await services.docs.read(memoryIndexPath(actor.document));
  const readers = [`character:${actor.characterId}`];
  if (index.document.frontmatter?.visibility !== "private" || JSON.stringify(index.document.frontmatter.readers) !== JSON.stringify(readers)) {
    throw new Error("Memory index must be private to its character.");
  }
  const filename = `${crypto.randomUUID()}.md`, path = index.path.replace(/index\.md$/, filename);
  const title = input.title.trim(), context = input.context.trim();
  const metadata = { title, context, summary: `${title}: ${context}`, visibility: "private", readers };
  const escape = (text: string) => text.replace(/\s+/g, " ").replace(/[\\`*_{}\[\]()<>!|#]/g, "\\$&");
  await services.docs.commit([
    { path, expectedSha: null, text: `---\n${stringify(metadata)}---\n${input.content}\n` },
    { path: index.path, expectedSha: index.sha, text: `${index.text.trimEnd()}\n\n- [${escape(title)}](${filename}) — ${escape(context)}\n` },
  ]);
  return { path, index: index.path };
}
