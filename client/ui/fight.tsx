// New (M6's screen, docs/combat-design.md §2 and §3): a fight on the map, played out. The turn-order bar across the top (everyone in initiative order as a portrait in their own glyph and colour, the one whose turn it is marked, a hit-point gauge each and their conditions as tags); the board, the place's own map drawn by the map's renderer with each moment played on it as it comes; the caption line under it saying what's happening; the fight's log; and beside the board whose turn it is: on the player's, one clear "your turn" with what they have left (action, bonus action, movement) and how to act (the action menu, m, its lines aimed on the board; a click on a blue tile walks; a click on someone opens what can be done to them), on the other side's, the keys that finish a move or skip to the player's turn. The prototype's combat screen (src/app/ui/combat.tsx at bc2ab1f) is where it started: its board, its order and its log are here, its sixteen keys and its target cursor aren't (docs/combat-design.md §6).
import { MouseButton, TextAttributes, type KeyEvent, type MouseEvent, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { steps } from "../../shared/fight/grid.ts";
import type { Unit } from "../../shared/fight/types.ts";
import { direction } from "../../shared/map/tiles.ts";
import type { Tile2 } from "../../shared/map/types.ts";
import type { Surface } from "../app/model.ts";
import { ARROW } from "../explore/words.ts";
import { drawFight } from "../fight/draw.ts";
import type { FightModel } from "../fight/model.ts";
import type { LogEntry, PlayFrame } from "../fight/player.ts";
import { hexMix } from "../look/color.ts";
import { hpGauge, tagsOf, unitActor, type Stance } from "../look/fight.ts";
import { glyphSet } from "../look/glyphs.ts";
import { mapLamps } from "../look/lamps.ts";
import { actorLook } from "../look/map.ts";
import type { LookCanvasRenderable } from "../look/opentui.ts";
import { mapDoors, overlayWanted } from "../look/overlay.ts";
import { Picks } from "../map/render.ts";
import { C } from "../theme.ts";
import { ActionMenu, menuKey, menuLayout } from "./actions.tsx";
import { BOLD, Clickable, fit, FPS, isEnter, ITALIC, Keys, SCROLLBAR, useStore, wrap, type KeyHint } from "./common.tsx";
import { sheetHeight } from "./sheet-layout.ts";
import { SheetView, type SheetHandle } from "./sheet.tsx";

/** Arrow keys and WASD step with the screen (up is up), as on the map. */
const WALK = new Set(["up", "down", "left", "right", "w", "a", "s", "d", "home", "pageup", "end", "pagedown"]);
/** The board animates faster while a moment plays, so a step a tenth of a second long is seen. */
const PLAYING_FPS = 24;
const STRIKE = TextAttributes.STRIKETHROUGH;

/** How the fight's screen is laid out at a size: the bar across the top, the board and the panel beside it, the caption line, the log, the keys. */
export function fightLayout(width: number, height: number): { barH: number; sideW: number; boardW: number; boardH: number; logH: number } {
  const barH = height >= 30 ? 3 : 2;
  const sideW = Math.min(40, Math.max(28, Math.floor(width * 0.3)));
  const logH = Math.max(5, Math.min(10, Math.floor(height * 0.2)));
  return { barH, sideW, boardW: width - sideW, boardH: height - barH - 1 - logH - 1, logH };
}

/**
 * The fight (docs/combat-design.md §2). Mostly by mouse on the player's turn: a click on a blue tile
 * walks there; a click on someone (or a right-click anywhere) opens what can be done there, aimed
 * already; m (or Enter) opens the whole action menu, each line aimed on the board, Tab between its
 * targets, Enter or a click doing it. While the other side's moves play, Space finishes the move
 * playing and F skips to the player's turn. A spectator watches the same.
 */
export function FightPlay({ fight: model }: { fight: FightModel; surface?: Surface }) {
  useStore(model);
  const { width, height } = useTerminalDimensions();
  const canvas = useRef<LookCanvasRenderable>(null);
  const picks = useRef<Picks | undefined>(undefined);
  useEffect(() => () => model.close(), [model]);
  useKeyboard(key => {
    if (model.overlay || key.defaultPrevented) return;
    key.preventDefault();
    if (model.menu) { fightMenuKey(model, key, width, height); return; }
    if (model.aim) { aimKey(model, key); return; }
    fightKey(model, key);
  });
  const view = model.view;
  const board = view.board;
  const play = model.frame();
  const glyphs = glyphSet();
  const { barH, sideW, boardW, boardH, logH } = fightLayout(width, height);
  const mine = model.canAct();
  const over = view.status !== "on" && model.player.caughtUp;
  const othersPlaying = model.othersPlaying();
  const fps = model.player.busy(model.now()) ? PLAYING_FPS : FPS;
  const turnUnit = board.units[play.turn];
  const title = ` ${view.title} · Round ${play.round} `;

  /** What's drawn in the board's cell a mouse event is over. */
  const pickAt = (e: MouseEvent) => {
    const c = canvas.current, p = picks.current;
    return c && p && p.map === view.map.id ? p.at(e.x - c.x, e.y - c.y) : undefined;
  };
  const standing = (at: Tile2) => Object.values(board.units).find(u => { const s = play.stances[u.id]; return s && s.state !== "fled" && s.at.x === at.x && s.at.y === at.y; });
  const onBoardDown = (e: MouseEvent) => {
    if (model.overlay || model.menu) return;
    const hit = pickAt(e);
    if (model.aim) {
      if (e.button === MouseButton.RIGHT) model.cancelAim();
      else if (e.button === MouseButton.LEFT && hit) { if (model.aimAt(hit.at)) model.fire(); else model.say("That isn't one of its targets: the bracketed one is, or Tab to the next."); }
      return;
    }
    if (!mine) { if (e.button === MouseButton.LEFT && !model.player.caughtUp) model.finish(); return; }
    if (!hit) return;
    const someone = standing(hit.at);
    const aimable = model.options?.actions.some(a => a.at && a.at.x === hit.at.x && a.at.y === hit.at.y && a.kind !== "move");
    if (e.button === MouseButton.RIGHT) { model.openMenu(aimable ? hit.at : undefined, e.x, e.y); return; }
    if (e.button !== MouseButton.LEFT) return;
    if (someone && someone.id !== board.pc) { if (aimable) model.openMenu(hit.at, e.x, e.y); else model.say(`${cap(someone.name)}: nothing you can do to them from here.`); return; }
    model.walkTo(hit.at);
  };
  const onBoardMove = (e: MouseEvent) => {
    const at = pickAt(e)?.at;
    if (model.aim) { if (at) model.aimAt(at); return; }
    if (at?.x === model.hover?.x && at?.y === model.hover?.y) return;
    model.hover = at;
    model.emit();
  };

  const header = over ? `It's over: ${OUTCOME[view.outcome ?? ""] ?? "it's done"}.` : view.watching ? `Watching ${view.watching}'s fight` : mine ? "YOUR TURN" : turnUnit ? `${cap(turnUnit.id === board.pc ? "your" : possessive(turnUnit.name))} turn` : "";
  const sideTitle = over ? " It's over " : mine ? " Your turn " : turnUnit ? ` ${cap(turnUnit.id === board.pc ? "Your" : possessive(turnUnit.name))} turn ` : " The fight ";
  const hot = mine && !over;

  return <box width={width} height={height} flexDirection="column" backgroundColor={C.bg}>
    <TurnBar model={model} play={play} width={width} rows={barH} />
    <box flexDirection="row" height={boardH} flexShrink={0}>
      <box width={boardW} height={boardH} border borderColor={hot ? C.borderHot : C.danger} title={title} titleAlignment="left" overflow="hidden">
        {/* The board, alive: the fire burns, the dust hangs, and each moment plays as it comes. */}
        <lookCanvas ref={canvas} width={boardW - 2} height={boardH - 2} fps={fps} live={!model.overlay}
          painter={(w, h) => {
            const doors = overlayWanted();
            const pick = new Picks({ doors });
            const lines = drawFight(model, { w, h }, { t: model.now(), glyphs, pick });
            picks.current = pick;
            return doors ? { frame: lines, doors: mapDoors(pick, lines), lamps: mapLamps(pick, lines) } : lines;
          }}
          onMouseDown={onBoardDown} onMouseMove={onBoardMove} onMouseOut={() => { if (model.hover) { model.hover = undefined; model.emit(); } }} />
      </box>
      <box width={sideW} height={boardH} border borderColor={hot ? C.borderHot : C.border} title={sideTitle} titleAlignment="left" flexDirection="column" paddingX={1} overflow="hidden">
        <SidePanel model={model} play={play} header={header} inner={sideW - 4} rows={boardH - 2} mine={mine} over={over} othersPlaying={othersPlaying} />
      </box>
    </box>
    <Caption model={model} play={play} width={width} />
    <box height={logH} flexShrink={0} border borderColor={C.border} title=" The fight " titleAlignment="left" paddingX={1} flexDirection="column" overflow="hidden"
      onMouseDown={(e: MouseEvent) => { if (e.button === MouseButton.LEFT && !model.menu && !model.aim) { model.overlay = { kind: "log" }; model.emit(); } }}>
      {logRows(model.player.log, width - 4, logH - 2).map((r, i) => <text key={i} fg={r.color} height={1} flexShrink={0} {...(r.bold ? { attributes: BOLD } : {})}>{r.text}</text>)}
    </box>
    <box height={1} paddingX={1} flexShrink={0}>
      <BottomLine model={model} play={play} width={width - 2} mine={mine} over={over} othersPlaying={othersPlaying} />
    </box>
    {model.menu ? <ActionMenu title={model.menu.at ? whatsAt(model, play, model.menu.at) : "What will you do?"} groups={model.menu.groups} index={model.menu.index} width={width} height={height} scroll={model.menu}
      anchor={model.menu.x !== undefined && model.menu.y !== undefined ? { x: model.menu.x, y: model.menu.y } : undefined}
      keys={[["↑↓", "choose"], ["Enter", "do it (▸ aims first)"], ["1–9", ""], ["Esc", "never mind", () => model.closeMenu()]]}
      onPick={i => { if (model.menu && model.menu.index !== i) { model.menu.index = i; model.emit(); } }} onChoose={i => model.chooseFromMenu(i)} onClose={() => model.closeMenu()} /> : null}
    <FightOverlay model={model} />
  </box>;
}

/** The keys with nothing open: the playback's (anyone's), the player's turn's, and what opens over the fight. */
function fightKey(model: FightModel, key: KeyEvent): void {
  const view = model.view;
  if (key.name === "space") { if (!model.player.caughtUp) model.finish(); return; }
  if (key.name === "f" && !model.canAct()) { model.skip(); return; }
  if (key.name === "c") { model.overlay = { kind: "sheet" }; model.emit(); return; }
  if (key.name === "r") { model.overlay = { kind: "log" }; model.emit(); return; }
  if (key.sequence === "?" || key.name === "f1") { model.overlay = { kind: "help" }; model.emit(); return; }
  if (key.name === "escape" || key.name === "q") { model.overlay = { kind: "menu", index: 0 }; model.emit(); return; }
  if (view.status !== "on") { if (isEnter(key) && model.player.caughtUp) void model.out(); return; }
  if (!model.canAct()) return;
  if (key.name === "m" || isEnter(key)) model.openMenu();
  else if (key.name === "e") model.endTurn();
  else if (WALK.has(key.name) && !key.ctrl) model.step(key.name);
}

/** Keys while the action menu's open: ↑↓ pick, ←→ a kind, Enter or a number does it (or aims it), Esc puts it away. */
function fightMenuKey(model: FightModel, key: KeyEvent, width: number, height: number): void {
  const menu = model.menu!;
  const layout = menuLayout(menu.groups, menu.index, width, height, menu.x !== undefined && menu.y !== undefined ? { x: menu.x, y: menu.y } : undefined, menu.top);
  const r = menuKey(key, menu.groups, menu.index, layout);
  if (r.close) model.closeMenu();
  else if (r.choose !== undefined) model.chooseFromMenu(r.choose);
  else if (r.index !== undefined && r.index !== menu.index) { menu.index = r.index; model.emit(); }
}

/** Keys while aiming: Tab (or the arrows) through the targets, Enter does it, Esc thinks better of it (m back to the menu). */
function aimKey(model: FightModel, key: KeyEvent): void {
  if (key.name === "escape" || key.name === "q") model.cancelAim();
  else if (key.name === "m") { model.cancelAim(); model.openMenu(); }
  else if (key.name === "tab") model.aimNext(key.shift);
  else if (["right", "down", "d", "s"].includes(key.name)) model.aimNext(false);
  else if (["left", "up", "a", "w"].includes(key.name)) model.aimNext(true);
  else if (isEnter(key) || key.name === "space" || key.name === "e") model.fire();
}

// ---------------------------------------------------------------------------------------------
// The turn-order bar.

/**
 * Everyone in initiative order (docs/combat-design.md §2), a portrait each: their glyph in their
 * colour on a tile of it, their name, a hit-point gauge with the numbers, and their conditions as
 * tags; the one whose turn it is marked (▶, lit gold), anyone down or gone crossed out. As the
 * fight starts the portraits come up one by one, in order.
 */
function TurnBar({ model, play, width, rows }: { model: FightModel; play: PlayFrame; width: number; rows: number }) {
  const board = model.view.board;
  const order = board.order.filter(id => board.units[id]);
  const n = Math.max(1, order.length);
  const each = Math.floor(width / n);
  const shown = play.revealed ?? n;
  return <box flexDirection="row" height={rows} width={width} flexShrink={0} backgroundColor={C.panel}>
    {order.map((id, i) => {
      const u = board.units[id]!, s = play.stances[id];
      const w = i === n - 1 ? width - each * (n - 1) : each;
      if (!s || i >= shown) return <box key={id} width={w} height={rows} />;
      return <Portrait key={id} model={model} unit={u} stance={s} active={id === play.turn && model.view.status === "on"} width={w} rows={rows} />;
    })}
  </box>;
}

function Portrait({ model, unit, stance, active, width, rows }: { model: FightModel; unit: Unit; stance: Stance; active: boolean; width: number; rows: number }) {
  const map = model.view.map.id;
  const actor = unitActor(unit, stance, map);
  const look = actor ? actorLook(actor, { t: 0, time: "afternoon", glyphs: glyphSet() }) : undefined;
  const out = stance.state !== "fighting";
  const glyph = actor?.kind === "player" ? "@" : look?.glyph ?? unit.glyph;
  const fg = out ? C.faint : actor?.kind === "player" ? unit.color || "#ffffff" : look?.fg ?? unit.color;
  const tile = active ? "#5a4600" : hexMix(unit.color || "#888888", C.bg, 0.78);
  const isYou = unit.id === model.view.board.pc;
  const name = isYou ? `${model.view.watching ? unit.name : "You"}` : unit.name.replace(/^(a|an|the) /i, m => m.toLowerCase());
  const nameW = Math.max(1, width - 6);
  const gaugeW = Math.max(3, Math.min(10, width - 10));
  const g = hpGauge(stance.hp, stance.maxHp, gaugeW, glyphSet());
  const tags = tagsOf(stance.conditions, stance.state, unit.arrested);
  const tagText = (room: number) => {
    const spans: ReactNode[] = [];
    let used = 0;
    for (const t of tags) {
      const text = `${used ? " " : ""}${t.text}`;
      if (used + text.length > room) break;
      spans.push(<span key={t.text} fg={t.color}>{text}</span>);
      used += text.length;
    }
    return spans;
  };
  const hp = `${stance.hp}/${stance.maxHp}`;
  return <box width={width} height={rows} flexDirection="column" overflow="hidden">
    <text height={1} flexShrink={0}>
      <span fg={active ? C.lead : C.faint} attributes={BOLD}>{active ? "▶" : " "}</span>
      <span fg={fg} bg={tile} attributes={BOLD}>{` ${glyph} `}</span>
      <span fg={active ? C.lead : out ? C.faint : C.text} attributes={(active ? BOLD : 0) | (out ? STRIKE : 0)}>{` ${truncate(name, nameW)}`}</span>
    </text>
    <text height={1} flexShrink={0}>
      <span fg={g.color}>{`  ${g.filled}`}</span><span fg={C.faint}>{g.empty}</span>
      <span fg={out ? C.faint : C.dim}>{` ${hp}`}</span>
      {rows < 3 ? tagText(Math.max(0, width - 3 - gaugeW - hp.length - 1)).map((t, i) => <span key={`r${i}`}>{i === 0 ? " " : ""}{t}</span>) : null}
    </text>
    {rows >= 3 ? <text height={1} flexShrink={0}><span>{"  "}</span>{tagText(width - 3)}</text> : null}
  </box>;
}

// ---------------------------------------------------------------------------------------------
// Beside the board: whose turn, what's left of it, how to act.

function SidePanel({ model, play, header, inner, rows, mine, over, othersPlaying }: {
  model: FightModel; play: PlayFrame; header: string; inner: number; rows: number; mine: boolean; over: boolean; othersPlaying: boolean;
}) {
  const view = model.view, o = model.options, board = view.board;
  const me = play.stances[board.pc];
  const out: ReactNode[] = [];
  const line = (key: string, node: ReactNode) => out.push(<text key={key} height={1} flexShrink={0}>{node}</text>);
  line("head", <span fg={over ? C.title : mine ? C.lead : C.text} attributes={BOLD}>{truncate(mine ? `▶ ${header}` : header, inner)}</span>);
  line("round", <span fg={C.dim}>{truncate(`Round ${play.round} · ${view.place}`, inner)}</span>);
  if (me && !view.watching) {
    const g = hpGauge(me.hp, me.maxHp, Math.max(4, Math.min(12, inner - 12)), glyphSet());
    line("hp", <><span fg={C.dim}>{"HP   "}</span><span fg={g.color}>{g.filled}</span><span fg={C.faint}>{g.empty}</span><span fg={C.text}>{` ${me.hp}/${me.maxHp}`}</span></>);
  }
  if (over) {
    out.push(<text key="gap" height={1} flexShrink={0}>{" "}</text>);
    for (const [i, l] of wrap(view.result?.summary ?? "", inner).slice(0, Math.max(1, rows - 7)).entries()) line(`sum${i}`, <span fg={C.text}>{l}</span>);
    out.push(<text key="gap2" height={1} flexShrink={0}>{" "}</text>);
    if (!view.watching) out.push(<Clickable key="out" height={1} flexShrink={0} onClick={() => void model.out()}><text><span fg={C.lead}>{"▶ "}</span><span fg={C.lead} attributes={BOLD}>{truncate("Back to the map", inner - 10)}</span><span fg={C.faint}>{"  Enter"}</span></text></Clickable>);
  } else if (mine && o) {
    const pip = (used: boolean) => (used ? "○ spent" : "● ready");
    line("action", <><span fg={C.dim}>{"Action      "}</span><span fg={o.actionUsed ? C.faint : C.good}>{pip(o.actionUsed)}</span></>);
    line("bonus", <><span fg={C.dim}>{"Bonus action "}</span><span fg={o.bonusActionUsed ? C.faint : C.good}>{pip(o.bonusActionUsed)}</span></>);
    const full = Math.max(o.speed ?? o.movementLeft, o.movementLeft, 5);
    const mw = Math.max(4, Math.min(10, inner - 21));
    const moved = Math.round((o.movementLeft / full) * mw);
    line("move", <><span fg={C.dim}>{"Movement    "}</span><span fg="#6fa8dc">{"█".repeat(moved)}</span><span fg={C.faint}>{"░".repeat(Math.max(0, mw - moved))}</span><span fg={C.text}>{` ${o.movementLeft} ft`}</span></>);
    out.push(<text key="gap" height={1} flexShrink={0}>{" "}</text>);
    const acts = o.actions.length;
    out.push(<Clickable key="m" height={1} flexShrink={0} onClick={() => model.openMenu()}><text><span fg={C.title}>{"m  "}</span><span fg={C.text}>{truncate(`actions (${acts})`, inner - 3)}</span></text></Clickable>);
    line("click", <><span fg={C.title}>{"   "}</span><span fg={C.dim}>{truncate(o.moves.length ? "click a tile: walk there" : "no movement left", inner - 3)}</span></>);
    line("someone", <><span fg={C.title}>{"   "}</span><span fg={C.dim}>{truncate("click someone: act on them", inner - 3)}</span></>);
    out.push(<Clickable key="e" height={1} flexShrink={0} onClick={() => model.endTurn()}><text><span fg={C.title}>{"e  "}</span><span fg={C.text}>{"end your turn"}</span></text></Clickable>);
  } else if (view.status === "on") {
    out.push(<text key="gap" height={1} flexShrink={0}>{" "}</text>);
    line("wait", <span fg={C.faint} attributes={ITALIC}>{truncate("One move at a time.", inner)}</span>);
    if (othersPlaying || !model.player.caughtUp) {
      out.push(<Clickable key="space" height={1} flexShrink={0} onClick={() => model.finish()}><text><span fg={C.title}>{"Space "}</span><span fg={C.text}>{truncate("finish this move", inner - 6)}</span></text></Clickable>);
      if (!view.watching) out.push(<Clickable key="f" height={1} flexShrink={0} onClick={() => model.skip()}><text><span fg={C.title}>{"F     "}</span><span fg={C.text}>{truncate("skip to your turn", inner - 6)}</span></text></Clickable>);
    }
  }
  const status = model.status ? wrap(model.status, inner) : [];
  const room = rows - out.length - (status.length ? 1 : 0);
  return <>
    {out}
    {status.length && room > 0 ? <text key="status" marginTop={1} fg={C.warn} height={Math.min(status.length, room)} flexShrink={0}>{status.slice(0, room).join("\n")}</text> : null}
  </>;
}

/** The caption line: what's happening now, in a line, the one doing it marked in their colour. */
function Caption({ model, play, width }: { model: FightModel; play: PlayFrame; width: number }) {
  const playing = play.playing;
  const actor = playing?.event.actor ? model.view.board.units[playing.event.actor] : undefined;
  const mark = actor ? (actor.id === model.view.board.pc ? "@" : actor.glyph) : "»";
  const text = play.caption || (model.view.status === "on" ? "" : "It's over.");
  return <box height={1} paddingX={1} flexShrink={0} backgroundColor={C.panel} onMouseDown={(e: MouseEvent) => { if (e.button === MouseButton.LEFT && !model.player.caughtUp) model.finish(); }}>
    <text>
      <span fg={actor?.color || C.lead} attributes={BOLD}>{`${mark} `}</span>
      <span fg={playing ? C.text : C.dim} {...(playing ? { attributes: BOLD } : {})}>{truncate(text, width - 4)}</span>
    </text>
  </box>;
}

/** The bottom line: what's aimed and how to do it, what the pointer's over, or the keys. */
function BottomLine({ model, play, width, mine, over, othersPlaying }: { model: FightModel; play: PlayFrame; width: number; mine: boolean; over: boolean; othersPlaying: boolean }) {
  const gap = width < 100 ? " · " : "  ·  ";
  const aimed = model.aimed();
  if (model.aim && aimed) {
    const n = model.aim.entry.options.length;
    const what = `${aimed.label}`;
    const keys = ` · Enter or click${n > 1 ? " · Tab next" : ""} · Esc cancel`;
    return <text flexShrink={0} height={1}><span fg={C.title} attributes={BOLD}>{truncate(what, width)}</span><span fg={C.dim}>{truncate(keys, Math.max(0, width - what.length))}</span></text>;
  }
  const hover = model.hover;
  if (hover && !model.menu) {
    const said = pointerLine(model, play, hover, mine);
    if (said) return <text flexShrink={0} height={1} fg={C.title}>{truncate(said, width)}</text>;
  }
  const button = (run: () => void) => run;
  const hints: KeyHint[] = over ? [["Enter", "back to the map", button(() => void model.out())], ["r", "the log"], ["?", "help"]]
    : mine ? [["m", "actions", button(() => model.openMenu())], ["click", "walk or act"], ["←↑→↓", "step"], ["e", "end turn", button(() => model.endTurn())], ["c", "sheet"], ["r", "the log"], ["?", "help"], ["Esc", "menu"]]
    : [["Space", "finish this move", button(() => model.finish())], ...(model.view.watching ? [] : [["F", "skip to your turn", button(() => model.skip())] as KeyHint]), ["r", "the log"], ["?", "help"], ["Esc", "menu"]];
  void othersPlaying;
  return <Keys items={fit(hints, width, gap.length)} gap={gap} />;
}

/** What the pointer's over, and what a click there would do. */
function pointerLine(model: FightModel, play: PlayFrame, at: Tile2, mine: boolean): string | undefined {
  const board = model.view.board;
  const me = play.stances[board.pc]?.at ?? board.units[board.pc]!.at;
  const far = `${steps(me, at) * 5} ft ${ARROW[direction(me, at)] ?? ""}`.trim();
  const who = Object.values(board.units).find(u => { const s = play.stances[u.id]; return s && s.state !== "fled" && s.at.x === at.x && s.at.y === at.y; });
  if (who) {
    const s = play.stances[who.id]!;
    if (who.id === board.pc) return `You · ${s.hp}/${s.maxHp} HP`;
    const can = mine && model.options?.actions.some(a => a.at && a.at.x === at.x && a.at.y === at.y && a.kind !== "move");
    return `${cap(who.name)} · ${s.state === "fighting" ? `${s.hp}/${s.maxHp} HP` : s.state} · ${far}${mine ? (can ? " · click: what you can do" : " · out of reach") : ""}`;
  }
  const o = model.options;
  if (!mine || !o) return undefined;
  const reach = o.moves.some(m => m.x === at.x && m.y === at.y);
  const swing = o.swings?.some(m => m.x === at.x && m.y === at.y);
  return reach ? `${far} · click to walk here${swing ? " (it draws a swing at you as you go)" : ""}` : `${far} · out of reach this turn`;
}

/** What's at a tile, for the menu's title when it's aimed there. */
function whatsAt(model: FightModel, play: PlayFrame, at: Tile2): string {
  const who = Object.values(model.view.board.units).find(u => { const s = play.stances[u.id]; return s && s.at.x === at.x && s.at.y === at.y && s.state !== "fled"; });
  if (who) return cap(who.name);
  const prop = Object.values(model.view.board.props).find(p => p.at.x === at.x && p.at.y === at.y);
  return prop ? cap(`the ${prop.name}`) : "What will you do?";
}

// ---------------------------------------------------------------------------------------------
// The log.

/** The log as rows that fit: each moment's caption (a turn's start as a heading), its dice and words under it, the newest at the bottom. */
function logRows(log: LogEntry[], width: number, rows: number): Array<{ text: string; color: string; bold?: boolean }> {
  const out: Array<{ text: string; color: string; bold?: boolean }> = [];
  for (const e of log.slice(-40)) {
    const head = e.kind === "turn" ? `— ${e.caption}` : e.caption;
    for (const t of wrap(head, width)) out.push({ text: t, color: e.kind === "turn" ? C.title : C.text, ...(e.kind === "turn" || e.kind === "over" ? { bold: true } : {}) });
    for (const l of e.lines) for (const t of wrap(`  ${l}`, width)) out.push({ text: t, color: DICE.test(l) ? C.dice : C.dim });
  }
  return out.slice(-rows);
}

/** A rules line, in the dice's colour: a roll, damage, hit points. */
const DICE = /\d+ (?:\+|-)\d+ = \d+|vs AC \d+|^Damage:|takes? \d+ \w+ damage|HP \d+\/\d+|Initiative:|save/;

// ---------------------------------------------------------------------------------------------
// What's open over the fight.

const FIGHT_HELP = [
  "Everyone fights in initiative order, the bar across the top: whose turn it is is marked, with everyone's hit points and how they are.",
  "The other side's moves play out one at a time on the board, each said on the caption line and kept in the log under it. Space finishes the move playing; F skips to your turn.",
  "On your turn: move up to your speed, a tile at a time (click a blue tile, or the arrows), and take one action, and a bonus action if you have one. A rust tile is one a walk to would draw a swing at you, leaving someone's reach: Disengage first and it won't.",
  "m (or Enter) is the action menu, by what each takes: your action (attack, spells, shove, grab, dash, dodge, disengage), your bonus action, your movement, your turn (let the dice decide, yield, end it). A line with ▸ is aimed on the board: its reach and targets lit, Tab between them, Enter or a click does it. A click on someone opens what you can do to them.",
  "e ends your turn; with nothing at all left, it ends by itself and says so. At 0 hit points you make death saves; nobody dies in these fights.",
  "c your sheet, r the whole log, Esc the menu (reduced motion, back to the title). When it's over, Enter goes back to the map.",
];

const FIGHT_MENU = ["Back to the fight", "Motion", "Back to the title (the game is kept)"];

/** What's open over the fight: the help, the log in full, the sheet, the menu. */
function FightOverlay({ model }: { model: FightModel }) {
  useStore(model);
  const { width, height } = useTerminalDimensions();
  const scroll = useRef<ScrollBoxRenderable>(null);
  const sheet = useRef<SheetHandle>(null);
  const [, redraw] = useState(0);
  useKeyboard(key => {
    const o = model.overlay;
    if (!o || key.defaultPrevented) return;
    if (o.kind === "sheet") {
      if (["escape", "return", "space", "c", "q"].includes(key.name) && !sheet.current?.wants(key)) { key.preventDefault(); model.closeOverlay(); }
      return;
    }
    key.preventDefault();
    if (o.kind === "menu") {
      const n = FIGHT_MENU.length;
      if (key.name === "up") o.index = (o.index + n - 1) % n;
      else if (key.name === "down") o.index = (o.index + 1) % n;
      else if (key.name === "escape") { model.closeOverlay(); return; }
      else if (isEnter(key)) { pickFightMenu(model, o.index); redraw(x => x + 1); return; }
      model.emit();
      return;
    }
    const by = { up: -1, down: 1, pageup: -10, pagedown: 10, home: -100000, end: 100000 }[key.name];
    if (by !== undefined) { scroll.current?.scrollBy(by); return; }
    if (["escape", "return", "space", "q", "r"].includes(key.name) || key.sequence === "?") model.closeOverlay();
  });
  const o = model.overlay;
  if (!o) return null;
  const close = () => model.closeOverlay();
  if (o.kind === "sheet") {
    const shown = model.sheet();
    const sw = width <= 100 ? width : Math.min(width - 4, 160);
    const sh = shown ? sheetHeight(shown.data, shown.who, sw - 4, (height <= 30 ? height : Math.min(height - 2, 56)) - 2, { bar: true }) + 2 : Math.min(height, 8);
    return <>
      <box position="absolute" left={0} top={0} width={width} height={height} zIndex={99} onMouseDown={close} />
      <box position="absolute" left={Math.floor((width - sw) / 2)} top={Math.floor((height - sh) / 2)} width={sw} height={sh} zIndex={100}
        border borderStyle="double" borderColor={C.borderHot} title=" Character sheet " backgroundColor={C.panel} flexDirection="column" paddingX={1}>
        {!shown ? <box flexDirection="column" flexGrow={1}><text fg={C.danger} flexGrow={1}>No character sheet here.</text><Keys items={[["Esc", "close"]]} /></box>
          : <SheetView ref={sheet} data={shown.data} who={shown.who} width={sw - 4} height={sh - 2} active onClose={close} keys={[["Esc", "close", close]]} />}
      </box>
    </>;
  }
  const w = Math.min(width - 4, 104);
  const h = Math.min(height - 2, 40);
  const box = (title: string, children: ReactNode, keys: KeyHint[], rows?: number) => { const bh = rows ? Math.min(h, Math.max(8, rows)) : h; return <>
    <box position="absolute" left={0} top={0} width={width} height={height} zIndex={99} onMouseDown={(e: MouseEvent) => { if (e.button === 0) close(); }} />
    <box position="absolute" left={Math.floor((width - w) / 2)} top={Math.max(0, Math.floor((height - bh) / 2))} width={w} height={bh} zIndex={100}
      border borderStyle="double" borderColor={C.borderHot} title={` ${title} `} backgroundColor={C.panel} flexDirection="column" paddingX={1}>
      <box flexGrow={1} minHeight={0} flexDirection="column" overflow="hidden">{children}</box>
      <Keys items={keys} />
    </box>
  </>; };
  if (o.kind === "log") {
    const rows = logRows(model.player.log, w - 6, 100000);
    return box("The fight", <scrollbox ref={scroll} flexGrow={1} scrollX={false} stickyScroll stickyStart="bottom" paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
      {rows.length ? rows.map((r, i) => <text key={i} fg={r.color} flexShrink={0} {...(r.bold ? { attributes: BOLD } : {})}>{r.text || " "}</text>) : <text fg={C.dim}>Nothing yet.</text>}
    </scrollbox>, [["↑↓ PgUp/PgDn", "scroll"], ["Esc", "close", close]]);
  }
  if (o.kind === "help") {
    const wrapped = FIGHT_HELP.map(l => wrap(l, w - 8).map((t, i) => `${i ? "  " : "· "}${t}`));
    return box("How a fight goes", <scrollbox ref={scroll} flexGrow={1} scrollX={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
      {wrapped.map((l, i) => <text key={i} fg={C.text} marginBottom={1} flexShrink={0}>{l.join("\n")}</text>)}
    </scrollbox>, [["Esc", "close", close], ["↑↓", "scroll"]]);
  }
  const label = (i: number) => (i === 1 ? `Motion: ${model.reduced ? "reduced (each move's end at once, with its caption)" : "full (each move played out)"}` : FIGHT_MENU[i]!);
  return box("Menu", <box flexDirection="column" paddingY={1}>{FIGHT_MENU.map((_, i) => <Clickable key={i} height={1} onClick={() => { pickFightMenu(model, i); redraw(x => x + 1); }}><text>
    <span fg={i === o.index ? C.lead : C.dim}>{i === o.index ? "▶ " : "  "}</span><span fg={i === o.index ? C.title : C.text} {...(i === o.index ? { attributes: BOLD } : {})}>{truncate(label(i), w - 8)}</span>
  </text></Clickable>)}</box>, [["↑↓", "choose"], ["Enter", "select"], ["Esc", "back", close]], FIGHT_MENU.length + 6);
}

/** The menu's choices: back to the fight, motion full or reduced, or the title. */
function pickFightMenu(model: FightModel, index: number): void {
  if (index === 1) { model.reduced = !model.reduced; model.emit(); return; }
  model.closeOverlay();
  if (index === 2) model.quit();
}

const OUTCOME: Record<string, string> = { victory: "you won", surrender: "they gave up", defeat: "you lost", fled: "you got away", yielded: "you yielded" };
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
const truncate = (t: string, n: number) => (n <= 0 ? "" : t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
