/**
 * Does OpenTUI draw a fight exactly as the map renders it (marks, the target cursor, the fire)? A
 * Heron fight on the map, three turns of it, each frame drawn through MapView and compared with the
 * plain text: a glyph OpenTUI measures as wide would push the rest of its line over.
 *
 *   KM_RUNS_DIR=runs/check node --experimental-ffi --no-warnings --import tsx src/game/views-check.tsx
 */
import { testRender } from "@opentui/react/test-utils";
import { sceneById } from "../../scenes/index.ts";
import { pregenSession } from "./combat/pregen.ts";
import { mapFights } from "./fights.ts";
import { TacticalFight } from "./combat/index.ts";
import { toPlain } from "./map/index.ts";
import { MapView } from "./map/view.tsx";
import type { GameState } from "./play.ts";
import { fightView } from "./views.ts";
import { presentCast } from "../runtime/brief.ts";
import { forceEnding } from "../runtime/engine.ts";
import { buildWorld, joinWorld } from "../world/scene-world.ts";

const session = await pregenSession({ pregen: "fighter", level: 3, seed: 2 });
Object.assign(session, { sceneId: "heron-warehouse", beat: "midnight", entered: ["sallow"] });
session.established.push("Master Sallow has come to the Heron.");
const scene = sceneById("heron-warehouse");
const cast = presentCast(scene, session);
session.world = buildWorld(scene.id, scene.world!, cast.map(c => ({ id: c.id, name: c.name })), session.player);
joinWorld(session.world, cast.map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), 0);
forceEnding(session, "fight");
const game: GameState = { version: 1, id: "x", mode: "combat", story: { time: "night", played: [], flags: {} }, explore: {}, recent: [] };
const fight = (await mapFights().start(game, session)) as TacticalFight;
const size = { w: 84, h: 26 };
for (let i = 0; i < 3; i++) {
  const G = fight.controller.state();
  const lines = fightView(fight.controller, session, size, { marks: fight.controller.options().moves.map(at => ({ at, color: "#2f6fb0" })), cursor: Object.values(G.units).find(u => u.side === "enemy")!.at });
  const setup = await testRender(<MapView lines={lines} />, { width: size.w, height: size.h });
  await setup.renderOnce();
  const drawn = setup.captureCharFrame().split("\n");
  const differ = toPlain(lines).split("\n").filter((line, j) => line.trimEnd() !== (drawn[j] ?? "").trimEnd());
  console.log(`frame ${i}: ${differ.length ? `${differ.length} lines differ` : "drawn exactly"}`);
  if (i === 0 && process.argv.includes("--show")) console.log(toPlain(lines));
  await setup.dispose();
  await fight.act("auto");
}
process.exit(0);
