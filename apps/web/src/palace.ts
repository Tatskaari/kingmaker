import { CanvasMapRenderer } from "./map-renderer.js";
import { palaceMap } from "./palace-map.js";

const canvas = document.querySelector<HTMLCanvasElement>("[data-map]");
const inspector = document.querySelector<HTMLElement>("[data-inspector]");
const roomsToggle = document.querySelector<HTMLInputElement>("[data-show-rooms]");
const solidsToggle = document.querySelector<HTMLInputElement>("[data-show-solids]");

if (!canvas || !inspector || !roomsToggle || !solidsToggle) throw new Error("Palace map page is incomplete");

const renderer = new CanvasMapRenderer(canvas, palaceMap);
await renderer.load();

function render(): void {
  renderer.render(roomsToggle!.checked, solidsToggle!.checked);
}

roomsToggle.addEventListener("change", render);
solidsToggle.addEventListener("change", render);
canvas.addEventListener("pointermove", event => {
  const hit = renderer.hit(event.clientX, event.clientY);
  inspector.textContent = hit
    ? `${hit.roomName || "Outside"} · tile ${hit.tileX}, ${hit.tileY} · ${hit.layer?.solid ? "solid" : "walkable"}`
    : "Move over the map to inspect a tile";
});
canvas.addEventListener("pointerleave", () => {
  inspector.textContent = "Move over the map to inspect a tile";
});

render();
