import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { loadPlayableWorld } from "./fixtures.js";
import { ConversationTreeSession } from "../packages/conversation/src/conversation-tree.js";
import { compileConversationTree } from "../packages/lore/src/conversation-tree.js";
const source = 'export default async function run(services: HookServices): Promise<string> { const q = services.quests.read("assembly_programme"); await services.quests.setActive(q.id, true, q.revision); return "dynamic"; }';

test("source and reference publish together, execute after binding, and survive resume", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  const path = "Conversations/aldren.md", doc = await services.docs.read(path);
  const text = doc.text.replaceAll("hello-world.ts", "dynamic.ts");
  await assert.rejects(services.docs.replace(path, doc.sha, "#### Run: hello-world.ts", "#### Run: dynamic.ts"));
  await assert.rejects(services.docs.commit([{ path, expectedSha: doc.sha, text }]), /Missing hook/);
  await services.docs.commit([{ path: "Hooks/dynamic.ts", expectedSha: null, text: source }, { path, expectedSha: doc.sha, text }]);
  const hook = await services.docs.read("Hooks/dynamic.ts");
  await assert.rejects(services.docs.delete(hook.path, hook.sha), /Missing hook/);
  assert.equal((await services.docs.read(hook.path)).sha, hook.sha);
  const resumed = createScenarioServices(services.currentWorld());
  assert.equal(resumed.quests.read("assembly_programme").active, false);
  assert.equal(await resumed.hooks.bind()["dynamic.ts"]!(new AbortController().signal), "dynamic");
  assert.equal(resumed.quests.read("assembly_programme").active, true);
});

test("hook-only edits invalidate a pending dialogue decision and revoke old bindings", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  const path = "Conversations/aldren.md", id = "conversation-aldren-cushions";
  const doc = await services.docs.read(path);
  await services.docs.commit([{ path, expectedSha: doc.sha, text: doc.text.replace("### When: greeted -> hint", "### When: greeted -> hint").replace("## Node: hint", "#### Run: hello-world.ts\n\n## Node: hint") }]);
  const readTree = () => { const d = services.currentWorld().docs[path]!; return compileConversationTree({ body: d.body, metadata: d.frontmatter ?? {} }); };
  const oldBindings = services.hooks.bind();
  const session = new ConversationTreeSession(readTree(), services.quests, oldBindings, readTree, () => services.hooks.bind());
  const revision = services.quests.read(id).revision;
  await assert.rejects(session.evaluate([], { decisions: async (_evidence, questions) => {
    const hook = await services.docs.read("Hooks/hello-world.ts");
    await services.docs.insert(hook.path, hook.sha, 0, "// Changed while deciding\n");
    return Object.fromEntries(Object.keys(questions).map(key => [key, { choice: "hit", probabilities: { hit: 1 } }]));
  } }, new AbortController().signal, () => {}), /changed/);
  assert.equal(services.quests.read(id).revision, revision + 1);
  assert.equal(services.quests.read(id).currentStageId, "greeting");
  assert.equal(services.quests.read("assembly_programme").active, false);
  await assert.rejects(oldBindings["hello-world.ts"]!(new AbortController().signal), /changed/);
});
