/**
 * An occlusion audit of the hand-made maps: how often is the player, or anyone or anything that
 * matters, behind a building?
 *   1. The routes the player walks between the arc's places (pathTo between the leads in PLACES),
 *      each at the story's time of day: to the granary yard in the morning, to the Drowned Rat in
 *      the afternoon with Kell, to the Heron at night, to the palace the next morning. At every
 *      step: is the player hidden, and who or what else in view is?
 *   2. Every tile you can stand on, on every map: would you be hidden there?
 * Hidden means covered by a nearer wall, roof or tree in the frame as rendered (x-ray's findHidden,
 * checked against a render with them cleared). Today the player is drawn through on purple and
 * everyone else vanishes; with x-ray they show through.
 *
 * node --no-warnings src/game/map/xray-audit.ts [--w 120] [--h 40] [--json out.json]
 */
import { writeFileSync } from "node:fs";
import { buildWorld } from "../../world/scene-world.ts";
import type { MapActor, StoryState, Tile2 } from "../types.ts";
import { CAST, enterScene, getMap, isStructure, MAPS, move, newExploration, pathTo, PLACES, regionAt, render, screenOf, tileAt } from "./index.ts";
import { exploreFrame, findHidden, matters } from "./xray.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const viewport = { w: Number(flag("w") ?? 120), h: Number(flag("h") ?? 40) };

interface Leg { name: string; story: StoryState; from: Tile2; to: Tile2 }

const lead = (scene: string) => PLACES[scene]!.lead.at;
const after = (scene: string) => PLACES[scene]!.after.at;
const LEGS: Leg[] = [
  { name: "to the granary yard (morning)", story: { time: "morning", played: [], lead: "hanged-clerk", flags: {} }, from: { x: 42, y: 9 }, to: lead("hanged-clerk") },
  { name: "to the Drowned Rat (afternoon, Kell in tow)", story: { time: "afternoon", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} }, from: after("hanged-clerk"), to: lead("drowned-rat") },
  { name: "to the Heron (night)", story: { time: "night", played: ["hanged-clerk", "drowned-rat"], lead: "heron-warehouse", flags: {} }, from: after("drowned-rat"), to: lead("heron-warehouse") },
  { name: "to the palace (the next morning)", story: { time: "next-morning", played: ["hanged-clerk", "drowned-rat", "heron-warehouse"], lead: "kings-morning", flags: {} }, from: after("heron-warehouse"), to: lead("kings-morning") },
];

interface Step { leg: string; at: Tile2; place: string; player: boolean; others: Array<{ name: string; at: Tile2; place: string }>; inView: number }

const placeOf = (at: Tile2) => regionAt(getMap("caerwyn"), at)?.name ?? "elsewhere in Caerwyn";

function walkLeg(leg: Leg): Step[] {
  const ex = newExploration(leg.story, { at: leg.from });
  const path = pathTo(ex, leg.to) ?? [];
  const steps: Step[] = [];
  const look = () => {
    const f = exploreFrame(ex, viewport);
    const front = render(f.map, f.actors, f.camera, viewport, f.options);
    const { hidden } = findHidden(front, f.map, f.actors, f.camera, viewport, f.options);
    const inView = f.actors.filter(a => a.map === f.map.id && a.kind !== "player" && matters(a) && onScreen(a, f.camera)).length;
    steps.push({
      leg: leg.name, at: { ...ex.at }, place: placeOf(ex.at), player: hidden.some(h => h.actor.kind === "player"), inView,
      others: hidden.filter(h => h.actor.kind !== "player").map(h => ({ name: h.actor.name, at: h.actor.at, place: placeOf(h.actor.at) })),
    });
  };
  const onScreen = (a: MapActor, camera: Tile2) => { const s = screenOf(a.at, camera, viewport); return s.x >= 0 && s.y >= 0 && s.x < viewport.w && s.y < viewport.h; };
  look();
  for (const [dx, dy] of path) {
    const r = move(ex, dx, dy);
    if (!r.moved || ex.map !== "caerwyn") break;
    look();
  }
  return steps;
}

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "-");
const out: string[] = [];
const say = (s = "") => { out.push(s); console.log(s); };

