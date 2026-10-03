import assert from "node:assert/strict";
import test from "node:test";
import { charactersWithinEarshot, courtCharactersWithinEarshot, perceivesAt } from "../apps/web/src/earshot.js";
import { loadPlayableWorld } from "./fixtures.js";

test("player has greater perception range and chances without changing NPC odds", () => {
  const source = { id: "rowan", name: "Rowan", position: { x: 0, y: 0 } };
  for (const [distance, playerLevel, npcLevel] of [[6, "Clear", "Moderate"], [10, "Moderate", "Distant"], [15, "Distant", undefined], [16, undefined, undefined]] as const) {
    const listeners = charactersWithinEarshot(source, ["player", "holt"].map(id => ({ id, name: id, position: { x: distance, y: 0 } })));
    assert.equal(listeners.find(listener => listener.id === "player")?.level, playerLevel);
    assert.equal(listeners.find(listener => listener.id === "holt")?.level, npcLevel);
  }
  assert.equal(perceivesAt("Moderate", () => 0.89, true), true);
  assert.equal(perceivesAt("Moderate", () => 0.9, true), false);
  assert.equal(perceivesAt("Moderate", () => 0.6), false);
  assert.equal(perceivesAt("Distant", () => 0.59, true), true);
  assert.equal(perceivesAt("Distant", () => 0.6, true), false);
  assert.equal(perceivesAt("Distant", () => 0.3), false);
});

test("player perception still respects closed doors", () => {
  const world = loadPlayableWorld();
  const door = world.map!.doors.find(door => door.interactionSpots.length >= 2)!;
  const source = { id: "rowan", name: "Rowan", position: door.interactionSpots[0]! };
  const player = { id: "player", name: "Player", position: door.interactionSpots[1]! };
  const doors = world.map!.doors.map(item => ({ ...item, open: item.id === door.id }));
  assert.equal(courtCharactersWithinEarshot(source, [player], doors).length, 1);
  assert.equal(courtCharactersWithinEarshot(source, [player], doors.map(item => ({ ...item, open: false }))).length, 0);
});
