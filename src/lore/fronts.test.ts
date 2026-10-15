import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDoc } from "./docs.ts";
import { frontsText, moveFronts } from "./fronts.ts";

process.env.KM_RUNS_DIR = mkdtempSync(join(tmpdir(), "km-fronts-"));
const PATH = "World/Fronts.md";

test("ticks a step in the session's copy, not the authored lore", () => {
  const done = moveFronts("s-tick", PATH, { ticked: [{ front: "The Purveyor's man", step: "If Prout goes into the Captain's book as a murder" }], struck: [], bills: [] }, "The Hanged Clerk");
  assert.deepEqual(done, ["ticked: The Purveyor's man: If Prout goes into the Captain's book as a murder"]);
  assert.match(frontsText("s-tick", PATH)!, /- \[x\] \*\*If Prout goes into the Captain's book as a murder\*\*.*\*\(Ticked after The Hanged Clerk\.\)\*/);
  assert.match(frontsText("another-session", PATH)!, /- \[ \] \*\*If Prout goes into the Captain's book as a murder\*\*/);
});

test("the same step name in two fronts ticks only in the one named", () => {
  moveFronts("s-front", PATH, { ticked: [{ front: "The river tonight", step: "Procession morning" }], struck: [], bills: [] }, "The Heron");
  const body = readDoc("s-front", PATH)!.body;
  const river = body.slice(body.indexOf("## The river tonight"));
  assert.match(river, /- \[x\] \*\*Procession morning\*\*/);
  assert.doesNotMatch(body.slice(0, body.indexOf("## The river tonight")), /- \[x\] \*\*Procession morning\*\*/);
});

test("strikes a step with why, and adds a bill at the end of its section", () => {
  const done = moveFronts("s-strike", PATH, {
    ticked: [],
    struck: [{ front: "the purveyor's man", step: "Procession morning", why: "Sallow is in the cells" }],
    bills: ["If the investigator set fire to the Rat's privy: Nan wants it paid for, and says so at the river stairs."],
  }, "The Drowned Rat");
  assert.equal(done.length, 2);
  const body = frontsText("s-strike", PATH)!;
  assert.match(body, /- ~~\[ \] \*\*Procession morning\*\*.*~~ \*\(Struck after The Drowned Rat: Sallow is in the cells\.\)\*/);
  const bills = body.slice(body.indexOf("## Bills still to come due"), body.indexOf("## Read when relevant"));
  assert.match(bills, /- \*\*If the investigator set fire to the Rat's privy\*\*: Nan wants it paid for.*\*\(After The Drowned Rat\.\)\*\n*$/);
});

test("ticked steps aren't ticked twice, and unknown steps change nothing", () => {
  const step = { front: "The Purveyor's man", step: "Prout is filed as self-murder" };
  assert.deepEqual(moveFronts("s-none", PATH, { ticked: [step, { front: "Nobody", step: "Nothing" }], struck: [], bills: [] }, "X"), []);
});
