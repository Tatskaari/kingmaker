import { updateFixture, type FixtureUpdate } from "../../core/src/update-fixture.js";
import type { WorldStore } from "./world-store.js";

/** Authoritative map writes; callbacks only live inside the synchronous simulation move. */
export function createMapService(store: WorldStore) {
  return {
    updateFixture: (id: string, update: FixtureUpdate): Promise<void> =>
      store.write(async () => store.executeMove(updateFixture, id, update)),
  };
}
