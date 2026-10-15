// @ts-expect-error boardgame.io ships no types for its CommonJS client (src/game/combat/game.ts requires it the same way)
import * as boardgameClient from "boardgame.io/dist/cjs/client.js";
import * as nodeCrypto from "./crypto.ts";

/**
 * node:module for the browser build. createRequire's require knows the few modules the game asks
 * for by name at run time: boardgame.io's CommonJS client (src/game/combat/game.ts) and crypto
 * (the rules engine's ULIDs, when there's no window to find Web Crypto on).
 */

const modules: Record<string, unknown> = {
  "boardgame.io/dist/cjs/client.js": boardgameClient,
  crypto: nodeCrypto,
  "node:crypto": nodeCrypto,
};

export function createRequire(_from: string | URL): (id: string) => unknown {
  const require = (id: string) => {
    if (id in modules) return modules[id];
    throw new Error(`Cannot find module '${id}' (the browser build has no require for it)`);
  };
  return Object.assign(require, { resolve: (id: string) => id, cache: {} });
}

export const builtinModules: string[] = [];
export function stripTypeScriptTypes(_code: string): string {
  throw new Error("No TypeScript stripping in the browser build");
}

export default { createRequire, builtinModules, stripTypeScriptTypes };
