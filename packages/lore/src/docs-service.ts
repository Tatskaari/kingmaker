import { clone, fromJson, toJson, type JsonObject } from "@bufbuild/protobuf";
import { DocumentSchema, WorldStateSchema, type Document } from "../../contracts/src/v2.js";
import { parseMarkdown } from "./markdown.js";
import { canonical, snapshot } from "./document-snapshot.js";
import { DocumentConflictError, type DocsService, type DocumentSnapshot } from "./service-types.js";
import { runtimeActor } from "./runtime-actor.js";
import { activityDefinition, intentDocument, waitActivities } from "./activity.js";
import type { WorldStore } from "./world-store.js";

export function createDocsService(store: WorldStore): DocsService {
  function document(path: string): Document {
    if (!Object.hasOwn(store.state.docs, path)) throw new Error(`${path}: document not found`);
    return clone(DocumentSchema, store.state.docs[path]!);
  }
  async function read(path: string): Promise<DocumentSnapshot> { return snapshot(path, document(path)); }
  async function checked(path: string, expectedSha: string): Promise<DocumentSnapshot> {
    const current = await read(path);
    if (current.sha !== expectedSha) throw new DocumentConflictError(path, expectedSha, current.sha);
    return current;
  }
  async function publish(path: string, text: string, expected?: DocumentSnapshot): Promise<DocumentSnapshot> {
    const note = parseMarkdown(text);
    if (note.error) throw new Error(`${path}: ${note.error}`);
    const draft = clone(WorldStateSchema, store.state);
    const next = fromJson(DocumentSchema, { body: note.body, frontmatter: note.metadata as JsonObject });
    next.characterProperties = draft.docs[path]?.characterProperties;
    draft.docs[path] = next;
    const graph = store.prepareDocuments(draft);
    const result = await snapshot(path, clone(DocumentSchema, draft.docs[path]!));
    // Only this document participates in the write. Map interactions can proceed
    // while hashing; merge into the current world rather than publishing the draft.
    const live = store.state.docs[path];
    if (JSON.stringify(canonical(live && toJson(DocumentSchema, live))) !== JSON.stringify(canonical(expected && toJson(DocumentSchema, expected.document)))) {
      const actual = live ? (await read(path)).sha : "deleted";
      throw new DocumentConflictError(path, expected?.sha ?? "absent", actual);
    }
    const current = clone(WorldStateSchema, store.state);
    current.docs[path] = next;
    store.publishDocuments(current, graph);
    return result;
  }
  const docs: DocsService = {
    async commit(changes, intents = []) {
      return store.write(async () => {
        if (new Set(changes.map(change => change.path)).size !== changes.length) throw new Error("Duplicate document write.");
        const expected = new Map<string, Document | undefined>();
        for (const change of changes) {
          if (change.expectedSha === null) {
            if (store.state.docs[change.path]) throw new DocumentConflictError(change.path, "absent", (await read(change.path)).sha);
            expected.set(change.path, undefined);
          } else expected.set(change.path, (await checked(change.path, change.expectedSha)).document);
        }
        const draft = clone(WorldStateSchema, store.state);
        for (const change of changes) {
          if (JSON.stringify(canonical(store.state.docs[change.path])) !== JSON.stringify(canonical(expected.get(change.path)))) {
            throw new DocumentConflictError(change.path, change.expectedSha ?? "absent", "changed");
          }
          const note = parseMarkdown(change.text);
          if (note.error) throw new Error(`${change.path}: ${note.error}`);
          const next = fromJson(DocumentSchema, { body: note.body, frontmatter: note.metadata as JsonObject });
          next.characterProperties = draft.docs[change.path]?.characterProperties;
          draft.docs[change.path] = next;
        }
        if (new Set(intents.map(intent => intent.actorId)).size !== intents.length) throw new Error("Duplicate intent write.");
        for (const intent of intents) {
          const actor = runtimeActor(draft, intent.actorId);
          if (actor.intentRevision !== intent.expectedRevision) {
            const entry = draft.characters.find(path => path.endsWith(`/Characters/${actor.characterId}/character.md`))!;
            throw new DocumentConflictError(entry, String(intent.expectedRevision), String(actor.intentRevision));
          }
          if (intent.activity) activityDefinition(intentDocument(draft, actor.characterId, intent.activity));
          if (intent.wait) for (const path of waitActivities(intentDocument(draft, actor.characterId, intent.wait))) {
            activityDefinition(intentDocument(draft, actor.characterId, path));
          }
          actor.activity = intent.activity ?? undefined;
          actor.wait = intent.wait ?? undefined;
          actor.intentRevision++;
        }
        store.publishDocuments(draft);
      });
    },
    read,
    create: (path, text) => store.write(async () => {
      if (Object.hasOwn(store.state.docs, path)) throw new Error(`${path}: document already exists`);
      return publish(path, text);
    }),
    replace: (path, sha, oldText, newText) => store.write(async () => {
      const current = await checked(path, sha);
      const offset = current.text.indexOf(oldText);
      if (!oldText || offset < 0 || current.text.indexOf(oldText, offset + 1) >= 0) throw new Error(`${path}: oldText must match exactly once`);
      return publish(path, current.text.slice(0, offset) + newText + current.text.slice(offset + oldText.length), current);
    }),
    insert: (path, sha, afterLine, text) => store.write(async () => {
      const current = await checked(path, sha);
      const lines = current.text ? current.text.split("\n") : [];
      if (current.text.endsWith("\n")) lines.pop();
      if (!Number.isInteger(afterLine) || afterLine < 0 || afterLine > lines.length) throw new Error(`${path}: invalid insertion line`);
      const offset = lines.slice(0, afterLine).reduce((sum, line) => sum + line.length + 1, 0);
      const before = current.text.slice(0, offset);
      const after = current.text.slice(offset);
      return publish(path, before + (before && !before.endsWith("\n") && text ? "\n" : "") + text + (after && text && !text.endsWith("\n") ? "\n" : "") + after, current);
    }),
    delete: (path, sha) => store.write(async () => {
      const expected = await checked(path, sha);
      const current = store.state.docs[path];
      if (JSON.stringify(canonical(current && toJson(DocumentSchema, current))) !== JSON.stringify(canonical(toJson(DocumentSchema, expected.document)))) {
        throw new DocumentConflictError(path, sha, current ? (await read(path)).sha : "deleted");
      }
      const draft = clone(WorldStateSchema, store.state);
      delete draft.docs[path];
      store.publishDocuments(draft);
    }),
  };
  return docs;
}
