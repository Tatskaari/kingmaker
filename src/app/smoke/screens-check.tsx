/**
 * The map, the fight, the sheet, a scene's place, the title and the End, drawn by the real screens
 * and played with the mouse, no model calls (a ready-made character offline): the map's and the
 * fight's side panels at 80x24 and up, every line drawn whole (a squeezed panel draws its lines over
 * each other); the map's keys at the bottom as buttons; a click on a blue tile moves there, a click
 * on someone on the other side aims at them and a click on your target attacks, and the fight's
 * options are buttons; typing in a fight at 80x24 and 130x42 (its box under the log: Enter gives it
 * the keys, letters type rather than act, a line the rules refuse says why under the log and spends
 * nothing, a typed deed is done, Esc and a click elsewhere give the keys back); a spell on the
 * sheet clicked shows what it is, and ← Back (or Esc) puts the
 * sheet back as it was; in a scene at 80x24 and 130x42, pointing at someone in the place (and in the
 * list under it) says who on the bottom line (the GM's spinner and the game's word stay up), a
 * right-click opens their menu without covering the conversation, a glance notes what anyone could
 * see (never the GM's descriptions), a deed goes as the turn, an attack takes two choices, a
 * right-click on the open menu opens what's under it and chooses nothing, a click starts the line
 * with their name, and Tab and Enter do it by key while the box keeps its keys (Enter on what the
 * mouse only rests on opens nothing); a scene's suggested lines at 80x24 and 130x42 (rows kept for
 * them while they're coming, so the conversation doesn't move when they come; numbered over the box,
 * a line each; a number or a click puts one in the box, typing puts them away, Enter sends; the Esc
 * menu turns them off); the help scrolls by key; the title's New game and Continue,
 * and the End's way back, by a click; the zoo's side panel, a sign's card, its help scrolled, and a
 * long line in What happens kept by its start.
 *
 *   KM_RUNS_DIR=runs/check OPENROUTER_API_KEY=offline node --experimental-ffi --no-warnings --import tsx src/app/smoke/screens-check.tsx [--show]
 */
import { MouseButton } from "@opentui/core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { reportsDir } from "../../report/dump.ts";
import { sceneById } from "../../../scenes/index.ts";
import { pregenSession, PREGENS, TacticalFight } from "../../game/combat/index.ts";
import { mapFights } from "../../game/fights.ts";
import { registerLookCanvas } from "../../game/look/opentui.ts";
import { aimFor, leadTarget, town } from "../../game/town.ts";
import { Game as Core, type GameState, type SayHooks } from "../../game/play.ts";
import { exploreState } from "../../game/town.ts";
import { actorsHere, nearby, Picks, screenOf } from "../../game/map/index.ts";
import { fightView, townView } from "../../game/views.ts";
import { presentCast } from "../../runtime/brief.ts";
import type { Suggestion } from "../../runtime/session.ts";
import { currentSuggestions } from "../../runtime/suggest.ts";
import { forceEnding } from "../../runtime/engine.ts";
import { inventory, startingPurse } from "../../world/inventory.ts";
import { buildWorld, joinWorld } from "../../world/scene-world.ts";
import { entriesOf, Game, type Line } from "../game.ts";
import { attachReporting } from "../report.ts";
import type { Resumable } from "../save.ts";
import { leadWay, TIME_WORDS } from "../story.ts";
import { wrap } from "../ui/common.tsx";
import { CombatScreen, fightLayout } from "../ui/combat.tsx";
import { EndScreen } from "../ui/end.tsx";
import { ExploreScreen } from "../ui/explore.tsx";
import { Overlay } from "../ui/overlay.tsx";
import { SceneScreen } from "../ui/scene.tsx";
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
      && aimedAtDoor.find(e => e.key === "spell:fire-bolt")?.id === "cast_fire-bolt@52,5" && /not on/.test(aimedAtDoor.find(e => e.key === "shove")?.why ?? "")]);
    // An area from there is aimed at the door first, so you see what it covers and who it catches before it goes off.
    const ball = aimedAtDoor.findIndex(e => e.key === "spell:fireball");
    if (ball >= 0) await act(async () => { game.chooseAction(ball); });
    checks.push([`menu ${w}x${h}: Fireball from "Do something…" is aimed at the door, not cast (${game.aiming?.check?.label ?? "not aiming"})`, !game.doMenu && game.aiming?.at.x === door.x && game.aiming.at.y === door.y && done.length === 1]);
    await act(async () => { game.cancelAim(); });
    if (w === 80) {
      // A pointer resting over the menu doesn't take the keys' pick from them as the list scrolls (at 80x24 the menu covers the map).
      await act(async () => { await setup.mockMouse.moveTo(Math.floor(w / 2), Math.floor(h / 2)); });
      await act(async () => { setup.mockInput.pressKey("m"); });
      await setup.renderOnce();
      const all = game.doMenu ? entriesOf(game.doMenu.view) : [];
      const picked: number[] = [game.doMenu?.index ?? -1];
      for (let i = 0; i < all.length + 2 && game.doMenu; i++) {
        await act(async () => { setup.mockInput.pressKey("ARROW_DOWN"); });
        await setup.renderOnce();
        picked.push(game.doMenu?.index ?? -1);
      }
      const steady = picked.every((n, i) => i === 0 || n === (picked[i - 1]! + 1) % all.length);
      const rests = ["rest:short", "rest:long"].every(k => picked.some(n => all[n]?.key === k));
      checks.push([`menu ${w}x${h}: with the pointer resting on it, ↓ goes down a line at a time, as far as the rests (${picked.slice(0, 12).join(" ")}…)`, all.length > 10 && steady && rests]);
      await act(async () => { game.closeActions(); });
    }
    void actorsHere;
    await setup.dispose();
  }
  // The help at 80x24 is longer than the screen: the keys scroll it (PgDn, ↓), and it stays open while they do.
  {
    const game = new Game();
    game.core = wizard;
    game.screen = "explore";
    game.overlay = { kind: "help" };
    const setup = await testRender(<Overlay game={game} />, { width: 80, height: 24 });
    await setup.renderOnce();
    const before = setup.captureCharFrame();
    await act(async () => { setup.mockInput.pressKey("\u001b[6~"); });
    await setup.renderOnce();
    await act(async () => { setup.mockInput.pressKey("ARROW_DOWN"); });
    await setup.renderOnce();
    const after = setup.captureCharFrame();
    checks.push(["help 80x24: PgDn and ↓ scroll it, and it stays open", game.overlay?.kind === "help" && before.includes("· e (or Enter) talks to whoever") && !after.includes("· e (or Enter) talks to whoever")]);
    await setup.dispose();
  }
  // A leap into the granary yard opens its scene, and the screen goes with it (the rules roll first, so it opens late).
  {
    const fighter = await Core.create({ player: "Brann: a fighter who takes walls at a run", level: 3, build: PREGENS.fighter!.build, explorer: town, fights: mapFights(), seed: 5 });
    exploreState(fighter.state).at = { x: 42, y: 9 };
    const game = new Game();
    game.core = fighter;
    game.screen = "explore";
    const leap = aimFor(fighter.state, fighter.session, "jump")?.targets.find(t => /the yard behind/.test(t.name));
    if (leap) await game.act(leap.id);
    checks.push([`a leap into the granary yard (${leap?.id ?? "none"}) shows its scene opening: ${game.screen}, ${game.lines[0]?.name ?? "no header"}`, !!leap && (game.screen as string) === "scene" && game.lines[0]?.kind === "header" && (fighter.state.mode as string) === "scene"]);
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
  const layout = fightLayout(w, h);
  const view = { w: layout.mapW - 2, h: layout.mapH - 2 };
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
// Typing in a fight: the box under the log, by key and by click, at 80x24 and 130x42. What's sent
// goes through the core as typed (offline: the plain commands, read with no model).

for (const [w, h] of [[80, 24], [130, 42]] as const) {
  // A fresh fight for each size: what's typed here is done.
  const typing = (await mapFights().start(state, session)) as TacticalFight;
  const core = { state, session, currentFight: typing, observe: () => ({ mode: "combat", text: "", actions: [] }), say: (text: string, hooks: SayHooks) => typing.say(text, hooks) } as unknown as Core;
  const game = new Game();
  game.core = core;
  game.screen = "combat";
  const acted: string[] = [];
  game.combatAct = async (id: string) => { acted.push(id); };
  const setup = await testRender(<><CombatScreen game={game} /><Overlay game={game} /></>, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  const { mapW, mapH, logH } = fightLayout(w, h);
  // The box's rows: its title on its top border, then what's in it (the left column only).
  const boxTitle = (f: string) => [...(f.split("\n")[mapH + logH] ?? "")].slice(0, mapW).join("");
  const boxed = (f: string) => [...(f.split("\n")[mapH + logH + 1] ?? "")].slice(0, mapW).join("").replace(/│/g, "").trim();
  const bottom = (f: string) => f.split("\n").filter(r => r.trim()).at(-1)!.trim();
  const logText = (f: string) => flat(f.split("\n").slice(mapH, mapH + logH).map(r => [...r].slice(0, mapW).join("").replace(/[│┌┐└┘─]/g, " ")).join(" "));
  let frame = await draw();
  if (show) console.log(`fight's box ${w}x${h}\n${frame}`);
  checks.push([`fight ${w}x${h}: the box is under the log, whole, and says how (${boxed(frame)})`, /─ Type ─/.test(boxTitle(frame)) && /^Enter/.test(boxed(frame)) && /^Enter type/.test(bottom(frame))]);
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`fight ${w}x${h}: Enter gives the box the keys, and the hints say how to send and to get back`, game.fightBox && /What do you do\?/.test(boxTitle(frame)) && /^Enter send +· +Esc the keys/.test(bottom(frame))]);
  // The letters type: no attack (a), cast (c), options (m), sheet (s), end of turn (e) or report (b, an overlay).
  await act(async () => { await setup.mockInput.typeText("cast fireball at sallow"); });
  frame = await draw();
  checks.push([`fight ${w}x${h}: the letters go in the box (b, a, c, s and e among them), not to the fight's keys (${boxed(frame)})`, boxed(frame) === "cast fireball at sallow" && !acted.length && !game.overlay]);
  await act(async () => { setup.mockInput.pressEnter(); await new Promise(r => setTimeout(r, 150)); });
  frame = await draw();
  const before = typing.controller.state().log.length;
  checks.push([`fight ${w}x${h}: Enter sends it; a spell the fighter hasn't got says why under the log, and nothing's spent`, logText(frame).includes("(Fireball isn't one of your spells") && boxed(frame) !== "cast fireball at sallow" && game.fightBox && !typing.controller.options().actionUsed]);
  // A deed: the rules' Dodge, after the line as typed.
  await act(async () => { await setup.mockInput.typeText("dodge"); setup.mockInput.pressEnter(); await new Promise(r => setTimeout(r, 300)); });
  frame = await draw();
  if (show) console.log(`fight's box ${w}x${h}, dodged\n${frame}`);
  const shown = typing.controller.view().log.map(l => l.text);
  // (At 80x24 the log's five rows have room for the Dodge, not the line before it.)
  checks.push([`fight ${w}x${h}: "dodge" typed is the rules' Dodge, in the log after the line as typed`, (h < 30 || logText(frame).includes("› dodge")) && logText(frame).includes("Dodge: attacks on you have disadvantage") && typing.controller.options().actionUsed && typing.controller.state().log.length > before && shown.indexOf("dodge") >= 0 && shown.indexOf("dodge") < shown.findIndex(t => /^Dodge: /.test(t))]);
  // Esc gives the keys back: e ends the turn (a key again, not a letter in the box).
  await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); });
  act(() => setup.mockInput.pressKey("e"));
  await draw();
  checks.push([`fight ${w}x${h}: Esc gives the keys back (e ends the turn: ${acted.join() || "nothing"})`, !game.fightBox && acted.at(-1) === "end_turn"]);
  // A click in the box gives it the keys; a click on the battlefield gives them back.
  await act(async () => { await setup.mockMouse.click(4, mapH + logH + 1); });
  const clickedIn = game.fightBox;
  await act(async () => { await setup.mockMouse.click(Math.floor(mapW / 2), Math.floor(mapH / 2)); });
  checks.push([`fight ${w}x${h}: a click on the box gives it the keys, a click on the battlefield gives them back`, clickedIn && !game.fightBox]);
  // Enter and the letters after it in one read (a fast typist, a slow frame): they type, they don't act (d would dash, e end the turn).
  acted.length = 0;
  const status = game.status;
  await act(async () => { await setup.mockInput.pressKeys(["RETURN", "d", "o", "d", "g", "e"]); });
  frame = await draw();
  checks.push([`fight ${w}x${h}: Enter and "dodge" in one read type into the box (${boxed(frame)}; ${acted.join() || "nothing acted"})`, game.fightBox && boxed(frame) === "dodge" && !acted.length && game.status === status]);
  // The line uses the box's width: as much as fits, from its start.
  const long = "I shout at the crake, the boy and Sallow, and then I hit the crake with a stool".slice(0, mapW - 4 - 6);
  await act(async () => { setup.mockInput.pressBackspace(); setup.mockInput.pressBackspace(); setup.mockInput.pressBackspace(); setup.mockInput.pressBackspace(); setup.mockInput.pressBackspace(); await setup.mockInput.typeText(long); });
  frame = await draw();
  checks.push([`fight ${w}x${h}: a line ${long.length} long shows whole in the box (${boxed(frame).length} shown)`, boxed(frame) === long]);
  // Sent while the GM's still speaking: it waits in the box and says why, until it can go.
  game.busy = "The GM is speaking…";
  await act(async () => { setup.mockInput.pressEnter(); await new Promise(r => setTimeout(r, 50)); });
  frame = await draw();
  const waited = logText(frame).includes("(The GM's still speaking: Enter sends it once they've done.)") && boxed(frame) === long;
  game.busy = undefined;
  game.emit();
  frame = await draw();
  checks.push([`fight ${w}x${h}: sent while the GM's speaking, a line waits in the box and says why, until it can go`, waited && !logText(frame).includes("still speaking") && boxed(frame) === long]);
  await setup.dispose();
}

