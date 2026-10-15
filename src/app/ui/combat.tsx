import { MouseButton, type InputRenderable, type MouseEvent } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef, useState, type ReactNode } from "react";
import { showLine, type LogLine } from "../../game/combat/index.ts";
import type { LookCanvasRenderable } from "../../game/look/opentui.ts";
import { actorsHere, direction, Picks, SCREEN_KEYS, steps } from "../../game/map/index.ts";
import { exploreState } from "../../game/town.ts";
import type { Tile2 } from "../../game/types.ts";
import { fightLooks, fightView } from "../../game/views.ts";
import type { Game } from "../game.ts";
import { ARROW } from "../story.ts";
import { C } from "../theme.ts";
import { BOLD, Clickable, fit, FPS, isEnter, ITALIC, Keys, Spinner, useGame, wrap, type KeyHint } from "./common.tsx";

/** What the fight's keys and buttons do (a key and its button do the same thing). */
type Command = "attack" | "close" | "cast" | "use" | "dash" | "dodge" | "disengage" | "leave" | "auto" | "options" | "end" | "target" | "sheet" | "help" | "menu";

/**
 * Do one of the fight's commands: an action of the fight's own (by its action id, the ones the QA
 * console plays with), or a picker over it (the spells, every option), or the target, the sheet,
 * the help, the menu. Said why not, when it can't be done now.
 */
export function fightCommand(game: Game, command: Command): void {
  const fight = game.fight;
  if (!fight || game.overlay) return;
  // A command (by its key, or its button) has the keys back from the box.
  game.fightBox = false;
  const has = (id: string) => game.fightActions.some(a => a.id === id);
  const target = game.target();
  const t = target?.id;
  const show = (status: string) => { game.status = status; game.emit(); };
  const act = (id: string, otherwise: string) => { if (has(id)) void game.combatAct(id); else show(otherwise); };
  switch (command) {
    case "target": {
      const n = game.fightTargets().length;
      game.targetIndex = (Math.min(game.targetIndex, n - 1) + 1) % Math.max(1, n); game.targetId = undefined;
      game.emit();
      return;
    }
    case "sheet": void game.showSheet(); return;
    case "help": game.overlay = { kind: "help" }; game.emit(); return;
    case "menu": game.overlay = { kind: "menu", index: 0 }; game.emit(); return;
  }
  // The rest are the player's, on their turn.
  const view = fight.view();
  if (view.over || !view.turn?.isPlayer || game.busy) return;
  switch (command) {
    case "options": game.overlay = { kind: "actions", index: 0, top: 0 }; game.emit(); break;
    case "attack": act(`attack_${t}`, t ? `${target!.name} is out of reach (z closes in), or your attack's spent.` : "Nobody to attack."); break;
    case "close": act(`close_${t}`, "You're as close as you'll get this turn."); break;
    case "cast": {
      const spells = fight.options().spells;
      if (spells.length) { game.overlay = { kind: "spells", spells: spells.map(s => ({ id: s.id, name: s.name, level: s.level })), index: 0 }; game.emit(); }
      else show("No spells to cast just now. You do, however, have whatever's in your hands.");
      break;
    }
    case "use": { const use = game.fightActions.find(a => a.id.startsWith("use_")); if (use) void game.combatAct(use.id); else show("Nothing in reach to knock over. Get next to a lantern or a brazier."); break; }
    case "dash": act("dash", "You can't dash now."); break;
    case "dodge": act("dodge", "You can't dodge now."); break;
    case "disengage": act("disengage", "You can't disengage now."); break;
    case "leave": act("leave", "There's no way out where you're standing."); break;
    case "auto": act("auto", "Not now."); break;
    case "end": void game.combatAct("end_turn"); break;
  }
}

/** The fight's keys: which command each one is (Enter is the box's: it opens it for typing). */
const KEYS: Record<string, Command> = {
  a: "attack", z: "close", c: "cast", u: "use", d: "dash", g: "dodge", x: "disengage", l: "leave", f: "auto", m: "options", e: "end", space: "end", tab: "target", s: "sheet", escape: "menu",
};

/**
 * How the fight's screen is laid out at a size: the side panel's width; on the left, the
 * battlefield, the log under it, and the box to type in under that (three rows, as a scene's).
 */
