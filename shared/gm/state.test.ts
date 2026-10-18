import { test } from "node:test";
import assert from "node:assert/strict";
import { rng, rollCheck } from "../dice.ts";
import { gmFromRow, gmToRow, initialGm, type GmRow, type GmState } from "./state.ts";

const roll = rollCheck(rng(3), "persuasion", 12, 1);

/** A scene's bookkeeping with every field the row keeps set, the optional ones too. */
const busy: GmState = {
  ...initialGm({ start: "yard" }),
  beat: "doubt", turnsInBeat: 2,
  path: [
    { turn: 1, from: "yard", to: "doubt", via: "examine-body", roll, source: "pre", known: 0 },
    { turn: 2, from: "doubt", to: "doubt", via: "same-again:win-cob", source: "post" },
    { turn: 3, from: "doubt", to: "doubt", via: "coax-cob", roll: { ...rollCheck(rng(9), "insight", 10, 4, "advantage"), critical: "success" }, source: "pre", known: 1 },
    { turn: 4, from: "doubt", to: "yard-improv-4", via: "repair", source: "repair", known: 2 },
  ],
  established: ["Prout didn't hang himself."], landed: ["not-suicide"], hinted: ["page"],
  opened: [{ path: "Cast/Cob/knowledge/silvertop.md", title: "Silvertop", scope: "character:cob", turn: 2 }],
  closing: { exitId: "open-case", turn: 3 },
  ended: { exitId: "open-case", turn: 4 },
  oocTurns: [2], pressureOffered: ["yard"],
  canon: ["The loft key hangs on a nail by the gate."],
  patches: [
    { turn: 3, beat: { id: "yard-improv-3", title: "Up the ladder", direction: "Kell holds the ladder.", pressure: "The cart is coming.", transitions: [{ id: "yard-improv-3-to-doubt-0", when: "They look at the rope.", to: "doubt" }] }, why: "Bridging beat: Up the ladder" },
    { turn: 3, transition: { beat: "doubt", transition: { id: "improv-3-0", when: "The player presses Moll.", on: "attempt", check: { skill: "intimidation", dc: 13, reason: "to scare Moll", success: "She talks.", failure: "She bolts.", onSuccess: "doubt", onFailure: "yard" } } }, why: "Let the threat count" },
    { turn: 4, close: { beat: "*", id: "win-cob" }, why: "Closed by the co-GM: Cob has bolted" },
  ],
  notes: "Steer back to the boots.", notesTurn: 3,
  whispers: [{ to: "moll", note: "She wants her money first.", turn: 3 }],
  lastRepairTurn: 3, offGraphTurn: 4,
  adjustments: ["Hobb is in the watch-house cells, not on the hoist."],
  opening: "Show the Rat's long smoky room. End on the landlady asking the sergeant whether she's on duty.",
  lead: "Kell's runner finds you at the watch-house: the big man with the bandaged hand drinks at the Drowned Rat.",
  owed: [
    { from: "hanged-clerk", id: "page", hinted: true, things: ["granary-yard/boots", "granary-yard/ledger-page"], holders: ["cob"], where: "sewn into the left boot's lining, on Cob's feet" },
    { from: "hanged-clerk", id: "silvertop", hinted: false, things: [], holders: [] },
  ],
  fought: ["fight"],
  threat: { kind: "attack", by: "kell", turn: 5 },
  held: 4,
  brawl: { turn: 5, cause: "cast Burning Hands at Sergeant Agnes Kell", against: ["kell"], allies: [], fled: ["cob", "moll"] },
  absent: ["cob", "moll"],
  withheld: ["Cast/Kell/Notes/The door at the Drowned Rat.md"],
  talk: { with: "kell", where: "Granary Street in Caerwyn, evening", confide: { note: "Cast/Kell/Notes/Her brother.md", topic: "her brother in the river watch", what: "Her brother drowned on duty." } },
  reached: ["yard", "murder", "doubt"],
  twoPart: {
    roles: { kell: { status: "watching the boy", mental_state: "patient, for now", conversation_role: "Characterise: brief and dry." }, cob: { status: "", mental_state: "", conversation_role: "Stones and cheek." } },
    notes: [{ turn: -1, text: "Co-GM note, before the opening" }, { turn: 2, text: "Co-GM note, before turn 2" }],
    moved: "doubt", held: true,
  },
};

test("a scene's bookkeeping goes to its gm_state row and back exactly", () => {
  assert.deepEqual(gmFromRow(gmToRow(7n, busy)), busy);
  assert.deepEqual(gmFromRow(gmToRow(7n, initialGm({ start: "yard" }))), initialGm({ start: "yard" }));
  assert.equal(gmToRow(7n, busy).sceneId, 7n);
});

test("a hazard hanging over the player goes to the row and back too, the attack's fields empty", () => {
  const hazard: GmState = { ...busy, threat: { kind: "hazard", hazard: "grab_or_shove", severity: "serious", turn: 6 } };

  assert.deepEqual(gmToRow(7n, hazard).threat, { kind: "hazard", by: undefined, hazard: "grab_or_shove", severity: "serious", turn: 6 });
  assert.deepEqual(gmToRow(7n, busy).threat, { kind: "attack", by: "kell", hazard: undefined, severity: undefined, turn: 5 });
  assert.deepEqual(gmFromRow(gmToRow(7n, hazard)), hazard);
});

