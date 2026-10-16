// After the prototype's src/app/smoke/screens-check.tsx at 44c6d4a, its map's checks: the explore screen drawn by the real components from an ExploreModel over the demo (which plays the simulation's part of each move with the shared map code) and over the map's rows as the scene left them (check/map.ts), the moves recorded.
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ExplorePlay, ScenePlay } from "../app.tsx";
import { mapMove, newGameOf } from "../backend.ts";
import { demoBackend } from "../demo.ts";
import { ExploreModel } from "../explore/model.ts";
import { setGlyphSet } from "../look/glyphs.ts";
import { registerLookCanvas } from "../look/opentui.ts";
import { SceneModel } from "../scene/model.ts";
import { afterRows, mapView, useCaerwyn } from "./map.ts";
import { YARD } from "./fixture.ts";

/**
 * The map between scenes (map-design §1, §3.6) at 80x24, 100x30 and 130x42. The lane in the
 * morning, as a new game begins: the map framed on the @, its title the map's; the side panel with
 * where, when, who, the lead and the way to it, who's about (Kell, Moll and Cob in the yard), and
 * what e does; What happens with the morning's words; the keys. A key walks a step (a move);
 * g walks to the lead a step at a time, through the gate into the yard, and its scene opens. A
 * right-click on the map opens what can be done there; Esc the menu, ? the help. Then the map as the
 * scene left it: in the yard, Kell beside the @, no lead. And the scene that's over, played on the
 * map: the way back to it in place of the box, which Enter takes. Glyphs are the ascii set's.
 */
export async function checkMap(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  registerLookCanvas();
  setGlyphSet("ascii");
  useCaerwyn();
  process.env.KM_APP_STEP_MS = "1";
  // The live canvas redraws between frames, as in play: React's word on each isn't news.
  const error = console.error;
  console.error = (...args: unknown[]) => { if (!/not wrapped in act/.test(String(args[0]))) error(...args); };
  try {
    for (const size of [[80, 24], [100, 30], [130, 42]] as const) {
      await laneAt(checks, size, show);
      await afterAt(checks, size, show);
    }
    await overAt(checks, show);
  } finally {
    console.error = error;
  }
}

const RIGHT = 2;
/** The bottom line. */
const under = (frame: string) => frame.split("\n").filter(r => r.trim()).at(-1)!.trim();
/** The side panel's rows, inside its border: the right-hand `side` columns of each row. */
const panel = (frame: string, side: number) => frame.split("\n").map(r => [...r].slice(-side).join("")).join("\n");
/** The map's frame (left of the side panel), above What happens. */
const mapIn = (frame: string, side: number) => { const rows = frame.split("\n"); return rows.slice(0, rows.findIndex(r => r.includes("What happens"))).map(r => [...r].slice(0, -side).join("")); };
const sideOf = (w: number) => Math.min(48, Math.max(34, Math.floor(w * 0.32)));

