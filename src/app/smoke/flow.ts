/**
 * Headless check of the story flow and the stand-ins, with no terminal UI: walk to Kell, force each
 * scene's ending, chain on (skipping the interludes), fight the stand-in fight to the end, and reach
 * The End. Run offline (no API key: the hand-offs fall back to plain text) or live.
 *
 *   KM_RUNS_DIR=runs/app-test node --no-warnings src/app/smoke/flow.ts
 */
import { forceEnding } from "../../runtime/engine.ts";
import { combat, maps, type Dir, type Position } from "../adapters.ts";
import { chebyshev } from "../geometry.ts";
import { combatSetup, epilogue, moveOn, newGame, storyOf } from "../story.ts";

const assert = (ok: unknown, what: string) => { if (!ok) { console.error(`FAIL: ${what}`); process.exit(1); } console.log(`ok: ${what}`); };

const session = await newGame("Tamsin Vell", "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier");
assert(session.rules, `character built: ${session.player.build ?? "(no build)"} — ${session.rules?.status}`);

// Explore: from the lane, walk north to the yard gate and find Kell.
let pos: Position = maps.start();
const story = storyOf(session);
assert(story.lead === "hanged-clerk" && story.time === "morning", "the story starts in the morning, heading for the granary");
const actors = maps.actors(pos.map, story);
const walk = (dir: Dir) => { const r = maps.step(pos, dir, actors, story); pos = r.pos; return r; };
walk("n");
walk("n");
const kell = maps.reachable(pos, actors).find(a => a.id === "kell");
assert(kell?.interaction?.kind === "scene" && kell.interaction.sceneId === "hanged-clerk", `Kell is in reach at the gate (${pos.at.x},${pos.at.y})`);
const into = walk("n");
assert(into.trigger?.kind === "scene" && into.trigger.sceneId === "hanged-clerk", "stepping into the yard opens the hanged clerk");

// The granary ends; the afternoon interlude is skipped; the Rat is the lead, in the evening.
forceEnding(session, "case-made");
let onward = await moveOn(session);
assert(onward.kind === "scene" && session.sceneId === "drowned-rat", `on to ${session.sceneId} (skipped: ${onward.kind === "scene" ? onward.skipped.join(", ") || "none" : "-"})`);
assert(storyOf(session).time === "evening", "it's evening");
pos = maps.afterScene("hanged-clerk", pos);
assert(maps.regionAt(pos.map, pos.at)?.sceneId !== "hanged-clerk", "back outside the yard");

forceEnding(session, "hobb-talks");
onward = await moveOn(session);
assert(onward.kind === "scene" && session.sceneId === "heron-warehouse", `on to ${session.sceneId}`);

// The Heron ends in a fight with Sallow there.
session.entered = ["sallow"];
forceEnding(session, "fight");
onward = await moveOn(session);
assert(onward.kind === "combat", "the Heron ends in a fight");
const setup = combatSetup(session, maps.combatField(session.sceneId));
console.log(`   combatants: ${setup.combatants.map(c => `${c.name} [${c.side}]`).join(", ")}`);
assert(setup.combatants.some(c => c.id === "crake-1") && setup.combatants.some(c => c.id === "kell" && c.side === "ally"), "Sallow's group expands into the Crakes; Kell is an ally");
const fight = await combat.start(setup, session);
for (let i = 0; i < 400 && !fight.result(); i++) {
  const view = fight.view();
  if (view.current !== "player") { for (const line of await fight.advance()) console.log(`   ${line}`); continue; }
  const options = await fight.options();
  const target = options.targets.find(t => t.side === "enemy" && t.name.startsWith("Crake")) ?? options.targets.find(t => t.side === "enemy");
  if (!target) break;
  const me = view.order.find(o => o.id === "player")!;
  const them = view.order.find(o => o.id === target.id)!;
  if (!target.inReach && view.movementLeft >= 5) {
    const dx = Math.sign(them.at.x - me.at.x), dy = Math.sign(them.at.y - me.at.y);
    const dir = (dy < 0 ? "n" : dy > 0 ? "s" : "") + (dx < 0 ? "w" : dx > 0 ? "e" : "") as Dir;
    const before = chebyshev(me.at, them.at);
    await fight.act({ kind: "move", dir });
    const after = fight.view().order.find(o => o.id === "player")!;
    if (chebyshev(after.at, them.at) < before) continue;
  }
  const lines = target.inReach && !view.actionUsed ? await fight.act({ kind: "attack", target: target.id }) : await fight.act({ kind: "end" });
  for (const line of lines) console.log(`   ${line}`);
}
const result = fight.result();
assert(result, `the fight ends: ${result?.outcome} — ${result?.summary}`);

onward = await moveOn(session, result!.summary);
assert(onward.kind === "scene" && session.sceneId === "kings-morning" && storyOf(session).time === "next-morning", "on to the King's morning");
forceEnding(session, "justice");
onward = await moveOn(session);
assert(onward.kind === "end", "The End");
const end = epilogue(session);
console.log(`   chapters: ${end.chapters.map(c => `${c.title}: ${c.ending}`).join(" | ")}`);
assert(end.chapters.length === 4, "four chapters in the epilogue");
console.log(`session ${session.id} (spent $${end.spentUsd.toFixed(4)})`);
