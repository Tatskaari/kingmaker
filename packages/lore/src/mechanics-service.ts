import { clone } from "@bufbuild/protobuf";
import { WorldStateSchema as MapSchema } from "../../contracts/src/index.js";
import { WorldStateSchema } from "../../contracts/src/v2.js";
import type { MechanicsStateService } from "./service-types.js";
import type { WorldStore } from "./world-store.js";

export function createMechanicsService(store: WorldStore): MechanicsStateService {
  return {
    commit(map, properties) {
      const draft = clone(WorldStateSchema, store.state);
      draft.map = clone(MapSchema, map);
      for (const [path, value] of Object.entries(properties)) {
        if (!draft.docs[path]) throw new Error(`Unknown character document: ${path}`);
        draft.docs[path]!.characterProperties = structuredClone(value);
      }
      // Map and mechanical properties cannot change Markdown links or entrypoints.
      store.state = draft;
    },
  };
}