say(`Occlusion audit, ${viewport.w}x${viewport.h}.`);
say("\n1. The routes between the arc's places (every step, the frame as the player sees it)");
const all: Step[] = [];
for (const leg of LEGS) {
  const steps = walkLeg(leg);
  all.push(...steps);
  const me = steps.filter(s => s.player).length;
  const others = steps.filter(s => s.others.length).length;
  const sightings = steps.reduce((n, s) => n + s.inView, 0), hiddenSightings = steps.reduce((n, s) => n + s.others.length, 0);
  say(`  ${leg.name}: ${steps.length} steps. You hidden at ${me} (${pct(me, steps.length)}); someone or something else hidden at ${others} (${pct(others, steps.length)}); ${hiddenSightings} of ${sightings} sightings of people and things that matter were hidden (${pct(hiddenSightings, sightings)}).`);
}
{
  const me = all.filter(s => s.player).length, others = all.filter(s => s.others.length).length, any = all.filter(s => s.player || s.others.length).length;
  const sightings = all.reduce((n, s) => n + s.inView, 0), hiddenSightings = all.reduce((n, s) => n + s.others.length, 0);
  say(`  All routes: ${all.length} steps. You hidden at ${me} (${pct(me, all.length)}), someone else at ${others} (${pct(others, all.length)}), you or anyone at ${any} (${pct(any, all.length)}). Sightings hidden: ${hiddenSightings} of ${sightings} (${pct(hiddenSightings, sightings)}).`);
  const byPlace = new Map<string, { steps: number; hidden: number }>();
  for (const s of all) { const p = byPlace.get(s.place) ?? { steps: 0, hidden: 0 }; p.steps++; if (s.player) p.hidden++; byPlace.set(s.place, p); }
  say("  Where you're hidden on the way (steps hidden / steps walked there):");
  for (const [place, p] of [...byPlace].filter(([, p]) => p.hidden).sort((a, b) => b[1].hidden - a[1].hidden)) say(`    ${place}: ${p.hidden}/${p.steps}`);
  const whom = new Map<string, number>();
  for (const s of all) for (const o of s.others) whom.set(`${o.name} (${o.at.x},${o.at.y}, ${o.place})`, (whom.get(`${o.name} (${o.at.x},${o.at.y}, ${o.place})`) ?? 0) + 1);
  say("  Who and what is hidden from you on the way (steps):");
  for (const [w, n] of [...whom].sort((a, b) => b[1] - a[1]).slice(0, 12)) say(`    ${w}: ${n}`);
}

say("\n2. Every tile you can stand on: would you be hidden there? (you alone, the camera on you)");
const small = { w: 60, h: 20 };
const coverage: Record<string, { tiles: number; hidden: number; places: Record<string, [number, number]>; spots: string[] }> = {};
for (const id of Object.keys(MAPS)) {
  const map = getMap(id);
  const c = { tiles: 0, hidden: 0, places: {} as Record<string, [number, number]>, spots: [] as string[] };
  const hiddenAt = new Set<string>();
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const t = tileAt(map, { x, y });
    if (t.blocks || (isStructure(t) && t.terrain !== "door") || t.terrain === "void") continue;
    const me: MapActor = { id: "player", name: "you", kind: "player", glyph: "@", color: "#ffffff", map: id, at: { x, y } };
    const options = { time: "afternoon" as const };
    const front = render(map, [me], { x, y }, small, options);
    const hidden = findHidden(front, map, [me], { x, y }, small, options).hidden.length > 0;
    const place = regionAt(map, { x, y })?.name ?? `elsewhere (${map.name})`;
    const p = (c.places[place] ??= [0, 0]);
    p[1]++; c.tiles++;
    if (hidden) { p[0]++; c.hidden++; hiddenAt.add(`${x},${y}`); }
  }
  // The hidden tiles in runs (8-connected), biggest first: where on the map you go out of sight.
  const runs: Tile2[][] = [];
  const done = new Set<string>();
  for (const k of hiddenAt) {
    if (done.has(k)) continue;
    const [x0, y0] = k.split(",").map(Number) as [number, number];
    const run: Tile2[] = [], queue = [{ x: x0, y: y0 }];
    done.add(k);
    while (queue.length) {
      const p = queue.pop()!;
      run.push(p);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const n = `${p.x + dx},${p.y + dy}`;
        if (hiddenAt.has(n) && !done.has(n)) { done.add(n); queue.push({ x: p.x + dx, y: p.y + dy }); }
      }
    }
    runs.push(run);
  }
  for (const run of runs.sort((a, b) => b.length - a.length).slice(0, 6)) {
    const xs = run.map(p => p.x), ys = run.map(p => p.y);
    const names = new Map<string, number>();
    for (const p of run) { const n = regionAt(map, p)?.name ?? "outside the named places"; names.set(n, (names.get(n) ?? 0) + 1); }
    const where = [...names].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 2).join(" / ");
    c.spots.push(`${run.length} tiles at x ${Math.min(...xs)}-${Math.max(...xs)}, y ${Math.min(...ys)}-${Math.max(...ys)} (${where})`);
  }
  coverage[id] = c;
  const worst = Object.entries(c.places).filter(([, [h]]) => h).sort((a, b) => b[1][0] - a[1][0]).slice(0, 6).map(([p, [h, n]]) => `${p} ${h}/${n}`).join(", ");
  say(`  ${map.name}: hidden on ${c.hidden} of ${c.tiles} tiles (${pct(c.hidden, c.tiles)}). By place: ${worst || "nowhere"}.`);
  for (const s of c.spots) say(`    ${s}`);
}

