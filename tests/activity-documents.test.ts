import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { DocumentSchema } from "../packages/contracts/src/v2.js";
import { loadPlayableWorld } from "./fixtures.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { characterEntry } from "../packages/lore/src/active-goal.js";
import { activityGoal, characterIntent, formatActivity, formatWait, intentContext, setIntent } from "../packages/lore/src/activity.js";

test("document activities preserve objective fields, enforce permission and publish with a character SHA", async () => {
  const services = createScenarioServices(loadPlayableWorld());
  const entry = characterEntry(services.scenario.info(), "corvin");
  const before = await services.docs.read(entry);
  const activity = entry.replace("character.md", "treasury.md"), wait = entry.replace("character.md", "wait.md");
  await services.docs.create(activity, formatActivity("corvin", { name: "Meet the player", status: "The player has not arrived.",
    success_criteria: "Meet the player in the treasury.", current_goal: "Go to the treasury and wait for the player." }));
  await services.docs.create(wait, formatWait("corvin", { name: "Watch for the player", instructions: "Continue until you see the player.", activities: [activity] }));
  const expected = characterIntent(services.scenario.read(), "corvin");
  await setIntent(services, before, { activity, wait });
  assert.equal(activityGoal(services.scenario.read(), "corvin"), "Go to the treasury and wait for the player.");
  assert.match(intentContext(services.scenario.read(), "corvin"), /success_criteria: Meet the player/);
  await assert.rejects(setIntent(services, before, { activity: null, wait }, before.document.body, expected), /document changed/);
  const fresh = await services.docs.read(entry);
  await setIntent(services, fresh, { activity: null, wait });
  assert.equal(activityGoal(services.scenario.read(), "corvin"), null);
  assert.equal(characterIntent(services.scenario.read(), "corvin").wait, wait);
  const restored = createScenarioServices(services.scenario.read());
  assert.equal(characterIntent(restored.scenario.read(), "corvin").wait, wait);
});

test("intent references cannot expose other characters or GM documents", async () => {
  const world = loadPlayableWorld();
  world.docs["secret.md"] = create(DocumentSchema, { frontmatter: { visibility: "gm" }, body: "SECRET" });
  const services = createScenarioServices(world), entry = characterEntry(services.scenario.info(), "corvin");
  await assert.rejects(setIntent(services, await services.docs.read(entry), { activity: null, wait: "secret.md" }), /No read access/);
  const other = entry.replace("/corvin/", "/elinor/").replace("character.md", "task.md");
  await services.docs.create(other, formatActivity("elinor", { name: "Secret", status: "Private", success_criteria: "Private", current_goal: "Private" }));
  const wait = entry.replace("character.md", "wait.md");
  await services.docs.create(wait, formatWait("corvin", { name: "Wait", instructions: "Wait", activities: [other] }));
  await assert.rejects(setIntent(services, await services.docs.read(entry), { activity: null, wait }), /No read access/);
});
