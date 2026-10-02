import { locatedItems, findItem } from "../../packages/core/src/inventory.js";
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
    corvin.roomId = "great_hall"; corvin.position = create(TilePositionSchema, { x: 68, y: 22 });
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
    findItem(scenario, "palace_silk_sash")!.name = "Silk scarf";
    return new BrowserGameRuntime(scenario, apiKey);
  },
  evaluate({ talkCalls }) {
    return talkCalls.some(call => call.characterId === "king" && call.targetId === "rowan")
      ? { success: true } : { success: false, reason: "The king did not talk to Rowan." };
  },
};
export const royalSeal: JevWorldEvalScenario = {
  name: "Fetch the royal seal and close up before giving it to Rowan", characterId: "king",
  goal: "Slip into Corvin's chamber without asking him and take the spare royal lockbox key from his chest of drawers. Close his bedroom door behind me when I leave. Use the spare to open my lockbox in the Royal Bedchamber and collect my royal seal, then close the lockbox and my bedroom door before finding Rowan Ash to give him the seal.",
  objective: {
    name: "Keep my promise to Rowan without admitting I lost my key",
    status: "I promised Rowan Ash my royal seal, but I have misplaced my lockbox key. Corvin keeps the spare in his bedroom chest of drawers; I remember watching him put it there. He is here in the Great Hall, away from his room. If I ask him for it, he will discover my carelessness and never let me forget it. I have decided to slip into his room without permission and take the spare while he is occupied. I have not retrieved it yet. I want the bedroom doors and my lockbox closed when I am done, so I do not leave them visibly open.",
    successCriteria: "I have collected my royal seal using Corvin's spare key and reached Rowan to hand it over, with the lockbox and both bedroom doors closed.",
  },
  repeats: 10, maxTurns: 24,
  createRuntime: apiKey => new BrowserGameRuntime(courtAtDayOne(), apiKey),
  evaluate({ scenario, talkCalls, completedActionIds = [] }) {
    const world = scenario.world!;
    const did = (id: string) => completedActionIds.includes(id);
    const hasSeal = locatedItems(scenario).some(item => item.id === "palace_royal_seal" && item.locationId === "king");
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
    if (locatedItems(scenario).find(item => item.id === "palace_royal_seal")?.locationId !== "king") failures.push("The king is not carrying the royal seal");
    if (world.fixtures.find(fixture => fixture.id === "palace_coffer_03")?.open !== false) failures.push("The royal lockbox is not closed");
    for (const id of ["corvin_door", "royal_door"]) {
      if (world.doors.find(door => door.id === id)?.open !== false) failures.push(`${id} is not closed`);
    }
    return { success: !failures.length, milestones, ...(failures.length ? { reason: failures.join("; ") + "." } : {}) };
  },
};
export const royalSealKeySearch: JevWorldEvalScenario = {
  ...royalSeal,
  name: "Fetch the royal seal with an unknown key location",
  goal: "Slip into Corvin's chamber without asking him and find and take the spare royal lockbox key. Close his bedroom door behind me when I leave. Use the spare to open my lockbox in the Royal Bedchamber and collect my royal seal, then close the lockbox and my bedroom door before finding Rowan Ash to give him the seal.",
  objective: {
    ...royalSeal.objective!,
    status: "I promised Rowan Ash my royal seal, but I have misplaced my lockbox key. Corvin keeps the spare somewhere in his bedroom, but I do not know where in the room he has put it. He is here in the Great Hall, away from his room. If I ask him for it, he will discover my carelessness and never let me forget it. I have decided to slip into his room without permission and take the spare while he is occupied. I have not retrieved it yet. I want the bedroom doors and my lockbox closed when I am done, so I do not leave them visibly open.",
  },
};
/** These use the same authored furniture and room-scoped actions as the browser. */
export const diningSupplies: JevWorldEvalScenario = {
  name: "Fetch bread from the furnished dining hall", characterId: "corvin", repeats: 3, maxTurns: 24,
  goal: "Go to the Long Dining Hall in the east wing. Take the round loaf from the bread and cheese serving table, close the table's storage, then return to the Great Hall carrying the loaf.",
  createRuntime: apiKey => new BrowserGameRuntime(courtAtDayOne(), apiKey),
  evaluate({ scenario, terminalChoice }) {
    const success = locatedItems(scenario).some(item => item.id === "furn_bread" && item.locationId === "corvin")
      && scenario.world!.actors.some(actor => actor.characterId === "corvin" && actor.roomId === "great_hall")
      && scenario.world!.fixtures.some(f => f.id === "furn_dining_bread" && !f.open)
      && ["complete", "wait"].includes(terminalChoice);
    return { success, ...(!success ? { reason: "Corvin must return with the loaf and leave the serving storage closed." } : {}) };
  },
};
export const privateBelongings: JevWorldEvalScenario = {
  name: "Retrieve Mara's belongings and leave her bedroom", characterId: "mara", repeats: 3, maxTurns: 32,
  goal: "Go to my chamber in the west wing and take my draft assembly address from my writing table. Close the table and my bedroom door after leaving, then wait in the Ironmark Salon carrying the draft.",
  createRuntime: apiKey => new BrowserGameRuntime(courtAtDayOne(), apiKey),
  evaluate({ scenario, terminalChoice }) {
    const success = locatedItems(scenario).some(item => item.id === "furn_mara_personal" && item.locationId === "mara")
      && scenario.world!.actors.some(actor => actor.characterId === "mara" && actor.roomId === "ironmark_salon")
      && scenario.world!.fixtures.some(f => f.id === "furn_mara_desk" && !f.open)
      && scenario.world!.doors.some(d => d.id === "mara_door" && !d.open)
      && ["complete", "wait"].includes(terminalChoice);
    return { success, ...(!success ? { reason: "Mara must reach her salon with the draft and leave her desk and bedroom door closed." } : {}) };
  },
};
const greyGullLedger: JevWorldEvalScenario = {
  name: "Sabine checks the Grey Gull dispatch ledger",
  characterId: "sabine",
  goal: "Go to my chamber, open my writing table, and inspect the Saltmere dispatch ledger once, leaving it there. Finish after that inspection.",
  objective: {
    name: "Check the Grey Gull rumor privately",
    status: "The envoy says Grey Gull leaves the west gate tomorrow without escort. I downplayed the rumor and excused myself to check my dispatch ledger in my chamber. My carried caravan tallies are only a loss summary, not the departure register.",
    successCriteria: "I have reached my chamber, opened my writing table and inspected the Saltmere dispatch ledger once. Reading the ledger completes this physical task even if it cannot verify the rumor; leave it in the table.",
  },
  repeats: 3, maxTurns: 16,
  createRuntime: apiKey => new BrowserGameRuntime(courtAtDayOne(), apiKey),
  evaluate({ scenario, terminalChoice, completedActionIds = [] }) {
    const inspections = completedActionIds.filter(id => id === "inspect_item_furn_sabine_dispatch_ledger");
    const milestones = [
      { name: "Reach Sabine's chamber", points: 1,
        achieved: scenario.world!.actors.some(actor => actor.characterId === "sabine" && actor.roomId === "sabine_chamber") },
      { name: "Open the writing table", points: 1, achieved: completedActionIds.includes("open_furn_sabine_desk") },
      { name: "Inspect the dispatch ledger exactly once", points: 1, achieved: inspections.length === 1 },
      { name: "Leave the ledger in the table", points: 1,
        achieved: locatedItems(scenario).find(item => item.id === "furn_sabine_dispatch_ledger")?.locationId === "furn_sabine_desk" },
      { name: "Finish without repeatedly reading the carried tallies", points: 1,
        achieved: terminalChoice === "complete" && !completedActionIds.includes("inspect_item_sabine_caravan_tallies") },
    ];
    return { success: milestones.every(item => item.achieved), milestones };
  },
};
export const jevWorldEvalScenarios = [treasury, inviteGuests, silkScarf, royalSeal, royalSealKeySearch, diningSupplies, privateBelongings, greyGullLedger];