// ---------------------------------------------------------------------------------------------
// A scene: its place by mouse and by key (pointing, a click, the right-click menu), at 80x24 and 130x42.

{
  const scene = sceneById("hanged-clerk");
  const yard = await pregenSession({ pregen: "wizard", name: "Pell Marrow", level: 3, seed: 3, sceneId: "hanged-clerk" });
  Object.assign(yard, { beat: scene.start });
  const people = presentCast(scene, yard);
  yard.world = buildWorld(scene.id, scene.world!, people.map(c => ({ id: c.id, name: c.name })), yard.player);
  joinWorld(yard.world, people.map(c => ({ id: c.id, name: c.name })), 0);
  for (const coin of startingPurse()) inventory(yard.world, 0).add("player", coin);
  const opening: Line[] = [
    { kind: "header", speaker: "system", name: scene.title, text: scene.hook },
    { kind: "narration", speaker: "gm", text: "The yard behind the King's Granary smells of wet grain and pigeons. Wendell Prout turns slowly on the sack hoist above the shut loft door, and a scrawny boy in enormous boots is lobbing gutter stones at him." },
    { kind: "dialogue", speaker: "kell", name: "Sergeant Agnes Kell", text: "“Sergeant Kell, of the watch. The Captain says suicide.” She does not say what she says. “Investigator.”" },
  ];
  /** The bottom line (what's pointed at, in place of the keys, as on the map), the line under the conversation (the GM's spinner, the game's word), and what's in the box. */
  const under = (frame: string) => frame.split("\n").filter(r => r.trim()).at(-1)!.trim();
  const status = (frame: string) => { const rows = frame.split("\n"); return rows[rows.findIndex(r => r.includes("What do you say?")) - 1]!.trim(); };
  const boxed = (frame: string) => { const rows = frame.split("\n"); return rows[rows.findIndex(r => r.includes("What do you say?")) + 1]!.replace(/│/g, "").trim(); };
  /** The conversation's words, row by row: its rows, left of its scrollbar's column (and the padding and border right of that). */
  const words = (frame: string, upTo: number) => { const rows = frame.split("\n"); return rows.slice(0, rows.findIndex(r => r.includes("What do you say?")) - 1).map(r => [...r].slice(0, upTo).join("")); };
  for (const [w, h] of [[80, 24], [130, 42]] as const) {
    const side = w >= 100 ? Math.min(62, Math.floor(w * 0.42)) : 26 + Math.floor((w - 80) / 4);
    const game = new Game();
    game.core = { session: yard, state: { version: 1, id: "check", mode: "scene", story: { time: "morning", played: [], flags: {} }, explore: {}, recent: [] }, observe: () => ({ mode: "scene", text: "", actions: [] }) } as unknown as Core;
    game.screen = "scene";
    game.lines = [...opening];
    const sent: string[] = [];
    game.input = async (text: string) => { sent.push(text); };
    await game.loadSpellFacts();
    const setup = await testRender(<><SceneScreen game={game} /><Overlay game={game} /></>, { width: w, height: h });
    // A lone Esc reaches the screen once the terminal's reader is sure it isn't the start of a longer key.
    const esc = async () => { await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); }); await setup.renderOnce(); };
    await setup.renderOnce();
    await setup.renderOnce();
    let frame = setup.captureCharFrame();
    if (show) console.log(`scene ${w}x${h}\n${frame}`);
    const rows = frame.split("\n");
    const top = rows.findIndex(r => r.includes("The yard behind the K"));
    const list = rows.findIndex((r, i) => i > top && r.includes("@ you"));
    checks.push([`scene ${w}x${h}: the place is drawn beside the conversation, and who's in it under it`, top > 0 && list > top + 4 && /K Sergeant Agnes K/.test(frame) && /c the boy in the to/.test(frame)]);
    /** Point at each cell of the place until the line under the conversation names someone. */
    const find = async (name: string) => {
      for (let y = top + 1; y < list; y++) for (let x = w - side + 2; x < w - 2; x++) {
        await act(async () => { await setup.mockMouse.moveTo(x, y); });
        await setup.renderOnce();
        if (under(setup.captureCharFrame()).startsWith(name)) return { x, y };
      }
      return undefined;
    };
    const cob = await find("The boy in the too-big boots");
    checks.push([`scene ${w}x${h}: pointing at Cob in the place says who he is (as he's known: no name yet) and what he's doing`, !!cob && /^The boy in the too-big boots +· +under the body, lo/.test(under(setup.captureCharFrame()))]);
    const kell = await find("Sergeant Agnes Kell");
    checks.push([`scene ${w}x${h}: pointing at Kell, and what a click does`, !!kell && /click(:| to) talk/.test(under(setup.captureCharFrame()))]);
    // The list under the place points too.
    const girl = rows.findIndex(r => r.includes("m the girl in the"));
    await act(async () => { await setup.mockMouse.moveTo(w - side + 6, girl); });
    await setup.renderOnce();
    checks.push([`scene ${w}x${h}: pointing at a line of the list says who it is`, /^The girl in the shawl +· +sitting on top of the yar/.test(under(setup.captureCharFrame()))]);
    // The GM's spinner and the game's word stay up while the pointer rests on someone.
    game.busy = "The GM is thinking";
    game.emit();
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    checks.push([`scene ${w}x${h}: with the GM speaking, the spinner stays up under the conversation while the pointer's on someone`, /The GM is thinking/.test(status(frame)) && /^The girl in the shawl/.test(under(frame))]);
    game.busy = undefined;
    game.status = "Saved. The clerk will keep.";
    game.emit();
    await setup.renderOnce();
    checks.push([`scene ${w}x${h}: and so does the game's word`, status(setup.captureCharFrame()) === "Saved. The clerk will keep."]);
    game.status = undefined;
    // Enter with the box empty and the mouse merely resting on someone: nothing (it's for what Tab picked out).
    act(() => setup.mockInput.pressEnter());
    await setup.renderOnce();
    checks.push([`scene ${w}x${h}: Enter with the mouse only resting on someone opens nothing`, !game.sceneMenu && !sent.length]);
    if (!cob || !kell) { await setup.dispose(); continue; }
    // A right-click on Cob: his menu, inside the panel, never over the conversation's words.
    const before = words(setup.captureCharFrame(), w - side - 3);
    await act(async () => { await setup.mockMouse.click(cob.x, cob.y, 2); });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    if (show) console.log(`scene ${w}x${h}, Cob's menu\n${frame}`);
    checks.push([`scene ${w}x${h}: a right-click on Cob opens his menu: talk, look, look him over, give, go over, cast, and last attack`, /1 Talk to them/.test(frame) && /2 Look at them/.test(frame) && /3 Look them over/.test(frame) && /4 Give them something…/.test(frame) && /6 Cast a spell at them…/.test(frame) && /7 Attack them…/.test(frame) && /Esc never mind/.test(frame)]);
    checks.push([`scene ${w}x${h}: the menu hides none of the conversation`, words(frame, w - side - 3).every((r, i) => r === before[i])]);
    await esc();
    await setup.renderOnce();
    checks.push([`scene ${w}x${h}: Esc closes the menu`, !game.sceneMenu && !/Esc never mind/.test(setup.captureCharFrame())]);
    // Looking: at once, a quiet note in the conversation, and not a turn.
    await act(async () => { await setup.mockMouse.click(cob.x, cob.y, 2); });
    act(() => setup.mockInput.pressKey("2"));
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    checks.push([`scene ${w}x${h}: Look notes what a glance shows of him, and sends nothing`, /◉ +The boy in the too-big boots\. Under the/.test(frame) && !sent.length]);
    // A glance at Prout is a glance: the GM's description (what a close look finds) stays the GM's.
    const look = (id: string, under?: string[]) => { game.openSceneMenu({ id, ...(under ? { under } : {}) }, cob.x, cob.y); const text = game.sceneMenu?.actions.find(a => a.id === "look")?.look ?? ""; game.closeSceneMenu(); return text; };
    const prout = look("prout", ["hoist-rope", "hoist-beam"]);
    checks.push([`scene ${w}x${h}: a glance at Prout keeps the GM's description back (${prout})`, /^Wendell Prout's body: hanging from the hoist rope\./.test(prout) && !/cord mark|swelling|palms/.test(prout)]);
    const roll = look("granary-roll");
    checks.push([`scene ${w}x${h}: and at the Roll (${roll})`, /^The Royal Granary Roll/.test(roll) && !/Sallow|goblins/.test(roll)]);
    // A right-click on the open menu chooses nothing: it's a right-click on what's under it.
    await act(async () => { await setup.mockMouse.click(kell.x, kell.y, 2); });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    const item = at(frame, "1 Talk to them");
    if (item) await act(async () => { await setup.mockMouse.click(item.x, item.y, 2); });
    await setup.renderOnce();
    checks.push([`scene ${w}x${h}: a right-click on the open menu chooses nothing: it opens the menu of what's under it (${game.sceneMenu?.title})`, !!item && !sent.length && !!game.sceneMenu && game.sceneMenu.title !== "Sergeant Agnes Kell" && !/^(Kell, |Sergeant Kell, )/.test(boxed(setup.captureCharFrame()))]);
    await esc();
    // An attack is two choices: with what.
    await act(async () => { await setup.mockMouse.click(cob.x, cob.y, 2); });
    const attack = game.sceneMenu?.actions.findIndex(a => a.id === "attack") ?? -1;
    act(() => setup.mockInput.pressKey(String(attack + 1)));
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    checks.push([`scene ${w}x${h}: choosing to attack asks with what, and sends nothing yet (${game.sceneMenu?.title})`, attack >= 0 && /with…$/.test(game.sceneMenu?.title ?? "") && /Your bare hands/.test(frame) && !sent.length]);
    await esc();
    // A deed from a further menu: what to give him, sent as the turn.
    await act(async () => { await setup.mockMouse.click(cob.x, cob.y, 2); });
    const giving = game.sceneMenu?.actions.findIndex(a => a.id === "give") ?? -1;
    act(() => setup.mockInput.pressKey(String(giving + 1)));
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    const pennies = game.sceneMenu?.actions.findIndex(a => a.id.startsWith("give:pennies")) ?? -1;
    checks.push([`scene ${w}x${h}: giving him something lists what you carry, under its own title`, /╭─ Give the boy in the/.test(frame) && /12 pennies/.test(frame) && pennies >= 0]);
    act(() => setup.mockInput.pressKey(String(pennies + 1)));
    await setup.renderOnce();
    checks.push([`scene ${w}x${h}: choosing the pennies sends the deed as the turn (${sent.at(-1)})`, sent.at(-1) === "(I give the boy in the too-big boots one of my pennies)" && !game.sceneMenu]);
    // A click talks: his name (what he's called) starts the line, before anything typed; Kell's in its place.
    await act(async () => { await setup.mockMouse.click(cob.x, cob.y); });
    await setup.renderOnce();
    checks.push([`scene ${w}x${h}: a click on Cob starts the line "Boy, "`, boxed(setup.captureCharFrame()) === "Boy,"]);
    await act(async () => { await setup.mockInput.typeText("who cut him down?"); });
    await act(async () => { await setup.mockMouse.click(kell.x, kell.y); });
    await setup.renderOnce();
    checks.push([`scene ${w}x${h}: then a click on Kell: "Sergeant Kell, who cut him down?" (nothing typed lost)`, boxed(setup.captureCharFrame()) === "Sergeant Kell, who cut him down?"]);
    // The box keeps its keys: Enter sends what's in it, not a menu.
    act(() => setup.mockInput.pressEnter());
    await setup.renderOnce();
    checks.push([`scene ${w}x${h}: Enter sends the line in the box`, sent.at(-1) === "Sergeant Kell, who cut him down?" && !game.sceneMenu]);
    // By key: Tab to the nearest, Enter for the menu, a letter puts it away and goes in the box.
    await act(async () => { await setup.mockMouse.moveTo(1, 1); });
    act(() => setup.mockInput.pressTab());
    await setup.renderOnce();
    checks.push([`scene ${w}x${h}: Tab picks out the nearest person`, under(setup.captureCharFrame()).startsWith("Sergeant Agnes Kell")]);
    act(() => setup.mockInput.pressArrow("down"));
    await setup.renderOnce();
    checks.push([`scene ${w}x${h}: ↓ (nothing typed) the next`, under(setup.captureCharFrame()).startsWith("The girl in the shawl")]);
    act(() => setup.mockInput.pressEnter());
    await setup.renderOnce();
    checks.push([`scene ${w}x${h}: Enter (nothing typed) opens her menu`, game.sceneMenu?.title === "The girl in the shawl" && /Esc never mind/.test(setup.captureCharFrame())]);
    await act(async () => { await setup.mockInput.typeText("M"); });
    await setup.renderOnce();
    checks.push([`scene ${w}x${h}: a letter with the menu open closes it and goes in the box`, !game.sceneMenu && boxed(setup.captureCharFrame()) === "M"]);
    await esc();
    await esc();
    checks.push([`scene ${w}x${h}: Esc lets go of what Tab picked out, then it's the game's menu`, game.overlay?.kind === "menu"]);
    game.closeOverlay();
    // What you carry: under your own @, each thing with its own menu.
    game.openSceneMenu({ id: "player" }, cob.x, cob.y);
    const things = game.sceneMenu?.actions.find(a => a.id === "things");
    checks.push([`scene ${w}x${h}: your things are under your own menu (${things?.choices?.map(c => c.label).join(", ")})`, !!things?.choices?.some(c => /pennies/.test(c.label) && c.choices?.some(d => d.id === "put-down"))]);
    game.closeSceneMenu();
    // The help, by key: it scrolls on a short screen, and wraps at spaces (never a comma on its own at the start of a line).
    game.overlay = { kind: "help" };
    game.emit();
    await setup.renderOnce();
    const helpTop = setup.captureCharFrame();
    // PgDn, as a terminal sends it.
    for (let i = 0; i < 3; i++) act(() => setup.mockInput.pressKey("\u001b[6~"));
    act(() => setup.mockInput.pressArrow("down"));
    await setup.renderOnce();
    const helpMore = setup.captureCharFrame();
    const helpRows = (f: string) => f.split("\n").filter(r => r.includes("║")).map(r => r.slice(r.indexOf("║") + 1, r.lastIndexOf("║")));
    checks.push([`scene ${w}x${h}: the help ${h < 30 ? "scrolls by key" : "fits"}, its lines wrapped at spaces`, (h < 30 ? helpTop !== helpMore && /For testing/.test(helpMore) : /For testing/.test(helpTop)) && !helpRows(helpMore).some(r => /^\s*[,;.)]/.test(r))]);
    game.closeOverlay();
    // How someone is, in the list, in what room the name leaves (never a lone ellipsis).
    yard.world!.entities.kell!.states.push("bloodied");
    game.emit();
    await setup.renderOnce();
    const kellRow = (setup.captureCharFrame().split("\n").find(r => r.includes("K Sergeant Agnes")) ?? "").slice(w - side).replace(/│/g, "").trim();
    checks.push([`scene ${w}x${h}: a bloodied Kell's line in the list: her name whole, how she is if there's room (${kellRow})`, kellRow.startsWith("K Sergeant Agnes Kell") && !kellRow.endsWith("…") && (w < 100 || kellRow.includes("(bloodied)"))]);
    yard.world!.entities.kell!.states = yard.world!.entities.kell!.states.filter(s => s !== "bloodied");
    await setup.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// A scene's suggested lines at 80x24 and 130x42 (src/runtime/suggest.ts): rows kept for them while a
// turn is under way, so the conversation doesn't move when they come; numbered over the box, a line
// each that fits (a second line to say gives way on a short screen); a number puts one in the box
// (the GM may still be making a note), and the box's line then hides them; emptied, they're back; a
// click puts another in; Enter sends it; the Esc menu turns them off (no rows kept for them then).

{
  const scene = sceneById("hanged-clerk");
  const yard = await pregenSession({ pregen: "wizard", name: "Pell Marrow", level: 3, seed: 5, sceneId: "hanged-clerk" });
  Object.assign(yard, { beat: scene.start });
  const people = presentCast(scene, yard);
  yard.world = buildWorld(scene.id, scene.world!, people.map(c => ({ id: c.id, name: c.name })), yard.player);
  joinWorld(yard.world, people.map(c => ({ id: c.id, name: c.name })), 0);
  const lines: Suggestion[] = [
    { kind: "say", text: "Sergeant, who found him, and when exactly did the porters raise the alarm?" },
    { kind: "say", text: "Nice boots. Yours?" },
    { kind: "do", text: "(I look up at the body, then along the hoist rope to the loft door)" },
    { kind: "try", text: "(I try to coax the boy down from his stones with a pie)" },
    { kind: "leave", text: "(I leave the yard to the pigeons)" },
  ];
  const opening: Line[] = [
    { kind: "header", speaker: "system", name: scene.title, text: scene.hook },
    { kind: "narration", speaker: "gm", text: "The yard behind the King's Granary smells of wet grain and pigeons. Wendell Prout turns slowly on the sack hoist above the shut loft door, and a scrawny boy in enormous boots is lobbing gutter stones at him." },
    { kind: "player", speaker: "player", name: "Pell Marrow", text: "(I look around the yard)" },
  ];
  const boxed = (frame: string) => { const rows = frame.split("\n"); return rows[rows.findIndex(r => r.includes("What do you say?")) + 1]!.replace(/│/g, "").trim(); };
  /** The rows over the box: from under the spinner's line to the box's top. */
  const over = (frame: string) => { const rows = frame.split("\n"); const box = rows.findIndex(r => r.includes("What do you say?")); const top = rows.findIndex(r => /^└/.test(r)); return rows.slice(top + 2, box); };
  const talk = (frame: string, upTo: number) => { const rows = frame.split("\n"); return rows.slice(0, rows.findIndex(r => /^└/.test(r))).map(r => [...r].slice(0, upTo).join("")); };
  for (const [w, h] of [[80, 24], [130, 42]] as const) {
    const side = w >= 100 ? Math.min(62, Math.floor(w * 0.42)) : 26 + Math.floor((w - 80) / 4);
    const state = { version: 1, id: "suggest-check", mode: "scene", story: { time: "morning", played: [], flags: {} }, explore: {}, recent: [], settings: {} } as GameState;
    let on = true;
    const core = {
      session: yard, state,
      get suggestionsOn() { return on; },
      setSuggestions: (next: boolean) => { on = next; state.settings = { suggestions: next }; },
      observe: () => ({ mode: "scene", text: "", actions: on ? currentSuggestions(yard).map((s, i) => ({ id: `say_${i + 1}`, label: s.text, kind: "say" })) : [] }),
      save: () => {},
    } as unknown as Core;
    const game = new Game();
    game.core = core;
    game.screen = "scene";
    game.lines = [...opening];
    const sent: string[] = [];
    game.input = async (text: string) => { sent.push(text); };
    // Offline here: the GM is to be had, as far as the screen's concerned, and the lines are on their way until they come.
    let coming = true;
    game.suggestionsExpected = () => on && !game.over;
    game.suggestionsComing = () => coming;
    delete yard.suggestions;
    game.busy = "The GM makes a note…";
    const setup = await testRender(<><SceneScreen game={game} /><Overlay game={game} /></>, { width: w, height: h });
    const esc = async () => { await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); }); await setup.renderOnce(); };
    await setup.renderOnce();
    let frame = setup.captureCharFrame();
    if (show) console.log(`suggestions coming ${w}x${h}\n${frame}`);
    const before = talk(frame, w - side - 3);
    const rows = h < 26 ? 4 : 5;
    checks.push([`suggestions ${w}x${h}: while they're coming, ${rows} rows are kept for them over the box`, over(frame).length === rows && over(frame).every(r => !r.trim())]);
    // They come: the conversation stays where it was, and they're numbered over the box, a line each.
    yard.suggestions = { scene: scene.id, turn: yard.turn, lines };
    coming = false;
    await act(async () => { game.suggestionsCame(); });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    if (show) console.log(`suggestions ${w}x${h}\n${frame}`);
    checks.push([`suggestions ${w}x${h}: when they come, the conversation doesn't move`, talk(frame, w - side - 3).every((r, i) => r === before[i])]);
    const shown = over(frame).map(r => r.trim());
    const wanted = h < 26 ? [lines[0]!, lines[2]!, lines[3]!, lines[4]!] : lines;
    checks.push([`suggestions ${w}x${h}: numbered over the box, a line each that fits${h < 26 ? " (the second to say gives way)" : ""}: ${shown.join(" | ")}`,
      shown.length === wanted.length && wanted.every((l, i) => shown[i]!.startsWith(`${i + 1} ${l.text.slice(0, 12)}`) && (l.text.length + 4 < w || shown[i]!.endsWith("…")))]);
    checks.push([`suggestions ${w}x${h}: the keys say a number puts one in the box`, new RegExp(`1–${wanted.length} into the box`).test(frame.split("\n").filter(r => r.trim()).at(-1) ?? "")]);
    // A number: the line goes in the box (the GM's still making a note), and the box's line hides them.
    act(() => setup.mockInput.pressKey("2"));
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    checks.push([`suggestions ${w}x${h}: 2 puts its line in the box, with the GM still making a note, and they're put away`, boxed(frame) === wanted[1]!.text && !over(frame).some(r => /^\s*1 /.test(r)) && !sent.length]);
    // Emptied, they're back; a click puts another in.
    for (let i = 0; i < wanted[1]!.text.length; i++) act(() => setup.mockInput.pressBackspace());
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    checks.push([`suggestions ${w}x${h}: the box emptied, they're back`, !boxed(frame).includes("(I") && over(frame).filter(r => r.trim()).length === wanted.length]);
    const third = at(frame, wanted[2]!.text.slice(0, 10));
    if (third) await act(async () => { await setup.mockMouse.click(third.x, third.y); });
    await setup.renderOnce();
    checks.push([`suggestions ${w}x${h}: a click puts its line in the box`, !!third && boxed(setup.captureCharFrame()) === wanted[2]!.text]);
    // Enter sends it, as typed.
    game.busy = undefined;
    act(() => setup.mockInput.pressEnter());
    await setup.renderOnce();
    checks.push([`suggestions ${w}x${h}: Enter sends it`, sent.at(-1) === wanted[2]!.text]);
    // Typing hides them.
    await act(async () => { await setup.mockInput.typeText("Mor"); });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    checks.push([`suggestions ${w}x${h}: typing puts them away`, boxed(frame) === "Mor" && !over(frame).some(r => /^\s*1 /.test(r))]);
    for (let i = 0; i < 3; i++) act(() => setup.mockInput.pressBackspace());
    // The Esc menu: Suggested lines: on; Enter turns them off, and the menu says so; no rows kept for them.
    await esc();
    for (let i = 0; i < 3; i++) act(() => setup.mockInput.pressArrow("down"));
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    checks.push([`suggestions ${w}x${h}: the Esc menu has them on`, game.overlay?.kind === "menu" && /▶ Suggested lines: on/.test(frame)]);
    act(() => setup.mockInput.pressEnter());
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    checks.push([`suggestions ${w}x${h}: Enter turns them off, and the menu stays up to say so`, !on && game.overlay?.kind === "menu" && /▶ Suggested lines: off/.test(frame)]);
    await esc();
    game.busy = "The GM is speaking…";
    game.emit();
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    checks.push([`suggestions ${w}x${h}: off, none listed and no rows kept for them`, !game.overlay && !over(frame).length]);
    game.busy = undefined;
    await setup.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Reporting a problem at 80x24 (src/report): /report in a scene asks what went wrong over the scene,
