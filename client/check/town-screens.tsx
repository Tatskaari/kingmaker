// After the prototype's src/app/smoke/screens-check.tsx at 44c6d4a, its action menu's and aiming's checks (:139-235), for this client: the map drawn by the real components from an ExploreModel over the lane's rows with the wizard's catalogue and the fixture menu (check/town.ts), the moves recorded; and new, a talk's choices, the card's word with Kell and the map's fight card (town-design §3.9).
import { MouseButton } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { ExplorePlay, ScenePlay } from "../app.tsx";
import { actionId, type MapMove } from "../../shared/map/moves.ts";
import { FAREWELL, WALK_ON } from "../../shared/scene/talk.ts";
import { entriesOf, ExploreModel } from "../explore/model.ts";
import type { ExploreView } from "../explore/rows.ts";
import { setGlyphSet } from "../look/glyphs.ts";
import { registerLookCanvas } from "../look/opentui.ts";
import { Picks } from "../map/render.ts";
import { townView } from "../map/views.ts";
import { SceneModel, type SceneActions } from "../scene/model.ts";
import type { SceneView } from "../scene/view.ts";
import { exploreRow, laneRows, mapView, useCaerwyn } from "./map.ts";
import { ratWaiting, yardOver } from "./story.ts";
import { FIXTURE_TOWN, KELL_LINES, kellTalk, kellTalkOver, WIZARD_CATALOGUE } from "./town.ts";

const flat = (t: string) => t.replace(/\s+/g, " ");
/** The text inside the boxes as one line, the boxes' sides gone (a wrapped line reads whole). */
const inside = (t: string) => flat(t.replace(/[│┃]/g, " "));
/** The bottom line. */
const under = (frame: string) => frame.split("\n").filter(r => r.trim()).at(-1)!.trim();
const sideOf = (w: number) => Math.min(48, Math.max(34, Math.floor(w * 0.32)));

/** The middle of some text on screen, in cells; undefined when it isn't there. */
function at(frame: string, text: string): { x: number; y: number } | undefined {
  const rows = frame.split("\n");
  const y = rows.findIndex(r => r.includes(text));
  if (y < 0) return undefined;
  return { x: [...rows[y]!].join("").indexOf(text) + Math.floor(text.length / 2), y };
}

/** The lane in the morning (map-design §1, row 1), with the wizard's catalogue on their sheet: what the map's m offers. */
const laneWithMenu = (patch: Partial<ExploreView> = {}): ExploreView => ({ ...mapView(laneRows(exploreRow({ x: 42, y: 9 }))), catalogue: WIZARD_CATALOGUE, keep: {}, ...patch });

/**
 * The town unit's screens (town-design §4, package C), at 80x24 and 130x42: the action menu (m, a
 * click on its key, its kinds and lines whole, a dimmed line and why), aiming an area (its tiles, what
 * it catches on the bottom line, a click doing it), a right-click's "Do something…" (the menu aimed at
 * Kell already), a talk's choices over the box (said at once, kept while the GM has the floor, the
 * goodbye and walking on), its way back to the map, the card's word with Kell, and the map's fight card.
 */
export async function checkTown(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  registerLookCanvas();
  setGlyphSet("ascii");
  useCaerwyn();
  const error = console.error;
  console.error = (...args: unknown[]) => { if (!/not wrapped in act/.test(String(args[0]))) error(...args); };
  try {
    for (const size of [[80, 24], [130, 42]] as const) {
      await menuAt(checks, size, show);
      await talkAt(checks, size, show);
    }
    await cardTalk(checks, show);
    await fightCard(checks, show);
  } finally {
    console.error = error;
  }
}

