import { test } from "node:test";
import assert from "node:assert/strict";
import { gmFromRow, gmToRow, initialGm, type GmRow } from "../../shared/gm/state.ts";
import type { FeatureRef, GearRow, SheetRows, SlotRow, SpellRef, WeaponRef } from "../../shared/rules/types.ts";
import type { Db } from "./context.ts";

/**
 * gm_state's columns are shared/gm/state.ts's GmRow, both ways: what the table gives back maps to
 * GmState, and what gmToRow makes inserts as it is. The sheet's engine-made columns are
 * shared/rules's SheetRows, which go into the row as they are, and its object columns and
 * rules_state's gear read as shared/rules's types. The type check is the test (this file imports the
 * schema's types only, so it loads without SpacetimeDB's server code).
 */

type Found = NonNullable<ReturnType<Db["gmState"]["sceneId"]["find"]>>;
type Insert = Parameters<Db["gmState"]["insert"]>[0];

const read = (row: Found): GmRow => row;
const write = (row: GmRow): Insert => row;

test("gm_state's row is GmRow both ways", () => {
  const row = gmToRow(1n, initialGm({ start: "yard" }));
  assert.deepEqual(gmFromRow(read(write(row) as Found)), initialGm({ start: "yard" }));
});

type Sheet = NonNullable<ReturnType<Db["sheet"]["playerId"]["find"]>>;
type SheetInsert = Parameters<Db["sheet"]["insert"]>[0];
type RulesState = NonNullable<ReturnType<Db["rulesState"]["playerId"]["find"]>>;

const sheetRow = (rows: SheetRows, pockets: string): SheetInsert => ({ playerId: 1n, gameId: 1n, ...rows, pockets });
const parts = (row: Sheet): { slots: SlotRow[]; spells: SpellRef[]; weapons: WeaponRef[]; features: FeatureRef[] } => row;
const writeParts = (p: { slots: SlotRow[]; spells: SpellRef[]; weapons: WeaponRef[]; features: FeatureRef[] }): Pick<SheetInsert, "slots" | "spells" | "weapons" | "features"> => p;
const gear = (row: RulesState): GearRow[] => row.gear;

test("the sheet's engine-made columns are SheetRows, and its parts and the gear read as shared/rules's types", () => {
  const rows: SheetRows = {
    build: "halfling rogue 3 (Thief), criminal background", skills: "{}", statusLine: "HP 24/24", level: 3, hp: 24, maxHp: 24, ac: 14,
    slots: [], conditions: [], spells: [], weapons: [{ id: "01J", name: "Rapier" }], features: [], data: "{}", backstory: undefined, spellFacts: "", actions: "",
  };
  const row = sheetRow(rows, "{}") as Sheet;
  assert.deepEqual(parts(row).weapons, [{ id: "01J", name: "Rapier" }]);
  assert.deepEqual(writeParts(parts(row)).weapons, rows.weapons);
  assert.deepEqual(gear({ gear: [{ id: "01K", name: "Dagger", kind: "weapon", slot: undefined }] } as RulesState), [{ id: "01K", name: "Dagger", kind: "weapon", slot: undefined }]);
});
