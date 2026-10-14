import { test } from "node:test";
import assert from "node:assert/strict";
import { actorLook } from "../look/map.ts";
import type { StoryState, StyledLine, Tile2 } from "../types.ts";
import { buildMap, T } from "./tiles.ts";
import { actorsHere, exploreCamera, getMap, isStructure, move, newExploration, Picks, render, renderExplore, screenOf, tileAt, tileAtScreen } from "./index.ts";

/**
 * Picking for the mouse: render() says what it drew where (Picks), so a click picks what the player
 * is looking at, wherever the camera is and whatever size the view: a person's letter is that
 * person, a lamp up its post is the lamp's tile, flat ground is the tile under the pointer. And what
 * stands in the way looks it: big things fill their square, small things stand up on posts and are
 * walked past.
 */

const MORNING: StoryState = { time: "morning", played: [], lead: "hanged-clerk", flags: {} };
const DUSK: StoryState = { time: "evening", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} };
const NIGHT: StoryState = { time: "night", played: ["hanged-clerk", "drowned-rat"], lead: "heron-warehouse", flags: {} };
const PROCESSION: StoryState = { time: "next-morning", played: ["hanged-clerk", "drowned-rat", "heron-warehouse"], lead: "kings-morning", flags: {} };
const SIZES = [{ w: 80, h: 24 }, { w: 120, h: 40 }, { w: 41, h: 13 }, { w: 87, h: 33 }];

/** The character drawn in a cell. */
function charAt(lines: StyledLine[], x: number, y: number): string {
  let n = 0;
  for (const span of lines[y] ?? []) {
    const chars = [...span.text];
    if (x < n + chars.length) return chars[x - n]!;
    n += chars.length;
  }
  return " ";
}

const same = (a: Tile2 | undefined, b: Tile2) => !!a && a.x === b.x && a.y === b.y;

test("flat ground: every cell picks the tile under it, as the projection has it, wherever the camera is", () => {
  const flat = buildMap({ id: "pick-flat", name: "Flat", grid: Array.from({ length: 24 }, () => ".".repeat(24)).join("\n"), legend: { ".": T("cobbles") }, regions: [] }).map;
  for (const camera of [{ x: 12, y: 12 }, { x: 2, y: 20 }, { x: 21, y: 3 }]) for (const size of SIZES) {
    const pick = new Picks();
    render(flat, [], camera, size, { pick, color: false });
    for (let y = 0; y < size.h; y++) for (let x = 0; x < size.w; x++) {
      const under = tileAtScreen(x, y, camera, size);
      const inside = under.x >= 0 && under.y >= 0 && under.x < flat.width && under.y < flat.height;
      const picked = pick.at(x, y)?.at;
      if (inside) assert.ok(same(picked, under), `cell (${x}, ${y}) picks (${under.x}, ${under.y}), got ${JSON.stringify(picked)} (camera ${camera.x},${camera.y}, ${size.w}x${size.h})`);
      else assert.equal(picked, undefined, `cell (${x}, ${y}) is off the map`);
    }
  }
});

test("a click on a drawn actor picks that actor's tile, at several camera positions and sizes", () => {
  const places: Array<[string, StoryState, string, Tile2]> = [
    ["the granary lane", MORNING, "caerwyn", { x: 42, y: 9 }],
    ["the market square", MORNING, "caerwyn", { x: 28, y: 22 }],
    ["the river stairs at dusk", DUSK, "caerwyn", { x: 24, y: 34 }],
    ["the wharves at night", NIGHT, "caerwyn", { x: 18, y: 37 }],
    ["procession morning", PROCESSION, "caerwyn", { x: 22, y: 24 }],
    ["the Rat's landing", NIGHT, "drowned-rat", { x: 4, y: 3 }],
  ];
  let checked = 0;
  const kinds = new Set<string>();
  for (const [where, story, map, at] of places) for (const size of SIZES) {
    const ex = newExploration(story, { map, at });
    const pick = new Picks();
    const lines = renderExplore(ex, size, { pick, t: 1000, glyphs: "ascii" });
    const camera = exploreCamera(ex, size);
    for (const a of actorsHere(ex)) {
      if ((a.states ?? []).some(s => s === "overhead" || s === "hidden")) continue;
      const glyph = a.kind === "player" ? "@" : actorLook(a, { t: 1000, time: story.time, glyphs: "ascii" }).glyph;
      // Where its glyph is drawn: on its tile, or up its post (or its plinth, or its rope).
      const s = screenOf(a.at, camera, size);
      const k = [0, 1, 2, 3].find(k => s.x >= 0 && s.x < size.w && s.y - k >= 0 && s.y - k < size.h && charAt(lines, s.x, s.y - k) === glyph);
      if (k === undefined) continue;
      const got = pick.at(s.x, s.y - k);
      assert.ok(same(got?.at, a.at), `${where}, ${size.w}x${size.h}: a click on ${a.name}'s ${glyph} picks (${a.at.x}, ${a.at.y}), got ${JSON.stringify(got?.at)}`);
      assert.equal(got?.actor?.id, a.id, `${where}, ${size.w}x${size.h}: and it's ${a.name} drawn there`);
      checked++;
      kinds.add(a.kind === "object" && a.blocks ? "big thing" : a.kind === "object" ? "small thing" : a.kind);
    }
  }
  assert.ok(checked > 150, `plenty of people and things checked (${checked})`);
  for (const kind of ["player", "person", "creature", "big thing", "small thing"]) assert.ok(kinds.has(kind), `including a ${kind}`);
});

