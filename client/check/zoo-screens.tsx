// New (M6): the zoo on the title, drawn by the real App over fixture rows with its moves recorded, at 80x24 and 130x42: its line and z, its menu a step at a time (the combat ring, then who to be), a visit made with the ring and the build picked, Esc back a step at a time, a click, and the zoo not installed. And a zoo fight on the fight's screen (the recorded wolf run's rows, said to come from the ring): the side panel's n and o, again, the line-ups' list and other foes picked, and once it's over Enter fighting it again where a story's fight goes back to the map.
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../app.tsx";
import { AppModel } from "../app/model.ts";
import type { HomeRows } from "../backend.ts";
import { FightModel } from "../fight/model.ts";
import type { FightView } from "../fight/view.ts";
import { NO_ZOO } from "../title/model.ts";
import { FightPlay } from "../ui/fight.tsx";
import { zooFightOf, type FightZoo } from "../zoo/zoo.ts";
import { frameOf, WOLVES, wolvesAt } from "./fight.ts";
import { gameRow } from "./rows.ts";
import { CAERWYN, StubBackend } from "./stub.ts";
import { ZOO_ROW } from "./zoo.ts";

type Size = readonly [number, number];
const label = ([w, h]: Size) => `${w}x${h}`;
const flat = (t: string) => t.replace(/\s+/g, " ");

/** The title over these rows at a size, played with its keys and clicks. */
async function titled(rows: Partial<HomeRows>, [w, h]: Size) {
  const backend = new StubBackend(rows);
  const app = new AppModel(backend, { campaign: "caerwyn", intent: "title" });
  const setup = await testRender(<App app={app} />, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  const key = async (k: string) => { act(() => setup.mockInput.pressKey(k)); return await draw(); };
  const arrow = async (way: "up" | "down") => { act(() => setup.mockInput.pressArrow(way)); return await draw(); };
  const enter = async () => { act(() => setup.mockInput.pressEnter()); await act(async () => { await new Promise(r => setTimeout(r, 10)); }); return await draw(); };
  const esc = async () => { await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); }); return await draw(); };
  const click = async (words: string) => {
    const frame = await draw();
    const y = frame.split("\n").findIndex(r => r.includes(words));
    if (y < 0) return false;
    await act(async () => { await setup.mockMouse.click(frame.split("\n")[y]!.indexOf(words) + 1, y); });
    await draw();
    return true;
  };
  return { backend, app, setup, draw, key, arrow, enter, esc, click };
}

/** The zoo on the title (M6), at the two sizes. */
export async function checkZoo(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  for (const size of [[80, 24], [130, 42]] as const) {
    const s = await titled({ games: [gameRow(1n, "Pell Marrow", "in The Hanged Clerk", 5), { ...gameRow(2n, "Wren Ashdown", "in the zoo", 1), campaign: "zoo" }], campaigns: [CAERWYN, ZOO_ROW] }, size);
    let frame = await s.draw();
    checks.push([`the title ${label(size)}: The zoo is a line of its own and z is one of its keys; a zoo visit isn't one of the games to carry on`,
      frame.includes("The zoo") && /z the zoo/.test(flat(frame)) && frame.includes("Pell Marrow") && !frame.includes("Wren Ashdown")]);

    frame = await s.key("z");
    if (show) console.log(`the zoo's menu ${label(size)}\n${frame}`);
    checks.push([`the zoo ${label(size)}: z opens its menu over the title's lines: its exhibits, the combat ring with what it is`,
      s.app.title.zooMenu?.step === "exhibits" && frame.includes("The zoo: every feature") && frame.includes("▶ The combat ring") && flat(frame).includes("A fight on the map") && !frame.includes("New game")]);

    frame = await s.enter();
    if (show) console.log(`who to be ${label(size)}\n${frame}`);
    checks.push([`the zoo ${label(size)}: Enter on the ring asks who you are: the fighter, the wizard, the rogue, each with what they're like`,
      frame.includes("The combat ring: who are you?") && ["The fighter", "The wizard", "The rogue"].every(b => frame.includes(b)) && flat(frame).includes("ex-sergeant")]);

    await s.arrow("down");
    await s.enter();
    const made = s.backend.moves.at(-1);
    checks.push([`the zoo ${label(size)}: the wizard picked makes the visit (visit_zoo, the ring as the wizard), and the game's screen is asked for`,
      made?.name === "visitZoo" && (made.args as { exhibit: string; build: string }).exhibit === "ring" && (made.args as { build: string }).build === "wizard" && s.app.intent === "game"]);
    await s.setup.dispose();

    // Esc a step at a time; a click on the line opens it too.
    const e = await titled({ campaigns: [CAERWYN, ZOO_ROW] }, size);
    const clicked = await e.click("The zoo");
    const opened = e.app.title.zooMenu?.step === "exhibits";
    await e.enter();
    const builds = e.app.title.zooMenu?.step === "builds";
    await e.esc();
    const back = e.app.title.zooMenu?.step === "exhibits";
    frame = await e.esc();
    checks.push([`the zoo ${label(size)}: a click on its line opens it, and Esc goes back a step at a time to the title`,
      clicked && opened && builds && back && e.app.title.zooMenu === undefined && frame.includes("New game") && e.backend.moves.length === 0]);
    await e.setup.dispose();

    // A server without the zoo says so.
    const bare = await titled({ campaigns: [CAERWYN] }, size);
    frame = await bare.key("z");
    checks.push([`the zoo ${label(size)}: with the zoo not installed, its menu says so`, flat(frame).includes(flat(NO_ZOO).slice(0, 40))]);
    await bare.setup.dispose();
  }
}

