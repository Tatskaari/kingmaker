// Copied from the prototype's src/game/map/walk.test.ts at 44c6d4a, whole. The maps are the campaign's files (useMaps); the lead's place waits as the prototype's presence built it, from its place file (ExploreState.waiting: the simulation keeps it as rows); `.at(-1)` as in the copies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildWorld, type WorldSpec } from "../world/scene-world.ts";
import type { StoryState, Tile2 } from "./types.ts";
import { actorsHere, lookAt, move, newExploration as fresh, tileName, walkPlan, type ExploreState, type MoveResult } from "./explore.ts";
import { CAST } from "./looks.ts";
import { getMap, useMaps } from "./maps.ts";
import { steps, tileAt } from "./tiles.ts";

const CAMPAIGN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const read = (path: string) => JSON.parse(readFileSync(join(CAMPAIGN, path), "utf8"));
useMaps((read("campaign.json").maps as string[]).map(key => read(`maps/${key}.json`)));
const YARD = read("places/granary-yard.json") as WorldSpec;

/** A fresh exploration, the granary yard waiting with its people in it while its scene is the lead (presence.ts: v2 draws it from its rows). */
function newExploration(story: StoryState, options: { map?: string; at?: Tile2 } = {}): ExploreState {
  const ex = fresh(story, options);
  if (story.lead === "hanged-clerk" && !story.played.includes("hanged-clerk")) {
    ex.waiting = { "hanged-clerk": buildWorld("hanged-clerk", YARD, ["kell", "cob", "moll"].map(id => ({ id, name: CAST[id]!.name })), { name: "you" }) };
  }
  return ex;
}

/**
 * A click on the map walks there (walkPlan): the shortest way round what's in the way, through a
 * door to its far side, up beside whatever can't be stood on, or as near as there's a way to. And
 * walking into things says what they are, in the house style, never the same line twice running.
 */

const MORNING: StoryState = { time: "morning", played: [], lead: "hanged-clerk", flags: {} };
const DUSK: StoryState = { time: "evening", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} };

/** Walk a plan's steps as the app does, a step at a time; what the last step did. */
function walk(ex: ExploreState, target: Tile2): { plan: NonNullable<ReturnType<typeof walkPlan>>; last?: MoveResult; results: MoveResult[] } {
  const plan = walkPlan(ex, target);
  assert.ok(plan, `there's a way towards (${target.x}, ${target.y})`);
  const results: MoveResult[] = [];
  for (const [dx, dy] of plan.path) {
    const r = move(ex, dx, dy);
    results.push(r);
    assert.ok(r.moved || r.trigger, `each step is taken (${r.message ?? ""})`);
    if (r.trigger || r.travelled) break;
  }
  return { plan, results, ...(results.length ? { last: results[results.length - 1]! } : {}) };
}

test("a click on a far tile walks there, the shortest way round what's in the way", () => {
  const ex = newExploration(DUSK, { at: { x: 42, y: 9 } });
  const { plan } = walk(ex, { x: 24, y: 24 });
  assert.equal(plan.reaches, true);
  assert.deepEqual(ex.at, { x: 24, y: 24 }, "across town to the market square");
  assert.ok(plan.path.length < 30, `by a short way (${plan.path.length} steps)`);
  // Past the sign in the lane, which used to stop people: it isn't in the way any more.
  const lane = newExploration(MORNING, { at: { x: 36, y: 8 } });
  const past = walk(lane, { x: 41, y: 8 });
  assert.equal(past.plan.path.length, 5, "straight along the lane, past the sign");
});

test("a click on a door goes through it: the yard gate into the yard, the Rat's door into the Rat", () => {
  const gate = newExploration(MORNING, { at: { x: 40, y: 8 } });
  const into = walk(gate, { x: 42, y: 10 });
  assert.equal(into.last?.trigger?.sceneId, "hanged-clerk", "through the gate into the yard, where the scene is waiting");
  const stairs = newExploration(DUSK, { at: { x: 24, y: 33 } });
  const rat = walk(stairs, { x: 26, y: 35 });
  assert.equal(rat.last?.travelled?.to, "drowned-rat", "and down through the Rat's door");
});