async function menuAt(checks: Array<[string, boolean]>, [w, h]: readonly [number, number], show: boolean): Promise<void> {
  const size = `${w}x${h}`;
  const moves: MapMove[] = [];
  const model = new ExploreModel(laneWithMenu(), { move: m => { moves.push(m); return Promise.resolve(undefined); }, quit: () => {} }, () => undefined, () => undefined, FIXTURE_TOWN);
  const setup = await testRender(<ExplorePlay explore={model} />, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  let frame = await draw();
  frame = await draw();

  // The key at the bottom: m actions, a button.
  const button = at(frame, "m actions");
  checks.push([`menu ${size}: the keys offer m actions`, !!button]);
  if (button) await act(async () => { await setup.mockMouse.click(button.x, button.y); });
  frame = await draw();
  if (show) console.log(`menu ${size}\n${frame}`);
  checks.push([`menu ${size}: a click on "m actions" opens it`, !!model.doMenu]);
  const entries = model.doMenu ? entriesOf(model.doMenu.view) : [];
  const wanted = ["What will you do?", "Cantrips", "Fire Bolt", "1d10 fire, 120 ft", "1st level", "4/4 slots", "Shield", "a reaction: only in a fight"];
  const missing = wanted.filter(t => !flat(frame).includes(t));
  checks.push([`menu ${size}: its kinds and lines drawn whole${missing.length ? ` (not: ${missing.join(" | ")})` : ""}`, !missing.length]);
  checks.push([`menu ${size}: the first thing that can be done is picked out (${entries[model.doMenu?.index ?? -1]?.name})`, entries[model.doMenu?.index ?? -1]?.key === "spell:fire-bolt"]);

  // A dimmed line: the pointer picks it out, a click only says why.
  const shield = at(frame, "Shield");
  if (shield) await act(async () => { await setup.mockMouse.moveTo(shield.x, shield.y); });
  checks.push([`menu ${size}: the pointer picks a line out`, !!shield && entries[model.doMenu?.index ?? -1]?.key === "spell:shield"]);
  if (shield) await act(async () => { await setup.mockMouse.click(shield.x, shield.y); });
  frame = await draw();
  if (show) console.log(`menu ${size}, a dimmed line picked\n${frame}`);
  checks.push([`menu ${size}: a click on what can't be done says why, and does nothing`, !!model.doMenu && !model.aiming && entries[model.doMenu.index]?.key === "spell:shield" && /Not now: a reaction: only in a fight/.test(inside(frame)) && !moves.length]);
  const rests = entries.filter(e => e.key.startsWith("rest:"));
  checks.push([`menu ${size}: both rests greyed out, with why`, rests.length === 2 && rests.every(e => e.why === "nothing to rest off: you're whole and fresh")]);

  // An area: Sleep, by the keys (↓ to it, Enter): aiming starts at the nearest it leaves you out of.
  const sleep = entries.findIndex(e => e.key === "spell:sleep");
  await act(async () => { for (let i = 0; i < 40 && model.doMenu && model.doMenu.index !== sleep; i++) setup.mockInput.pressArrow("down"); });
  await act(async () => { setup.mockInput.pressEnter(); });
  frame = await draw();
  if (show) console.log(`aiming ${size}\n${frame}`);
  const aimed = model.aiming?.check;
  checks.push([`aiming ${size}: Sleep is aimed on the map, an area round its spot, you not in it (${aimed?.label ?? aimed?.why ?? "nothing"}, ${aimed?.area?.length ?? 0} tiles)`, !model.doMenu && model.aiming?.item.key === "spell:sleep" && aimed?.ok === true && (aimed.area?.length ?? 0) >= 4 && !(aimed.caught ?? []).includes("you")]);
  checks.push([`aiming ${size}: the bottom line says what it's aimed at${(aimed?.caught?.length ?? 0) ? ", and what it catches" : ""} (${under(frame).slice(0, 90)})`, under(frame).startsWith(`Sleep → ${aimed?.target ?? "?"}`) && (!(aimed?.caught?.length) || flat(frame).includes("catches"))]);
  // Tab goes on to the next in reach; the arrows move the aim a tile.
  const first = model.aiming ? { ...model.aiming.at } : undefined;
  await act(async () => { setup.mockInput.pressTab(); });
  const second = model.aiming ? { ...model.aiming.at } : undefined;
  checks.push([`aiming ${size}: Tab goes on to the next in reach`, !!first && !!second && (first.x !== second.x || first.y !== second.y)]);
  // An arrow moves the aim a tile, with the screen (right is south-east on the map).
  await act(async () => { setup.mockInput.pressArrow("right"); });
  checks.push([`aiming ${size}: → moves the aim a tile, with the screen`, !!second && model.aiming?.at.x === second.x + 1 && model.aiming.at.y === second.y + 1]);
  // Out of reach (65 ft up the lane): the bottom line says why, and Enter does nothing.
  await act(async () => { model.aimTo({ x: model.ex.at.x - 13, y: model.ex.at.y }); });
  frame = await draw();
  const far = model.aiming?.check;
  checks.push([`aiming ${size}: out of reach, the bottom line says so (${far?.why ?? "nothing"})`, far?.why === "out of reach: 65 ft (it reaches 60 ft)" && flat(under(frame)).includes("out of reach: 65 ft")]);
  await act(async () => { setup.mockInput.pressEnter(); });
  checks.push([`aiming ${size}: Enter there does nothing`, !!model.aiming && !moves.length]);
  // Back on what's in reach, a click on the map does it there.
  if (first) await act(async () => { model.aimTo(first); });
  const cell = cellOf(model, first!, w, h);
  if (cell) await act(async () => { await setup.mockMouse.click(cell.x, cell.y); });
  checks.push([`aiming ${size}: a click on the map casts it there (${moves.map(m => actionId(m)).join() || "nothing"})`, !!cell && moves.length === 1 && actionId(moves[0]!) === `cast_sleep@${first!.x},${first!.y}` && !model.aiming]);

  // A right-click on Kell: Do something…, the menu aimed at her already.
  const her = FIXTURE_TOWN.aim(model.menuCtx(), "spell:fire-bolt")?.targets.find(t => /Kell/.test(t.name));
  const there = her ? cellOf(model, her.at, w, h) : undefined;
  if (there) await act(async () => { await setup.mockMouse.click(there.x, there.y, MouseButton.RIGHT); });
  frame = await draw();
  const something = at(frame, "Do something…");
  checks.push([`menu ${size}: a right-click on Kell offers Do something…`, !!model.menu && !!something]);
  if (something) await act(async () => { await setup.mockMouse.click(something.x, something.y); });
  frame = await draw();
  if (show) console.log(`menu ${size}, Do something\n${frame}`);
  const aimedAtHer = model.doMenu ? entriesOf(model.doMenu.view) : [];
  checks.push([`menu ${size}: Do something… opens the menu aimed at her (${model.doMenu?.view.title})`, !!her && model.doMenu?.view.at?.x === her.at.x && /Do something: Sergeant/.test(flat(frame))
    && aimedAtHer.find(e => e.key === "spell:fire-bolt")?.id === `cast_fire-bolt@${her.at.x},${her.at.y}` && /^out of reach/.test(aimedAtHer.find(e => e.key === "shove")?.why ?? "")]);
  await act(async () => { model.closeActions(); });

  // m by its key, then Esc puts it away; m while aiming goes back to the menu.
  await act(async () => { setup.mockInput.pressKey("m"); });
  checks.push([`menu ${size}: m opens it`, !!model.doMenu]);
  await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); });
  checks.push([`menu ${size}: Esc puts it away`, !model.doMenu]);
  await setup.dispose();
}

