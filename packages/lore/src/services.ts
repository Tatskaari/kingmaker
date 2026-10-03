import { clone, fromJson, toJson, type JsonObject } from "@bufbuild/protobuf";
import { stringify } from "yaml";
import { DocumentSchema, WorldStateSchema, type Document, type WorldState, type CharacterProperties } from "../../contracts/src/v2.js";
import { ActorStateSchema, WorldStateSchema as MapSchema, type ActorState, type WorldState as MapState } from "../../contracts/src/index.js";
import { parseMarkdown } from "./markdown.js";
import { validateDocuments } from "./document-audit.js";
import { refreshDocumentGraph } from "./world-state.js";

export interface DocumentSnapshot {
  path: string;
  sha: string;
  /** Canonical Markdown, including YAML frontmatter, used by replace/insert. */
  text: string;
  document: Document;
}
/** Trusted mechanics publish physical results, never narrative documents. */
export interface MechanicsStateService {
  commit(map: MapState, properties: Readonly<Record<string, CharacterProperties>>): void;
}
export interface CharacterCreation {
  id: string;
  path: string;
  text: string;
  properties: CharacterProperties;
  /** Supply a new actor, or omit to retain an authored position. */
  actor?: ActorState;
}
export interface CharacterCreationService {
  create(input: CharacterCreation): Promise<void>;
}
export interface ScenarioInfo { scenario: string; scenarioIndex: string; player?: string; characters: string[] }
export interface ScenarioService {
  info(): ScenarioInfo;
  setPlayer(path: string): Promise<void>;
  snapshot(): WorldState;
  getDocument(path: string): Promise<DocumentSnapshot>;
}
export interface DocsService {
  read(path: string): Promise<DocumentSnapshot>;
  create(path: string, text: string): Promise<DocumentSnapshot>;
  replace(path: string, expectedSha: string, oldText: string, newText: string): Promise<DocumentSnapshot>;
  /** Insert after a 1-based line in snapshot.text; 0 inserts at the beginning. */
  insert(path: string, expectedSha: string, afterLine: number, text: string): Promise<DocumentSnapshot>;
  delete(path: string, expectedSha: string): Promise<void>;
}
export class DocumentConflictError extends Error {
  constructor(readonly path: string, readonly expectedSha: string, readonly actualSha: string) {
    super(`${path}: document changed; read it again before editing`);
    this.name = "DocumentConflictError";
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
async function snapshot(path: string, document: Document): Promise<DocumentSnapshot> {
  // Hash the full document, including GM properties and derived links, in stable key order.
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(toJson(DocumentSchema, document))));
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const metadata = document.frontmatter ?? {};
  const text = (Object.keys(metadata).length || /^---\r?\n/.test(document.body)) ? `---\n${stringify(canonical(metadata))}---\n${document.body}` : document.body;
  return { path, sha, text, document };
}

