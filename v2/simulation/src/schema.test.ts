import { test } from "node:test";
import assert from "node:assert/strict";
import { gmFromRow, gmToRow, initialGm, type GmRow } from "../../shared/gm/state.ts";
import type { Db } from "./context.ts";

/**
 * gm_state's columns are shared/gm/state.ts's GmRow, both ways: what the table gives back maps to
 * GmState, and what gmToRow makes inserts as it is. The type check is the test (this file imports
 * the schema's types only, so it loads without SpacetimeDB's server code).
 */

type Found = NonNullable<ReturnType<Db["gmState"]["sceneId"]["find"]>>;
type Insert = Parameters<Db["gmState"]["insert"]>[0];

const read = (row: Found): GmRow => row;
const write = (row: GmRow): Insert => row;

test("gm_state's row is GmRow both ways", () => {
  const row = gmToRow(1n, initialGm({ start: "yard" }));
  assert.deepEqual(gmFromRow(read(write(row) as Found)), initialGm({ start: "yard" }));
});
