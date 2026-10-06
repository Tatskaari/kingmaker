import { stringify } from "yaml";
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
  assert.ok(services.scenario.snapshot().simulation!.runtimeCharacters.corvin?.dnd);
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
  await assert.rejects(documentLore(services.scenario, "missing"), /Unknown runtime character/);
  const changed = await services.docs.read(link.path);
  const text = changed.text.replace(/visibility: \w+/, "visibility: gm");
  if (text !== changed.text) {
    await assert.rejects(services.docs.replace(link.path, changed.sha, changed.text, text), /denied/);
    assert.match((await lore.open(link, new AbortController().signal)).markdown, /UPDATED_FACT/);
  }
});

test("saved document labels authorize retrieval and unsafe revocation is rejected", async () => {
  const services = createScenarioServices(loadConversationWorld("lore", "Centennial Assembly"));
  const entry = services.scenario.info().characters.find(path => path.includes("/corvin/"))!;
  const original = await services.docs.read(entry);
  // Add an isolated label while preserving the authored character's baseline access.
  const labelled = `---\n${stringify({ ...original.document.frontmatter, labels: [...(original.document.frontmatter?.labels as string[] ?? []), "test-court"] })}---\n${original.document.body}`;
  await services.docs.replace(entry, original.sha, original.text, labelled);
  const first = await documentLore(services.scenario, "corvin");
  const link = first.links(first.initial)[0]!;
  const detail = await services.docs.read(link.path);
  const shared = "---\nvisibility: private\nreaders: ['label:test-court']\n---\nShared court facts.";
  await services.docs.replace(link.path, detail.sha, detail.text, shared);
  const restored = createScenarioServices(fromJson(WorldStateSchema, toJson(WorldStateSchema, services.scenario.snapshot())));
  const lore = await documentLore(restored.scenario, "corvin");
  assert.ok(lore.links(lore.initial).some(candidate => candidate.path === link.path));
  assert.equal((await lore.open(link, new AbortController().signal)).markdown, "Shared court facts.");
  const current = await restored.docs.read(entry);
  const revoked = `---\n${stringify({ ...current.document.frontmatter, labels: (current.document.frontmatter?.labels as string[]).filter(label => label !== "test-court") })}---\n${current.document.body}`;
  await assert.rejects(restored.docs.replace(entry, current.sha, current.text, revoked), /denied/);
  assert.equal((await lore.open(link, new AbortController().signal)).markdown, "Shared court facts.");
});

test("saved-world candidate previews use current summaries and check access first", async () => {
  const services = createScenarioServices(loadConversationWorld("lore", "Centennial Assembly"));
  const lore = await documentLore(services.scenario, "aldren");
  const link = lore.links(lore.initial).find(link => link.path.endsWith("/court_briefing.md"))!;
  const original = await services.docs.read(link.path);
  const text = `---\n${stringify({ ...original.document.frontmatter, summary: "Court delegations, including wizards." })}---\n${original.document.body}`;
  await services.docs.replace(link.path, original.sha, original.text, text);
  assert.equal(lore.links(lore.initial).find(candidate => candidate.path === link.path)?.summary, "Court delegations, including wizards.");
  const restored = createScenarioServices(fromJson(WorldStateSchema, toJson(WorldStateSchema, services.scenario.snapshot())));
  const reloaded = await documentLore(restored.scenario, "aldren");
  assert.equal(reloaded.links(reloaded.initial).find(candidate => candidate.path === link.path)?.summary, "Court delegations, including wizards.");
  const current = await restored.docs.read(link.path);
  // A malformed summary on a forbidden note must not be inspected before access is denied.
  const forbidden = `---\n${stringify({ ...current.document.frontmatter, visibility: "gm", summary: ["secret"] })}---\n${current.document.body}`;
  await assert.rejects(restored.docs.replace(link.path, current.sha, current.text, forbidden), /denied/);
  // Read-time checks remain a second defence against malformed imported state.
  const unsafe = restored.scenario.snapshot();
  unsafe.docs[link.path]!.frontmatter = { visibility: "gm", summary: ["secret"] };
  const protectedLore = await documentLore(createScenarioServices(unsafe).scenario, "aldren");
  assert.throws(() => protectedLore.links(protectedLore.initial), /No read access/);
});

test("saved-world faction grants use current entry membership and reject unsafe revocation", async () => {
  const services = createScenarioServices(loadConversationWorld("lore", "Centennial Assembly"));
  const entry = services.scenario.info().characters.find(path => path.includes("/aldren/"))!;
  const character = await services.docs.read(entry);
  await services.docs.replace(entry, character.sha, character.text,
    `---\n${stringify({ ...character.document.frontmatter, factions: ["test-academy"] })}---\n${character.document.body}`);
  await services.docs.create("Academic.md", "---\nvisibility: private\nreaders: ['faction:test-academy']\nsummary: Private academic history.\n---\nACADEMIC_FACT");
  const member = await services.docs.read(entry);
  await services.docs.replace(entry, member.sha, member.text, member.text + "\n[[Academic]]");
  const first = await documentLore(services.scenario, "aldren");
  const link = first.links(first.initial).find(link => link.path === "Academic.md")!;
  const restored = createScenarioServices(fromJson(WorldStateSchema, toJson(WorldStateSchema, services.scenario.snapshot())));
  const lore = await documentLore(restored.scenario, "aldren");
  assert.equal(lore.links(lore.initial).find(candidate => candidate.path === link.path)?.summary, "Private academic history.");
  assert.equal((await lore.open(link, new AbortController().signal)).markdown, "ACADEMIC_FACT");
  const current = await restored.docs.read(entry);
  await assert.rejects(restored.docs.replace(entry, current.sha, current.text,
    `---\n${stringify({ ...current.document.frontmatter, factions: [] })}---\n${current.document.body}`), /denied/);
  assert.equal((await lore.open(link, new AbortController().signal)).markdown, "ACADEMIC_FACT");
});
