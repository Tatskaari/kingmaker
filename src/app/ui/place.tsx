import { lookOf } from "../../game/look/appearance.ts";
import { glyphSet } from "../../game/look/glyphs.ts";
import { stageView, townView } from "../../game/views.ts";
import type { Game } from "../game.ts";
import { C } from "../theme.ts";
import { BOLD, FPS } from "./common.tsx";

/**
 * The open scene's place, alive, then who's here (with the letters and colours they have in it).
 * From above (the look layer's stage, Caves of Qud style: the room's floors and walls, its light,
 * people walking where the world says they went, fireballs, barks and damage numbers as the turn
 * lands), or on the map (the room with its roof off, as the town has it: #map).
 */
export function Place({ game, width, height, legend = true, view = "stage" }: { game: Game; width: number; height: number; legend?: boolean; view?: "stage" | "map" }) {
  const core = game.core;
  const session = game.session;
  const world = session?.world;
  if (!core) return null;
  const people = world ? Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.states.includes("gone")) : [];
  const surfaces = world ? Object.values(world.entities).filter(e => e.kind === "surface" && !e.states.includes("gone")) : [];
  const shown = legend ? Math.max(0, Math.min(people.length + surfaces.length, height - 8)) : 0;
  const listed = [...people, ...surfaces].slice(0, shown);
  const look = game.sceneLook();
  const time = game.story.time;
  const glyphs = glyphSet();
  return <box flexDirection="column" flexShrink={0}>
    <lookCanvas width={width} height={Math.max(6, height - shown)} fps={FPS} live={view === "map" || !game.overlay} painter={view === "stage"
      ? (w, h, now) => stageView(session, { w, h }, { t: now, time, glyphs, ...(look ? { effects: look.fx, positions: id => look.director.tweens.at(id, now) } : {}) }) ?? []
      : (w, h, now) => townView(core.state, session, { w, h }, { t: now, ...(look ? { effects: look.fx } : {}) })} />
    {listed.map(e => {
      const seen = lookOf(e, { glyphs });
      const states = e.states.filter(s => s !== "gone" && s !== "lit");
      return <text key={e.id} flexShrink={0}>
        <span fg={seen.fg} attributes={BOLD}>{`${seen.glyph} `}</span>
        <span fg={e.kind === "surface" ? C.dim : C.text}>{truncate(e.player ? "you" : e.name, width - 4)}</span>
        {states.length ? <span fg={C.dim}>{truncate(` (${states.join(", ")})`, Math.max(0, width - e.name.length - 4))}</span> : null}
      </text>;
    })}
  </box>;
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
