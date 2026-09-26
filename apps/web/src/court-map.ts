import { CanvasMapRenderer } from "./map-renderer.js";
import { palaceMap } from "./palace-map.js";
import { createFurniture } from "./palace-furniture.js";
import { canWalk, findPath, pointKey, type Point } from "./navigation.js";

export interface CourtCharacter { id: string; name: string; roomId?: string; position?: Point }
export interface CourtMarker extends CourtCharacter { point?: Point; roomName: string; sprite: number }
// Scenery only: the narrative game's objects remain authoritative. In particular,
// do not import the prototype's three coffers or its key/loot state into the game.
const scenery = createFurniture().furniture.filter(item => item.kind !== "lockbox");
export const courtBlockers = new Set(scenery.map(pointKey));

export function courtMarkers(characters: readonly CourtCharacter[]): CourtMarker[] {
  const occupied: Point[] = [];
  return characters.map(character => {
    const room = palaceMap.rooms.find(room => room.id === character.roomId);
    const sprite = character.id === "merlin" ? 84 : character.id === "lancelot" ? 96 : character.id === "king" ? 85 : 98;
    if (!room) return { ...character, roomName: character.roomId || "Location unknown", sprite };
    if (character.position && canWalk(palaceMap, character.position, courtBlockers)) {
      occupied.push(character.position);
      return { ...character, roomName: room.name, sprite, point: character.position };
    }
    const candidates: Point[] = [];
    for (const region of room.regions) for (let y = region.y + 1; y < region.y + region.height - 1; y++) {
      for (let x = region.x + 1; x < region.x + region.width - 1; x++) {
        if (canWalk(palaceMap, { x, y }, courtBlockers)) candidates.push({ x, y });
      }
    }
    const primary = room.regions[0]!;
    const center = { x: primary.x + (primary.width - 1) / 2, y: primary.y + (primary.height - 1) / 2 };
    candidates.sort((a, b) => Math.abs(a.x - center.x) + Math.abs(a.y - center.y) - Math.abs(b.x - center.x) - Math.abs(b.y - center.y));
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const hallSpots: Record<string, Point> = { merlin: { x: 12, y: 20 }, king: { x: 16, y: 18 }, lancelot: { x: 20, y: 20 }, player: { x: 16, y: 22 } };
    const preferred = room.id === "great_hall" ? hallSpots[character.id] : undefined;
    const point = (preferred && canWalk(palaceMap, preferred, courtBlockers) ? preferred : undefined) ?? candidates.find(candidate => occupied.every(other => distance(candidate, other) >= 4))
      ?? candidates.find(candidate => occupied.every(other => distance(candidate, other) >= 1));
    if (point) occupied.push(point);
    return { ...character, roomName: room.name, sprite, ...(point ? { point } : {}) };
  });
}

export function courtRoomAt(point: Point) {
  return palaceMap.rooms.find(room => room.regions.some(region => point.x >= region.x && point.y >= region.y
    && point.x < region.x + region.width && point.y < region.y + region.height));
}
export function courtPath(start: Point, end: Point): Point[] | undefined {
  return findPath(palaceMap, start, end, courtBlockers);
}

