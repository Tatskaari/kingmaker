import type { DocsService, ScenarioService } from "./service-types.js";
import type { WorldStore } from "./world-store.js";

export function createScenarioService(store: WorldStore, docs: DocsService): ScenarioService {
  return {
    info: () => ({ scenario: store.state.scenario, scenarioIndex: store.state.scenarioIndex, ...(store.state.player === undefined ? {} : { player: store.state.player }), characters: [...store.state.characters] }),
    read: () => store.state,
    getDocument: docs.read,
    setPlayer: path => store.write(async () => {
      if (store.state.player) throw new Error("The player already exists.");
      if (!Object.values(store.state.simulation!.runtimeCharacters).some(actor => actor.characterId === "player" && actor.document === path) || store.state.characters.includes(path)) throw new Error("Expected a created player character document.");
      const draft = { ...store.state, docs: { ...store.state.docs } };
      draft.player = path;
      store.publishDocuments(draft);
    }),
  };
}