say("\n3. Who and what the town puts where it's always hidden (static: the view never turns), by time of day");
const always: Array<{ time: string; name: string; at: Tile2; place: string }> = [];
const outside = { x: 42, y: 8 };
for (const leg of LEGS) {
  const ex = newExploration(leg.story, { at: outside });
  const f = exploreFrame(ex, viewport);
  const seen = new Set<string>();
  for (const a of f.actors) {
    if (a.kind === "player" || !matters(a) || seen.has(`${a.name}@${a.at.x},${a.at.y}`)) continue;
    // Look at it from close by (the camera on it), standing outside.
    const front = render(f.map, f.actors, a.at, viewport, f.options);
    const hidden = findHidden(front, f.map, f.actors, a.at, viewport, f.options).hidden.filter(h => h.actor.kind !== "player");
    for (const h of hidden) {
      const k = `${h.actor.name}@${h.actor.at.x},${h.actor.at.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      always.push({ time: leg.story.time, name: h.actor.name, at: h.actor.at, place: placeOf(h.actor.at) });
    }
  }
  const these = always.filter(x => x.time === leg.story.time);
  say(`  ${leg.story.time}: ${these.length ? these.map(x => `${x.name} (${x.at.x},${x.at.y}, ${x.place})`).join("; ") : "nobody"}.`);
}

say("\n4. The scenes' places as their scenes open (the scene view: roof off, every room with someone in it open)");
const scenes: Array<{ scene: string; hidden: string[] }> = [];
for (const leg of LEGS) {
  const scene = leg.story.lead!;
  const place = PLACES[scene]!;
  const ex = newExploration(leg.story, { at: leg.to });
  enterScene(ex, scene);
  const cast = [...(leg.story.played.length ? ["kell"] : []), ...place.present.filter(id => id !== "kell"), ...(scene === "hanged-clerk" ? ["kell"] : [])];
  const world = buildWorld(scene, place.world, [...new Set(cast)].map(id => ({ id, name: CAST[id]?.name ?? id })), { name: "the investigator" });
  const f = exploreFrame(ex, viewport, { world });
  const front = render(f.map, f.actors, f.camera, viewport, f.options);
  const hidden = findHidden(front, f.map, f.actors, f.camera, viewport, f.options).hidden.map(h => `${h.actor.name} (${h.actor.at.x},${h.actor.at.y}${regionAt(f.map, h.actor.at) ? `, ${regionAt(f.map, h.actor.at)!.name}` : ""})`);
  scenes.push({ scene, hidden });
  say(`  ${scene}: ${hidden.length ? hidden.join("; ") : "nobody hidden"}.`);
}

const json = flag("json");
if (json) writeFileSync(json, JSON.stringify({ viewport, routes: all, coverage, always, scenes, report: out }, null, 1));
