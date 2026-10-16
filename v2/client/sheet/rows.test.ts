import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sheetText } from "../../shared/rules/index.ts";
import type { SheetData } from "../../shared/rules/types.ts";
import { sheetOf } from "./rows.ts";

/** The prototype's sheets for builds.json's five and Tamsin's three, as recorded (shared/rules/golden/README.md): its SheetData and its QA console's text. */
const { sheets } = JSON.parse(readFileSync(new URL("../../shared/rules/golden/sheets.json", import.meta.url), "utf8")) as { sheets: Array<{ case: string; sheet: SheetData; text: string }> };

/** A sheet as the simulation writes its row: the engine's data without what they carry, and the pockets apart. */
function rowOf(sheet: SheetData, pockets: Pick<SheetData, "purse" | "carrying"> = sheet) {
  const { purse: _purse, carrying: _carrying, ...data } = sheet;
  return { data: JSON.stringify(data), pockets: JSON.stringify({ purse: pockets.purse, carrying: pockets.carrying }) };
}

test("the sheet from its row is the engine's, and the QA console's text from it the prototype's, for the five ready-made builds and Tamsin's three", () => {
  assert.equal(sheets.length, 8);
  for (const g of sheets) {
    const sheet = sheetOf(rowOf(g.sheet))!;
    assert.deepEqual(sheet, g.sheet, `${g.case}: the data with the pockets laid over it`);
    // shared/rules's sheetText is the prototype's but for its Feats line (the sheet's, the background's among them) and Thieves' Cant (golden.test.ts).
    const proto = g.text.split("\n");
    const conditions = proto.findIndex(l => l.startsWith("Conditions: "));
    const expected = [...proto.slice(0, conditions), ...(sheet.feats.length ? [`Feats: ${sheet.feats.join(", ")}`] : []), ...proto.slice(conditions)]
      .map(l => (l.startsWith("Languages: ") ? l.replace("Thieves-cant", "Thieves' Cant") : l));
    assert.deepEqual(sheetText(sheet).split("\n"), expected, g.case);
  }
});

test("the pockets are what the world says they carry once the story has begun: the purse and pockets on the sheet are the row's", () => {
  const fighter = sheets.find(g => g.case === "fighter")!.sheet;
  assert.match(sheetText(sheetOf(rowOf(fighter))!), /^Purse: 2 silver crowns, 6 shillings, 12 pennies$/m);
  const later = sheetOf(rowOf(fighter, { purse: [{ name: "pennies", quantity: 3 }], carrying: [{ name: "a letter from the King", quantity: 1 }] }))!;
  assert.match(sheetText(later), /^Purse: 3 pennies$/m);
  assert.match(sheetText(later), /^Carrying: a letter from the King$/m);
});

test("no sheet while the engine hasn't made one: empty or unreadable data; empty pockets are empty", () => {
  assert.equal(sheetOf(undefined), undefined);
  assert.equal(sheetOf({ data: "", pockets: "" }), undefined);
  assert.equal(sheetOf({ data: "{broken", pockets: "" }), undefined);
  const { purse: _p, carrying: _c, ...data } = sheets[0]!.sheet;
  const bare = sheetOf({ data: JSON.stringify(data), pockets: "" })!;
  assert.deepEqual([bare.purse, bare.carrying], [[], []]);
});
