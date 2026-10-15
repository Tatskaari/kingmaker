/**
 * Headless frames of the game's own views with the look wired in (src/game/views.ts): the town as
 * you walk it, a scene's place on the map and from above (the stage), and a fight on its
 * battlefield, on the real scene worlds with the real physics. For looking at, and for anyone
 * without a terminal to hand:
 *
 *   node --no-warnings src/game/look/frames.ts                    # every frame, into runs/look-wire
 *   node --no-warnings src/game/look/frames.ts --out runs/x --w 120 --h 40 --glyphs nerd
 *
 * Each frame is written three ways: .ansi (24-bit colour: `cat` it in a terminal), .txt (the
 * characters) and .json (every cell as [glyph, fg, bg, bold], for tools that rasterize frames).
 * Frames are exact: the same command writes the same files. The model is never called.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyOps, buildWorld, damageThing, positionOf, type SceneWorld, type WorldOp } from "../../world/scene-world.ts";
import { douse } from "../../world/systems.ts";
import { drownedRatWorld } from "../../../scenes/worlds/drowned-rat.ts";
import { hangedClerkWorld } from "../../../scenes/worlds/hanged-clerk.ts";
import { dressingRoomWorld } from "../../../scenes/worlds/kings-morning.ts";
import { heronWorld } from "../../../scenes/worlds/heron-warehouse.ts";
import type { SessionState } from "../../runtime/session.ts";
import type { StyledLine } from "../types.ts";
import { CAST, enterScene, newExploration, regionForScene, renderExplore, tileToFeet, toAnsi, toPlain, type ExploreState } from "../map/index.ts";
import type { Canvas } from "./canvas.ts";
import { Director } from "./director.ts";
import { Effects } from "./effects.ts";
import type { GlyphSet } from "./glyphs.ts";

process.env.KM_LOOK_MODEL ??= "off";
const { stageView, fightView } = await import("../views.ts");

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const out = flag("out") ?? "runs/look-wire";
const size = { w: Number(flag("w") ?? 120), h: Number(flag("h") ?? 40) };
const glyphs = (flag("glyphs") ?? "ascii") as GlyphSet;
mkdirSync(out, { recursive: true });

const written: string[] = [];
/** A frame, three ways. */
function save(name: string, frame: StyledLine[] | Canvas, note: string): void {
  const lines = Array.isArray(frame) ? frame : frame.toLines();
  const cells = lines.map(line => line.flatMap(s => [...s.text].map(ch => [ch, s.fg ?? "", s.bg ?? "", !!s.bold])));
  writeFileSync(join(out, `${name}.ansi`), `${toAnsi(lines)}\n`);
  writeFileSync(join(out, `${name}.txt`), `${toPlain(lines)}\n`);
  writeFileSync(join(out, `${name}.json`), JSON.stringify({ w: Math.max(...cells.map(r => r.length)), h: cells.length, cells: cells.flat() }));
  written.push(`${name.padEnd(30)} ${note}`);
}

const people = (ids: string[]) => ids.map(id => ({ id, name: CAST[id]!.name }));
const op = (o: Partial<WorldOp> & { op: WorldOp["op"] }): WorldOp => ({ what: "", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [], ...o });
const inScene = (sceneId: string, story: ExploreState["story"]) => { const ex = newExploration(story); enterScene(ex, sceneId); return ex; };
const session = (world: SceneWorld) => ({ sceneId: world.scene, world }) as unknown as SessionState;
const DUSK = { time: "evening" as const, played: ["hanged-clerk"], lead: "drowned-rat", flags: {} };
const NIGHT = { time: "night" as const, played: ["hanged-clerk"], lead: "drowned-rat", flags: {} };

// The granary lane in the morning, and the town at night.
const lane = newExploration({ time: "morning", played: [], lead: "hanged-clerk", flags: {} });
save("lane-morning", renderExplore(lane, size, { t: 2400, glyphs }), "the granary lane, morning: Kell waits inside the gate, the elm over the wall");
save("lane-morning-plain-text", renderExplore(lane, { w: 80, h: 24 }, { color: false }), "the same, as the QA console reads it (townText: plain, quiet, single-width)");
save("town-night", renderExplore(newExploration({ time: "night", played: ["hanged-clerk", "drowned-rat"], lead: "heron-warehouse", flags: {} }, { at: { x: 30, y: 30 } }), size, { t: 2400, glyphs }), "the market square at night: lamplight, lit windows, the lead's arrow");

