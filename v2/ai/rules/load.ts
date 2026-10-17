import { rulesFrom, type Rules, type SrdFile } from "../../shared/rules/index.ts";

/**
 * The rules engine as the AI service loads it (v1-design §3.6): under plain node, the shim, then the
 * module-ready bundle, its pack and the SRD's spells from v2/vendor (JSON modules, which a bundler
 * shares with the simulation's import of them), handed to v2/shared/rules as a Rules. Once a
 * process, on the first request that needs it (a /v1/characters): the bundle and the pack take a
 * moment to read, and most requests never need them. The shim comes first and only then (it puts a
 * `window` on the global object, for ulid), so a process that never makes a card never has one.
 * Nothing is pinned here: the engine's ids come from the platform's crypto and its clock is real,
 * since what the service makes with it (the cards it offers) is shown, not kept.
 */

let loading: Promise<Rules> | undefined;

/** The engine, loaded on first use and kept for the process. A load that fails is tried again by the next caller. */
export function rulesEngine(): Promise<Rules> {
  loading ??= load().catch(error => {
    loading = undefined;
    throw error;
  });
  return loading;
}

async function load(): Promise<Rules> {
  await import("../../shared/rules/shim.ts");
  const E = await import("../../vendor/dnd-srd-engine/dnd-srd-engine.module.js");
  const { default: pack } = await import("../../vendor/dnd-srd-engine/starter-pack.json", { with: { type: "json" } });
  const { default: spells } = await import("../../vendor/srd-spells/spells.json", { with: { type: "json" } });
  return rulesFrom(E, pack, spells as unknown as SrdFile);
}