export function fightLayout(width: number, height: number): { sideW: number; mapW: number; mapH: number; logH: number; boxH: number } {
  const sideW = Math.min(50, Math.max(38, Math.floor(width * 0.34)));
  const logH = Math.max(7, Math.floor(height * 0.3));
  const boxH = 3;
  return { sideW, mapW: width - sideW, mapH: height - logH - boxH - 1, logH, boxH };
}

/** The fight's log as rows of the box: the dice in theirs, whose turn as a heading, what was typed in the player's, words in the speaker's colour. */
function logRows(lines: LogLine[], width: number, rows: number, colours: Record<string, string>, extra: Array<{ text: string; color: string }>): Array<{ text: string; color: string }> {
  const last = lines.length - 1;
  const colour = (l: LogLine, i: number) => l.kind === "dice" ? C.dice : l.kind === "turn" ? C.title : l.kind === "said" ? (l.who === "player" ? C.player : colours[l.who ?? ""] ?? C.name)
    : i === last && !extra.length ? C.text : l.kind === "narration" && l.who === "gm" ? C.gm : C.dim;
  return [...lines.map((l, i) => ({ text: showLine(l), color: colour(l, i) })), ...extra]
    .flatMap(s => wrap(s.text, width).map(text => ({ text, color: s.color }))).slice(-rows);
}

/**
 * A fight on the map: the battlefield drawn by the map's renderer (where you can move tinted, the
 * dust and the fire, a cursor on your target), the initiative order, your options, and the log.
 * Every action is one of the fight's own action ids, the ones the QA console plays with.
 *
 * Mostly by mouse: click a blue tile to move there; click someone on the other side to aim at them,
 * and click the one you're aiming at to attack; click a name in the initiative to aim at them; the
 * options in the side panel and the keys at the bottom are buttons. The pointer lights up the tile
 * under it, and the bottom line says what a click there would do. Every key still works.
 */
