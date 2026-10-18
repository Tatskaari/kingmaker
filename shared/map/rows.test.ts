import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExploreState } from "./explore.ts";
import { exploreOf, exploreRowOf, keepColumns, keepFromColumns, LOG_LINES, type ExploreRow, type MapRows } from "./rows.ts";
import type { TownChanges } from "./reconcile.ts";

/** The explore row a move leaves (map-design §3.1, §3.4): the state's fields, what it said, the log's last five, and `acts` moved on. */

const row: ExploreRow = {
  playerId: "1", gameId: "1", map: "caerwyn", at: { x: 42, y: 9 }, facing: { x: 0, y: 1 }, steps: 0, hidden: false,
  followers: [], quips: 0, styles: [], acts: 0, said: "", log: ["one", "two", "three", "four", "five"],
};
const state: ExploreState = {
  map: "caerwyn", at: { x: 41, y: 8 }, facing: { x: -1, y: -1 }, steps: 1, story: { time: "morning", played: [], lead: "hanged-clerk", flags: {} },
  overlay: { scenes: {} }, followers: [], quips: 1, lastQuip: "The wall wins.", styles: ["brick"],
};

test("a move that said something keeps it, and the last five; one that said nothing leaves the log", () => {
  const moved = exploreRowOf(state, row, "You come into Granary Street.");
  assert.deepEqual([moved.at, moved.facing, moved.steps, moved.quips, moved.lastQuip, moved.styles], [{ x: 41, y: 8 }, { x: -1, y: -1 }, 1, 1, "The wall wins.", ["brick"]]);
  assert.deepEqual([moved.acts, moved.said, moved.log.length, moved.log[LOG_LINES - 1]], [1, "You come into Granary Street.", LOG_LINES, "You come into Granary Street."]);

  const quiet = exploreRowOf(state, moved, "");
  assert.deepEqual([quiet.acts, quiet.said, quiet.log], [2, "", moved.log]);
  assert.equal(quiet.scene, undefined);
  assert.equal(exploreRowOf({ ...state, scene: "hanged-clerk" }, quiet, "").scene, "hanged-clerk");
});

test("the menu's keep and a fight on the map ride along with every move, and go to the table's columns and back (town-design §3.1)", () => {
  const kept: ExploreRow = {
    ...row,
    rested: { time: "morning", short: true }, spotted: { time: "morning", at: { x: 40, y: 9 }, by: "the pie-seller" }, lifted: { time: "morning", who: ["porter"] },
    fight: { map: "caerwyn", seed: 7, place: "Palace Street", combatants: [{ id: "player", name: "Wren Ashdown", side: "player", at: { x: 18, y: 9 } }, { id: "palace-guard", castId: "palace-guard", name: "a palace guard", side: "enemy", role: "bruiser", statblock: "guard", weapon: "spear", at: { x: 17, y: 9 } }] },
  };
  const moved = exploreRowOf(state, kept, "You come into Granary Street.");
  assert.deepEqual([moved.rested, moved.spotted, moved.lifted, moved.fight], [kept.rested, kept.spotted, kept.lifted, kept.fight]);
  assert.equal(exploreRowOf(state, row, "").rested, undefined, "none kept, none made up");

  const columns = keepColumns(kept);
  assert.deepEqual(columns.rested, { time: "morning", short: true, long: false });
  assert.equal(columns.fight!.combatants[0]!.statblock, undefined);
  assert.deepEqual(keepFromColumns(columns), { rested: kept.rested, spotted: kept.spotted, lifted: kept.lifted, fight: kept.fight });
  assert.deepEqual(keepFromColumns({ rested: undefined, spotted: undefined, lifted: undefined, fight: undefined }), {});
});

test("what the rules did to the town, on the map's own place, is the overlay's town again (town-design §3.3)", () => {
  const town: TownChanges = { things: { "caerwyn:door@25,6": { states: ["burning"], hp: 3, time: "morning" } } };
  const rows: MapRows = {
    maps: [], explore: row, story: { time: "morning", played: [] }, unheard: [],
    places: [{ key: "map:caerwyn", mapKey: "caerwyn", origin: { x: 0, y: 0 }, town: JSON.stringify(town), rows: emptyRows("map:caerwyn") }],
  };
  assert.deepEqual(exploreOf(rows).overlay.town, { caerwyn: town });
  assert.equal(exploreOf({ ...rows, places: [{ ...rows.places[0]!, town: "" }] }).overlay.town, undefined);
});

function emptyRows(key: string): MapRows["places"][number]["rows"] {
  return {
    place: { id: "1", key, name: "Caerwyn", rootId: "0", sizeW: 0, sizeH: 0, round: 0, rev: 0 },
    entity: [], position: [], area: [], material: [], health: [], stack: [], surface: [], creature: [], playerCharacter: [], gear: [], narrative: [], gmNote: [], worldLog: [],
  };
}
