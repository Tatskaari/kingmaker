import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "@bufbuild/protobuf";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { WorldHeadlessGame } from "../packages/headless/src/world.js";
import { assignActivity, loadPlayableWorld } from "./fixtures.js";

test("status reads, headless advancement and resets never export or reload a save", async t => {
  const world = loadPlayableWorld();
  assignActivity(world, "corvin", "Watch the hall");
  const game = new WorldHeadlessGame(world), runtime = game.runtime;
  t.mock.method(runtime, "snapshot", () => { throw new Error("Unexpected save export"); });
  t.mock.method(runtime, "restore", () => { throw new Error("Unexpected save load"); });
  assert.equal(runtime.hasActiveObjective("corvin"), true);
  assert.equal(runtime.needsNpcReview("corvin"), false);
  runtime.finishNpcRun("corvin", "complete", "Done");
  assert.equal(runtime.hasActiveObjective("corvin"), false);
  assert.equal(runtime.needsNpcReview("corvin"), true);
  assert.deepEqual(await game.advanceNpc("corvin"), { actions: [], jail: undefined });
  runtime.resetCharacters();
  assert.equal(runtime.hasActiveObjective("corvin"), true);
  assert.equal(runtime.needsNpcReview("corvin"), false);
  runtime.reset();
  assert.equal(runtime.hasActiveObjective("corvin"), true);
});

test("character reset stages changes and preserves unrelated live references", () => {
  const world = loadPlayableWorld(), runtime = new WorldGameRuntime(world, "");
  const current = runtime.world(), map = current.simulation!.map!, player = current.docs[current.player!]!;
  const entry = current.characters.find(path => path.endsWith("/rowan/character.md"))!;
  current.docs[entry]!.body += "\nA new memory.";
  const revision = current.simulation!.runtimeCharacters.rowan!.intentRevision;
  runtime.resetCharacters();
  assert.equal(runtime.world(), current);
  assert.equal(current.simulation!.map, map);
  assert.equal(current.docs[current.player!], player);
  assert.equal(current.docs[entry]!.body, world.docs[entry]!.body);
  assert.equal(current.simulation!.runtimeCharacters.rowan!.intentRevision, revision + 1);
  // A reset that would restore a now-missing lore reference must publish nothing.
  const target = current.docs[entry]!.links[0]!.target;
  delete current.docs[target];
  const docs = current.docs, actors = current.simulation!.runtimeCharacters;
  assert.throws(() => runtime.resetCharacters());
  assert.equal(current.docs, docs);
  assert.equal(current.simulation!.runtimeCharacters, actors);
});

test("saved games detach nested world metadata and activity on both export and load", () => {
  const world = loadPlayableWorld(), entry = world.characters[0]!;
  world.docs[entry]!.frontmatter!.copyProbe = { tags: ["original"] };
  const runtime = new WorldGameRuntime(world, ""), saved = runtime.snapshot();
  saved.jail = { characterId: "rowan", message: "Held" };
  const restored = new WorldGameRuntime(loadPlayableWorld(), "", saved);
  const docs = (saved.world as JsonObject).docs as JsonObject;
  const metadata = (docs[entry] as JsonObject).frontmatter as JsonObject;
  ((metadata.copyProbe as JsonObject).tags as string[]).push("changed export");
  saved.jail.message = "Changed export";
  assert.deepEqual(runtime.world().docs[entry]!.frontmatter!.copyProbe, { tags: ["original"] });
  assert.deepEqual(restored.world().docs[entry]!.frontmatter!.copyProbe, { tags: ["original"] });
  const jail = restored.jail()!;
  assert.equal(jail.message, "Held");
  jail.message = "Changed getter";
  assert.equal(restored.jail()!.message, "Held");
});
