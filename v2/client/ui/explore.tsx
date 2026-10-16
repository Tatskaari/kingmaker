// Copied from the prototype's src/app/ui/explore.tsx at 44c6d4a, whole but at the seams: the Game is the ExploreModel (client/explore/model.ts), the session's player and the story's lead its view's; the action menu (m, a right-click's "Do something…"), aiming, the zoo's keys and look, the town's effects (V10's), the notebook (j: V3's) and the report (b) are cut; a spectator's sidebar says whose map it is.
import { MouseButton, type KeyEvent, type MouseEvent } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { look, nearby, whereabouts } from "../../shared/map/explore.ts";
import { direction, steps } from "../../shared/map/tiles.ts";
import type { Tile2 } from "../../shared/map/types.ts";
import type { ExploreModel, TileMenu } from "../explore/model.ts";
import { ARROW, leadWay, TIME_WORDS } from "../explore/words.ts";
import { glyphSet } from "../look/glyphs.ts";
import { actorLook } from "../look/map.ts";
import type { LookCanvasRenderable } from "../look/opentui.ts";
import { mapDoors, overlayWanted } from "../look/overlay.ts";
import { mapLamps } from "../look/lamps.ts";
import { Picks } from "../map/render.ts";
import { townView } from "../map/views.ts";
import { C } from "../theme.ts";
import { BOLD, fit, FPS, ITALIC, Keys, useStore, wrap, type KeyHint } from "./common.tsx";

/** Arrow keys and WASD move with the screen (up is straight up), steered along the streets; the numpad's corners go along them exactly. */
const WALK = new Set(["up", "down", "left", "right", "w", "a", "s", "d", "home", "pageup", "end", "pagedown"]);

/**
 * Caerwyn on the map, mostly by mouse: click somewhere to walk there (a step at a time; any key or
 * click stops it), right-click for what you can do with what's there (talk, look, go through, step
 * in), and the same on anyone in the sidebar's Nearby list. The pointer lights up the tile under it,
 * and the hint line says what's there. Every key still works: arrows walk, e interacts, g walks to
 * the lead. Picking reads what the map's renderer drew where (Picks), so a click on someone's letter
 * is a click on them.
 */
