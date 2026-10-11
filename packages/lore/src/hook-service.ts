import type { WorldStore } from "./world-store.js";
import { bindHookServices } from "./hook-services.js";
import { runHook } from "../../hooks/src/runtime.js";
import type { TreeScript } from "../../conversation/src/conversation-tree.js";

export function createHookService(store: WorldStore) {
  return {
    /** Bind the currently validated source registry; in-flight edits revoke older bindings. */
    bind(): Readonly<Record<string, TreeScript>> {
      return Object.fromEntries([...store.hooks].map(([name, hook]) => [name, (signal: AbortSignal) => runHook(hook, guard =>
        bindHookServices(store, () => {
          guard();
          if (store.hooks.get(name) !== hook) throw new Error(`Hook changed during execution: ${name}`);
        }), signal)]));
    },
  };
}