// keeping its screen as it was; Enter saves it and says where, to tell Claude; the Esc menu's
// Report a problem… keeps the screen from before the menu came up; b on the map.

{
  const until = async (ok: () => boolean) => { for (let i = 0; i < 150 && !ok(); i++) await new Promise(r => setTimeout(r, 20)); };
  const scene = sceneById("hanged-clerk");
  const yard = await pregenSession({ pregen: "rogue", name: "Tamsin Vell", level: 3, seed: 5, sceneId: "hanged-clerk" });
  Object.assign(yard, { beat: scene.start });
  const game = new Game();
  game.core = { session: yard, state: { version: 1, id: "report-check", mode: "scene", story: { time: "morning", played: [], flags: {} }, explore: {}, recent: [] }, observe: () => ({ mode: "scene", text: "", actions: [] }), save: () => {} } as unknown as Core;
  game.screen = "scene";
  game.lines = [{ kind: "header", speaker: "system", name: scene.title, text: scene.hook }, { kind: "narration", speaker: "gm", text: "Wendell Prout turns slowly on the sack hoist above the shut loft door." }];
  const setup = await testRender(<><SceneScreen game={game} /><Overlay game={game} /></>, { width: 80, height: 24 });
  attachReporting(game, setup.renderer);
  const esc = async () => { await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); }); await setup.renderOnce(); };
  const report = () => (game.overlay?.kind === "report" ? game.overlay : undefined);
  await setup.renderOnce();
  await act(async () => { await setup.mockInput.typeText("/report"); });
  act(() => setup.mockInput.pressEnter());
  await setup.renderOnce();
  let frame = setup.captureCharFrame();
  if (show) console.log(`report 80x24\n${frame}`);
  checks.push(["80x24, /report in a scene asks what went wrong, over the scene", /Report a problem/.test(frame) && /What went wrong\?/.test(frame) && /Enter send/.test(frame) && /Esc never mind/.test(frame)]);
  const kept = report()?.screen ?? "";
  checks.push(["80x24, the report keeps the scene's screen as it was", /What do you say\?/.test(kept) && /Prout turns slowly/.test(kept) && !/What went wrong/.test(kept)]);
  await act(async () => { await setup.mockInput.typeText("Kell said it twice"); });
  await act(async () => { setup.mockInput.pressEnter(); await until(() => !!report()?.said); });
  await setup.renderOnce();
  frame = setup.captureCharFrame();
  if (show) console.log(`report saved 80x24\n${frame}`);
  const said = report()?.said ?? "";
  const file = /tell Claude 'report (.+?)'/.exec(said)?.[1];
  const path = file ? join(reportsDir(), file) : "";
  // The box's words, row by row, between its sides: all of what it said, wrapped.
  const boxed = frame.split("\n").filter(r => r.includes("║")).map(r => r.slice(r.indexOf("║") + 1, r.lastIndexOf("║")).trim()).filter(Boolean).join(" ");
  checks.push([`80x24, Enter saves it and says where, to tell Claude (${said})`, !!file && /Report saved/.test(frame) && boxed.includes(said) && existsSync(path)]);
  const dump = file && existsSync(path) ? JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as { words: string; screens: { now?: string }; settings: { terminal?: { cols: number } } } : undefined;
  checks.push(["80x24, the report has the words, the screen as it was and the terminal's size", dump?.words === "Kell said it twice" && /What do you say\?/.test(dump.screens.now ?? "") && dump.settings.terminal?.cols === 80]);
  act(() => setup.mockInput.pressEnter());
  await setup.renderOnce();
  checks.push(["80x24, Enter then puts it away", !game.overlay]);
  // The Esc menu: Report a problem… is its last line (↑ from the first comes round to it).
  await esc();
  frame = setup.captureCharFrame();
  checks.push(["80x24, the Esc menu offers Report a problem…", game.overlay?.kind === "menu" && /Report a problem…/.test(frame)]);
  act(() => setup.mockInput.pressArrow("up"));
  act(() => setup.mockInput.pressEnter());
  await setup.renderOnce();
  frame = setup.captureCharFrame();
  const fromMenu = report()?.screen ?? "";
  checks.push(["80x24, choosing it asks what went wrong, and keeps the screen from before the menu", /What went wrong\?/.test(frame) && /What do you say\?/.test(fromMenu) && !/Save and quit/.test(fromMenu)]);
  await esc();
  checks.push(["80x24, Esc never minds", !game.overlay]);
  await setup.dispose();
}
{
  const game = new Game();
  game.core = core;
  game.screen = "explore";
  const setup = await testRender(<><ExploreScreen game={game} /><Overlay game={game} /></>, { width: 80, height: 24 });
  attachReporting(game, setup.renderer);
  await setup.renderOnce();
  act(() => setup.mockInput.pressKey("b"));
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  const kept = game.overlay?.kind === "report" ? game.overlay.screen ?? "" : "";
  checks.push(["80x24, b on the map asks what went wrong, keeping the map as it was", /What went wrong\?/.test(frame) && /The investigation/.test(kept) && !/What went wrong/.test(kept)]);
  await setup.dispose();
}

