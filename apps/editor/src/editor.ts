import { palaceMap } from "../../web/src/palace-map.js";
import { DiskDocument } from "./file-sync.js";

interface Point { x: number; y: number }
interface CharacterJson { id: string; name: string; lore?: string; currentGoal?: string; gender?: string; delegation?: string; sprite?: number }
interface ActorJson { characterId: string; roomId?: string; homeRoomId?: string; position?: Point; awake?: boolean }
interface FixtureJson { id: string; name: string; roomId?: string; position?: Point; interactionSpot?: Point; sprite?: number; [key: string]: unknown }
interface DoorJson { id: string; name: string; tiles: Point[]; interactionSpots: Point[]; roomIds?: string[]; open?: boolean }
interface RoomJson { id: string; name: string; description?: string; exitRoomIds?: string[]; private?: boolean; allowedCharacterIds?: string[] }
interface ScenarioJson {
  id: string; systemPrompt?: string; premise?: string; gameMasterPrompt?: string;
  characters: CharacterJson[]; world?: { rooms?: RoomJson[]; actors?: ActorJson[]; fixtures?: FixtureJson[]; doors?: DoorJson[] };
  [key: string]: unknown;
}
type Tool = "inspect" | "place";
type Entity = { kind: "actor" | "fixture" | "door"; id: string; label: string };

const root = document.querySelector<HTMLElement>("#editor")!;
const scenarioDocument = new DiskDocument<ScenarioJson>("scenario");
let activePanel: "map" | "scenario" | "json" = "map";
let tool: Tool = "inspect", selectedEntity = "", selectedCharacter = "";
let selectedTile: Point | undefined;
let tileset: HTMLImageElement | undefined;

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}
function entities(): Entity[] {
  const world = scenarioDocument.value?.world;
  return [
    ...(world?.actors ?? []).map(item => ({ kind: "actor" as const, id: item.characterId, label: `Actor · ${characterName(item.characterId)}` })),
    ...(world?.fixtures ?? []).map(item => ({ kind: "fixture" as const, id: item.id, label: `Fixture · ${item.name}` })),
    ...(world?.doors ?? []).map(item => ({ kind: "door" as const, id: item.id, label: `Door · ${item.name}` })),
  ];
}
function characterName(id: string): string { return scenarioDocument.value?.characters.find(item => item.id === id)?.name ?? id; }
function roomAt(point: Point): string | undefined {
  return palaceMap.rooms.find(room => room.regions.some(region => point.x >= region.x && point.y >= region.y
    && point.x < region.x + region.width && point.y < region.y + region.height))?.id;
}
function markScenarioDirty(update: (scenario: ScenarioJson) => void): void { scenarioDocument.change(update); drawMap(); updateStatus(); }

function placeEntity(point: Point): void {
  const entity = entities().find(item => `${item.kind}:${item.id}` === selectedEntity); if (!entity) return;
  markScenarioDirty(scenario => {
    const world = scenario.world; if (!world) return;
    const roomId = roomAt(point);
    if (entity.kind === "actor") { const item = world.actors?.find(value => value.characterId === entity.id); if (item) { item.position = point; if (roomId) item.roomId = roomId; } }
    if (entity.kind === "fixture") { const item = world.fixtures?.find(value => value.id === entity.id); if (item) { item.position = point; if (roomId) item.roomId = roomId; } }
    if (entity.kind === "door") { const item = world.doors?.find(value => value.id === entity.id); if (item) item.tiles = [point]; }
  });
}

