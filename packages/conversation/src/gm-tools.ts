import { callMemoryTool, memoryTool } from "./memory-tool.js";
import { InventoryConflictError } from "../../core/src/inventory-service.js";
import { renderPrompt } from "../../prompts/src/index.js";
import { fromJsonString } from "@bufbuild/protobuf";
import { InventorySchema } from "../../contracts/src/index.js";

import { documentTools, callDocumentTool } from "./document-tools.js";
import type { OpenRouterTool } from "../../providers/src/openrouter.js";
import type { RuntimeServices, DocumentUpdate } from "./services.js";
import { ActivityEdits, activityTools } from "./activity-tools.js";
import { characterIntent } from "../../lore/src/activity.js";
import { DocumentConflictError, type DocumentSnapshot } from "../../lore/src/services.js";

export class InvalidReviewError extends Error {}

const text = { type: "string" };
function tool(name: string, description: string, properties: Record<string, unknown>, required = Object.keys(properties)): OpenRouterTool {
  return { type: "function", function: { name, description, parameters: { type: "object", additionalProperties: false, properties, required } } };
}
export const gameMasterTools: OpenRouterTool[] = [
  tool("list_documents", renderPrompt("gm-tools-list-documents"), { prefix: text, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, []),
  tool("list_characters", renderPrompt("gm-tools-list-characters"), {}),
  tool("read_inventory", "Read a runtime character inventory and its version before updating it. Use the runtime actor ID, including player.", { actorId: text }),
  tool("update_inventories", "Commit actual typed possessions for gifts, trades, additions or removals. Call read_inventory for each runtime actor first and use its SHA. Supply each complete inventory as JSON (items and equipment), preserving unrelated items. New narrative props need a unique id, name, details and quantity; do not invent mechanical definitionIds. Include both owners in one call for a transfer. Memory or presentation prose alone does not transfer an item.", {
    changes: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false,
      required: ["actorId", "expectedSha", "inventoryJson"], properties: { actorId: text, expectedSha: text, inventoryJson: text } } },
  }),

  memoryTool,
  ...documentTools,
  ...activityTools.map(item => ({ ...item, function: { ...item.function,
    parameters: { ...item.function.parameters, properties: { ...(item.function.parameters as { properties: object }).properties,
      characterId: { type: "string", description: renderPrompt("gm-tools-target-character") } } },
  } })),

];

