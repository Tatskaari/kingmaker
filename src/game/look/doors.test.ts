import { test } from "node:test";
import assert from "node:assert/strict";
import { hangedClerkWorld } from "../../../scenes/worlds/hanged-clerk.ts";
import { buildWorld } from "../../world/scene-world.ts";
import { CAST, doorLook, Picks, render, toPlain, type DoorLook } from "../map/index.ts";
import type { MapActor } from "../types.ts";
import { AX, AY, DOOR_DETAILS, hex, scale, toHex, doorCells, OVERLAY_OSC, paintDoor, type DoorShape, type MapDoorShape, type OverlayFrame } from "./door-art.ts";
import { DOOR_LOOKS as LOOKS, DOOR_SHEET_CAMERA as CAMERA, doorSheet } from "./door-sheet.ts";
import { dressingFor } from "./dressings.ts";
import { mapDoors, moveDoor, overlaySequence, stageDoors } from "./overlay.ts";
import { renderStage, StagePicks } from "./stage.ts";

/**
 * The doors as pictures over the ASCII in the browser (src/game/look/door-art.ts, overlay.ts): the
 * renderers say where they drew doors without changing a cell of what they draw, each door's picture
 * paints only the cells it may (not over what's in front of it, nor what's drawn over the map), and
 * the page is told in an OSC it can't misread.
 */

const SIZE = { w: 80, h: 34 };

test("a door's look comes from its states and its tile", () => {
  assert.equal(doorLook(["closed"]), "shut");
  assert.equal(doorLook([]), "shut");
  assert.equal(doorLook([], true), "locked");
  assert.equal(doorLook(["open"], true), "open");
  assert.equal(doorLook(["closed", "locked"]), "locked");
  assert.equal(doorLook(["closed", "barred"], true), "barred");
  assert.equal(doorLook(["bolted"]), "barred");
  assert.equal(doorLook(["destroyed"]), "broken");
  assert.equal(doorLook(["open", "broken"]), "broken");
});

test("keeping the doors changes nothing the renderer draws", () => {
  const { map, doors } = doorSheet();
  for (const t of [0, 1300]) {
    const plain = render(map, doors, CAMERA, SIZE, { cutaway: false, t, pick: new Picks() });
    const kept = new Picks({ doors: true });
    const tracked = render(map, doors, CAMERA, SIZE, { cutaway: false, t, pick: kept });
    assert.deepEqual(tracked, plain);
    assert.equal(kept.doors?.length, 10);
  }
  // Plain picks keep nothing extra.
  const plain = new Picks();
  render(map, doors, CAMERA, SIZE, { cutaway: false, pick: plain });
  assert.equal(plain.doors, undefined);
  assert.equal(plain.over, undefined);
});

test("every door on both faces, in every look, is found where it's drawn, with the wall it took given back", () => {
  const { map, doors, at: where } = doorSheet();
  const pick = new Picks({ doors: true });
  const lines = render(map, doors, CAMERA, SIZE, { cutaway: false, t: 0, pick });
  const shapes = mapDoors(pick, lines);
  assert.equal(shapes.length, 10);
  const plain = toPlain(lines).split("\n");
  for (const d of LOOKS) for (const face of ["south", "west"] as const) {
    const at = where(d.look, face);
    const shape = shapes.find(s => s.id === `door-sheet:door@${at.x},${at.y}`);
    assert.ok(shape, `the ${d.look} door on the ${face} face`);
    assert.equal(shape.look, d.look);
    assert.equal(shape.face, face);
    // The ASCII door is drawn in its face's column, where the wall it took is given back.
    const column = face === "south" ? shape.x + 1 : shape.x - 1;
    const doorCellsDrawn = shape.wall.filter(([x]) => x === column);
    assert.equal(doorCellsDrawn.length, 3);
    for (const [x, y] of doorCellsDrawn) assert.ok(/[█▙ ]/.test([...plain[y]!][x]!), `the ASCII door at ${x},${y} (${face} ${d.look})`);
    // Its picture: art pixels only in cells it may paint.
    const painted = paintDoor(shape);
    assert.ok(painted.pixels.length > 100, `${d.look} on the ${face} face has a picture (${painted.pixels.length} pixels)`);
    const may = new Map(shape.cells.map(([x, y, level]) => [`${x},${y}`, level]));
    for (const { X, Y } of painted.pixels) assert.ok(may.has(`${Math.floor(X / AX)},${Math.floor(Y / AY)}`), `pixel ${X},${Y} of ${shape.id} is in a cell it may paint`);
  }
});

