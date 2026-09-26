import { doorActionLegality, type RoomAccess } from "../../../packages/core/src/access.js";
import type { FixtureAction } from "../../../packages/core/src/fixtures.js";
import type { DoorState, MapFixture } from "../../../packages/contracts/src/index.js";
import { drawDoors } from "./draw-doors.js";
import { actionsAtTile, type CourtInteractionLayer } from "./court-interactions.js";
import { CanvasMapRenderer } from "./map-renderer.js";
import { palaceMap } from "./palace-map.js";
import { createFurniture } from "./palace-furniture.js";
import { canWalk, findPath, pointKey, type Point } from "./navigation.js";

export interface CourtCharacter { id: string; name: string; roomId?: string; position?: Point }
export interface CourtMarker extends CourtCharacter { point?: Point; roomName: string; sprite: number }
const scenery = createFurniture().furniture;
export const courtBlockers = new Set(scenery.map(pointKey));

export function courtMarkers(characters: readonly CourtCharacter[], fixtures?: readonly MapFixture[]): CourtMarker[] {
  return characters.map(character => {
    const room = palaceMap.rooms.find(room => room.id === character.roomId);
    const sprite = character.id === "merlin" ? 84 : character.id === "lancelot" ? 96 : character.id === "king" ? 85 : 98;
    const point = character.position;
    const valid = point && canWalk(palaceMap, point, courtDoorBlockers([], fixtures)) && courtRoomAt(point)?.id === room?.id;
    return { ...character, roomName: room?.name ?? character.roomId ?? "Location unknown", sprite,
      ...(valid ? { point } : {}) };
  });
}

export function courtRoomAt(point: Point) {
  return palaceMap.rooms.find(room => room.regions.some(region => point.x >= region.x && point.y >= region.y
    && point.x < region.x + region.width && point.y < region.y + region.height));
}
export function courtDoorBlockers(doors: readonly DoorState[], fixtures?: readonly MapFixture[]): Set<string> {
  return new Set([...(fixtures ? fixtures.flatMap(item => item.position ? [pointKey(item.position)] : []) : courtBlockers), ...doors.filter(door => !door.open).flatMap(door => door.tiles.map(pointKey))]);
}
export function courtPath(start: Point, end: Point, doors: readonly DoorState[] = [], fixtures?: readonly MapFixture[]): Point[] | undefined {
  return findPath(palaceMap, start, end, courtDoorBlockers(doors, fixtures));
}

export function courtInteractionPoint(start: Point, target: Point, authored?: Point, doors: readonly DoorState[] = [], fixtures?: readonly MapFixture[]): Point | undefined {
  const candidates = authored ? [authored] : [{ x: target.x, y: target.y + 1 }, { x: target.x - 1, y: target.y },
    { x: target.x + 1, y: target.y }, { x: target.x, y: target.y - 1 }];
  return candidates.map(point => ({ point, path: courtPath(start, point, doors, fixtures) })).filter(candidate => candidate.path)
    .sort((a, b) => a.path!.length - b.path!.length)[0]?.point;
}

export function nearestDoorSpot(start: Point, door: DoorState, doors: readonly DoorState[], fixtures?: readonly MapFixture[]): Point | undefined {
  return door.interactionSpots.map(point => ({ point, path: courtPath(start, point, doors, fixtures) }))
    .filter(candidate => candidate.path).sort((a, b) => a.path!.length - b.path!.length)[0]?.point;
}

export function courtWalkPoint(path: readonly Point[], progress: number): Point {
  const offset = Math.max(0, Math.min(progress, path.length - 1));
  const index = Math.floor(offset), from = path[index]!, to = path[Math.min(index + 1, path.length - 1)]!;
  return { x: from.x + (to.x - from.x) * (offset - index), y: from.y + (to.y - from.y) * (offset - index) };
}
/** Finish the current partial tile step, then follow the replacement A* route. */
export function redirectCourtPath(path: readonly Point[], progress: number, destination: Point, doors: readonly DoorState[] = [], fixtures?: readonly MapFixture[]): Point[] | undefined {
  const offset = Math.max(0, Math.min(progress, path.length - 1));
  const pivot = path[Math.ceil(offset)]!;
  const route = courtPath(pivot, destination, doors, fixtures);
  if (!route) return undefined;
  const visual = courtWalkPoint(path, offset);
  return visual.x === pivot.x && visual.y === pivot.y ? route : [visual, ...route];
}

