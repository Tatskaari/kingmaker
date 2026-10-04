import type { OpenRouterTool } from "../../providers/src/openrouter.js";
import type { RuntimeServices } from "./services.js";
import { ActivityEdits, activityTools } from "./activity-tools.js";
import { characterEntry } from "../../lore/src/active-goal.js";
import { DocumentConflictError, type DocumentSnapshot } from "../../lore/src/services.js";
import { links } from "../../lore/src/markdown.js";

const text = { type: "string" };
function tool(name: string, description: string, properties: Record<string, unknown>, required = Object.keys(properties)): OpenRouterTool {
  return { type: "function", function: { name, description, parameters: { type: "object", additionalProperties: false, properties, required } } };
}
export const gameMasterTools: OpenRouterTool[] = [
  tool("list_documents", "List all world documents, including every character and GM quest note. Read relevant documents before editing.", {}),
  tool("read_document", "Read canonical Markdown and SHA for any world document. GM access does not grant that knowledge to an NPC.", { path: text }),
  tool("create_document", "Create a document immediately. Include summary and correct visibility/readers in YAML. Keep authored links valid.", { path: text, text }),
  tool("replace_document", "Immediately replace one exact, unique substring. Supply the SHA from read_document. Use the whole text to rewrite a document.", { path: text, sha: text, oldText: text, newText: text }),
  tool("insert_document", "Immediately insert Markdown after a 1-based line (0 = beginning), using the SHA from read_document.", { path: text, sha: text, afterLine: { type: "integer", minimum: 0 }, text }),
  tool("delete_document", "Immediately delete a document using its SHA. Required entrypoints and referenced documents must remain valid.", { path: text, sha: text }),
  ...activityTools.map(item => ({ ...item, function: { ...item.function,
    parameters: { ...item.function.parameters, properties: { ...(item.function.parameters as { properties: object }).properties,
      characterId: { type: "string", description: "Target NPC. Defaults to the character being reviewed; may name any NPC." } } },
  } })),
  tool("commit_review", "Atomically publish staged activities/waits and append newNotes to the reviewed NPC's memory. Finish a review with this tool. Direct document edits are already saved. On conflict restage discarded intent edits. Notes must be plain prose without Markdown links.", {
    summary: text, newNotes: { type: "array", items: text },
  }),
];

/** One tool surface for GM reviews and rulings. Documents have world-wide access; NPC knowledge remains scoped. */
export class GameMasterTools {
  pending = false;
  private edits = new Map<string, { before: DocumentSnapshot; activity: ActivityEdits }>();
  constructor(private services: RuntimeServices, private characterId?: string) {}
  private async target(id: string) {
    if (!this.edits.has(id)) {
      const before = await this.services.docs.read(characterEntry(this.services.scenario.info(), id));
      this.edits.set(id, { before, activity: new ActivityEdits(this.services, id, before) });
    }
    return this.edits.get(id)!;
  }
  async begin() { if (this.characterId) await this.target(this.characterId); }
  async call(name: string, input: Record<string, unknown>) {
    const string = (key: string) => { if (typeof input[key] !== "string") throw new Error(`Expected ${key}.`); return input[key] as string; };
    const docs = this.services.docs;
    if (name === "list_documents") return Object.entries(this.services.scenario.snapshot().docs).map(([path, doc]) => ({ path, summary: doc.frontmatter?.summary ?? "" }));
    if (name === "read_document") return docs.read(string("path"));
    if (name === "create_document") return docs.create(string("path"), string("text"));
    if (name === "replace_document") return docs.replace(string("path"), string("sha"), string("oldText"), string("newText"));
    if (name === "insert_document") {
      if (!Number.isInteger(input.afterLine)) throw new Error("Expected integer afterLine.");
      return docs.insert(string("path"), string("sha"), input.afterLine as number, string("text"));
    }
    if (name === "delete_document") { await docs.delete(string("path"), string("sha")); return { deleted: true }; }
    if (name !== "commit_review") {
      const id = input.characterId === undefined ? this.characterId : string("characterId");
      if (!id) throw new Error("Supply characterId for the target NPC.");
      const result = await (await this.target(id)).activity.call(name, input);
      this.pending = true;
      return result;
    }
    const summary = string("summary"), notes = input.newNotes;
    if (!summary.trim() || !Array.isArray(notes) || !notes.every(note => typeof note === "string" && note.trim())
      || Object.keys(input).some(key => !["summary", "newNotes"].includes(key))) throw new Error("Invalid document review result.");
    if (notes.some(note => links(note).length)) throw new Error("Review notes must be plain prose without document links.");
    if (notes.length && !this.characterId) throw new Error("No reviewed NPC: use document tools for memories.");
    const writes = [...this.edits].flatMap(([id, { before, activity }]) => {
      const additions = id === this.characterId ? [...new Set<string>(notes)].map(note => note.trim().replace(/[\\`*_[\]<>#]/g, "\\$&"))
        .filter(note => !before.document.body.includes(note)) : [];
      return activity.changes(before.document.body + (additions.length ? `\n\n## Conversation review\n${additions.map(note => `- ${note}`).join("\n")}\n` : ""));
    });
    if (writes.length) await docs.commit(writes);
    this.edits.clear();
    this.pending = false;
    return { committed: true, summary };
  }
  async conflict(error: DocumentConflictError) {
    this.edits.clear();
    this.pending = false;
    await this.begin();
    return { ok: false, error: "document_conflict", current: await this.services.docs.read(error.path),
      instruction: "This call wrote nothing. Earlier direct document edits remain saved. Staged intent edits were discarded; reconcile with current documents and restage before commit_review." };
  }
}