test("each look is drawn as itself: the lock's brass, one bar past the jambs, a leaf swung out in front, splinters", () => {
  const { map, doors } = doorSheet();
  const pick = new Picks({ doors: true });
  const shapes = mapDoors(pick, render(map, doors, CAMERA, SIZE, { cutaway: false, t: 0, pick }));
  const of = (look: DoorLook, face: "south" | "west") => shapes.find(s => s.look === look && s.face === face)!;
  const colours = (s: MapDoorShape) => new Map(paintDoor(s).pixels.map(p => [`${p.X},${p.Y}`, `#${p.c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`]));
  for (const face of ["south", "west"] as const) {
    const count = (s: MapDoorShape, colour: string) => [...colours(s).values()].filter(c => c === colour).length;
    assert.ok(count(of("locked", face), of("locked", face).colors.brass) >= 4, "a locked door has its brass");
    assert.equal(count(of("shut", face), of("shut", face).colors.brass), 0, "a shut door has no lock");
    const barred = of("barred", face);
    assert.ok(count(barred, barred.colors.bar) >= 3 * 14, "a barred door has a bar across it, past both jambs");
    // An open door's leaf, and a broken one's splinters, stand out in front of it: level 1 cells (nearer than the door).
    for (const look of ["open", "broken"] as const) {
      const s = of(look, face);
      const front = new Set(s.cells.filter(c => c[2] === 1).map(([x, y]) => `${x},${y}`));
      assert.ok(front.size > 0, `the ${look} door reaches the tile in front`);
      const out = paintDoor(s).pixels.filter(p => front.has(`${Math.floor(p.X / AX)},${Math.floor(p.Y / AY)}`));
      assert.ok(out.length > 0, `the ${look} door's picture reaches over the tile in front (${face})`);
    }
  }
});

test("what's in front of a door, or drawn over the map, keeps its cells", () => {
  const { map, doors } = doorSheet();
  const shut = { x: 3, y: 12 };
  // Someone standing just in front of the shut door on the south face.
  const kell: MapActor = { id: "kell", name: CAST.kell!.name, kind: "person", glyph: "K", map: "door-sheet", at: { x: 3, y: 13 } };
  const pick = new Picks({ doors: true });
  const lines = render(map, [...doors, kell], CAMERA, SIZE, { cutaway: false, t: 0, pick });
  const shape = mapDoors(pick, lines).find(s => s.id === `door-sheet:door@${shut.x},${shut.y}`)!;
  const kellCells: string[] = [];
  for (let y = 0; y < SIZE.h; y++) for (let x = 0; x < SIZE.w; x++) if (pick.at(x, y)?.actor?.id === "kell") kellCells.push(`${x},${y}`);
  assert.ok(kellCells.length > 0);
  for (const [x, y] of shape.cells) assert.ok(!kellCells.includes(`${x},${y}`), "a door's picture never paints over someone in front of it");
  // The pointer on the door: its tile lights up, and its picture stands aside there.
  const hovered = new Picks({ doors: true });
  const lit = render(map, doors, CAMERA, SIZE, { cutaway: false, t: 0, pick: hovered, hover: shut });
  const before = mapDoors(pick, lines).find(s => s.id === shape.id)!;
  const after = mapDoors(hovered, lit).find(s => s.id === shape.id);
  assert.ok(!after || after.cells.length < before.cells.length, "the pointer's highlight on a door hides its picture there");
});

