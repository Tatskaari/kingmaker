// After the prototype's src/app/smoke/screens-check.tsx at 44c6d4a, its reporting checks (/report, the Esc menu's line, b on the map): reporting a problem drawn by the real App over fixture rows (M5), its reports kept by a host stood in for.
import { gunzipSync } from "node:zlib";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { Report } from "../../shared/report/format.ts";
import { App } from "../app.tsx";
import { AppModel } from "../app/model.ts";
import type { HomeRows } from "../backend.ts";
import { FightModel } from "../fight/model.ts";
import { setGlyphSet } from "../look/glyphs.ts";
import { registerLookCanvas } from "../look/opentui.ts";
import { attachReporting } from "../report/attach.ts";
import type { Reporting } from "../report/file.ts";
import { FightPlay } from "../ui/fight.tsx";
import { ASK } from "../ui/report.tsx";
import { frameOf, wolvesAt } from "./fight.ts";
import { YARD } from "./fixture.ts";
import { laneRows, mapView, useCaerwyn } from "./map.ts";
import { gameRow } from "./rows.ts";
import { StubBackend } from "./stub.ts";

/**
 * Reporting a problem (V16, M5) at 80x24 and 130x42, from each place it's asked for: the title's b
 * and its line (about the latest game); a scene's /report (the question over the scene, the screen
 * kept as it was, what's typed going in the question's line and not the scene's box, Esc never
 * minding), and /report with its words, sent at once; the map's b, and its Esc menu's Report a
 * problem…, which keeps the map as it was before the menu; a fight's b and its menu's line. Each
 * report is what a host would keep (where, the screen, the words), and where it went is said.
 */

type Size = readonly [number, number];
const label = ([w, h]: Size) => `${w}x${h}`;
/** How often the screen is noted here (a host notes it once a second). */
const NOTED_MS = 100;
const flat = (t: string) => t.replace(/\s+/g, " ");
const SAID = "Saved runs/reports/20261018-120000-game1.json.gz: tell Claude 'report 20261018-120000-game1.json.gz'";
/** Where it went, said in the box (wrapped as the box wraps it). */
const saidIn = (frame: string) => flat(frame.replace(/[│║]/g, " ")).includes("tell Claude 'report");

/** A host that keeps each report it's given, unpacked. */
function keeping(): { reporting: Reporting; reports: Report[] } {
  const reports: Report[] = [];
  return {
    reports,
    reporting: {
      build: () => ({ host: "terminal" }), settings: () => ({ env: {} }), keys: () => [],
      keep: async ({ bytes }) => { reports.push(JSON.parse(gunzipSync(bytes).toString("utf8")) as Report); return { file: "x", said: SAID }; },
    },
  };
}

/** The App over these rows at a size, reporting to a host stood in for, with its keys and its frame. */
async function app(rows: Partial<HomeRows>, [w, h]: Size, set: (backend: StubBackend) => void = () => {}) {
  const backend = new StubBackend(rows);
  set(backend);
  const host = keeping();
  const model = new AppModel(backend, { campaign: "caerwyn", intent: rows.seat ? "game" : "title", reporting: host.reporting });
  const setup = await testRender(<App app={model} />, { width: w, height: h });
  // The screen noted every 100 ms, not every second: a beat of the check's own, so a busy machine's late timer doesn't miss one.
  const stop = attachReporting(model, setup.renderer as never, NOTED_MS);
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  const settle = async () => { await act(async () => { await new Promise(r => setTimeout(r, 30)); }); return await draw(); };
  const key = async (k: string) => { act(() => setup.mockInput.pressKey(k)); return await settle(); };
  const type = async (text: string) => { await act(async () => { await setup.mockInput.typeText(text); }); return await settle(); };
  const enter = async () => { act(() => setup.mockInput.pressEnter()); return await settle(); };
  const esc = async () => { await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); }); return await draw(); };
  const arrow = async (way: "up" | "down") => { act(() => setup.mockInput.pressArrow(way)); return await draw(); };
  /** Enter on the question, and its report filed: the frame once it says where it went. */
  const send = async () => {
    act(() => setup.mockInput.pressEnter());
    for (let i = 0; i < 100 && model.report.state?.step !== "said"; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    return await settle();
  };
  const done = async () => { stop(); setup.renderer.destroy(); };
  return { backend, model, host, setup, draw, settle, key, type, enter, send, esc, arrow, done };
}

export async function checkReports(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  registerLookCanvas();
  setGlyphSet("ascii");
  useCaerwyn();
  // The map's live canvas redraws between frames, as in play: React's word on each isn't news.
  const error = console.error;
  console.error = (...args: unknown[]) => { if (!/not wrapped in act/.test(String(args[0]))) error(...args); };
  try {
    for (const size of [[80, 24], [130, 42]] as const) {
      await fromTheTitle(checks, size, show);
      await inAScene(checks, size, show);
      await onTheMap(checks, size, show);
      await inAFight(checks, size);
    }
  } finally {
    console.error = error;
  }
}

