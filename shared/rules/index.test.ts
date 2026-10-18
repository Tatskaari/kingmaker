import { test } from "node:test";
import assert from "node:assert/strict";
import * as rules from "./index.ts";

/**
 * index.ts is what the client loads for the rules' functions that take no engine (sheetText,
 * cardText, picksOf), so nothing it loads may load the engine's shim: the shim gives the global
 * object a `window` (ulid's crypto), and the SpacetimeDB SDK, seeing one, takes it for a browser's
 * and calls window.addEventListener when it reconnects. pin.ts loads the shim; index.ts doesn't
 * re-export it. (node --test runs this file in a process of its own.)
 */

test("index.ts loads without the engine's shim", () => {
  assert.equal(typeof rules.sheetText, "function");
  assert.equal("window" in globalThis, false);
});