test("on the stage, the yard's gate, loft door and yard doors are found in their walls' lines", () => {
  const world = buildWorld("hanged-clerk", hangedClerkWorld, ["kell", "cob", "moll"].map(p => ({ id: p, name: CAST[p]!.name })), { name: "you" });
  const view = { w: 60, h: 30, t: 0, time: "morning" as const };
  const plain = renderStage(world, dressingFor(world.scene), { ...view, pick: new StagePicks() }).toLines();
  const pick = new StagePicks({ doors: true });
  const canvas = renderStage(world, dressingFor(world.scene), { ...view, pick });
  assert.deepEqual(canvas.toLines(), plain, "keeping the doors changes nothing the stage draws");
  const shapes = stageDoors(pick, canvas);
  const ids = shapes.map(s => s.id).sort();
  assert.ok(ids.length >= 2, `doors on the stage: ${ids.join(", ")}`);
  for (const s of shapes) {
    const door = world.entities[s.id]!;
    assert.equal(s.look, doorLook(door.states));
    assert.ok(s.len >= (s.along === "x" ? AX : AY));
    const painted = paintDoor(s);
    assert.ok(painted.pixels.length > 0, `${s.id} has a picture`);
    const may = new Set(s.cells.map(([x, y]) => `${x},${y}`));
    for (const { X, Y } of painted.pixels) assert.ok(may.has(`${Math.floor(X / AX)},${Math.floor(Y / AY)}`));
  }
  // Nobody standing on the stage is painted over.
  for (const s of shapes) for (const [x, y] of s.cells) {
    const who = pick.at(x, y)?.id;
    const e = who ? world.entities[who] : undefined;
    assert.ok(!e || (e.kind !== "person" && e.kind !== "creature"), `${s.id}'s picture leaves ${who} be`);
  }
});

test("a door's picture reaches the same cells wherever it is, and moves with its canvas", () => {
  const { map, doors } = doorSheet();
  const pick = new Picks({ doors: true });
  const shape = mapDoors(pick, render(map, doors, CAMERA, SIZE, { cutaway: false, t: 0, pick }))[0]!;
  const here = doorCells(shape).map(c => `${c.x - shape.x},${c.y - shape.y}`).sort();
  const moved: DoorShape = { ...shape, x: shape.x + 5, y: shape.y + 3, wall: shape.wall.map(([x, y, ...rest]) => [x + 5, y + 3, ...rest]) };
  assert.deepEqual(doorCells(moved).map(c => `${c.x - moved.x},${c.y - moved.y}`).sort(), here);
  const onScreen = moveDoor(shape, 10, 2, () => true)!;
  assert.equal(onScreen.x, shape.x + 10);
  assert.deepEqual(onScreen.cells.map(([x, y]) => [x - 10, y - 2]), shape.cells.map(([x, y]) => [x, y]));
  // Covered everywhere it would paint the door itself: gone.
  assert.equal(moveDoor(shape, 0, 0, () => false), undefined);
});

test("the page is told in an OSC of plain ASCII it reads back exactly", () => {
  const { map, doors } = doorSheet();
  const pick = new Picks({ doors: true });
  const frame: OverlayFrame = { cols: 130, rows: 42, doors: mapDoors(pick, render(map, doors, CAMERA, SIZE, { cutaway: false, t: 0, pick, glyphs: "kingmaker" })) };
  const sequence = overlaySequence(frame);
  assert.ok(sequence.startsWith(`\x1b]${OVERLAY_OSC};`) && sequence.endsWith("\x07"));
  const body = sequence.slice(`\x1b]${OVERLAY_OSC};`.length, -1);
  assert.match(body, /^[\x20-\x7e]*$/, "nothing in it could end the sequence early");
  assert.ok(/\\u[0-9a-f]{4}/.test(body), "the wall's glyphs given back are escaped");
  assert.deepEqual(JSON.parse(body), frame);
});


test("map door masks inherit the lit wall tint and preserve coverage for every detail", () => {
  const { map, doors } = doorSheet();
  const pick = new Picks({ doors: true });
  const lines = render(map, doors, CAMERA, SIZE, { cutaway: false, t: 0, pick, glyphs: "ascii" });
  for (const door of mapDoors(pick, lines)) {
    const column = door.x + (door.face === "south" ? 1 : -1);
    const wall = door.wall.find(([x]) => x === column)!;
    const dark = door.look === "locked" || door.look === "barred";
    assert.equal(door.colors.wood, toHex(scale(hex(wall[4]), dark ? 0.85 : 1.05)));
    const variants = DOOR_DETAILS.map(detail => paintDoor({ ...door, detail }));
    for (const [i, variant] of variants.entries()) {
      assert.deepEqual(variant, paintDoor({ ...door, detail: DOOR_DETAILS[i] }), "stable across redraws");
      const allowed = new Set(door.cells.map(([x, y]) => `${x},${y}`));
      assert.ok(variant.pixels.every(p => allowed.has(`${Math.floor(p.X / AX)},${Math.floor(p.Y / AY)}`)));
    }
    assert.notDeepEqual(variants[0]!.pixels, variants[1]!.pixels);
    assert.notDeepEqual(variants[1]!.pixels, variants[2]!.pixels);
  }
});
