import { test } from "node:test";
import assert from "node:assert/strict";
import { PREGENS } from "../combat/pregen.ts";
import { mapFights } from "../fights.ts";
import { actorsHere, CAST, Picks, render, toPlain } from "../map/index.ts";
import { Game } from "../play.ts";
import { aimAt, exploreState, town } from "../town.ts";
import type { MapActor, Tile2 } from "../types.ts";
import { townView } from "../views.ts";
import { AX, AY, OVERLAY_OSC } from "./door-art.ts";
import { dressingFor } from "./dressings.ts";
import { isLampPost, lampLook, paintLamp, type LampFrame, type LampShape } from "./lamp-art.ts";
import { LAMP_LOOKS, LAMP_SHEET_CAMERA as CAMERA, lampSheet, lampStage } from "./lamp-sheet.ts";
import { mapLamps, moveLamp, stageLamps } from "./lamps.ts";
import { overlaySequence } from "./overlay.ts";
import { renderStage, StagePicks } from "./stage.ts";

/**
 * The lamp posts as pictures over the ASCII in the browser (src/game/look/lamp-art.ts, lamps.ts):
 * the renderers say where they drew them without changing a cell of what they draw, each lamp is
 * found in the cells the game drew its glyph and post in, looks as its own state or the hour says,
 * and paints only the cells it may (not over what's nearer, anyone, or what's drawn over the view),
 * its glow likewise; and the lane's lamp post lit by the Light cantrip is lit, and still a lamp post.
 */

process.env.KM_RUNS_DIR ??= "runs/test";
const SIZE = { w: 80, h: 34 };
const at = (s: LampShape) => new Set(s.cells.map(([x, y]) => `${x},${y}`));
const cellOf = (X: number, Y: number) => `${Math.floor(X / AX)},${Math.floor(Y / AY)}`;
/** The renderer's order of painting, back to front: a tile later in it is nearer. */
const orderOf = (t: Tile2) => (t.y - t.x) * 100000 + (t.x + t.y);

/**
 * The doors' rules, kept by a lamp on the map: every cell its picture or its glow may touch shows
 * something behind the lamp or on its own tile, never anyone, and nothing drawn over the map.
 */
function keepsTheRules(pick: Picks, shape: LampShape, lampAt: Tile2): void {
  const own = new Set(shape.ground.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of [...shape.cells.map(([x, y]): [number, number] => [x, y]), ...(shape.glow ?? [])]) {
    assert.ok(!pick.over![y * pick.w + x], `${shape.id}: nothing's drawn over the map at ${x},${y}`);
    if (own.has(`${x},${y}`)) continue;
    const pk = pick.at(x, y);
    if (!pk) continue;
    assert.ok(!pk.actor || !["person", "creature", "player"].includes(pk.actor.kind), `${shape.id}: nobody's at ${x},${y} (${pk.actor?.id})`);
    assert.ok(orderOf(pk.at) <= orderOf(lampAt), `${shape.id}: ${x},${y} shows something behind it or on its own tile, not ${JSON.stringify(pk.at)}`);
  }
}

test("a lamp's look: its own state where the world has one, by day or night; otherwise the hour", () => {
  for (const night of [false, true]) {
    assert.equal(lampLook(["lit"], true, night), "lit");
    assert.equal(lampLook(["unlit"], false, night), "out");
    assert.equal(lampLook(["lit", "wet"], false, night), "out", "a wet flame goes out (the look's rule: it sheds no light)");
    assert.equal(lampLook(["broken"], true, night), "broken");
    assert.equal(lampLook(["destroyed"], false, night), undefined, "a wreck is the ASCII's");
  }
  assert.equal(lampLook([], false, false), "out", "pale by day");
  assert.equal(lampLook([], true, false), "out", "pale by day, even a lamp the game has shining");
  assert.equal(lampLook([], true, true), "lit", "lit after dark");
  assert.equal(lampLook([], false, true), "out", "never lit where the game lights nothing");
});

test("lamp posts only: what stands on a post and is a lamp; on the stage, a lamp post by its look", () => {
  assert.equal(isLampPost("map", "lamp-post", ["lamp", "post"]), true);
  assert.equal(isLampPost("map", "lantern", ["lit", "post"]), true, "a barge lantern on its post");
  assert.equal(isLampPost("map", "lamp-post", ["lit"]), false, "not drawn up a post on the map: the ASCII as it is");
  assert.equal(isLampPost("map", "sign", ["post"]), false, "the price board");
  assert.equal(isLampPost("map", "lantern", ["broken"]), false, "the smashed lantern in the yard");
  assert.equal(isLampPost("stage", "lamp-post", ["lit"]), true);
  assert.equal(isLampPost("stage", "lantern", ["lit", "hanging"]), false, "a lantern on a hook");
  assert.equal(isLampPost("stage", "candle", ["lit"]), false);
});

