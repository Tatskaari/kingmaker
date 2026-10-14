import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect } from "react";
import { direction, nearby, steps, whereabouts } from "../../game/map/index.ts";
import { MapView } from "../../game/map/view.tsx";
import { interactLabel, leadTarget } from "../../game/town.ts";
import { townView } from "../../game/views.ts";
import { sceneById } from "../../../scenes/index.ts";
import type { Game } from "../game.ts";
import { TIME_WORDS } from "../story.ts";
import { C } from "../theme.ts";
import { BOLD, ITALIC, Keys, useGame, wrap } from "./common.tsx";

/** Arrow keys and WASD move with the screen: up is straight up the screen (the map module's SCREEN_KEYS). */
const WALK = new Set(["up", "down", "left", "right", "w", "a", "s", "d"]);

/** Which way, on screen, a compass direction on the map points (north is up-left). */
const ARROW: Record<string, string> = { north: "↖", "north-east": "↑", east: "↗", "south-east": "→", south: "↘", "south-west": "↓", west: "↙", "north-west": "←", here: "•" };

export function ExploreScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  // Water shimmers and the lead's marker pulses while you stand and look.
  useEffect(() => {
    const timer = setInterval(() => { if (game.screen === "explore" && !game.overlay && !game.busy) { game.tick++; game.emit(); } }, 700);
    return () => clearInterval(timer);
  }, [game]);
  useKeyboard(key => {
    if (game.overlay || game.screen !== "explore" || key.defaultPrevented) return;
    // Any key stops a walk to the lead.
    if (game.walking) { game.walking = false; key.preventDefault(); return; }
    if (WALK.has(key.name) && !key.ctrl) { game.walk(key.name); return; }
    key.preventDefault();
    if (key.name === "e" || key.name === "return" || key.name === "space") game.interact();
    else if (key.name === "g") void game.toLead();
    else if (key.name === "c") void game.showSheet();
    else if (key.name === "j") { game.overlay = { kind: "journal" }; game.emit(); }
    else if (key.sequence === "?" || key.name === "f1") { game.overlay = { kind: "help" }; game.emit(); }
    else if (key.name === "escape" || key.name === "q") { game.overlay = { kind: "menu", index: 0 }; game.emit(); }
  });
  const core = game.core;
  const session = game.session;
  const ex = game.ex;
  if (!core || !session || !ex) return null;
  const sideW = Math.min(48, Math.max(34, Math.floor(width * 0.32)));
  const msgH = 6;
  const mapW = width - sideW;
  const mapH = height - msgH - 1;
  const lines = townView(core.state, session, { w: mapW - 2, h: mapH - 2 }, { tick: game.tick });
  const where = whereabouts(ex);
  const lead = leadTarget(core.state);
  const leadScene = game.story.lead ? sceneById(game.story.lead) : undefined;
  const front = interactLabel(core.state, session);
  const inner = sideW - 4;
  const near = nearby(ex, 7).filter(n => n.actor && n.actor.kind !== "object" || n.interaction?.kind === "travel").slice(0, Math.max(3, height - 28));
  const status = session.rules?.status ?? "";
  const messages = game.messages.slice(-4).flatMap(m => wrap(m, width - 6));
  const leadWords = lead ? `${lead.via ? `${lead.via}, then on to ` : ""}${lead.label} ${ARROW[direction(ex.at, lead.at)] ?? ""} ${steps(ex.at, lead.at)} paces` : "";
  return <box width={width} height={height} flexDirection="column" backgroundColor={C.bg}>
    <box flexDirection="row" height={mapH}>
      <box width={mapW} height={mapH} border borderColor={C.border} title={` ${where.map} `} titleAlignment="left" overflow="hidden">
        <MapView lines={lines} />
      </box>
      <box width={sideW} height={mapH} border borderColor={C.border} title=" The investigation " flexDirection="column" paddingX={1} overflow="hidden">
        <text fg={C.title} attributes={BOLD}>{capital(where.place)}</text>
        <text fg={C.dim}>{TIME_WORDS[game.story.time]}</text>
        <text marginTop={1}><span fg={C.player} attributes={BOLD}>{session.player.name}</span><span fg={C.dim}>{` · ${status.split(",")[0] ?? ""}`}</span></text>
        <text fg={C.faint}>{wrap(session.player.build ?? session.player.concept, inner).slice(0, 2).join("\n")}</text>
        {leadScene ? <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text><span fg={C.lead} attributes={BOLD}>{"The lead: "}</span><span fg={C.text}>{leadScene.title}</span></text>
          {lead ? <text fg={C.dim}>{wrap(leadWords, inner).join("\n")}</text> : null}
        </box> : null}
        <text fg={C.title} marginTop={1}>Nearby</text>
        {near.length ? near.map(n => {
          const scene = n.interaction?.kind === "scene" && n.interaction.sceneId === game.story.lead;
          return <text key={`${n.actor?.id ?? n.label}`}>
            <span fg={n.actor?.color ?? C.lead} attributes={BOLD}>{`${n.actor?.glyph ?? "»"} `}</span>
            <span fg={scene ? C.lead : C.text}>{truncate(n.actor?.name ?? n.label, inner - 12)}</span>
            <span fg={C.faint}>{` ${n.distance <= 1 ? "here" : `${ARROW[n.direction] ?? ""} ${n.distance}`}`}</span>
          </text>;
        }) : <text fg={C.faint} attributes={ITALIC}>Nobody. Caerwyn is busy elsewhere.</text>}
        {front ? <text marginTop={1} wrapMode="word"><span fg={C.title} attributes={BOLD}>{"e "}</span><span fg={front.scene ? C.lead : C.text}>{front.label}</span></text> : null}
        {game.walking ? <text fg={C.lead} marginTop={1}>Walking… (any key stops)</text> : null}
      </box>
    </box>
    <box height={msgH} border borderColor={C.border} title=" What happens " titleAlignment="left" paddingX={1} flexDirection="column" overflow="hidden">
      {messages.slice(-(msgH - 2)).map((m, i, all) => <text key={i} fg={i === all.length - 1 ? C.text : C.dim}>{m}</text>)}
    </box>
    <box height={1} paddingX={1}>
      <Keys items={[["←↑→↓/WASD", "walk"], ["e", "interact"], ["g", "go to the lead"], ["c", "sheet"], ["j", "notebook"], ["?", "help"], ["Esc", "menu"]]} />
    </box>
  </box>;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