test("a click on what can't be stood on walks you up beside it, or as near as there's a way", () => {
  // Kell, waiting inside the gate: beside her, not on her.
  const lane = newExploration(MORNING, { at: { x: 36, y: 9 } });
  const kell = actorsHere(lane).find(a => a.ref === "kell")!;
  const toKell = walkPlan(lane, kell.at)!;
  assert.equal(toKell.reaches, false);
  for (const [dx, dy] of toKell.path) move(lane, dx, dy);
  assert.equal(steps(lane.at, kell.at), 1, "beside Kell");
  // The middle of the watch house: up against its wall.
  const street = newExploration(DUSK, { at: { x: 30, y: 12 } });
  const house = { x: 25, y: 4 };
  const before = steps(street.at, house);
  const { plan } = walk(street, house);
  assert.equal(plan.reaches, false);
  assert.ok(steps(street.at, house) < before && getMap("caerwyn").tiles[street.at.y]![street.at.x]!.terrain !== "wall", "as near the watch house as the street goes");
  // The river: to the water's edge, and no further.
  const wharf = newExploration(DUSK, { at: { x: 20, y: 38 } });
  walk(wharf, { x: 20, y: 44 });
  assert.ok(steps(wharf.at, { x: 20, y: 44 }) <= 3, `at the edge (${wharf.at.x}, ${wharf.at.y})`);
  assert.notEqual(tileAt(getMap("caerwyn"), wharf.at).terrain, "deep-water");
  // A locked door: beside it (the explorer's walk then tries it: see town.test.ts).
  const door = newExploration(DUSK, { at: { x: 31, y: 16 } });
  const shut = walkPlan(door, { x: 27, y: 13 })!;
  assert.equal(shut.reaches, false);
  for (const [dx, dy] of shut.path) move(door, dx, dy);
  assert.equal(steps(door.at, { x: 27, y: 13 }), 1);
  // Already as near as there's a way to (ankle-deep at the river's edge): nothing to plan.
  assert.equal(walkPlan(newExploration(DUSK, { at: { x: 20, y: 41 } }), { x: 20, y: 45 }), undefined);
});

test("walking into the same wall again and again gets a second opinion, and a third, but never the same line twice running", () => {
  // Granary Street: plaster houses to the west, (27, 13) a house door, locked.
  const ex = newExploration(DUSK, { at: { x: 28, y: 14 } });
  const said: string[] = [];
  for (let i = 0; i < 12; i++) said.push(move(ex, -1, 0).message ?? "");
  assert.ok(said.every(Boolean) && ex.at.x === 28, "the wall stops you every time, and says so");
  for (let i = 1; i < said.length; i++) assert.notEqual(said[i], said[i - 1], `"${said[i]}" twice running`);
  assert.ok(new Set(said).size >= 4, `a few different lines (${new Set(said).size})`);
  ex.at = { x: 28, y: 13 };
  const doors: string[] = [];
  for (let i = 0; i < 6; i++) doors.push(move(ex, -1, 0).message ?? "");
  for (let i = 1; i < doors.length; i++) assert.notEqual(doors[i], doors[i - 1]);
  assert.ok(doors.every(d => /lock|shut|door|padlock/i.test(d)), doors.join(" | "));
});

test("bumping says what you bumped: the goose, the palace guard, the river, the stocks, a wall by what it's built of", () => {
  const morning = newExploration(MORNING);
  const bump = (ex: ExploreState, what: Tile2) => {
    const spot = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => ({ x: what.x - dx!, y: what.y - dy! }))
      .find(p => { const t = tileAt(getMap("caerwyn"), p); return !t.blocks && t.terrain !== "wall" && !actorsHere(ex).some(a => a.blocks && a.at.x === p.x && a.at.y === p.y); })!;
    ex.at = spot;
    return move(ex, what.x - spot.x, what.y - spot.y).message ?? "";
  };
  const goose = actorsHere(morning).find(a => a.name === "a goose")!;
  assert.match(bump(morning, goose.at), /goose/i);
  const guard = actorsHere(morning).find(a => a.name === "a palace guard")!;
  assert.match(bump(morning, guard.at), /guard|halberd/i);
  const stocks = actorsHere(morning).find(a => a.name === "the stocks")!;
  assert.match(bump(morning, stocks.at), /stocks/i);
  const river = newExploration(DUSK, { at: { x: 5, y: 41 } });
  assert.match(move(river, 0, 1).message ?? "", /river|swim|boat/i);
  // The palace walls are the palace's: the first line about them is about the palace.
  const palace = newExploration(MORNING, { at: { x: 21, y: 9 } });
  assert.match(move(palace, -1, 0).message ?? "", /palace/i);
});

test("looking at places from where you stand: a building by its description, the river, the cobbles, a lamp post", () => {
  const ex = newExploration(DUSK, { at: { x: 30, y: 12 } });
  assert.match(lookAt(ex, { x: 25, y: 4 }), /watch house/i);
  assert.equal(tileName(ex, { x: 25, y: 4 }), "the watch house");
  assert.match(lookAt(ex, { x: 20, y: 44 }), /river|fast|cold|freezing/i);
  assert.equal(tileName(ex, { x: 20, y: 44 }), "the river");
  assert.match(lookAt(ex, { x: 30, y: 13 }), /cobble|stood/i, "the street you're in, by its cobbles");
  assert.match(lookAt(ex, { x: 28, y: 9 }), /lamp post/i);
  const before = { ...ex.at };
  lookAt(ex, { x: 50, y: 30 });
  assert.deepEqual(ex.at, before, "looking doesn't walk you anywhere");
});