export function ExploreScreen({ explore: game }: { explore: ExploreModel }) {
  useStore(game);
  const { width, height } = useTerminalDimensions();
  const canvas = useRef<LookCanvasRenderable>(null);
  const picks = useRef<Picks | undefined>(undefined);
  // The tile under the pointer: on the map, or someone's line in the Nearby list.
  const [hover, setHover] = useState<{ at: Tile2; from: "map" | "list" } | undefined>(undefined);
  useKeyboard(key => {
    if (game.overlay || key.defaultPrevented) return;
    if (game.menu) { key.preventDefault(); tileMenuKey(game, game.menu, key); return; }
    // Any key stops a walk.
    if (game.walking) { game.walking = false; key.preventDefault(); game.emit(); return; }
    if (WALK.has(key.name) && !key.ctrl) { game.walk(key.name); return; }
    key.preventDefault();
    if (key.name === "e" || key.name === "return" || key.name === "space") game.interact();
    else if (key.name === "g") void game.toLead();
    else if (key.name === "c") { game.overlay = { kind: "sheet" }; game.emit(); }
    else if (key.name === "r") { game.overlay = { kind: "log" }; game.emit(); }
    else if (key.sequence === "?" || key.name === "f1") { game.overlay = { kind: "help" }; game.emit(); }
    else if (key.name === "escape" || key.name === "q") { game.overlay = { kind: "menu", index: 0 }; game.emit(); }
  });
  const view = game.view;
  const ex = game.ex;
  // The Nearby list re-sorts as you walk, under a pointer that hasn't moved: what it was over isn't there any more.
  useEffect(() => setHover(h => (h?.from === "list" ? undefined : h)), [ex.map, ex.at.x, ex.at.y]);
  // What the pointer is over, and what a click there would do (asked again only when it moves to another tile, or the player does).
  const pointed = hover ? `${hover.at.x},${hover.at.y}@${ex.map}:${ex.at.x},${ex.at.y}:${ex.story.time}` : "";
  const info = useMemo(() => (hover ? game.actionsAt(hover.at) : undefined), [pointed]);
  const sideW = Math.min(48, Math.max(34, Math.floor(width * 0.32)));
  const msgH = 6;
  const mapW = width - sideW;
  const mapH = height - msgH - 1;
  const where = whereabouts(ex);
  // What the place is like (look()'s first line, without the "You're in ..." part the title already says).
  const about = (look(ex).split("\n")[0] ?? "").replace(/^You're [^.]*\.\s*/, "");
  const lead = game.leadTarget();
  const leadScene = view.lead;
  const front = game.interactLabel();
  const inner = sideW - 4;
  const status = view.player.status ?? "";
  const you = truncate(view.player.name, Math.max(8, inner - 12));
  // What happens: the newest line bright, the ones before it dim. A newest line too long for the
  // box shows its start (a sign's title, a spell's first roll) and says how to read the rest.
  const rows = msgH - 2;
  const newest = game.messages.length ? wrap(game.messages[game.messages.length - 1]!, width - 6) : [];
  const cut = newest.length > rows;
  const messages: Array<{ text: string; now: boolean }> = cut
    ? [...newest.slice(0, rows - 1).map(text => ({ text, now: true })), { text: "… (more: r, or a click here, reads it all)", now: false }]
    : [...game.messages.slice(-4, -1).flatMap(m => wrap(m, width - 6)).map(text => ({ text, now: false })), ...newest.map(text => ({ text, now: true }))].slice(-rows);
  // The way to the lead: the words Kell drew it in between scenes (leadWay), so the two agree.
  const way = lead ? wrap(leadWay(ex.at, lead), inner) : [];
  const when = wrap(TIME_WORDS[ex.story.time], inner);
  const fronts = front && !view.watching ? wrap(front.label, inner - 2) : [];
  // One row, however narrow: two would squeeze out who's about. A spectator's says whose map it is.
  const walkingLines = view.watching ? [truncate(`Watching: ${view.watching} has the lead`, inner)]
    : game.walking ? [inner >= 33 ? "Walking… (any key or click stops)" : "Walking… (any key stops)"] : [];
  // The sidebar, a row at a time in the rows it has (a squeezed box draws its lines over each other):
  // first what's needed (where, when, you, the lead and the way, who's about, what e does), then
  // what fills the room (who you are, what the place is like, more of who's about).
  const everyone = nearby(ex, 7).filter(n => n.actor && n.actor.kind !== "object" || n.interaction?.kind === "travel");
  let spare = mapH - 2 - (1 + when.length + 2 + (leadScene ? 2 + way.length : 0) + 2 + (fronts.length ? 1 + fronts.length : 0) + (walkingLines.length ? 1 + walkingLines.length : 0));
  const take = (want: number) => { const n = Math.max(0, Math.min(want, spare)); spare -= n; return n; };
  const nearFirst = take(Math.max(1, Math.min(3, everyone.length)));
  // The spell slots left (the status line's second part), before who you are: they change as you play.
  const slots = /spell slots ([^,]+(?:, \d\w\w \d+\/\d+)*)/.exec(status)?.[1];
  const slotsLine = slots && take(1) ? truncate(`Slots: ${slots}`, inner) : undefined;
  const build = upTo(wrap(view.player.build ?? view.player.concept ?? "", inner), take(2), inner);
  const aboutLines = about ? upTo(wrap(about, inner), take(3), inner) : [];
  const near = everyone.slice(0, nearFirst + take(everyone.length - nearFirst));
  // The tile lit up on the map: the menu's while it's open, else the pointer's.
  const lit = game.menu?.at ?? hover?.at;
  // The keys at the bottom, the ones that do something as buttons too; as many as fit, the mouse's
  // first. Like any key, a click on one while walking only stops the walk. Narrow, they say less.
  const button = (run: () => void) => () => { if (game.walking) game.stop(); else run(); };
  const overlay = (kind: "help" | "log" | "menu") => button(() => { game.overlay = kind === "menu" ? { kind, index: 0 } : { kind }; game.emit(); });
  const narrow = width < 100;
  const gap = narrow ? " · " : "  ·  ";
  const hints: KeyHint[] = [
    ...(narrow ? [] : [["click", "walk"] as KeyHint]), ["right-click", "act"],
    ["g", narrow ? "lead" : "the lead", button(() => void game.toLead())],
    ["c", "sheet", button(() => { game.overlay = { kind: "sheet" }; game.emit(); })],
    ["Esc", "menu", overlay("menu")], ["?", "help", overlay("help")], ["e", "interact", button(() => game.interact())], ["←↑→↓", "walk"],
    ["r", "what happened", overlay("log")],
  ];

  /** What's drawn in the map cell a mouse event is over (as last drawn: a frame of the map you were on before a door doesn't count). */
  const pickAt = (e: MouseEvent) => {
    const c = canvas.current, p = picks.current;
    return c && p && p.map === game.ex.map ? p.at(e.x - c.x, e.y - c.y) : undefined;
  };
  const onMapDown = (e: MouseEvent) => {
    if (game.overlay) return;
    const hit = pickAt(e);
    if (e.button === MouseButton.RIGHT) { if (hit) game.openMenu(hit.at, e.x, e.y); else game.closeMenu(); return; }
    if (e.button !== MouseButton.LEFT) return;
    // A click outside the menu just closes it; a click on the map walks there (and stops a walk under way).
    if (game.menu) { game.closeMenu(); return; }
    if (hit) void game.walkTo(hit.at);
    else game.stop();
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
            // In a browser, the doors are drawn as pictures over the map: the picks keep where they are.
            const doors = overlayWanted();
            const pick = new Picks({ doors });
            const lines = townView(game.ex, undefined, { w, h }, { t: now, pick, ...(lit ? { hover: lit } : {}) });
            picks.current = pick;
            return doors ? { frame: lines, doors: mapDoors(pick, lines), lamps: mapLamps(pick, lines) } : lines;
          }}
          onMouseDown={onMapDown} onMouseMove={onMapMove} onMouseOut={() => setHover(h => (h?.from === "map" ? undefined : h))} />
      </box>
      <box width={sideW} height={mapH} border borderColor={C.border} title=" The investigation " flexDirection="column" paddingX={1} overflow="hidden">
        <text fg={C.title} attributes={BOLD} height={1} flexShrink={0}>{truncate(capital(where.place), inner)}</text>
        <text fg={C.dim} height={when.length} flexShrink={0}>{when.join("\n")}</text>
        {aboutLines.length ? <text fg={C.faint} height={aboutLines.length} flexShrink={0}>{aboutLines.join("\n")}</text> : null}
        <text marginTop={1} height={1} flexShrink={0}><span fg={C.player} attributes={BOLD}>{you}</span><span fg={C.dim}>{truncate(` · ${status.split(",")[0] ?? ""}`, Math.max(0, inner - you.length - (ex.hidden ? 9 : 0)))}</span>{ex.hidden ? <span fg={C.lead}>{" · hidden"}</span> : null}</text>
        {slotsLine ? <text fg={C.dim} height={1} flexShrink={0}>{slotsLine}</text> : null}
        {build.length ? <text fg={C.faint} height={build.length} flexShrink={0}>{build.join("\n")}</text> : null}
        {leadScene ? <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text height={1} flexShrink={0}><span fg={C.lead} attributes={BOLD}>{"The lead: "}</span><span fg={C.text}>{truncate(leadScene.title, inner - 10)}</span></text>
          {way.length ? <text fg={C.dim} height={way.length} flexShrink={0}>{way.join("\n")}</text> : null}
        </box> : null}
        <text fg={C.title} marginTop={1} height={1} flexShrink={0}>Nearby</text>
        {near.length ? near.map(n => {
          const scene = n.interaction?.kind === "scene" && n.interaction.sceneId === ex.story.lead;
          // As the map draws them (the player keeps their @).
          const seen = n.actor && n.actor.kind !== "player" ? actorLook(n.actor, { t: 0, time: ex.story.time, glyphs: glyphSet() }) : undefined;
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
        }) : nearFirst ? <text fg={C.faint} attributes={ITALIC} height={1} flexShrink={0}>{truncate("Nobody. Caerwyn is busy elsewhere.", inner)}</text> : null}
        {fronts.length ? <box flexDirection="column" marginTop={1} flexShrink={0}>
          {fronts.map((l, i) => <text key={i} height={1} flexShrink={0}><span fg={C.title} attributes={BOLD}>{i ? "  " : "e "}</span><span fg={front?.scene ? C.lead : C.text}>{l}</span></text>)}
        </box> : null}
        {walkingLines.length ? <text fg={view.watching ? C.dim : C.lead} marginTop={1} height={walkingLines.length} flexShrink={0}>{walkingLines.join("\n")}</text> : null}
      </box>
    </box>
    <box height={msgH} border borderColor={C.border} title=" What happens " titleAlignment="left" paddingX={1} flexDirection="column" overflow="hidden"
      onMouseDown={(e: MouseEvent) => { if (e.button === MouseButton.LEFT && !game.overlay && !game.menu) { game.overlay = { kind: "log" }; game.emit(); } }}>
      {messages.map((m, i) => <text key={i} fg={m.now ? C.text : C.dim}>{m.text}</text>)}
    </box>
    <box height={1} paddingX={1}>
      {info && !game.menu ? <Pointer title={info.title} distance={steps(ex.at, info.at)} arrow={ARROW[direction(ex.at, info.at)] ?? ""} actions={info.actions.map(a => a.label)} width={width - 2} />
        : <Keys items={fit(hints, width - 2, gap.length)} gap={gap} />}
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
function MenuBox({ game, menu, width, height }: { game: ExploreModel; menu: TileMenu; width: number; height: number }) {
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
function tileMenuKey(game: ExploreModel, menu: TileMenu, key: KeyEvent): void {
  const n = menu.actions.length;
  const digit = /^[1-9]$/.test(key.sequence ?? "") ? Number(key.sequence) - 1 : -1;
  if (key.name === "up" || key.name === "w") { menu.index = (menu.index + n - 1) % Math.max(1, n); game.emit(); }
  else if (key.name === "down" || key.name === "s" || key.name === "tab") { menu.index = (menu.index + 1) % Math.max(1, n); game.emit(); }
  else if (key.name === "return" || key.name === "space" || key.name === "e") void game.chooseFromMenu(menu.index);
  else if (digit >= 0 && digit < n) void game.chooseFromMenu(digit);
  else game.closeMenu();
}

/** At most n of some wrapped lines, the last cut short with an ellipsis when there was more. */
const upTo = (lines: string[], n: number, width: number) => (lines.length <= n ? lines : n <= 0 ? [] : [...lines.slice(0, n - 1), `${lines[n - 1]!.slice(0, Math.max(0, width - 1))}…`]);
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