// The Drowned Rat at night with its blue driftwood fire.
const ratWorld = buildWorld("drowned-rat", drownedRatWorld, people(["kell", "nan-quill", "arlo", "dilly", "hobb", "cob"]), { name: "you" });
const rat = inScene("drowned-rat", NIGHT);
save("rat-night-map", renderExplore(rat, size, { world: ratWorld, t: 2400, glyphs }), "the Rat at night on the map (#map): the driftwood fire lights the fireside blue");
save("rat-night-stage", stageView(session(ratWorld), size, { t: 2400, time: "night", glyphs })!, "the Rat at night from above (the scene's place beside the transcript)");

// A table set burning in the Rat: two frames half a second apart, then doused.
const fx = new Effects({ now: () => 0, seed: 5 });
const director = new Director(fx);
director.prime(ratWorld);
applyOps(ratWorld, [op({ op: "create", name: "a guttering candle", kind: "item", to: "long-table", how: "in", add: ["lit"] })], 1, "stage");
const lines = damageThing(ratWorld, ratWorld.entities["long-table"]!, 3, "fire", 1);
director.rulesLines(ratWorld, lines, 2000);
director.observe(ratWorld, 2000);
fx.bark("regulars", "FIRE!", {}, 2100);
for (const t of [2600, 3100]) {
  save(`rat-burning-${t}-map`, renderExplore(rat, size, { world: ratWorld, t, glyphs, effects: { region: ratRegion(), frame: fx.frame(t, id => positionOf(ratWorld, id)) } }), `the long table alight on the map, at ${t} ms (the next frame is 500 ms on)`);
  save(`rat-burning-${t}-stage`, stageView(session(ratWorld), size, { t, time: "night", glyphs, effects: fx, positions: id => director.tweens.at(id, t) })!, `the long table alight from above, at ${t} ms`);
}
director.rulesLines(ratWorld, douse(ratWorld, ratWorld.entities["long-table"]!, 2), 6000);
director.observe(ratWorld, 6000);
save("rat-doused-map", renderExplore(inScene("drowned-rat", DUSK), size, { world: ratWorld, t: 6400, glyphs, effects: { region: ratRegion(), frame: fx.frame(6400, id => positionOf(ratWorld, id)) } }), "doused, in the evening: scorched and wet, standing in a puddle, a puff of steam");
save("rat-doused-stage", stageView(session(ratWorld), size, { t: 6400, time: "evening", glyphs, effects: fx })!, "doused, from above");
save("rat-puddle-stage", stageView(session(ratWorld), size, { t: 12000, time: "evening", glyphs, effects: fx })!, "the puddle when the steam has gone");

// The granary yard in the morning, from above, and the King's dressing room.
const yard = buildWorld("hanged-clerk", hangedClerkWorld, people(["kell", "cob", "moll"]), { name: "you" });
save("yard-morning-stage", stageView(session(yard), size, { t: 2400, time: "morning", glyphs })!, "the yard behind the King's Granary from above: puddles from the night's rain, the elm");
save("yard-morning-map", renderExplore(inScene("hanged-clerk", { time: "morning", played: [], lead: "hanged-clerk", flags: {} }), size, { world: yard, t: 2400, glyphs }), "the yard on the map (#map)");
const king = buildWorld("kings-morning", dressingRoomWorld, people(["kell", "king", "holt"]), { name: "you" });
save("king-stage", stageView(session(king), size, { t: 2400, time: "next-morning", glyphs })!, "the King's dressing room from above, the next morning");