export function CombatScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const canvas = useRef<LookCanvasRenderable>(null);
  const picks = useRef<Picks | undefined>(undefined);
  // The tile under the pointer, on the battlefield.
  const [hover, setHover] = useState<Tile2 | undefined>(undefined);
  // The box: what's typed in it (as of the last render; the input holds what came in since).
  const [draft, setDraft] = useState("");
  const input = useRef<InputRenderable>(null);
  const fight = game.fight;
  const view = fight?.view();
  const actions = game.fightActions;
  const has = (id: string) => actions.some(a => a.id === id);
  const targets = game.fightTargets();
  const target = game.target();
  const myTurn = !!view && !view.over && !!view.turn?.isPlayer && !game.busy;
  // The box has the keys while it's on (and the fight isn't over: then Enter goes on).
  const boxOn = game.fightBox && !!view && !view.over;
  const typed = () => input.current?.value ?? draft;
  const clear = () => { setDraft(""); if (input.current) input.current.value = ""; };
  const focusBox = (on: boolean) => { if (game.fightBox === on || (on && view?.over)) return; game.fightBox = on; if (on) game.fightReply = undefined; game.emit(); };
  /** Send what's in the box: on the player's turn, once the others have gone (until then it waits in the box, and says why). */
  const send = (value: string) => {
    if (!value.trim()) return;
    if (!view?.turn?.isPlayer || game.busy) { game.fightReply = view?.over ? "The fight's over." : "Not yet: it isn't your turn. It'll keep."; game.emit(); return; }
    clear();
    void game.combatSay(value);
  };
  useKeyboard(key => {
    if (game.overlay || game.screen !== "combat" || !fight || !view || key.defaultPrevented) return;
    if (boxOn) {
      // Typing: Esc gives the keys back to the fight (what's typed stays); Tab still picks a target; the rest are the box's (its Enter sends).
      if (key.name === "escape") { key.preventDefault(); focusBox(false); }
      else if (key.name === "tab") { key.preventDefault(); game.targetIndex = (Math.min(game.targetIndex, targets.length - 1) + (key.shift ? targets.length - 1 : 1)) % Math.max(1, targets.length); game.targetId = undefined; game.emit(); }
      return;
    }
    key.preventDefault();
    if (view.over) {
      // Over: an Enter goes on to what comes of it (or a click); nothing else does.
      if (isEnter(key)) void game.afterCombat();
      return;
    }
    // Enter (or a click on the box) to type what you do or say.
    if (isEnter(key)) { focusBox(true); return; }
    if (key.sequence === "?") { fightCommand(game, "help"); return; }
    if (key.name === "tab") { game.targetIndex = (Math.min(game.targetIndex, targets.length - 1) + (key.shift ? targets.length - 1 : 1)) % Math.max(1, targets.length); game.targetId = undefined; game.emit(); return; }
    if (/^[1-9]$/.test(key.sequence ?? "") && Number(key.sequence) <= targets.length) { game.targetIndex = Number(key.sequence) - 1; game.targetId = undefined; game.emit(); return; }
    if (!myTurn && !["s", "escape"].includes(key.name)) return;
    const d = SCREEN_KEYS[key.name];
    const me = fight.state().units[fight.state().pc]!;
    if (d && ["up", "down", "left", "right"].includes(key.name)) { void game.combatAct(`move_${me.at.x + d[0]}_${me.at.y + d[1]}`); return; }
    const command = KEYS[key.name];
    if (command) fightCommand(game, command);
  });
  if (!fight || !view || !game.core) return <box width={width} height={height}><Spinner label="Setting out the battlefield…" /></box>;
  const G = fight.state();
  const me = G.units[G.pc]!;
  const { sideW, logH, mapW, mapH, boxH } = fightLayout(width, height);
  const options = myTurn ? fight.options() : undefined;
  const moves = options && options.movementLeft >= 5 ? options.moves : [];
  const marks = moves.map(at => ({ at, color: "#2f6fb0" }));
  const shown = {
    centre: me.state === "fighting" ? me.at : view.turn ? G.units[view.turn.id]?.at ?? me.at : me.at, marks, ...(target ? { cursor: target.at } : {}), time: game.story.time,
  };
  const fx = game.fightFx();
  // A fight that broke out on the map: the town stands round it (its stalls, Kell, the people who stood
  // back). A fight from the map with a world of its own (a zoo ring's: the session's while it lasts) has that round it.
  const scenery = game.core.state.fightOnMap && !game.session?.world ? actorsHere(exploreState(game.core.state)) : undefined;
  const inner = sideW - 4;
  // Everyone's letter, as the battlefield has them.
  const looks = fightLooks(G.units);
  // The log, with the GM's line as it streams in and the answer to a line that came to nothing under it.
  const live = game.fightLive ? [{ text: `${game.fightLive.text || "…"}▍`, color: game.fightLive.who === "gm" ? C.gm : looks[game.fightLive.who]?.color ?? C.name }] : [];
  const reply = game.fightReply ? [{ text: `(${game.fightReply})`, color: C.warn }] : [];
  const log = logRows(view.log, mapW - 4, logH - 2, Object.fromEntries(Object.entries(looks).map(([id, l]) => [id, l.color])), [...live, ...reply]);
  const attack = target ? actions.find(a => a.id === `attack_${target.id}`) : undefined;
  const turnName = view.turn ? (view.turn.isPlayer ? "Your turn" : `${view.turn.name}'s turn`) : "";

  /** Who's on the other side, still in it, that can be aimed at (by id), and their place in the targets. */
  const aimable = (id: string | undefined) => (id ? targets.findIndex(t => t.id === id) : -1);
  /** What's drawn in the battlefield's cell a mouse event is over: the tile, and who's there. */
  const pickAt = (e: MouseEvent) => {
    const c = canvas.current, p = picks.current;
    return c && p ? p.at(e.x - c.x, e.y - c.y) : undefined;
  };
  /** Who's standing on a tile (in it still, or down there). */
  const standing = (at: Tile2) => Object.values(G.units).find(u => u.at.x === at.x && u.at.y === at.y && u.state !== "fled");
  /** Aim at someone (a click on them, or on their name); a click on the one already aimed at attacks them. */
  const aimAt = (id: string, attackIfAimed: boolean) => {
    const i = aimable(id);
    if (i < 0) return;
    if (attackIfAimed && target?.id === id) { fightCommand(game, "attack"); return; }
    game.targetIndex = i; game.targetId = undefined;
    game.status = `Aiming at ${targets[i]!.name}${myTurn ? ": click again to attack." : "."}`;
    game.emit();
  };
  const onMapDown = (e: MouseEvent) => {
    if (game.overlay || e.button !== MouseButton.LEFT || view.over) return;
    const hit = pickAt(e);
    if (!hit) return;
    // Whoever's drawn there (a letter), or whoever stands on the tile.
    const who = (hit.actor ? G.units[hit.actor.id] : undefined) ?? standing(hit.at);
    if (who && aimable(who.id) >= 0) { aimAt(who.id, true); return; }
    if (!myTurn) return;
    if (moves.some(m => m.x === hit.at.x && m.y === hit.at.y)) { void game.combatAct(`move_${hit.at.x}_${hit.at.y}`); return; }
    if (who) return;
    game.status = options && options.movementLeft >= 5 ? `You can't get there this turn: ${options.movementLeft} ft of movement left (the blue tiles).` : "No movement left this turn.";
    game.emit();
  };
  const onMapMove = (e: MouseEvent) => {
    const at = pickAt(e)?.at;
    if (at?.x === hover?.x && at?.y === hover?.y) return;
    setHover(at);
  };
  /** What a click on the hovered tile would do, for the bottom line. */
  const pointer = (): string | undefined => {
    if (!hover) return undefined;
    const who = standing(hover);
    const far = `${steps(me.at, hover) * 5} ft ${ARROW[direction(me.at, hover)] ?? ""}`.trim();
    if (who?.id === G.pc) return "You.";
    if (who && aimable(who.id) >= 0) {
      const aimed = target?.id === who.id;
      const how = !aimed ? "click to aim at them" : !myTurn ? "your target" : attack ? `click to attack: ${attack.label.replace(/^Attack [^(]*/, "").replace(/[()]/g, "")}` : "out of reach (z closes in)";
      return `${who.name} · ${far} · ${how}`;
    }
    if (who) return `${who.name} · ${far}${who.state !== "fighting" ? ` · ${who.state}` : ""}`;
    if (myTurn && moves.some(m => m.x === hover.x && m.y === hover.y)) return `${far} · click to move here`;
    return myTurn ? `${far} · out of reach this turn` : undefined;
  };
  const said = pointer();
  // The side panel, a row at a time in the rows it has (a squeezed box draws its lines over each
  // other): who's in it, the target, whose turn, the options, what just couldn't be done. With room
  // to spare, titles of their own, gaps between, and the hint on changing the target.
  const reach = attack ? attack.label.replace(/^Attack [^(]*/, "").replace(/[()]/g, "") : "out of reach";
  const aimRest = target ? ` · ${steps(me.at, target.at) * 5} ft ${ARROW[direction(me.at, target.at)] ?? ""} · ${reach}` : "";
  const aimText = target ? `${target.name}${aimRest}` : "Nobody left to aim at.";
  const turnTitle = view.over ? "It's over" : turnName;
  const turnText = view.over ? game.core.currentFight?.result()?.summary ?? ""
    : myTurn ? `HP ${me.hp}/${me.maxHp} · ${view.player.movementLeft} ft to move · action ${view.player.actionUsed ? "used" : "ready"}${view.player.slots ? ` · ${view.player.slots}` : ""}`
    : me.state === "down" ? "You're down. Death saves…" : "Wait for it…";
  const optionRows = view.over ? 1 : myTurn ? 6 : 0;
  const statusRows = game.status ? wrap(game.status, inner).length : 0;
  const inside = height - 1 - 2;
  const sections = 1 + 1 + (optionRows ? 1 : 0) + (statusRows ? 1 : 0);
  const titled = inside >= view.order.length + 1 + wrap(aimText, inner).length + 1 + 1 + wrap(turnText, inner).length + optionRows + statusRows + sections;
  const aimRows = wrap(titled ? aimText : `Target: ${aimText}`, inner).length;
  const turnRows = wrap(titled ? turnText : `${turnTitle}: ${turnText}`, inner).length;
  const gapRows = titled || inside - (view.order.length + aimRows + turnRows + optionRows + statusRows) >= sections ? 1 : 0;
  // The keys at the bottom: the fight's own, or (while the box has the keys) the box's.
  const keys: KeyHint[] = boxOn ? [
    ["Enter", "send", () => send(typed())], ["Esc", "the keys", () => focusBox(false)], ["words", "are said"], ["*deeds*", "or commands are done"], ["Tab", "target"],
  ] : [
    ...(view.over ? [] : [["Enter", "type", () => focusBox(true)] as KeyHint]),
    ["click", "move or aim"], ["a", "attack", () => fightCommand(game, "attack")], ["Tab", "target", () => fightCommand(game, "target")], ["c", "cast", () => fightCommand(game, "cast")],
    ["m", "options", () => fightCommand(game, "options")], ["e", "end turn", () => fightCommand(game, "end")], ["s", "sheet", () => fightCommand(game, "sheet")], ["?", "help", () => fightCommand(game, "help")], ["Esc", "menu", () => fightCommand(game, "menu")],
  ];
  const gap = width < 100 ? " · " : "  ·  ";
  // What the box says while it's empty: how to get to it, or what goes in it (as much as fits).
  const boxW = mapW - 4;
  const them = target?.name.split(" ").at(-1) ?? "them";
  const hint = view.over ? "The fight's over: Enter goes on."
    : boxOn ? [`Words are said; *asterisks* or (brackets), or a command (attack ${them}, end turn), are done`, `Words are said; *deeds* or attack ${them} are done`, "Words, *deeds*, or: attack them", "Words, or *deeds*"].find(t => t.length <= boxW) ?? ""
    : ["Enter (or a click) to type what you say or do, as in a scene", "Enter or a click to type what you do", "Enter: type"].find(t => t.length <= boxW) ?? "";
  // A click anywhere but the box gives the keys back to the fight.
  return <box width={width} height={height} flexDirection="column" backgroundColor={C.bg} onMouseDown={() => focusBox(false)}>
    <box flexDirection="row" height={height - 1}>
      <box width={mapW} flexDirection="column">
        <box height={mapH} border borderColor={C.danger} title={` ${G.map.name} · Round ${view.round} `} titleAlignment="left" overflow="hidden">
          {/* The battlefield, alive: the fire burns, the dust drifts, blows spark and spells fly as they happen. */}
          <lookCanvas ref={canvas} width={mapW - 2} height={mapH - 2} fps={FPS} live={!game.overlay}
            painter={(w, h, now) => {
              const pick = new Picks();
              const lines = fightView(fight, game.session, { w, h }, { ...shown, t: now, pick, ...(hover ? { hover } : {}), ...(fx ? { effects: fx } : {}), ...(scenery ? { scenery } : {}) });
              picks.current = pick;
              return lines;
            }}
            onMouseDown={onMapDown} onMouseMove={onMapMove} onMouseOut={() => setHover(undefined)} />
        </box>
        <box height={logH} border borderColor={C.border} title=" The fight " titleAlignment="left" paddingX={1} flexDirection="column" overflow="hidden">
          {log.map((l, i) => <text key={i} fg={l.color}>{l.text}</text>)}
        </box>
        {/* The box to type in, as a scene's: Enter or a click gives it the keys, Enter sends, Esc gives them back. */}
        <box height={boxH} flexShrink={0} border borderColor={boxOn ? C.borderHot : C.border} title={boxOn ? " What do you do? " : " Type "} titleAlignment="left" paddingX={1}
          onMouseDown={(e: MouseEvent) => { if (e.button !== MouseButton.LEFT) return; e.stopPropagation(); focusBox(true); }}>
          {/* What's sent is what the input holds as Enter comes: letters in the same read as it are in the input, not yet the draft. */}
          <input ref={input} value={draft} onInput={setDraft} onSubmit={(value: unknown) => send(typeof value === "string" ? value : typed())}
            focused={boxOn && !game.overlay && game.screen === "combat"} placeholder={hint} />
        </box>
      </box>
      <box width={sideW} border borderColor={C.border} title=" Initiative " flexDirection="column" paddingX={1} overflow="hidden">
        {view.order.map(o => {
          const look = o.id === G.pc ? { glyph: "@", color: "#ffffff" } : looks[o.id]!;
          const now = o.active && !view.over;
          const out = o.state !== "fighting";
          const row = <text>
            <span fg={now ? C.lead : C.faint}>{now ? "▶" : " "}</span>
            <span fg={C.faint}>{` ${String(o.initiative).padStart(2)} `}</span>
            <span fg={out ? C.faint : look.color} attributes={BOLD}>{`${out ? (o.state === "surrendered" ? "!" : "x") : look.glyph} `}</span>
            <span fg={out ? C.faint : o.id === target?.id ? C.danger : C.text}>{truncate(o.id === G.pc ? `${o.name} (you)` : o.name, inner - 18)}</span>
            <span fg={out ? C.faint : o.id === G.pc ? C.good : C.dim}>{` ${out ? (G.flags[`walked:${o.id}`] ? "walked off" : o.state) : o.health}`}</span>
          </text>;
          // A click on someone on the other side aims at them.
          return aimable(o.id) >= 0 ? <Clickable key={o.id} height={1} flexShrink={0} onClick={() => aimAt(o.id, false)}>{row}</Clickable> : <box key={o.id} height={1} flexShrink={0}>{row}</box>;
        })}
        <box flexDirection="column" marginTop={gapRows} flexShrink={0}>
          {titled ? <text fg={C.title} height={1} flexShrink={0}>Target</text> : null}
          <text wrapMode="word" height={aimRows} flexShrink={0}>
            {titled ? null : <span fg={C.title}>{"Target: "}</span>}
            <span fg={target ? C.danger : C.faint} {...(target ? { attributes: BOLD } : {})}>{target?.name ?? "Nobody left to aim at."}</span>
            <span fg={C.dim}>{aimRest}</span>
          </text>
          {titled ? <text fg={C.faint} height={1} flexShrink={0}>Click, Tab or 1–9 to change</text> : null}
        </box>
        <box flexDirection="column" marginTop={gapRows} flexShrink={0}>
          {titled ? <text fg={C.title} height={1} flexShrink={0}>{turnTitle}</text> : null}
          <text wrapMode="word" height={turnRows} flexShrink={0}>
            {titled ? null : <span fg={C.title}>{`${turnTitle}: `}</span>}
            <span fg={view.over ? C.text : myTurn ? C.dim : C.faint} {...(!view.over && !myTurn ? { attributes: ITALIC } : {})}>{turnText}</span>
          </text>
        </box>
        {view.over ? <Clickable marginTop={gapRows} height={1} flexShrink={0} onClick={() => void game.afterCombat()}>
          <text><span fg={C.lead}>{"▶ "}</span><span fg={C.lead} attributes={BOLD}>{game.core?.state.fightOnMap ? "Back to the map" : "See what comes of it"}</span><span fg={C.faint}>{"   Enter, or click"}</span></text>
        </Clickable> : myTurn ? <box flexDirection="column" marginTop={gapRows} flexShrink={0}>
          {/* The options, as buttons: what a key does, a click does too. */}
          <Row><Hint k="click" what="a blue tile to move there" /></Row>
          <Row><Act game={game} k="a" what="attack" command="attack" on={!!attack} /><Act game={game} k="z" what="close in" command="close" on={has(`close_${target?.id}`)} /><Act game={game} k="c" what="cast" command="cast" on={!!options?.spells.length} /></Row>
          <Row><Act game={game} k="u" what="knock over" command="use" on={actions.some(a => a.id.startsWith("use_"))} /><Act game={game} k="d" what="dash" command="dash" on={has("dash")} /><Act game={game} k="g" what="dodge" command="dodge" on={has("dodge")} /></Row>
          <Row><Act game={game} k="x" what="disengage" command="disengage" on={has("disengage")} /><Act game={game} k="e" what="end turn" command="end" on /></Row>
          <Row><Act game={game} k="f" what="let the dice decide" command="auto" on={has("auto")} />{has("leave") ? <Act game={game} k="l" what="leave" command="leave" on lead /> : null}</Row>
          <Row><Act game={game} k="m" what={`every option (${actions.length})`} command="options" on /></Row>
        </box> : null}
        {game.status ? <text fg={C.warn} marginTop={gapRows} wrapMode="word" height={statusRows} flexShrink={0}>{game.status}</text> : null}
      </box>
    </box>
    <box height={1} paddingX={1}>
      {game.busy ? <Spinner label={game.busy} /> : said ? <text fg={C.title}>{truncate(said, width - 2)}</text> : <Keys items={fit(keys, width - 2, gap.length)} gap={gap} />}
    </box>
  </box>;
}

/** A row of the side panel's options, two spaces apart. */
function Row({ children }: { children: ReactNode }) {
  return <box flexDirection="row" height={1} flexShrink={0} gap={2}>{children}</box>;
}

/** One of the options: its key and what it does, a button; faint when it can't be done now. */
function Act({ game, k, what, command, on, lead }: { game: Game; k: string; what: string; command: Command; on: boolean; lead?: boolean }) {
  return <Clickable flexShrink={0} height={1} onClick={() => fightCommand(game, command)}>
    <text><span fg={C.title}>{`${k} `}</span><span fg={!on ? C.faint : lead ? C.lead : C.text}>{what}</span></text>
  </Clickable>;
}

/** A hint that isn't a button. */
function Hint({ k, what }: { k: string; what: string }) {
  return <text flexShrink={0}><span fg={C.title}>{`${k} `}</span><span fg={C.dim}>{what}</span></text>;
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