test("the row keeps empty options as undefined, as SpacetimeDB's rows do", () => {
  const row = gmToRow(1n, initialGm({ start: "yard" }));

  assert.deepEqual([row.closing, row.ended], [undefined, undefined]);
  assert.deepEqual([row.notes, row.notesTurn, row.lastRepairTurn, row.offGraphTurn], [undefined, undefined, undefined, undefined]);
  assert.deepEqual([row.opening, row.lead, row.adjustments, row.owed, row.fought, row.absent], [undefined, undefined, [], [], [], []]);
  assert.equal(gmToRow(1n, busy).owed[1]!.where, undefined);
  assert.deepEqual([row.threat, row.held, row.brawl], [undefined, undefined, undefined]);
  assert.equal(row.patches, "[]");
  assert.equal(gmToRow(1n, busy).path[1]!.roll, undefined);
  assert.equal(gmToRow(1n, busy).path[0]!.roll!.critical, roll.critical ?? undefined);
});

test("a row from before the co-GM's columns (their defaults) reads as a scene with none of it yet", () => {
  const { canon: _c, patches: _p, notes: _n, notesTurn: _t, whispers: _w, lastRepairTurn: _l, offGraphTurn: _o, ...v1 } = gmToRow(1n, busy);
  const migrated = { ...v1, canon: [], patches: "[]", notes: undefined, notesTurn: undefined, whispers: [], lastRepairTurn: undefined, offGraphTurn: undefined };
  const gm = gmFromRow(migrated);

  assert.deepEqual([gm.canon, gm.patches, gm.notes, gm.notesTurn, gm.whispers], [[], [], null, null, []]);
  assert.ok(!("lastRepairTurn" in gm) && !("offGraphTurn" in gm));
  assert.equal(gm.beat, "doubt");
});

test("a row from before the story's columns (their defaults) reads as a scene nothing was handed on to", () => {
  const { adjustments: _a, opening: _o, lead: _l, owed: _w, fought: _f, absent: _b, ...gm } = gmToRow(1n, busy);
  const read = gmFromRow({ ...gm, adjustments: [], opening: undefined, lead: undefined, owed: [], fought: [], absent: [] });

  assert.deepEqual([read.adjustments, read.owed, read.fought, read.absent], [[], [], [], []]);
  assert.ok(!("opening" in read) && !("lead" in read));
  assert.deepEqual(read.whispers, busy.whispers);
});

test("a row from before the world bridge's columns (their defaults) reads as a scene with nothing hanging and nobody gone", () => {
  const { threat: _t, held: _h, brawl: _b, absent: _a, ...gmOnly } = gmToRow(1n, busy);
  const gm = gmFromRow({ ...gmOnly, threat: undefined, held: undefined, brawl: undefined, absent: [] });

  assert.ok(!("threat" in gm) && !("held" in gm) && !("brawl" in gm));
  assert.deepEqual(gm.absent, []);
  assert.deepEqual(gm.whispers, busy.whispers);
});

test("a row from before the town's columns (their defaults) reads as a scene that keeps nothing back and isn't a talk", () => {
  const { withheld: _w, talk: _t, ...gmOnly } = gmToRow(1n, busy);
  const gm = gmFromRow({ ...gmOnly, withheld: [], talk: undefined });

  assert.ok(!("withheld" in gm) && !("talk" in gm));
  assert.deepEqual(gm.absent, busy.absent);
  assert.deepEqual(gmToRow(1n, { ...busy, talk: { with: "kell", where: "the lane" } }).talk, { companion: "kell", where: "the lane", confide: undefined });
});

test("a scene's bookkeeping as it opens: its start reached and its stage, nobody's role yet; the two-part GM's to its row and back", () => {
  const gm = initialGm({ start: "start" });
  assert.deepEqual([gm.beat, gm.reached, gm.twoPart], ["start", ["start"], { roles: {}, notes: [] }]);

  const row = gmToRow(7n, busy);
  assert.deepEqual(row.reached, ["yard", "murder", "doubt"]);
  assert.deepEqual(row.twoPart, {
    roles: [{ cast: "kell", status: "watching the boy", mentalState: "patient, for now", conversationRole: "Characterise: brief and dry." }, { cast: "cob", status: "", mentalState: "", conversationRole: "Stones and cheek." }],
    notes: [{ turn: -1, text: "Co-GM note, before the opening" }, { turn: 2, text: "Co-GM note, before turn 2" }], moved: "doubt", held: true,
  });
  assert.deepEqual(gmToRow(7n, gm).twoPart, { roles: [], notes: [], moved: undefined, held: false });
});

test("a row from before M2's columns (their defaults) reads as a scene at its stage with no two-part GM yet", () => {
  const gm = gmFromRow({ ...gmToRow(1n, busy), reached: [], twoPart: { roles: [], notes: [], moved: undefined, held: false } });
  assert.deepEqual([gm.reached, gm.twoPart], [["doubt"], { roles: {}, notes: [] }]);
  const { reached: _r, twoPart: _t, ...older } = gmToRow(1n, busy);
  assert.deepEqual(gmFromRow(older as GmRow).twoPart, { roles: {}, notes: [] }, "the dev tools' SQL on an older module: no column at all");
});

test("who came on by a route has no column yet: writing it is an error, not a loss; the cast who are away have theirs", () => {
  assert.throws(() => gmToRow(1n, { ...busy, entered: ["tull"] }), /no column for entered/);
  assert.deepEqual(gmFromRow(gmToRow(1n, { ...busy, absent: ["moll"] })).absent, ["moll"]);
});
