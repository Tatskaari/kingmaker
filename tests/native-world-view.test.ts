import assert from "node:assert/strict";
import test from "node:test";
import { create, toJson } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole } from "../packages/contracts/src/index.js";
import { WorldHost } from "../apps/web/src/world-host.js";
import { loadPlayableWorld } from "./fixtures.js";

test("browser view reads document presentation and preserves physical bodies and private transcripts", t => {
  const world = loadPlayableWorld(), entry = world.characters.find(path => path.includes("/rowan/"))!;
  world.docs[entry]!.frontmatter!.name = "Renamed Rowan";
  world.docs[world.player!]!.body = "Player biography.";
  const host = new WorldHost(world), saved = host.snapshot();
  saved.conversations.rowan = [TranscriptRole.PLAYER, TranscriptRole.CHARACTER, TranscriptRole.GAME_MASTER].map(role =>
    toJson(TranscriptMessageSchema, create(TranscriptMessageSchema, { role, text: String(role) })));
  host.restore(saved);
  const before = host.snapshot();
  t.mock.method(host as any, "projection", () => { throw new Error("Unexpected legacy projection"); });
  const view = host.view() as any;
  assert.equal(view.player.lore, "Player biography.");
  assert.equal(view.characters.find((character: any) => character.id === "rowan").name, "Renamed Rowan");
  assert.equal(view.characters.filter((character: any) => character.id === "palace-guard").length,
    world.map!.actors.filter(actor => actor.characterId === "palace-guard").length);
  assert.deepEqual(view.conversations.rowan.map((message: any) => message.role), ["player", "character"]);
  assert.deepEqual(host.snapshot(), before);
});
