import assert from "node:assert/strict";
import test from "node:test";
import { aldrenPlotCase, createAldrenPlotExperiment } from "../packages/evals/src/aldren-plot-case.js";
import { aldrenPlotVariants } from "../packages/evals/src/aldren-plot-variants.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { GameMasterTools, gameMasterTools } from "../packages/conversation/src/gm-tools.js";
import { runExperiment } from "../packages/evals/src/experiment.js";
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

test("four variants isolate prompt and SQL access while preserving fixed inputs", async () => {
  const requests: { sql: boolean; reroute: boolean; transcript: string }[] = [];
  const ai: AiService = {
    responses: async request => {
      assert.equal(request.reasoning?.effort, "high");
      assert.ok(!request.tools?.some(tool => tool.function.name === "set_activity"));
      const evidence = request.messages.find(message => message.role === "user" && message.content?.startsWith('{"characterId"'))!;
      requests.push({ sql: !!request.tools?.some(tool => tool.function.name === "query_documents"),
        reroute: request.messages.some(message => message.content?.includes("Try to plot a course back")),
        transcript: JSON.stringify(JSON.parse(evidence.content!).transcript) });
      const candidate = requests.at(-1)!.reroute;
      const guidanceCopies = request.messages.reduce((count, message) =>
        count + (message.content?.split("frivolous chatter").length ?? 1) - 1, 0);
      assert.equal(guidanceCopies, candidate ? 1 : 0);
      return { role: "assistant", content: "No changes." };
    },
    decisions: async (_evidence, questions) => Object.fromEntries(Object.keys(questions).map(key => [key,
      { choice: "complete", probabilities: { complete: 1 } }])),
  };
  const trials = await runExperiment(createAldrenPlotExperiment(() => ai, ai, aldrenPlotVariants), { repeats: 1, concurrency: 1 });
  assert.ok(trials.every(trial => !trial.recording.error && !trial.scoringError));
  assert.deepEqual(requests.map(({ sql, reroute }) => ({ sql, reroute })), [
    { sql: false, reroute: false }, { sql: false, reroute: true }, { sql: true, reroute: false }, { sql: true, reroute: true },
  ]);
  assert.equal(new Set(requests.map(request => request.transcript)).size, 1);
});

test("optional GM SQL searches live docs and returns recoverable read-only errors", async () => {
  const services = new ConversationRuntime({ services: createScenarioServices(aldrenPlotCase.loadWorld([])) }).services;
  const gm = new GameMasterTools(services, "aldren");
  assert.ok(!gameMasterTools.some(tool => tool.function.name === "query_documents"));
  const result = await gm.call("query_documents", { sql: "SELECT path FROM docs WHERE path = 'Conversations/holt.md'" });
  assert.deepEqual(result, { ok: true, columns: ["path"], rows: [{ path: "Conversations/holt.md" }], truncated: false });
  const invalid = await gm.call("query_documents", { sql: "DELETE FROM docs" });
  assert.equal((invalid as { ok: boolean }).ok, false);
  assert.ok((await services.docs.read("Conversations/holt.md")).document.body);
});
