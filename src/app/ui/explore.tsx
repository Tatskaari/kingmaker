import { MouseButton, type KeyEvent, type MouseEvent } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { glyphSet } from "../../game/look/glyphs.ts";
import { actorLook } from "../../game/look/map.ts";
import type { LookCanvasRenderable } from "../../game/look/opentui.ts";
import { direction, look, nearby, Picks, steps, whereabouts } from "../../game/map/index.ts";
import { actionsAt, interactLabel, leadTarget } from "../../game/town.ts";
import type { Tile2 } from "../../game/types.ts";
import { townView } from "../../game/views.ts";
import { sceneById } from "../../../scenes/index.ts";
import type { Game, TileMenu } from "../game.ts";
import { TIME_WORDS } from "../story.ts";
import { C } from "../theme.ts";
import { BOLD, FPS, ITALIC, Keys, useGame, wrap } from "./common.tsx";

/** Arrow keys and WASD move with the screen (up is straight up), steered along the streets; the numpad's corners go along them exactly. */
const WALK = new Set(["up", "down", "left", "right", "w", "a", "s", "d", "home", "pageup", "end", "pagedown"]);

/** Which way, on screen, a compass direction on the map points (north is up-left). */
const ARROW: Record<string, string> = { north: "↖", "north-east": "↑", east: "↗", "south-east": "→", south: "↘", "south-west": "↓", west: "↙", "north-west": "←", here: "•" };

/**
 * Caerwyn on the map, mostly by mouse: click somewhere to walk there (a step at a time; any key or
 * click stops it), right-click for what you can do with what's there (talk, look, go through, step
 * in), and the same on anyone in the sidebar's Nearby list. The pointer lights up the tile under it,
 * and the hint line says what's there. Every key still works: arrows walk, e interacts, g walks to
 * the lead. Picking reads what the map's renderer drew where (Picks), so a click on someone's letter
 * is a click on them.
 */
