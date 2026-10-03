import { clone } from "@bufbuild/protobuf";
import { WorldStateSchema, type WorldState } from "../../contracts/src/v2.js";
import { refreshDocumentGraph } from "./world-state.js";
import { validateDocuments } from "./document-audit.js";

/** Shared authority and write queue; service implementations own their mutation policies. */
export class WorldStore {
  state: WorldState;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(initial: WorldState) { this.state = refreshDocumentGraph(clone(WorldStateSchema, initial)); }
  write<T>(action: () => Promise<T>): Promise<T> {
    const result = this.writes.then(action);
    this.writes = result.catch(() => undefined);
    return result;
  }
  publishDocuments(draft: WorldState): void {
    refreshDocumentGraph(draft);
    validateDocuments(draft);
    this.state = draft;
  }
}