async function laneAt(checks: Array<[string, boolean]>, [w, h]: readonly [number, number], show: boolean): Promise<void> {
  const size = `map ${w}x${h}`;
  const game = demoBackend({ ms: 1 });
  await game.newGame(newGameOf("Pell Marrow: a hedge wizard", "wizard", "caerwyn"));
  const moves: string[] = [];
  const model = new ExploreModel(game.explore()!, { move: m => { moves.push(JSON.stringify(m.args)); return mapMove(game, m); }, quit: () => moves.push("(quit)") }, () => game.explore());
  const stop = game.onChange(() => { const view = game.explore(); if (view) act(() => model.update(view)); });
  const setup = await testRender(<ExplorePlay explore={model} />, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  const wait = async (ms: number) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
  const esc = async () => { await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); }); };
  const side = sideOf(w);
  await draw();
  let frame = await draw();
  if (show) console.log(`${size}, the lane\n${frame}`);

  // The map, framed on the @, its title the map's; the side panel; What happens; the keys.
  const map = mapIn(frame, side);
  checks.push([`${size}: the lane in the morning: the map's frame titled with the map, the @ in it`, /Caerwyn/.test(frame.split("\n")[0]!) && map.slice(1).some(r => r.includes("@"))]);
  const right = panel(frame, side);
  checks.push([`${size}: the side panel: where, when, who, the lead and the way to it`, /The granary lane/.test(right) && /Morning, on the eve of/.test(right) && /Pell Marrow/.test(right) && /The lead: The Hanged Clerk/.test(right) && /granary yard/.test(right)]);
  // Nearest first, as many as there's room for: at 80x24, Prout's things in the yard and Kell.
  checks.push([`${size}: Nearby: Kell waiting in the yard${h > 24 ? ", and the children" : ""}, nearest first`, /Nearby/.test(right) && /Sergeant Kell/.test(right) && (h <= 24 || /(Moll|Cob)/.test(right))]);
  checks.push([`${size}: What happens: the morning, and the scene's hook`, /What happens/.test(frame) && /Morning, on the eve of the Assembly\. This morning a palace clerk/.test(frame.replace(/\s+/g, " "))]);
  checks.push([`${size}: the keys: g for the lead, ? for help`, /g (the )?lead/.test(under(frame)) && /\? help/.test(under(frame))]);
  checks.push([`${size}: the side panel gives the game's number, to watch it by`, /The investigation · Game 3/.test(frame)]);

  // A key's step: a walk, one tile (a move), and the @ goes with it.
  const at = { ...model.ex.at };
  await act(async () => { setup.mockInput.pressKey("\u001b[D"); await new Promise(r => setTimeout(r, 30)); });
  frame = await draw();
  checks.push([`${size}: an arrow key walks a step: one walk move (${moves.at(-1)}), the @ moved`, moves.length === 1 && /"toward"/.test(moves[0]!) && (model.ex.at.x !== at.x || model.ex.at.y !== at.y)]);

  // The pointer on the map says what's there; a right-click opens what can be done there.
  const rows = frame.split("\n");
  let pointed: { x: number; y: number } | undefined;
  for (let y = 1; y < rows.length - 8 && !pointed; y++) for (let x = 1; x < w - side - 1 && !pointed; x++) {
    if ([...rows[y]!][x] !== "K") continue;
    await act(async () => { await setup.mockMouse.moveTo(x, y); });
    if (/^Sergeant Kell/.test(under(await draw()))) pointed = { x, y };
  }
  checks.push([`${size}: pointing at Kell on the map says who she is and what can be done (${pointed ? under(setup.captureCharFrame()).slice(0, 70) : "not found"})`, !!pointed && /right-click: Talk to Ser/.test(under(setup.captureCharFrame()))]);
  if (pointed) {
    await act(async () => { await setup.mockMouse.click(pointed!.x, pointed!.y, RIGHT); });
    frame = await draw();
    if (show) console.log(`${size}, Kell's menu\n${frame}`);
    checks.push([`${size}: a right-click on Kell: her menu, talking first`, !!model.menu && /1 Talk to Sergeant Kell/.test(frame) && /Esc never mind/.test(frame)]);
    await esc();
    checks.push([`${size}: Esc puts it away`, !model.menu]);
  }

  // Esc: the menu (back to the game, or the title); ? the help.
  await esc();
  frame = await draw();
  checks.push([`${size}: Esc opens the menu: back to the game, or to the title`, model.overlay?.kind === "menu" && /Back to the game/.test(frame) && /Back to the title/.test(frame)]);
  await esc();
  act(() => setup.mockInput.pressKey("?"));
  frame = await draw();
  checks.push([`${size}: ? opens how to play the map`, model.overlay?.kind === "help" && /Click on the map to walk there/.test(frame.replace(/\s+/g, " "))]);
  await esc();

  // g: to the lead a step at a time, and into the yard, whose scene opens.
  const before = moves.length;
  act(() => setup.mockInput.pressKey("g"));
  for (let i = 0; i < 100 && !model.ex.scene; i++) await wait(5);
  checks.push([`${size}: g walks to the lead a step at a time (${moves.length - before} moves) and into the yard: its scene opens`, moves.length - before >= 1 && model.ex.scene === "hanged-clerk" && game.view()?.title === "The Hanged Clerk" && !model.walking]);
  stop();
  await setup.dispose();
  game.close();
}

async function afterAt(checks: Array<[string, boolean]>, [w, h]: readonly [number, number], show: boolean): Promise<void> {
  const size = `map ${w}x${h}`;
  const model = new ExploreModel(mapView(afterRows()), { move: () => Promise.resolve(undefined), quit: () => {} });
  const setup = await testRender(<ExplorePlay explore={model} />, { width: w, height: h });
  await setup.renderOnce();
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  if (show) console.log(`${size}, after the scene\n${frame}`);
  const side = sideOf(w);
  const right = panel(frame, side);
  checks.push([`${size}: after the scene: in the yard, the @ on the map, Kell beside it, no lead`, /The yard behind the/.test(right) && mapIn(frame, side).some(r => r.includes("@")) && /Sergeant Kell/.test(right) && !/The lead:/.test(right)]);
  checks.push([`${size}: after the scene: What happens says what was said last`, /You come into the yard behind the King's Granary\./.test(frame.replace(/\s+/g, " "))]);
  await setup.dispose();
}

/** A scene played on the map, over: the way back to it in place of the box; Enter takes it (walk out); a spectator's is the shut box. */
async function overAt(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  const sent: string[] = [];
  const scene = new SceneModel({ ...YARD, over: true, mayType: false, onMap: true }, { say: t => sent.push(t), retry: () => {}, setSuggestions: async () => undefined, out: () => sent.push("(out)"), quit: () => {} });
  const setup = await testRender(<ScenePlay scene={scene} />, { width: 100, height: 30 });
  await setup.renderOnce();
  let frame = setup.captureCharFrame();
  if (show) console.log(`a scene over, on the map\n${frame}`);
  checks.push(["a scene over, played on the map: the way back to it in place of the box", /The scene is over/.test(frame) && /▶ Back to the map +Enter, or click here/.test(frame) && !/What do you say\?/.test(frame)]);
  act(() => setup.mockInput.pressEnter());
  await setup.renderOnce();
  checks.push(["Enter goes back to the map (walk out)", sent.join() === "(out)"]);
  await setup.dispose();

  const watching = new SceneModel({ ...YARD, over: true, mayType: false, onMap: true, watching: "Pell Marrow" }, { say: () => {}, retry: () => {}, setSuggestions: async () => undefined, out: () => sent.push("(out!)"), quit: () => {} });
  const spectator = await testRender(<ScenePlay scene={watching} />, { width: 100, height: 30 });
  await spectator.renderOnce();
  frame = spectator.captureCharFrame();
  checks.push(["a spectator's scene over: no way back of their own (their seat follows the lead's)", !/Back to the map/.test(frame) && /The scene is over\./.test(frame)]);
  await spectator.dispose();
}