test("keeping the lamps changes nothing the renderers draw", () => {
  for (const time of ["morning", "night"] as const) {
    const { map, lamps } = lampSheet(time);
    for (const t of [0, 1300]) {
      const plain = render(map, lamps, CAMERA, SIZE, { cutaway: false, t, time, pick: new Picks() });
      const kept = new Picks({ doors: true });
      assert.deepEqual(render(map, lamps, CAMERA, SIZE, { cutaway: false, t, time, pick: kept }), plain);
      assert.equal(kept.lamps?.length, LAMP_LOOKS.length);
    }
    const world = lampStage();
    const view = { w: 100, h: 24, t: 0, time };
    const plain = renderStage(world, dressingFor(world.scene), { ...view, pick: new StagePicks() }).toLines();
    const pick = new StagePicks({ doors: true });
    assert.deepEqual(renderStage(world, dressingFor(world.scene), { ...view, pick }).toLines(), plain);
    assert.equal(pick.lamps?.length, LAMP_LOOKS.length);
  }
  // Plain picks keep nothing extra.
  const { map, lamps } = lampSheet();
  const plain = new Picks();
  render(map, lamps, CAMERA, SIZE, { cutaway: false, pick: plain });
  assert.equal(plain.lamps, undefined);
});

test("every lamp post in every look, by day and at night, is found where the game drew its glyph and post, and paints only cells it may", () => {
  for (const time of ["morning", "night"] as const) {
    const { map, lamps } = lampSheet(time);
    const pick = new Picks({ doors: true });
    const lines = render(map, lamps, CAMERA, SIZE, { cutaway: false, t: 0, time, pick });
    const shapes = mapLamps(pick, lines);
    assert.equal(shapes.length, LAMP_LOOKS.length);
    const plain = toPlain(lines).split("\n");
    for (const l of LAMP_LOOKS) {
      const shape = shapes.find(s => s.id === `lamp-sheet:${l.name.replace(/\W+/g, "-")}`);
      assert.ok(shape, `the ${l.name} lamp (${time})`);
      assert.equal(shape.look, time === "night" ? l.night : l.day, `the ${l.name} lamp's look (${time})`);
      // The glyph and the post, taken back to the ground: the cells the ASCII drew them in.
      assert.deepEqual(shape.ground.map(([x, y]) => [...plain[y]!][x]), ["¤", "│"], `${l.name}: its ground is where the ASCII lamp is`);
      const painted = paintLamp(shape);
      assert.ok(painted.pixels.length >= 30, `${l.name} has a picture (${painted.pixels.length} pixels)`);
      const may = at(shape);
      for (const { X, Y } of painted.pixels) assert.ok(may.has(cellOf(X, Y)), `pixel ${X},${Y} of ${shape.id} is in a cell it may paint`);
      // A glow only when lit, and only on cells it may light.
      assert.equal(!!painted.glow, shape.look === "lit", `${l.name}: a glow when lit (${time})`);
      if (painted.glow) assert.ok(painted.glow.cells.length >= 5 && painted.glow.cells.every(([x, y]) => x >= 0 && y >= 0 && x < SIZE.w && y < SIZE.h));
    }
    // Lit: the glass warm; out by day, pale glass; broken, a dark hole.
    const of = (name: string) => shapes.find(s => s.id.endsWith(name.replace(/\W+/g, "-")))!;
    assert.equal(of("lit").colors.glass, "#ffc262");
    const lum = (h: string) => { const n = parseInt(h.slice(1), 16); return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114; };
    assert.ok(lum(of("broken").colors.glass) < 40, "a broken lamp's glass is a hole");
    if (time === "morning") assert.ok(lum(of("put out").colors.glass) > 150, "pale glass by day");
  }
});

