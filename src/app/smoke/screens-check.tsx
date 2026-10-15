/**
 * The map, the fight, the title and the End, drawn by the real screens and played with the mouse,
 * no model calls (a ready-made character offline): the map's and the fight's side panels at 80x24
 * and up, every line drawn whole (a squeezed panel draws its lines over each other); the map's keys
 * at the bottom as buttons; a click on a blue tile moves there, a click on someone on the other side
 * aims at them and a click on your target attacks, and the fight's options are buttons; the title's
 * New game and Continue, and the End's way back, by a click.
 *
 *   KM_RUNS_DIR=runs/check OPENROUTER_API_KEY=offline node --experimental-ffi --no-warnings --import tsx src/app/smoke/screens-check.tsx [--show]
 */
import { MouseButton } from "@opentui/core";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { sceneById } from "../../../scenes/index.ts";
import { pregenSession, PREGENS, TacticalFight } from "../../game/combat/index.ts";
import { mapFights } from "../../game/fights.ts";
import { registerLookCanvas } from "../../game/look/opentui.ts";
import { leadTarget, town } from "../../game/town.ts";
import { Game as Core, type GameState } from "../../game/play.ts";
import { exploreState } from "../../game/town.ts";
import { actorsHere, nearby, Picks, screenOf } from "../../game/map/index.ts";
import { fightView, townView } from "../../game/views.ts";
import { presentCast } from "../../runtime/brief.ts";
import { forceEnding } from "../../runtime/engine.ts";
import { buildWorld, joinWorld } from "../../world/scene-world.ts";
import { entriesOf, Game } from "../game.ts";
import type { Resumable } from "../save.ts";
import { leadWay, TIME_WORDS } from "../story.ts";
import { wrap } from "../ui/common.tsx";
import { CombatScreen } from "../ui/combat.tsx";
import { EndScreen } from "../ui/end.tsx";
import { ExploreScreen } from "../ui/explore.tsx";
import { TitleScreen } from "../ui/title.tsx";

process.env.KM_GLYPHS ??= "ascii";
registerLookCanvas();
const show = process.argv.includes("--show");
const checks: Array<[string, boolean]> = [];
const flat = (t: string) => t.replace(/\s+/g, " ");

/** The middle of some text on screen, in cells (wide characters taking two); undefined when it isn't there. */
function at(frame: string, text: string): { x: number; y: number } | undefined {
  const rows = frame.split("\n");
  const y = rows.findIndex(r => r.includes(text));
  if (y < 0) return undefined;
  return { x: [...rows[y]!].join("").indexOf(text) + Math.floor(text.length / 2), y };
}

/** The rows of the box whose title is `title` (between its sides), as plain text. */
function panel(frame: string, title: string): string[] {
  const rows = frame.split("\n");
  const top = rows.findIndex(r => r.includes(title));
  const left = rows[top]!.lastIndexOf("┌", rows[top]!.indexOf(title));
  const right = rows[top]!.indexOf("┐", left);
  const bottom = rows.findIndex((r, i) => i > top && r[left] === "└");
  return rows.slice(top + 1, bottom < 0 ? undefined : bottom).map(r => r.slice(left + 1, right));
}

// ---------------------------------------------------------------------------------------------
// The map: its side panel at every size, and its keys as buttons.

