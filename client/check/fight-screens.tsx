// New (M6's fight screen): the fight's screen drawn by the real components from the recorded wolf run (check/fight.ts), the rows handed over frame by frame as they came, on a clock of the check's own: the other side's turn mid-move and a bite landing, the player's turn with its targets aimed, the log, finishing a move and skipping to the player's turn, the fight's start, reduced motion, the end, and a spectator's.
import { MouseButton } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { PACE, playMs } from "../../shared/fight/pace.ts";
import type { FightAct } from "../../shared/fight/types.ts";
import { actionId, type MapMove } from "../../shared/map/moves.ts";
import type { Tile2 } from "../../shared/map/types.ts";
import { drawFight } from "../fight/draw.ts";
import { FightModel } from "../fight/model.ts";
import { setGlyphSet } from "../look/glyphs.ts";
import { registerLookCanvas } from "../look/opentui.ts";
import { Picks } from "../map/render.ts";
import { fightLayout, FightPlay } from "../ui/fight.tsx";
import { frameOf, WOLVES, wolvesAt } from "./fight.ts";

const flat = (t: string) => t.replace(/\s+/g, " ");
/** The text inside the boxes as one line, their sides gone (a wrapped line reads whole). */
const inside = (t: string) => flat(t.replace(/[│┃]/g, " "));
const under = (frame: string) => frame.split("\n").filter(r => r.trim()).at(-1)!.trim();
const T0 = 50_000;

/** A fight's screen on the check's clock: the model over the recorded rows at a frame, its moves recorded, the screen drawn by the real components. */
async function staged([w, h]: readonly [number, number], frame: number, options: { me?: bigint; fromStart?: boolean } = {}) {
  let now = T0;
  const moves: MapMove[] = [];
  const turns: FightAct[] = [];
  let outs = 0;
  const model = new FightModel(wolvesAt(frame, options.me ?? 1n), {
    move: m => { moves.push(m); return Promise.resolve(undefined); },
    turn: a => { turns.push(a); return Promise.resolve(undefined); },
    out: () => { outs++; return Promise.resolve(undefined); },
    quit: () => {},
  }, { now: () => now, timers: false, fromStart: options.fromStart ?? false });
  const setup = await testRender(<FightPlay fight={model} />, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  const at = async (ms: number) => { now = T0 + ms; act(() => model.emit()); return await draw(); };
  const rows = async (next: number) => { act(() => model.update(wolvesAt(next, options.me ?? 1n))); return await draw(); };
  const key = async (k: string) => { await act(async () => { setup.mockInput.pressKey(k); await new Promise(r => setTimeout(r, 20)); }); return await draw(); };
  const layout = fightLayout(w, h);
  const board = { w: layout.boardW - 2, h: layout.boardH - 2 };
  /** Where a unit is drawn on the board now (its tile, and the screen cell), found by what the board drew where. */
  const drawn = (id: string): { tile: Tile2; cell: { x: number; y: number } } | undefined => {
    const pick = new Picks();
    drawFight(model, board, { t: now, pick });
    for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) { const p = pick.at(x, y); if (p?.actor?.id === id) return { tile: p.at, cell: { x: x + 1, y: y + 1 + layout.barH } }; }
    return undefined;
  };
  /** The colours a unit's glyph is drawn in now. */
  const colours = (id: string): { fg?: string | undefined; bg?: string | undefined } | undefined => {
    const pick = new Picks();
    const lines = drawFight(model, board, { t: now, pick });
    for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) {
      if (pick.at(x, y)?.actor?.id !== id) continue;
      let col = 0;
      for (const span of lines[y]!) { const n = [...span.text].length; if (x < col + n) { const ch = [...span.text][x - col]; if (ch !== " ") return { fg: span.fg, bg: span.bg }; break; } col += n; }
    }
    return undefined;
  };
  return { model, moves, turns, outs: () => outs, setup, draw, at, rows, key, drawn, colours, layout };
}

