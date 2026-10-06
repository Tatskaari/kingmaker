import { create } from "@bufbuild/protobuf";
import { INVALID_MOVE } from "boardgame.io/core";
import { Client } from "boardgame.io/client";
import type { Game } from "boardgame.io";
import assert from "node:assert/strict";
import test from "node:test";
import { SimulationStateSchema, type SimulationState } from "../packages/contracts/src/v2.js";
import type { SimulationMoveContext } from "../packages/core/src/simulation-move.js";
import { executeLocalMove } from "../packages/core/src/local-move-executor.js";

const setup = () => create(SimulationStateSchema, { runtimeCharacters: { player: { id: "player" } }, map: { revision: 0 } });
function advance({ G }: SimulationMoveContext, revision: number) {
  G.map!.revision = revision;
  if (revision < 0) return INVALID_MOVE;
}

test("local executor uses structural sharing and discards rejected drafts", () => {
  const before = setup();
  const after = executeLocalMove(before, advance, 1);
  assert.equal(before.map!.revision, 0);
  assert.equal(after.map!.revision, 1);
  assert.equal(after.runtimeCharacters, before.runtimeCharacters);
  assert.throws(() => executeLocalMove(after, advance, -1), /Invalid simulation move/);
  assert.equal(after.map!.revision, 1);
  assert.throws(() => executeLocalMove(after, ({ G }) => {
    G.map!.revision = 99;
    throw new Error("Unexpected failure");
  }), /Unexpected failure/);
  assert.equal(after.map!.revision, 1);
});

test("the same move registers directly in a boardgame.io game", () => {
  const game: Game<SimulationState> = { setup, moves: { advance } };
  const client = Client({ game });
  client.moves.advance!(2);
  assert.deepEqual(client.getState()!.G, executeLocalMove(setup(), advance, 2));
  client.moves.advance!(-1);
  assert.equal(client.getState()!.G.map!.revision, 2);
});
