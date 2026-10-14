/**
 * Headless check of the app's Explorer and FightFactory under the game core (src/game/play.ts),
 * with no terminal UI: walk to Kell by action ids, end each scene (as #end does), fight the
 * stand-in fight through its action ids, and reach The End. Offline (an invalid key: the GM can't
 * speak, the hand-offs fall back to plain text) or live.
 *
 *   KM_RUNS_DIR=runs/app-test OPENROUTER_API_KEY=offline node --no-warnings src/app/smoke/flow.ts
 */
import { Game as Core } from "../../game/play.ts";
import { forceEnding, type TurnHooks } from "../../runtime/engine.ts";
import { combat, maps } from "../adapters.ts";
import { mapExplorer } from "../explorer.ts";
import { tacticalFights } from "../fights.ts";

const assert = (ok: unknown, what: string) => { if (!ok) { console.error(`FAIL: ${what}`); process.exit(1); } console.log(`ok: ${what}`); };
const tolerate = async (p: Promise<unknown>) => { try { await p; } catch (error) { console.log(`   (expected offline: ${String(error instanceof Error ? error.message : error).slice(0, 80)})`); } };
const mode = (core: Core): string => core.state.mode;
const afterScene = (core: Core, hooks: TurnHooks = {}) => (core as unknown as { afterScene(h: TurnHooks): Promise<string> }).afterScene(hooks);

const explorer = mapExplorer(maps);
const fights = tacticalFights(combat, maps);
const core = await Core.create({ player: "Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier", level: 3, explorer, fights });
assert(core.session.rules, `character built: ${core.session.player.build ?? "(no build)"} — ${core.session.rules?.status}`);
assert(core.state.story.lead === "hanged-clerk" && core.state.story.time === "morning", "the story starts in the morning, heading for the granary");

// Explore by action ids, as the QA console would.
await core.act("go_north");
await core.act("go_north");
const talk = core.observe().actions.find(a => a.id === "talk_kell");
assert(talk, `Kell is in reach at the gate: ${core.observe().actions.slice(0, 4).map(a => a.id).join(", ")}`);
console.log(`   observe: ${core.observe().text.split("\n").join(" | ")}`);
await tolerate(core.act("talk_kell"));
assert(core.state.mode === "scene" && core.session.sceneId === "hanged-clerk", "talking to Kell opens the hanged clerk");

// The granary ends; the afternoon interlude is skipped; the Rat is the lead, in the evening.
forceEnding(core.session, "case-made");
await afterScene(core);
assert(core.state.mode === "explore" && core.session.sceneId === "drowned-rat" && core.state.story.time === "evening", `on to ${core.session.sceneId}, ${core.state.story.time}`);
assert(maps.regionAt(explorer.position(core.state).map, explorer.position(core.state).at)?.sceneId !== "hanged-clerk", "back outside the yard");
for (const id of ["go_east", "go_east", "go_east", "go_east", "go_east", "go_east", "go_south", "go_south", "go_south", "go_south", "go_south", "go_south", "go_south", "go_south", "go_south", "go_east"]) await core.act(id);
assert(core.observe().actions.some(a => a.id === "enter_rat_door"), "at the Rat's door");
await tolerate(core.act("enter_rat_door"));
forceEnding(core.session, "hobb-talks");
await afterScene(core);
assert(core.session.sceneId === "heron-warehouse" && core.state.story.time === "night", `on to ${core.session.sceneId}`);

// The Heron ends in a fight with Sallow there: his members come from his cast card.
core.state.mode = "scene";
core.session.entered = ["sallow"];
forceEnding(core.session, "fight");
await afterScene(core);
assert(mode(core) === "combat" && fights.current, "the Heron ends in a fight");
const setup = fights.current!.setup;
console.log(`   combatants: ${setup.combatants.map(c => `${c.name} [${c.side}]`).join(", ")}`);
assert(setup.combatants.some(c => c.id === "crake-1" && c.side === "enemy") && setup.combatants.some(c => c.id === "kell" && c.side === "ally") && setup.combatants.some(c => c.id === "lantern-boy" && c.side === "neutral"), "the Crakes fight for Sallow, the lantern-boy keeps out of it, Kell is an ally");
for (let i = 0; i < 600 && mode(core) === "combat"; i++) {
  const actions = core.observe().actions;
  const pick = actions.find(a => a.id === "continue") ?? actions.find(a => a.id.startsWith("attack_crake")) ?? actions.find(a => a.id.startsWith("attack_"))
    ?? (actions.some(a => a.id === "go_s") && i % 3 !== 2 ? actions.find(a => a.id === "go_s" || a.id === "go_se") : undefined) ?? actions.find(a => a.id === "end_turn");
  if (!pick) break;
  if (pick.id === "continue") { console.log(`   ${core.observe().text.split("\n").at(-1)}`); await tolerate(core.act("continue")); break; }
  if (i % 25 === 0) console.log(`   [${i}] ${pick.id} | ${core.observe().text.split("\n").at(-1)}`);
  await tolerate(core.act(pick.id));
}
assert(mode(core) === "scene" && core.session.fought?.includes("fight"), "after the fight, back to the Heron for the aftermath");

// The aftermath ends; the King's morning is a summons: it opens straight away.
forceEnding(core.session, "caught-in-the-act");
await tolerate(afterScene(core));
assert(core.session.sceneId === "kings-morning" && mode(core) === "scene", "the King's morning opens straight away (a summons)");
forceEnding(core.session, "justice");
await afterScene(core);
assert(mode(core) === "end", "The End");
core.save();
console.log(`session ${core.state.id}`);
