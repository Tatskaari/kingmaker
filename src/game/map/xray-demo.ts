/**
 * X-ray, before and after, in the places it matters:
 *   1. behind the house north of the granary lane, Kell a step behind you (the afternoon after the granary);
 *   2. Bank Street at dusk: you step up off it, Kell stays behind the bank and a warehouse;
 *   3. the Heron, a fight on its battlefield: a Crake behind the wheat-ear sacks, Scrope at his desk
 *      behind the counting-box glass;
 *   4. inside the Drowned Rat, the room cut away, the porter asleep on the steps behind its wall;
 *   5. the granary yard's scene: the tally loft's things behind the granary's wall.
 *
 * node --no-warnings src/game/map/xray-demo.ts [--plain | --color] [--w 120] [--h 40] [--json dir]
 * (--json writes each frame's StyledLine[] as <dir>/<name>-before.json and -after.json, for pictures)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { applyOps, buildWorld, joinWorld } from "../../world/scene-world.ts";
import { drownedRatWorld } from "../../../scenes/worlds/drowned-rat.ts";
import { hangedClerkWorld } from "../../../scenes/worlds/hanged-clerk.ts";
import type { MapActor, StoryState, StyledLine, Tile2 } from "../types.ts";
import { CAST, actorsHere, battlefield, enterScene, heronWorld, move, newExploration, pathTo, render, toAnsi, toPlain, travel, type ExploreState, type RenderOptions } from "./index.ts";
import { exploreFrame, xray } from "./xray.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const plain = args.includes("--plain") || (!process.stdout.isTTY && !args.includes("--color"));
const viewport = { w: Number(flag("w") ?? 120), h: Number(flag("h") ?? 40) };
const json = flag("json");
if (json) mkdirSync(json, { recursive: true });

const out = (s = "") => process.stdout.write(`${s}\n`);
const draw = (lines: StyledLine[]) => out(plain ? toPlain(lines) : toAnsi(lines));
const index: Array<{ name: string; title: string; hidden: Array<{ name: string; at: Tile2; cell: Tile2 }> }> = [];

function show(name: string, title: string, map: Parameters<typeof render>[0], actors: MapActor[], camera: Tile2, options: RenderOptions): void {
  const before = render(map, actors, camera, viewport, options);
  const after = xray(map, actors, camera, viewport, options);
  out(`\n${plain ? `== ${title}` : `\x1b[1;33m== ${title}\x1b[0m`}`);
  out(`Hidden: ${after.hidden.map(h => `${h.actor.name} (${h.actor.at.x}, ${h.actor.at.y})`).join(", ") || "nobody (the frame is unchanged)"}.`);
  out("Before:");
  draw(before);
  out("After:");
  draw(after.lines);
  index.push({ name, title, hidden: after.hidden.map(h => ({ name: h.actor.name, at: h.actor.at, cell: h.cell })) });
  if (json) {
    writeFileSync(`${json}/${name}-before.json`, JSON.stringify(before));
    writeFileSync(`${json}/${name}-after.json`, JSON.stringify(after.lines));
    writeFileSync(`${json}/index.json`, JSON.stringify(index, null, 1));
  }
}

function explore(name: string, title: string, ex: ExploreState, world?: ReturnType<typeof buildWorld>): void {
  const f = exploreFrame(ex, viewport, world ? { world } : {});
  show(name, title, f.map, f.actors, f.camera, f.options);
}

const walk = (ex: ExploreState, to: Tile2) => { for (const [dx, dy] of pathTo(ex, to) ?? []) move(ex, dx, dy); };
const cast = (ids: string[]) => ids.map(id => ({ id, name: CAST[id]!.name }));
const MORNING: StoryState = { time: "morning", played: [], lead: "hanged-clerk", flags: {} };
const AFTERNOON: StoryState = { time: "afternoon", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} };
const DUSK: StoryState = { time: "evening", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} };
const NIGHT: StoryState = { time: "night", played: ["hanged-clerk", "drowned-rat"], lead: "heron-warehouse", flags: {} };

// 1. Round the back of the house north of the granary lane: today you're a purple @ and Kell isn't there at all.
{
  const ex = newExploration(AFTERNOON);
  walk(ex, { x: 34, y: 0 });
  explore("north-house", "1. Behind the house north of the granary lane, Kell a step behind (afternoon)", ex);
}

// 2. Bank Street at dusk: the bank and the warehouses stand between it and the viewer.
{
  const ex = newExploration(DUSK);
  walk(ex, { x: 32, y: 32 });
  for (let i = 0; i < 6; i++) move(ex, 1, 0);
  move(ex, 1, -1);
  explore("bank-street", "2. Bank Street at dusk: you step up off it, Kell stays behind the bank and a warehouse", ex);
}

// 3. The Heron as a battlefield: the fighters' rooms open, the roof off, the counting-box shut up with Scrope in it.
{
  const ex = newExploration(NIGHT);
  enterScene(ex, "heron-warehouse");
  const heron = buildWorld("heron-warehouse", heronWorld, cast(["kell", "saul", "hep", "scrope", "hobb"]), { name: "the investigator" });
  joinWorld(heron, [{ id: "sallow", name: CAST.sallow!.name }], 9);
  const near = (what: string, to: string) => ({ op: "move" as const, what, to, how: "near", name: "", kind: "", text: "", add: [], remove: [] });
  applyOps(heron, [near("player", "trestles"), near("kell", "player"), near("sallow", "floor-brazier")], 9);
  const field = battlefield("heron-warehouse", heron)!;
  // One Crake right behind the wheat-ear sacks (north-east of them, up the screen), one on the floor.
  const crakes: MapActor[] = [{ x: 12, y: 3 }, { x: 12, y: 8 }].map((at, i) => ({ id: `crake-${i + 1}`, name: "a Crake", kind: "person", glyph: CAST.crake!.glyph, color: CAST.crake!.color, map: field.map.id, at, blocks: true }));
  const fighters = [field.people.player!, field.people.kell!, field.people.sallow!, ...crakes.map(c => c.at)];
  const camera = field.people.player!;
  show("heron-fight", "3. The Heron, a fight: a Crake behind the wheat-ear sacks, Scrope at his desk behind the counting-box glass", field.map, [...actorsHere(ex, heron), ...crakes], camera,
    { time: "night", roofs: false, focus: camera, reveal: fighters, tick: 5 });
}

// 4. Inside the Drowned Rat: the room's front walls cut away; behind its back wall, the landing.
{
  const ex = newExploration(DUSK);
  travel(ex, { map: "drowned-rat", at: { x: 3, y: 3 } }, "In");
  move(ex, 0, 1); move(ex, 0, 1); move(ex, 1, 1);
  explore("rat-inside", "4. Inside the Drowned Rat: the room cut away, the porter asleep on the steps behind its wall", ex);
  const scene = newExploration(DUSK);
  enterScene(scene, "drowned-rat");
  explore("rat-scene", "4b. The Drowned Rat's scene, its world on the map", scene, buildWorld("drowned-rat", drownedRatWorld, cast(["kell", "nan-quill", "arlo", "dilly", "hobb", "cob"]), { name: "the investigator" }));
}

// 5. The hanged clerk's scene: the yard open, the tally loft up behind the granary's wall.
{
  const ex = newExploration(MORNING);
  enterScene(ex, "hanged-clerk");
  explore("yard-scene", "5. The granary yard's scene: the tally loft's things behind the granary wall", ex, buildWorld("hanged-clerk", hangedClerkWorld, cast(["kell", "cob", "moll"]), { name: "the investigator" }));
}
