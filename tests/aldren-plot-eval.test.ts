import assert from "node:assert/strict";
import test from "node:test";
import { aldrenPlotCase, createAldrenPlotExperiment } from "../packages/evals/src/aldren-plot-case.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { GameMasterTools, gameMasterTools } from "../packages/conversation/src/gm-tools.js";
import { runExperiment } from "../packages/evals/src/experiment.js";
import { renderPrompt } from "../packages/prompts/src/index.js";
import type { AiService } from "../packages/conversation/src/services.js";

test("plot fixture constructs independent worlds at the delegation boundary", () => {
  const first = aldrenPlotCase.loadWorld([]), second = aldrenPlotCase.loadWorld([]);
  assert.deepEqual(first.quests.assembly_programme!.quest!.stages.map(stage => stage.id),
    ["investigate_missing_pillows", "cart_blocked", "cart_unblocked"]);
  assert.equal(first.quests.assembly_programme!.currentStageId, "investigate_missing_pillows");
  assert.equal(first.quests["conversation-aldren-cushions"]!.currentStageId, "helping");
  const path = first.simulation!.runtimeCharacters.aldren!.activity!;
  assert.match(first.docs[path]!.frontmatter!.current_goal as string, /Locate Marshal/);
  first.docs[path]!.body = "changed";
  assert.notEqual(second.docs[path]!.body, "changed");
});

test("baseline plot review includes promoted guidance once beside the quest transcript candidate", async () => {
  let requests = 0;
  const ai: AiService = {
    responses: async request => {
      requests++;
      assert.equal(request.reasoning?.effort, "high");
      assert.ok(!request.tools?.some(tool => tool.function.name === "set_activity"));
      assert.ok(request.tools?.some(tool => tool.function.name === "query_documents"));
      const text = request.messages.map(message => message.content ?? "").join("\n");
      for (const guidance of [renderPrompt("gm-prompt-gm_base_prompt"), renderPrompt("review-focused")]) {
        assert.equal(text.split(guidance).length - 1, 1);
      }
      assert.match(text, /provide an appropriate future report, invitation or choice/);
      assert.ok(!text.includes("{{youAreTheGameMaster}}"));
      assert.ok(!text.includes("refers back to the main GM guidance"));
      assert.match(text, /<quests>/);
      assert.match(text, /<conversation-trees>/);
      return { role: "assistant", content: "No changes." };
    },
    decisions: async (_evidence, questions) => Object.fromEntries(Object.keys(questions).map(key => [key,
      { choice: "complete", probabilities: { complete: 1 } }])),
  };
  const experiment = createAldrenPlotExperiment(() => ai, ai);
  assert.deepEqual(experiment.getVariants().map(variant => variant.name), ["quest-transcript"]);
  const trials = await runExperiment(experiment, { repeats: 1, concurrency: 1 });
  assert.equal(trials.length, 1);
  assert.equal(trials[0]!.variant, "game");
  assert.ok(trials.every(trial => !trial.recording.error && !trial.scoringError));
  assert.equal(requests, 1);
});

test("GM SQL searches live docs and returns recoverable read-only errors", async () => {
  const services = new ConversationRuntime({ services: createScenarioServices(aldrenPlotCase.loadWorld([])) }).services;
  const gm = new GameMasterTools(services, "aldren");
  assert.ok(gameMasterTools.some(tool => tool.function.name === "query_documents"));
  const result = await gm.call("query_documents", { sql: "SELECT path FROM docs WHERE path = 'Conversations/holt.md'" });
  assert.deepEqual(result, { ok: true, columns: ["path"], rows: [{ path: "Conversations/holt.md" }], truncated: false });
  const invalid = await gm.call("query_documents", { sql: "DELETE FROM docs" });
  assert.equal((invalid as { ok: boolean }).ok, false);
  assert.ok((await services.docs.read("Conversations/holt.md")).document.body);
});

test("plot grading permits validated definition updates while preserving quest progress", async () => {
  let called = false;
  const ai: AiService = {
    responses: async request => {
      if (called) return { role: "assistant", content: "Guidance updated." };
      called = true;
      // Read the tree version through the GM tools before editing it.
      return { role: "assistant", content: null, tool_calls: [{ id: "read", type: "function", function: {
        name: "read_document", arguments: JSON.stringify({ path: "Conversations/aldren.md" }),
      } }] };
    },
    decisions: async (_evidence, questions) => Object.fromEntries(Object.keys(questions).map(key => [key,
      { choice: "complete", probabilities: { complete: 1 } }])),
  };
  const respond = ai.responses;
  ai.responses = async (request, ...args) => {
    const tool = request.messages.at(-1);
    if (tool?.role === "tool" && tool.tool_call_id === "read") {
      const snapshot = JSON.parse(tool.content!).current;
      return { role: "assistant", content: null, tool_calls: [{ id: "edit", type: "function", function: {
        name: "replace_document", arguments: JSON.stringify({ path: snapshot.path, expectedSha: snapshot.sha,
          oldText: "Greet the player.", newText: "Greet the player and offer an update." }),
      } }] };
    }
    return respond(request, ...args);
  };
  const [trial] = await runExperiment(createAldrenPlotExperiment(() => ai, ai), { repeats: 1, concurrency: 1 });
  assert.equal(trial!.recording.error, undefined);
  assert.equal(trial!.result!.criteria["runtime-preserved"]!.score, 1);
  assert.match(trial!.summary, /1 changed documents/);
});
