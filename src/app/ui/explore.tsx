import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { Tile2 } from "../../game/types.ts";
import { sceneById } from "../../../scenes/index.ts";
import { maps, type Dir } from "../adapters.ts";
import { chebyshev } from "../geometry.ts";
import type { Game } from "../game.ts";
import { TIME_WORDS } from "../story.ts";
import { C } from "../theme.ts";
import { BOLD, ITALIC, Keys, Lines, useGame, wrap } from "./common.tsx";

const KEYS: Record<string, Dir> = { up: "n", down: "s", left: "w", right: "e", w: "n", s: "s", a: "w", d: "e", k: "n", j: "s", h: "w", l: "e" };

function arrow(from: Tile2, to: Tile2): string {
  const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y);
  return ({ "0,-1": "↑", "0,1": "↓", "-1,0": "←", "1,0": "→", "1,-1": "↗", "-1,-1": "↖", "1,1": "↘", "-1,1": "↙", "0,0": "•" } as Record<string, string>)[`${dx},${dy}`]!;
}

export function ExploreScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  useKeyboard(key => {
    if (game.overlay || game.screen !== "explore" || key.defaultPrevented) return;
    const dir = KEYS[key.name];
    if (dir && !key.ctrl) { game.walk(dir); return; }
    key.preventDefault();
    if (key.name === "e" || key.name === "return" || key.name === "space") game.interact();
    else if (key.name === "c") void game.showSheet();
    else if (key.sequence === "?" || key.name === "f1") { game.overlay = { kind: "help" }; game.emit(); }
    else if (key.name === "escape" || key.name === "q") { game.overlay = { kind: "menu", index: 0 }; game.emit(); }
  });
  const session = game.session;
  if (!session) return null;
  const sideW = Math.min(46, Math.max(34, Math.floor(width * 0.33)));
  const msgH = 6;
  const mapW = width - sideW;
  const mapH = height - msgH - 1;
  const map = maps.map(game.pos.map);
  const actors = game.actors;
  const view = maps.render({ map, centre: game.pos.at, actors: [...actors, game.playerActor], story: game.story, width: mapW - 2, height: mapH - 2 });
  const region = maps.regionAt(game.pos.map, game.pos.at);
  const lead = game.story.lead ? sceneById(game.story.lead) : undefined;
  const leadAt = game.story.lead ? maps.sceneLocation(game.story.lead) : undefined;
  const reach = maps.reachable(game.pos, actors)[0];
  const near = maps.nearby(game.pos, actors, 8).slice(0, Math.max(2, height - 26));
  const inner = sideW - 4;
  const status = session.rules?.status ?? "";
  const messages = game.messages.slice(-4).flatMap(m => wrap(m, mapW + sideW - 6));
  return <box width={width} height={height} flexDirection="column" backgroundColor={C.bg}>
    <box flexDirection="row" height={mapH}>
      <box width={mapW} height={mapH} border borderColor={C.border} title={` ${map.name} `} titleAlignment="left" overflow="hidden">
        <Lines lines={view} />
      </box>
      <box width={sideW} height={mapH} border borderColor={C.border} title=" The investigation " flexDirection="column" paddingX={1} overflow="hidden">
        <text fg={C.title} attributes={BOLD}>{region ? capital(region.name) : "The streets of Caerwyn"}</text>
        <text fg={C.dim}>{TIME_WORDS[game.story.time]}</text>
        <text marginTop={1}><span fg={C.player} attributes={BOLD}>{session.player.name}</span><span fg={C.dim}>{` · ${status.split(",")[0] ?? ""}`}</span></text>
        <text fg={C.faint}>{wrap(session.player.build ?? session.player.concept, inner).slice(0, 2).join("\n")}</text>
        {lead ? <box flexDirection="column" marginTop={1}>
          <text><span fg={C.lead} attributes={BOLD}>{"The lead: "}</span><span fg={C.text}>{lead.title}</span></text>
          {leadAt ? <text fg={C.dim}>{wrap(`${leadAt.name} ${arrow(game.pos.at, leadAt.at)} ${chebyshev(game.pos.at, leadAt.at)} paces`, inner).join("\n")}</text> : null}
        </box> : null}
        <text fg={C.title} marginTop={1}>Nearby</text>
        {near.length ? near.map(({ actor, distance }) => {
          const isLead = actor.interaction?.kind === "scene" && actor.interaction.sceneId === game.story.lead;
          return <text key={actor.id}>
            <span fg={actor.color ?? C.text} attributes={BOLD}>{`${actor.glyph} `}</span>
            <span fg={isLead ? C.lead : C.text}>{truncate(actor.name, inner - 10)}</span>
            <span fg={C.faint}>{` ${distance <= 1 ? "here" : `${distance} paces`}`}</span>
          </text>;
        }) : <text fg={C.faint} attributes={ITALIC}>Nobody. Caerwyn is busy elsewhere.</text>}
        {reach?.interaction ? <text marginTop={1} wrapMode="word"><span fg={C.title} attributes={BOLD}>{"e "}</span><span fg={C.lead}>{reach.interaction.label}</span></text> : null}
      </box>
    </box>
    <box height={msgH} border borderColor={C.border} title=" What happens " titleAlignment="left" paddingX={1} flexDirection="column" overflow="hidden">
      {messages.slice(-(msgH - 2)).map((m, i, all) => <text key={i} fg={i === all.length - 1 ? C.text : C.dim}>{m}</text>)}
    </box>
    <box height={1} paddingX={1}>
      <Keys items={[["←↑→↓/WASD", "walk"], ["e", "interact"], ["c", "sheet"], ["?", "help"], ["Esc", "menu"]]} />
    </box>
  </box>;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