/** Both interfaces share one owned state. No filesystem, model calls or presentation dependencies. */
export function createScenarioServices(initial: WorldState): { scenario: ScenarioService; docs: DocsService; mechanics: MechanicsStateService; character: CharacterCreationService } {
  let state = refreshDocumentGraph(clone(WorldStateSchema, initial));
  let writes: Promise<unknown> = Promise.resolve();
  // Serialize asynchronous hash checks and commits; rejection must not poison subsequent writes.
  function write<T>(action: () => Promise<T>): Promise<T> {
    const result = writes.then(action);
    writes = result.catch(() => undefined);
    return result;
  }
  function publishDraft(draft: WorldState): void {
    refreshDocumentGraph(draft);
    validateDocuments(draft);
    state = draft;
  }
  function document(path: string): Document {
    if (!Object.hasOwn(state.docs, path)) throw new Error(`${path}: document not found`);
    return clone(DocumentSchema, state.docs[path]!);
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
    const draft = clone(WorldStateSchema, state);
    const next = fromJson(DocumentSchema, { body: note.body, frontmatter: note.metadata as JsonObject });
    next.characterProperties = draft.docs[path]?.characterProperties;
    draft.docs[path] = next;
    refreshDocumentGraph(draft);
    const result = await snapshot(path, clone(DocumentSchema, next));
    // Only this document participates in the write. Map interactions can proceed
    // while hashing; merge into the current world rather than publishing the draft.
    const live = state.docs[path];
    if (JSON.stringify(canonical(live && toJson(DocumentSchema, live))) !== JSON.stringify(canonical(expected && toJson(DocumentSchema, expected.document)))) {
      const actual = live ? (await read(path)).sha : "deleted";
      throw new DocumentConflictError(path, expected?.sha ?? "absent", actual);
    }
    const current = clone(WorldStateSchema, state);
    current.docs[path] = next;
    publishDraft(current);
    return result;
  }
  const docs: DocsService = {
    read,
    create: (path, text) => write(async () => {
      if (Object.hasOwn(state.docs, path)) throw new Error(`${path}: document already exists`);
      return publish(path, text);
    }),
    replace: (path, sha, oldText, newText) => write(async () => {
      const current = await checked(path, sha);
      const offset = current.text.indexOf(oldText);
      if (!oldText || offset < 0 || current.text.indexOf(oldText, offset + 1) >= 0) throw new Error(`${path}: oldText must match exactly once`);
      return publish(path, current.text.slice(0, offset) + newText + current.text.slice(offset + oldText.length), current);
    }),
    insert: (path, sha, afterLine, text) => write(async () => {
      const current = await checked(path, sha);
      const lines = current.text ? current.text.split("\n") : [];
      if (current.text.endsWith("\n")) lines.pop();
      if (!Number.isInteger(afterLine) || afterLine < 0 || afterLine > lines.length) throw new Error(`${path}: invalid insertion line`);
      const offset = lines.slice(0, afterLine).reduce((sum, line) => sum + line.length + 1, 0);
      const before = current.text.slice(0, offset);
      const after = current.text.slice(offset);
      return publish(path, before + (before && !before.endsWith("\n") && text ? "\n" : "") + text + (after && text && !text.endsWith("\n") ? "\n" : "") + after, current);
    }),
    delete: (path, sha) => write(async () => {
      const expected = await checked(path, sha);
      const current = state.docs[path];
      if (JSON.stringify(canonical(current && toJson(DocumentSchema, current))) !== JSON.stringify(canonical(toJson(DocumentSchema, expected.document)))) {
        throw new DocumentConflictError(path, sha, current ? (await read(path)).sha : "deleted");
      }
      const draft = clone(WorldStateSchema, state);
      delete draft.docs[path];
      publishDraft(draft);
    }),
  };
  return { docs, character: {
    create: input => write(async () => {
      if (!/^[a-z][a-z0-9_-]*$/.test(input.id)) throw new Error("Invalid character ID.");
      if (Object.hasOwn(state.docs, input.path)) throw new Error("Character document already exists.");
      const prefix = state.scenario.slice(0, state.scenario.lastIndexOf("/") + 1);
      if (input.id !== "player" && input.path !== `${prefix}Characters/${input.id}/character.md`) {
        throw new Error("NPC entry must use its scenario character path.");
      }
      if (input.id === "player" && (state.player || input.path !== "Players/player.md")) throw new Error("Invalid or existing player character.");
      const existing = state.map?.actors.find(actor => actor.characterId === input.id);
      if (!state.map || (!existing && !input.actor)) throw new Error("A character needs a map actor.");
      if (input.actor && (existing || input.actor.characterId !== input.id
        || !state.map.rooms.some(room => room.id === input.actor!.roomId) || !input.actor.position)) {
        throw new Error("Invalid or duplicate character actor.");
      }
      const parsed = parseMarkdown(input.text);
      if (parsed.error) throw new Error(parsed.error);
      const draft = clone(WorldStateSchema, state);
      draft.docs[input.path] = fromJson(DocumentSchema, { body: parsed.body, frontmatter: parsed.metadata as JsonObject });
      draft.docs[input.path]!.characterProperties = structuredClone(input.properties);
      if (input.actor) draft.map!.actors.push(clone(ActorStateSchema, input.actor));
      if (input.id !== "player") draft.docs[draft.scenario]!.body += `\n- [[${input.path}]]\n`;
      draft.map!.revision++;
      publishDraft(draft);
    }),
  }, mechanics: {
    commit(map, properties) {
      const draft = clone(WorldStateSchema, state);
      draft.map = clone(MapSchema, map);
      for (const [path, value] of Object.entries(properties)) {
        if (!draft.docs[path]) throw new Error(`Unknown character document: ${path}`);
        draft.docs[path]!.characterProperties = structuredClone(value);
      }
      state = refreshDocumentGraph(draft);
    },
  }, scenario: {
    info: () => ({ scenario: state.scenario, scenarioIndex: state.scenarioIndex, ...(state.player === undefined ? {} : { player: state.player }), characters: [...state.characters] }),
    snapshot: () => clone(WorldStateSchema, state),
    getDocument: read,
    setPlayer: path => write(async () => {
      if (state.player) throw new Error("The player already exists.");
      if (!state.docs[path]?.characterProperties || state.characters.includes(path)) throw new Error("Expected a created player character document.");
      const draft = clone(WorldStateSchema, state);
      draft.player = path;
      publishDraft(draft);
    }),
  } };
}
