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
  tool("update_inventories", "Commit actual typed possessions for gifts, trades, additions or removals. Read each owner document first and use its SHA. Supply each complete inventory as JSON (items and equipment), preserving unrelated items. New narrative props need a unique id, name, details and quantity; do not invent mechanical definitionIds. Include both owners in one call for a transfer. Memory or presentation prose alone does not transfer an item.", {
    changes: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false,
      required: ["path", "expectedSha", "inventoryJson"], properties: { path: text, expectedSha: text, inventoryJson: text } } },
  }),

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
      for (const [, edit] of this.edits) {
        const updated = current.find(item => item.path === edit.before.path);
        if (updated) { edit.before = updated; edit.activity.refreshDocument(updated); }
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
      if ("current" in result && result.current) {
        for (const [, edit] of this.edits) if (edit.before.path === result.current.path) {
          edit.before = result.current; edit.activity.refreshDocument(result.current);
        }
      }
      if (trace && result.ok && name !== "read_document") this.services.debug.documentUpdated?.({
        path: String(input.path), beforeSha: typeof input.expectedSha === "string" ? input.expectedSha : "",
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
      return result;
    }
    throw new InvalidReviewError(`Unknown GM tool: ${name}`);
  }
  /** Host-only finalization. Memories are written exclusively through document tools. */
  async commit() {
    if (!this.pending) return;
    const changes = [...this.edits.values()].filter(edit => edit.activity.pending)
      .map(({ before, activity }) => activity.changes(before.document.body));
    const writes = new Map(changes.flatMap(change => change.writes).map(write => [write.path, write]));
    if (writes.size) await this.services.docs.commit([...writes.values()], changes.flatMap(change => change.intents));
    for (const { before, trace, activity } of this.edits.values()) {
      if (!activity.pending) continue;
      const after = await this.services.docs.read(before.path);
      if (trace) this.services.debug.documentUpdated?.({ path: before.path, beforeSha: before.sha, afterSha: after.sha, ...trace });
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
