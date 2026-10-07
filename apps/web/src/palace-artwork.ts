import type { WorldMap } from "../../../packages/contracts/src/index.js";
import type { CanvasMapRenderer } from "./map-renderer.js";

export const mapArtworks = [{ id: "pencil", name: "Pencil & stone" }, { id: "furnished", name: "Furnished palace" }, { id: "parchment", name: "Ink on parchment" }] as const;
export type MapArtwork = typeof mapArtworks[number]["id"];
const storageKey = "kingmaker-map-artwork";
let selected: MapArtwork = "furnished";
export function mapArtwork(): MapArtwork {
  try { const saved = localStorage.getItem(storageKey); if (mapArtworks.some(option => option.id === saved)) selected = saved as MapArtwork; } catch {}
  return selected;
}
export function selectMapArtwork(value: string): void {
  if (!mapArtworks.some(option => option.id === value)) return;
  selected = value as MapArtwork;
  try { localStorage.setItem(storageKey, selected); } catch {}
}

// A flat print treatment, applied equally to scenery and portrait counters.
export function mapArtworkFilter(): string {
  return mapArtwork() === "parchment" ? "grayscale(1) sepia(.45) contrast(.9)" : "none";
}

export const furnishingSprites: Readonly<Record<number, number>> = { 63: 10, 73: 9, 75: 11, 79: 12, 80: 13, 90: 14 };

/** Artwork only: all floor ownership, fixture footprints and doorway access stay authored. */
export function drawPalaceInteriors(renderer: CanvasMapRenderer, map: WorldMap): void {
  if (map.id !== "caerwyn-palace") return;
  const sprite = (id: number, x: number, y: number, width = 1, height = 1, inset = 0) =>
    renderer.drawSprite("palace-furnishings", id, x, y, width, height, inset);
  // Paper outside the cutaway; stone in corridors and wood in inhabited rooms.
  map.tiles.forEach((tile, index) => {
    const x = index % map.width, y = Math.floor(index / map.width);
    if (tile.layers.length === 1 && tile.layers[0]?.solid) sprite(2, x, y, 1, 1, .12);
    else if (!tile.layers.some(layer => layer.solid)) sprite(1, x, y, 1, 1, .12);
  });
  for (const room of map.rooms) {
    const r = room.regions[0];
    if (!r) continue;
    const corridor = room.id.endsWith("_back_hall") || ["north_corridor", "west_wing", "entrance_hall"].includes(room.id);
    if (!corridor && room.id !== "treasury") {
      for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) sprite(0, x, y, 1, 1, .12);
    }
    const rug = /greenweald|elinor|oswin|rowan/.test(room.id) ? 4 : /saltmere|lucan|sabine|rook/.test(room.id) ? 5 : 3;
    if (room.id === "great_hall") sprite(6, r.x + 2, r.y + 2, r.width - 4, r.height - 3);
    else if (room.id === "dining_hall") {
      sprite(3, r.x + 7, r.y + 1, 25, 3);
      sprite(3, r.x + 7, r.y + 5, 25, 3);
    } else if (corridor && r.width > 10) sprite(7, r.x + 2, r.y, r.width - 4, r.height);
    else if (!corridor && room.id !== "treasury") sprite(rug, r.x + 1, r.y + 1, r.width - 2, r.height - 2);
    else if (room.id === "entrance_hall") sprite(6, r.x + 2, r.y + 1, r.width - 4, r.height - 2);
  }
}