test("what's in front of a lamp, anyone, and what's drawn over the map keep their cells, its glow's too", () => {
  const { map, lamps, at: where } = lampSheet("night");
  const lit = where("lit");
  // Kell on the lit lamp's tile (people walk past lamp posts), Cob just behind it, a stack of crates
  // on the tile in front of it to the left (its top a row up, by the lantern), and the aiming
  // brackets round the lamp's own tile.
  const kell: MapActor = { id: "kell", name: CAST.kell!.name, kind: "person", glyph: "K", map: "lamp-sheet", at: { ...lit } };
  const cob: MapActor = { id: "cob", name: CAST.cob!.name, kind: "person", glyph: "c", map: "lamp-sheet", at: { x: lit.x, y: lit.y - 1 } };
  const crates: MapActor = { id: "crates", name: "a stack of crates", kind: "object", glyph: "▣", map: "lamp-sheet", at: { x: lit.x - 1, y: lit.y }, blocks: true };
  const pick = new Picks({ doors: true });
  const lines = render(map, [...lamps, kell, cob, crates], CAMERA, SIZE, { cutaway: false, t: 0, time: "night", pick, cursor: lit });
  const shapes = mapLamps(pick, lines);
  const shape = shapes.find(s => s.id === "lamp-sheet:lit");
  assert.ok(shape, "the lamp, where Kell isn't drawn over it");
  for (const s of shapes) keepsTheRules(pick, s, lamps.find(l => l.id === s.id)!.at);
  const theirs = (who: RegExp) => {
    const out: string[] = [];
    for (let y = 0; y < SIZE.h; y++) for (let x = 0; x < SIZE.w; x++) if (who.test(pick.at(x, y)?.actor?.id ?? "")) out.push(`${x},${y}`);
    return out;
  };
  const glow = new Set((shape.glow ?? []).map(([x, y]) => `${x},${y}`));
  for (const [who, cells] of [["someone", theirs(/^(kell|cob)$/)], ["the crates", theirs(/^crates$/)]] as const) {
    assert.ok(cells.length >= 1, who);
    for (const c of cells) assert.ok(!at(shape).has(c) && !glow.has(c), `the lamp's picture and its glow leave ${c} (${who}) be`);
  }
  const brackets = [`${shape.x - 1},${shape.y + 1}`, `${shape.x + 1},${shape.y + 1}`];
  const row = [...toPlain(lines).split("\n")[shape.y + 1]!];
  assert.deepEqual([row[shape.x - 1], row[shape.x + 1]], ["[", "]"], "the aiming brackets round its tile");
  for (const c of brackets) assert.ok(!at(shape).has(c) && !glow.has(c), `its glow leaves the brackets at ${c} be`);
  assert.ok(glow.size >= 5, `still a glow round the lantern (${glow.size} cells)`);
  assert.equal(shape.ground.length, 1, "Kell stands where its post was drawn: only the lantern's cell is taken back");
  // The pointer on the lamp: its tile lights up, and its picture stands aside there.
  const hovered = new Picks({ doors: true });
  const lines2 = render(map, lamps, CAMERA, SIZE, { cutaway: false, t: 0, time: "night", pick: hovered, hover: lit });
  assert.equal(mapLamps(hovered, lines2).find(s => s.id === "lamp-sheet:lit"), undefined, "the pointer's highlight on a lamp hides its picture");
});

test("on the stage, each lamp post is found in its cell, in its look, and leaves anyone be", () => {
  const world = lampStage();
  for (const time of ["morning", "night"] as const) {
    const pick = new StagePicks({ doors: true });
    const canvas = renderStage(world, dressingFor(world.scene), { w: 100, h: 24, t: 0, time, pick });
    const shapes = stageLamps(pick);
    assert.equal(shapes.length, LAMP_LOOKS.length);
    for (const l of LAMP_LOOKS) {
      const s = shapes.find(x => x.id === l.name.replace(/\W+/g, "-"))!;
      assert.equal(s.look, time === "night" ? l.night : l.day, `${l.name} on the stage (${time})`);
      assert.equal(s.post, 0);
      assert.equal(canvas.glyph[s.y * canvas.w + s.x], "¤", "its cell is where the stage drew it");
      const may = at(s);
      for (const { X, Y } of paintLamp(s).pixels) assert.ok(may.has(cellOf(X, Y)));
    }
  }
  // Someone standing in a lamp's cell keeps it.
  const crowded = lampStage();
  crowded.entities.kell = { id: "kell", name: CAST.kell!.name, kind: "person", parent: "street", at: { ...crowded.entities["lit"]!.at! }, tags: [], states: [], notes: [], cast: "kell" };
  const pick = new StagePicks({ doors: true });
  renderStage(crowded, dressingFor(crowded.scene), { w: 100, h: 24, t: 0, time: "night", pick });
  assert.equal(stageLamps(pick).find(s => s.id === "lit"), undefined, "Kell is drawn in the lamp's cell: it's hers");
  for (const s of stageLamps(pick)) for (const [x, y] of [...s.cells, ...(s.glow ?? [])]) assert.notEqual(pick.at(x, y)?.id, "kell");
});

