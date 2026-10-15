import { MouseButton, type MouseEvent } from "@opentui/core";
import type { RefObject } from "react";
import { lookOf } from "../../game/look/appearance.ts";
import { glyphSet } from "../../game/look/glyphs.ts";
import type { LookCanvasRenderable } from "../../game/look/opentui.ts";
import { mapDoors, overlayWanted, stageDoors } from "../../game/look/overlay.ts";
import { mapLamps, stageLamps } from "../../game/look/lamps.ts";
import { StagePicks, type StagePick } from "../../game/look/stage.ts";
import { Picks } from "../../game/map/index.ts";
import { nameOf, sameTarget, type SceneTarget } from "../../game/scene-menu.ts";
import { stageView, townView } from "../../game/views.ts";
import { sceneById } from "../../../scenes/index.ts";
import type { Game } from "../game.ts";
import { C } from "../theme.ts";
import { BOLD, FPS } from "./common.tsx";

/**
 * Pointing at the place (the scene screen's): what's lit up, where each frame's picks go, and what
 * the mouse does on the place and on the list under it.
 */
export interface PlacePointing {
  /** What's lit up: what the pointer, the keys or the open menu are on. */
  lit?: SceneTarget | undefined;
  /** Each frame's picks: what the stage drew where. */
  picks: { current: StagePicks | undefined };
  /** The canvas, for where its cells are on screen. */
  canvas: RefObject<LookCanvasRenderable | null>;
  /** The pointer is on something, or (undefined) off what it was on, there. */
  point: (target: SceneTarget | undefined, from: "place" | "list") => void;
  /** Filled in as the place is drawn: who or what is at a cell of the screen, in the place or on a line of its list (for a right-click that landed on the menu over them). */
  hit?: { current: ((x: number, y: number) => SceneTarget | undefined) | undefined };
  /** A click on something, and where on screen. */
  click: (target: SceneTarget, button: "left" | "right", x: number, y: number) => void;
  /** A click on nothing (past the place's edge). */
  miss: () => void;
}

/** Someone or something under the pointer, or a cell of floor; nothing past the place's edge. */
export function targetOf(pick: StagePick | undefined, cell: { x: number; y: number }): SceneTarget | undefined {
  if (!pick) return undefined;
  if (pick.id) return { id: pick.id, ...(pick.under ? { under: pick.under } : {}) };
  return pick.ground === "void" && !pick.area ? undefined : { floor: pick, cell };
}

/**
 * The open scene's place, alive, then who's here (with the letters and colours they have in it).
 * From above (the look layer's stage, Caves of Qud style: the room's floors and walls, its light,
 * people walking where the world says they went, fireballs, barks and damage numbers as the turn
 * lands), or on the map (the room with its roof off, as the town has it: #map). With `pointing`,
 * the mouse points at what's in it and clicks it, on the place and in the list.
 */
