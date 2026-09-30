import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fromJson, fromJsonString, toJson } from "@bufbuild/protobuf";
import { GamePhase, ScenarioSchema } from "../packages/contracts/src/index.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { JevClient, jevRequest } from "../packages/providers/src/jev.js";

// Capture the real planNpc request at the provider boundary; never use a key or network.
const output = resolve(process.argv[2] ?? "/tmp/kingmaker-jev-contexts");
const characterId = process.argv[3] ?? "king";
const scenario = fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
const originalChoose = JevClient.prototype.choose;
let captured: ReturnType<typeof jevRequest> | undefined;
JevClient.prototype.choose = async (state, instructions, criteria) => {
  captured = jevRequest(state, instructions, criteria);
  return { choice: "wait", probabilities: Object.fromEntries(Object.keys(criteria).map(id => [id, id === "wait" ? 1 : 0])) };
};
try {
  mkdirSync(output, { recursive: true });
  for (const placement of ["court-arrival", "authored-initial"]) for (const level of [1, 2, 3] as const) {
    const runtime = new BrowserGameRuntime(scenario, "", undefined, undefined, undefined, Math.random, true, { level, includeRecentResults: false });
    if (placement === "court-arrival") runtime.createDevelopmentPlayer();
    const snapshot = runtime.snapshot(), active = fromJson(ScenarioSchema, snapshot.scenario);
    const character = active.characters.find(item => item.id === characterId);
    const actor = active.world?.actors.find(item => item.characterId === characterId);
    if (!character?.currentGoal || !actor || !active.world) throw new Error(`No initial task/placement for ${characterId}`);
    active.world.phase = GamePhase.CONVERSATIONS;
    actor.awake = true;
    snapshot.scenario = toJson(ScenarioSchema, active);
    snapshot.npcActivities = { [characterId]: { status: "active", goal: character.currentGoal, history: [] } };
    runtime.restore(snapshot);
    captured = undefined;
    await runtime.planNpc(characterId, new AbortController().signal);
    const request = captured as ReturnType<typeof jevRequest> | undefined;
    if (!request || typeof request.state !== "string") throw new Error("Expected a text action-planning state");
    const prefix = `${characterId}-${placement}-level-${level}`;
    // Byte-for-byte state, with no summary, omitted fields, or extra header.
    writeFileSync(resolve(output, `${prefix}-state.txt`), request.state);
    const question = request.questions.next!;
    writeFileSync(resolve(output, `${prefix}-request.txt`), [
      request.state, "Execution instructions:", String(question.instructions), "Selectable choices:",
      ...Object.entries(question.criteria).map(([id, description]) => `- [${id}] ${description}`),
    ].join("\n\n") + "\n");
    console.log(`${prefix}: ${request.state.length} state characters, ${Object.keys(question.criteria).length - 3} physical actions`);
  }
  writeFileSync(resolve(output, "README.txt"), [
    "These files capture production planNpc inputs offline. No key was read and no model request was sent.",
    "*-state.txt is exactly the string sent in Jev's state field. *-request.txt also includes all decision instructions and choice criteria.",
    "Levels: 1 = scene + full current objective; 2 adds biography and parked objectives; 3 adds relationships and character-visible notes.",
    "Recent action results are disabled in all three samples.",
    "court-arrival uses the authored court arrival placements and the Development Envoy as the player.",
    "authored-initial preserves original placements, sets the phase to conversations, wakes the selected character, and activates their authored goal.",
    "Transport metadata: model typesafe/jev-1.13; question next; type choice.",
  ].join("\n") + "\n");
  console.log(output);
} finally { JevClient.prototype.choose = originalChoose; }
