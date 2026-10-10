import assert from "node:assert/strict";
import test from "node:test";
import { WorldGameRuntime, type WorldOptions } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./fixtures.js";

function options(seen: string[] = []): WorldOptions {
  return { services: {
    disclosure: { disclose: async () => [] },
    ai: {
      decisions: async (evidence, questions) => {
        const state = evidence as { node: string; conversation: { speaker: string; text: string }[] };
        const last = state.conversation.at(-1)!;
        let selected: string | undefined;
        if (state.node === "greeting" && last.speaker === "aldren") selected = "greeted";
        if (state.node === "hint" && last.speaker === "player") selected = "asked-for-details";
        if (state.node === "cushions" && last.speaker === "aldren") selected = "requested";
        if (state.node === "awaiting-answer" && last.speaker === "player") selected = last.text === "Yes" ? "agreed" : "declined";
        return Object.fromEntries(Object.keys(questions).map(id => [id, { choice: id === selected ? "hit" : "miss", probabilities: { hit: id === selected ? 1 : 0 } }]));
      },
      responses: async request => {
        assert.deepEqual(request.reasoning, { effort: "none" });
        assert.equal(request.tools, undefined);
        const goal = request.messages.findLast(message => message.role === "system" && message.content?.startsWith("Current conversation goal"))!.content!;
        seen.push(goal);
        const content = goal.includes("Greet the player") ? "Welcome, traveller."
          : goal.includes("Explain the cushion") ? "The cushions are late. Will you help?" : "Thank you for your answer.";
        return { role: "assistant", content };
      },
    },
  }, strategies: { conversation: { respond: ({ request }, signal, services) => services.character.respond(request, signal) } } };
}
const stage = (game: WorldGameRuntime) => game.services.quests.read("conversation-aldren-cushions").currentStageId;
async function requestHelp(game: WorldGameRuntime) {
  await game.checkedTalkToCharacter("aldren", "Hello");
  assert.equal(stage(game), "hint");
  await game.checkedTalkToCharacter("aldren", "What is wrong?");
  assert.equal(stage(game), "awaiting-answer");
}

test("fresh game goals activate the visible quest and persist through reload without replay", async () => {
  const seen: string[] = [], game = new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, options(seen));
  let writes = 0;
  game.setPersistence(async work => { writes++; return work(); });
  assert.equal(game.services.quests.read("assembly_programme").active, false);
  await requestHelp(game);
  await game.checkedTalkToCharacter("aldren", "Yes");
  assert.equal(stage(game), "helping");
  assert.equal(game.services.quests.read("assembly_programme").active, true);
  assert.match(JSON.stringify(game.view().activeQuests), /Assembly Programme/);
  assert.match(seen.at(-1)!, /Acknowledge the player's agreement/);
  assert.equal(game.debugCharacter("aldren").conversationTree!.scriptOutput, "Hello world! Assembly Programme is now active.");
  assert.ok(writes >= 7, "turns and tree effects go through host persistence");
  const saved = game.snapshot(), revision = game.services.quests.read("assembly_programme").revision;
  const resumed = new WorldGameRuntime(loadPlayableWorld(), "", saved, undefined, undefined, options());
  await resumed.checkedTalkToCharacter("aldren", "Thanks");
  assert.equal(stage(resumed), "helping");
  assert.equal(resumed.services.quests.read("assembly_programme").revision, revision);
  assert.equal(resumed.debugCharacter("aldren").conversationTree!.scriptOutput, undefined);
  game.movement.dispose(); resumed.movement.dispose();
});

test("declining in the game leaves Assembly Programme inactive", async () => {
  const game = new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, undefined, options());
  await requestHelp(game);
  await game.checkedTalkToCharacter("aldren", "No");
  assert.equal(stage(game), "declined");
  assert.equal(game.services.quests.read("assembly_programme").active, false);
  game.movement.dispose();
});

test("failed post-reply Jev preserves accepted speech and does not activate a quest", async () => {
  const config = options(), warnings: string[] = [];
  const decide = config.services!.ai!.decisions!;
  config.services!.ai!.decisions = async (state, ...args) => {
    if ((state as { conversation: { speaker: string }[] }).conversation.at(-1)!.speaker === "aldren") throw new Error("Jev unavailable");
    return decide(state, ...args);
  };
  const game = new WorldGameRuntime(loadPlayableWorld(), "", undefined, undefined, message => warnings.push(message), config);
  assert.equal(await game.checkedTalkToCharacter("aldren", "Hello"), "Welcome, traveller.");
  assert.match(JSON.stringify(game.snapshot().conversations.aldren), /Welcome, traveller\./);
  assert.match(JSON.stringify(game.snapshot().conversations.aldren), /Hello/);
  assert.equal(stage(game), "greeting");
  assert.equal(game.services.quests.read("assembly_programme").active, false);
  assert.match(warnings[0]!, /Jev unavailable/);
  game.movement.dispose();
});
