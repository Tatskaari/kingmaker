import { actorPosition, actorTile } from "../../../packages/core/src/simulation-movement.js";
import { courtRoomAt, courtDoorBlockers, courtInteractionPoint, nearestDoorSpot } from "./court-navigation.js";
import { doorActionLegality, type RoomAccess } from "../../../packages/core/src/access.js";
import type { FixtureAction } from "../../../packages/core/src/fixtures.js";
import type { DoorState, MapFixture, ActorMovement } from "../../../packages/contracts/src/index.js";
import { drawDoors } from "./draw-doors.js";
import { actionsAtTile, requireCurrentFixtureAction, type CourtInteractionLayer } from "./court-interactions.js";
import { CanvasMapRenderer } from "./map-renderer.js";
import { palaceMap } from "./palace-map.js";
import { canWalk, pointKey, type Point } from "../../../packages/core/src/navigation.js";

export interface CourtCharacter { id: string; instanceId?: string; name: string; roomId?: string; position?: Point; movement?: ActorMovement; sprite?: number }
export interface CourtMarker extends CourtCharacter { point?: Point; roomName: string; sprite: number }

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not encode the world screenshot.")), "image/png"));
}

/** Capture the complete palace map, including DOM-rendered characters and their labels. */
export async function captureCourtMap(root: HTMLElement | null): Promise<Blob | undefined> {
  const stage = root?.querySelector<HTMLElement>(".court-map-stage");
  const source = stage?.querySelector<HTMLCanvasElement>("canvas");
  if (!stage || !source || !source.width || !source.height) return undefined;
  const output = document.createElement("canvas");
  output.width = source.width; output.height = source.height;
  const context = output.getContext("2d");
  if (!context) throw new Error("Canvas 2D rendering is unavailable");
  context.drawImage(source, 0, 0);

  const stageRect = stage.getBoundingClientRect();
  const scaleX = output.width / stageRect.width, scaleY = output.height / stageRect.height;
  const sample = stage.querySelector<HTMLElement>(".court-sprite");
  const imageUrl = sample && getComputedStyle(sample).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
  if (imageUrl) {
    const sprites = new Image(); sprites.src = imageUrl;
    await sprites.decode();
    context.imageSmoothingEnabled = false;
    for (const character of stage.querySelectorAll<HTMLElement>("[data-character-sprite]")) {
      const spriteId = Number(character.dataset.characterSprite);
      const sprite = character.querySelector<HTMLElement>(".court-sprite");
      const label = character.querySelector<HTMLElement>(".court-character-name");
      if (!sprite || !Number.isInteger(spriteId)) continue;
      const bounds = sprite.getBoundingClientRect();
      const x = (bounds.left - stageRect.left) * scaleX, y = (bounds.top - stageRect.top) * scaleY;
      const width = bounds.width * scaleX, height = bounds.height * scaleY;
      context.drawImage(sprites, spriteId % 12 * 32, Math.floor(spriteId / 12) * 32, 32, 32, x, y, width, height);
      if (!label?.textContent) continue;
      const text = label.textContent;
      context.font = `${Math.max(9, Math.round(13 * scaleY))}px Georgia, serif`;
      context.textAlign = "center"; context.textBaseline = "top";
      const centre = x + width / 2, labelY = y + height + 2 * scaleY;
      const textWidth = context.measureText(text).width;
      context.fillStyle = "rgba(23, 16, 9, .92)";
      context.fillRect(centre - textWidth / 2 - 3, labelY - 1, textWidth + 6, Math.max(11, 15 * scaleY));
      context.fillStyle = character.classList.contains("court-player") ? "#afe1cf" : "#fff1ce";
      context.fillText(text, centre, labelY);
    }
  }
  return canvasBlob(output);
}

