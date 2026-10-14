import type { Action, Explorer, GameState } from "../game/play.ts";
import type { MapActor, Tile2 } from "../game/types.ts";
import type { SessionState } from "../runtime/session.ts";
import { sceneById } from "../../scenes/index.ts";
import type { Dir, MapAdapter, Position } from "./adapters.ts";
import { chebyshev } from "./geometry.ts";

/**
 * Exploring on a map, as the game core (src/game/play.ts) sees exploration: an Explorer over a
 * MapAdapter (the stand-in town, or src/game/map when it lands). Where the player stands lives in
 * the game's explore state, so the game saves it; the terminal app draws the map from it, and the
 * headless QA console can play the same map through observe() and the action ids.
 */

const MOVES: Record<string, Dir> = { go_north: "n", go_south: "s", go_east: "e", go_west: "w" };
export const MOVE_ID: Record<Dir, string> = { n: "go_north", s: "go_south", e: "go_east", w: "go_west", ne: "go_north", nw: "go_north", se: "go_south", sw: "go_south" };

export function positionOf(game: GameState, maps: MapAdapter): Position {
  const e = game.explore as Partial<{ map: string; x: number; y: number; facing: Dir }>;
  return typeof e.map === "string" && typeof e.x === "number" && typeof e.y === "number"
    ? { map: e.map, at: { x: e.x, y: e.y }, facing: e.facing ?? "s" }
    : maps.start();
}

function place(game: GameState, pos: Position): void {
  game.explore = { ...game.explore, map: pos.map, x: pos.at.x, y: pos.at.y, facing: pos.facing };
}

/** "talk_kell", "enter_rat_door", "examine_goose": what interacting with someone or something is called. */
export function actionIdOf(actor: MapActor): string {
  const i = actor.interaction;
  const verb = !i || i.kind === "examine" ? "examine" : i.kind === "travel" ? "travel" : i.verb === "talk" ? "talk" : i.verb === "examine" ? "examine" : "enter";
  return `${verb}_${actor.id.replace(/-/g, "_")}`;
}

function kindOf(actor: MapActor): Action["kind"] {
  const i = actor.interaction;
  return !i || i.kind === "examine" ? "examine" : i.kind === "travel" ? "travel" : i.verb === "talk" ? "talk" : i.verb === "examine" ? "examine" : "enter";
}

function heading(from: Tile2, to: Tile2): string {
  const ns = to.y < from.y ? "north" : to.y > from.y ? "south" : "";
  const ew = to.x < from.x ? "west" : to.x > from.x ? "east" : "";
  return ns && ew ? `${ns}-${ew}` : ns || ew || "here";
}

export interface MapExplorer extends Explorer {
  position(game: GameState): Position;
  /** Who and what is on the player's map now. */
  actors(game: GameState): MapActor[];
}

export function mapExplorer(maps: MapAdapter): MapExplorer {
  const actorsOf = (game: GameState) => maps.actors(positionOf(game, maps).map, game.story);
  /** A lead the map has no place for (a scene it doesn't know) opens from anywhere. */
  const placeless = (game: GameState) => !!game.story.lead && !maps.sceneLocation(game.story.lead);
  const explorer: MapExplorer = {
    position: game => positionOf(game, maps),
    actors: actorsOf,
    start(game) { place(game, maps.start()); },
    observe(game) {
      const pos = positionOf(game, maps);
      const region = maps.regionAt(pos.map, pos.at);
      const lines = [`You are in ${region?.name ?? "the streets of Caerwyn"} (${game.story.time.replace("-", " ")}).`];
      const lead = game.story.lead;
      const where = lead ? maps.sceneLocation(lead) : undefined;
      if (lead) lines.push(`The story is heading for ${sceneById(lead).title}${where ? `: ${where.name}, ${chebyshev(pos.at, where.at)} paces ${heading(pos.at, where.at)}` : ""}.`);
      const near = maps.nearby(pos, actorsOf(game), 8).slice(0, 8);
      if (near.length) lines.push(`Nearby: ${near.map(n => `${n.actor.name} (${n.distance <= 1 ? "right here" : `${n.distance} paces ${heading(pos.at, n.actor.at)}`})`).join(", ")}.`);
      return lines.join("\n");
    },
    actions(game) {
      const pos = positionOf(game, maps);
      const reach = maps.reachable(pos, actorsOf(game));
      return [
        ...reach.filter(a => a.interaction).map(a => ({ id: actionIdOf(a), label: a.interaction!.label, kind: kindOf(a) })),
        ...(placeless(game) ? [{ id: "go_lead", label: `Go to ${sceneById(game.story.lead!).title}`, kind: "enter" as const }] : []),
        ...Object.keys(MOVES).map(id => ({ id, label: `Walk ${id.slice(3)}`, kind: "move" as const })),
        { id: "look", label: "Look around", kind: "examine" as const },
      ] satisfies Action[];
    },
    act(game, _session: SessionState, id) {
      const pos = positionOf(game, maps);
      const actors = actorsOf(game);
      const dir = MOVES[id];
      if (dir) {
        const step = maps.step(pos, dir, actors, game.story);
        place(game, step.pos);
        if (step.trigger?.kind === "scene" && step.trigger.sceneId === game.story.lead) return { text: step.message ?? "", scene: true };
        return { text: step.message ?? "" };
      }
      if (id === "look") return { text: explorer.observe(game, _session) };
      if (id === "go_lead" && placeless(game)) return { text: "", scene: true };
      const actor = maps.reachable(pos, actors).find(a => actionIdOf(a) === id);
      const i = actor?.interaction;
      if (!actor || !i) throw new Error(`Unavailable action: ${id}`);
      if (i.kind === "examine") return { text: i.text };
      if (i.kind === "travel") { place(game, { map: i.to.map, at: i.to.at, facing: pos.facing }); return { text: i.label }; }
      if (i.sceneId === game.story.lead) return { text: "", scene: true };
      return { text: `${actor.name.charAt(0).toUpperCase()}${actor.name.slice(1)} will keep. The trail leads elsewhere for now.` };
    },
    afterScene(game, session) {
      // Leaving a scene, you're outside the place it happened.
      const last = session.history.at(-1)?.sceneId;
      if (last) place(game, maps.afterScene(last, positionOf(game, maps)));
    },
  };
  return explorer;
}
