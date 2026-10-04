import { documentTools, callDocumentTool } from "./document-tools.js";
import type { OpenRouterTool } from "../../providers/src/openrouter.js";
import type { RuntimeServices, DocumentUpdate } from "./services.js";
import { ActivityEdits, activityTools } from "./activity-tools.js";
import { characterEntry } from "../../lore/src/active-goal.js";
import { DocumentConflictError, type DocumentSnapshot } from "../../lore/src/services.js";
import { links } from "../../lore/src/markdown.js";

const text = { type: "string" };
function tool(name: string, description: string, properties: Record<string, unknown>, required = Object.keys(properties)): OpenRouterTool {
  return { type: "function", function: { name, description, parameters: { type: "object", additionalProperties: false, properties, required } } };
}
export const gameMasterTools: OpenRouterTool[] = [
  tool("list_documents", "List world documents, including every character and GM quest note. Use prefix to narrow paths and nextOffset to page. Read relevant documents before editing.", { prefix: text, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, []),
  ...documentTools,
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
  async call(name: string, input: Record<string, unknown>, trace?: Pick<DocumentUpdate, "response" | "toolCallId">) {
    const string = (key: string) => { if (typeof input[key] !== "string") throw new Error(`Expected ${key}.`); return input[key] as string; };
    const docs = this.services.docs;
    if (name === "list_documents") {
      const prefix = input.prefix === undefined ? "" : string("prefix"), offset = input.offset ?? 0, limit = input.limit ?? 25;
      if (!Number.isInteger(offset) || Number(offset) < 0 || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50) throw new Error("Invalid document pagination.");
      const entries = Object.entries(this.services.scenario.snapshot().docs).filter(([path]) => path.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b));
      const end = Number(offset) + Number(limit);
      return { documents: entries.slice(Number(offset), end).map(([path, doc]) => ({ path, summary: doc.frontmatter?.summary ?? "" })),
        total: entries.length, nextOffset: end < entries.length ? end : null };
    }
    if (documentTools.some(tool => tool.function.name === name)) {
      const result = await callDocumentTool(docs, name, input);
      if (!this.pending && "current" in result && result.current) {
        for (const [id, edit] of this.edits) if (edit.before.path === result.current.path) {
          this.edits.set(id, { before: result.current, activity: new ActivityEdits(this.services, id, result.current) });
        }
      }
      return result;
    }
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
    if (notes.length && this.characterId) await this.target(this.characterId);
    const writes = [...this.edits].flatMap(([id, { before, activity }]) => {
      const additions = id === this.characterId ? [...new Set<string>(notes)].map(note => note.trim().replace(/[\\`*_[\]<>#]/g, "\\$&"))
        .filter(note => !before.document.body.includes(note)) : [];
      return activity.changes(before.document.body + (additions.length ? `\n\n## Conversation review\n${additions.map(note => `- ${note}`).join("\n")}\n` : ""));
    });
    if (writes.length) await docs.commit(writes);
    for (const { before } of this.edits.values()) {
      const after = await docs.read(before.path);
      if (trace) this.services.debug.documentUpdated?.({ path: before.path, beforeSha: before.sha, afterSha: after.sha, ...trace });
    }
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
