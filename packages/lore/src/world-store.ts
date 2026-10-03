import { clone } from "@bufbuild/protobuf";
import { WorldStateSchema, type WorldState } from "../../contracts/src/v2.js";
import { DocumentGraph } from "./document-graph.js";
import { validateDocuments } from "./document-audit.js";

/** Shared authority and write queue; service implementations own their mutation policies. */
export class WorldStore {
  state: WorldState;
  private writes: Promise<unknown> = Promise.resolve();
  private graph: DocumentGraph;
  constructor(initial: WorldState) {
    this.state = clone(WorldStateSchema, initial);
    this.graph = DocumentGraph.build(this.state);
  }
  write<T>(action: () => Promise<T>): Promise<T> {
    const result = this.writes.then(action);
    this.writes = result.catch(() => undefined);
    return result;
  }
  prepareDocuments(draft: WorldState): DocumentGraph { return this.graph.update(draft); }
  publishDocuments(draft: WorldState, prepared = this.graph): void {
    const graph = prepared.update(draft);
    validateDocuments(draft);
    this.graph = graph;
    this.state = draft;
  }
}
