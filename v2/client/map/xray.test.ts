// Copied from the prototype's src/game/map/xray.test.ts at 44c6d4a, whole but for the Drowned Rat's scene world, which v2 hasn't yet (V3 brings the Rat): the scenes played on the map here are the hanged clerk's, in the granary yard's world (check/place.ts yardWorld), the table that burns and is doused its loose board; its imports from the client's renderer and v2/shared, the maps the campaign's files (check/map.ts useCaerwyn).
import { test } from "node:test";
import assert from "node:assert/strict";
import { damageThing } from "../../shared/world/scene-world.ts";
import { douse } from "../../shared/world/systems.ts";
import type { MapActor, StoryState, Tile2 } from "../../shared/map/types.ts";
import type { StyledLine } from "../ui/types.ts";
import { hex } from "./palette.ts";
import { CAST } from "../look/cast.ts";
import { enterScene, leaveScene, move, newExploration, pathTo, travel, type ExploreState } from "../../shared/map/explore.ts";
import { getMap, MAPS } from "../../shared/map/maps.ts";
import { isStructure, tileAt } from "../../shared/map/tiles.ts";
import { useCaerwyn } from "../check/map.ts";
import { yardWorld } from "../check/place.ts";
import { toAnsi, toPlain } from "./ansi.ts";
import { renderExplore } from "./frame.ts";
import { Picks, render, screenOf } from "./render.ts";
import { exploreFrame, findHidden, matters, renderXray, xray, xrayExplore } from "./xray.ts";

useCaerwyn();

// These read letters off the frames: draw with letters whatever this machine has installed.
process.env.KM_GLYPHS ??= "ascii";

const MORNING: StoryState = { time: "morning", played: [], lead: "hanged-clerk", flags: {} };
const AFTERNOON: StoryState = { time: "afternoon", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} };
const DUSK: StoryState = { time: "evening", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} };
const VP = { w: 120, h: 40 };
/** How render.ts picks you out through a wall today (map.test.ts checks it too). */
const DRAWN_THROUGH = "#6a3a8a";

const walk = (ex: ExploreState, to: Tile2) => { for (const [dx, dy] of pathTo(ex, to) ?? []) move(ex, dx, dy); };
const cells = (line: StyledLine) => line.flatMap(s => [...s.text].map(ch => ({ ch, fg: s.fg ?? "", bg: s.bg ?? "", bold: !!s.bold })));
const cellAt = (lines: StyledLine[], p: { x: number; y: number }) => cells(lines[p.y]!)[p.x]!;
/** How colourful a colour is (0 grey .. 1). */
const chroma = (c: string) => { const [r, g, b] = hex(c); return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; };

/** Behind the house on the north side of the granary lane, Kell a step behind (the afternoon after the granary). */
function behindTheHouse(): ExploreState {
  const ex = newExploration(AFTERNOON);
  walk(ex, { x: 34, y: 0 });
  assert.deepEqual(ex.at, { x: 34, y: 0 }, "walked round behind the house");
  return ex;
}

/** Bank Street at dusk: you step up off it, Kell stays a step behind, on the far side of the bank and the warehouses. */
function kellBehindTheWarehouse(story: StoryState = DUSK): ExploreState {
  const ex = newExploration(story);
  walk(ex, { x: 32, y: 32 });
  for (let i = 0; i < 6; i++) move(ex, 1, 0);
  move(ex, 1, -1);
  assert.deepEqual(ex.followers[0]?.at, { x: 38, y: 32 }, "Kell on Bank Street, behind the bank and a warehouse");
  return ex;
}

