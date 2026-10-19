import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isTuneId, MUSIC_SLOTS, musicAssignmentProblems, withMusicAssignment, type MusicAssignments } from "./assignments.ts";
import { parseScene } from "../scene/document.ts";
import { sceneOf } from "../scene/load.ts";
import { loadMap } from "../scene/scenario.ts";
import { mapOf } from "../map/tiles.ts";

test("every scene and map music slot survives parsing into the game's live shapes", () => {
  const music = Object.fromEntries(MUSIC_SLOTS.map(slot => [slot, `caerwyn/${slot}`])) as MusicAssignments;
  const scene = JSON.parse(readFileSync(new URL("../../campaigns/caerwyn/scenes/hanged-clerk.kmscene", import.meta.url), "utf8"));
  scene.music = music;
  assert.deepEqual(sceneOf(parseScene(JSON.stringify(scene))).music, music);
  const map = JSON.parse(readFileSync(new URL("../../campaigns/caerwyn/maps/caerwyn.kmmap", import.meta.url), "utf8"));
  map.music = music;
  const loaded = loadMap(JSON.stringify(map));
  assert.deepEqual(loaded.music, music);
  assert.deepEqual(mapOf(loaded).map.music, music);
});

test("tune ids retain nested filenames while refusing folder traversal and malformed slots", () => {
  for (const id of ["Lanterns", "town/night", "A Quiet Street"]) assert.equal(isTuneId(id), true, id);
  for (const id of ["", "/town", "../town", "town/../menu", "town//night", "town\\night", "night.kmtune", "night.KMTUNE", "C:/night", " night", "town/."]) assert.equal(isTuneId(id), false, id);
  assert.deepEqual(musicAssignmentProblems(undefined), []);
  assert.deepEqual(musicAssignmentProblems({ night: "town/night", combat: "battle" }), []);
  assert.equal(musicAssignmentProblems({ dawn: "town", morning: 2, night: "../bad" }).length, 3);
  assert.equal(musicAssignmentProblems(["town"]).length, 1);
});

test("removing music assignments restores defaults without dropping the other hours", () => {
  const before = { morning: "town", combat: "fight" };
  assert.deepEqual(withMusicAssignment(before, "morning", ""), { combat: "fight" });
  assert.deepEqual(before, { morning: "town", combat: "fight" });
  assert.equal(withMusicAssignment({ combat: "fight" }, "combat", ""), undefined);
});