const core = await Core.create({ player: "Tamsin Vell: a disgraced palace auditor", level: 3, build: PREGENS.rogue!.build, explorer: town, fights: mapFights() });
for (const walking of [false, true]) {
  for (const [w, h] of [[80, 24], [80, 30], [100, 30], [130, 42], [160, 45]] as const) {
    const game = new Game();
    game.core = core;
    game.screen = "explore";
    game.walking = walking;
    const setup = await testRender(<ExploreScreen game={game} />, { width: w, height: h });
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    if (show) console.log(`${w}x${h}\n${frame}`);
    const side = flat(panel(frame, "The investigation").join(" "));
    const ex = exploreState(core.state);
    const lead = leadTarget(core.state)!;
    const inner = Math.min(48, Math.max(34, Math.floor(w * 0.32))) - 4;
    // Each of these whole: overprinted lines would mangle them.
    const wanted = [
      "The granary lane", TIME_WORDS[core.state.story.time], `Tamsin Vell · ${(core.session.rules?.status ?? "").split(",")[0]}`, "The lead: The Hanged Clerk",
      // The nearest of who and what's about, as the list has them.
      wrap(leadWay(ex.at, lead), inner).join(" "), "Nearby", ...nearby(ex, 7).filter(n => n.actor && n.actor.kind !== "object" || n.interaction?.kind === "travel").slice(0, 1).map(n => n.actor?.name ?? n.label),
      ...(walking ? ["Walking…"] : []),
    ];
    const missing = wanted.filter(t => !side.includes(flat(t)));
    checks.push([`the map's side panel at ${w}x${h}${walking ? ", walking" : ""}: every line whole${missing.length ? ` (not: ${missing.join(" | ")})` : ""}`, !missing.length]);
    await setup.dispose();
  }
}
{
  const game = new Game();
  game.core = core;
  game.screen = "explore";
  const did: string[] = [];
  game.showSheet = async () => { did.push("sheet"); };
  game.toLead = async () => { did.push("lead"); };
  const setup = await testRender(<ExploreScreen game={game} />, { width: 80, height: 24 });
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  // Narrow, the keys say less ("g lead", "j notes") so the action menu's button fits with them.
  for (const [hint, what, done] of [["g lead", "g walks to the lead", () => did.includes("lead")], ["c sheet", "c opens the sheet", () => did.includes("sheet")], ["j notes", "j opens the notebook", () => game.overlay?.kind === "journal"], ["Esc menu", "Esc opens the menu", () => game.overlay?.kind === "menu"], ["m actions", "m opens the action menu", () => !!game.doMenu]] as const) {
    game.overlay = undefined;
    await act(async () => { game.emit(); });
    const p = at(frame, hint);
    if (p) await act(async () => { await setup.mockMouse.click(p.x, p.y); });
    checks.push([`80x24, the map's keys at the bottom are buttons: ${what}`, !!p && done()]);
  }
  await setup.dispose();
}

// ---------------------------------------------------------------------------------------------
// The action menu (m) by mouse, aiming on the map, and a click that casts.