test("finds who's behind a building: you and Kell behind the house, the porter in the lane", () => {
  const ex = behindTheHouse();
  const f = exploreFrame(ex, VP);
  const r = xray(f.map, f.actors, f.camera, VP, f.options);
  const names = r.hidden.map(h => h.actor.id);
  assert.ok(names.includes("player"), "you, behind the house");
  assert.ok(names.includes("kell"), "Kell, a step behind you");
  assert.ok(r.hidden.some(h => h.actor.name === "a porter"), "the porter in the lane, behind the brick house south of it");
  // Where each is drawn is where it stands.
  for (const h of r.hidden) assert.deepEqual(h.cell, screenOf(h.actor.at, f.camera, VP));
});

test("Kell behind a warehouse is found, and drawn through it", () => {
  const ex = kellBehindTheWarehouse();
  const f = exploreFrame(ex, VP);
  const before = render(f.map, f.actors, f.camera, VP, f.options);
  const r = xray(f.map, f.actors, f.camera, VP, f.options);
  assert.deepEqual(r.hidden.map(h => h.actor.id), ["kell"], "only Kell: you stepped up off Bank Street");
  const at = r.hidden[0]!.cell;
  assert.notEqual(cellAt(before, at).ch, "K", "today she vanishes behind it");
  const k = cellAt(r.lines, at);
  assert.equal(k.ch, "K");
  assert.ok(chroma(k.fg) < chroma(CAST.kell!.color) * 0.7, `greyer than her own blue (${k.fg})`);
});

test("at night the hidden are greyer but still stand out from the dark", () => {
  const ex = kellBehindTheWarehouse({ time: "night", played: ["hanged-clerk", "drowned-rat"], lead: "heron-warehouse", flags: {} });
  const f = exploreFrame(ex, VP);
  const r = xray(f.map, f.actors, f.camera, VP, f.options);
  const kell = r.hidden.find(h => h.actor.id === "kell");
  assert.ok(kell, "Kell is found behind the warehouse at night too");
  const k = cellAt(r.lines, kell!.cell);
  const lum = (c: string) => { const [r, g, b] = hex(c); return 0.3 * r + 0.59 * g + 0.11 * b; };
  assert.equal(k.ch, "K");
  assert.ok(lum(k.fg) - lum(k.bg) >= 60, `legible: ${k.fg} on ${k.bg}`);
});

test("a frame with nobody hidden comes back untouched, byte for byte", () => {
  const ex = newExploration(MORNING, { at: { x: 25, y: 25 } });
  const f = exploreFrame(ex, VP);
  assert.deepEqual(xray(f.map, f.actors, f.camera, VP, f.options).hidden, [], "nobody's behind anything from the middle of the market");
  assert.equal(xray(f.map, f.actors, f.camera, VP, f.options).lines.length, VP.h);
  for (const options of [{}, { color: false }, { tick: 7 }]) {
    const plain = renderExplore(ex, VP, options);
    const rayed = xrayExplore(ex, VP, options);
    assert.equal(JSON.stringify(rayed), JSON.stringify(plain));
    assert.equal(toAnsi(rayed), toAnsi(plain));
  }
  // And a scene's frame: the yard's scene with its world. The yard isn't the Rat's open room (a
  // porter in the lane is behind the granary from there): outside whoever's hidden, it's renderExplore's.
  const scene = newExploration(MORNING);
  enterScene(scene, "hanged-clerk");
  const world = yardWorld("Tester");
  asDrawnOutsidePatches(scene, VP, { world });
});

