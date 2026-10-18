// New (M6, docs/combat-design.md): a fight as the client holds it, made from its rows: the board, the map it's on, its moments in order, the player's options on their turn, and how it went.
import type { FightBoard, FightEvent, FightOptions, FightOutcome, FightResult } from "../../shared/fight/types.ts";
import { mapOf, type MapFile } from "../../shared/map/tiles.ts";
import type { TileMap } from "../../shared/map/types.ts";

/**
 * A fight as a screen or the headless client reads it (docs/combat-design.md §2): where it is and
 * on what map, on or over, the round, whose turn, the initiative order, the board (who's where and
 * how, the hazards), every moment so far in order, the player's options when it's their turn, and
 * how it went once it's over. `watching`: whose fight it is, when it isn't this player's.
 */
export interface FightView {
  game: string;
  id: string;
  title: string;
  place: string;
  status: "on" | "over" | "done";
  outcome?: FightOutcome;
  round: number;
  /** Whose turn it is (a unit id; "" once it's over). */
  turn: string;
  order: string[];
  board: FightBoard;
  map: TileMap;
  events: FightEvent[];
  /** This player's options, on their turn. */
  options?: FightOptions;
  result?: FightResult;
  /** Whose fight it is, when it isn't this player's: they're watching. */
  watching?: string;
  /** The words of the last move the simulation refused, until the next move. */
  refusal?: string;
}

/** A fight's rows as the client has them: the fight row's columns it reads, its moments' rows, the map file it's on, and who's asking. */
export interface FightRows {
  me: bigint;
  game: bigint;
  fight: {
    id: bigint; playerId: bigint; title: string; place: string; mapKey?: string | undefined; map?: string | undefined; status: string; outcome?: string | undefined;
    round: number; turn: string; order: string[]; board: string; options: string; result?: string | undefined;
  };
  events: Array<{ seq: number; round: number; turn: string; kind: string; actor?: string | undefined; target?: string | undefined; caption: string; detail: string }>;
  /** The campaign's map file it's on, when it's the campaign's (its own is on the fight row). */
  mapFile?: string;
  /** The name of the player whose fight it is. */
  owner: string;
  refusal?: string;
}

/** The tile maps fights are drawn on, built once by the file they're built from. */
const MAPS = new Map<string, TileMap>();

/** A fight's view from its rows; undefined when its map isn't in yet (the campaign's maps come with their own subscription). */
export function fightViewOf(rows: FightRows): FightView | undefined {
  const f = rows.fight;
  const json = f.map ?? rows.mapFile;
  if (!json) return undefined;
  let map = MAPS.get(json);
  if (!map) {
    map = mapOf(JSON.parse(json) as MapFile).map;
    MAPS.set(json, map);
  }
  const mine = f.playerId === rows.me;
  return {
    game: String(rows.game), id: String(f.id), title: f.title, place: f.place, status: f.status as FightView["status"],
    ...(f.outcome ? { outcome: f.outcome as FightOutcome } : {}),
    round: f.round, turn: f.turn, order: [...f.order], board: JSON.parse(f.board) as FightBoard, map,
    events: [...rows.events].sort((a, b) => a.seq - b.seq).map(e => ({
      seq: e.seq, round: e.round, turn: e.turn, kind: e.kind as FightEvent["kind"], ...(e.actor !== undefined ? { actor: e.actor } : {}),
      ...(e.target !== undefined ? { target: e.target } : {}), caption: e.caption, detail: JSON.parse(e.detail) as FightEvent["detail"],
    })),
    ...(mine && f.options ? { options: JSON.parse(f.options) as FightOptions } : {}),
    ...(f.result ? { result: JSON.parse(f.result) as FightResult } : {}),
    ...(mine ? {} : { watching: rows.owner }),
    ...(rows.refusal ? { refusal: rows.refusal } : {}),
  };
}

/** The fight is for the player to act in: theirs, on, and their turn. */
export const myTurn = (view: FightView) => view.status === "on" && !!view.options;
