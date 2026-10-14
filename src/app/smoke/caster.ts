/**
 * Casting in a fight, headless: a caster built live by the rules engine casts at the Crakes through
 * the fight's action ids (the stand-in resolves it with src/rules/dnd.ts castSpell). Needs the API
 * key for the character build (offline the build falls back to a rogue, who has no spells).
 *
 *   KM_RUNS_DIR=runs/app-test node --no-warnings src/app/smoke/caster.ts
 */
import { Game as Core } from "../../game/play.ts";
import { forceEnding, type TurnHooks } from "../../runtime/engine.ts";
import { combat, maps } from "../adapters.ts";
import { mapExplorer } from "../explorer.ts";
import { tacticalFights } from "../fights.ts";

const fights = tacticalFights(combat, maps);
const core = await Core.create({ player: "Pell Marrow: a Nine Furrows hedge-wizard with a scorched hat, a head full of cantrips and no sense of self-preservation", level: 3, explorer: mapExplorer(maps), fights });
console.log(`${core.session.player.name}: ${core.session.player.build} — ${core.session.rules?.status}`);
Object.assign(core.session, { sceneId: "heron-warehouse", beat: "wharf", entered: ["sallow"] });
core.state.mode = "scene";
forceEnding(core.session, "fight");
await (core as unknown as { afterScene(h: TurnHooks): Promise<string> }).afterScene({});
if ((core.state.mode as string) !== "combat") throw new Error(`expected a fight, got ${core.state.mode}`);
for (let i = 0; i < 80 && (core.state.mode as string) === "combat"; i++) {
  const actions = core.observe().actions;
  const cast = actions.find(a => /^cast_(fire-bolt|ray-of-frost|shocking-grasp|sacred-flame|eldritch-blast)@/.test(a.id)) ?? actions.find(a => a.id.startsWith("cast_") && !/druidcraft|prestidigitation|mage-hand|guidance|light/.test(a.id));
  const pick = actions.find(a => a.id === "continue") ?? cast ?? actions.find(a => a.id === "end_turn");
  if (!pick) break;
  if (pick.id === "continue") { console.log(core.observe().text.split("\n").slice(-4).join("\n")); break; }
  const said = await core.act(pick.id);
  if (said) console.log(`> ${pick.id}\n${said.split("\n").map(l => `  ${l}`).join("\n")}`);
}
console.log(`result: ${fights.current?.result()?.summary ?? "(not over)"}`);
