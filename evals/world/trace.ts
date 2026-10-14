import { registerHooks } from "node:module";

/**
 * Preload (`node --import ./evals/world/trace.ts src/cli/scene.ts ...`) that records what the stage
 * manager saw on every turn, without touching the runtime: the engine's import of the stage
 * manager is redirected to a wrapper that copies the world before staging. The trace is the raw
 * material for eval cases (evals/world/capture.ts): the exact world the stage manager read, the
 * exchange, the operations it wrote and the world after.
 *
 * Set KM_STAGE_TRACE to the JSONL file to append to.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../world/stage.ts" && context.parentURL?.endsWith("/src/runtime/engine.ts")) {
      return nextResolve(new URL("./stage-trace.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