{
  // A wizard of five (Fireball), in the granary lane by the porters' lodgings, whose door is at (52, 5).
  const wizard = await Core.create({ player: "Vesper: a wizard who has read about fire", level: 5, build: PREGENS.wizard!.build, explorer: town, fights: mapFights(), seed: 11 });
  for (const [w, h] of [[80, 24], [130, 42]] as const) {
    exploreState(wizard.state).at = { x: 47, y: 9 };
    const game = new Game();
    game.core = wizard;
    game.screen = "explore";
    const setup = await testRender(<ExploreScreen game={game} />, { width: w, height: h });
    await setup.renderOnce();
    let frame = setup.captureCharFrame();
    const button = at(frame, "m actions");
    if (button) await act(async () => { await setup.mockMouse.click(button.x, button.y); });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    if (show) console.log(`menu ${w}x${h}\n${frame}`);
    checks.push([`menu ${w}x${h}: a click on "m actions" opens it`, !!game.doMenu]);
    const entries = game.doMenu ? entriesOf(game.doMenu.view) : [];
    // Its kinds and its lines, whole: the headings, the first lines, a dimmed one with why.
    const wanted = ["What will you do?", "Cantrips", "Fire Bolt", "2d10 fire, 120 ft", "1st level", "4/4 slots", "Shield", "a reaction: only in a fight"];
    const missing = wanted.filter(t => !flat(frame).includes(t));
    checks.push([`menu ${w}x${h}: its kinds and lines drawn whole${missing.length ? ` (not: ${missing.join(" | ")})` : ""}`, !missing.length]);
    // The pointer picks a line out; a click on a dimmed one only picks it (and says why); on one that's aimed, aiming starts.
    const shield = at(frame, "Shield");
    if (shield) await act(async () => { await setup.mockMouse.moveTo(shield.x, shield.y); });
    checks.push([`menu ${w}x${h}: the pointer picks a line out`, !!shield && entries[game.doMenu?.index ?? -1]?.key === "spell:shield"]);
    if (shield) await act(async () => { await setup.mockMouse.click(shield.x, shield.y); });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    checks.push([`menu ${w}x${h}: a click on what can't be done says why, and does nothing`, !!game.doMenu && !game.aiming && entries[game.doMenu.index]?.key === "spell:shield" && /not now/i.test(flat(frame))]);
    // Scroll to Fireball (the wheel at 80x24, where the list scrolls) and click it: aiming.
    for (let i = 0; i < 30 && !at(setup.captureCharFrame(), "Fireball"); i++) {
      await act(async () => { await setup.mockMouse.scroll(Math.floor(w / 2), Math.floor(h / 2), "down"); });
      await setup.renderOnce();
    }
    const fireball = at(setup.captureCharFrame(), "Fireball");
    if (fireball) await act(async () => { await setup.mockMouse.click(fireball.x, fireball.y); });
    await setup.renderOnce();
    checks.push([`menu ${w}x${h}: a click on Fireball starts aiming it on the map`, !game.doMenu && game.aiming?.item.key === "spell:fireball"]);
    // Aiming: the pointer over the door aims there; the bottom line says what it'd catch; a click casts.
    const sideW = Math.min(48, Math.max(34, Math.floor(w * 0.32)));
    const view = { w: w - sideW - 2, h: h - 6 - 1 - 2 };
    const picks = new Picks();
    townView(wizard.state, wizard.session, view, { pick: picks });
    const door = { x: 52, y: 5 };
    let cell: { x: number; y: number } | undefined;
    for (let y = 0; y < view.h && !cell; y++) for (let x = 0; x < view.w && !cell; x++) { const p = picks.at(x, y); if (p?.at.x === door.x && p.at.y === door.y) cell = { x: x + 1, y: y + 1 }; }
    if (cell) await act(async () => { await setup.mockMouse.moveTo(cell!.x, cell!.y); });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    if (show) console.log(`aiming ${w}x${h}\n${frame}`);
    const aimed = game.aiming?.check;
    checks.push([`aiming ${w}x${h}: the pointer over the door aims there (${aimed?.label ?? aimed?.why ?? "nothing"})`, !!cell && aimed?.ok === true && aimed.id === "cast_fireball@52,5" && (aimed.area?.length ?? 0) > 9]);
    checks.push([`aiming ${w}x${h}: the bottom line says what it's aimed at, and what it catches`, flat(frame).includes("Fireball → the door") && (w < 100 || flat(frame).includes("catches the door of the porters' lodgings"))]);
    const done: string[] = [];
    game.act = async (id: string) => { done.push(id); };
    if (cell) await act(async () => { await setup.mockMouse.click(cell!.x, cell!.y); });
    checks.push([`aiming ${w}x${h}: a click casts it there (${done.join() || "nothing"})`, done.join() === "cast_fireball@52,5" && !game.aiming]);
    // A right-click on the door: Do something…, the menu aimed at it already (what can't be done to a door says so).
    if (cell) await act(async () => { await setup.mockMouse.click(cell!.x, cell!.y, MouseButton.RIGHT); });
    await setup.renderOnce();
    const something = at(setup.captureCharFrame(), "Do something…");
    if (something) await act(async () => { await setup.mockMouse.click(something.x, something.y); });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    const aimedAtDoor = game.doMenu ? entriesOf(game.doMenu.view) : [];
    checks.push([`menu ${w}x${h}: a right-click's "Do something…" opens it aimed at the door`, game.doMenu?.view.at?.x === door.x && /Do something: the door/.test(flat(frame))
      && aimedAtDoor.find(e => e.key === "spell:fireball")?.id === "cast_fireball@52,5" && /not on/.test(aimedAtDoor.find(e => e.key === "shove")?.why ?? "")]);
    void actorsHere;
    await setup.dispose();
  }
  // For real, on the town: the door comes down and stays down.
  exploreState(wizard.state).at = { x: 47, y: 9 };
  await wizard.act("cast_fireball@52,5");
  const kept = exploreState(wizard.state).overlay.town?.["caerwyn"]?.things["caerwyn:door@52,5"];
  checks.push([`Fireball at the porters' door breaks it (${kept?.states.join(", ")})`, !!kept?.states.includes("destroyed")]);
}

