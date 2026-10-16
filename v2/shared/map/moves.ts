// New (K): the map's three moves (walk, interact, travel: v2/docs/map-design.md §3.2) and the prototype's action ids they're made with (src/game/town.ts's header at 44c6d4a), both ways.
import { COMPASS } from "./town.ts";
import type { Tile2 } from "./types.ts";

/** walk's arguments: a tile to walk to, or where to walk toward (a compass word for one step, "lead", "out", or something in sight). */
export interface WalkArgs { to?: Tile2; toward?: string }
/** interact's: use (the e key), look, talk, examine, enter, open, take; at something in sight (`target`, its id's last part, or a compass word for a door), or at a tile. */
export interface InteractArgs { verb: string; target?: string; at?: Tile2 }
/** travel's: a way out in sight (`way`, its id's last part), or the way out at a tile. */
export interface TravelArgs { way?: string; at?: Tile2 }

export type MapMove = { move: "walk"; args: WalkArgs } | { move: "interact"; args: InteractArgs } | { move: "travel"; args: TravelArgs };

/** walk toward the lead: go_to_lead. */
export const LEAD = "lead";
/** walk toward out: from an ended scene back onto its map (the prototype's core did it as the scene ended: it has no id). */
export const OUT = "out";

export const VERBS = ["use", "look", "talk", "examine", "enter", "open", "take"] as const;

const tile = (at: Tile2) => `${at.x},${at.y}`;
const isCompass = (word: string) => Object.prototype.hasOwnProperty.call(COMPASS, word);

/** The prototype's action id a move is made with; undefined for `walk out`, which has none, and for arguments that name nothing. */
export function actionId(m: MapMove): string | undefined {
  switch (m.move) {
    case "walk": {
      const { to, toward } = m.args;
      if (to) return `walk@${tile(to)}`;
      if (!toward || toward === OUT) return undefined;
      if (toward === LEAD) return "go_to_lead";
      return isCompass(toward) ? `walk_${toward}` : `go_to_${toward}`;
    }
    case "interact": {
      const { verb, target, at } = m.args;
      if (verb === "use") return "interact";
      if (verb === "look" || verb === "examine") {
        if (at) return `look@${tile(at)}`;
        if (target) return `examine_${target}`;
        return verb === "look" ? "look" : undefined;
      }
      if (verb === "open") return at ? `door@${tile(at)}` : target ? (isCompass(target) ? `open_door_${target}` : `open_${target}`) : undefined;
      if (verb === "talk" || verb === "enter") return at ? `${verb}@${tile(at)}` : target ? `${verb}_${target}` : undefined;
      if (verb === "take") return target ? `take_${target}` : undefined;
      return undefined;
    }
    case "travel": {
      const { way, at } = m.args;
      return at ? `travel@${tile(at)}` : way ? `travel_${way}` : undefined;
    }
  }
}

/** The move an action id is made with (the headless client's `act --id`), or undefined when it's no map action's. */
export function moveOf(id: string): MapMove | undefined {
  const at = /^(walk|look|talk|enter|travel|door)@(\d+),(\d+)$/.exec(id);
  if (at) {
    const where = { x: Number(at[2]), y: Number(at[3]) };
    switch (at[1]) {
      case "walk": return { move: "walk", args: { to: where } };
      case "look": return { move: "interact", args: { verb: "look", at: where } };
      case "talk": case "enter": return { move: "interact", args: { verb: at[1], at: where } };
      case "door": return { move: "interact", args: { verb: "open", at: where } };
      case "travel": return { move: "travel", args: { at: where } };
    }
  }
  if (id === "go_to_lead") return { move: "walk", args: { toward: LEAD } };
  if (id === "interact") return { move: "interact", args: { verb: "use" } };
  if (id === "look") return { move: "interact", args: { verb: "look" } };
  const step = /^walk_(\w+)$/.exec(id);
  if (step && isCompass(step[1]!)) return { move: "walk", args: { toward: step[1]! } };
  const door = /^open_door_(\w+)$/.exec(id);
  if (door && isCompass(door[1]!)) return { move: "interact", args: { verb: "open", target: door[1]! } };
  const named = /^(go_to|talk|examine|enter|open|take|travel)_(.+)$/.exec(id);
  if (!named) return undefined;
  const [, verb, target] = named as unknown as [string, string, string];
  if (verb === "go_to") return { move: "walk", args: { toward: target } };
  if (verb === "travel") return { move: "travel", args: { way: target } };
  return { move: "interact", args: { verb, target } };
}
