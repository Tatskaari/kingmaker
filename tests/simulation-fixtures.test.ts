import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { Client } from "boardgame.io/client";
import { GamePhase } from "../packages/contracts/src/index.js";
import { SimulationStateSchema } from "../packages/contracts/src/v2.js";
import { interactWithFixture } from "../packages/core/src/simulation-fixtures.js";
import { fixtureActionMessage } from "../packages/core/src/fixtures.js";
import { executeLocalMove } from "../packages/core/src/local-move-executor.js";

const setup = () => create(SimulationStateSchema, { runtimeCharacters: { player: { id: "player", characterId: "player", inventory: {} } },
  map: { phase: GamePhase.CONVERSATIONS, actors: [{ characterId: "player", position: { x: 0, y: 0 } }],
    fixtures: [{ id: "chest", name: "Chest", container: true, position: { x: 1, y: 0 }, interactionSpot: { x: 0, y: 0 },
      inventory: { items: [{ id: "key", name: "Key", quantity: 1 }] } }] } });

test("fixture moves execute directly in boardgame.io and keep messages outside state", () => {
  const initial = setup();
  assert.equal(fixtureActionMessage(initial, "player", "open_chest"), "Chest opened. Key");
  assert.equal(initial.map!.fixtures[0]!.open, false);
  const client = Client({ game: { setup: () => initial, moves: { interactWithFixture } } });
  client.start();
  client.moves.interactWithFixture!("player", "open_chest", 1000);
  client.moves.interactWithFixture!("player", "take_key", 1000);
  const G = client.getState()!.G;
  assert.equal(G.map!.revision, 2);
  assert.equal(G.runtimeCharacters.player!.inventory!.items[0]!.id, "key");
  assert.equal(G.map!.fixtures[0]!.inventory!.items.length, 0);
  assert.equal(initial.map!.fixtures[0]!.open, false);
  client.stop();
});

test("a remote fixture interaction is rejected without publishing state", () => {
  const G = setup(); G.map!.actors[0]!.position!.x = 3;
  assert.throws(() => executeLocalMove(G, interactWithFixture, "player", "open_chest", 1000), /Invalid/);
  assert.equal(G.map!.fixtures[0]!.open, false);
  assert.equal(G.map!.revision, 0);
});