/** Where a tile is drawn on the explore screen (the canvas inside the map's frame), as its renderer picks it. */
function cellOf(model: ExploreModel, tile: { x: number; y: number }, w: number, h: number): { x: number; y: number } | undefined {
  const view = { w: w - sideOf(w) - 2, h: h - 6 - 1 - 2 };
  const picks = new Picks();
  townView(model.ex, undefined, view, { pick: picks });
  for (let y = 0; y < view.h; y++) for (let x = 0; x < view.w; x++) { const p = picks.at(x, y); if (p?.at.x === tile.x && p.at.y === tile.y) return { x: x + 1, y: y + 1 }; }
  return undefined;
}

/** The moves the scene's screen makes, kept to read back. */
function recorder(): { sent: string[]; actions: SceneActions } {
  const sent: string[] = [];
  return {
    sent,
    actions: {
      say: text => sent.push(text), retry: () => {}, setSuggestions: async () => undefined, out: () => sent.push("(out)"), quit: () => {},
      talk: async who => { sent.push(`(talk ${who})`); return undefined; },
    },
  };
}

async function talkAt(checks: Array<[string, boolean]>, [w, h]: readonly [number, number], show: boolean): Promise<void> {
  const size = `${w}x${h}`;
  const { sent, actions } = recorder();
  let view: SceneView = kellTalk();
  const scene = new SceneModel(view, actions);
  const setup = await testRender(<ScenePlay scene={scene} />, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  let frame = await draw();
  if (show) console.log(`talk ${size}\n${frame}`);
  const lines = [...KELL_LINES, FAREWELL, WALK_ON];
  const listed = lines.map((l, i) => frame.includes(`${i + 1} ${l.slice(0, Math.min(l.length, w - 12))}`));
  checks.push([`talk ${size}: "A word with Sergeant Agnes Kell", her greeting, her lines, the goodbye and walking on, numbered over the box (${listed.map(Number).join("")})`, /A word with Sergeant Agnes Kell/.test(frame) && /Investigator\./.test(flat(frame)) && listed.every(Boolean)]);
  checks.push([`talk ${size}: the keys say a number chooses one`, /1–5 choose one/.test(under(frame))]);

  // A number says it at once (it doesn't go in the box).
  await act(async () => { setup.mockInput.pressKey("2"); });
  frame = await draw();
  checks.push([`talk ${size}: 2 says her second line at once`, sent.join() === KELL_LINES[1]]);
  // The GM has the floor: no choices to take, their rows kept so the talk doesn't jump.
  const set = (patch: Partial<SceneView>) => { view = { ...view, ...patch }; act(() => scene.update(view)); };
  const rowsBefore = frame.split("\n").findIndex(r => r.includes("What do you say?"));
  set({ phase: "replying", turn: 1, mayType: false, suggestions: [], entries: [...view.entries, { turn: 1, speaker: "player:1", kind: "player", name: view.player.name, text: KELL_LINES[1]! }] });
  frame = await draw();
  const rowsDuring = frame.split("\n").findIndex(r => r.includes("What do you say?"));
  checks.push([`talk ${size}: while the GM has the floor, no choices, and their rows kept (the box at row ${rowsBefore}, then ${rowsDuring})`, !/1 How long/.test(frame) && !frame.includes(`5 ${WALK_ON.slice(0, 20)}`) && rowsBefore === rowsDuring]);
  // The reply in and its settle done: the next lines.
  set({ phase: "done", mayType: true, suggestions: [{ kind: "say", text: "And before the watch?" }], entries: [...view.entries, { turn: 1, speaker: "gm", kind: "narration", text: "“Honestly? He was a clerk who could count,” Kell says. “That's rarer than it should be.”" }] });
  frame = await draw();
  checks.push([`talk ${size}: her reply, then her next line, the goodbye and walking on`, /1 And before the watch\?/.test(frame) && frame.includes(`2 ${FAREWELL}`) && frame.includes(`3 ${WALK_ON.slice(0, 20)}`)]);
  // Walking on: walk out of the live talk (back to the map).
  await act(async () => { setup.mockInput.pressKey("3"); });
  checks.push([`talk ${size}: walking on walks out (${sent.at(-1)})`, sent.at(-1) === "(out)"]);
  await setup.dispose();

  // The talk over (the goodbye said and answered): the way back to the map in place of the box.
  const over = new SceneModel(kellTalkOver(), actions);
  const done = await testRender(<ScenePlay scene={over} />, { width: w, height: h });
  await done.renderOnce();
  frame = done.captureCharFrame();
  if (show) console.log(`talk ${size}, over\n${frame}`);
  checks.push([`talk ${size}: over, its way on goes back to the map, with no card`, /Goodbye for now/.test(frame) && /▶ Back to the map/.test(frame) && !/What do you say\?/.test(frame)]);
  const before = sent.length;
  await act(async () => { done.mockInput.pressEnter(); });
  checks.push([`talk ${size}: Enter walks out to the map`, sent.slice(before).join() === "(out)" && over.page === "scene"]);
  await done.dispose();
}

/** Between scenes, Kell's talk on the card: t stops for a word with her (talk with her on the map). */
async function cardTalk(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  const { sent, actions } = recorder();
  const scene = new SceneModel({ ...yardOver(ratWaiting()), onMap: true }, actions);
  const setup = await testRender(<ScenePlay scene={scene} />, { width: 100, height: 30 });
  await setup.renderOnce();
  await act(async () => { setup.mockInput.pressEnter(); });
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  if (show) console.log(`between 100x30, with Kell\n${frame}`);
  checks.push(["between 100x30: Kell's talk offers t, a word with her", scene.page === "between" && /t a word with Kell/.test(frame)]);
  await act(async () => { setup.mockInput.pressKey("t"); });
  checks.push([`between 100x30: t talks to her on the map (${sent.join() || "nothing"})`, sent.join() === "(talk kell)"]);
  await setup.dispose();
}

/** A fight that broke out on the map (town-design §3.3): its stand-in's card over the map; Enter fights it out; nothing else walks. */
async function fightCard(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  const moves: MapMove[] = [];
  let fought = 0;
  const fight: NonNullable<ExploreView["fight"]> = { map: "caerwyn", seed: 6, combatants: [{ id: "player", name: "Pell Marrow", side: "player", at: { x: 42, y: 9 } }, { id: "palace-guard", name: "a palace guard", side: "enemy", statblock: "guard", at: { x: 40, y: 8 } }] };
  const model = new ExploreModel(laneWithMenu({ fight }), { move: m => { moves.push(m); return Promise.resolve(undefined); }, quit: () => {}, fightItOut: async () => { fought++; return undefined; } }, () => undefined, () => undefined, FIXTURE_TOWN);
  const setup = await testRender(<ExplorePlay explore={model} />, { width: 100, height: 30 });
  await setup.renderOnce();
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  if (show) console.log(`map 100x30, a fight\n${frame}`);
  checks.push(["map 100x30, a fight: its stand-in's card over the map, Fight it out", /Roll for initiative!/.test(frame) && /▶ Fight it out/.test(frame)]);
  await act(async () => { setup.mockInput.pressArrow("up"); setup.mockInput.pressKey("m"); });
  checks.push(["map 100x30, a fight: the arrows and m do nothing while it's up", !moves.length && !model.doMenu]);
  await act(async () => { setup.mockInput.pressEnter(); });
  checks.push([`map 100x30, a fight: Enter fights it out (${fought})`, fought === 1]);
  await setup.dispose();
}