// ---------------------------------------------------------------------------------------------
// The fight: its side panel, and the mouse.

const session = await pregenSession({ pregen: "fighter", level: 3, seed: 2 });
Object.assign(session, { sceneId: "heron-warehouse", beat: "midnight", entered: ["sallow"] });
session.established.push("Master Sallow has come to the Heron.");
const heron = sceneById("heron-warehouse");
const cast = presentCast(heron, session);
session.world = buildWorld(heron.id, heron.world!, cast.map(c => ({ id: c.id, name: c.name })), session.player);
joinWorld(session.world, cast.map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), 0);
forceEnding(session, "fight");
const state: GameState = { version: 1, id: "check", mode: "combat", story: { time: "night", played: [], flags: {} }, explore: {}, recent: [] };
const fight = (await mapFights().start(state, session)) as TacticalFight;
const fake = { state, session, currentFight: fight, observe: () => ({ mode: "combat", text: "", actions: [] }) } as unknown as Core;

for (const [w, h] of [[80, 24], [130, 42]] as const) {
  const game = new Game();
  game.core = fake;
  game.screen = "combat";
  const acted: string[] = [];
  game.combatAct = async (id: string) => { acted.push(id); };
  const setup = await testRender(<CombatScreen game={game} />, { width: w, height: h });
  await setup.renderOnce();
  let frame = setup.captureCharFrame();
  if (show) console.log(`fight ${w}x${h}\n${frame}`);
  const c = fight.controller, G = c.state();
  const me = G.units[G.pc]!;
  checks.push([`fight ${w}x${h}: it's the player's turn to begin with`, c.playerTurn()]);
  const side = flat(panel(frame, "Initiative").join(" "));
  const aimed = game.target()!;
  const rows = ["click a blue tile to move there", "a attack z close in c cast", "u knock over d dash g dodge", "x disengage e end turn", "f let the dice decide", "every option", "Your turn", `${h > 30 ? "Target " : "Target: "}${aimed.name} · ${Math.max(Math.abs(aimed.at.x - c.state().units[c.state().pc]!.at.x), Math.abs(aimed.at.y - c.state().units[c.state().pc]!.at.y)) * 5} ft`];
  const missing = [...rows, ...Object.values(G.units).map(u => u.name.slice(0, 12))].filter(t => !side.includes(flat(t)));
  checks.push([`fight ${w}x${h}: the side panel's lines whole${missing.length ? ` (not: ${missing.join(" | ")})` : ""}`, !missing.length]);

  // Where things are drawn: the same frame, picked (the battlefield's box has a border: one cell in).
  const sideW = Math.min(50, Math.max(38, Math.floor(w * 0.34)));
  const view = { w: w - sideW - 2, h: h - Math.max(8, Math.floor(h * 0.3)) - 1 - 2 };
  const picks = new Picks();
  fightView(c, session, view, { centre: me.at, marks: c.options().moves.map(at => ({ at, color: "#2f6fb0" })), pick: picks, time: "night" });
  const cellOf = (want: (p: ReturnType<Picks["at"]>) => boolean) => {
    for (let y = 0; y < view.h; y++) for (let x = 0; x < view.w; x++) if (want(picks.at(x, y))) return { x: x + 1, y: y + 1 };
    return undefined;
  };
  // A blue tile: a click there moves there.
  const tile = c.options().moves.find(t => { const s = screenOf(t, me.at, view); return picks.at(s.x, s.y)?.at.x === t.x && picks.at(s.x, s.y)?.at.y === t.y && !picks.at(s.x, s.y)?.actor; });
  if (tile) {
    const s = screenOf(tile, me.at, view);
    await act(async () => { await setup.mockMouse.click(s.x + 1, s.y + 1); });
  }
  checks.push([`fight ${w}x${h}: a click on a blue tile moves there (${acted.at(-1)})`, !!tile && acted.at(-1) === `move_${tile.x}_${tile.y}`]);
  // Someone on the other side who isn't the target: a click aims at them; another attacks (or says they're out of reach).
  const targets = game.fightTargets();
  const other = targets.find(t => t.id !== game.target()?.id);
  const cell = other ? cellOf(p => p?.actor?.id === other.id) : undefined;
  if (cell) {
    await act(async () => { await setup.mockMouse.click(cell.x, cell.y); });
    checks.push([`fight ${w}x${h}: a click on ${other!.name} aims at them`, game.target()?.id === other!.id]);
    await act(async () => { await setup.mockMouse.click(cell.x, cell.y); });
    checks.push([`fight ${w}x${h}: a click on the one aimed at attacks (${acted.at(-1) ?? game.status})`, acted.at(-1) === `attack_${other!.id}` || /out of reach/.test(game.status ?? "")]);
  } else checks.push([`fight ${w}x${h}: someone to aim at, drawn on the battlefield`, false]);
  // The options are buttons.
  await setup.renderOnce();
  frame = setup.captureCharFrame();
  for (const [label, id] of [["e end turn", "end_turn"], ["d dash", "dash"], ["g dodge", "dodge"]] as const) {
    const p = at(frame, label);
    if (p) await act(async () => { await setup.mockMouse.click(p.x, p.y); });
    checks.push([`fight ${w}x${h}: a click on "${label}" does it`, acted.at(-1) === id]);
  }
  const options = at(frame, "every option");
  if (options) await act(async () => { await setup.mockMouse.click(options.x, options.y); });
  checks.push([`fight ${w}x${h}: a click on "m every option" lists them`, game.overlay?.kind === "actions"]);
  await setup.dispose();
}

