// The shim, before anything loads the engine's bundle: it gives ulid its crypto (v1-design §3.6).
import "../../shared/rules/shim.ts";
import { readFileSync } from "node:fs";
import { rulesFrom, type Rules, type SrdFile } from "../../shared/rules/index.ts";

/**
 * The rules engine as the AI service loads it (v1-design §3.6): under plain node, the module-ready
 * bundle after the shim, then its pack and the SRD's spells from v2/vendor, handed to v2/shared/rules
 * as a Rules. Once a process, on the first request that needs it (a /v1/characters): the bundle and
 * the pack take a moment to read, and most requests never need them. Nothing is pinned here: the
 * engine's ids come from the platform's crypto and its clock is real, since what the service makes
 * with it (the cards it offers) is shown, not kept.
 */

const VENDOR = new URL("../../vendor/", import.meta.url);

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
  const E = await import("../../vendor/dnd-srd-engine/dnd-srd-engine.module.js");
  const pack = JSON.parse(readFileSync(new URL("dnd-srd-engine/starter-pack.json", VENDOR), "utf8")) as unknown;
  const srd = JSON.parse(readFileSync(new URL("srd-spells/spells.json", VENDOR), "utf8")) as SrdFile;
  return rulesFrom(E, pack, srd);
}