/**
 * The fight's screens (M6, docs/combat-design.md §2 and §3) at 80x24 and 130x42: the grey wolf's
 * turn as it comes, its walk mid-step on the board with its caption and the bar's mark on it; a bite
 * landing (the hit points dropping in the bar, the one bitten lit up, the number popping up); the
 * player's turn (YOUR TURN, what's left of it, the menu by what each line spends, an attack aimed
 * with its target bracketed and Tab to the next, done with Enter as its move, a click on a blue tile
 * walking there); the log; Space finishing a move and F skipping to the player's turn (hurry sent);
 * then the fight's start (the order coming up), reduced motion, the end and its way back to the map,
 * and a spectator's.
 */
export async function checkFight(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  registerLookCanvas();
  setGlyphSet("ascii");
  const error = console.error;
  console.error = (...args: unknown[]) => { if (!/not wrapped in act/.test(String(args[0]))) error(...args); };
  try {
    for (const size of [[80, 24], [130, 42]] as const) {
      await othersTurn(checks, size, show);
      await biteLanding(checks, size, show);
      await yourTurn(checks, size, show);
    }
    await finishAndSkip(checks, show);
    await theStart(checks, show);
    await reducedMotion(checks, show);
    await theEnd(checks, show);
    await watching(checks, show);
  } finally {
    console.error = error;
  }
}