/** Mount inside the day screen; native buttons retain keyboard and touch access. */
export async function mountCourtMap(root: HTMLElement, characters: readonly CourtCharacter[], player: CourtCharacter | null,
  selectCharacter: (id: string) => void, disabled = false, movePlayer?: (point: Point) => Promise<void>): Promise<void> {
  const viewport = document.createElement("div"); viewport.className = "court-map-scroll";
  const stage = document.createElement("div"); stage.className = "court-map-stage";
  const canvas = document.createElement("canvas"); canvas.setAttribute("aria-label", "Palace of Caerwyn");
  stage.append(canvas); viewport.append(stage); root.append(viewport);
  const status = document.createElement("p"); status.className = "status"; status.setAttribute("role", "status");
  status.textContent = "Click a floor tile to walk there. Select a character to talk."; root.append(status);
  let moving = false;
  let playerControl: HTMLElement | undefined;
  const markers = courtMarkers([...characters, ...(player ? [player] : [])]);
  for (const marker of markers) {
    const isPlayer = marker.id === player?.id;
    const control = document.createElement(isPlayer ? "div" : "button");
    control.className = `court-character${isPlayer ? " court-player" : ""}`;
    if (control instanceof HTMLButtonElement) {
      control.type = "button"; control.disabled = disabled;
      control.setAttribute("aria-label", `Talk to ${marker.name} · ${marker.roomName}`);
      control.addEventListener("click", () => { if (!moving) selectCharacter(marker.id); });
    }
    const sprite = document.createElement("span"); sprite.className = "court-sprite"; sprite.setAttribute("aria-hidden", "true");
    sprite.style.backgroundPosition = `${-(marker.sprite % 12) * 32}px ${-Math.floor(marker.sprite / 12) * 32}px`;
    const label = document.createElement("span"); label.className = "court-character-name";
    label.textContent = `${marker.name}${isPlayer ? " (you)" : ""}`;
    control.append(sprite, label);
    if (isPlayer) playerControl = control;
    if (marker.point) {
      control.style.left = `${(marker.point.x + 0.5) / palaceMap.width * 100}%`;
      control.style.top = `${(marker.point.y + 0.5) / palaceMap.height * 100}%`;
      stage.append(control);
    } else {
      control.classList.add("court-off-map"); control.append(document.createTextNode(` · ${marker.roomName}`)); root.append(control);
    }
  }
  const renderer = new CanvasMapRenderer(canvas, palaceMap);
  await renderer.load();
  if (!root.isConnected) return;
  const draw = () => {
    renderer.render(true, false);
    for (const item of scenery) renderer.drawSprite("tiny-dungeon", item.sprite, item.x, item.y);
  };
  draw();
  let position = markers.find(marker => marker.id === player?.id)?.point;
  const place = (point: Point) => {
    if (!playerControl) return;
    playerControl.style.left = `${(point.x + 0.5) / palaceMap.width * 100}%`;
    playerControl.style.top = `${(point.y + 0.5) / palaceMap.height * 100}%`;
  };
  canvas.addEventListener("click", async event => {
    if (disabled || moving || !position || !movePlayer) return;
    const hit = renderer.hit(event.clientX, event.clientY);
    const path = hit && courtPath(position, { x: hit.tileX, y: hit.tileY });
    if (!path) { status.textContent = "You cannot walk there. Choose a clear floor tile."; return; }
    if (path.length < 2) return;
    moving = true;
    for (const button of root.querySelectorAll("button")) button.disabled = true;
    const start = position, destination = path[path.length - 1]!;
    status.textContent = `Walking to ${courtRoomAt(destination)?.name ?? "the passage"}…`;
    const context = canvas.getContext("2d")!;
    context.beginPath(); context.strokeStyle = "#fff0aa"; context.lineWidth = 2;
    path.forEach((point, index) => { if (!index) context.moveTo(point.x * 16 + 8, point.y * 16 + 8); else context.lineTo(point.x * 16 + 8, point.y * 16 + 8); }); context.stroke();
    const started = performance.now();
    const arrived = await new Promise<boolean>(resolve => {
      const animate = (time: number) => {
        if (!root.isConnected) { resolve(false); return; }
        const progress = Math.min((time - started) / 100, path.length - 1);
        const index = Math.floor(progress), from = path[index]!, to = path[Math.min(index + 1, path.length - 1)]!;
        place({ x: from.x + (to.x - from.x) * (progress - index), y: from.y + (to.y - from.y) * (progress - index) });
        if (progress === path.length - 1) resolve(true); else window.setTimeout(() => animate(performance.now()), 16);
      };
      // The embedded browser can throttle requestAnimationFrame even while the
      // map is visible. Match the palace prototype's elapsed-time timer loop.
      window.setTimeout(() => animate(performance.now()), 16);
    });
    if (!arrived) return;
    try {
      await movePlayer(destination); position = destination;
      status.textContent = `Arrived in ${courtRoomAt(destination)?.name ?? "the palace"}.`;
    } catch (error) {
      place(start); status.textContent = error instanceof Error ? error.message : "Could not save your move.";
    } finally {
      moving = false; draw();
      for (const button of root.querySelectorAll("button")) button.disabled = disabled;
    }
  });
}
