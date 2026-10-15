/**
 * The map, the fight, a scene's place, the title and the End, drawn by the real screens and played
 * with the mouse, no model calls (a ready-made character offline): the map's and the fight's side
 * panels at 80x24 and up, every line drawn whole (a squeezed panel draws its lines over each other);
 * the map's keys at the bottom as buttons; a click on a blue tile moves there, a click on someone on
 * the other side aims at them and a click on your target attacks, and the fight's options are
 * buttons; in a scene at 80x24 and 130x42, pointing at someone in the place (and in the list under
 * it) says who on the bottom line (the GM's spinner and the game's word stay up), a right-click
 * opens their menu without covering the conversation, a glance notes what anyone could see (never
 * the GM's descriptions), a deed goes as the turn, an attack takes two choices, a right-click on
 * the open menu opens what's under it and chooses nothing, a click starts the line with their
 * name, and Tab and Enter do it by key while the box keeps its keys (Enter on what the mouse only
 * rests on opens nothing); the help scrolls by key; the title's New game and Continue, and the
 * End's way back, by a click.
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
import { aimFor, leadTarget, town } from "../../game/town.ts";
import { Game as Core, type GameState } from "../../game/play.ts";
import { exploreState } from "../../game/town.ts";
import { actorsHere, nearby, Picks, screenOf } from "../../game/map/index.ts";
import { fightView, townView } from "../../game/views.ts";
import { presentCast } from "../../runtime/brief.ts";
import { forceEnding } from "../../runtime/engine.ts";
import { inventory, startingPurse } from "../../world/inventory.ts";
import { buildWorld, joinWorld } from "../../world/scene-world.ts";
import { entriesOf, Game, type Line } from "../game.ts";
import type { Resumable } from "../save.ts";
import { leadWay, TIME_WORDS } from "../story.ts";
import { wrap } from "../ui/common.tsx";
import { CombatScreen } from "../ui/combat.tsx";
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