export function Place({ game, width, height, legend = true, view = "stage", pointing, least = 8 }: { game: Game; width: number; height: number; legend?: boolean; view?: "stage" | "map"; pointing?: PlacePointing; /** The fewest rows the place itself keeps (the list gets the rest). */ least?: number }) {
  const core = game.core;
  const session = game.session;
  // The scene on screen: the one being played, or one just over, its place as it was left, in its own light.
  const world = game.shownWorld;
  const stage = world && session ? { ...session, world } : session;
  if (!core) return null;
  const people = world ? Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.states.includes("gone")) : [];
  const surfaces = world ? Object.values(world.entities).filter(e => e.kind === "surface" && !e.states.includes("gone")) : [];
  const shown = legend ? Math.max(0, Math.min(people.length + surfaces.length, height - least)) : 0;
  const listed = [...people, ...surfaces].slice(0, shown);
  const look = game.sceneLook();
  const time = (game.shownScene ? sceneById(game.shownScene).time : undefined) ?? game.story.time;
  const glyphs = glyphSet();
  // Who's who as the player knows them (the boy in the too-big boots, until he's named).
  const ctx = game.sceneContext();
  const lit = pointing?.lit;
  const hover = lit ? ("id" in lit ? lit.id : lit.cell) : undefined;
  const pickAt = (e: MouseEvent) => {
    const c = pointing?.canvas.current, p = pointing?.picks.current;
    if (!c || !p || p.scene !== world?.scene) return undefined;
    const cell = { x: e.x - c.x, y: e.y - c.y };
    return targetOf(p.at(cell.x, cell.y), cell);
  };
  if (pointing?.hit && view === "stage") pointing.hit.current = (x, y) => {
    const c = pointing.canvas.current;
    if (!c) return undefined;
    const cell = { x: x - c.x, y: y - c.y };
    if (cell.x < 0 || cell.x >= width) return undefined;
    if (cell.y >= 0 && cell.y < c.height) {
      const p = pointing.picks.current;
      return p && p.scene === world?.scene ? targetOf(p.at(cell.x, cell.y), cell) : undefined;
    }
    // The list is the lines right under the place.
    const row = listed[cell.y - c.height];
    return row ? { id: row.id } : undefined;
  };
  const mouse = pointing && view === "stage" ? {
    onMouseMove: (e: MouseEvent) => pointing.point(pickAt(e), "place"),
    onMouseOut: () => pointing.point(undefined, "place"),
    onMouseDown: (e: MouseEvent) => {
      if (e.button !== MouseButton.LEFT && e.button !== MouseButton.RIGHT) return;
      e.stopPropagation();
      const target = pickAt(e);
      if (target) pointing.click(target, e.button === MouseButton.RIGHT ? "right" : "left", e.x, e.y);
      else pointing.miss();
    },
  } : {};
  return <box flexDirection="column" flexShrink={0}>
    <lookCanvas ref={pointing?.canvas} width={width} height={Math.max(Math.min(6, least), height - shown)} fps={FPS} live={view === "map" || !game.overlay} {...mouse} painter={view === "stage"
      ? (w, h, now) => {
        // In a browser, the doors are drawn as pictures over the place: the picks keep where they are.
        const doors = overlayWanted();
        const pick = pointing || doors ? new StagePicks({ doors }) : undefined;
        const frame = stageView(stage, { w, h }, { t: now, time, glyphs, ...(look ? { effects: look.fx, positions: id => look.director.tweens.at(id, now) } : {}), ...(pick ? { pick } : {}), ...(hover !== undefined ? { hover } : {}) });
        if (pick && pointing) pointing.picks.current = pick;
        return frame && pick && doors ? { frame, doors: stageDoors(pick, frame), lamps: stageLamps(pick) } : frame ?? [];
      }
      : (w, h, now) => {
        const pick = overlayWanted() ? new Picks({ doors: true }) : undefined;
        const lines = townView(core.state, session, { w, h }, { t: now, ...(look ? { effects: look.fx } : {}), ...(pick ? { pick } : {}) });
        return pick ? { frame: lines, doors: mapDoors(pick, lines), lamps: mapLamps(pick, lines) } : lines;
      }} />
    {listed.map(e => {
      const seen = lookOf(e, { glyphs });
      const states = e.states.filter(s => s !== "gone" && s !== "lit");
      // The name first; how they are in what room's left, or not at all (never a lone ellipsis).
      const name = truncate(world ? nameOf(world, e, ctx) : e.name, width - 2);
      const room = width - 2 - name.length;
      const how = states.length ? ` (${states.join(", ")})` : "";
      const on = !!lit && sameTarget(lit, { id: e.id });
      const row = <text flexShrink={0}>
        <span fg={seen.fg} attributes={BOLD}>{`${seen.glyph} `}</span>
        <span fg={e.kind === "surface" ? C.dim : C.text}>{name}</span>
        {how && (how.length <= room || room >= 8) ? <span fg={C.dim}>{truncate(how, room)}</span> : null}
      </text>;
      // Pointing at a line is pointing at them; a click talks to them (or looks), a right-click says what you can do.
      return pointing ? <box key={e.id} height={1} flexShrink={0} {...(on ? { backgroundColor: C.highlightBg } : {})}
        onMouseOver={() => pointing.point({ id: e.id }, "list")} onMouseOut={() => pointing.point(undefined, "list")}
        onMouseDown={(m: MouseEvent) => {
          if (m.button !== MouseButton.LEFT && m.button !== MouseButton.RIGHT) return;
          m.stopPropagation();
          pointing.click({ id: e.id }, m.button === MouseButton.RIGHT ? "right" : "left", m.x, m.y);
        }}>{row}</box> : <box key={e.id} height={1} flexShrink={0}>{row}</box>;
    })}
  </box>;
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
