import { clone } from "@bufbuild/protobuf";
import { WorldStateSchema } from "../../contracts/src/v2.js";
import type { DocsService, ScenarioService } from "./service-types.js";
import type { WorldStore } from "./world-store.js";

export function createScenarioService(store: WorldStore, docs: DocsService): ScenarioService {
  return {
    info: () => ({ scenario: store.state.scenario, scenarioIndex: store.state.scenarioIndex, ...(store.state.player === undefined ? {} : { player: store.state.player }), characters: [...store.state.characters] }),
    snapshot: () => clone(WorldStateSchema, store.state),
    getDocument: docs.read,
    setPlayer: path => store.write(async () => {
      if (store.state.player) throw new Error("The player already exists.");
      if (!store.state.docs[path]?.characterProperties || store.state.characters.includes(path)) throw new Error("Expected a created player character document.");
      const draft = clone(WorldStateSchema, store.state);
      draft.player = path;
      store.publishDocuments(draft);
    }),
  };
}