test("the lane's lamp post: pale by day, lit at night, and lit by the Light cantrip it's lit and still up its post", async () => {
  const g = await Game.create({ player: "Vesper: a test of the lamps", level: 5, build: PREGENS.wizard!.build, explorer: town, fights: mapFights(), seed: 11 });
  const ex = exploreState(g.state);
  ex.at = { x: 29, y: 9 };
  const LAMP = "caerwyn:lamp-post@28,9";
  const lampAt = (time: string) => {
    g.state.story.time = time as typeof g.state.story.time;
    const pick = new Picks({ doors: true });
    const lines = townView(g.state, undefined, SIZE, { t: 0, pick });
    return mapLamps(pick, lines).find(l => l.id === LAMP);
  };
  assert.equal(lampAt("morning")?.look, "out");
  assert.equal(lampAt("night")?.look, "lit");
  assert.equal(lampAt("night")?.glow?.length ? true : false, true, "with its glow");
  // By day, the Light cantrip from the action menu.
  g.state.story.time = "morning";
  const aim = aimAt(g.state, g.session, "spell:light", { x: 28, y: 9 })!;
  assert.equal(aim.ok, true, aim.why ?? "");
  assert.match(await g.act(aim.id!), /lamp post shines like a torch/);
  const now = actorsHere(exploreState(g.state)).find(a => a.id === LAMP)!;
  assert.ok(now.states?.includes("lit") && now.states.includes("post") && now.states.includes("lamp"), `lit, and still the map's lamp on its post: ${now.states?.join(", ")}`);
  assert.equal(lampAt("morning")?.look, "lit", "lit by day: its own state");
});

test("a lamp's picture holds still while you do: its own flicker doesn't change what the page is sent", async () => {
  const g = await Game.create({ player: "Vesper: a test of the lamps", level: 5, build: PREGENS.wizard!.build, explorer: town, fights: mapFights(), seed: 11 });
  exploreState(g.state).at = { x: 29, y: 9 };
  g.state.story.time = "night";
  const sent = new Set<string>();
  for (let t = 0; t < 3000; t += 83) {
    const pick = new Picks({ doors: true });
    const lines = townView(g.state, undefined, SIZE, { t, pick });
    sent.add(JSON.stringify(mapLamps(pick, lines)));
  }
  assert.equal(sent.size, 1, "the same lamps, frame after frame");
});

test("a lamp moves with its canvas, keeps only the cells that still show it, and goes when none do", () => {
  const { map, lamps } = lampSheet("night");
  const pick = new Picks({ doors: true });
  const shape = mapLamps(pick, render(map, lamps, CAMERA, SIZE, { cutaway: false, t: 0, time: "night", pick })).find(s => s.look === "lit")!;
  const moved = moveLamp(shape, 10, 2, () => true)!;
  assert.equal(moved.x, shape.x + 10);
  assert.deepEqual(moved.cells.map(([x, y]) => [x - 10, y - 2]), shape.cells.map(([x, y]) => [x, y]));
  assert.deepEqual(moved.glow, shape.glow!.map(([x, y]) => [x + 10, y + 2]));
  // A menu over its post's cell: the lantern's still drawn.
  const half = moveLamp(shape, 0, 0, (x, y) => !(x === shape.x && y === shape.y + 1))!;
  assert.equal(half.ground.length, 1);
  assert.equal(moveLamp(shape, 0, 0, () => false), undefined, "covered wholly: gone");
});

test("the page is told where the lamps are with the doors, in the OSC's plain ASCII", () => {
  const { map, lamps } = lampSheet("night");
  const pick = new Picks({ doors: true });
  const frame: LampFrame = { cols: 130, rows: 42, doors: [], lamps: mapLamps(pick, render(map, lamps, CAMERA, SIZE, { cutaway: false, t: 0, time: "night", pick })) };
  const sequence = overlaySequence(frame);
  assert.ok(sequence.startsWith(`\x1b]${OVERLAY_OSC};`) && sequence.endsWith("\x07"));
  const body = sequence.slice(`\x1b]${OVERLAY_OSC};`.length, -1);
  assert.match(body, /^[\x20-\x7e]*$/);
  assert.deepEqual(JSON.parse(body), frame);
  assert.ok(body.length < 600 * LAMP_LOOKS.length, `about ${Math.round(body.length / LAMP_LOOKS.length)} bytes a lamp`);
});
