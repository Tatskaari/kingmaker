import { test } from "node:test";
import assert from "node:assert/strict";
import { rng, rollCheck } from "../dice.ts";
import { gmFromRow, gmToRow, initialGm, type GmState } from "./state.ts";

const roll = rollCheck(rng(3), "persuasion", 12, 1);

/** A scene's bookkeeping with every field V0 keeps set, the optional ones too. */
const busy: GmState = {
  ...initialGm({ start: "yard" }),
  beat: "doubt", turnsInBeat: 2,
  path: [
    { turn: 1, from: "yard", to: "doubt", via: "examine-body", roll, source: "pre", known: 0 },
    { turn: 2, from: "doubt", to: "doubt", via: "same-again:win-cob", source: "post" },
    { turn: 3, from: "doubt", to: "doubt", via: "coax-cob", roll: { ...rollCheck(rng(9), "insight", 10, 4, "advantage"), critical: "success" }, source: "pre", known: 1 },
  ],
  established: ["Prout didn't hang himself."], landed: ["not-suicide"], hinted: ["page"],
  opened: [{ path: "Cast/Cob/knowledge/silvertop.md", title: "Silvertop", scope: "character:cob", turn: 2 }],
  endingLead: { exitId: "open-case", count: 1, probability: 0.7 },
  pendingExit: { exitId: "closed-suicide", turn: 3, via: "cart-comes", extended: false, waits: "the player's answer" },
  closing: { exitId: "open-case", turn: 3 },
  ended: { exitId: "open-case", turn: 4 },
  sceneStatus: "drifting",
  oocTurns: [2], pressureOffered: ["yard"], repeated: "Prout turns slowly round.",
};

test("a scene's bookkeeping goes to its gm_state row and back exactly", () => {
  assert.deepEqual(gmFromRow(gmToRow(7n, busy)), busy);
  assert.deepEqual(gmFromRow(gmToRow(7n, initialGm({ start: "yard" }))), initialGm({ start: "yard" }));
  assert.equal(gmToRow(7n, busy).sceneId, 7n);
});

test("the row keeps empty options as undefined, as SpacetimeDB's rows do", () => {
  const row = gmToRow(1n, initialGm({ start: "yard" }));

  assert.deepEqual([row.endingLead, row.pendingExit, row.closing, row.ended, row.sceneStatus, row.repeated], [undefined, undefined, undefined, undefined, undefined, undefined]);
  assert.equal(gmToRow(1n, busy).path[1]!.roll, undefined);
  assert.equal(gmToRow(1n, busy).path[0]!.roll!.critical, roll.critical ?? undefined);
});

test("a later vertical's field has no column yet: writing one is an error, not a loss", () => {
  assert.throws(() => gmToRow(1n, { ...busy, entered: ["tull"] }), /no column for entered/);
  assert.throws(() => gmToRow(1n, { ...busy, notes: "steer her back" }), /no column for notes/);
});
