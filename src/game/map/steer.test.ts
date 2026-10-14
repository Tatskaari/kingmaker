import { test } from "node:test";
import assert from "node:assert/strict";
import { move, newExploration, SCREEN_KEYS, steer } from "./index.ts";

// The river stairs at dusk, where a bare arrow key keeps catching on the walls.
const stairs = () => Object.assign(newExploration({ time: "evening", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} }), { map: "caerwyn", at: { x: 24, y: 34 } });

test("an arrow key follows the street where its bare step would catch on a corner", () => {
  for (const key of ["right", "down", "left"]) {
    const bare = stairs(), steered = stairs();
    let bareMoves = 0, steeredMoves = 0;
    for (let i = 0; i < 5; i++) {
      if (move(bare, ...SCREEN_KEYS[key]!).moved) bareMoves++;
      const r = move(steered, ...steer(steered, ...SCREEN_KEYS[key]!));
      if (r.moved || r.travelled) steeredMoves++;
    }
    assert.ok(steeredMoves > bareMoves, `${key}: steered ${steeredMoves}, bare ${bareMoves}`);
  }
});

test("holding right on the river stairs goes through the Drowned Rat's door", () => {
  const ex = stairs();
  let through = false;
  for (let i = 0; i < 4 && !through; i++) through = !!move(ex, ...steer(ex, ...SCREEN_KEYS.right!)).travelled;
  assert.ok(through);
  assert.equal(ex.map, "drowned-rat");
});

test("steering never turns you back", () => {
  const ex = stairs();
  for (const key of Object.keys(SCREEN_KEYS)) {
    const [kx, ky] = SCREEN_KEYS[key]!;
    const [dx, dy] = steer(ex, kx, ky);
    // Within 45 degrees of the key's own step: never against it.
    assert.ok(dx * kx + dy * ky > 0, `${key}: ${dx},${dy}`);
  }
});
