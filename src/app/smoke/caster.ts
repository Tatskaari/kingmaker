/**
 * Casting in a fight, headless: a caster built live by the rules engine casts at the Crakes through
 * the combat adapter (the stand-in resolves it with src/rules/dnd.ts castSpell). Needs the API key
 * for the character build (offline the build falls back to a rogue, who has no spells).
 *
 *   KM_RUNS_DIR=runs/app-test node --no-warnings src/app/smoke/caster.ts
 */
import { forceEnding } from "../../runtime/engine.ts";
import { combat, maps } from "../adapters.ts";
import { combatSetup, moveOn, newGame } from "../story.ts";

const session = await newGame("Pell Marrow", "a Nine Furrows hedge-wizard with a scorched hat, a head full of cantrips and no sense of self-preservation");
console.log(`${session.player.name}: ${session.player.build} — ${session.rules?.status}`);
session.sceneId = "heron-warehouse";
session.beat = "wharf";
session.entered = ["sallow"];
forceEnding(session, "fight");
const onward = await moveOn(session);
if (onward.kind !== "combat") throw new Error(`expected a fight, got ${onward.kind}`);
const fight = await combat.start(combatSetup(session, maps.combatField(session.sceneId)), session);
const options = await fight.options();
console.log(`spells: ${options.spells.map(s => `${s.name} (${s.level || "cantrip"})`).join(", ") || "none"}`);
const spell = options.spells.find(s => s.level === 0 && /bolt|ray|spray|blade|frost|fire|sacred|eldritch|vicious/i.test(s.name)) ?? options.spells.find(s => s.level > 0) ?? options.spells[0];
for (let i = 0; i < 60 && !fight.result(); i++) {
  const view = fight.view();
  if (view.current !== "player") { await fight.advance(); continue; }
  const target = (await fight.options()).targets.find(t => t.side === "enemy");
  if (!spell || !target) break;
  const lines = view.actionUsed ? await fight.act({ kind: "end" }) : await fight.act({ kind: "cast", spell: spell.id, target: target.id });
  for (const line of lines) console.log(`  ${line}`);
}
console.log(fight.view().log.slice(-6).map(l => `  | ${l}`).join("\n"));
console.log(`result: ${fight.result()?.summary ?? "(not over)"}`);
