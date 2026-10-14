import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { showLine } from "../../game/combat/index.ts";
import { direction, SCREEN_KEYS, steps } from "../../game/map/index.ts";
import { fightLooks, fightView } from "../../game/views.ts";
import type { Game } from "../game.ts";
import { C } from "../theme.ts";
import { BOLD, FPS, ITALIC, Keys, Spinner, useGame, wrap } from "./common.tsx";

/** Which way, on screen, a compass direction on the map points (north is up-left). */
const ARROW: Record<string, string> = { north: "↖", "north-east": "↑", east: "↗", "south-east": "→", south: "↘", "south-west": "↓", west: "↙", "north-west": "←", here: "•" };

/**
 * A fight on the map: the battlefield drawn by the map's renderer (where you can move tinted, the
 * dust and the fire, a cursor on your target), the initiative order, your options, and the log.
 * Every action is one of the fight's own action ids, the ones the QA console plays with.
 */
export function CombatScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const fight = game.fight;
  const view = fight?.view();
  const actions = game.fightActions;
  const has = (id: string) => actions.some(a => a.id === id);
  const targets = game.fightTargets();
  const target = game.target();
  const myTurn = !!view && !view.over && !!view.turn?.isPlayer && !game.busy;
  useKeyboard(key => {
    if (game.overlay || game.screen !== "combat" || !fight || !view || key.defaultPrevented) return;
    key.preventDefault();
    if (view.over) {
      if (key.name === "return" || key.name === "space") void game.afterCombat();
      return;
    }
    if (key.sequence === "?") { game.overlay = { kind: "help" }; game.emit(); return; }
    if (key.name === "s") { void game.showSheet(); return; }
    if (key.name === "escape") { game.overlay = { kind: "menu", index: 0 }; game.emit(); return; }
    if (key.name === "tab") { game.targetIndex = (Math.min(game.targetIndex, targets.length - 1) + (key.shift ? targets.length - 1 : 1)) % Math.max(1, targets.length); game.emit(); return; }
    if (/^[1-9]$/.test(key.sequence ?? "") && Number(key.sequence) <= targets.length) { game.targetIndex = Number(key.sequence) - 1; game.emit(); return; }
    if (!myTurn) return;
    const d = SCREEN_KEYS[key.name];
    const me = fight.state().units[fight.state().pc]!;
    if (d && ["up", "down", "left", "right"].includes(key.name)) { void game.combatAct(`move_${me.at.x + d[0]}_${me.at.y + d[1]}`); return; }
    const t = target?.id;
    const act = (id: string, otherwise: string) => { if (has(id)) void game.combatAct(id); else { game.status = otherwise; game.emit(); } };
    switch (key.name) {
      case "a": case "return": act(`attack_${t}`, t ? `${target!.name} is out of reach (z closes in), or your attack's spent.` : "Nobody to attack."); break;
      case "z": act(`close_${t}`, "You're as close as you'll get this turn."); break;
      case "c": {
        const spells = fight.options().spells;
        if (spells.length) { game.overlay = { kind: "spells", spells: spells.map(s => ({ id: s.id, name: s.name, level: s.level })), index: 0 }; game.emit(); }
        else { game.status = "No spells to cast just now. You do, however, have a sword."; game.emit(); }
        break;
      }
      case "u": { const use = actions.find(a => a.id.startsWith("use_")); if (use) void game.combatAct(use.id); else { game.status = "Nothing in reach to knock over. Get next to a lantern or a brazier."; game.emit(); } break; }
      case "d": act("dash", "You can't dash now."); break;
      case "g": act("dodge", "You can't dodge now."); break;
      case "x": act("disengage", "You can't disengage now."); break;
      case "l": act("leave", "There's no way out where you're standing."); break;
      case "f": act("auto", "Not now."); break;
      case "m": game.overlay = { kind: "actions", index: 0 }; game.emit(); break;
      case "e": case "space": void game.combatAct("end_turn"); break;
    }
  });
  if (!fight || !view || !game.core) return <box width={width} height={height}><Spinner label="Setting out the battlefield…" /></box>;
  const G = fight.state();
  const me = G.units[G.pc]!;
  const sideW = Math.min(50, Math.max(38, Math.floor(width * 0.34)));
  const logH = Math.max(8, Math.floor(height * 0.3));
  const mapW = width - sideW;
  const mapH = height - logH - 1;
  const options = myTurn ? fight.options() : undefined;
  const marks = (options && options.movementLeft >= 5 ? options.moves : []).map(at => ({ at, color: "#2f6fb0" }));
  const shown = {
    centre: me.state === "fighting" ? me.at : view.turn ? G.units[view.turn.id]?.at ?? me.at : me.at, marks, ...(target ? { cursor: target.at } : {}), time: game.story.time,
  };
  const fx = game.fightFx();
  const log = view.log.map(showLine).flatMap(l => wrap(l, mapW - 4)).slice(-(logH - 2));
  const inner = sideW - 4;
  // Everyone's letter, as the battlefield has them.
  const looks = fightLooks(G.units);
  const attack = target ? actions.find(a => a.id === `attack_${target.id}`) : undefined;
  const turnName = view.turn ? (view.turn.isPlayer ? "Your turn" : `${view.turn.name}'s turn`) : "";
  return <box width={width} height={height} flexDirection="column" backgroundColor={C.bg}>
    <box flexDirection="row" height={height - 1}>
      <box width={mapW} flexDirection="column">
        <box height={mapH} border borderColor={C.danger} title={` ${G.map.name} · Round ${view.round} `} titleAlignment="left" overflow="hidden">
          {/* The battlefield, alive: the fire burns, the dust drifts, blows spark and spells fly as they happen. */}
          <lookCanvas width={mapW - 2} height={mapH - 2} fps={FPS} live={!game.overlay} painter={(w, h, now) => fightView(fight, game.session, { w, h }, { ...shown, t: now, ...(fx ? { effects: fx } : {}) })} />
        </box>
        <box height={logH} border borderColor={C.border} title=" The fight " titleAlignment="left" paddingX={1} flexDirection="column" overflow="hidden">
          {log.map((l, i) => <text key={i} fg={l.startsWith("🎲") ? C.dice : l.startsWith("—") ? C.title : i === log.length - 1 ? C.text : C.dim}>{l}</text>)}
        </box>
      </box>
      <box width={sideW} border borderColor={C.border} title=" Initiative " flexDirection="column" paddingX={1} overflow="hidden">
        {view.order.map(o => {
          const look = o.id === G.pc ? { glyph: "@", color: "#ffffff" } : looks[o.id]!;
          const now = o.active && !view.over;
          const out = o.state !== "fighting";
          return <text key={o.id}>
            <span fg={now ? C.lead : C.faint}>{now ? "▶" : " "}</span>
            <span fg={C.faint}>{` ${String(o.initiative).padStart(2)} `}</span>
            <span fg={out ? C.faint : look.color} attributes={BOLD}>{`${out ? (o.state === "surrendered" ? "!" : "x") : look.glyph} `}</span>
            <span fg={out ? C.faint : o.id === target?.id ? C.danger : C.text}>{truncate(o.id === G.pc ? `${o.name} (you)` : o.name, inner - 18)}</span>
            <span fg={out ? C.faint : o.id === G.pc ? C.good : C.dim}>{` ${out ? o.state : o.health}`}</span>
          </text>;
        })}
        <text fg={C.title} marginTop={1}>Target</text>
        {target ? <text wrapMode="word">
          <span fg={C.danger} attributes={BOLD}>{target.name}</span>
          <span fg={C.dim}>{` · ${steps(me.at, target.at) * 5} ft ${ARROW[direction(me.at, target.at)] ?? ""} · ${attack ? attack.label.replace(/^Attack [^(]*/, "").replace(/[()]/g, "") : "out of reach"}`}</span>
        </text> : <text fg={C.faint}>Nobody left to aim at.</text>}
        <text fg={C.faint}>Tab or 1–9 to change</text>
        <text fg={C.title} marginTop={1}>{view.over ? "It's over" : turnName}</text>
        {view.over ? <text fg={C.text} wrapMode="word">{game.core.currentFight?.result()?.summary ?? ""}</text> : myTurn
          ? <text fg={C.dim}>{`HP ${me.hp}/${me.maxHp} · ${view.player.movementLeft} ft to move · action ${view.player.actionUsed ? "used" : "ready"}${view.player.slots ? ` · ${view.player.slots}` : ""}`}</text>
          : <text fg={C.faint} attributes={ITALIC}>{me.state === "down" ? "You're down. Death saves…" : "Wait for it…"}</text>}
        {view.over ? <text fg={C.lead} marginTop={1}>Press Enter to see what comes of it.</text> : myTurn ? <box flexDirection="column" marginTop={1}>
          <text><span fg={C.title}>{"←↑→↓ "}</span><span fg={C.dim}>{"move 5 ft  "}</span><span fg={C.title}>{"z "}</span><span fg={C.dim}>close in</span></text>
          <text><span fg={C.title}>{"a "}</span><span fg={attack ? C.text : C.faint}>{"attack  "}</span><span fg={C.title}>{"c "}</span><span fg={C.dim}>{"cast  "}</span><span fg={C.title}>{"u "}</span><span fg={actions.some(a => a.id.startsWith("use_")) ? C.text : C.faint}>knock over</span></text>
          <text><span fg={C.title}>{"d "}</span><span fg={C.dim}>{"dash  "}</span><span fg={C.title}>{"g "}</span><span fg={C.dim}>{"dodge  "}</span><span fg={C.title}>{"x "}</span><span fg={C.dim}>disengage</span></text>
          <text><span fg={C.title}>{"f "}</span><span fg={C.dim}>{"let the dice decide  "}</span><span fg={C.title}>{"e "}</span><span fg={C.dim}>end turn</span></text>
          <text><span fg={C.title}>{"m "}</span><span fg={C.dim}>{`every option (${actions.length})`}</span>{has("leave") ? <span fg={C.lead}>{"  l leave"}</span> : null}</text>
        </box> : null}
        {game.status ? <text fg={C.warn} marginTop={1} wrapMode="word">{game.status}</text> : null}
      </box>
    </box>
    <box height={1} paddingX={1}>
      {game.busy ? <Spinner label={game.busy} /> : <Keys items={[["←↑→↓", "move"], ["a", "attack"], ["Tab", "target"], ["c", "cast"], ["m", "options"], ["e", "end turn"], ["s", "sheet"], ["?", "help"]]} />}
    </box>
  </box>;
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
