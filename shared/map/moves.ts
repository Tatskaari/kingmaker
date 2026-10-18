// New (K): the map's three moves (walk, interact, travel: docs/map-design.md §3.2) and the prototype's action ids they're made with (src/game/town.ts's header at 44c6d4a), both ways; and the action menu's seven (cast, attack, useFeature, leap, hide, rest, useItem: docs/town-design.md §3.2) with its ids (src/game/menu.ts's header), and a talk's walk_on.
import { COMPASS } from "./town.ts";
import type { Tile2 } from "./types.ts";

/** walk's arguments: a tile to walk to, or where to walk toward (a compass word for one step, "lead", "out", or something in sight). */
export interface WalkArgs { to?: Tile2; toward?: string }
/** interact's: use (the e key), look, talk, examine, enter, open, take; at something in sight (`target`, its id's last part, or a compass word for a door), or at a tile. */
export interface InteractArgs { verb: string; target?: string; at?: Tile2 }
/** travel's: a way out in sight (`way`, its id's last part), or the way out at a tile. */
export interface TravelArgs { way?: string; at?: Tile2 }

/** cast's: the spell's id, and where it's aimed: at a tile (whoever or whatever is there, or an area's spot or way), at yourself, or nowhere (a spell with no aim). */
export interface CastArgs { spell: string; at?: Tile2; self?: boolean }
/** attack's `how`: a blow with the weapon in hand, something thrown, a shove, a grab, a pocket picked. */
export type AttackHow = "attack" | "throw" | "shove" | "grapple" | "lift";
/** attack's: how, and the tile it's aimed at. */
export interface AttackArgs { how: AttackHow; at: Tile2 }
/** useFeature's: the class feature's id (second-wind, lay-on-hands, divine-spark…), aimed as a spell is. */
export interface FeatureArgs { feature: string; at?: Tile2; self?: boolean }
/** leap's: the tile to land on. */
export interface LeapArgs { at: Tile2 }
/** hide's: none. */
export type HideArgs = Record<string, never>;
/** rest's: an hour or a night; `recover`, a wizard's Arcane Recovery with the short one. */
export interface RestArgs { length: "short" | "long"; recover?: boolean }
/** useItem's: the engine's instance id of something carried that's used up (a potion). */
export interface ItemArgs { item: string }

export type MapMove =
  | { move: "walk"; args: WalkArgs } | { move: "interact"; args: InteractArgs } | { move: "travel"; args: TravelArgs }
  | { move: "cast"; args: CastArgs } | { move: "attack"; args: AttackArgs } | { move: "useFeature"; args: FeatureArgs } | { move: "leap"; args: LeapArgs }
  | { move: "hide"; args: HideArgs } | { move: "rest"; args: RestArgs } | { move: "useItem"; args: ItemArgs };

/** The action menu's moves (town-design §3.2): the rules on the town's world. */
export const MENU_MOVES = ["cast", "attack", "useFeature", "leap", "hide", "rest", "useItem"] as const;
export type MenuMove = Extract<MapMove, { move: (typeof MENU_MOVES)[number] }>;
export const isMenuMove = (m: MapMove): m is MenuMove => (MENU_MOVES as readonly string[]).includes(m.move);

/** walk toward the lead: go_to_lead. */
export const LEAD = "lead";
/** walk toward out: from an ended scene back onto its map (the prototype's core did it as the scene ended: it has no id); from a talk still going, walking on (a talk's walk_on). */
export const OUT = "out";

export const VERBS = ["use", "look", "talk", "examine", "enter", "open", "take"] as const;

const tile = (at: Tile2) => `${at.x},${at.y}`;
const isCompass = (word: string) => Object.prototype.hasOwnProperty.call(COMPASS, word);

/** The prototype's action id a move is made with; undefined for `walk out`, which has none, and for arguments that name nothing. */
export function actionId(m: MapMove): string | undefined {
  switch (m.move) {
    case "cast": return aimedId(`cast_${m.args.spell}`, m.args);
    case "useFeature": return aimedId(`feature_${m.args.feature}`, m.args);
    case "attack": return `${m.args.how}@${tile(m.args.at)}`;
    case "leap": return `jump@${tile(m.args.at)}`;
    case "hide": return "hide";
    case "rest": return m.args.length === "long" ? "rest_long" : m.args.recover ? "rest_short_recover" : "rest_short";
    case "useItem": return `use_${m.args.item}`;
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

/** A spell's or a feature's id, aimed: at a tile, at yourself, or not at all (menu.ts's STEM). */
const aimedId = (stem: string, a: { at?: Tile2 | undefined; self?: boolean | undefined }) => (a.at ? `${stem}@${tile(a.at)}` : a.self ? `${stem}_self` : stem);

/** The menu's ids (menu.ts:479-483): a spell or a feature, aimed or not; a blow, a throw, a shove, a grab, a lift or a leap at a tile; hiding, a rest; something used up. */
const STEM = /^(cast|feature)_(.+?)(?:_(self)|@(\d+),(\d+))?$/;
const BLOW = /^(attack|throw|shove|grapple|jump|lift)@(\d+),(\d+)$/;

/** The action menu's move an id is made with, or undefined when it isn't one of the menu's. */
function menuMoveOf(id: string): MapMove | undefined {
  const stem = STEM.exec(id);
  if (stem) {
    const [, kind, name, self, x, y] = stem as unknown as [string, string, string, string | undefined, string | undefined, string | undefined];
    const aim = x !== undefined && y !== undefined ? { at: { x: Number(x), y: Number(y) } } : self ? { self: true } : {};
    return kind === "cast" ? { move: "cast", args: { spell: name, ...aim } } : { move: "useFeature", args: { feature: name, ...aim } };
  }
  const blow = BLOW.exec(id);
  if (blow) {
    const at = { x: Number(blow[2]), y: Number(blow[3]) };
    return blow[1] === "jump" ? { move: "leap", args: { at } } : { move: "attack", args: { how: blow[1] as AttackHow, at } };
  }
  if (id === "hide") return { move: "hide", args: {} };
  if (id === "rest_short") return { move: "rest", args: { length: "short" } };
  if (id === "rest_short_recover") return { move: "rest", args: { length: "short", recover: true } };
  if (id === "rest_long") return { move: "rest", args: { length: "long" } };
  const item = /^use_(.+)$/.exec(id);
  return item ? { move: "useItem", args: { item: item[1]! } } : undefined;
}

/** The move an action id is made with (the headless client's `act --id`), or undefined when it's no map action's. */
export function moveOf(id: string): MapMove | undefined {
  if (id === "walk_on") return { move: "walk", args: { toward: OUT } };
  const menu = menuMoveOf(id);
  if (menu) return menu;
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