test("the x-rayed frame stays aligned: every line as wide, the frame unchanged outside the patches", () => {
  for (const ex of [behindTheHouse(), kellBehindTheWarehouse()]) {
    const f = exploreFrame(ex, VP);
    const before = render(f.map, f.actors, f.camera, VP, f.options);
    const r = xray(f.map, f.actors, f.camera, VP, f.options);
    assert.ok(r.hidden.length);
    assert.equal(r.lines.length, VP.h);
    for (let y = 0; y < VP.h; y++) {
      const a = cells(before[y]!), b = cells(r.lines[y]!);
      assert.equal(b.length, VP.w, `line ${y} is ${VP.w} cells`);
      for (let x = 0; x < VP.w; x++) {
        const inPatch = r.hidden.some(h => ((x - h.cell.x) / 10) ** 2 + ((y - h.cell.y) / 4.5) ** 2 < 1);
        if (!inPatch) assert.deepEqual(b[x], a[x], `(${x}, ${y}) outside the patches is as drawn`);
      }
    }
    // Lines with no patch are the renderer's lines, spans and all.
    const rows = new Set(r.hidden.flatMap(h => Array.from({ length: 11 }, (_, i) => h.cell.y - 5 + i)));
    for (let y = 0; y < VP.h; y++) if (!rows.has(y)) assert.deepEqual(r.lines[y], before[y]);
  }
});

test("you stay findable behind a building: your @, bold and light, not the purple patch", () => {
  const ex = behindTheHouse();
  const f = exploreFrame(ex, VP);
  const me = screenOf(ex.at, f.camera, VP);
  const before = cellAt(render(f.map, f.actors, f.camera, VP, f.options), me);
  assert.equal(before.bg, DRAWN_THROUGH, "today: drawn through on purple");
  for (const lines of [renderXray(f.map, f.actors, f.camera, VP, f.options), xrayExplore(ex, VP)]) {
    const c = cellAt(lines, me);
    assert.equal(c.ch, "@");
    assert.ok(c.bold, "bold");
    const [r, g, b] = hex(c.fg);
    assert.ok(r > 170 && g > 170 && b > 170, `light (${c.fg})`);
    assert.notEqual(c.bg, DRAWN_THROUGH);
    const [br, bg, bb] = hex(c.bg);
    assert.ok(Math.max(br, bg, bb) < 110, `on something dark enough to read against (${c.bg})`);
  }
  // In plain text too.
  assert.equal(toPlain(xrayExplore(ex, VP, { color: false })).split("\n")[me.y]![me.x], "@");
});

test("plain frames show who's behind the building", () => {
  const ex = kellBehindTheWarehouse();
  const f = exploreFrame(ex, VP);
  const kell = f.actors.find(a => a.id === "kell")!;
  const at = screenOf(kell.at, f.camera, VP);
  const plain = toPlain(xrayExplore(ex, VP, { color: false })).split("\n");
  assert.equal(plain[at.y]![at.x], "K");
  assert.notEqual(toPlain(renderExplore(ex, VP, { color: false })).split("\n")[at.y]![at.x], "K");
});

test("inside the Drowned Rat: the room stays cut away, the porter asleep on the steps outside shows through its wall", () => {
  const ex = newExploration(DUSK);
  travel(ex, { map: "drowned-rat", at: { x: 3, y: 3 } }, "In");
  move(ex, 0, 1); move(ex, 0, 1); move(ex, 1, 1);
  const f = exploreFrame(ex, VP);
  const before = render(f.map, f.actors, f.camera, VP, f.options);
  const r = xray(f.map, f.actors, f.camera, VP, f.options);
  assert.deepEqual(r.hidden.map(h => h.actor.name), ["a porter asleep on the steps"]);
  assert.equal(cellAt(r.lines, r.hidden[0]!.cell).ch, "z");
  // Everyone in the room is drawn as before (the cutaway didn't change), and you're where you were.
  for (const a of f.actors.filter(a => a.map === "drowned-rat" && a.at.y >= 5 && a.at.y <= 10 && a.at.x >= 2 && a.at.x <= 11)) {
    const at = screenOf(a.at, f.camera, VP);
    assert.deepEqual(cellAt(r.lines, at), cellAt(before, at), `${a.name} as drawn`);
  }
});