export function ExploreScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const canvas = useRef<LookCanvasRenderable>(null);
  const picks = useRef<Picks | undefined>(undefined);
  // The tile under the pointer: on the map, or someone's line in the Nearby list.
  const [hover, setHover] = useState<{ at: Tile2; from: "map" | "list" } | undefined>(undefined);
  useKeyboard(key => {
    if (game.overlay || game.screen !== "explore" || key.defaultPrevented) return;
    if (game.menu) { key.preventDefault(); menuKey(game, game.menu, key); return; }
    // Any key stops a walk.
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
  // The Nearby list re-sorts as you walk, under a pointer that hasn't moved: what it was over isn't there any more.
  useEffect(() => setHover(h => (h?.from === "list" ? undefined : h)), [ex?.map, ex?.at.x, ex?.at.y]);
  // What the pointer is over, and what a click there would do (asked again only when it moves to another tile, or the player does).
  const pointed = hover && core && ex ? `${hover.at.x},${hover.at.y}@${ex.map}:${ex.at.x},${ex.at.y}:${game.story.time}` : "";
  const info = useMemo(() => (hover && core ? actionsAt(core.state, session, hover.at) : undefined), [pointed]);
  if (!core || !session || !ex) return null;
  const sideW = Math.min(48, Math.max(34, Math.floor(width * 0.32)));
  const msgH = 6;
  const mapW = width - sideW;
  const mapH = height - msgH - 1;
  const where = whereabouts(ex);
  // What the place is like (look()'s first line, without the "You're in ..." part the title already says).
  const about = (look(ex).split("\n")[0] ?? "").replace(/^You're [^.]*\.\s*/, "");
  const lead = leadTarget(core.state);
  const leadScene = game.story.lead ? sceneById(game.story.lead) : undefined;
  const front = interactLabel(core.state, session);
  const inner = sideW - 4;
  const near = nearby(ex, 7).filter(n => n.actor && n.actor.kind !== "object" || n.interaction?.kind === "travel").slice(0, Math.max(3, height - 28));
  const status = session.rules?.status ?? "";
  const messages = game.messages.slice(-4).flatMap(m => wrap(m, width - 6));
  const leadWords = lead ? `${lead.via ? `${lead.via}, then on to ` : ""}${lead.label} ${ARROW[direction(ex.at, lead.at)] ?? ""} ${steps(ex.at, lead.at)} paces` : "";
  // The tile lit up on the map: the menu's while it's open, else the pointer's.
  const lit = game.menu?.at ?? hover?.at;

  /** What's drawn in the map cell a mouse event is over (as last drawn: a frame of the map you were on before a door doesn't count). */
  const pickAt = (e: MouseEvent) => {
    const c = canvas.current, p = picks.current;
    return c && p && p.map === game.ex?.map ? p.at(e.x - c.x, e.y - c.y) : undefined;
  };
  const onMapDown = (e: MouseEvent) => {
    if (game.overlay) return;
    const hit = pickAt(e);
    if (e.button === MouseButton.RIGHT) { if (hit) game.openMenu(hit.at, e.x, e.y); else game.closeMenu(); return; }
    if (e.button !== MouseButton.LEFT) return;
    // A click outside the menu just closes it; a click on the map walks there (and stops a walk under way).
    if (game.menu) { game.closeMenu(); return; }
    if (hit) void game.walkTo(hit.at);
    else if (game.walking) { game.walking = false; game.emit(); }
  };
  const onMapMove = (e: MouseEvent) => {
    const hit = pickAt(e);
    if (hit?.at.x === hover?.at.x && hit?.at.y === hover?.at.y && hover?.from === "map") return;
    setHover(hit ? { at: hit.at, from: "map" } : undefined);
  };

  return <box width={width} height={height} flexDirection="column" backgroundColor={C.bg}>
    <box flexDirection="row" height={mapH}>
      <box width={mapW} height={mapH} border borderColor={C.border} title={` ${where.map} `} titleAlignment="left" overflow="hidden">
        {/* The town, alive: water runs, lamps flicker, the lead pulses (held still while an overlay is up). */}
        <lookCanvas ref={canvas} width={mapW - 2} height={mapH - 2} fps={FPS} live={!game.overlay}
          painter={(w, h, now) => {
            const pick = new Picks();
            const lines = townView(core.state, session, { w, h }, { t: now, pick, ...(lit ? { hover: lit } : {}) });
            picks.current = pick;
            return lines;
          }}
          onMouseDown={onMapDown} onMouseMove={onMapMove} onMouseOut={() => setHover(h => (h?.from === "map" ? undefined : h))} />
      </box>
      <box width={sideW} height={mapH} border borderColor={C.border} title=" The investigation " flexDirection="column" paddingX={1} overflow="hidden">
        <text fg={C.title} attributes={BOLD}>{capital(where.place)}</text>
        <text fg={C.dim}>{TIME_WORDS[game.story.time]}</text>
        {about ? <text fg={C.faint} wrapMode="word">{wrap(about, sideW - 4).slice(0, 3).join("\n")}</text> : null}
        <text marginTop={1}><span fg={C.player} attributes={BOLD}>{session.player.name}</span><span fg={C.dim}>{` · ${status.split(",")[0] ?? ""}`}</span></text>
        <text fg={C.faint}>{wrap(session.player.build ?? session.player.concept, inner).slice(0, 2).join("\n")}</text>
        {leadScene ? <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text><span fg={C.lead} attributes={BOLD}>{"The lead: "}</span><span fg={C.text}>{leadScene.title}</span></text>
          {lead ? <text fg={C.dim}>{wrap(leadWords, inner).join("\n")}</text> : null}
        </box> : null}
        <text fg={C.title} marginTop={1}>Nearby</text>
        {near.length ? near.map(n => {
          const scene = n.interaction?.kind === "scene" && n.interaction.sceneId === game.story.lead;
          // As the map draws them (the player keeps their @).
          const seen = n.actor && n.actor.kind !== "player" ? actorLook(n.actor, { t: 0, time: game.story.time, glyphs: glyphSet() }) : undefined;
          const pointing = hover?.from === "list" && hover.at.x === n.at.x && hover.at.y === n.at.y;
          // Left-click walks over to them (or through the door); right-click says what you can do.
          return <box key={`${n.actor?.id ?? n.label}`} flexShrink={0} height={1} {...(pointing ? { backgroundColor: C.highlightBg } : {})}
            onMouseDown={(e: MouseEvent) => {
              if (game.overlay) return;
              if (e.button === MouseButton.RIGHT) game.openMenu(n.at, e.x, e.y);
              else if (e.button === MouseButton.LEFT) { if (game.menu) game.closeMenu(); else void game.walkTo(n.at); }
            }}
            onMouseOver={() => setHover({ at: n.at, from: "list" })} onMouseOut={() => setHover(h => (h?.from === "list" ? undefined : h))}>
            <text>
              <span fg={seen?.fg ?? n.actor?.color ?? C.lead} attributes={BOLD}>{`${seen?.glyph ?? n.actor?.glyph ?? "»"} `}</span>
              <span fg={scene ? C.lead : C.text}>{truncate(n.actor?.name ?? n.label, inner - 12)}</span>
              <span fg={C.faint}>{` ${n.distance <= 1 ? "here" : `${ARROW[n.direction] ?? ""} ${n.distance}`}`}</span>
            </text>
          </box>;
        }) : <text fg={C.faint} attributes={ITALIC}>Nobody. Caerwyn is busy elsewhere.</text>}
        {front ? <text marginTop={1} wrapMode="word"><span fg={C.title} attributes={BOLD}>{"e "}</span><span fg={front.scene ? C.lead : C.text}>{front.label}</span></text> : null}
        {game.walking ? <text fg={C.lead} marginTop={1}>Walking… (any key or click stops)</text> : null}
      </box>
    </box>
    <box height={msgH} border borderColor={C.border} title=" What happens " titleAlignment="left" paddingX={1} flexDirection="column" overflow="hidden">
      {messages.slice(-(msgH - 2)).map((m, i, all) => <text key={i} fg={i === all.length - 1 ? C.text : C.dim}>{m}</text>)}
    </box>
    <box height={1} paddingX={1}>
      {info && !game.menu ? <Pointer title={info.title} distance={steps(ex.at, info.at)} arrow={ARROW[direction(ex.at, info.at)] ?? ""} actions={info.actions.map(a => a.label)} width={width - 2} />
        : <Keys items={fit([["click", "walk"], ["right-click", "act"], ["←↑→↓", "walk"], ["e", "interact"], ["g", "the lead"], ["?", "help"], ["Esc", "menu"], ["c", "sheet"], ["j", "notebook"]], width - 2)} />}
    </box>
    {game.menu ? <MenuBox game={game} menu={game.menu} width={width} height={height} /> : null}
  </box>;
}

/** The hint line while the pointer is over the map: what's there, how far, and what a click and a right-click do. */
function Pointer({ title, distance, arrow, actions, width }: { title: string; distance: number; arrow: string; actions: string[]; width: number }) {
  const what = truncate(`${capital(title)}${distance ? ` ${arrow} ${distance}` : ""}`, width);
  const click = distance ? "  ·  click to walk there" : "";
  const more = actions.length ? `  ·  right-click: ${actions.join(", ")}` : "";
  const room = width - what.length - click.length;
  return <text flexShrink={0} height={1}>
    <span fg={C.title} attributes={BOLD}>{what}</span>
    <span fg={C.dim}>{click.length <= width - what.length ? click : ""}</span>
    {more && room > 8 ? <span fg={C.dim}>{truncate(more, room)}</span> : null}
  </text>;
}

/** The right-click menu: what's there, and what you can do with it (click one, or ↑↓ and Enter, or its number). */
function MenuBox({ game, menu, width, height }: { game: Game; menu: TileMenu; width: number; height: number }) {
  const items = menu.actions;
  const w = Math.min(width - 2, Math.max(capital(menu.title).length + 6, ...items.map(a => a.label.length + 8), 24));
  const h = items.length + 3;
  // Below and to the right of the pointer, leaving what was clicked in sight; flipped where there's no room.
  const left = Math.max(0, menu.x + 2 + w <= width ? menu.x + 2 : menu.x - 1 - w);
  const top = Math.max(0, menu.y + 1 + h <= height ? menu.y + 1 : menu.y - h);
  return <box position="absolute" left={left} top={top} width={w} height={h} zIndex={50} border borderStyle="rounded" borderColor={C.borderHot}
    backgroundColor={C.panel} title={` ${truncate(capital(menu.title), w - 4)} `} titleAlignment="left" flexDirection="column" paddingX={1}>
    {items.map((a, i) => {
      const on = i === menu.index;
      return <box key={a.id} height={1} flexShrink={0} {...(on ? { backgroundColor: C.highlightBg } : {})}
        onMouseDown={(e: MouseEvent) => { if (e.button === MouseButton.LEFT || e.button === MouseButton.RIGHT) void game.chooseFromMenu(i); }}
        onMouseOver={() => { if (menu.index !== i) { menu.index = i; game.emit(); } }}>
        <text>
          <span fg={on ? C.lead : C.faint}>{`${i < 9 ? i + 1 : " "} `}</span>
          <span fg={on ? C.title : C.text} {...(on ? { attributes: BOLD } : {})}>{truncate(a.label, w - 6)}</span>
        </text>
      </box>;
    })}
    <text fg={C.faint} height={1}>{truncate("Esc never mind", w - 4)}</text>
  </box>;
}

/** Keys while the menu's open: ↑↓ (or w/s) choose, Enter does it, 1–9 do that one, anything else closes it. */
function menuKey(game: Game, menu: TileMenu, key: KeyEvent): void {
  const n = menu.actions.length;
  const digit = /^[1-9]$/.test(key.sequence ?? "") ? Number(key.sequence) - 1 : -1;
  if (key.name === "up" || key.name === "w") { menu.index = (menu.index + n - 1) % Math.max(1, n); game.emit(); }
  else if (key.name === "down" || key.name === "s" || key.name === "tab") { menu.index = (menu.index + 1) % Math.max(1, n); game.emit(); }
  else if (key.name === "return" || key.name === "space" || key.name === "e") void game.chooseFromMenu(menu.index);
  else if (digit >= 0 && digit < n) void game.chooseFromMenu(digit);
  else game.closeMenu();
}

/** As many key hints as fit the line, in order. */
function fit(items: Array<[string, string]>, width: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let used = 0;
  for (const [k, what] of items) {
    const w = k.length + 1 + what.length + (out.length ? 5 : 0);
    if (used + w > width) break;
    out.push([k, what]);
    used += w;
  }
  return out;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
