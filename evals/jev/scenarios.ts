import { readFileSync } from "node:fs";
import { create, fromJsonString } from "@bufbuild/protobuf";
import { GamePhase, ScenarioSchema, TilePositionSchema, type Scenario } from "../../packages/contracts/src/index.js";
import { BrowserGameRuntime } from "../../apps/web/src/runtime.js";
import type { JevWorldEvalScenario } from "../../packages/evals/src/jev-world-eval.js";

const authoredScenario = new URL("../../content/scenarios/last-night.json", import.meta.url);
function courtAtDayOne(): Scenario {
  const scenario = fromJsonString(ScenarioSchema, readFileSync(authoredScenario, "utf8")), world = scenario.world!;
  world.day = 1; world.phase = GamePhase.CONVERSATIONS; world.revision++;
  for (const actor of world.actors) {
    const placement = scenario.courtArrivalPlacements.find(candidate => candidate.characterId === actor.characterId);
    if (!placement?.position) throw new Error(`Missing court placement for ${actor.characterId}.`);
    actor.awake = true; actor.roomId = placement.roomId; actor.position = { ...placement.position };
  }
  return scenario;
}
const treasury: JevWorldEvalScenario = {
  name: "Enter the Treasury and close the door", characterId: "corvin",
  goal: "Go into the Treasury, close the door behind you, and wait there.", repeats: 10, maxTurns: 24,
  createRuntime(apiKey) {
    const scenario = courtAtDayOne(), world = scenario.world!, corvin = world.actors.find(actor => actor.characterId === "corvin")!;
    corvin.roomId = "great_hall"; corvin.position = create(TilePositionSchema, { x: 22, y: 22 });
    return new BrowserGameRuntime(scenario, apiKey);
  },
  evaluate({ scenario, terminalChoice }) {
    const world = scenario.world!, room = world.actors.find(actor => actor.characterId === "corvin")?.roomId;
    const open = world.doors.find(door => door.id === "treasury_door")?.open;
    if (room !== "treasury") return { success: false, reason: `Corvin finished in ${room ?? "an unknown room"}.` };
    if (open !== false) return { success: false, reason: "The Treasury door remained open." };
    if (!["complete", "wait"].includes(terminalChoice)) return { success: false, reason: `Jev terminated with ${terminalChoice}.` };
    return { success: true };
  },
};
export const guestIds = ["mara", "hadrik", "tessa", "elinor", "oswin", "rowan", "lucan", "sabine", "rook"];
export const inviteGuests: JevWorldEvalScenario = {
  name: "Ask every guest to head to the Treasury", characterId: "king",
  goal: "Ask each visiting guest to head to the Treasury: Mara, Hadrik, Tessa, Elinor, Oswin, Rowan, Lucan, Sabine, and Rook. Finish once you have asked all nine.",
  createRuntime: apiKey => new BrowserGameRuntime(courtAtDayOne(), apiKey),
  mockTalk: ({ targetId }) => `Asked ${targetId} to head to the Treasury. The request has been delivered.`,
  evaluate({ talkCalls }) {
    const contacted = new Set(talkCalls.filter(call => call.characterId === "king").map(call => call.targetId));
    const missing = guestIds.filter(id => !contacted.has(id));
    return missing.length ? { success: false, reason: `Guests not contacted: ${missing.join(", ")}.` } : { success: true };
  },
};

const silkScarf: JevWorldEvalScenario = {
  name: "Fetch the silk scarf and give it to Rowan Ash", characterId: "king",
  goal: "Go to the Royal Bedchamber, fetch the silk scarf from the wardrobe, and give it to Rowan Ash.",
  createRuntime(apiKey) {
    const scenario = courtAtDayOne();
    // Reuse the authored wardrobe item, with the name used by this scenario.
    scenario.world!.objects.find(item => item.id === "palace_silk_sash")!.name = "Silk scarf";
    return new BrowserGameRuntime(scenario, apiKey);
  },
  evaluate({ scenario }) {
    const location = scenario.world!.objects.find(item => item.id === "palace_silk_sash")?.locationId;
    return location === "rowan" ? { success: true } : { success: false, reason: `Scarf is at ${location}, not in Rowan's inventory.` };
  },
};
export const jevWorldEvalScenarios = [treasury, inviteGuests, silkScarf];
