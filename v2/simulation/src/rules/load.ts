// The shim first: ES modules evaluate a file's imports in order, and the bundle reads what the shim installs (window.crypto, process) as it loads.
import "../../../shared/rules/shim.ts";
import * as E from "../../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import pack from "../../../vendor/dnd-srd-engine/starter-pack.json";
import spells from "../../../vendor/srd-spells/spells.json";
import { rulesFrom } from "../../../shared/rules/index.ts";
import type { Rules, SrdFile } from "../../../shared/rules/types.ts";

/**
 * The rules engine as the simulation loads it (v1-design §3.6): the module-ready bundle, its starter
 * pack and the SRD's spell texts, bundled into the module as JSON, handed to shared/rules as one
 * Rules. Made on first use and kept for the isolate's life (a reducer's isolate serves every call:
 * spacetime.md §7), so only the first engine call on an isolate pays for it.
 */

let rules: Rules | undefined;

export function loadRules(): Rules {
  rules ??= rulesFrom(E, pack, spells as unknown as SrdFile);
  return rules;
}
