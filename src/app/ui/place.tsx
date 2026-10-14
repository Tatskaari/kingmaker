import { areaOf, type SceneWorld } from "../../world/scene-world.ts";
import { maps } from "../adapters.ts";
import { C, glyphOf, PEOPLE } from "../theme.ts";
import { BOLD, Lines } from "./common.tsx";

/** Who's where in the open scene: its world drawn small, then a legend of the people in it. */
export function Place({ world, width, height, legend = true }: { world: SceneWorld; width: number; height: number; legend?: boolean }) {
  const people = Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.states.includes("gone"));
  const lines = maps.sceneView(world, { width, height: legend ? Math.max(4, height - people.length - 1) : height });
  const glyph = (id: string, name: string) => glyphOf(id, name);
  return <box flexDirection="column" flexShrink={0}>
    <Lines lines={lines} />
    {legend ? people.map(p => <text key={p.id} flexShrink={0}>
      <span fg={p.player ? "#ffffff" : PEOPLE[p.cast ?? p.id] ?? C.neutral} attributes={BOLD}>{p.player ? "@ " : `${glyph(p.cast ?? p.id, p.name)} `}</span>
      <span fg={C.text}>{truncate(p.player ? "you" : p.name, width - 4)}</span>
      {p.states.filter(s => s !== "gone").length ? <span fg={C.dim}>{` (${p.states.filter(s => s !== "gone").join(", ")})`}</span> : null}
    </text>) : null}
    {legend ? <text fg={C.faint}>{`${areaOf(world, "player")?.name ?? ""}`}</text> : null}
  </box>;
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