// The Heron at night, its floor thick with dust: from above (its new dressing) and on the map.
const heron = buildWorld("heron-warehouse", heronWorld, people(["kell", "saul", "hep", "scrope", "hobb"]), { name: "you" });
save("heron-night-stage", stageView(session(heron), size, { t: 2400, time: "night", glyphs })!, "the Heron at night from above: the dusty floor, braziers and lanterns, the river, the Patience");
save("heron-night-map", renderExplore(inScene("heron-warehouse", { time: "night", played: ["hanged-clerk", "drowned-rat"], lead: "heron-warehouse", flags: {} }), size, { world: heron, t: 2400, glyphs }), "the Heron at night on the map (#map): dust hangs over the floor");

await heronFight();
writeFileSync(join(out, "index.txt"), `${written.join("\n")}\n`);
process.stdout.write(`${written.length} frames in ${out}:\n${written.map(w => `  ${w}`).join("\n")}\n`);

function ratRegion() { return regionForScene("drowned-rat")!.region; }

/**
 * The Heron fight on its battlefield: the dust over the floor and a fire where Saul's brazier went
 * over on the wharf; then the dust gone up (an explosion), the floor scorched and the sacks burning.
 * The fight is the real one, set up from the scene's world; its dust and fire are set for the picture.
 */
async function heronFight(): Promise<void> {
  const { pregenSession } = await import("../combat/pregen.ts");
  const { mapFights } = await import("../fights.ts");
  const { forceEnding } = await import("../../runtime/engine.ts");
  const { presentCast } = await import("../../runtime/brief.ts");
  const { joinWorld } = await import("../../world/scene-world.ts");
  const { sceneById } = await import("../../../scenes/index.ts");
  const { TacticalFight } = await import("../combat/index.ts");
  const s = await pregenSession({ pregen: "wizard", level: 3, seed: 3 });
  Object.assign(s, { sceneId: "heron-warehouse", beat: "midnight", entered: ["sallow"] });
  s.established.push("Master Sallow has come to the Heron.");
  const scene = sceneById("heron-warehouse");
  const cast = presentCast(scene, s);
  s.world = buildWorld(scene.id, scene.world!, cast.map(c => ({ id: c.id, name: c.name })), s.player);
  joinWorld(s.world, cast.map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), 0);
  applyOps(s.world, [op({ op: "move", what: "player", to: "floor" }), op({ op: "move", what: "kell", to: "floor" })], 1);
  forceEnding(s, "fight");
  const fights = mapFights();
  fights.pace = async () => {};
  const fight = await fights.start({ version: 1, id: "frames", mode: "combat", story: { time: "night", played: [], flags: {} }, explore: {}, recent: [] }, s);
  if (!(fight instanceof TacticalFight)) return;
  const c = fight.controller;
  const G = c.state();
  const staged = (dust: string[], fire: string[]) => {
    const tiles = (ks: string[]) => ks.map(k => { const [x, y] = k.split(",").map(Number); return { x: x!, y: y! }; });
    const view = c.view();
    const flags = dust.length ? G.flags : { ...G.flags, dust_exploded: true };
    return { ...c, state: () => ({ ...G, dust, fire, flags }), view: () => ({ ...view, hazards: { dust: tiles(dust), fire: tiles(fire) } }) } as typeof c;
  };
  const wharf = ["6,4", "7,3", "6,3", "5,4"];
  save("heron-fight-dust-fire", fightView(staged(G.dust, wharf), s, size, { t: 2400, time: "night", glyphs }), "the Heron fight: the dust over the floor, fire on the wharf where the brazier went over");
  const fx = new Effects({ now: () => 0, seed: 9 });
  const region = G.map.regions.find(r => r.worldOrigin)!;
  const dust = G.dust.map(k => { const [x, y] = k.split(",").map(Number); return tileToFeet(region, { x: x!, y: y! }); });
  fx.effect("explosion", { at: { x: dust.reduce((a, p) => a + p.x, 0) / dust.length, y: dust.reduce((a, p) => a + p.y, 0) / dust.length }, radius: 30 }, 2000);
  save("heron-fight-explosion", fightView(staged([], [...G.fuel, ...wharf]), s, size, { t: 2350, time: "night", glyphs, effects: fx }), "the dust goes up: the explosion, 350 ms in");
  save("heron-fight-burning", fightView(staged([], [...G.fuel, ...wharf]), s, size, { t: 9000, time: "night", glyphs }), "after: the sacks burning, the floor scorched");
}
