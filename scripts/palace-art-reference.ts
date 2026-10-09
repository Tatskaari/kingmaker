import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { palaceLayout } from "../apps/web/src/palace-layout.js";
import { palaceMap } from "../apps/web/src/palace-map.js";
import type { PreviewDoor, PreviewFixture } from "../apps/web/src/room-builder.js";

// Like preview-palace.ts, this reads authored geometry and fixtures without starting a game.
const output = resolve(process.argv[2] ?? "/tmp/kingmaker-palace-reference");
const source = JSON.parse(readFileSync(new URL("../content/palace-map.json", import.meta.url), "utf8")) as {
  doors: (PreviewDoor & { name: string })[];
  fixtures: (PreviewFixture & { id: string; roomId: string })[];
};
const tile = 24, width = palaceLayout.width * tile, height = palaceLayout.height * tile;
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const text = (x: number, y: number, value: string, size = 16, extra = "") =>
  `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${escape(value)}</text>`;
const rect = (x: number, y: number, w: number, h: number, fill: string, extra = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const symbols: Record<number, { letter: string; label: string }> = {
  63: { letter: "K", label: "Bookcase / shelving" }, 72: { letter: "T", label: "Table / desk segment" },
  73: { letter: "S", label: "Seat / stool" }, 75: { letter: "C", label: "Cabinet / wardrobe" },
  79: { letter: "H", label: "Bed: pillow / head half" }, 80: { letter: "F", label: "Bed: blanket / foot half" },
  82: { letter: "B", label: "Barrel" }, 90: { letter: "X", label: "Chest / coffer" },
};
const rooms = palaceLayout.rooms.map((room, index) => ({ ...room, code: `R${String(index + 1).padStart(2, "0")}`,
  colour: `hsl(${Math.round(index * 137.508) % 360},${index % 2 ? 58 : 74}%,${index % 3 ? 78 : 69}%)` }));
const fixtures = source.fixtures.map(fixture => {
  const symbol = symbols[fixture.sprite];
  if (!symbol) throw new Error(`Add a legend symbol for ${fixture.id}: sprite ${fixture.sprite}`);
  if (!fixture.position) throw new Error(`Missing fixture position: ${fixture.id}`);
  return { id: fixture.id, name: fixture.name, roomId: fixture.roomId, ...fixture.position, ...symbol };
});
const occupied = new Set([...fixtures.map(f => `${f.x},${f.y}`), ...source.doors.flatMap(d => d.tiles.map(p => `${p.x},${p.y}`))]);
const wallTiles = palaceMap.tiles.flatMap((cell, i) => cell.layers.length > 1 && cell.layers.some(layer => layer.solid)
  ? [{ x: i % palaceMap.width, y: Math.floor(i / palaceMap.width) }] : []);
const shapes = [rect(0, 0, width, height, "#f3f1eb")];
for (const p of wallTiles) shapes.push(rect(p.x * tile, p.y * tile, tile, tile, "#555964"));
for (const room of rooms) for (const r of room.regions) shapes.push(rect(r.x * tile, r.y * tile, r.width * tile, r.height * tile, room.colour));
// The grid has one square per authoritative movement cell, including blocked space.
for (let x = 0; x <= palaceMap.width; x++) shapes.push(`<path d="M${x * tile} 0V${height}" stroke="#202532" stroke-opacity=".25" stroke-width=".6"/>`);
for (let y = 0; y <= palaceMap.height; y++) shapes.push(`<path d="M0 ${y * tile}H${width}" stroke="#202532" stroke-opacity=".25" stroke-width=".6"/>`);
for (const f of fixtures) {
  shapes.push(rect(f.x * tile + 2, f.y * tile + 2, tile - 4, tile - 4, "#fffdf5", 'rx="3" stroke="#242833"'));
  shapes.push(text((f.x + .5) * tile, (f.y + .5) * tile + 5, f.letter, 15, 'font-weight="bold" text-anchor="middle"'));
}
for (const door of source.doors) {
  const xs = door.tiles.map(p => p.x), ys = door.tiles.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x + 1, h = Math.max(...ys) - y + 1;
  shapes.push(rect(x * tile + 1, y * tile + 1, w * tile - 2, h * tile - 2, "#ffd365", 'stroke="#533e10" stroke-width="2"'));
  shapes.push(text((x + w / 2) * tile, (y + h / 2) * tile + 5, "D", 17, 'font-weight="bold" text-anchor="middle"'));
}
for (const room of rooms) {
  const r = room.regions[0]!;
  const candidates = Array.from({ length: r.width * r.height }, (_, i) => ({ x: r.x + i % r.width, y: r.y + Math.floor(i / r.width) }))
    .filter(p => !occupied.has(`${p.x},${p.y}`))
    .sort((a, b) => Math.abs(a.x - r.x - r.width / 2) + Math.abs(a.y - r.y - r.height / 2)
      - Math.abs(b.x - r.x - r.width / 2) - Math.abs(b.y - r.y - r.height / 2));
  if (!candidates[0]) throw new Error(`No clear cell for room label ${room.id}`);
  const p = candidates[0];
  shapes.push(rect(p.x * tile + 1, p.y * tile + 5, tile - 2, 14, "#232936", 'rx="3"'));
  shapes.push(text((p.x + .5) * tile, p.y * tile + 15.5, room.code, 10, 'fill="white" font-weight="bold" text-anchor="middle"'));
}
const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="DejaVu Sans, sans-serif" fill="#232936">${body}</svg>`;
const mapSvg = svg(width, height, shapes.join("\n"));
const margin = 48, top = 120, legendTop = top + height + 64;
const pageWidth = width + margin * 2, pageHeight = legendTop + 272 + Math.ceil(rooms.length / 4) * 34 + 72;
const page = [rect(0, 0, pageWidth, pageHeight, "#fffdf8"), text(margin, 42, "PALACE OF CAERWYN — AI BATTLE-MAP REFERENCE", 27, 'font-weight="bold"'),
  text(margin, 74, `${palaceMap.width} × ${palaceMap.height} cells · one square = one movement tile · top-down · geometry and object positions are authoritative`, 17),
  `<g transform="translate(${margin} ${top})">${shapes.join("\n")}</g>`];
for (let x = 0; x < palaceMap.width; x += 5) page.push(text(margin + (x + .5) * tile, top - 12, String(x), 11, 'text-anchor="middle"'));
for (let y = 0; y < palaceMap.height; y += 5) page.push(text(margin - 12, top + (y + .5) * tile + 4, String(y), 11, 'text-anchor="end"'));
page.push(text(margin, legendTop, "SYMBOLS — replace these markers with illustration", 21, 'font-weight="bold"'));
const legend = [{ letter: "D", label: "Doorway: one yellow footprint = one door" }, ...Object.values(symbols)];
legend.forEach((item, i) => {
  const x = margin + i % 3 * (width / 3), y = legendTop + 24 + Math.floor(i / 3) * 36;
  page.push(rect(x, y, 26, 26, item.letter === "D" ? "#ffd365" : "#fffdf5", 'stroke="#242833" rx="3"'));
  page.push(text(x + 13, y + 19, item.letter, 17, 'font-weight="bold" text-anchor="middle"'), text(x + 38, y + 19, item.label, 17));
});
page.push(text(margin, legendTop + 154, "Adjacent H + F are ONE bed. Consecutive T cells are ONE continuous table. Keep the marked footprint and orientation.", 17));
page.push(text(margin, legendTop + 184, "Dark grey = masonry. Pale neutral = blocked exterior / unbuilt space. Room colours identify ownership, not final materials.", 17));
page.push(text(margin, legendTop + 214, "Flat lighting only. Remove grid, codes, markers and this legend from the finished art. Leave doorway thresholds clear for live doors.", 17));
page.push(text(margin, legendTop + 255, "ROOM COLOUR KEY", 21, 'font-weight="bold"'));
rooms.forEach((room, i) => {
  const x = margin + i % 4 * (width / 4), y = legendTop + 275 + Math.floor(i / 4) * 34;
  page.push(rect(x, y, 26, 22, room.colour, 'stroke="#7b7d81"'), text(x + 38, y + 17, `${room.code}  ${room.name}`, 16));
});
const prompt = `Use the supplied reference as a strict spatial control image, not as a finished visual design.
Create ONE continuous top-down illustrated battle-map PNG of the Palace of Caerwyn, not a tileset or collage.

GEOMETRY
The map-only image contains ${palaceMap.width} columns × ${palaceMap.height} rows. Preserve every room polygon, corridor, wall footprint, door opening and object position. Do not add rooms, widen passages, move thresholds, merge rooms or change the map's aspect ratio. Pale exterior remains non-walkable. A reference sheet with a legend is also supplied; only its map rectangle is the level, never paint the legend as part of the palace.
Output the map-only extent (${width} × ${height} reference pixels), without margins, legend, labels, grid, letters, numbers, UI, actors or tokens. If output resolution changes, preserve the exact ${palaceMap.width}:${palaceMap.height} aspect ratio and full level extent; do not crop or add borders.

SYMBOLS
${legend.map(item => `${item.letter}: ${item.label}.`).join("\n")}
H and F together form a single horizontal bed, pillow at H. Each run of neighbouring T cells is one continuous table; isolated T cells are small desks/tables. Do not enlarge objects beyond their marked footprints or put new blocking furniture on unmarked floor. D marks the full doorway: illustrate jambs and clear thresholds, omit movable door leaves so the game can draw open/closed doors separately.

ART DIRECTION
Hand-inked outlines and coloured-pencil rendering on warm drawing paper, visible pencil grain, muted natural colours, handmade D&D battle-map character. Draw rooms as coherent spaces, with non-repeating floorboards and irregular stonework, not repeated miniature tiles. Bedrooms and salons have timber floors, bed linen, carved wooden furniture and tasteful patterned rugs; corridors have pale flagstone and runners. The dining hall has two long dressed banquet tables. Rugs, floor inlays and wall decoration may embellish free space but may not introduce obstacles. Room fill colours are segmentation IDs, not required floor colours. Use sage for Greenweald, muted indigo for Saltmere and burgundy for Ironmark/royal textiles.
FLAT MATERIAL COLOUR ONLY: no baked lighting, light blooms, cast shadows, ambient-occlusion shadows, vignettes or candle flames. A separate runtime lighting system will light the map.

ROOM KEY
${rooms.map(r => `${r.code}: ${r.name} (${r.id}); reference fill ${r.colour}.`).join("\n")}

The JSON manifest records exact zero-based grid coordinates (origin top-left, x right, y down). Use it to resolve ambiguous markers. After generation, compare the illustration with the control grid; visual generation does not guarantee collision alignment.
`;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/map-only.svg`, mapSvg);
writeFileSync(`${output}/reference.svg`, svg(pageWidth, pageHeight, page.join("\n")));
writeFileSync(`${output}/legend.json`, JSON.stringify({ grid: { columns: palaceMap.width, rows: palaceMap.height, cellPixels: tile, origin: "top-left" },
  mapCrop: { x: margin, y: top, width, height }, symbols: legend, rooms, walls: wallTiles, fixtures,
  doors: source.doors.map(({ id, name, tiles, open }) => ({ id, name, tiles, open })) }, null, 2) + "\n");
writeFileSync(`${output}/image-edit-prompt.txt`, prompt);
// ImageMagick rasterizes the exact SVG; no generated image is edited or resized here.
for (const name of ["map-only", "reference"]) execFileSync("magick", ["-background", "white", `${output}/${name}.svg`, `${output}/${name}.png`]);
console.log(`AI map reference: ${output}/reference.png\nMap-only control: ${output}/map-only.png\nPrompt: ${output}/image-edit-prompt.txt\nLegend and coordinates: ${output}/legend.json`);