// ---------------------------------------------------------------------------------------------
// The title and the End, by a click.

{
  const game = new Game();
  let made = 0;
  const resumed: string[] = [];
  game.loadSaves = () => { game.saves = [{ id: "s1", game: core.state, session: core.session, mtime: Date.now() } as Resumable]; game.emit(); };
  game.newCharacter = () => { made++; };
  game.resume = async (r: Resumable) => { resumed.push(r.id); };
  const setup = await testRender(<TitleScreen game={game} />, { width: 80, height: 24 });
  await setup.renderOnce();
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  const newGame = at(frame, "New game");
  if (newGame) await act(async () => { await setup.mockMouse.click(newGame.x, newGame.y); });
  checks.push(["the title: a click on New game makes a character", made === 1]);
  const go = at(frame, "Continue");
  if (go) await act(async () => { await setup.mockMouse.click(go.x, go.y); });
  checks.push(["the title: a click on Continue carries on the game", resumed.join() === "s1"]);
  await setup.dispose();
}
{
  const game = new Game();
  game.core = core;
  game.screen = "end";
  game.ending = { closing: "And that, as they say in Caerwyn, was that.", chapters: [], spentUsd: 0 };
  let back = 0;
  game.toTitle = () => { back++; };
  const setup = await testRender(<EndScreen game={game} />, { width: 80, height: 24 });
  await setup.renderOnce();
  const p = at(setup.captureCharFrame(), "back to the title");
  if (p) await act(async () => { await setup.mockMouse.click(p.x, p.y); });
  checks.push(["the End: a click goes back to the title", back === 1]);
  await setup.dispose();
}

let failed = 0;
for (const [what, ok] of checks) {
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
  if (!ok) failed++;
}
console.log(failed ? `FAIL: ${failed}` : "PASS");
process.exit(failed ? 1 : 0);