// ---------------------------------------------------------------------------------------------
// The sheet: a spell on it clicked, what it is in the sheet's own box, and back; the same by keys.

const wizard = await Core.create({ player: `Pell Marrow: ${PREGENS.wizard!.concept}`, level: 3, build: PREGENS.wizard!.build, explorer: town, fights: mapFights() });
for (const [w, h] of [[80, 24], [130, 42]] as const) {
  const game = new Game();
  game.core = wizard;
  game.screen = "explore";
  await game.showSheet();
  const setup = await testRender(<Overlay game={game} />, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  // A lone Esc reaches the app once the terminal is sure it isn't the start of a sequence.
  const esc = () => act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 60)); });
  let frame = await draw();
  // To the spells by a click on their page's tab (the first "Spells" on screen).
  const tab = at(frame, "Spells");
  if (tab) await act(async () => { await setup.mockMouse.click(tab.x, tab.y); });
  const sheet = await draw();
  if (show) console.log(`sheet ${w}x${h}\n${sheet}`);
  const spell = at(sheet, "Burning Hands");
  checks.push([`the sheet ${w}x${h}: a click on its tab turns to the spells`, !!spell]);
  if (spell) await act(async () => { await setup.mockMouse.click(spell.x, spell.y); });
  frame = await draw();
  if (show) console.log(`spell ${w}x${h}\n${frame}`);
  // Each of these whole, inside the sheet's box.
  const box = flat(frame.split("\n").filter(r => r.includes("║")).join(" "));
  const wanted = [
    "← Back", "Burning Hands Level 1 Evocation (Sorcerer, Wizard)", "Casting time Action · Range Self (15-foot cone) · Duration Instantaneous", "Components V, S",
    "In this game", "Dexterity save, DC 13: 3d6 fire, half as much on a success", "Area: a 15-foot cone from you", "With a higher slot: +1d6 fire for each level above 1st",
    "From the SRD 5.2.1", "CC BY 4.0", "A thin sheet of flames shoots forth from you.", "Esc back to the sheet",
  ];
  const missing = wanted.filter(t => !box.includes(t));
  checks.push([`the sheet ${w}x${h}: a click on Burning Hands shows it, every line whole${missing.length ? ` (not: ${missing.join(" | ")})` : ""}`, !!spell && !missing.length]);
  // In the sheet's own box, its sides unbroken from top to bottom (a line too long would push one out).
  const lines = frame.split("\n");
  const top = lines.findIndex(r => r.includes("╔")), bottom = lines.findIndex(r => r.includes("╚"));
  const left = lines[top]?.indexOf("╔") ?? -1, right = lines[top]?.indexOf("╗") ?? -1;
  checks.push([`the sheet ${w}x${h}: the spell in the sheet's own box, its sides unbroken`, top >= 0 && bottom > top && bottom < h && lines.slice(top + 1, bottom).every(r => r[left] === "║" && r[right] === "║")]);
  const back = at(frame, "← Back");
  if (back) await act(async () => { await setup.mockMouse.click(back.x, back.y); });
  checks.push([`the sheet ${w}x${h}: a click on ← Back puts the sheet back as it was`, (await draw()) === sheet]);
  // By keys: ↓ picks the first spell, Enter shows it, Esc puts it back, Esc lets it go, Esc puts the sheet away.
  act(() => setup.mockInput.pressArrow("down"));
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`the sheet ${w}x${h}: ↓ and Enter show Fire Bolt`, /← Back {2}Fire Bolt/.test(frame) && frame.includes("Ranged spell attack, +5 to hit: 1d10 fire on a hit") && frame.includes("You hurl a mote of fire")]);
  await esc();
  frame = await draw();
  checks.push([`the sheet ${w}x${h}: Esc goes back to the sheet, Fire Bolt still picked`, frame.includes("Burning Hands") && frame.includes("Enter about it") && game.overlay?.kind === "sheet"]);
  await esc();
  await esc();
  checks.push([`the sheet ${w}x${h}: Esc lets the spell go, then puts the sheet away`, !game.overlay]);
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

