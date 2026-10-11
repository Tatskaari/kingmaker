import { compileQuestTree } from "./quest-tree.js";
import { createQuestService } from "./quest-service.js";
import { transitionWithHook } from "../../conversation/src/quest-transition.js";
import type { WorldStore } from "./world-store.js";
import { bindHookServices } from "./hook-services.js";
import { runHook } from "../../hooks/src/runtime.js";
import type { TreeScript } from "../../conversation/src/conversation-tree.js";

export function createHookService(store: WorldStore) {
  return {
    /** Re-evaluate authored physical predicates against current state after a host action. */
    async evaluatePredicates(signal: AbortSignal) {
      for (const state of createQuestService(store).listActive()) {
        signal.throwIfAborted();
        const edge = state.quest!.transitions.find(edge => edge.fromStageId === state.currentStageId
          && edge.fixtureAbsent && !store.state.simulation!.map!.fixtures.some(f => f.id === edge.fixtureAbsent));
        if (edge) await this.transition(state.quest!.id, edge.id, state.revision, "", signal);
      }
    },
    async transition(id: string, edge: string, revision: number, evidence: string, signal: AbortSignal) {
      const doc = Object.entries(store.state.docs).find(([path, doc]) => path.includes("/Quests/") && path.endsWith("/quest.md") && doc.frontmatter?.id === id)?.[1];
      if (!doc) throw new Error(`No authored quest document: ${id}`);
      const tree = compileQuestTree({ body: doc.body, metadata: doc.frontmatter ?? {} });
      const name = tree.scripts[edge], hook = name && store.hooks.get(name);
      if (name && !hook) throw new Error(`Missing quest hook: ${name}`);
      return transitionWithHook(createQuestService(store), id, edge, revision, signal, hook ? () => runHook(hook, guard =>
        bindHookServices(store, () => {
          guard();
          if (store.hooks.get(name!) !== hook) throw new Error(`Hook changed during execution: ${name}`);
        }, signal, { questId: id, transitionId: edge, evidence }), signal) : undefined, evidence);
    },
    /** Bind the currently validated source registry; in-flight edits revoke older bindings. */
    bind(): Readonly<Record<string, TreeScript>> {
      return Object.fromEntries([...store.hooks].map(([name, hook]) => [name, (signal: AbortSignal) => runHook(hook, guard =>
        bindHookServices(store, () => {
          guard();
          if (store.hooks.get(name) !== hook) throw new Error(`Hook changed during execution: ${name}`);
        }, signal), signal)]));
    },
  };
}