export function courtMarkers(characters: readonly CourtCharacter[], fixtures: readonly MapFixture[] = [], layout = palaceMap): CourtMarker[] {
  return characters.map(character => {
    const room = layout.rooms.find(room => room.id === character.roomId);
    const sprite = character.sprite ?? (character.id === "corvin" ? 84 : character.id === "garran" ? 96 : character.id === "king" ? 85 : 98);
    const point = character.position;
    const valid = point && canWalk(layout, actorTile(point), courtDoorBlockers([], fixtures)) && (character.movement || courtRoomAt(actorTile(point), layout)?.id === room?.id);
    return { ...character, roomName: room?.name ?? character.roomId ?? "Location unknown", sprite,
      ...(valid ? { point } : {}) };
  });
}

export function courtCameraScroll(point: Point, stageWidth: number, stageHeight: number,
  viewportWidth: number, viewportHeight: number): Point {
  const centreX = (point.x + 0.5) / palaceMap.width * stageWidth;
  const centreY = (point.y + 0.5) / palaceMap.height * stageHeight;
  return {
    x: Math.max(0, Math.min(centreX - viewportWidth / 2, stageWidth - viewportWidth)),
    y: Math.max(0, Math.min(centreY - viewportHeight / 2, stageHeight - viewportHeight)),
  };
}
export async function mountCourtMap(root: HTMLElement, characters: readonly CourtCharacter[], player: CourtCharacter | null,
  selectCharacter: (id: string) => void, disabled = false, movePlayer?: (point: Point) => Promise<"arrived" | "cancelled" | "superseded">, doors: DoorState[] = [], changeDoor?: (id: string, open: boolean) => Promise<DoorState[]>, rooms: readonly RoomAccess[] = [], fixtures: readonly MapFixture[] = [], fixtureChoices: readonly FixtureAction[] = [], interactFixture?: (actionId: string) => Promise<void>, pauseCharacter?: (id: string) => Promise<void>, debugCharacter?: (id: string) => Promise<void>, layout = palaceMap, reportStatus: (message: string) => void = () => {}): Promise<void> {
  const palaceMap = layout;
  const viewport = document.createElement("div"); viewport.className = "court-map-scroll";
  const stage = document.createElement("div"); stage.className = "court-map-stage";
  stage.style.aspectRatio = `${palaceMap.width} / ${palaceMap.height}`;
  stage.style.width = `${palaceMap.width * 24}px`;
  const canvas = document.createElement("canvas"); canvas.setAttribute("aria-label", "Palace of Caerwyn");
  stage.append(canvas); viewport.append(stage); root.append(viewport);
  reportStatus("Left-click to walk; click again to change destination. Right-click a tile or character for actions.");
  let moving = false;
  let walkRequest = 0;
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
  const resizeObserver = new ResizeObserver(() => {
    if (visualPosition) centreOnPlayer(visualPosition);
  });
  const cleanup = new MutationObserver(() => {
    if (!root.isConnected) { listeners.abort(); resizeObserver.disconnect(); cleanup.disconnect(); }
  });
  cleanup.observe(document.body, { childList: true, subtree: true });
  let walkTo: (point: Point, interaction?: () => void | Promise<void>) => Promise<void> = async () => {};
  const approach = (target: Point, authored?: Point) => visualPosition && courtInteractionPoint(
    { x: Math.round(visualPosition.x), y: Math.round(visualPosition.y) }, target, authored, doors, fixtures, layout);
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
      const point = actorPosition(marker, Date.now()) ?? marker.point;
      if (!point) continue;
      layers.push({ id: marker.instanceId ?? marker.id, position: { x: Math.round(point.x), y: Math.round(point.y) }, order: 30,
        actions: marker.id === player?.id ? [] : [
          { id: `talk_${marker.id}`, label: `Talk to ${marker.name}`, type: "talk", target: marker.instanceId ?? marker.id, order: 10, legality: "normal" },
          ...(debugCharacter ? [{ id: `debug_${marker.id}`, label: `Debug character: ${marker.name}`, type: "debug" as const, target: marker.id, order: 11, legality: "normal" as const }] : []),
        ] });
    }
    menu.replaceChildren();
    const title = document.createElement("p"); title.className = "court-menu-title"; title.textContent = "Actions"; menu.append(title);
    const actions = actionsAtTile(tile, layers);
    for (const action of actions) {
      const button = document.createElement("button"); button.type = "button";
      button.className = `court-menu-action court-action-${action.legality}`;
      button.textContent = action.label + (action.legality === "illegal" ? " · Illegal" : "");
      button.disabled = action.type !== "debug" && (!movePlayer || !visualPosition);
      button.addEventListener("click", async () => {
        closeMenu();
        if (action.type === "debug") await debugCharacter?.(action.target);
        else if (action.type === "walk") void walkTo(tile);
        else if (action.type === "door") {
          const door = doors.find(door => door.id === action.target);
          const spot = door && visualPosition && nearestDoorSpot({ x: Math.round(visualPosition.x), y: Math.round(visualPosition.y) }, door, doors, fixtures, layout);
          if (!door || !spot || !changeDoor) { reportStatus("No reachable interaction spot for this door."); return; }
          const open = !door.open;
          void walkTo(spot, async () => {
            doors = await changeDoor(door.id, open);
            draw();
          });
        } else if (action.type === "fixture") {
          const fixture = fixtures.find(item => item.id === action.target);
          const spot = fixture?.position && approach(fixture.position, fixture.interactionSpot);
          if (!spot || !interactFixture) { reportStatus("No reachable interaction spot for this furniture."); return; }
          void walkTo(spot, () => {
            requireCurrentFixtureAction(action, fixtureChoices);
            return interactFixture(action.id);
          });
        } else {
          const character = markers.find(marker => (marker.instanceId ?? marker.id) === action.target);
          if (!character) return;
          try { await pauseCharacter?.(character.id); }
          catch { reportStatus("Could not pause this character. Try again."); return; }
          const target = actorPosition(character, Date.now());
          const spot = target && approach(actorTile(target));
          if (!spot) { reportStatus("There is no reachable interaction spot for that character."); return; }
          void walkTo(spot, () => selectCharacter(character.id));
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
  const markers = courtMarkers([...characters, ...(player ? [player] : [])], fixtures, layout);
  for (const marker of markers) {
    const isPlayer = marker.id === player?.id;
    const control = document.createElement(isPlayer ? "div" : "button");
    control.dataset.characterId = marker.id;
    control.dataset.instanceId = marker.instanceId ?? marker.id;
    control.dataset.characterSprite = String(marker.sprite);
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
    // Adjacent identical bodies share a visible label, while each button remains named.
    const labelledBody = marker.instanceId && marker.point ? markers.find(other => other.id === marker.id && other.point
      && Math.abs(other.point.x - marker.point!.x) + Math.abs(other.point.y - marker.point!.y) <= 2) : marker;
    control.append(sprite);
    if (labelledBody === marker) control.append(label);
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
  const artworkKey = () => JSON.stringify([
    doors.map(door => [door.tiles, door.open]),
    fixtures.map(item => [item.position, item.sprite, item.open]),
    markers.find(marker => marker.id === player?.id)?.movement?.id,
  ]);
  let drawnArtwork = "";
  const draw = () => {
    drawnArtwork = artworkKey();
    renderer.render();
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
    const path = markers.find(marker => marker.id === player?.id)?.movement?.path;
    if (path?.length) {
      const context = canvas.getContext("2d")!;
      context.beginPath(); context.strokeStyle = "#fff0aa"; context.lineWidth = 2;
      path.forEach((point, index) => {
        const x = (point.x + 0.5) * palaceMap.tileWidth, y = (point.y + 0.5) * palaceMap.tileHeight;
        if (index) context.lineTo(x, y); else context.moveTo(x, y);
      });
      context.stroke();
    }
  };
  draw();
  visualPosition = position;
  const centreOnPlayer = (point: Point) => {
    const scroll = courtCameraScroll(point, stage.offsetWidth, stage.offsetHeight, viewport.clientWidth, viewport.clientHeight);
    viewport.scrollTo({ left: scroll.x, top: scroll.y });
  };
  const place = (point: Point) => {
    visualPosition = point;
    if (!playerControl) return;
    playerControl.style.left = `${(point.x + 0.5) / palaceMap.width * 100}%`;
    playerControl.style.top = `${(point.y + 0.5) / palaceMap.height * 100}%`;
    centreOnPlayer(point);
  };
  resizeObserver.observe(viewport);
  if (position) requestAnimationFrame(() => centreOnPlayer(position!));
  root.addEventListener("court-state", event => {
    const next = (event as CustomEvent<{ characters: CourtCharacter[]; player: CourtCharacter; doors: DoorState[];
      fixtures: MapFixture[]; fixtureActions: FixtureAction[]; roomAccess: RoomAccess[]; disabled?: boolean }>).detail;
    if (next.disabled !== undefined) {
      disabled = next.disabled;
      for (const button of root.querySelectorAll<HTMLButtonElement>("button.court-character")) button.disabled = disabled;
      if (disabled) closeMenu();
    }
    if (JSON.stringify(fixtureChoices) !== JSON.stringify(next.fixtureActions)) closeMenu();
    doors = next.doors; fixtures = next.fixtures; fixtureChoices = next.fixtureActions; rooms = next.roomAccess;
    const updated = courtMarkers([...next.characters, next.player], fixtures, layout);
    for (const marker of markers) {
      const current = updated.find(item => (item.instanceId ?? item.id) === (marker.instanceId ?? marker.id)); if (!current) continue;
      Object.assign(marker, current);
      if (marker.id === player?.id) {
        if (!moving && marker.point && (position?.x !== marker.point.x || position?.y !== marker.point.y)) {
          position = marker.point; place(marker.point);
        }
        continue;
      }
      const control = stage.querySelector<HTMLElement>(`[data-instance-id="${CSS.escape(marker.instanceId ?? marker.id)}"]`);
      if (control && marker.point) {
        control.style.transition = "none";
        control.style.left = `${(marker.point.x + 0.5) / palaceMap.width * 100}%`;
        control.style.top = `${(marker.point.y + 0.5) / palaceMap.height * 100}%`;
        control.setAttribute("aria-label", `Walk to ${marker.name} · ${marker.roomName}`);
      }
    }
    if (artworkKey() !== drawnArtwork) draw();
  }, { signal: listeners.signal });
  // Every actor is drawn from the same authority-supplied movement record.
  const animateActors = () => {
    if (!root.isConnected) return;
    const now = Date.now();
    for (const marker of markers) {
      const point = actorPosition(marker, now);
      if (!point) continue;
      if (marker.id === player?.id) {
        if (visualPosition?.x !== point.x || visualPosition?.y !== point.y) place(point);
        position = point;
      }
      else {
        const control = stage.querySelector<HTMLElement>(`[data-instance-id="${CSS.escape(marker.instanceId ?? marker.id)}"]`);
        if (control) {
          control.style.left = `${(point.x + 0.5) / palaceMap.width * 100}%`;
          control.style.top = `${(point.y + 0.5) / palaceMap.height * 100}%`;
        }
      }
    }
    window.setTimeout(animateActors, 16);
  };
  window.setTimeout(animateActors, 16);
  walkTo = async (target, interaction) => {
    if (disabled || !position || !movePlayer) return;
    const request = ++walkRequest;
    moving = true;
    try {
      const outcome = await movePlayer(target);
      if (request === walkRequest && outcome === "arrived" && root.isConnected) await interaction?.();
    } catch (error) {
      if (request === walkRequest) reportStatus(error instanceof Error ? error.message : "Could not move.");
    } finally {
      if (request === walkRequest) { moving = false; draw(); }
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

/** Refresh live state without replacing the map or interrupting a player walk. */
export function updateCourtMap(root: HTMLElement | null, state: unknown): void {
  root?.dispatchEvent(new CustomEvent("court-state", { detail: state }));
}