// ---------------------------------------------------------------------------------------------
// Making a character, at 80x24 and 130x42: three builds as cards, chosen by a click and by the keys;
// one of their own, picked by a click and the keys; a backstory written in the box (lines, the box
// scrolling, a click putting the cursor in the text), a draft and notes worked in (shown, never in
// the box until taken), the lore check's fix accepted and another rewritten, and the GM's buttons
// offline. The model is a stand-in (game.ask), and offline the builds are the class defaults.

{
  const { threeBuilds } = await import("../../rules/builds.ts");
  const { BackstoryScreen, ChooseScreen, CreatedScreen, CustomScreen } = await import("../ui/create.tsx");
  const CONCEPT = "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier";
  const offer = await threeBuilds("Tamsin Vell", CONCEPT, 3);
  const DRAFT = "I was born above a chandler's shop on Tallow Lane, where the candles were cheap and the arguments cheaper.\n\nI kept a factor's books for nine years, until the night I found an error that wasn't one.";
  const WORKED = "I grew up in the Nine Furrows, where Mum drowned in the flood of '89. I still owe Fat Jory three crowns.";
  const STORY = "I'm the King's nephew, though nobody at court will say so. I owe Fat Jory three crowns.";
  /** A stand-in for the model: what each of character creation's calls answers, and what it was asked. */
  const standIn = (asked: string[]): NonNullable<Game["ask"]> => (async <T,>(request: { operation: string; input: Array<{ content: unknown }> }) => {
    asked.push(request.operation);
    const input = request.input.map(m => String(m.content)).join("\n");
    const answers: Record<string, unknown> = {
      "backstory.draft": { story: DRAFT },
      "backstory.work": { story: WORKED },
      // The nephew, while the story has him (the fixed story, checked again, fits).
      "backstory.check": { issues: input.includes("King's nephew") ? [{ quote: "I'm the King's nephew", problem: "King Aldren's family is known to all Caerwyn, and there's no nephew in it.", fix: "I'm a cousin of a minor courtier, twice removed" }] : [] },
      "backstory.traits": { summary: "Tamsin Vell, a minor courtier's cousin who owes Fat Jory three crowns.", personality: ["Sharp-tongued"], ideals: ["The books should balance"], bonds: ["Fat Jory, owed three crowns"], flaws: ["Can't leave a sum alone"] },
    };
    if (!(request.operation in answers)) throw new Error(`no stand-in for ${request.operation}`);
    return answers[request.operation] as T;
  }) as NonNullable<Game["ask"]>;
  const fresh = (screen: "choose" | "custom" | "backstory", story = ""): Game => {
    const game = new Game();
    game.screen = screen;
    game.creation = { name: "Tamsin Vell", concept: CONCEPT, offer, index: 0, story, version: 0, issue: 0, chosen: offer.options[0]! };
    return game;
  };
  const settle = async (setup: Awaited<ReturnType<typeof testRender>>, ms = 30) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); await setup.renderOnce(); };
  /** A click on a button by its words, as the screen has it now (false, and the screen said, when it isn't there). */
  const press = async (setup: Awaited<ReturnType<typeof testRender>>, words: string): Promise<boolean> => {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    const p = at(frame, words);
    if (!p) { console.log(`(no "${words}" to click on:)\n${frame}`); return false; }
    await act(async () => { await setup.mockMouse.click(p.x, p.y); });
    return true;
  };
  for (const [w, h] of [[80, 24], [130, 42]] as const) {
    // Three cards: each whole, the pointer picks one out as it moves, a click chooses one.
    {
      const game = fresh("choose");
      const setup = await testRender(<ChooseScreen game={game} />, { width: w, height: h });
      await setup.renderOnce();
      let frame = setup.captureCharFrame();
      if (show) console.log(`choose ${w}x${h}\n${frame}`);
      const titles = offer.options.map(o => `${o.card.species} ${o.card.className} 3`);
      const missing = [...titles, ...offer.options.map(o => `HP ${o.card.hp}`), "Make my own", "Back"].filter(t => !frame.includes(t));
      checks.push([`making a character ${w}x${h}: three cards, each whole (who, HP and AC), and Make my own and Back${missing.length ? ` (not: ${missing.join(" | ")})` : ""}`, !missing.length]);
      const third = at(frame, titles[2]!)!;
      await act(async () => { await setup.mockMouse.moveTo(third.x, third.y + 4); });
      await setup.renderOnce();
      checks.push([`making a character ${w}x${h}: the pointer moving over the third card picks it out`, game.creation!.index === 2]);
      const second = at(frame, titles[1]!)!;
      await act(async () => { await setup.mockMouse.click(second.x, second.y + 3); });
      await setup.renderOnce();
      checks.push([`making a character ${w}x${h}: a click on the second card chooses it, and on to the backstory`, game.creation!.chosen === offer.options[1] && game.screen === "backstory"]);
      await setup.dispose();
    }
    // By the keys: → and Enter take the next; 1-3 take one; m makes their own; Esc goes back.
    {
      const game = fresh("choose");
      const setup = await testRender(<ChooseScreen game={game} />, { width: w, height: h });
      await setup.renderOnce();
      act(() => { setup.mockInput.pressArrow("right"); });
      await setup.renderOnce();
      act(() => { setup.mockInput.pressArrow("right"); });
      await setup.renderOnce();
      act(() => { setup.mockInput.pressEnter(); });
      await setup.renderOnce();
      checks.push([`making a character ${w}x${h}: → → Enter takes the third card`, game.creation!.chosen === offer.options[2] && game.screen === "backstory"]);
      game.screen = "choose";
      act(() => { game.emit(); });
      await setup.renderOnce();
      act(() => { setup.mockInput.pressKey("1"); });
      await setup.renderOnce();
      checks.push([`making a character ${w}x${h}: 1 takes the first`, game.creation!.chosen === offer.options[0]]);
      game.screen = "choose";
      act(() => { game.emit(); });
      await setup.renderOnce();
      await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); });
      await setup.renderOnce();
      checks.push([`making a character ${w}x${h}: Esc goes back to the name and concept`, (game.screen as string) === "create"]);
      await setup.dispose();
    }
    // Their own: a click on a species picks it, the keys a class, and Take this one takes it.
    {
      const game = fresh("choose");
      await game.makeOwn();
      const setup = await testRender(<CustomScreen game={game} />, { width: w, height: h });
      await settle(setup, 50);
      let frame = setup.captureCharFrame();
      if (show) console.log(`custom ${w}x${h}\n${frame}`);
      const orc = at(frame, "Orc")!;
      await act(async () => { await setup.mockMouse.click(orc.x, orc.y); });
      await settle(setup, 300);
      act(() => { setup.mockInput.pressArrow("right"); });
      await setup.renderOnce();
      const before = game.creation!.own!.picks.classId;
      act(() => { setup.mockInput.pressArrow("down"); });
      await settle(setup, 300);
      frame = setup.captureCharFrame();
      const own = game.creation!.own!;
      checks.push([`making their own ${w}x${h}: a click picks a species, → the classes, ↓ the next class, and what it comes to is shown`, own.picks.speciesId === "orc" && own.picks.classId !== before && own.column === 1 && !!own.option && frame.includes(`Orc ${own.option.card.className} 3`)]);
      const take = at(frame, "Take this one")!;
      await act(async () => { await setup.mockMouse.click(take.x, take.y); });
      await setup.renderOnce();
      checks.push([`making their own ${w}x${h}: Take this one takes it, on to the backstory`, game.creation!.chosen?.from === "own" && game.creation!.chosen.build.speciesId === "orc" && game.screen === "backstory"]);
      await setup.dispose();
    }
    // Writing it: typed into the box, a new paragraph, the box scrolling as it fills, a click that puts the cursor in the text.
    {
      const game = fresh("backstory");
      const setup = await testRender(<BackstoryScreen game={game} />, { width: w, height: h });
      await settle(setup);
      await act(async () => { await setup.mockInput.typeText("I kept a grain factor's books for nine years."); setup.mockInput.pressEnter(); setup.mockInput.pressEnter(); await setup.mockInput.typeText("I owe Fat Jory three crowns."); });
      await setup.renderOnce();
      checks.push([`the backstory ${w}x${h}: what's typed is in the box, paragraphs and all`, game.creation!.story === "I kept a grain factor's books for nine years.\n\nI owe Fat Jory three crowns."]);
      let frame = setup.captureCharFrame();
      const kept = at(frame, "kept")!;
      await act(async () => { await setup.mockMouse.click(kept.x - 2, kept.y); });
      await act(async () => { await setup.mockInput.typeText("honestly "); });
      await setup.renderOnce();
      checks.push([`the backstory ${w}x${h}: a click puts the cursor in the text, and what's typed goes there`, game.creation!.story.startsWith("I honestly kept a grain factor's books")]);
      // Filled past the box: it scrolls to keep the cursor in sight.
      await act(async () => { for (let i = 0; i < h; i++) { setup.mockInput.pressKey("END"); setup.mockInput.pressEnter(); await setup.mockInput.typeText(`Line ${i}.`); } });
      await setup.renderOnce();
      frame = setup.captureCharFrame();
      checks.push([`the backstory ${w}x${h}: filled past the box, it scrolls (the last line in view, the first gone)`, frame.includes(`Line ${h - 1}.`) && !frame.includes("I honestly kept")]);
      await setup.dispose();
    }
    // Offline: the GM's buttons say so, and pressing one says the GM is.
    {
      const game = fresh("backstory");
      const setup = await testRender(<BackstoryScreen game={game} />, { width: w, height: h });
      await settle(setup);
      const frame = setup.captureCharFrame();
      checks.push([`the backstory ${w}x${h}: offline, Draft one and Work it in say the GM is offline`, frame.includes("Draft one (GM offline)") && frame.includes("Work it in (GM offline)") && frame.includes("Skip") && frame.includes("Done")]);
      const draft = at(frame, "Draft one (GM offline)")!;
      await act(async () => { await setup.mockMouse.click(draft.x, draft.y); });
      await setup.renderOnce();
      checks.push([`the backstory ${w}x${h}: offline, Draft one says there's nobody to draft one`, /offline/.test(game.creation!.note ?? "") && !game.creation!.proposal && setup.captureCharFrame().includes("The GM is offline")]);
      await setup.dispose();
    }
    // Draft one: shown, not in the box, until it's taken; Keep mine leaves the box as it was.
    {
      const asked: string[] = [];
      const game = fresh("backstory", "My own first line.");
      game.ask = standIn(asked);
      const setup = await testRender(<BackstoryScreen game={game} />, { width: w, height: h });
      await settle(setup);
      let frame = setup.captureCharFrame();
      checks.push([`the backstory ${w}x${h}: with the GM about, its buttons are plain`, frame.includes("Draft one") && !frame.includes("GM offline")]);
      await press(setup, "Draft one");
      await settle(setup);
      frame = setup.captureCharFrame();
      checks.push([`the backstory ${w}x${h}: Draft one shows the draft first, and the box still has their own`, asked.includes("backstory.draft") && frame.includes("A draft: not in your box until you take it") && frame.includes("chandler's shop") && game.creation!.story === "My own first line."]);
      await press(setup, "Keep mine");
      await settle(setup);
      frame = setup.captureCharFrame();
      checks.push([`the backstory ${w}x${h}: Keep mine leaves the box as it was`, game.creation!.story === "My own first line." && frame.includes("My own first line.") && !frame.includes("chandler's shop")]);
      await press(setup, "Draft one");
      await settle(setup);
      frame = setup.captureCharFrame();
      await press(setup, "Use this");
      await settle(setup);
      frame = setup.captureCharFrame();
      checks.push([`the backstory ${w}x${h}: Use this puts the draft in the box`, game.creation!.story === DRAFT && frame.includes("chandler's shop") && frame.includes("Your backstory")]);
      // Work it in: their notes, worked in, shown first too.
      await press(setup, "Work it in");
      await settle(setup);
      frame = setup.captureCharFrame();
      checks.push([`the backstory ${w}x${h}: Work it in shows their notes worked in, before they're anyone's`, asked.includes("backstory.work") && frame.includes("Your notes, worked in") && frame.includes("Fat Jory") && game.creation!.story === DRAFT]);
      await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); });
      await settle(setup);
      checks.push([`the backstory ${w}x${h}: Esc keeps theirs`, game.creation!.story === DRAFT && !game.creation!.proposal]);
      await setup.dispose();
    }
    // The lore check: what doesn't fit, with a fix that keeps its spirit, to rewrite (back to the box) or accept (into the game).
    {
      const asked: string[] = [];
      const game = fresh("backstory", STORY);
      game.ask = standIn(asked);
      const setup = await testRender(<BackstoryScreen game={game} />, { width: w, height: h });
      await settle(setup);
      let frame = setup.captureCharFrame();
      await press(setup, "Done");
      await settle(setup);
      frame = setup.captureCharFrame();
      if (show) console.log(`lore ${w}x${h}\n${frame}`);
      checks.push([`the lore check ${w}x${h}: what doesn't fit, what the world says, and a fix that keeps its spirit`, asked.includes("backstory.check") && frame.includes("The lore check: 1 of 1") && flat(frame).includes("Your story says: \"I'm the King's nephew\"") && flat(frame).includes("A fix that keeps its spirit") && game.creation!.story === STORY]);
      await press(setup, "Rewrite it myself");
      await settle(setup);
      frame = setup.captureCharFrame();
      checks.push([`the lore check ${w}x${h}: Rewrite it myself is back in the box, the problem over it, nothing changed`, frame.includes("Rewrite this so it fits") && game.creation!.story === STORY && !game.creation!.issues]);
      await press(setup, "Done");
      await settle(setup);
      frame = setup.captureCharFrame();
      await press(setup, "Accept the fix");
      for (let i = 0; i < 100 && game.screen !== "created"; i++) await settle(setup, 50);
      checks.push([`the lore check ${w}x${h}: Accept the fix changes just those words, checks it once more, and it's into the game with the backstory on the sheet`, game.creation!.story === "I'm a cousin of a minor courtier, twice removed, though nobody at court will say so. I owe Fat Jory three crowns."
        && asked.filter(a => a === "backstory.check").length === 3
        && game.screen === "created" && game.sheet?.story?.backstory === game.creation!.story && game.session?.player.backstory?.summary === "Tamsin Vell, a minor courtier's cousin who owes Fat Jory three crowns."]);
      await setup.dispose();
    }
    // A fix that misses: the second look finds what it kept, says it's the second look, and its fix taken goes in (no third).
    {
      const asked: string[] = [];
      const game = fresh("backstory", STORY);
      const kin = { issues: [{ quote: "a cousin of a minor courtier", problem: "Still kin to the court, by another road.", fix: "a clerk's errand-boy at court" }] };
      const first = standIn(asked);
      game.ask = (async <T,>(request: Parameters<typeof first>[0]) => {
        const input = request.input.map(m => String(m.content)).join("\n");
        if (request.operation === "backstory.check" && input.includes("cousin of a minor courtier")) { asked.push(request.operation); return kin as T; }
        return first<T>(request);
      }) as NonNullable<Game["ask"]>;
      const setup = await testRender(<BackstoryScreen game={game} />, { width: w, height: h });
      await settle(setup);
      await press(setup, "Done");
      await settle(setup);
      await press(setup, "Accept the fix");
      await settle(setup);
      for (let i = 0; i < 40 && (game.creation!.busy || !game.creation!.again); i++) await settle(setup, 25);
      const frame = setup.captureCharFrame();
      if (show) console.log(`lore again ${w}x${h}\n${frame}`);
      checks.push([`the lore check ${w}x${h}: a fix that misses is caught by the second look, and says so`, frame.includes("The lore check, again, with the fixes in: 1 of 1") && flat(frame).includes("Your story says: \"a cousin of a minor courtier\"")]);
      await press(setup, "Accept the fix");
      for (let i = 0; i < 100 && game.screen !== "created"; i++) await settle(setup, 50);
      checks.push([`the lore check ${w}x${h}: the second look's fix taken goes in, with no third look`, game.screen === "created" && asked.filter(a => a === "backstory.check").length === 2
        && game.session?.player.backstory?.text === "I'm a clerk's errand-boy at court, twice removed, though nobody at court will say so. I owe Fat Jory three crowns."]);
      await setup.dispose();
    }
  }

  // What the review of character creation found, on the screens. A lore issue as a live check
  // returned one (two sentences each): at 80x24 and 100x30 its fix is on screen whole before Accept
  // takes it; a fix longer than the screen can show leaves Accept waiting (Enter rewrites instead);
  // and rewriting keeps what was said and suggested over the box.
  const SALLOW = "I clerked for two years under Master Josiah Sallow at the Royal Purveyor's office. He's a fussy, honest man who never once fiddled a figure, and he'd vouch for me to anyone. I left when my mother fell ill in Darn Fell, and I owe her doctor six crowns.";
  const SALLOW_ISSUE = {
    quote: "I clerked for two years under Master Josiah Sallow at the Royal Purveyor's office. He's a fussy, honest man who never once fiddled a figure, and he'd vouch for me to anyone.",
    problem: "Sallow is a named officer of the Royal Purveyor's office; a former clerk who worked under him for two years would be a recorded connection, and the story's named people do not know Tamsin yet. His willingness to vouch for her doesn't fit the premise either.",
    fix: "I clerked for two years in the Royal Purveyor's office, where Master Sallow's fussy ways taught me to check every figure twice. I left before I could learn whether he'd vouch for anyone but himself.",
  };
  const unboxed = (frame: string) => flat(frame.replace(/[│╭╮╰╯─┃]/g, " "));
  for (const [w, h] of [[80, 24], [100, 30]] as const) {
    {
      const asked: string[] = [];
      const game = fresh("backstory", SALLOW);
      game.ask = standIn(asked);
      game.creation!.issues = [SALLOW_ISSUE];
      const setup = await testRender(<BackstoryScreen game={game} />, { width: w, height: h });
      await settle(setup);
      const frame = setup.captureCharFrame();
      checks.push([`the lore check ${w}x${h}: a long issue's fix is on screen whole, with what the world says and the story's words`, unboxed(frame).includes(flat(`A fix that keeps its spirit: "${SALLOW_ISSUE.fix}"`)) && frame.includes("The world says:") && frame.includes("Your story says:")]);
      await press(setup, "Accept the fix");
      for (let i = 0; i < 100 && game.screen !== "created"; i++) await settle(setup, 50);
      checks.push([`the lore check ${w}x${h}: the fix seen whole is the fix taken`, (game.creation!.story.startsWith(SALLOW_ISSUE.fix) || game.creation!.story.includes("whether he'd vouch for anyone but himself")) && game.screen === "created"]);
      await setup.dispose();
    }
    {
      const game = fresh("backstory", SALLOW);
      const huge = { ...SALLOW_ISSUE, fix: "I clerked for two years in the Royal Purveyor's office, where I learned to check every figure twice. ".repeat(14).trim() };
      game.creation!.issues = [huge];
      const setup = await testRender(<BackstoryScreen game={game} />, { width: w, height: h });
      await settle(setup);
      let frame = setup.captureCharFrame();
      await press(setup, "Accept the fix");
      await settle(setup);
      frame = setup.captureCharFrame();
      checks.push([`the lore check ${w}x${h}: a fix longer than the screen can show isn't taken, and the screen says why`, game.creation!.story === SALLOW && !!game.creation!.issues && frame.includes("The fix is longer than this window can show")]);
      act(() => { setup.mockInput.pressEnter(); });
      await settle(setup);
      frame = setup.captureCharFrame();
      checks.push([`the lore check ${w}x${h}: Enter rewrites it instead, with what was said and suggested over the box`, game.creation!.rewriting === huge && game.creation!.story === SALLOW && frame.includes("Rewrite this so it fits") && frame.includes("It suggested:")]);
      await setup.dispose();
    }
    {
      const game = fresh("backstory", SALLOW);
      game.creation!.issues = [SALLOW_ISSUE];
      game.rewriteIssue();
      const setup = await testRender(<BackstoryScreen game={game} />, { width: w, height: h });
      await settle(setup);
      const frame = setup.captureCharFrame();
      checks.push([`rewriting ${w}x${h}: what the world says and the fix it suggested stay over the box, whole`, frame.includes("Rewrite this so it fits") && frame.includes("The world says:") && unboxed(frame).includes(flat(`It suggested: "${SALLOW_ISSUE.fix}"`)) && frame.includes("Your backstory")]);
      await setup.dispose();
    }
  }

  // Not checked: offline, the sheet says the backstory went in without the lore check; with the GM
  // out of reach, it says so; and when the second look couldn't be had, that the fixes weren't
  // looked at again.
  for (const [label, ask, says] of [
    ["offline", undefined, /went in as you wrote it, without the lore check: the GM is offline/],
    ["out of reach", (async () => { throw new Error("OpenRouter backstory.check HTTP 401: no auth"); }) as unknown as NonNullable<Game["ask"]>, /without the lore check: the GM couldn't be reached \(OpenRouter backstory\.check HTTP 401/],
  ] as const) {
    const game = fresh("backstory", "I mend nets on the wharves.");
    if (ask) game.ask = ask;
    await game.finishStory("I mend nets on the wharves.\nI owe Fat Jory three crowns.");
    for (let i = 0; i < 100 && game.screen !== "created"; i++) await new Promise(r => setTimeout(r, 50));
    const setup = await testRender(<CreatedScreen game={game} />, { width: 80, height: 24 });
    await settle(setup);
    const frame = setup.captureCharFrame();
    checks.push([`the backstory ${label}: into the game unchecked, and the sheet says so over it at 80x24`, game.screen === "created" && says.test(flat(frame)) && frame.includes("Character sheet") && game.session?.player.backstory?.text.includes("Fat Jory") === true]);
    await setup.dispose();
  }
  {
    const asked: string[] = [];
    const game = fresh("backstory", STORY);
    const first = standIn(asked);
    let looks = 0;
    game.ask = (async <T,>(request: Parameters<typeof first>[0]) => {
      if (request.operation === "backstory.check" && ++looks === 2) throw new Error("HTTP 503: the river is up");
      return first<T>(request);
    }) as NonNullable<Game["ask"]>;
    await game.finishStory(STORY);
    await game.acceptFix();
    for (let i = 0; i < 100 && game.screen !== "created"; i++) await new Promise(r => setTimeout(r, 50));
    checks.push([`the lore check: when the second look can't be had, the sheet says the fixes weren't checked again`, game.screen === "created" && /went in with the fixes you took, but nobody checked them again: the GM couldn't be reached \(HTTP 503/.test(game.creation!.unchecked ?? "")]);
  }

  // Choose again, from the sheet: the game made from the one turned down goes to runs/deleted, and the title doesn't offer it.
  {
    const { resumable } = await import("../save.ts");
    const { runsDir, sessionDir } = await import("../../runtime/session.ts");
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const game = fresh("backstory", "");
    await game.skipStory();
    for (let i = 0; i < 100 && game.screen !== "created"; i++) await new Promise(r => setTimeout(r, 50));
    const made = game.core!.state.id;
    const offered = resumable(50).some(r => r.id === made);
    game.chooseAgain();
    checks.push([`choosing again from the sheet: the game turned down goes to runs/deleted, and the title no longer offers it`, offered && game.screen === "choose" && !existsSync(sessionDir(made)) && existsSync(join(runsDir(), "deleted", made)) && !resumable(50).some(r => r.id === made) && !game.core]);
    game.chooseBuild(1);
    await game.skipStory();
    for (let i = 0; i < 100 && game.screen !== "created"; i++) await new Promise(r => setTimeout(r, 50));
    const again = game.core?.state.id;
    game.begin();
    checks.push([`choosing again: the one chosen next is made, and set off, it's the game to carry on`, game.screen === "explore" && !!again && again !== made && resumable(50).some(r => r.id === again) && !game.creation!.made]);
  }

  // The box at 80x24: the wheel scrolls wrapped prose three rows a notch (and back), the bar beside
  // it shows where, the title counts the words, a backstory too long for the GM stays in the box with
  // a word to say so, and when making the game failed the box says why.
  {
    const prose = Array.from({ length: 14 }, (_, i) => `Long line ${i}: the Purveyor's office kept two sets of books and I only ever saw one of them.`).join("\n");
    const game = fresh("backstory", prose);
    const setup = await testRender(<BackstoryScreen game={game} />, { width: 80, height: 24 });
    await settle(setup);
    const seen = (f: string) => [...f.matchAll(/Long line (\d+)/g)].map(m => Number(m[1]));
    let frame = setup.captureCharFrame();
    const before = Math.min(...seen(frame));
    const y = frame.split("\n").findIndex(r => r.includes(`Long line ${before + 2}`));
    for (let i = 0; i < 2; i++) { await act(async () => { await setup.mockMouse.scroll(20, y, "up"); }); await setup.renderOnce(); }
    frame = setup.captureCharFrame();
    const up = Math.min(...seen(frame));
    checks.push([`the backstory 80x24: the wheel scrolls wrapped prose up, a few rows a notch (line ${before} to ${up})`, up <= before - 2 && frame.includes("┃")]);
    await act(async () => { await setup.mockMouse.scroll(20, y, "down"); });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    checks.push([`the backstory 80x24: and back down`, Math.min(...seen(frame)) > up]);
    checks.push([`the backstory 80x24: the box's title counts the words`, frame.includes(`Your backstory · ${prose.split(/\s+/).length} words`)]);
    await setup.dispose();
  }
  {
    const long = "word ".repeat(2001).trim();
    const game = fresh("backstory", long);
    const setup = await testRender(<BackstoryScreen game={game} />, { width: 80, height: 24 });
    await settle(setup);
    await press(setup, "Done");
    await settle(setup);
    const frame = setup.captureCharFrame();
    checks.push([`the backstory 80x24: longer than the GM can be given, Done keeps it in the box and says how long it is`, game.screen === "backstory" && frame.includes("It's 2,001 words") && frame.includes("(2,000 at most)")]);
    await setup.dispose();
  }
  {
    const game = fresh("backstory", "I mend nets.");
    game.error = "Character creation failed: EACCES: permission denied, mkdir 'runs/sessions'";
    const setup = await testRender(<BackstoryScreen game={game} />, { width: 80, height: 24 });
    await settle(setup);
    checks.push([`the backstory 80x24: when making the game failed, the box says why`, setup.captureCharFrame().includes("Character creation failed: EACCES")]);
    await setup.dispose();
  }

  // The cards when the GM couldn't be reached: why, in two lines at 80 columns (what it means first).
  {
    const unreachable = (async () => { throw new Error("OpenRouter rules.builds HTTP 401: {\"error\":{\"message\":\"No auth credentials found\",\"code\":401}}"); }) as unknown as NonNullable<Game["ask"]>;
    const failedOffer = await threeBuilds("Tamsin Vell", CONCEPT, 3, { ask: unreachable });
    const game = fresh("choose");
    game.creation!.offer = failedOffer;
    const setup = await testRender(<ChooseScreen game={game} />, { width: 80, height: 24 });
    await settle(setup);
    const frame = setup.captureCharFrame();
    checks.push([`the cards 80x24: the GM out of reach, and that these are the class defaults, in two lines`, /The GM couldn't be reached, so here are three from the class defaults that best match your words/.test(flat(frame)) && frame.includes("HTTP 401")]);
    await setup.dispose();
  }

  // Their own, at 80x24: a caster's spell DC and spells are in what it comes to.
  {
    const game = fresh("choose");
    await game.makeOwn();
    await game.pickOwn({ speciesId: "dwarf", classId: "wizard", subclassId: "evoker", backgroundId: "acolyte" });
    const setup = await testRender(<CustomScreen game={game} />, { width: 80, height: 24 });
    await settle(setup, 50);
    const frame = setup.captureCharFrame();
    checks.push([`making their own 80x24: a caster's spell DC and spells are in what it comes to`, /Spells DC \d+ \+\d/.test(frame) && frame.includes("Fire Bolt")]);
    await setup.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// The zoo: its map's side panel at 80x24 and up, a sign read in full (its card), the help scrolled
// to its end at 80x24, and a long line in What happens kept by its start.

{
  const { newZoo } = await import("../../game/zoo/game.ts");
  const { EXHIBITS, placePlayer, WELCOME } = await import("../../game/zoo/explorer.ts");
  const zoo = await newZoo({ seed: 4 });
  placePlayer(zoo.state, "zoo-hall", { x: 4, y: 8 });
  for (const [w, h] of [[80, 24], [130, 42]] as const) {
    const game = new Game();
    game.core = zoo;
    game.screen = "explore";
    game.messages = [WELCOME];
    const setup = await testRender(<><ExploreScreen game={game} /><Overlay game={game} /></>, { width: w, height: h });
    await setup.renderOnce();
    let frame = setup.captureCharFrame();
    if (show) console.log(`zoo ${w}x${h}\n${frame}`);
    const side = flat(panel(frame, "The zoo").join(" "));
    const lead = game.leadTarget();
    const wanted = ["The wardrobe corner", "Wren Ashdown", "Next: ", ...(lead ? [lead.label.slice(0, 10)] : []), "Nearby"];
    const missing = wanted.filter(t => !side.includes(flat(t)));
    checks.push([`the zoo's side panel at ${w}x${h}: every line whole${missing.length ? ` (not: ${missing.join(" | ")})` : ""}`, !missing.length]);
    // A long line in What happens shows its start, and says how to read the rest.
    game.messages = [...game.messages, EXHIBITS.find(e => e.id === "wardrobe")!.text];
    await act(async () => { game.emit(); });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    const happens = flat(panel(frame, "What happens").join(" "));
    checks.push([`the zoo ${w}x${h}: a long line in What happens keeps its start ("Who you are is a build")`, happens.includes("Who you are is a build") && (w > 100 || happens.includes("r, or a click here"))]);
    // Read the wardrobe's sign: its card, title and first words in view, its robes to set off.
    await act(async () => { await game.doAt({ x: 4, y: 7 }, { id: "look@4,7", label: "Look at the sign", kind: "examine" }); });
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    if (show) console.log(`zoo sign ${w}x${h}\n${frame}`);
    const card = flat(frame);
    checks.push([`the zoo ${w}x${h}: a sign read opens its card, its title and first words in view`, game.overlay?.kind === "sign" && card.includes("The wardrobe") && card.includes("Who you are is a build") && card.includes("1 Put on")]);
    game.overlay = { kind: "help" };
    await act(async () => { game.emit(); });
    await setup.renderOnce();
    for (let i = 0; i < 20; i++) act(() => setup.mockInput.pressArrow("down"));
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    checks.push([`the zoo ${w}x${h}: the help scrolls to its last line`, flat(frame).includes("carries on your visit")]);
    await setup.dispose();
  }
}

let failed = 0;
for (const [what, ok] of checks) {
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
  if (!ok) failed++;
}
console.log(failed ? `FAIL: ${failed}` : "PASS");
process.exit(failed ? 1 : 0);
