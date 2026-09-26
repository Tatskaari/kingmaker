import { clone, fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../../../packages/contracts/src/index.js";
import { characterDecisionContext } from "../../../packages/core/src/context.js";
import { CanvasMapRenderer } from "./map-renderer.js";
import { palaceMap } from "./palace-map.js";
import { findPath, reachableRoutes, type NavRoute, type Point } from "./navigation.js";
import { createDoors, doorGraph, doorBlockers, toggleDoor, type Door } from "./palace-doors.js";
import { PalaceAgent, PALACE_INSTRUCTIONS, palaceCriteria, type PalaceAction } from "./palace-agent.js";
import { JevClient } from "../../../packages/providers/src/jev.js";
import { createFurniture, addFurnitureNodes, furnitureBlockers, applyFurnitureAction, observeFurniture, furnitureName } from "./palace-furniture.js";
import { interactionActions, executeInteraction } from "./palace-interactions.js";
import { PalaceDialogue, palaceSurroundings, createPalacePlayer } from "./palace-dialogue.js";
import { OpenRouterClient } from "../../../packages/providers/src/openrouter.js";
const scenarioResponse = await fetch(new URL("../../../content/scenarios/last-night.json", import.meta.url));
if (!scenarioResponse.ok) throw new Error("Could not load Merlin's character sheet.");
const scenario = fromJsonString(ScenarioSchema, await scenarioResponse.text());
scenario.characters.push(createPalacePlayer());
scenario.premise = scenario.premise.split(" On Day 1,")[0] + " Alden, the king's cousin, is visiting the palace and speaking with members of the court.";
const initialDialogueScenario = clone(ScenarioSchema, scenario);
const merlin = scenario.characters.find(character => character.id === "merlin")!;
const doors = createDoors();
const furnitureState = createFurniture();
const graph = doorGraph(doors);
addFurnitureNodes(graph, furnitureState);
const { nodes: palaceNodes, edges: palaceEdges } = graph;

function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing ${selector}`);
  return result;
}
const canvas = element<HTMLCanvasElement>("[data-map]");
const inspector = element("[data-inspector]");
const roomsToggle = element<HTMLInputElement>("[data-show-rooms]");
const solidsToggle = element<HTMLInputElement>("[data-show-solids]");
const navToggle = element<HTMLInputElement>("[data-show-nav]");
const status = element("[data-status]");
const location = element("[data-location]");
const inventory = element("[data-inventory]");
const lockboxStatus = element("[data-lockbox-status]");
const observation = element("[data-observation]");
const goalInput = element<HTMLTextAreaElement>("[data-agent-goal]");
const keyInput = element<HTMLInputElement>("[data-jev-key]");
const runButton = element<HTMLButtonElement>("[data-agent-run]");
const stepButton = element<HTMLButtonElement>("[data-agent-step]");
const pauseButton = element<HTMLButtonElement>("[data-agent-pause]");
const agentStatus = element("[data-agent-status]");
const agentLog = element("[data-agent-log]");
try { keyInput.value = sessionStorage.getItem("kingmaker.openrouter-api-key") ?? ""; } catch { /* Storage may be unavailable. */ }
const renderer = new CanvasMapRenderer(canvas, palaceMap);
await renderer.load();
const context = canvas.getContext("2d")!;
let current = palaceNodes[0]!;
let position: Point = current;
let routes: NavRoute[] = [];
let movement: { route: NavRoute; started: number } | undefined;
let activeEdges: Point[][] = [];
let frame = 0;
let revision = 0;
let movementDone: (() => void) | undefined;
let dialogueController: AbortController | undefined;
const dialogue = new PalaceDialogue(scenario, () => palaceSurroundings(position, doors, furnitureState), () => goalInput.value);
const dialogueInput = element<HTMLTextAreaElement>("[data-dialogue-message]");
const dialogueStatus = element("[data-dialogue-status]");
element("[data-player-description]").textContent = "You are Alden, the king's cousin: a visitor familiar with court life, with no official office or special powers.";
const agent = new PalaceAgent({
  characterContext: goal => characterDecisionContext(scenario, merlin.id, goal),
  snapshot: () => ({ at: current.id, revision, actions: availableActions(), world: worldObservation() }),
  execute: (action, signal) => performAction(action, signal),
  report: (message, decision) => {
    agentStatus.textContent = message;
    if (decision) element("[data-jev-response]").textContent = JSON.stringify(decision, null, 2);
    const row = document.createElement("li");
    row.textContent = message + (decision ? ` [${decision.choice}: ${Math.round((decision.probabilities[decision.choice] ?? 0) * 100)}%]` : "");
    agentLog.append(row);
    while (agentLog.children.length > 60) agentLog.firstElementChild?.remove();
  },
  changed: () => refresh(),
});
function worldObservation(): unknown {
  return {
    at: current.id, position, revision,
    nodes: palaceNodes.map(({ id, name }) => ({ id, name })),
    traversableConnections: palaceEdges.filter(edge => findPath(palaceMap,
      palaceNodes.find(node => node.id === edge.from)!, palaceNodes.find(node => node.id === edge.to)!, blocked())),
    doors: doors.map(door => ({ id: door.id, name: door.name, state: door.open ? "open" : "closed",
      connects: door.connection, approachNodes: door.sides.map(side => side.id) })),
    furniture: observeFurniture(furnitureState),
    inventory: furnitureState.inventory,
    rules: "Furniture containers must be opened before their contents are known. The royal lockbox requires carrying its key to open. Interactions include walking to their reachable interaction spot before performing the action. Doors have a spot on each side; a closed door blocks crossing. Only currently reachable moves and interactions are offered. Full palace layout is known.",
  };
}
const blocked = (): Set<string> => new Set([...doorBlockers(doors), ...furnitureBlockers(furnitureState)]);
function availableActions(): PalaceAction[] {
  if (movement) return [];
  return interactionActions(routes, doors, furnitureState, position);
}
function walkTo(destination: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    movementDone = resolve;
    if (!travel(destination)) { movementDone = undefined; reject(new Error("Destination is no longer reachable.")); }
  });
}
let interactionGeneration = 0;
async function performAction(action: PalaceAction, signal?: AbortSignal): Promise<void> {
  const generation = interactionGeneration;
  if (action.type === "move") { await walkTo(action.target); return; }
  await executeInteraction(action, {
    actions: availableActions,
    at: () => current.id,
    walk: walkTo,
    apply: action => {
      if (generation !== interactionGeneration) throw new Error("World was reset.");
      if (action.type === "open" || action.type === "close") {
        const door = doors.find(door => door.id === action.target);
        if (!door || door.open !== (action.type === "close") || !interact(door)) throw new Error("Door action is no longer available.");
      } else useFurniture(action.id);
    },
  }, signal);
}
function manualInteraction(action: PalaceAction): void {
  void performAction(action).catch(error => { status.textContent = error instanceof Error ? error.message : "Interaction failed."; });
}

function useFurniture(actionId: string): void {
  status.textContent = applyFurnitureAction(furnitureState, position, actionId, !!movement);
  revision++; refresh();
}
function interact(door: Door): boolean {
  if (!toggleDoor(door, position, !!movement)) {
    status.textContent = `Move to a waypoint beside ${door.name} first, then right-click the door or use its button.`;
    return false;
  }
  revision++;
  status.textContent = `${door.name} ${door.open ? "opened" : "closed"}. Routes updated.`;
  refresh();
  return true;
}

function refresh(): void {
  routes = reachableRoutes(palaceMap, palaceNodes, palaceEdges, current.id, blocked());
  activeEdges = palaceEdges.flatMap(edge => {
    const path = findPath(palaceMap, palaceNodes.find(node => node.id === edge.from)!, palaceNodes.find(node => node.id === edge.to)!, blocked());
    return path ? [path] : [];
  });
  inventory.textContent = furnitureState.inventory.map(item => item.name).join(", ") || "Empty";
  lockboxStatus.textContent = furnitureState.furniture.find(item => item.id === "coffer_03")!.open ? "King's lockbox: open" : "King's lockbox: locked";
  location.textContent = movement ? `To ${movement.route.node.name}` : current.name;
  element("[data-character-name]").textContent = merlin.name;
  element("[data-character-context]").textContent = JSON.stringify(characterDecisionContext(scenario, merlin.id, goalInput.value), null, 2);
  element("[data-jev-prompt]").textContent = JSON.stringify(PALACE_INSTRUCTIONS, null, 2);
  element("[data-jev-criteria]").textContent = JSON.stringify(palaceCriteria(availableActions()), null, 2);
  observation.textContent = JSON.stringify({ goal: goalInput.value, characterContext: characterDecisionContext(scenario, merlin.id, goalInput.value), world: worldObservation(), recentEvents: agent.history }, null, 2);
  runButton.disabled = stepButton.disabled = agent.running || !!movement || !!dialogueController;
  pauseButton.disabled = !agent.running;
  goalInput.disabled = keyInput.disabled = agent.running || !!movement || !!dialogueController;
  const dialogueBlocked = agent.running || !!movement || !!dialogueController;
  element<HTMLButtonElement>("[data-dialogue-send]").disabled = dialogueBlocked;
  element<HTMLButtonElement>("[data-dialogue-end]").disabled = dialogueBlocked || !dialogue.transcript.length;
  dialogueInput.disabled = dialogueBlocked;
  for (const button of element("[data-dialogue-options]").querySelectorAll("button")) button.disabled = dialogueBlocked;
  element("[data-dialogue-context]").textContent = JSON.stringify(dialogue.context(), null, 2);
  render();
}
function line(path: Point[], color: string, width: number): void {
  if (!path.length) return;
  context.beginPath(); context.strokeStyle = color; context.lineWidth = width;
  path.forEach((p, i) => { if (i === 0) context.moveTo(p.x * 16 + 8, p.y * 16 + 8); else context.lineTo(p.x * 16 + 8, p.y * 16 + 8); });
  context.stroke();
}
function render(): void {
  renderer.render(roomsToggle.checked, solidsToggle.checked);
  for (const furniture of furnitureState.furniture) {
    renderer.drawSprite("tiny-dungeon", furniture.kind === "lockbox" && furniture.open ? 89 : furniture.sprite, furniture.x, furniture.y);
    if (furniture.kind === "drawers" && furniture.open) {
      context.fillStyle = "#553326"; context.fillRect(furniture.x * 16 + 2, furniture.y * 16 + 8, 12, 6);
      context.fillStyle = "#d69d65"; context.fillRect(furniture.x * 16 + 2, furniture.y * 16 + 12, 12, 3);
      if (furniture.contents.length) {
        context.fillStyle = "#fff1a2"; context.fillRect(furniture.x * 16 + 5, furniture.y * 16 + 9, 6, 2);
      }
    }
    if (solidsToggle.checked) { context.fillStyle = "#e8494966"; context.fillRect(furniture.x * 16, furniture.y * 16, 16, 16); }
  }
  if (navToggle.checked) {
    for (const path of activeEdges) line(path, "#71d7bf66", 1);
    for (const node of palaceNodes) {
      const available = node.id === current.id || routes.some(route => route.node.id === node.id);
      context.beginPath(); context.arc(node.x * 16 + 8, node.y * 16 + 8, 4, 0, Math.PI * 2);
      context.fillStyle = available ? "#9cf3d6" : "#85776c"; context.fill();
      context.strokeStyle = "#162b25"; context.lineWidth = 1; context.stroke();
    }
  }
  if (movement) line(movement.route.path, "#ffe0a3", 2);
  for (const door of doors) {
    const first = door.tiles[0]!, vertical = door.tiles[1]!.y !== first.y;
    context.save();
    context.translate(first.x * 16 + 8, first.y * 16 + 8);
    if (vertical) context.rotate(Math.PI / 2);
    // Two leaves fill a two-tile threshold. Open leaves fold against the jambs.
    context.fillStyle = "#35241d";
    context.fillRect(-8, -6, 3, 12); context.fillRect(21, -6, 3, 12);
    if (door.open) {
      context.fillStyle = "#b77943";
      context.fillRect(-5, -6, 3, 12); context.fillRect(18, -6, 3, 12);
    } else {
      context.fillStyle = "#583522"; context.fillRect(-5, -5, 26, 10);
      context.fillStyle = "#b77943"; context.fillRect(-4, -4, 11, 8); context.fillRect(9, -4, 11, 8);
      context.fillStyle = "#e9c276"; context.fillRect(4, -1, 2, 2); context.fillRect(10, -1, 2, 2);
      context.fillStyle = "#45362b"; context.fillRect(-4, -3, 3, 2); context.fillRect(17, 2, 3, 2);
    }
    if (solidsToggle.checked && !door.open) {
      context.fillStyle = "#e8494966"; context.fillRect(-8, -8, 32, 16);
    }
    context.restore();
  }
  // Merlin uses the wizard sprite from the same Kenney tileset.
  renderer.drawSprite("tiny-dungeon", 84, position.x, position.y);
}
function travel(id: string): boolean {
  if (movement) return false;
  // Revalidate at dispatch, rather than trusting a previously displayed action.
  const route = reachableRoutes(palaceMap, palaceNodes, palaceEdges, current.id, blocked()).find(candidate => candidate.node.id === id);
  if (!route) { status.textContent = "That waypoint is not reachable. Approach and open the door blocking the route."; return false; }
  revision++;
  movement = { route, started: performance.now() };
  status.textContent = `Walking ${route.path.length - 1} tiles via ${route.via.map(id => palaceNodes.find(node => node.id === id)!.name).join(" → ")}.`;
  refresh();
  frame = window.setTimeout(() => animate(performance.now()), 16);
  return true;
}
function animate(time: number): void {
  if (!movement) return;
  const { route, started } = movement;
  const progress = (time - started) / 150;
  if (progress >= route.path.length - 1) {
    current = route.node; position = current; movement = undefined; revision++;
    status.textContent = `Arrived at ${current.name}.`;
    refresh();
    const done = movementDone; movementDone = undefined; done?.();
    return;
  }
  const index = Math.floor(progress), fraction = progress - index;
  const from = route.path[index]!, to = route.path[index + 1]!;
  position = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
  render(); frame = window.setTimeout(() => animate(performance.now()), 16);
}
element("[data-reset]").addEventListener("click", () => {
  interactionGeneration++;
  dialogueController?.abort(); dialogueController = undefined;
  dialogue.reset();
  const restored = clone(ScenarioSchema, initialDialogueScenario);
  Object.assign(merlin, restored.characters.find(character => character.id === "merlin")!);
  scenario.events = restored.events;
  element("[data-dialogue-transcript]").replaceChildren();
  element("[data-dialogue-options]").replaceChildren();
  element("[data-dialogue-result]").hidden = true;
  element("[data-dialogue-request]").textContent = "No request yet.";
  element("[data-dialogue-review]").textContent = "No review yet.";
  dialogueInput.value = ""; dialogueStatus.textContent = "Merlin is ready to talk.";
  agent.reset();
  agentLog.replaceChildren();
  element("[data-jev-request]").textContent = "No request yet.";
  element("[data-jev-response]").textContent = "No response yet.";
  agentStatus.textContent = "Ready for a goal.";
  revision++;
  const done = movementDone; movementDone = undefined; done?.();
  window.clearTimeout(frame); movement = undefined; current = palaceNodes[0]!; position = current;
  const initialFurniture = createFurniture();
  furnitureState.furniture = initialFurniture.furniture; furnitureState.inventory = [];
  const initial = createDoors();
  doors.forEach((door, index) => { door.open = initial[index]!.open; });
  status.textContent = "Choose a destination."; refresh();
});
for (const toggle of [roomsToggle, solidsToggle, navToggle]) toggle.addEventListener("change", render);
canvas.addEventListener("click", event => {
  const hit = renderer.hit(event.clientX, event.clientY);
  const node = hit && palaceNodes.find(node => node.x === hit.tileX && node.y === hit.tileY);
  if (node && !agent.running && !dialogueController) travel(node.id);
});
canvas.addEventListener("contextmenu", event => {
  const hit = renderer.hit(event.clientX, event.clientY);
  const door = hit && doors.find(door => door.tiles.some(tile => tile.x === hit.tileX && tile.y === hit.tileY));
  if (door) { event.preventDefault(); if (!agent.running && !movement && !dialogueController) {
    const action = availableActions().filter(action => action.target === door.id).sort((a, b) => {
      const distance = (action: PalaceAction): number => action.interactionSpot === current.id ? 0
        : routes.find(route => route.node.id === action.interactionSpot)?.path.length ?? Infinity;
      return distance(a) - distance(b);
    })[0];
    if (action) manualInteraction(action);
    else status.textContent = "Neither side of this door is reachable.";
  } return; }
  const furniture = hit && furnitureState.furniture.find(item => item.x === hit.tileX && item.y === hit.tileY);
  if (!furniture || furniture.kind === "decoration") return;
  event.preventDefault();
  if (agent.running || movement || dialogueController) return;
  const actions = availableActions().filter(action => action.target === furniture.id);
  const action = actions.find(action => action.type === "take_item" || action.type === "inspect_container") ?? actions[0];
  if (action) manualInteraction(action);
  else status.textContent = "No interaction is available: the spot is unreachable or the container needs its matching key.";
});
canvas.addEventListener("pointermove", event => {
  const hit = renderer.hit(event.clientX, event.clientY);
  const node = hit && palaceNodes.find(node => node.x === hit.tileX && node.y === hit.tileY);
  const door = hit && doors.find(door => door.tiles.some(tile => tile.x === hit.tileX && tile.y === hit.tileY));
  const furniture = hit && furnitureState.furniture.find(item => item.x === hit.tileX && item.y === hit.tileY);
  inspector.textContent = furniture ? `${furnitureName(furniture)} · ${furniture.kind === "decoration" ? "furniture" : furniture.open ? "open · right-click to interact" : "closed · right-click to interact"}` : door ? `${door.name} · ${door.open ? "open" : "closed"} · right-click to interact` : hit ? `${node?.name ?? hit.roomName ?? "Outside"} · tile ${hit.tileX}, ${hit.tileY}` : "Click a waypoint to travel";
});
canvas.addEventListener("pointerleave", () => { inspector.textContent = "Click a waypoint to travel"; });
refresh();

function runAgent(singleStep: boolean): void {
  if (movement || agent.running || dialogueController) return;
  const key = keyInput.value.trim();
  if (!key) { agentStatus.textContent = "Enter your OpenRouter key first."; keyInput.focus(); return; }
  if (!goalInput.value.trim()) { agentStatus.textContent = "Enter a goal first."; goalInput.focus(); return; }
  try { sessionStorage.setItem("kingmaker.openrouter-api-key", key); } catch { /* Keep working without storage. */ }
  const client = new JevClient(key, undefined, request => {
    element("[data-jev-request]").textContent = JSON.stringify(request, null, 2);
  });
  void agent.run(goalInput.value.trim(), client.choose.bind(client), singleStep);
}
element<HTMLFormElement>("[data-agent-form]").addEventListener("submit", event => { event.preventDefault(); runAgent(false); });
stepButton.addEventListener("click", () => runAgent(true));
pauseButton.addEventListener("click", () => agent.pause());

goalInput.addEventListener("input", () => refresh());

function renderDialogue(): void {
  const transcript = element("[data-dialogue-transcript]");
  transcript.replaceChildren();
  for (const message of dialogue.transcript) {
    const row = document.createElement("p");
    const speaker = document.createElement("strong");
    speaker.textContent = message.speakerId === "merlin" ? "Merlin: " : "Alden: ";
    row.append(speaker, document.createTextNode(message.text)); transcript.append(row);
  }
  const options = element("[data-dialogue-options]"); options.replaceChildren();
  for (const option of dialogue.replyOptions) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = option;
    button.addEventListener("click", () => { dialogueInput.value = option; void converse(false); }); options.append(button);
  }
}
async function converse(finish: boolean): Promise<void> {
  if (agent.running || movement || dialogueController) return;
  const key = keyInput.value.trim();
  if (!key) { dialogueStatus.textContent = "Enter your OpenRouter key above first."; keyInput.focus(); return; }
  if (!finish && !dialogueInput.value.trim()) return;
  const controller = new AbortController(); dialogueController = controller;
  dialogueStatus.textContent = finish ? "Reviewing the conversation…" : "Merlin is replying…";
  refresh();
  const client = new OpenRouterClient(key);
  const complete: typeof client.complete = (request, signal) => {
    element("[data-dialogue-request]").textContent = JSON.stringify(request, null, 2);
    return client.complete(request, signal);
  };
  try {
    if (finish) {
      const result = await dialogue.finish(complete, controller.signal);
      goalInput.value = result.goal;
      element("[data-dialogue-goal]").textContent = result.goal;
      element("[data-dialogue-reason]").textContent = result.reason;
      element("[data-dialogue-review]").textContent = JSON.stringify(result.memory, null, 2);
      element("[data-dialogue-result]").hidden = false;
      element("[data-dialogue-options]").replaceChildren();
      dialogueStatus.textContent = "Conversation saved. Merlin's goal is in the goal field above. Run it when ready, or start a new conversation.";
      revision++;
    } else {
      await dialogue.speak(dialogueInput.value, complete, controller.signal);
      dialogueInput.value = "";
      element("[data-dialogue-result]").hidden = true;
      renderDialogue(); dialogueStatus.textContent = "Continue talking, or end the conversation to return Merlin's goal.";
    }
  } catch (error) {
    if (!controller.signal.aborted) dialogueStatus.textContent = error instanceof Error ? error.message : "Conversation failed. Try again.";
  } finally {
    if (dialogueController === controller) { dialogueController = undefined; refresh(); }
  }
}
element<HTMLFormElement>("[data-dialogue-form]").addEventListener("submit", event => { event.preventDefault(); void converse(false); });
element("[data-dialogue-end]").addEventListener("click", () => { void converse(true); });
