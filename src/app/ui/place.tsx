import { lookForEntity } from "../../game/map/index.ts";
import { MapView } from "../../game/map/view.tsx";
import { townView } from "../../game/views.ts";
import type { Game } from "../game.ts";
import { C } from "../theme.ts";
import { BOLD } from "./common.tsx";

/**
 * The open scene's place, drawn by the map (the room with its roof off, everyone where the scene's
 * world has them now), then who's here: the same letters and colours as on the map.
 */
export function Place({ game, width, height, legend = true }: { game: Game; width: number; height: number; legend?: boolean }) {
  const core = game.core;
  const world = game.session?.world;
  if (!core) return null;
  const people = world ? Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.states.includes("gone")) : [];
  const surfaces = world ? Object.values(world.entities).filter(e => e.kind === "surface" && !e.states.includes("gone")) : [];
  const shown = legend ? Math.max(0, Math.min(people.length + surfaces.length, height - 8)) : 0;
  const lines = townView(core.state, game.session, { w: width, h: Math.max(6, height - shown) }, { tick: game.tick });
  const listed = [...people, ...surfaces].slice(0, shown);
  return <box flexDirection="column" flexShrink={0}>
    <MapView lines={lines} />
    {listed.map(e => {
      const look = lookForEntity(e);
      const states = e.states.filter(s => s !== "gone" && s !== "lit");
      return <text key={e.id} flexShrink={0}>
        <span fg={look.color} attributes={BOLD}>{`${e.player ? "@" : look.glyph} `}</span>
        <span fg={e.kind === "surface" ? C.dim : C.text}>{truncate(e.player ? "you" : e.name, width - 4)}</span>
        {states.length ? <span fg={C.dim}>{truncate(` (${states.join(", ")})`, Math.max(0, width - e.name.length - 4))}</span> : null}
      </text>;
    })}
  </box>;
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
