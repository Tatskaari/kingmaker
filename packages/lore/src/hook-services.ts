import { removeFixtures } from "../../core/src/remove-fixtures.js";
import { inventoryOwners, itemsFor } from "../../core/src/inventory.js";
import { broadcastMemory } from "./memory-broadcast.js";
import { createHookService } from "./hook-service.js";
import { create } from "@bufbuild/protobuf";
import { FixtureInteractionSchema, type MapFixture } from "../../contracts/src/index.js";
import type { QuestState } from "../../contracts/src/v2.js";
import type { HookServices, HookQuestState, HookFixture, HookAction } from "../../hooks/src/services.js";
import type { WorldStore } from "./world-store.js";
import { createQuestService } from "./quest-service.js";
import { createMapService } from "./map-service.js";

const progress = (state: QuestState): HookQuestState => ({ id: state.quest!.id, currentStageId: state.currentStageId, revision: state.revision, active: state.active });
function fixtureView(fixture: MapFixture): HookFixture {
  return { id: fixture.id, name: fixture.name, actions: fixture.actions.map(({ id, label, handler, actorId, illegal, order }) => {
    if (handler !== "smash-cart") throw new Error(`Unsupported hook action handler: ${handler}`);
    return { id, label, handler, actorId, illegal, order };
  }) };
}
function actions(value: unknown): HookAction[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Invalid fixture actions");
  for (const action of value) {
    if (!action || typeof action !== "object" || ![action.id, action.label, action.actorId].every(text => typeof text === "string" && text.length > 0 && text.length <= 4096)
      || action.handler !== "smash-cart" || typeof action.illegal !== "boolean" || !Number.isInteger(action.order)) throw new Error("Invalid fixture action");
  }
  return value;
}
/** All data crossing the VM boundary is scoped to the requested quest or fixture. */
export function bindHookServices(store: WorldStore, guard: () => void, signal = new AbortController().signal, transition?: HookServices["transition"]): HookServices {
  const quests = createQuestService(store, guard), map = createMapService(store);
  return {
    ...(transition ? { transition } : {}),
    inventory: { hasItem: (ownerId, itemId) => {
      guard();
      const simulation = store.state.simulation!;
      return itemsFor(inventoryOwners(Object.values(simulation.runtimeCharacters), simulation.map), ownerId).some(item => item.id === itemId);
    } },
    memories: { broadcast: (id, input) => broadcastMemory(store, id, input, guard) },
    quests: {
      advance: (id, edge, revision, evidence = "") => {
        guard();
        if (transition) throw new Error("Quest hooks cannot recursively advance quests");
        return createHookService(store).transition(id, edge, revision, evidence, signal);
      },
      list: () => { guard(); return quests.list().map(progress); },
      read: id => { guard(); return progress(quests.read(id)); },
      setActive: async (id, active, revision) => progress(await quests.setActive(id, active, revision)),
      transition: async (id, edge, revision, evidence) => progress(await quests.transition(id, edge, revision, evidence)),
    },
    map: {
      removeFixtures: ids => store.write(async () => { guard(); store.executeMove(removeFixtures, ids); }),
      listFixtures: () => { guard(); return store.state.simulation!.map!.fixtures.map(fixtureView); },
      updateFixture: (id, update) => map.updateFixture(id, fixture => {
        guard();
        const view = fixtureView(fixture);
        update(view);
        if (view.id !== fixture.id) throw new Error("Cannot change fixture identity");
        if (typeof view.name !== "string" || !view.name.trim()) throw new Error("Invalid fixture name");
        fixture.name = view.name;
        fixture.actions = actions(view.actions).map(action => {
          return create(FixtureInteractionSchema, action);
        });
      }),
    },
  };
}
