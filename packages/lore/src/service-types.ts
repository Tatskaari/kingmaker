import type { Document, WorldState, CharacterProperties } from "../../contracts/src/v2.js";
import type { ActorState, WorldState as MapState } from "../../contracts/src/index.js";

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
  presentation?: string;
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
export interface DocumentWrite { path: string; expectedSha: string | null; text: string }
export interface IntentWrite {
  actorId: string;
  expectedRevision: number;
  activity: string | null;
  wait: string | null;
}
export interface DocsService {
  commit(writes: readonly DocumentWrite[], intents?: readonly IntentWrite[]): Promise<void>;
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