function loadTileset(): void {
  const image = new Image();
  image.addEventListener("load", () => { tileset = image; drawMap(); }, { once: true });
  image.src = "./assets/kenney-tiny-dungeon.png";
}
function drawSprite(context: CanvasRenderingContext2D, tileId: number, x: number, y: number, size: number): void {
  if (!tileset) return;
  context.drawImage(tileset, tileId % 12 * 16, Math.floor(tileId / 12) * 16, 16, 16, x * size, y * size, size, size);
}
function drawMap(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#map-canvas");
  if (!canvas) return;
  const scale = 2, size = palaceMap.tileWidth * scale;
  canvas.width = palaceMap.width * size; canvas.height = palaceMap.height * size;
  const context = canvas.getContext("2d")!; context.imageSmoothingEnabled = false; context.fillStyle = "#080706"; context.fillRect(0, 0, canvas.width, canvas.height);
  palaceMap.tiles.forEach((tile, index) => tile.layers.forEach(layer => drawSprite(context, layer.tileId, index % palaceMap.width, Math.floor(index / palaceMap.width), size)));
  for (const item of scenarioDocument.value?.world?.fixtures ?? []) if (item.position) drawSprite(context, item.sprite ?? 0, item.position.x, item.position.y, size);
  context.lineWidth = 1; context.strokeStyle = "rgba(255,255,255,.11)";
  for (let x = 0; x <= palaceMap.width; x += 1) { context.beginPath(); context.moveTo(x * size, 0); context.lineTo(x * size, canvas.height); context.stroke(); }
  for (let y = 0; y <= palaceMap.height; y += 1) { context.beginPath(); context.moveTo(0, y * size); context.lineTo(canvas.width, y * size); context.stroke(); }
  for (const door of scenarioDocument.value?.world?.doors ?? []) for (const point of door.tiles) {
    context.fillStyle = door.open ? "rgba(91,193,135,.8)" : "rgba(196,77,64,.85)"; context.fillRect(point.x * size + 5, point.y * size + 5, size - 10, size - 10);
  }
  context.textAlign = "center"; context.textBaseline = "middle"; context.font = `600 ${Math.max(10, size * .3)}px sans-serif`;
  for (const actor of scenarioDocument.value?.world?.actors ?? []) if (actor.position) {
    context.fillStyle = "#f0c76b"; context.beginPath(); context.arc((actor.position.x + .5) * size, (actor.position.y + .5) * size, size * .32, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#211810"; context.fillText(characterName(actor.characterId).slice(0, 1), (actor.position.x + .5) * size, (actor.position.y + .5) * size);
  }
  if (selectedTile) { context.strokeStyle = "#fff0b8"; context.lineWidth = 3; context.strokeRect(selectedTile.x * size + 1.5, selectedTile.y * size + 1.5, size - 3, size - 3); }
}

function field(label: string, key: "id" | "premise" | "systemPrompt" | "gameMasterPrompt", multiline = false): string {
  const value = scenarioDocument.value?.[key] ?? "";
  return `<label class="field"><span>${label}</span>${multiline ? `<textarea data-scenario-field="${key}" rows="8">${escapeHtml(value)}</textarea>` : `<input data-scenario-field="${key}" value="${escapeHtml(value)}">`}</label>`;
}
function render(): void {
  const scenario = scenarioDocument.value, availableEntities = entities();
  if (!selectedEntity && availableEntities[0]) selectedEntity = `${availableEntities[0].kind}:${availableEntities[0].id}`;
  if (!selectedCharacter && scenario?.characters[0]) selectedCharacter = scenario.characters[0].id;
  const character = scenario?.characters.find(item => item.id === selectedCharacter);
  root.innerHTML = `
    <header><div><p class="eyebrow">Content tools</p><h1>Kingmaker Workshop</h1></div><div class="file-actions">
      <button id="open-scenario">${scenario ? "Change scenario file" : "Open scenario JSON"}</button>
    </div></header>
    <div id="status" class="status-strip"></div>
    <nav><button data-panel="map" class="${activePanel === "map" ? "active" : ""}">Map</button><button data-panel="scenario" class="${activePanel === "scenario" ? "active" : ""}">Scenario</button><button data-panel="json" class="${activePanel === "json" ? "active" : ""}">Raw JSON</button></nav>
    ${activePanel === "map" ? `<section class="workspace">
      <aside><h2>Map tools</h2>
        <label class="field"><span>Tool</span><select id="tool">${[["inspect","Inspect"],["place","Place entity"]].map(([value,label]) => `<option value="${value}" ${tool === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label class="field"><span>Entity</span><select id="entity">${availableEntities.map(item => `<option value="${item.kind}:${escapeHtml(item.id)}" ${selectedEntity === `${item.kind}:${item.id}` ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
        <p class="hint">Place JSON-backed actors, furniture, and doors directly on the current game map. Gold circles are actors; furniture uses its game sprite; red and green squares are closed and open doors.</p>
        <div id="tile-inspector" class="inspector">${selectedTile ? `<strong>Tile ${selectedTile.x}, ${selectedTile.y}</strong><span>${escapeHtml(roomAt(selectedTile) ?? "Solid / no room")}</span>` : "Select a tile to inspect it."}</div>
      </aside>
      <div class="canvas-shell"><canvas id="map-canvas" aria-label="Editable palace scenario map"></canvas></div>
    </section>` : activePanel === "scenario" ? `<section class="scenario-workspace">
      <aside><h2>Characters</h2><div class="character-list">${(scenario?.characters ?? []).map(item => `<button data-character="${escapeHtml(item.id)}" class="${item.id === selectedCharacter ? "active" : ""}">${escapeHtml(item.name)}</button>`).join("")}</div></aside>
      <div class="form-scroll">${scenario ? `<div class="form-card"><h2>Scenario</h2>${field("ID", "id")}${field("Premise", "premise", true)}${field("System prompt", "systemPrompt", true)}${field("Game master prompt", "gameMasterPrompt", true)}</div>
      ${character ? `<div class="form-card"><h2>${escapeHtml(character.name)}</h2>
        ${["name","gender","delegation","sprite"].map(key => `<label class="field"><span>${key}</span><input data-character-field="${key}" value="${escapeHtml(character[key as keyof CharacterJson] ?? "")}"></label>`).join("")}
        ${["lore","currentGoal"].map(key => `<label class="field"><span>${key}</span><textarea data-character-field="${key}" rows="7">${escapeHtml(character[key as keyof CharacterJson] ?? "")}</textarea></label>`).join("")}
      </div>` : ""}` : `<div class="empty"><h2>Open the scenario</h2><p>Select <code>content/scenarios/last-night.json</code>.</p></div>`}</div>
    </section>` : `<section class="raw-workspace"><div class="form-card"><h2>Complete scenario JSON</h2><p class="hint">This exposes fields that do not yet have a dedicated visual control. Changes apply when the field loses focus.</p><textarea id="raw-json" spellcheck="false">${escapeHtml(scenario ? JSON.stringify(scenario, null, 2) : "")}</textarea><p id="raw-error" class="raw-error"></p></div></section>`}`;
  bind(); updateStatus(); drawMap();
}

function bind(): void {
  document.querySelector("#open-scenario")?.addEventListener("click", () => void openDocument(scenarioDocument));
  document.querySelectorAll<HTMLButtonElement>("[data-panel]").forEach(button => button.addEventListener("click", () => { activePanel = button.dataset.panel as typeof activePanel; render(); }));
  document.querySelector<HTMLSelectElement>("#tool")?.addEventListener("change", event => { tool = (event.target as HTMLSelectElement).value as Tool; });
  document.querySelector<HTMLSelectElement>("#entity")?.addEventListener("change", event => { selectedEntity = (event.target as HTMLSelectElement).value; });
  document.querySelectorAll<HTMLButtonElement>("[data-character]").forEach(button => button.addEventListener("click", () => { selectedCharacter = button.dataset.character!; render(); }));
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-scenario-field]").forEach(input => input.addEventListener("input", () => {
    const key = input.dataset.scenarioField as "id" | "premise" | "systemPrompt" | "gameMasterPrompt"; markScenarioDirty(value => { value[key] = input.value; });
  }));
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-character-field]").forEach(input => input.addEventListener("input", () => {
    const key = input.dataset.characterField as keyof CharacterJson;
    markScenarioDirty(value => { const item = value.characters.find(candidate => candidate.id === selectedCharacter); if (item) (item as unknown as Record<string, unknown>)[key] = key === "sprite" ? Number(input.value) : input.value; });
  }));
  const canvas = document.querySelector<HTMLCanvasElement>("#map-canvas");
  canvas?.addEventListener("pointerdown", event => {
    const rect = canvas.getBoundingClientRect(), point = { x: Math.floor((event.clientX - rect.left) / rect.width * palaceMap.width), y: Math.floor((event.clientY - rect.top) / rect.height * palaceMap.height) };
    selectedTile = point;
    if (tool === "place") placeEntity(point); else { drawMap(); const inspector = document.querySelector("#tile-inspector"); if (inspector) inspector.innerHTML = `<strong>Tile ${point.x}, ${point.y}</strong><span>${escapeHtml(roomAt(point) ?? "Solid / no room")}</span>`; }
  });
  document.querySelector<HTMLTextAreaElement>("#raw-json")?.addEventListener("change", event => {
    const error = document.querySelector<HTMLElement>("#raw-error");
    try { scenarioDocument.replace(JSON.parse((event.target as HTMLTextAreaElement).value) as ScenarioJson); if (error) error.textContent = ""; }
    catch (reason) { if (error) error.textContent = reason instanceof Error ? reason.message : String(reason); }
  });
}