async function othersTurn(checks: Array<[string, boolean]>, size: readonly [number, number], show: boolean): Promise<void> {
  const name = `fight ${size[0]}x${size[1]}`;
  const s = await staged(size, frameOf("step: wolf-1") - 1);
  let frame = await s.draw();
  frame = await s.rows(frameOf("step: wolf-1"));
  const walk = WOLVES.events.find(e => e.seq === 8)!;
  frame = await s.at(2.5 * PACE.tile);
  if (show) console.log(`${name}, the grey wolf mid-walk\n${frame}`);
  const wolf = s.drawn("wolf-1");
  checks.push([`${name}: the grey wolf's walk plays a tile at a time: two and a half tiles' time in, it's on the third (${wolf ? `${wolf.tile.x},${wolf.tile.y}` : "not drawn"})`, !!wolf && wolf.tile.x === walk.detail.path![2]!.x && wolf.tile.y === walk.detail.path![2]!.y]);
  checks.push([`${name}: the caption line says it as it plays`, flat(frame).includes("W A grey wolf closes in on you, 30 ft.")]);
  checks.push([`${name}: the bar marks the grey wolf's turn`, /▶ W {1,2}a grey wolf/.test(frame.split("\n")[0]!)]);
  checks.push([`${name}: beside the board, whose turn, and the keys that finish the move or skip to yours`, inside(frame).includes("A grey wolf's turn") && inside(frame).includes("Space finish this move") && inside(frame).includes("skip to your turn")]);
  checks.push([`${name}: the log has its caption, under the turn's heading`, /— Round 1: a grey wolf's turn\./.test(flat(frame)) && /A grey wolf closes in on you, 30 ft\./.test(flat(frame))]);
  // Its bite after the walk: the wolf beside the player, the swing's flash between them, then the miss.
  const biteAt = playMs(walk);
  frame = await s.at(biteAt + PACE.swing / 2);
  const there = s.drawn("wolf-1");
  checks.push([`${name}: the walk done, the wolf stands where it ended (${there ? `${there.tile.x},${there.tile.y}` : "?"}), the bite's caption up`, !!there && there.tile.x === 3 && there.tile.y === 8 && flat(frame).includes("A grey wolf snaps at you, and misses.")]);
  frame = await s.at(biteAt + PACE.swing + 100);
  if (show) console.log(`${name}, the bite missing\n${frame}`);
  checks.push([`${name}: a miss puffs "miss" off the player`, frame.includes("miss")]);
  await s.setup.renderer.destroy();
}

async function biteLanding(checks: Array<[string, boolean]>, size: readonly [number, number], show: boolean): Promise<void> {
  const name = `fight ${size[0]}x${size[1]}`;
  const bite = frameOf("step: wolf-3", 1);
  const s = await staged(size, bite - 1);
  await s.draw();
  await s.rows(bite);
  let frame = await s.at(PACE.swing - 20);
  checks.push([`${name}: before the bite lands, the player's hit points as they were (28/28 in the bar)`, frame.split("\n").slice(0, 3).join("\n").includes("28/28")]);
  frame = await s.at(PACE.swing + 30);
  if (show) console.log(`${name}, the bite landing\n${frame}`);
  checks.push([`${name}: as it lands, the bar's gauge drops to 20/28 and the caption says it`, frame.split("\n").slice(0, 3).join("\n").includes("20/28") && flat(frame).includes("A lean grey wolf bites you: 8 damage.")]);
  const lit = s.colours("player");
  checks.push([`${name}: the player lit up as it lands (${lit?.fg} on ${lit?.bg}: the flicker's red, the sparks over it)`, lit?.bg === "#b8261e"]);
  const boardRows = frame.split("\n").slice(s.layout.barH, s.layout.barH + s.layout.boardH).map(r => [...r].slice(0, s.layout.boardW).join("")).join("\n");
  checks.push([`${name}: the damage pops up over the board`, boardRows.includes("8")]);
  frame = await s.at(PACE.swing + PACE.hit + 10);
  checks.push([`${name}: the flash is over with its beat`, s.colours("player")?.bg !== "#b8261e"]);
  await s.setup.renderer.destroy();
}

async function yourTurn(checks: Array<[string, boolean]>, size: readonly [number, number], show: boolean): Promise<void> {
  const name = `fight ${size[0]}x${size[1]}`;
  const mine = frameOf("step: wolf-3", 1);
  const s = await staged(size, mine);
  let frame = await s.draw();
  frame = await s.draw();
  if (show) console.log(`${name}, your turn\n${frame}`);
  const o = s.model.options!;
  checks.push([`${name}: your turn: one clear YOUR TURN, the bar marking you`, inside(frame).includes("▶ YOUR TURN") && /▶ @ {1,2}You/.test(frame.split("\n")[0]!)]);
  checks.push([`${name}: what's left of it: action and bonus action ready, ${o.movementLeft} ft to move`, /Action\s+● ready/.test(frame) && /Bonus action ● ready/.test(frame) && frame.includes(`${o.movementLeft} ft`)]);
  checks.push([`${name}: how to act: m for the actions, e to end it`, inside(frame).includes(`m actions (${o.actions.length})`) && inside(frame).includes("e end your turn")]);
  // The menu, by what each line spends; the attack aims on the board.
  frame = await s.key("m");
  if (show) console.log(`${name}, the menu\n${frame}`);
  const wanted = ["What will you do?", "Action", "ready", "Attack ▸", "3 in reach", "Shove ▸", "Dodge", "Movement", "ft left", "Your turn", "End your turn"];
  const missing = wanted.filter(t => !flat(frame).includes(t));
  checks.push([`${name}: m opens the action menu, its lines by what they spend${missing.length ? ` (not: ${missing.join(" | ")})` : ""}`, !!s.model.menu && !missing.length]);
  frame = await s.key("\r");
  if (show) console.log(`${name}, aiming the attack\n${frame}`);
  const aimed = s.model.aimed();
  checks.push([`${name}: Attack is aimed on the board at the nearest wolf (${aimed?.id})`, !s.model.menu && !!aimed && aimed.name === "Attack" && aimed.range === 5]);
  const target = aimed?.target ? s.drawn(aimed.target) : undefined;
  const row = target ? frame.split("\n")[target.cell.y] ?? "" : "";
  checks.push([`${name}: its target bracketed where it's drawn`, !!target && [...row][target.cell.x - 1] === "[" && [...row][target.cell.x + 1] === "]"]);
  checks.push([`${name}: the bottom line says what it'll do, with Enter, Tab and Esc (${under(frame).slice(0, 70)})`, under(frame).startsWith(`${aimed?.label}`.slice(0, 20)) && under(frame).includes("Tab next") && under(frame).includes("Esc")]);
  frame = await s.key("\t");
  checks.push([`${name}: Tab aims at the next wolf in reach (${s.model.aimed()?.id})`, !!s.model.aimed() && s.model.aimed()!.id !== aimed?.id && s.model.aimed()!.name === "Attack"]);
  const doing = s.model.aimed()!;
  frame = await s.key("\r");
  checks.push([`${name}: Enter does it, as its move (${s.moves.map(m => actionId(m)).join() || "none"})`, s.moves.length === 1 && actionId(s.moves[0]!) === doing.id && !s.model.aim]);
  // A click on a blue tile walks there.
  const reach = o.moves[0];
  if (reach) {
    const pick = new Picks();
    drawFight(s.model, { w: s.layout.boardW - 2, h: s.layout.boardH - 2 }, { t: T0, pick });
    let cell: { x: number; y: number } | undefined;
    for (let y = 0; y < s.layout.boardH - 2 && !cell; y++) for (let x = 0; x < s.layout.boardW - 2; x++) { const p = pick.at(x, y); if (p && !p.actor && p.at.x === reach.x && p.at.y === reach.y) { cell = { x: x + 1, y: y + 1 + s.layout.barH }; break; } }
    if (cell) await act(async () => { await s.setup.mockMouse.click(cell!.x, cell!.y); });
    checks.push([`${name}: a click on a blue tile walks there (${s.moves.slice(1).map(m => actionId(m)).join() || "none"})`, !!cell && actionId(s.moves[1]!) === `walk@${reach.x},${reach.y}`]);
  }
  // A click on a wolf: what can be done to it, aimed there already.
  const wolf = s.drawn("wolf-1");
  if (wolf) await act(async () => { await s.setup.mockMouse.click(wolf.cell.x, wolf.cell.y); });
  frame = await s.draw();
  if (show) console.log(`${name}, a click on a wolf\n${frame}`);
  checks.push([`${name}: a click on a wolf opens what can be done to it (${s.model.menu?.entries.map(e => e.name).join(", ")})`, !!s.model.menu?.at && s.model.menu.entries.some(e => e.name === "Attack") && s.model.menu.entries.every(e => e.options.every(x => x.at?.x === wolf?.tile.x && x.at?.y === wolf?.tile.y)) && flat(frame).includes("A grey wolf")]);
  frame = await s.key("\u001b");
  await act(async () => { await new Promise(r => setTimeout(r, 80)); });
  // The log in full.
  frame = await s.key("r");
  if (show) console.log(`${name}, the log\n${frame}`);
  checks.push([`${name}: r shows the whole log: every caption so far, with its dice`, s.model.overlay?.kind === "log" && flat(frame).includes("The fight") && flat(frame).includes("A lean grey wolf bites you: 8 damage.") && flat(frame).includes("Wolf Bite: a lean grey wolf's attack on you")]);
  await s.setup.renderer.destroy();
}

async function finishAndSkip(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  const s = await staged([100, 30], frameOf("step: wolf-1") - 1);
  await s.draw();
  await s.rows(frameOf("step: wolf-1"));
  await s.at(150);
  let frame = await s.key(" ");
  if (show) console.log(`fight 100x30, a move finished\n${frame}`);
  const wolf = s.drawn("wolf-1");
  checks.push([`fight 100x30: Space finishes the move playing: the wolf at its walk's end at once, its bite next (${s.model.frame().playing?.event.caption ?? "none"})`, !!wolf && wolf.tile.x === 3 && wolf.tile.y === 8 && s.model.frame().playing?.event.seq === 9]);
  frame = await s.key("f");
  checks.push([`fight 100x30: F skips to your turn: everything played at once, and the simulation asked to play the rest at once (${s.turns.join() || "nothing sent"})`, s.model.player.caughtUp && s.turns.includes("hurry") && flat(frame).includes("A grey wolf snaps at you, and misses.")]);
  frame = await s.rows(frameOf("step: wolf-2"));
  checks.push([`fight 100x30: skipping, the big wolf's turn comes in played`, s.model.player.caughtUp]);
  await s.setup.renderer.destroy();
}

async function theStart(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  const s = await staged([100, 30], frameOf("start"), { fromStart: true });
  let frame = await s.at(150);
  if (show) console.log(`fight 100x30, the start\n${frame}`);
  checks.push([`fight 100x30: a fight seen starting plays from its first moment: "Roll for initiative!" on the caption line`, flat(frame).includes("Roll for initiative! A lean grey wolf goes first")]);
  const bar = frame.split("\n")[0]!;
  checks.push([`fight 100x30: the order comes up one by one: early on, the first portrait only`, bar.includes("a lean grey wolf") && !bar.includes("a big grey wolf")]);
  frame = await s.at(PACE.start - 10);
  checks.push([`fight 100x30: by the start's end, everyone`, frame.split("\n")[0]!.includes("a big grey wolf")]);
  await s.setup.renderer.destroy();
}

async function reducedMotion(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  const s = await staged([100, 30], frameOf("step: wolf-1") - 1);
  s.model.reduced = true;
  await s.draw();
  let frame = await s.rows(frameOf("step: wolf-1"));
  frame = await s.at(5);
  if (show) console.log(`fight 100x30, reduced motion\n${frame}`);
  const wolf = s.drawn("wolf-1");
  checks.push([`fight 100x30: reduced motion: the walk's end at once, with its caption`, !!wolf && wolf.tile.x === 3 && wolf.tile.y === 8 && flat(frame).includes("A grey wolf closes in on you, 30 ft.")]);
  frame = await s.at(PACE.caption + 5);
  checks.push([`fight 100x30: reduced motion: the next caption after the caption's time, and nothing flying`, flat(frame).includes("A grey wolf snaps at you, and misses.") && !s.model.player.fx.busy(T0 + PACE.caption + 5)]);
  // The menu's Motion line says it, and turns it back.
  frame = await s.key("\u001b");
  await act(async () => { await new Promise(r => setTimeout(r, 80)); });
  frame = await s.draw();
  checks.push([`fight 100x30: Esc's menu has Motion: reduced`, s.model.overlay?.kind === "menu" && flat(frame).includes("Motion: reduced")]);
  await s.setup.renderer.destroy();
}

async function theEnd(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  const last = WOLVES.frames.length - 1;
  const s = await staged([100, 30], last);
  let frame = await s.draw();
  frame = await s.draw();
  if (show) console.log(`fight 100x30, the end\n${frame}`);
  checks.push([`fight 100x30: the end: it's over, how it went, and the way back to the map`, inside(frame).includes("It's over: you won.") && inside(frame).includes("Back to the map") && /A lean grey wolf went down|went down/.test(inside(frame))]);
  frame = await s.key("\r");
  checks.push([`fight 100x30: Enter goes back to the map (walk out)`, s.outs() === 1]);
  await s.setup.renderer.destroy();
}

async function watching(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  const s = await staged([100, 30], frameOf("step: wolf-3", 1), { me: 2n });
  let frame = await s.draw();
  frame = await s.draw();
  if (show) console.log(`fight 100x30, a spectator's\n${frame}`);
  checks.push([`fight 100x30: a spectator watches: whose fight it is, no YOUR TURN, no skipping the player's turns`, inside(frame).includes("Wren Ashdown's turn") && inside(frame).includes("Watching Wren Ashdown") && !inside(frame).includes("YOUR TURN") && !inside(frame).includes("Your turn") && !inside(frame).includes("skip to your turn")]);
  frame = await s.key("m");
  checks.push([`fight 100x30: a spectator's m opens nothing`, !s.model.menu]);
  const wolf = s.drawn("wolf-1");
  if (wolf) await act(async () => { await s.setup.mockMouse.click(wolf.cell.x, wolf.cell.y, MouseButton.RIGHT); });
  checks.push([`fight 100x30: nor a click on a wolf`, !s.model.menu && !s.moves.length]);
  await s.setup.renderer.destroy();
}
