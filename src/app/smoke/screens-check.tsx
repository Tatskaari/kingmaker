/**
 * The map, the fight, the sheet, the title and the End, drawn by the real screens and played with
 * the mouse, no model calls (a ready-made character offline): the map's and the fight's side panels
 * at 80x24 and up, every line drawn whole (a squeezed panel draws its lines over each other); the
 * map's keys at the bottom as buttons; a click on a blue tile moves there, a click on someone on the
 * other side aims at them and a click on your target attacks, and the fight's options are buttons;
 * a spell on the sheet clicked shows what it is, and ← Back (or Esc) puts the sheet back as it was;
 * the title's New game and Continue, and the End's way back, by a click.
 *
 *   KM_RUNS_DIR=runs/check OPENROUTER_API_KEY=offline node --experimental-ffi --no-warnings --import tsx src/app/smoke/screens-check.tsx [--show]
 */
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { sceneById } from "../../../scenes/index.ts";
import { pregenSession, PREGENS, TacticalFight } from "../../game/combat/index.ts";
import { mapFights } from "../../game/fights.ts";
import { registerLookCanvas } from "../../game/look/opentui.ts";
import { leadTarget, town } from "../../game/town.ts";
import { Game as Core, type GameState } from "../../game/play.ts";
import { exploreState } from "../../game/town.ts";
import { nearby, Picks, screenOf } from "../../game/map/index.ts";
import { fightView } from "../../game/views.ts";
import { presentCast } from "../../runtime/brief.ts";
import { forceEnding } from "../../runtime/engine.ts";
import { buildWorld, joinWorld } from "../../world/scene-world.ts";
import { Game } from "../game.ts";
import type { Resumable } from "../save.ts";
import { leadWay, TIME_WORDS } from "../story.ts";
import { wrap } from "../ui/common.tsx";
import { CombatScreen } from "../ui/combat.tsx";
import { EndScreen } from "../ui/end.tsx";
import { ExploreScreen } from "../ui/explore.tsx";
import { Overlay } from "../ui/overlay.tsx";
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
  for (const [hint, what, done] of [["g the lead", "g walks to the lead", () => did.includes("lead")], ["c sheet", "c opens the sheet", () => did.includes("sheet")], ["j notebook", "j opens the notebook", () => game.overlay?.kind === "journal"], ["Esc menu", "Esc opens the menu", () => game.overlay?.kind === "menu"]] as const) {
    game.overlay = undefined;
    const p = at(frame, hint);
    if (p) await act(async () => { await setup.mockMouse.click(p.x, p.y); });
    checks.push([`80x24, the map's keys at the bottom are buttons: ${what}`, !!p && done()]);
  }
  await setup.dispose();
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
