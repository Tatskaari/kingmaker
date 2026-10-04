import assert from "node:assert/strict";
import test from "node:test";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { presentationPath, seedPresentation } from "../packages/lore/src/presentation.js";
import { characterCreationWorld } from "../apps/web/src/playable-world.js";
import { loadPlayableWorld } from "./fixtures.js";

test("fresh games seed public presentations for all characters without copying secrets", () => {
  const world = loadPlayableWorld();
  for (const entry of [...world.characters, world.player!]) {
    const doc = world.docs[presentationPath(entry)]!;
    assert.equal(doc.frontmatter?.visibility, "public");
    assert.ok(doc.frontmatter?.summary);
    assert.ok(doc.body);
  }
  const entry = world.characters[0]!;
  delete world.docs[presentationPath(entry)];
  world.docs[entry]!.body = "Secret allegiance to the Stranger.";
  world.docs[entry]!.characterProperties!.inventory!.items.push({
    ...world.docs[entry]!.characterProperties!.inventory!.items[0]!, name: "Secret poison", concealed: true,
  });
  world.docs[entry]!.characterProperties!.inventory!.items[0]!.details = "SECRET ITEM MECHANICS";
  seedPresentation(world, entry);
  assert.doesNotMatch(world.docs[presentationPath(entry)]!.body, /Secret|Stranger|SECRET ITEM MECHANICS/);
  assert.equal(characterCreationWorld(world).docs[presentationPath(world.player!)], undefined);
});

test("GM presentation edits survive saving without being regenerated", async () => {
  const world = loadPlayableWorld(), entry = world.characters[0]!, path = presentationPath(entry);
  const services = createScenarioServices(world), before = await services.docs.read(path);
  await services.docs.replace(path, before.sha, before.document.body, "A tattered coat and matted hair look out of place at court.");
  const restored = fromBinary(WorldStateSchema, toBinary(WorldStateSchema, services.scenario.snapshot()));
  seedPresentation(restored, entry);
  assert.equal(restored.docs[path]!.body.trim(), "A tattered coat and matted hair look out of place at court.");
});