/** One tool surface for GM reviews and rulings. Documents have world-wide access; NPC knowledge remains scoped. */
export class GameMasterTools {
  pending = false;
  private edits = new Map<string, { before: DocumentSnapshot; activity: ActivityEdits; trace?: Pick<DocumentUpdate, "response" | "toolCallId"> }>();
  constructor(private services: RuntimeServices, private characterId?: string) {
    if (characterId) this.characterId = characterIntent(services.scenario.read(), characterId).actorId;
  }
  private async target(id: string) {
    id = characterIntent(this.services.scenario.read(), id).actorId;
    if (!this.edits.has(id)) {
      const before = await this.services.docs.read(characterIntent(this.services.scenario.read(), id).entry);
      this.edits.set(id, { before, activity: new ActivityEdits(this.services, id, before) });
    }
    return this.edits.get(id)!;
  }
  async begin() {
    if (this.characterId) {
      this.characterId = characterIntent(this.services.scenario.read(), this.characterId).actorId;
      await this.target(this.characterId);
    }
  }
  async call(name: string, input: Record<string, unknown>, trace?: Pick<DocumentUpdate, "response" | "toolCallId">) {
    const string = (key: string) => { if (typeof input[key] !== "string") throw new Error(`Expected ${key}.`); return input[key] as string; };
    const docs = this.services.docs;
    if (name === "save_memory") return callMemoryTool(this.services, this.characterId, input, trace);
    if (name === "read_inventory") return this.services.inventory.read(string("actorId"));
    if (name === "update_inventories") {
      if (!Array.isArray(input.changes) || !input.changes.length) throw new InvalidReviewError("Supply inventory changes");
      const changes = input.changes.map(value => {
        if (!value || typeof value.actorId !== "string" || typeof value.expectedSha !== "string" || typeof value.inventoryJson !== "string") throw new InvalidReviewError("Invalid inventory change");
        try { return { actorId: value.actorId as string, expectedSha: value.expectedSha as string, inventory: fromJsonString(InventorySchema, value.inventoryJson) }; }
        catch { throw new InvalidReviewError("inventoryJson must be a valid inventory object"); }
      });
      try {
        await this.services.inventory.commit(changes);
        return { ok: true, current: await Promise.all(changes.map(change => this.services.inventory.read(change.actorId))) };
      } catch (error) {
        if (!(error instanceof InventoryConflictError)) throw error;
        return { ok: false, error: "inventory_conflict", current: await this.services.inventory.read(error.actorId),
          instruction: "Read the current inventories and retry without overwriting unrelated changes." };
      }
    }
    if (name === "list_characters") return { characters: Object.values(this.services.scenario.read().simulation!.runtimeCharacters)
      .filter(character => character.characterId !== "player").map(({ id, characterId, document, activity, wait }) =>
        ({ id, characterId, document, activity: activity ?? null, wait: wait ?? null })) };
    if (name === "list_documents") {
      const prefix = input.prefix === undefined ? "" : string("prefix"), offset = input.offset ?? 0, limit = input.limit ?? 25;
      if (!Number.isInteger(offset) || Number(offset) < 0 || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50) throw new Error("Invalid document pagination.");
      const entries = Object.entries(this.services.scenario.read().docs).filter(([path]) => path.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b));
      const end = Number(offset) + Number(limit);
      return { documents: entries.slice(Number(offset), end).map(([path, doc]) => ({ path, summary: doc.frontmatter?.summary ?? "" })),
        total: entries.length, nextOffset: end < entries.length ? end : null };
    }
    if (documentTools.some(tool => tool.function.name === name)) {
      const before = trace && name !== "read_document" && typeof input.path === "string" && this.services.scenario.read().docs[input.path]
        ? await docs.read(input.path) : undefined;
      const result = await callDocumentTool(docs, name, input);
      if ("current" in result && result.current) {
        for (const [, edit] of this.edits) if (edit.before.path === result.current.path) {
          edit.before = result.current; edit.activity.refreshDocument(result.current);
        }
      }
      if (trace && result.ok && name !== "read_document") this.services.debug.documentUpdated?.({
        path: String(input.path), beforeSha: typeof input.expectedSha === "string" ? input.expectedSha : "",
        beforeText: before?.text ?? "", afterText: "current" in result && result.current ? result.current.text : "",
        afterSha: "current" in result && result.current ? result.current.sha : "", ...trace });
      return result;
    }
    if (activityTools.some(tool => tool.function.name === name)) {
      const id = input.characterId === undefined ? this.characterId : string("characterId");
      if (!id) throw new Error("Supply characterId for the target NPC.");
      const edit = await this.target(id);
      const result = await edit.activity.call(name, input);
      if (trace) edit.trace = trace;
      this.pending = true;
      await this.commit();
      return { ...result, staged: false, committed: true };
    }
    throw new InvalidReviewError(`Unknown GM tool: ${name}`);
  }
  /** Publish each validated activity call before the GM continues; memory saves and document edits commit directly. */
  async commit() {
    if (!this.pending) return;
    const changes = [...this.edits.values()].filter(edit => edit.activity.pending)
      .map(({ before, activity }) => activity.changes(before.document.body));
    const writes = new Map(changes.flatMap(change => change.writes).map(write => [write.path, write]));
    if (writes.size) await this.services.docs.commit([...writes.values()], changes.flatMap(change => change.intents));
    for (const { before, trace, activity } of this.edits.values()) {
      if (!activity.pending) continue;
      const after = await this.services.docs.read(before.path);
      if (trace) this.services.debug.documentUpdated?.({ path: before.path, beforeSha: before.sha, afterSha: after.sha, beforeText: before.text, afterText: after.text, ...trace });
    }
    this.edits.clear();
    this.pending = false;
  }
  async conflict(error: DocumentConflictError) {
    this.edits.clear();
    this.pending = false;
    await this.begin();
    return { ok: false, error: "document_conflict", current: await this.services.docs.read(error.path),
      instruction: renderPrompt("gm-tools-conflict") };
  }
}