test("explore frames: exploreFrame hands render() what renderExplore does", () => {
  const scenes: Array<[ExploreState, Parameters<typeof renderExplore>[2]]> = [];
  scenes.push([newExploration(MORNING), {}]);
  scenes.push([behindTheHouse(), { tick: 3 }]);
  scenes.push([kellBehindTheWarehouse(), { color: false }]);
  const yard = newExploration(MORNING);
  enterScene(yard, "hanged-clerk");
  scenes.push([yard, { world: yardWorld("Tester") }]);
  for (const [ex, options] of scenes) for (const vp of [VP, { w: 60, h: 18 }]) {
    const f = exploreFrame(ex, vp, options);
    assert.equal(JSON.stringify(render(f.map, f.actors, f.camera, vp, f.options)), JSON.stringify(renderExplore(ex, vp, options)));
  }
});

test("findHidden agrees with the renderer: wherever you stand, you're found hidden exactly where it draws you through a wall", () => {
  // Every other tile you can stand on (a checkerboard), on every map: the audit does them all.
  const vp = { w: 30, h: 12 };
  let hidden = 0;
  for (const id of Object.keys(MAPS)) {
    const map = getMap(id);
    for (let y = 0; y < map.height; y++) for (let x = (y % 2); x < map.width; x += 2) {
      const t = tileAt(map, { x, y });
      if (t.blocks || (isStructure(t) && t.terrain !== "door") || t.terrain === "void") continue;
      const me: MapActor = { id: "player", name: "you", kind: "player", glyph: "@", color: "#ffffff", map: id, at: { x, y } };
      const front = render(map, [me], { x, y }, vp);
      const through = cellAt(front, screenOf({ x, y }, { x, y }, vp)).bg === DRAWN_THROUGH;
      const found = findHidden(front, map, [me], { x, y }, vp).hidden.length > 0;
      assert.equal(found, through, `${id} (${x}, ${y})`);
      if (found) hidden++;
    }
  }
  assert.ok(hidden > 150, `the maps have plenty of places to be hidden (${hidden})`);
});

test("it costs one render when nobody's hidden and two when someone is, with whatever renderer it's given", () => {
  let calls = 0;
  const draw: typeof render = (...args) => { calls++; return render(...args); };
  const clear = exploreFrame(newExploration(MORNING, { at: { x: 25, y: 25 } }), VP);
  renderXray(clear.map, clear.actors, clear.camera, VP, clear.options, { draw });
  assert.equal(calls, 1);
  calls = 0;
  const hidden = exploreFrame(behindTheHouse(), VP);
  const lines = renderXray(hidden.map, hidden.actors, hidden.camera, VP, hidden.options, { draw });
  assert.equal(calls, 2);
  assert.notEqual(JSON.stringify(lines), JSON.stringify(render(hidden.map, hidden.actors, hidden.camera, VP, hidden.options)));
});

test("what matters: people, the player, items and scene things; not the town's lamp posts or bunting", () => {
  const base = { id: "x", name: "x", glyph: "x", map: "caerwyn", at: { x: 0, y: 0 } };
  assert.ok(matters({ ...base, kind: "player" }));
  assert.ok(matters({ ...base, kind: "person" }));
  assert.ok(matters({ ...base, kind: "creature" }));
  assert.ok(matters({ ...base, kind: "item" }));
  assert.ok(matters({ ...base, kind: "object", ref: "satchel" }), "a scene's thing (a clue)");
  assert.ok(!matters({ ...base, kind: "object", interaction: { kind: "examine", text: "A lamp post.", label: "Look" } }), "the town's dressing");
  assert.ok(!matters({ ...base, kind: "object", states: ["overhead"] }), "bunting");
  assert.ok(!matters({ ...base, kind: "person", states: ["gone"] }));
});

