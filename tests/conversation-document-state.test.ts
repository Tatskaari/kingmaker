import assert from "node:assert/strict";
import test from "node:test";
import { fromJson, toJson } from "@bufbuild/protobuf";
import { WorldStateSchema } from "../packages/contracts/src/v2.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { loadConversationWorld } from "../scripts/lib/conversation-world.js";
import { documentLore } from "../packages/conversation/src/document-lore.js";
import { conversationRequest } from "../packages/conversation/src/conversation.js";

test("CLI builds Markdown state, discloses edited documents and reloads independently of the vault", async () => {
  const services = createScenarioServices(loadConversationWorld("lore", "Centennial Assembly"));
  const lore = await documentLore(services.scenario, "corvin");
  assert.equal(lore.initial.length, 2);
  const entry = services.scenario.info().characters.find(path => path.includes("/corvin/"))!;
  assert.ok((await services.docs.read(entry)).document.characterProperties?.dnd);
  const link = lore.links(lore.initial)[0]!;
  const original = await services.docs.read(link.path);
  await services.docs.insert(link.path, original.sha, original.text.trimEnd().split("\n").length, "\nUPDATED_FACT");
  const opened = await lore.open(link, new AbortController().signal);
  assert.match(opened.markdown, /UPDATED_FACT/);
  const saved = toJson(WorldStateSchema, services.scenario.snapshot());
  const restored = createScenarioServices(fromJson(WorldStateSchema, saved));
  assert.match((await restored.docs.read(link.path)).text, /UPDATED_FACT/);
  const request = conversationRequest({ snapshot: { world: restored.scenario.snapshot() }, characterId: "corvin", sources: [...lore.initial, opened], transcript: [], message: "Hello" });
  assert.ok(request.messages.some(message => message.content?.includes("UPDATED_FACT")));
  assert.ok(request.messages.every(message => !message.content?.includes('"abilityScores"')));
  await assert.rejects(documentLore(services.scenario, "missing"), /Unknown scenario character/);
  const changed = await services.docs.read(link.path);
  const text = changed.text.replace(/visibility: \w+/, "visibility: gm");
  if (text !== changed.text) {
    await services.docs.replace(link.path, changed.sha, changed.text, text);
    await assert.rejects(lore.open(link, new AbortController().signal), /No read access/);
  }
});
