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

import { participantPresentations, relativePower } from "../packages/conversation/src/participant-presentation.js";
import { prepareConversation, conversationRequest } from "../packages/conversation/src/conversation.js";
import { setupWorldAgent } from "../apps/web/src/agent-setup.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";

test("relative power compares total levels without exposing exact numbers", () => {
  assert.match(relativePower(3, 3), /roughly/);
  assert.match(relativePower(5, 3), /roughly/);
  assert.match(relativePower(6, 3), /more formidable/);
  assert.match(relativePower(9, 3), /far more/);
  assert.match(relativePower(3, 6), /less formidable/);
  assert.match(relativePower(3, 9), /far less/);
  assert.match(relativePower(0, 3), /unclear/);
});

test("participant descriptions include identity and public prose, never private stats or lore", () => {
  const world = loadPlayableWorld(), player = world.docs[world.player!]!;
  player.body = "SECRET BIOGRAPHY";
  player.characterProperties!.dnd!.speciesId = "elf";
  world.docs[presentationPath(world.player!)]!.body = "A tattered coat and shaggy hair.";
  const messages = participantPresentations(world, "aldren", ["aldren", "player", "player"]);
  assert.equal(messages.length, 1);
  assert.match(messages[0]!.content!, /Before you stands Visiting Envoy, a .* elf/);
  assert.match(messages[0]!.content!, /tattered coat/);
  assert.doesNotMatch(messages[0]!.content!, /SECRET BIOGRAPHY|hitPoints|abilityScores|proficiencies/);
  world.docs[presentationPath(world.player!)]!.frontmatter!.visibility = "gm";
  assert.doesNotMatch(participantPresentations(world, "aldren", ["player"])[0]!.content!, /tattered coat/);
  assert.deepEqual(participantPresentations(world, "aldren", ["missing"]), []);
});

test("dialogue previews, live turns and NPC exchanges get current participant presentations", async () => {
  const world = loadPlayableWorld(), services = createScenarioServices(world);
  const runtime = new ConversationRuntime({ services: { ...services,
    map: { observe: characterId => ({ characterId, map: world.map!, actions: [] }) },
    lore: { forCharacter: async () => ({ initial: [], links: () => [], open: async () => { throw new Error("unused"); } }) },
  }, hooks: { setup: setupWorldAgent } });
  const input = { snapshot: { world }, characterId: "aldren", sources: [], transcript: [], message: "Hello" };
  assert.match(conversationRequest(input).messages.map(item => item.content).join("\n"), /Before you stands Visiting Envoy/);
  const path = presentationPath(world.player!), before = await services.docs.read(path);
  await services.docs.replace(path, before.sha, before.document.body, "A freshly mended coat.");
  const request = await prepareConversation(input, runtime.services);
  assert.equal(request.messages.filter(item => item.content?.includes("Before you stands Visiting Envoy")).length, 1);
  assert.match(request.messages.map(item => item.content).join("\n"), /freshly mended coat/);
  const exchange = await runtime.services.agents.prepare({ agent: "exchange", characterId: "aldren",
    participantIds: ["aldren", "corvin"], sources: [], messages: [] }, new AbortController().signal);
  assert.match(exchange.map(item => item.content).join("\n"), /Before you stands Magister Corvin/);
  assert.doesNotMatch(exchange.map(item => item.content).join("\n"), /Before you stands Visiting Envoy/);
});
