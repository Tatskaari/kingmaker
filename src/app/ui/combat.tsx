import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import type { CombatOptions, Dir } from "../adapters.ts";
import { maps } from "../adapters.ts";
import type { Game } from "../game.ts";
import { C } from "../theme.ts";
import { BOLD, ITALIC, Keys, Lines, Spinner, useGame, wrap } from "./common.tsx";

const MOVES: Record<string, Dir> = { up: "n", down: "s", left: "w", right: "e" };

export function CombatScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const fight = game.fight;
  const view = fight?.view();
  const me = view?.order.find(o => o.id === "player");
  const [options, setOptions] = useState<CombatOptions>({ spells: [], targets: [] });
  const stamp = view ? `${view.round}:${view.current}:${me?.at.x},${me?.at.y}:${view.log.length}` : "";
  useEffect(() => {
    let live = true;
    void fight?.options().then(o => { if (live) setOptions(o); }).catch(() => undefined);
    return () => { live = false; };
  }, [fight, stamp]);
  const targets = options.targets.filter(t => !view?.order.find(o => o.id === t.id)?.out);
  const index = targets.length ? Math.min(game.targetIndex, targets.length - 1) : 0;
  const target = targets[index];
  game.targetId = target?.id;
  const myTurn = !!view && view.current === "player" && !view.over && !game.busy;
  useKeyboard(key => {
    if (game.overlay || game.screen !== "combat" || !fight || !view || key.defaultPrevented) return;
    if (view.over) {
      if (key.name === "return" || key.name === "space") { key.preventDefault(); void game.afterCombat(); }
      return;
    }
    if (key.sequence === "?") { key.preventDefault(); game.overlay = { kind: "help" }; game.emit(); return; }
    if (key.name === "s") { key.preventDefault(); void game.showSheet(); return; }
    if (key.name === "escape") { key.preventDefault(); game.overlay = { kind: "menu", index: 0 }; game.emit(); return; }
    if (key.name === "tab") { game.targetIndex = (index + (key.shift ? targets.length - 1 : 1)) % Math.max(1, targets.length); game.emit(); return; }
    if (/^[1-9]$/.test(key.sequence ?? "") && Number(key.sequence) <= targets.length) { game.targetIndex = Number(key.sequence) - 1; game.emit(); return; }
    if (!myTurn) return;
    const dir = MOVES[key.name];
    if (dir) { void game.combatAct({ kind: "move", dir }); return; }
    if ((key.name === "a" || key.name === "return") && target) void game.combatAct({ kind: "attack", target: target.id });
    else if (key.name === "c") {
      if (options.spells.length) { key.preventDefault(); game.overlay = { kind: "spells", spells: options.spells, index: 0 }; game.emit(); }
      else { game.status = "You have no spells. You do, however, have a stick."; game.emit(); }
    }
    else if (key.name === "d") void game.combatAct({ kind: "dash" });
    else if (key.name === "g") void game.combatAct({ kind: "dodge" });
    else if (key.name === "x") void game.combatAct({ kind: "disengage" });
    else if (key.name === "e" || key.name === "space") void game.combatAct({ kind: "end" });
  });
  if (!fight || !view || !game.setup) return <box width={width} height={height}><Spinner label="Setting out the battlefield…" /></box>;
  const sideW = Math.min(46, Math.max(36, Math.floor(width * 0.34)));
  const logH = Math.max(7, Math.floor(height * 0.3));
  const mapW = width - sideW;
  const mapH = height - logH - 1;
  const current = view.order.find(o => o.id === view.current);
  const targetAt = target ? view.order.find(o => o.id === target.id)?.at : undefined;
  const lines = maps.render({
    map: game.setup.map, centre: me?.at ?? { x: 0, y: 0 }, actors: fight.actors(), story: game.story,
    width: mapW - 2, height: mapH - 2, ...(current ? { highlight: [current.at] } : {}), ...(targetAt ? { target: targetAt } : {}),
  });
  const log = view.log.flatMap(l => wrap(l, mapW - 4)).slice(-(logH - 2));
  const inner = sideW - 4;
  return <box width={width} height={height} flexDirection="column" backgroundColor={C.bg}>
    <box flexDirection="row" height={height - 1}>
      <box width={mapW} flexDirection="column">
        <box height={mapH} border borderColor={C.danger} title={` ${game.setup.map.name} · Round ${view.round} `} titleAlignment="left" overflow="hidden">
          <Lines lines={lines} />
        </box>
        <box height={logH} border borderColor={C.border} title=" The fight " titleAlignment="left" paddingX={1} flexDirection="column" overflow="hidden">
          {log.map((l, i) => <text key={i} fg={l.startsWith("🎲") ? C.dice : l.startsWith("—") ? C.title : i === log.length - 1 ? C.text : C.dim}>{l}</text>)}
        </box>
      </box>
      <box width={sideW} border borderColor={C.border} title=" Initiative " flexDirection="column" paddingX={1} overflow="hidden">
        {view.order.map(o => {
          const now = o.id === view.current && !view.over;
          return <text key={o.id}>
            <span fg={now ? C.lead : C.faint}>{now ? "▶" : " "}</span>
            <span fg={C.faint}>{` ${o.side === "neutral" ? "  " : String(o.initiative).padStart(2)} `}</span>
            <span fg={o.out ? C.faint : o.color} attributes={BOLD}>{`${o.glyph} `}</span>
            <span fg={o.out ? C.faint : o.id === target?.id ? C.danger : C.text}>{truncate(o.name, inner - 18)}</span>
            <span fg={o.out ? C.faint : o.id === "player" ? C.good : C.dim}>{` ${o.health}`}</span>
          </text>;
        })}
        <text fg={C.title} marginTop={1}>Target</text>
        {target ? <text wrapMode="word"><span fg={C.danger} attributes={BOLD}>{target.name}</span><span fg={C.dim}>{` · ${target.distance * 5} ft · ${target.inReach ? "in reach" : "out of reach"}`}</span></text>
          : <text fg={C.faint}>Nobody left to aim at.</text>}
        <text fg={C.faint}>Tab or 1–9 to change</text>
        <text fg={C.title} marginTop={1}>{view.over ? "It's over" : myTurn ? "Your turn" : `${current?.name ?? "Someone"}'s turn`}</text>
        {view.over ? <text fg={C.text} wrapMode="word">{view.over.summary}</text> : myTurn
          ? <text fg={C.dim}>{`${view.movementLeft} ft of movement · action ${view.actionUsed ? "used" : "ready"}`}</text>
          : <text fg={C.faint} attributes={ITALIC}>Wait for it…</text>}
        {view.over ? <text fg={C.lead} marginTop={1}>Press Enter to see what comes of it.</text> : <box flexDirection="column" marginTop={1}>
          <text><span fg={C.title}>{"←↑→↓ "}</span><span fg={C.dim}>move 5 ft</span></text>
          <text><span fg={C.title}>{"a "}</span><span fg={C.dim}>{"attack   "}</span><span fg={C.title}>{"c "}</span><span fg={C.dim}>cast</span></text>
          <text><span fg={C.title}>{"d "}</span><span fg={C.dim}>{"dash     "}</span><span fg={C.title}>{"g "}</span><span fg={C.dim}>dodge</span></text>
          <text><span fg={C.title}>{"x "}</span><span fg={C.dim}>{"disengage"}</span></text>
          <text><span fg={C.title}>{"e "}</span><span fg={C.dim}>end your turn</span></text>
        </box>}
        {game.status ? <text fg={C.warn} marginTop={1} wrapMode="word">{game.status}</text> : null}
      </box>
    </box>
    <box height={1} paddingX={1}>
      {game.busy ? <Spinner label={game.busy} /> : <Keys items={[["←↑→↓", "move"], ["a", "attack"], ["c", "cast"], ["Tab", "target"], ["e", "end turn"], ["s", "sheet"], ["?", "help"]]} />}
    </box>
  </box>;
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