/** The recorded wolf run at a frame, said to come from the zoo's ring (with Sallow and the Crakes): what the zoo reads of a fight is its board's zoo. */
const asZoo = (view: FightView): FightView => ({ ...view, board: { ...view.board, zoo: { exhibit: "ring", foes: "sallow" } } });

/** A zoo fight on the fight's screen, its zoo moves recorded. */
async function zooFight([w, h]: Size, frame: number) {
  const made: string[] = [];
  const zoo: FightZoo = {
    fight: view => zooFightOf(view, { campaigns: [ZOO_ROW] }),
    again: f => { made.push(`again ${f.exhibit.id}`); return Promise.resolve(undefined); },
    pickFoes: (f, foes) => { made.push(`foes ${f.exhibit.id} ${foes}`); return Promise.resolve(undefined); },
  };
  let outs = 0;
  const model = new FightModel(asZoo(wolvesAt(frame)), {
    move: () => Promise.resolve(undefined), turn: () => Promise.resolve(undefined), out: () => { outs++; return Promise.resolve(undefined); }, quit: () => {},
  }, { now: () => 900_000, timers: false, zoo });
  const setup = await testRender(<FightPlay fight={model} />, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  const key = async (k: string) => { await act(async () => { setup.mockInput.pressKey(k); await new Promise(r => setTimeout(r, 20)); }); return await draw(); };
  const arrow = async (way: "up" | "down") => { await act(async () => { setup.mockInput.pressArrow(way); await new Promise(r => setTimeout(r, 20)); }); return await draw(); };
  const enter = async () => { await act(async () => { setup.mockInput.pressEnter(); await new Promise(r => setTimeout(r, 20)); }); return await draw(); };
  return { model, setup, draw, key, arrow, enter, made, outs: () => outs };
}

/** A zoo fight on the fight's screen (M6), at the two sizes. */
export async function checkZooFight(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  for (const size of [[80, 24], [130, 42]] as const) {
    const f = await zooFight(size, frameOf("you: attack@3,2"));
    let frame = await f.draw();
    if (show) console.log(`a zoo fight ${label(size)}\n${frame}`);
    checks.push([`a zoo fight ${label(size)}: the side panel says it's the zoo's, n fights again and o picks other foes`,
      flat(frame).includes("The zoo: Sallow and the") && /n again · o other foes/.test(frame)]);

    await f.key("n");
    checks.push([`a zoo fight ${label(size)}: n fights it again (open_exhibit, the same foes)`, f.made.join("|") === "again ring"]);

    frame = await f.key("o");
    if (show) console.log(`other foes ${label(size)}\n${frame}`);
    const listed = frame.includes("Other foes") && ["1 Sallow and the Crakes", "2 The Crakes alone", "3 A pack of dogs"].every(l => frame.includes(l)) && frame.includes("(this fight)");
    await f.arrow("down");
    await f.enter();
    checks.push([`a zoo fight ${label(size)}: o lists the line-ups (this fight's marked), and the next one picked sets the Crakes alone`,
      listed && f.made.join("|") === "again ring|foes ring crakes" && f.model.overlay === undefined]);
    await f.setup.dispose();

    const end = await zooFight(size, WOLVES.frames.length - 1);
    frame = await end.draw();
    await end.enter();
    checks.push([`a zoo fight ${label(size)}: once it's over, Enter fights it again (not back to the map), and the keys say so`,
      flat(frame).includes("Enter fight again") && !frame.includes("Back to the map") && end.made.join("|") === "again ring" && end.outs() === 0]);
    await end.setup.dispose();
  }
}
