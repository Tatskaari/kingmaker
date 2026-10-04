import { renderPrompt } from "../../prompts/src/index.js";
import { fromJsonString } from "@bufbuild/protobuf";
import { InventorySchema } from "../../contracts/src/index.js";

import { documentTools, callDocumentTool } from "./document-tools.js";
import type { OpenRouterTool } from "../../providers/src/openrouter.js";
import type { RuntimeServices, DocumentUpdate } from "./services.js";
import { ActivityEdits, activityTools } from "./activity-tools.js";
import { characterIntent } from "../../lore/src/activity.js";
import { DocumentConflictError, type DocumentSnapshot } from "../../lore/src/services.js";
import { links } from "../../lore/src/markdown.js";

export class InvalidReviewError extends Error {}

const text = { type: "string" };
function tool(name: string, description: string, properties: Record<string, unknown>, required = Object.keys(properties)): OpenRouterTool {
  return { type: "function", function: { name, description, parameters: { type: "object", additionalProperties: false, properties, required } } };
}
export const gameMasterTools: OpenRouterTool[] = [
  tool("list_documents", renderPrompt("gm-tools-list-documents"), { prefix: text, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, []),
  tool("list_characters", renderPrompt("gm-tools-list-characters"), {}),
  tool("update_inventories", "Commit actual typed possessions for gifts, trades, additions or removals. Read each owner document first and use its SHA. Supply each complete inventory as JSON (items and equipment), preserving unrelated items. New narrative props need a unique id, name, details and quantity; do not invent mechanical definitionIds. Include both owners in one call for a transfer. Memory or presentation prose alone does not transfer an item.", {
    changes: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false,
      required: ["path", "expectedSha", "inventoryJson"], properties: { path: text, expectedSha: text, inventoryJson: text } } },
  }),

  ...documentTools,
  ...activityTools.map(item => ({ ...item, function: { ...item.function,
    parameters: { ...item.function.parameters, properties: { ...(item.function.parameters as { properties: object }).properties,
      characterId: { type: "string", description: renderPrompt("gm-tools-target-character") } } },
  } })),
  tool("commit_review", renderPrompt("gm-tools-commit-review"), {
    summary: text, newNotes: { type: "array", items: text },
  }),
];

/** One tool surface for GM reviews and rulings. Documents have world-wide access; NPC knowledge remains scoped. */
export class GameMasterTools {
  pending = false;
  private edits = new Map<string, { before: DocumentSnapshot; activity: ActivityEdits }>();
  constructor(private services: RuntimeServices, private characterId?: string) {
    if (characterId) this.characterId = characterIntent(services.scenario.snapshot(), characterId).actorId;
  }
  private async target(id: string) {
    id = characterIntent(this.services.scenario.snapshot(), id).actorId;
    if (!this.edits.has(id)) {
      const before = await this.services.docs.read(characterIntent(this.services.scenario.snapshot(), id).entry);
      this.edits.set(id, { before, activity: new ActivityEdits(this.services, id, before) });
    }
    return this.edits.get(id)!;
  }
  async begin() {
    if (this.characterId) {
      this.characterId = characterIntent(this.services.scenario.snapshot(), this.characterId).actorId;
      await this.target(this.characterId);
    }
  }
  async call(name: string, input: Record<string, unknown>, trace?: Pick<DocumentUpdate, "response" | "toolCallId">) {
    const string = (key: string) => { if (typeof input[key] !== "string") throw new Error(`Expected ${key}.`); return input[key] as string; };
    const docs = this.services.docs;
    if (name === "update_inventories") {
      if (!Array.isArray(input.changes) || !input.changes.length) throw new InvalidReviewError("Supply inventory changes");
      const changes = input.changes.map(value => {
        if (!value || typeof value.path !== "string" || typeof value.expectedSha !== "string" || typeof value.inventoryJson !== "string") throw new InvalidReviewError("Invalid inventory change");
        try { return { path: value.path as string, expectedSha: value.expectedSha as string, inventory: fromJsonString(InventorySchema, value.inventoryJson) }; }
        catch { throw new InvalidReviewError("inventoryJson must be a valid inventory object"); }
      });
      await this.services.inventory.commit(changes);
      const current = await Promise.all(changes.map(change => docs.read(change.path)));
      if (!this.pending) for (const [id, edit] of this.edits) {
        const updated = current.find(item => item.path === edit.before.path);
        if (updated) this.edits.set(id, { before: updated, activity: new ActivityEdits(this.services, id, updated) });
      }
      return { ok: true, current };
    }
    if (name === "list_characters") return { characters: Object.values(this.services.scenario.snapshot().runtimeCharacters)
      .filter(character => character.characterId !== "player").map(({ id, characterId, document, activity, wait }) =>
        ({ id, characterId, document, activity: activity ?? null, wait: wait ?? null })) };
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
    const summary = input.summary, notes = input.newNotes;
    if (typeof summary !== "string" || !summary.trim() || !Array.isArray(notes) || !notes.every(note => typeof note === "string" && note.trim())
      || Object.keys(input).some(key => !["summary", "newNotes"].includes(key))) throw new InvalidReviewError("commit_review requires only a nonempty summary and newNotes (an array of prose strings). Do not include characterId: memory belongs to the reviewed NPC.");
    if (notes.some(note => links(note).length)) throw new Error("Review notes must be plain prose without document links.");
    if (notes.length && !this.characterId) throw new Error("No reviewed NPC: use document tools for memories.");
    if (notes.length && this.characterId) await this.target(this.characterId);
    const changes = [...this.edits].sort(([a], [b]) => Number(a === this.characterId) - Number(b === this.characterId)).map(([id, { before, activity }]) => {
      const additions = id === this.characterId ? [...new Set<string>(notes)].map(note => note.trim().replace(/[\\`*_[\]<>#]/g, "\\$&"))
        .filter(note => !before.document.body.includes(note)) : [];
      return activity.changes(before.document.body + (additions.length ? renderPrompt("gm-tools-memory", { notes: additions.map(note => `- ${note}`).join("\n") }) : ""));
    });
    const writes = new Map(changes.flatMap(change => change.writes).map(write => [write.path, write]));
    if (writes.size) await docs.commit([...writes.values()], changes.flatMap(change => change.intents));
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
      instruction: renderPrompt("gm-tools-conflict") };
  }
}