async function fromTheTitle(checks: Array<[string, boolean]>, size: Size, show: boolean): Promise<void> {
  const t = await app({ games: [gameRow(3n, "Pell Marrow", "in The Hanged Clerk", 5), gameRow(4n, "Wren Ashdown", "in The Drowned Rat", 50)] }, size);
  let frame = await t.draw();
  checks.push([`reporting ${label(size)}: the title has Report a problem… as a line of its own`, frame.includes("Report a problem…")]);
  frame = await t.key("b");
  if (show) console.log(`reporting from the title ${label(size)}\n${frame}`);
  checks.push([`reporting ${label(size)}: b on the title asks what went wrong, over the title`, flat(frame).includes(flat(ASK).slice(0, 30)) && t.model.screen === "title"]);
  await t.type("The tagline fell off");
  frame = await t.send();
  const r = t.host.reports[0];
  checks.push([`reporting ${label(size)}: from the title, it's about the latest game, and says where it went`,
    saidIn(frame) && r?.where.screen === "title" && r.where.latest === true && r.words === "The tagline fell off" && (r.game as { error?: string } | undefined)?.error !== undefined]);
  frame = await t.enter();
  checks.push([`reporting ${label(size)}: Enter puts it away, back to the title`, !frame.includes("Report saved") && frame.includes("New game")]);
  await t.done();
}

async function inAScene(checks: Array<[string, boolean]>, size: Size, show: boolean): Promise<void> {
  const s = await app({ games: [gameRow(1n, "Pell Marrow", "in The Hanged Clerk", 5)], seat: { playerId: 1n, gameId: 1n, sceneId: 7n } }, size, b => { b.scene = YARD; });
  let frame = await s.draw();
  const before = frame;
  await s.type("/report");
  frame = await s.enter();
  if (show) console.log(`/report ${label(size)}\n${frame}`);
  checks.push([`reporting ${label(size)}: /report asks what went wrong, over the scene`, flat(frame).includes(flat(ASK).slice(0, 40)) && frame.includes("The Hanged Clerk")]);
  frame = await s.type("Kell asked twice");
  const boxed = /What do you say\?[^\n]*\n[^\n]*Kell asked twice/.test(frame);
  checks.push([`reporting ${label(size)}: what's typed goes in the question's line, not the scene's box`, frame.includes("Kell asked twice") && !boxed && s.backend.moves.length === 0]);
  frame = await s.esc();
  checks.push([`reporting ${label(size)}: Esc never minds: the question goes, nothing's kept`, !frame.includes("What went wrong?") && s.host.reports.length === 0]);

  await s.type("/report Cob walked off the edge of the world");
  frame = await s.send();
  const r = s.host.reports[0];
  checks.push([`reporting ${label(size)}: /report with its words sends them at once, and says where it went`,
    r?.words === "Cob walked off the edge of the world" && saidIn(frame) && r.where.screen === "scene" && r.where.overlay === "/report" && r.where.scene?.title === "The Hanged Clerk"]);
  checks.push([`reporting ${label(size)}: the screen kept is the scene as it was`, !!r?.screens.now && r.screens.now.includes("The Hanged Clerk") && flat(r.screens.now).includes(flat(before.split("\n")[0]!).trim().slice(0, 20))]);
  await s.done();
}

async function onTheMap(checks: Array<[string, boolean]>, size: Size, show: boolean): Promise<void> {
  const m = await app({ games: [gameRow(1n, "Pell Marrow", "in the granary lane", 5)], seat: { playerId: 1n, gameId: 1n, sceneId: undefined } }, size, b => { b.map = mapView(laneRows()); });
  let frame = await m.draw();
  frame = await m.key("b");
  if (show) console.log(`b on the map ${label(size)}\n${frame}`);
  checks.push([`reporting ${label(size)}: b on the map asks what went wrong, over the map`, flat(frame).includes(flat(ASK).slice(0, 40)) && m.model.screen === "explore"]);
  await m.esc();
  // Noted while the map's up (attach.ts notes the screen, here every NOTED_MS), then the Esc menu's last line.
  await act(async () => { await new Promise(r => setTimeout(r, NOTED_MS * 5)); });
  frame = await m.esc();
  const menu = frame.includes("Report a problem…");
  await m.arrow("down");
  await m.arrow("down");
  frame = await m.enter();
  checks.push([`reporting ${label(size)}: the map's Esc menu has Report a problem… last, and it asks what went wrong`, menu && flat(frame).includes(flat(ASK).slice(0, 40))]);
  await m.type("The lead pointed the wrong way");
  frame = await m.send();
  const r = m.host.reports[0];
  checks.push([`reporting ${label(size)}: from the menu, the screen kept is the map as it was before the menu`, !!r?.screens.now && !r.screens.now.includes("Back to the title") && r.where.overlay === "menu" && r.where.map?.key === "caerwyn"]);
  frame = await m.enter();
  checks.push([`reporting ${label(size)}: on the map, What happens keeps where it went too`, m.model.explore?.messages.at(-1) === SAID]);
  await m.done();
}

async function inAFight(checks: Array<[string, boolean]>, [w, h]: Size): Promise<void> {
  const asked: string[] = [];
  const model = new FightModel(wolvesAt(frameOf("you: attack@3,2")), {
    move: () => Promise.resolve(undefined), turn: () => Promise.resolve(undefined), out: () => Promise.resolve(undefined), quit: () => {}, report: from => asked.push(from),
  }, { now: () => 900_000, timers: false });
  const setup = await testRender(<FightPlay fight={model} />, { width: w, height: h });
  const press = async (k: () => void, ms = 20) => { await act(async () => { k(); await new Promise(r => setTimeout(r, ms)); }); await setup.renderOnce(); return setup.captureCharFrame(); };
  await press(() => setup.mockInput.pressKey("b"));
  await press(() => setup.mockInput.pressEscape(), 80);
  for (let i = 0; i < 3; i++) await press(() => setup.mockInput.pressArrow("down"));
  const frame = await press(() => setup.mockInput.pressEnter());
  checks.push([`reporting ${label([w, h])}: in a fight, b asks for a report, and so does the menu's last line`, asked.join("|") === "b|menu" && !frame.includes("Motion")]);
  setup.renderer.destroy();
}