/** Mount inside the day screen; native buttons retain keyboard and touch access. */
export async function mountCourtMap(root: HTMLElement, characters: readonly CourtCharacter[], player: CourtCharacter | null,
  selectCharacter: (id: string) => void, disabled = false, movePlayer?: (point: Point) => Promise<void>, doors: DoorState[] = [], changeDoor?: (id: string, open: boolean) => Promise<DoorState[]>, rooms: readonly RoomAccess[] = [], fixtures: readonly MapFixture[] = [], fixtureChoices: readonly FixtureAction[] = [], interactFixture?: (actionId: string) => Promise<void>): Promise<void> {
  const viewport = document.createElement("div"); viewport.className = "court-map-scroll";
  const stage = document.createElement("div"); stage.className = "court-map-stage";
  const canvas = document.createElement("canvas"); canvas.setAttribute("aria-label", "Palace of Caerwyn");
  stage.append(canvas); viewport.append(stage); root.append(viewport);
  const status = document.createElement("p"); status.className = "status"; status.setAttribute("role", "status");
  status.textContent = "Left-click to walk; click again to change destination. Right-click a tile or character for actions."; root.append(status);
  let moving = false;
  let redirect: ((destination: Point) => boolean) | undefined;
  let playerControl: HTMLElement | undefined;
  let visualPosition: Point | undefined;
  const menu = document.createElement("div"); menu.className = "court-interaction-menu";
  menu.hidden = true; menu.setAttribute("aria-label", "Tile actions"); root.append(menu);
  let menuTile: string | undefined;
  const closeMenu = () => { menu.hidden = true; menuTile = undefined; };
  menu.addEventListener("contextmenu", event => { event.preventDefault(); closeMenu(); });
  const listeners = new AbortController();
  document.addEventListener("pointerdown", event => {
    if (event.button === 0 && !menu.contains(event.target as Node)) closeMenu();
  }, { signal: listeners.signal });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeMenu(); }, { signal: listeners.signal });
  const cleanup = new MutationObserver(() => {
    if (!root.isConnected) { listeners.abort(); cleanup.disconnect(); }
  });
  cleanup.observe(document.body, { childList: true, subtree: true });
  let pendingInteraction: (() => void | Promise<void>) | undefined;
  let walkTo: (point: Point, interaction?: () => void | Promise<void>) => Promise<void> = async () => {};
  const approach = (target: Point, authored?: Point) => visualPosition && courtInteractionPoint(
    { x: Math.round(visualPosition.x), y: Math.round(visualPosition.y) }, target, authored, doors, fixtures);
  const showMenu = (tile: Point, x: number, y: number) => {
    if (disabled) return;
    if (!menu.hidden && menuTile === pointKey(tile)) { closeMenu(); return; }
    menuTile = pointKey(tile);
    const layers: CourtInteractionLayer[] = [];
    if (canWalk(palaceMap, tile, courtDoorBlockers(doors, fixtures))) layers.push({ id: "ground", position: tile, order: 0,
      actions: [{ id: "walk", label: "Walk here", type: "walk", target: "ground", order: 100, legality: "normal" }] });
    for (const door of doors) for (const doorTile of door.tiles) layers.push({ id: door.id, position: doorTile, order: 15,
      actions: [{ id: `${door.open ? "close" : "open"}_${door.id}`, label: `${door.open ? "Close" : "Open"} ${door.name}`,
        type: "door", target: door.id, order: 15, legality: doorActionLegality(door, rooms, player?.id ?? "") }] });
    for (const item of fixtures) if (item.position) layers.push({ id: item.id, position: item.position, order: 20,
      actions: fixtureChoices.filter(action => action.target === item.id).map(action => ({ ...action, type: "fixture" })) });
    for (const marker of markers) {
      const point = marker.id === player?.id ? visualPosition ?? marker.point : marker.point;
      if (!point) continue;
      layers.push({ id: marker.id, position: { x: Math.round(point.x), y: Math.round(point.y) }, order: 30,
        actions: marker.id === player?.id ? [] : [{ id: `talk_${marker.id}`, label: `Talk to ${marker.name}`, type: "talk", target: marker.id, order: 10, legality: "normal" }] });
    }
    menu.replaceChildren();
    const title = document.createElement("p"); title.className = "court-menu-title"; title.textContent = "Actions"; menu.append(title);
    const actions = actionsAtTile(tile, layers);
    for (const action of actions) {
      const button = document.createElement("button"); button.type = "button";
      button.className = `court-menu-action court-action-${action.legality}`;
      button.textContent = action.label + (action.legality === "illegal" ? " · Illegal" : "");
      button.disabled = !movePlayer || !visualPosition || (moving && !redirect);
      button.addEventListener("click", () => {
        closeMenu();
        if (action.type === "walk") void walkTo(tile);
        else if (action.type === "door") {
          const door = doors.find(door => door.id === action.target);
          const spot = door && visualPosition && nearestDoorSpot({ x: Math.round(visualPosition.x), y: Math.round(visualPosition.y) }, door, doors, fixtures);
          if (!door || !spot || !changeDoor) { status.textContent = "No reachable interaction spot for this door."; return; }
          const open = !door.open;
          void walkTo(spot, async () => {
            doors = await changeDoor(door.id, open);
            status.textContent = `${door.name} ${open ? "opened" : "closed"}.`; draw();
          });
        } else if (action.type === "fixture") {
          const fixture = fixtures.find(item => item.id === action.target);
          const spot = fixture?.position && approach(fixture.position, fixture.interactionSpot);
          if (!spot || !interactFixture) { status.textContent = "No reachable interaction spot for this furniture."; return; }
          void walkTo(spot, () => interactFixture(action.id));
        } else {
          const character = markers.find(marker => marker.id === action.target);
          const item = scenery.find(item => item.id === action.target);
          const target = action.type === "talk" ? character?.point : item;
          const spot = target && approach(target, item?.approach);
          if (!spot) { status.textContent = "There is no reachable interaction spot for that target."; return; }
          void walkTo(spot, () => {
            if (action.type === "talk") selectCharacter(action.target);
            else status.textContent = `${item?.name ?? "Furniture"} · ${courtRoomAt(tile)?.name ?? "Palace"}.`;
          });
        }
      });
      menu.append(button);
    }
    if (!actions.length) { const empty = document.createElement("p"); empty.textContent = "No actions here."; menu.append(empty); }
    menu.style.left = `${x}px`; menu.style.top = `${y}px`; menu.hidden = false;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  };
  const markers = courtMarkers([...characters, ...(player ? [player] : [])], fixtures);
  for (const marker of markers) {
    const isPlayer = marker.id === player?.id;
    const control = document.createElement(isPlayer ? "div" : "button");
    control.className = `court-character${isPlayer ? " court-player" : ""}`;
    if (control instanceof HTMLButtonElement) {
      control.type = "button"; control.disabled = disabled;
      control.setAttribute("aria-label", `Walk to ${marker.name} · ${marker.roomName}`);
      control.addEventListener("click", () => { if (marker.point) { closeMenu(); const spot = approach(marker.point); if (spot) void walkTo(spot); } });
      control.addEventListener("contextmenu", event => {
        event.preventDefault(); event.stopPropagation();
        if (marker.point) showMenu(marker.point, event.clientX, event.clientY);
      });
      control.addEventListener("keydown", event => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault(); const bounds = control.getBoundingClientRect();
          if (marker.point) showMenu(marker.point, bounds.left, bounds.bottom);
        }
      });
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
  let position = markers.find(marker => marker.id === player?.id)?.point;
  const draw = () => {
    renderer.render(false, false);
    for (const item of fixtures) if (item.position) {
      renderer.drawSprite("tiny-dungeon", item.sprite, item.position.x, item.position.y);
      if (item.open) {
        const context = canvas.getContext("2d")!;
        context.save(); context.fillStyle = "#f5dc9a";
        context.fillRect(item.position.x * palaceMap.tileWidth + 4, item.position.y * palaceMap.tileHeight + 12, 8, 2);
        context.restore();
      }
    }
    drawDoors(canvas.getContext("2d")!, doors);
  };
  draw();
  visualPosition = position;
  const place = (point: Point) => {
    visualPosition = point;
    if (!playerControl) return;
    playerControl.style.left = `${(point.x + 0.5) / palaceMap.width * 100}%`;
    playerControl.style.top = `${(point.y + 0.5) / palaceMap.height * 100}%`;
  };
  walkTo = async (target, interaction) => {
    if (disabled || !position || !movePlayer) return;
    if (moving) {
      if (redirect) {
        const changed = redirect(target);
        pendingInteraction = changed ? interaction : undefined;
        if (!changed) status.textContent = "That tile is blocked; continuing to your previous destination.";
      }
      return;
    }
    let path = courtPath(position, target, doors, fixtures);
    pendingInteraction = path ? interaction : undefined;
    if (!path) { status.textContent = "You cannot walk there. Choose a clear floor tile."; return; }
    if (path.length < 2) {
      const action = pendingInteraction; pendingInteraction = undefined; moving = true;
      try { await action?.(); } catch (error) { status.textContent = error instanceof Error ? error.message : "Interaction failed."; }
      finally { moving = false; }
      return;
    }
    moving = true;

    const start = position;
    let destination = path[path.length - 1]!;
    status.textContent = `Walking to ${courtRoomAt(destination)?.name ?? "the passage"}…`;
    const context = canvas.getContext("2d")!;
    const drawRoute = () => {
      draw();
      context.beginPath(); context.strokeStyle = "#fff0aa"; context.lineWidth = 2;
      path!.forEach((point, index) => { if (!index) context.moveTo(point.x * 16 + 8, point.y * 16 + 8); else context.lineTo(point.x * 16 + 8, point.y * 16 + 8); }); context.stroke();
    };
    drawRoute();
    let started = performance.now();
    redirect = target => {
      const now = performance.now();
      const replacement = redirectCourtPath(path!, (now - started) / 100, target, doors, fixtures);
      if (!replacement) return false;
      path = replacement; started = now; destination = target;
      place(path[0]!); drawRoute();
      status.textContent = `Changed course: walking to ${courtRoomAt(target)?.name ?? "the passage"}…`;
      return true;
    };
    const arrived = await new Promise<boolean>(resolve => {
      const animate = (time: number) => {
        if (!root.isConnected) { resolve(false); return; }
        const progress = Math.min((time - started) / 100, path!.length - 1);
        place(courtWalkPoint(path!, progress));
        if (progress === path!.length - 1) resolve(true); else window.setTimeout(() => animate(performance.now()), 16);
      };
      // The embedded browser can throttle requestAnimationFrame even while the
      // map is visible. Match the palace prototype's elapsed-time timer loop.
      window.setTimeout(() => animate(performance.now()), 16);
    });
    redirect = undefined;
    if (!arrived) return;
    let committed = false;
    try {
      await movePlayer(destination); position = destination; committed = true;
      status.textContent = `Arrived in ${courtRoomAt(destination)?.name ?? "the palace"}.`;
      const action = pendingInteraction; pendingInteraction = undefined;
      if (root.isConnected) await action?.();
    } catch (error) {
      pendingInteraction = undefined;
      if (!committed) place(start); status.textContent = error instanceof Error ? error.message : "Could not save your move.";
    } finally {
      moving = false; draw();

    }
   };
  canvas.addEventListener("click", event => {
    closeMenu(); const hit = renderer.hit(event.clientX, event.clientY);
    if (hit) void walkTo({ x: hit.tileX, y: hit.tileY });
  });
  canvas.addEventListener("contextmenu", event => {
    event.preventDefault(); const hit = renderer.hit(event.clientX, event.clientY);
    if (hit) showMenu({ x: hit.tileX, y: hit.tileY }, event.clientX, event.clientY);
  });
}