test("a click on a building picks the building, not the street behind it", () => {
  const ex = newExploration(MORNING, { at: { x: 30, y: 12 } });
  const size = { w: 80, h: 24 };
  const pick = new Picks();
  render(getMap("caerwyn"), actorsHere(ex), ex.at, size, { pick, time: "morning", focus: ex.at });
  // The Corn Exchange's wall at (38, 21) stands four rows high: the cells up its face are the wall's.
  const wall = { x: 38, y: 21 };
  assert.ok(isStructure(tileAt(getMap("caerwyn"), wall)));
  const s = screenOf(wall, ex.at, size);
  for (const dy of [0, -1, -2, -3]) assert.ok(same(pick.at(s.x, s.y + dy)?.at, wall), `the wall's face, ${-dy} rows up`);
});

test("the pointer lights up its tile, everything drawn for it and nothing else", () => {
  const ex = newExploration(MORNING, { at: { x: 28, y: 22 } });
  const size = { w: 80, h: 24 };
  const cart = actorsHere(ex).find(a => /cabbage/.test(a.name))!;
  const pick = new Picks();
  const plain = renderExplore(ex, size, { pick, t: 500 });
  const lit = renderExplore(ex, size, { hover: cart.at, t: 500 });
  let changed = 0;
  for (let y = 0; y < size.h; y++) for (let x = 0; x < size.w; x++) {
    const bg = (lines: StyledLine[]) => { let n = 0; for (const s of lines[y]!) { const len = [...s.text].length; if (x < n + len) return s.bg; n += len; } return undefined; };
    const mine = same(pick.at(x, y)?.at, cart.at);
    if (bg(plain) !== bg(lit)) { assert.ok(mine, `only the cart's tile changes (${x}, ${y})`); changed++; }
  }
  assert.ok(changed >= 5, `the cart's square and its load light up (${changed} cells)`);
});

test("what's in the way looks it: big things fill their square, small things stand on posts and are walked past", () => {
  const map = getMap("caerwyn");
  let sides = 0, filled = 0;
  for (const story of [MORNING, DUSK, NIGHT, PROCESSION]) {
    const ex = newExploration(story);
    const things = actorsHere(ex).filter(a => a.kind === "object" || a.kind === "item");
    for (const a of things.filter(a => a.blocks)) {
      // Its tile's left and right cells are drawn by it, not the ground showing round a letter (unless
      // something nearer the viewer stands in front of it: a wall, the bunting).
      const size = { w: 41, h: 15 };
      const pick = new Picks();
      render(map, actorsHere(ex), a.at, size, { pick, time: story.time, focus: a.at });
      const s = screenOf(a.at, a.at, size);
      for (const dx of [-1, 1]) {
        const by = pick.at(s.x + dx, s.y);
        const mine = by?.actor?.id === a.id;
        const inFront = !!by && by.at.y - by.at.x > a.at.y - a.at.x;
        assert.ok(mine || inFront, `${a.name} (${story.time}) fills its square (${dx < 0 ? "left" : "right"}), or something in front of it hides it`);
        sides++;
        if (mine) filled++;
      }
    }
    const posts = things.filter(a => (a.states ?? []).includes("post"));
    assert.ok(posts.some(a => /lamp/.test(a.name)) && (story.time !== "morning" || posts.some(a => a.name === "a sign")), `lamps and signs stand on posts (${story.time})`);
    for (const a of posts) assert.ok(!a.blocks, `${a.name} doesn't block`);
  }
  assert.ok(sides > 40 && filled / sides > 0.8, `big things fill their squares (${filled} of ${sides} sides drawn by the thing itself)`);
  // The sign in the lane that people kept walking into: walked past now.
  const ex = newExploration(MORNING, { at: { x: 38, y: 8 } });
  assert.ok(move(ex, 1, 0).moved, "you walk past the sign");
  assert.deepEqual(ex.at, { x: 39, y: 8 });
  // The cabbage cart is still in the way, and says so.
  const cart = newExploration(MORNING, { at: { x: 28, y: 21 } });
  const bump = move(cart, 1, 0);
  assert.equal(bump.moved, false);
  assert.match(bump.message ?? "", /cabbage/i);
});