async function openDocument<T extends object>(document: DiskDocument<T>): Promise<void> {
  try { await document.open(); }
  catch (error) { document.status = error instanceof Error ? error.message : String(error); updateStatus(); }
}
function updateStatus(): void {
  const status = document.querySelector<HTMLElement>("#status"); if (!status) return;
  const item = (document: DiskDocument<object>, label: string) => `<div class="file-state ${document.conflict ? "conflict" : document.dirty ? "dirty" : ""}"><span>${label}</span><strong>${escapeHtml(document.status)}</strong>${document.conflict ? `<button data-reload="${document.kind}">Reload disk version</button>` : ""}</div>`;
  status.innerHTML = item(scenarioDocument, "Scenario");
  status.querySelectorAll<HTMLButtonElement>("[data-reload]").forEach(button => button.addEventListener("click", () => void scenarioDocument.reload()));
}
async function saveAll(): Promise<void> {
  await scenarioDocument.save().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    if (scenarioDocument.dirty) scenarioDocument.status = message; updateStatus();
  });
}
async function checkDisk(): Promise<void> { await scenarioDocument.checkDisk().catch(() => {}); }

scenarioDocument.addEventListener("change", render);
scenarioDocument.addEventListener("dirty", updateStatus);
window.addEventListener("blur", () => void saveAll());
window.addEventListener("focus", () => void checkDisk());
document.addEventListener("focusout", () => setTimeout(() => void saveAll(), 0));
setInterval(() => { if (document.visibilityState === "visible") void checkDisk(); }, 1000);

render(); loadTileset();
void scenarioDocument.restore().then(() => render());
