import { CanvasMapRenderer } from "./map-renderer.js";
import { palaceMap } from "./palace-map.js";
import { findPath, pointKey, reachableRoutes, type NavRoute, type Point } from "./navigation.js";
import { palaceEdges, palaceNodes, royalGate } from "./palace-navigation.js";

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
const destinations = element("[data-destinations]");
const status = element("[data-status]");
const location = element("[data-location]");
const gateButton = element<HTMLButtonElement>("[data-gate]");
const gateHint = element("[data-gate-hint]");
const observation = element("[data-observation]");
const renderer = new CanvasMapRenderer(canvas, palaceMap);
await renderer.load();
const context = canvas.getContext("2d")!;
let current = palaceNodes[0]!;
let position: Point = current;
let gateOpen = false;
let routes: NavRoute[] = [];
let movement: { route: NavRoute; started: number } | undefined;
let activeEdges: Point[][] = [];
let frame = 0;
const blocked = (): Set<string> => new Set(gateOpen ? [] : royalGate.map(pointKey));
const nearGate = (): boolean => current.id === "north_junction" || current.id === "royal";

function refresh(): void {
  routes = reachableRoutes(palaceMap, palaceNodes, palaceEdges, current.id, blocked());
  activeEdges = palaceEdges.flatMap(edge => {
    const path = findPath(palaceMap, palaceNodes.find(node => node.id === edge.from)!, palaceNodes.find(node => node.id === edge.to)!, blocked());
    return path ? [path] : [];
  });
  destinations.replaceChildren(...routes.map(route => {
    const button = document.createElement("button");
    button.textContent = `${route.node.name} · ${route.path.length - 1} steps`;
    button.disabled = !!movement;
    button.addEventListener("click", () => travel(route.node.id));
    return button;
  }));
  gateButton.disabled = !!movement || !nearGate();
  gateButton.textContent = `${gateOpen ? "Close" : "Open"} royal gate`;
  gateHint.textContent = gateOpen ? "Gate open · the royal bedchamber is reachable."
    : "Gate closed · approach the North Junction to open it.";
  location.textContent = movement ? `To ${movement.route.node.name}` : current.name;
  observation.textContent = JSON.stringify({
    at: movement ? "in_transit" : current.id,
    gate: gateOpen ? "open" : "closed",
    availableActions: movement ? [] : [
      ...routes.map(route => ({ type: "move_to_node", nodeId: route.node.id, via: route.via.slice(1), steps: route.path.length - 1 })),
      ...(nearGate() ? [{ type: gateOpen ? "close_gate" : "open_gate" }] : []),
    ],
  }, null, 2);
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
  // Gate spans the whole passage; its collision uses these exact two tiles.
  context.fillStyle = gateOpen ? "#70b695" : "#553527";
  context.fillRect(15 * 16, 10 * 16 + 5, gateOpen ? 3 : 32, 6);
  if (!gateOpen) {
    context.fillStyle = "#dbc191";
    for (let x = 15 * 16 + 2; x < 17 * 16; x += 5) context.fillRect(x, 10 * 16 + 3, 2, 10);
  }
  // Small pixel character, anchored at the centre of its occupied tile.
  const x = Math.round(position.x * 16 + 8), y = Math.round(position.y * 16 + 8);
  context.fillStyle = "#0008"; context.fillRect(x - 5, y + 5, 10, 3);
  context.fillStyle = "#172c3e"; context.fillRect(x - 4, y - 3, 8, 10);
  context.fillStyle = "#67c9e0"; context.fillRect(x - 3, y - 2, 6, 7);
  context.fillStyle = "#f6cf91"; context.fillRect(x - 3, y - 7, 6, 5);
  context.fillStyle = "#624631"; context.fillRect(x - 3, y - 8, 6, 2);
  context.fillStyle = "#e7ebd5"; context.fillRect(x - 3, y + 5, 2, 2); context.fillRect(x + 1, y + 5, 2, 2);
}
function travel(id: string): void {
  if (movement) return;
  // Revalidate at dispatch, rather than trusting a previously displayed action.
  const route = reachableRoutes(palaceMap, palaceNodes, palaceEdges, current.id, blocked()).find(candidate => candidate.node.id === id);
  if (!route) { status.textContent = "That waypoint is not reachable. Open the royal gate from the North Junction."; return; }
  movement = { route, started: performance.now() };
  status.textContent = `Walking ${route.path.length - 1} tiles via ${route.via.map(id => palaceNodes.find(node => node.id === id)!.name).join(" → ")}.`;
  refresh();
  frame = window.setTimeout(() => animate(performance.now()), 16);
}
function animate(time: number): void {
  if (!movement) return;
  const { route, started } = movement;
  const progress = (time - started) / 150;
  if (progress >= route.path.length - 1) {
    current = route.node; position = current; movement = undefined;
    status.textContent = `Arrived at ${current.name}.`;
    refresh(); return;
  }
  const index = Math.floor(progress), fraction = progress - index;
  const from = route.path[index]!, to = route.path[index + 1]!;
  position = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
  render(); frame = window.setTimeout(() => animate(performance.now()), 16);
}
gateButton.addEventListener("click", () => {
  if (movement || !nearGate()) return;
  gateOpen = !gateOpen;
  status.textContent = gateOpen ? "Royal gate opened. New routes are available." : "Royal gate closed. Routes updated.";
  refresh();
});
element("[data-reset]").addEventListener("click", () => {
  window.clearTimeout(frame); movement = undefined; current = palaceNodes[0]!; position = current; gateOpen = false;
  status.textContent = "Choose a destination."; refresh();
});
for (const toggle of [roomsToggle, solidsToggle, navToggle]) toggle.addEventListener("change", render);
canvas.addEventListener("click", event => {
  const hit = renderer.hit(event.clientX, event.clientY);
  const node = hit && palaceNodes.find(node => node.x === hit.tileX && node.y === hit.tileY);
  if (node) travel(node.id);
});
canvas.addEventListener("pointermove", event => {
  const hit = renderer.hit(event.clientX, event.clientY);
  const node = hit && palaceNodes.find(node => node.x === hit.tileX && node.y === hit.tileY);
  inspector.textContent = hit ? `${node?.name ?? hit.roomName ?? "Outside"} · tile ${hit.tileX}, ${hit.tileY}` : "Click a waypoint to travel";
});
canvas.addEventListener("pointerleave", () => { inspector.textContent = "Click a waypoint to travel"; });
refresh();
