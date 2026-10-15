/**
 * Casting in a fight, headless: a wizard (a pregen, no model calls; or built live with --live) casts
 * at the Crakes in the Heron through the fight's action ids, on the map's own Heron with everyone
 * where its world has them (src/game/fights.ts). Fire in the grain dust is the interesting part.
 *
 *   KM_RUNS_DIR=runs/app-test node --no-warnings src/app/smoke/caster.ts [--live]
 */
import { sceneById } from "../../../scenes/index.ts";
import { pregenSession } from "../../game/combat/pregen.ts";
import { mapFights } from "../../game/fights.ts";
import type { GameState } from "../../game/play.ts";
import { presentCast } from "../../runtime/brief.ts";
import { createSession, forceEnding } from "../../runtime/engine.ts";
import { buildWorld, joinWorld } from "../../world/scene-world.ts";

const session = process.argv.includes("--live")
  ? await createSession({ sceneId: "heron-warehouse", approach: "v2", player: "Pell Marrow: a Nine Furrows hedge-wizard with a scorched hat, a head full of cantrips and no sense of self-preservation", level: 3 })
  : await pregenSession({ pregen: "wizard", level: 3, seed: 4, name: "Fennick Quill" });
console.log(`${session.player.name}: ${session.player.build}: ${session.rules?.status}`);
Object.assign(session, { sceneId: "heron-warehouse", beat: "midnight", entered: ["sallow"] });
session.established.push("Master Sallow has come to the Heron.");
const scene = sceneById("heron-warehouse");
const cast = presentCast(scene, session);
session.world = buildWorld(scene.id, scene.world!, cast.map(c => ({ id: c.id, name: c.name })), session.player);
joinWorld(session.world, cast.map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), 0);
forceEnding(session, "fight");

const game: GameState = { version: 1, id: session.id, mode: "combat", story: { time: "night", played: [], flags: {} }, explore: {}, recent: [] };
const fight = await mapFights().start(game, session);
let cast_ = 0;
for (let i = 0; i < 80 && !fight.result(); i++) {
  const actions = fight.actions();
  const spell = actions.find(a => /^cast_(fire-bolt|ray-of-frost|magic-missile|scorching-ray|burning-hands|shocking-grasp|sacred-flame|eldritch-blast)_/.test(a.id) && /crake|sallow/.test(a.id));
  const pick = spell ?? actions.find(a => a.id === "auto") ?? actions.find(a => a.id === "end_turn");
  if (!pick) break;
  if (spell) cast_++;
  const said = await fight.act(pick.id);
  console.log(`> ${pick.id}\n${said.split("\n").filter(Boolean).slice(0, 6).map(l => `  ${l}`).join("\n")}`);
}
console.log(`\nspells cast by id: ${cast_}`);
console.log(`result: ${fight.result()?.summary ?? "(not over)"}`);
if (!cast_) { console.error("FAIL: no spell was cast through an action id"); process.exit(1); }
