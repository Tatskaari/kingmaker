import { publishSimulationChanges } from "../../core/src/simulation-publication.js";
import { createSimulationAuthority } from "../../core/src/simulation-authority.js";
import type { SimulationMove } from "../../core/src/simulation-move.js";
import { clone } from "@bufbuild/protobuf";
import { WorldStateSchema, type WorldState } from "../../contracts/src/v2.js";
import { DocumentGraph } from "./document-graph.js";
import { validateDocuments } from "./document-audit.js";

/** Shared authority and write queue; service implementations own their mutation policies. */
export class WorldStore {
  state: WorldState;
  private writes: Promise<unknown> = Promise.resolve();
  private graph: DocumentGraph;
  private simulation: ReturnType<typeof createSimulationAuthority>;
  constructor(initial: WorldState) {
    this.state = clone(WorldStateSchema, initial);
    this.graph = DocumentGraph.build(this.state);
    this.simulation = createSimulationAuthority(this.state.simulation!);
    this.state.simulation = this.simulation.read();
  }
  write<T>(action: () => Promise<T>): Promise<T> {
    const result = this.writes.then(action);
    this.writes = result.catch(() => undefined);
    return result;
  }
  executeMove<Args extends unknown[]>(move: SimulationMove<Args>, ...args: Args): void {
    this.simulation.executeMove(move, ...args);
    this.state.simulation = this.simulation.read();
  }
  prepareDocuments(draft: WorldState): DocumentGraph { return this.graph.update(draft); }
  publishDocuments(draft: WorldState, prepared = this.graph): void {
    const graph = prepared.update(draft);
    validateDocuments(draft);
    const before = this.state.simulation!, next = draft.simulation!;
    if (next !== before) {
      const characters = Object.fromEntries(Object.entries(next.runtimeCharacters)
        .filter(([id, actor]) => actor !== before.runtimeCharacters[id]));
      if (Object.keys(before.runtimeCharacters).some(id => !next.runtimeCharacters[id])) throw new Error("Document updates cannot remove runtime characters.");
      if (next.map !== before.map || Object.keys(characters).length) {
        this.executeMove(publishSimulationChanges, { ...(next.map !== before.map ? { map: next.map } : {}), characters });
      }
    }
    this.graph = graph;
    this.state = { ...draft, simulation: this.state.simulation };
  }
}
