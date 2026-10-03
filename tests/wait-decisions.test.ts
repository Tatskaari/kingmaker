import assert from "node:assert/strict";
import test from "node:test";
import { create, toJson, fromJson } from "@bufbuild/protobuf";
import { DocumentSchema, WorldStateSchema } from "../packages/contracts/src/v2.js";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { activityGoal, characterIntent } from "../packages/lore/src/activity.js";
import { commitReview, loadPlayableWorld, assignActivity } from "./fixtures.js";

const id = "corvin";
function fixture() {
  const world = loadPlayableWorld();
  assignActivity(world, id, "Speak to the player.");
  const { entry, activity } = characterIntent(world, id), wait = entry.replace("character.md", "routine.md");
  world.docs[wait] = create(DocumentSchema, { frontmatter: { visibility: "private", readers: [`character:${id}`], activities: [activity!] },
    body: "When you see the player, stop_waiting to decide what to do. Otherwise continue." });
  world.docs[entry]!.frontmatter = { ...world.docs[entry]!.frontmatter, activity: null, wait };
  return { world, entry, activity, wait };
}

test("wait decisions continue without an LLM, activate listed documents, or clear wait before reconsideration", async () => {
  for (const choice of ["continue", "activate", "stop_waiting"]) {
    const { world, activity, wait } = fixture(); let reviews = 0;
    const game = new WorldGameRuntime(world, "", undefined, undefined, undefined, { services: {
      disclosure: { disclose: async () => [] }, ai: {
        decisions: async (state, questions) => {
          assert.match(JSON.stringify(state), /elapsedSeconds/);
          assert.ok(questions.waiting!.criteria[`set_activity:${activity}`]);
          return { waiting: { choice: choice === "activate" ? `set_activity:${activity}` : choice, probabilities: {} } };
        },
        responses: async request => {
          reviews++; assert.equal(characterIntent(game.world(), id).wait, null);
          assert.match(JSON.stringify(request), /wait has ended/);
          return commitReview({ summary: "Begin", newNotes: [], activeGoal: "Speak to the player." });
        },
      },
    } });
    await game.checkWait(id, 15);
    assert.equal(reviews, choice === "stop_waiting" ? 1 : 0);
    assert.equal(characterIntent(game.world(), id).wait, choice === "continue" ? wait : null);
    assert.equal(!!activityGoal(game.world(), id), choice !== "continue");
    assert.equal(game.snapshot().pendingWaitReviews?.[id], undefined);
  }
});

test("wait checks omit remote actors and reject stale decisions when the player moves", async () => {
  const { world, wait } = fixture();
  const game = new WorldGameRuntime(world, "", undefined, undefined, undefined, { services: {
    disclosure: { disclose: async () => [] }, ai: { decisions: async state => {
      const text = JSON.stringify(state);
      assert.doesNotMatch(text, /"id":"player"/);
      const snapshot = game.snapshot(), next = fromJson(WorldStateSchema, snapshot.world);
      const actor = next.map!.actors.find(actor => actor.characterId === id)!;
      Object.assign(next.map!.actors.find(actor => actor.characterId === "player")!, { roomId: actor.roomId, position: { ...actor.position! } });
      snapshot.world = toJson(WorldStateSchema, next); game.restore(snapshot);
      return { waiting: { choice: "stop_waiting", probabilities: {} } };
    }, responses: async () => assert.fail("Stale observation must not wake the LLM") },
  } });
  await game.checkWait(id, 15);
  assert.equal(characterIntent(game.world(), id).wait, wait);
});

test("completion returns to routine; failed wake reviews survive reload and retry without another Jev decision", async () => {
  const { world, activity, entry, wait } = fixture();
  world.docs[entry]!.frontmatter!.activity = activity!;
  let fail = true, decisions = 0;
  const options = { services: { disclosure: { disclose: async () => [] }, ai: {
    decisions: async () => { decisions++; return { waiting: { choice: "stop_waiting", probabilities: {} } }; },
    responses: async () => { if (fail) throw new Error("offline"); return commitReview({ summary: "Ready", newNotes: [], activeGoal: "Speak to the player." }); },
  } } };
  const game = new WorldGameRuntime(world, "", undefined, undefined, undefined, options);
  game.finishNpcRun(id, "complete", "Done");
  await game.reviewNpcOutcome(id);
  assert.equal(characterIntent(game.world(), id).activity, null);
  assert.equal(characterIntent(game.world(), id).wait, wait);
  await assert.rejects(game.checkWait(id, 15), /offline/);
  assert.equal(characterIntent(game.world(), id).wait, null);
  assert.ok(game.snapshot().pendingWaitReviews?.[id]);
  const restored = new WorldGameRuntime(world, "", game.snapshot(), undefined, undefined, options);
  fail = false;
  await restored.checkWait(id, 30);
  assert.equal(decisions, 1);
  assert.equal(activityGoal(restored.world(), id), "Speak to the player.");
});
