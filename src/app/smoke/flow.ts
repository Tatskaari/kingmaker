/**
 * Headless check of the game core (src/game/play.ts) with the real map explorer and fights, no UI:
 * walk to each lead by action ids (as the QA console does), end each scene through an exit (as
 * #end does), fight the Heron fight on the map through its action ids, and reach The End.
 * Offline (an invalid key: the GM can't speak, the hand-offs fall back to plain text) or live.
 *
 *   KM_RUNS_DIR=runs/app-test OPENROUTER_API_KEY=offline node --no-warnings src/app/smoke/flow.ts
 */
import { Game as Core } from "../../game/play.ts";
import { town, townOf } from "../../game/town.ts";
import { mapFights } from "../../game/fights.ts";
import { townText } from "../../game/views.ts";
import { joinWorld } from "../../world/scene-world.ts";
import { sceneById } from "../../../scenes/index.ts";
import { presentCast } from "../../runtime/brief.ts";

const assert = (ok: unknown, what: string) => { if (!ok) { console.error(`FAIL: ${what}`); process.exit(1); } console.log(`ok: ${what}`); };
const tolerate = async <T>(p: Promise<T>): Promise<T | undefined> => { try { return await p; } catch (error) { console.log(`   (expected offline: ${String(error instanceof Error ? error.message : error).slice(0, 90)})`); return undefined; } };
const mode = (core: Core): string => core.state.mode;
const where = (core: Core) => { const ex = townOf(core.state).ex; return `${ex.map} (${ex.at.x},${ex.at.y})${ex.scene ? ` in ${ex.scene}` : ""}`; };

/** go_to_lead until the lead scene opens (through a door, across town). */
async function walkToLead(core: Core): Promise<void> {
  for (let i = 0; i < 6 && mode(core) === "explore"; i++) {
    const said = await tolerate(core.act("go_to_lead"));
    if (said) console.log(`   > go_to_lead: ${said.split("\n")[0]!.slice(0, 140)}`);
  }
}

const fights = mapFights();
const core = await Core.create({ player: "Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier", level: 3, explorer: town, fights });
assert(core.session.rules, `character built: ${core.session.player.build ?? "(no build)"}: ${core.session.rules?.status}`);
assert(core.state.story.lead === "hanged-clerk" && core.state.story.time === "morning", "the story starts in the morning, heading for the granary");
const first = core.observe();
assert(/Caerwyn: the granary lane, morning/.test(first.text) && first.actions.some(a => a.id === "talk_kell"), "observe: the lane by the granary gate, Kell to talk to");

await walkToLead(core);
assert(mode(core) === "scene" && core.session.sceneId === "hanged-clerk", `the granary yard opens the hanged clerk (${where(core)})`);
assert(/@/.test(townText(core.state, core.session, { w: 80, h: 24 })), "the scene's place is drawn with the player in it");

// The granary ends; the afternoon interlude is the map; the Rat is the lead, in the evening.
await tolerate(core.endScene("open-case"));
assert(mode(core) === "explore" && core.session.sceneId === "drowned-rat" && core.state.story.time === "evening", `on to the Drowned Rat at dusk (${where(core)})`);
assert(townOf(core.state).ex.followers.some(f => f.id === "kell"), "Kell walks with the investigator");
await walkToLead(core);
assert(mode(core) === "scene" && core.session.sceneId === "drowned-rat", `down the river stairs and into the Rat (${where(core)})`);
await tolerate(core.endScene("hobb-talks"));
assert(mode(core) === "explore" && core.session.sceneId === "heron-warehouse" && core.state.story.time === "night", `on to the Heron at night (${where(core)})`);

// The Heron: Sallow comes at midnight with his Crakes, and it ends in a fight.
await walkToLead(core);
assert(mode(core) === "scene" && core.session.sceneId === "heron-warehouse", `along the wharf to the Heron (${where(core)})`);
const heron = sceneById("heron-warehouse");
core.session.entered = [...(core.session.entered ?? []), "sallow"];
core.session.established.push("Master Sallow has come to the Heron.");
if (core.session.world) joinWorld(core.session.world, presentCast(heron, core.session).map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), core.session.turn);
await tolerate(core.endScene("fight"));
assert(mode(core) === "combat", "Roll for initiative!");
let o = core.observe();
console.log(o.text.split("\n").slice(-26).join("\n"));
assert(/Sallow|Master/.test(o.text) && /Crake/.test(o.text), "Sallow and the Crakes are in the fight");
for (let i = 0; i < 200 && mode(core) === "combat"; i++) {
  o = core.observe();
  const pick = o.actions.find(a => a.id === "continue") ?? o.actions.find(a => a.id.startsWith("attack_crake")) ?? o.actions.find(a => a.id.startsWith("attack_")) ?? o.actions.find(a => a.id === "auto");
  if (pick?.id === "continue") console.log(`   ${o.text.split("\n").filter(l => /^How it went|^The fight is over/.test(l)).join("\n   ")}`);
  if (!pick) { console.log(o.text.split("\n").slice(-6).join("\n")); break; }
  const said = await tolerate(core.act(pick.id));
  if (i % 4 === 0 && said) console.log(`   > ${pick.id}: ${said.split("\n").filter(Boolean).slice(-2).join(" / ").slice(0, 160)}`);
}
assert(mode(core) === "scene" && core.session.fought?.includes("fight"), "after the fight, back to the Heron for its aftermath");
console.log(`   ${core.session.established.find(e => e.startsWith("The fight is over"))}`);

// The aftermath ends; the King's morning is a summons: it opens straight away.
await tolerate(core.endScene("caught-in-the-act"));
assert(core.session.sceneId === "kings-morning" && mode(core) === "scene", `the King's morning opens straight away (${where(core)})`);
await tolerate(core.endScene("justice"));
assert(mode(core) === "end", "The End");
assert(core.observe().text.includes("The End"), "observe says The End");
console.log(`session ${core.state.id}`);