test("x-ray keeps what scenes lay on the ground: the yard's burning board and its puddle, in the scene and after it", () => {
  const ex = newExploration(MORNING);
  enterScene(ex, "hanged-clerk");
  const world = yardWorld("Tester");
  damageThing(world, world.entities["loose-board"]!, 3, "fire", 1);
  douse(world, world.entities["loose-board"]!, 2);
  const vp = { w: 80, h: 24 };
  const during = exploreFrame(ex, vp, { world });
  assert.ok(during.options.worlds?.some(l => l.world === world), "the scene's world lies on its place");
  // The yard isn't the Rat's open room: outside whoever's behind a building, it's drawn as renderExplore draws it.
  asDrawnOutsidePatches(ex, vp, { world, t: 2000 });
  leaveScene(ex, world);
  const after = exploreFrame(ex, vp);
  assert.ok(after.options.worlds?.some(l => Object.values(l.world.entities).some(e => e.kind === "surface")), "the puddle stays after the scene");
  // Outside whoever's hidden, it's renderExplore's frame.
  asDrawnOutsidePatches(ex, vp, { t: 2000 });
});

/** A frame x-rayed is renderExplore's outside the patches over whoever's hidden (each its x-ray's ellipse). */
function asDrawnOutsidePatches(ex: ExploreState, vp: { w: number; h: number }, options: Parameters<typeof renderExplore>[2]): void {
  const f = exploreFrame(ex, vp, options);
  const { hidden } = xray(f.map, f.actors, f.camera, vp, f.options);
  const drawn = renderExplore(ex, vp, options), rayed = xrayExplore(ex, vp, options);
  if (!hidden.length) assert.equal(JSON.stringify(rayed), JSON.stringify(drawn), "nobody's hidden: drawn as renderExplore draws it, byte for byte");
  for (let y = 0; y < vp.h; y++) for (let x = 0; x < vp.w; x++) {
    if (hidden.some(h => ((x - h.cell.x) / 10) ** 2 + ((y - h.cell.y) / 4.5) ** 2 < 1)) continue;
    assert.deepEqual(cellAt(rayed, { x, y }), cellAt(drawn, { x, y }), `(${x}, ${y}) as renderExplore draws it`);
  }
}

test("the mouse picks what the x-rayed frame shows: what's behind where it shows through, the building where the building shows", () => {
  for (const ex of [behindTheHouse(), kellBehindTheWarehouse()]) {
    const f = exploreFrame(ex, VP);
    const frontPicks = new Picks(), behindPicks = new Picks(), pick = new Picks();
    const front = render(f.map, f.actors, f.camera, VP, { ...f.options, pick: frontPicks });
    const { behind } = findHidden(front, f.map, f.actors, f.camera, VP, { ...f.options, pick: behindPicks });
    assert.ok(behind, "someone's hidden: there's a frame without the buildings");
    const lines = xrayExplore(ex, VP, { pick });
    let through = 0, building = 0;
    for (let y = 0; y < VP.h; y++) for (let x = 0; x < VP.w; x++) {
      const shown = cellAt(lines, { x, y }).ch, a = cellAt(front, { x, y }).ch, b = cellAt(behind!, { x, y }).ch;
      const got = JSON.stringify(pick.at(x, y));
      if (shown === a && shown !== b) { assert.equal(got, JSON.stringify(frontPicks.at(x, y)), `(${x}, ${y}) shows the building: a click there is on it`); building++; }
      else if (shown === b && shown !== a) { assert.equal(got, JSON.stringify(behindPicks.at(x, y)), `(${x}, ${y}) shows what's behind: a click there is on that`); through++; }
    }
    assert.ok(through > 0 && building > 0, `some cells show what's behind (${through}), some the building (${building})`);
  }
  // Kell, through the warehouse: a click on her K is a click on her.
  const ex = kellBehindTheWarehouse();
  const pick = new Picks();
  const lines = xrayExplore(ex, VP, { pick });
  const f = exploreFrame(ex, VP);
  const at = screenOf(f.actors.find(a => a.id === "kell")!.at, f.camera, VP);
  assert.equal(cellAt(lines, at).ch, "K");
  assert.equal(pick.at(at.x, at.y)?.actor?.id, "kell");
});
