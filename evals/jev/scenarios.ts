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
    return { success: !missing.length, ...(missing.length ? { reason: `Guests not contacted: ${missing.join(", ")}.` } : {}),
      milestones: guestIds.map(id => ({ name: `Ask ${id}`, points: 1, achieved: contacted.has(id) })) };
  },
};

export const silkScarf: JevWorldEvalScenario = {
  name: "Fetch the silk scarf and give it to Rowan Ash", characterId: "king",
  goal: "Go to the Royal Bedchamber, fetch the silk scarf from the wardrobe, and give it to Rowan Ash.",
  createRuntime(apiKey) {
    const scenario = courtAtDayOne();
    // Reuse the authored wardrobe item, with the name used by this scenario.
    scenario.world!.objects.find(item => item.id === "palace_silk_sash")!.name = "Silk scarf";
    return new BrowserGameRuntime(scenario, apiKey);
  },
  evaluate({ talkCalls }) {
    return talkCalls.some(call => call.characterId === "king" && call.targetId === "rowan")
      ? { success: true } : { success: false, reason: "The king did not talk to Rowan." };
  },
};
export const royalSeal: JevWorldEvalScenario = {
  name: "Fetch the royal seal and close up before giving it to Rowan", characterId: "king",
  goal: "Slip into Corvin's chamber without asking him and find and take the spare royal lockbox key. Close his bedroom door behind me when I leave. Use the spare to open my lockbox in the Royal Bedchamber and collect my royal seal, then close the lockbox and my bedroom door before finding Rowan Ash to give him the seal.",
  objective: {
    name: "Keep my promise to Rowan without admitting I lost my key",
    status: "I promised Rowan Ash my royal seal, but I have misplaced my lockbox key. Corvin keeps the spare somewhere in his bedroom, but I do not know where in the room he has put it. He is here in the Great Hall, away from his room. If I ask him for it, he will discover my carelessness and never let me forget it. I have decided to slip into his room without permission and take the spare while he is occupied. I have not retrieved it yet. I want the bedroom doors and my lockbox closed when I am done, so I do not leave them visibly open.",
    successCriteria: "I have collected my royal seal using Corvin's spare key and reached Rowan to hand it over, with the lockbox and both bedroom doors closed.",
  },
  repeats: 10, maxTurns: 24,
  createRuntime: apiKey => new BrowserGameRuntime(courtAtDayOne(), apiKey),
  evaluate({ scenario, talkCalls, completedActionIds = [] }) {
    const world = scenario.world!;
    const did = (id: string) => completedActionIds.includes(id);
    const hasSeal = world.objects.some(item => item.id === "palace_royal_seal" && item.locationId === "king");
    const openedLockbox = did("open_palace_coffer_03");
    const outside = (roomId: string) => world.actors.find(actor => actor.characterId === "king")?.roomId !== roomId;
    const closedDoor = (id: string, roomId: string) => completedActionIds.some(action => action.startsWith(`open_${id}_`))
      && world.doors.some(door => door.id === id && !door.open) && outside(roomId);
    const milestones = [
      { name: "Get the spare key", points: 2, achieved: did("take_palace_royal_key") },
      { name: "Use the key to open the lockbox", points: 2, achieved: openedLockbox },
      { name: "Collect the royal seal", points: 2, achieved: hasSeal },
      { name: "Close Corvin's door behind you", points: 1, achieved: closedDoor("corvin_door", "corvin_chamber") },
      { name: "Close the lockbox after collecting the seal", points: 1,
        achieved: openedLockbox && hasSeal && world.fixtures.some(fixture => fixture.id === "palace_coffer_03" && !fixture.open) },
      { name: "Close the royal door behind you", points: 1, achieved: closedDoor("royal_door", "royal_bedchamber") },
      { name: "Reach Rowan with the seal", points: 2,
        achieved: hasSeal && talkCalls.some(call => call.characterId === "king" && call.targetId === "rowan") },
    ];
    const failures: string[] = [];
    if (!talkCalls.some(call => call.characterId === "king" && call.targetId === "rowan")) failures.push("The king did not talk to Rowan");
    if (world.objects.find(item => item.id === "palace_royal_seal")?.locationId !== "king") failures.push("The king is not carrying the royal seal");
    if (world.fixtures.find(fixture => fixture.id === "palace_coffer_03")?.open !== false) failures.push("The royal lockbox is not closed");
    for (const id of ["corvin_door", "royal_door"]) {
      if (world.doors.find(door => door.id === id)?.open !== false) failures.push(`${id} is not closed`);
    }
    return { success: !failures.length, milestones, ...(failures.length ? { reason: failures.join("; ") + "." } : {}) };
  },
};
export const jevWorldEvalScenarios = [treasury, inviteGuests, silkScarf, royalSeal];
