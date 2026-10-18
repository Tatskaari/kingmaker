import type { InteractArgs, MapMove, TravelArgs, WalkArgs } from "../shared/map/moves.ts";
import type { Refusal } from "../shared/protocol/refusals.ts";
import type { ExploreView } from "./explore/rows.ts";
import type { FightView } from "./fight/view.ts";
import type { DbConnection } from "./module_bindings/index.ts";
import type { Campaign, Creation, GameSummary, Player, SeatView, Sheet } from "./module_bindings/types.ts";
import type { SceneView } from "./scene/view.ts";

/**
 * What the screens and the headless client play through: the scene's view, the map between scenes,
 * the rows the title and character creation read, word when they change, and the moves, each
 * answered with why not when it wasn't made. The SpacetimeDB connection (net/connection.ts) is one;
 * the demo (demo.ts), canned turns and a canned character with no server, is another.
 */
export interface Backend {
  /** The scene as this client sees it; undefined while there's no seat, its game hasn't begun, or its rows haven't come yet. */
  view(): SceneView | undefined;
  /**
   * The map between scenes as this client sees it (map-design §3.6): the walker's (the host's)
   * ExploreState made from the rows, and what's said beside it; undefined while the seat's game has
   * no one on a map, or its rows haven't come yet.
   */
  explore(): ExploreView | undefined;
  /**
   * The seat's game's fight (M6, docs/combat-design.md), while it's on or its end is on screen;
   * undefined with none. A backend with no fights (the demo, a screen check's stub) hasn't got it.
   */
  fight?(): FightView | undefined;
  /** The player's games, the character they're making, the seat and its sheet, the campaigns: what the title and creation read. */
  home(): HomeRows;
  /** Called (once a tick at most) whenever the view or the rows may have changed; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  newGame(args: NewGame): Promise<Rejection | undefined>;
  joinGame(game: bigint): Promise<Rejection | undefined>;
  say(text: string): Promise<Rejection | undefined>;
  /** Carries the failed turn on: retry_turn on the scene's turn in flight. */
  retry(): Promise<Rejection | undefined>;
  /** This player's own setting, the suggested lines over the box: on (this moment's are asked for at once) or off. */
  setSuggestions(on: boolean): Promise<Rejection | undefined>;
  /** The map's three moves (map-design §3.2): a step or a walk, something done with what's in sight or at a tile, a way out taken. */
  walk(args: WalkArgs): Promise<Rejection | undefined>;
  interact(args: InteractArgs): Promise<Rejection | undefined>;
  travel(args: TravelArgs): Promise<Rejection | undefined>;
  /** One of V1's moves (v1-design §3.3), by its reducer's name. The refusal's words are home()'s `refusal` too, until the next move. */
  act<K extends MoveName>(move: K, args: Moves[K]): Promise<Rejection | undefined>;
  /**
   * A report of a problem's game (V16, M5): report_game, which only the game's owner may ask for,
   * its text JSON (shared/report/format.ts GameAnswer); else why it couldn't be asked. A backend with
   * no host to ask (the demo, a screen check's stub) hasn't got it.
   */
  reportGame?(game: bigint): Promise<string | Rejection>;
  close(): void;
}

/**
 * Character creation's moves, and the games': called by name (v1-design §3.10). And the story's
 * (story-design §4.3): walk (toward the lead: its scene opens), carry_on (a boundary that got stuck,
 * tried again), fight_it_out (the fight's stand-in), and end_scene, which only the database's owner
 * may make: the connection makes it as the dev stack's owner (net/owner.ts), for testing. And the
 * map's action menu (town-design §3.2): cast, attack, use_feature, leap, hide, rest, use_item, each
 * one of the prototype's menu ids (shared/map/moves.ts moveOf; mapMove sends them here). And a
 * fight's (M6): start_ring, a zoo ring's fight started, and fight_turn, the fight's own acts. And
 * the zoo's (M6): visit_zoo, a visit opening an exhibit, and open_exhibit, one opened again.
 */
export type MoveName =
  | "startCreation" | "creationBack" | "chooseBuild" | "makeOwn" | "pickOwn" | "takeOwn" | "setBackstory" | "draftBackstory"
  | "workInBackstory" | "takeProposal" | "leaveProposal" | "finishBackstory" | "acceptFix" | "rewriteIssue" | "skipBackstory"
  | "chooseAgain" | "begin" | "continueGame" | "deleteGame"
  | "walk" | "carryOn" | "fightItOut" | "endScene"
  | "cast" | "attack" | "useFeature" | "leap" | "hide" | "rest" | "useItem"
  | "startRing" | "fightTurn" | "visitZoo" | "openExhibit";

/** Each move's arguments, as the bindings have them. */
export type Moves = { [K in MoveName]: Parameters<DbConnection["reducers"][K]>[0] };

/**
 * The rows outside a scene, as the client holds them: the bindings' types narrowed to the columns
 * the screens read, so a change to the schema shows up in the type check.
 */
export interface HomeRows {
  /** my_games: the player's games, in no order (the title sorts them). */
  games: GameRow[];
  /** my_creation: the character being made, if one is. */
  creation?: CreationRow;
  /** The campaigns installed: their titles, and the level characters are made at. */
  campaigns: CampaignRow[];
  /** my_seat: the game the player is in now, and its scene once it has begun. */
  seat?: SeatRow;
  /** The seat's player: their character's name and concept. */
  player?: PlayerRow;
  /** The seat's player's sheet, as the rules engine made it. */
  sheet?: SheetRow;
  /** The words of the last move the simulation refused, until the next move. */
  refusal?: string;
}

export type CreationRow = Pick<Creation,
  | "campaign" | "name" | "concept" | "how" | "step" | "busy" | "rev" | "offer" | "own" | "chosen" | "story" | "version"
  | "proposal" | "issues" | "issue" | "rewriting" | "again" | "note" | "unchecked" | "backstory" | "gameId">;
/** A game as my_games lists it; its campaign ("zoo" for a zoo visit, which the title keeps apart: M6), where a backend has it. */
export type GameRow = Pick<GameSummary, "gameId" | "name" | "time" | "where" | "hook" | "begun" | "lastPlayedAt"> & Partial<Pick<GameSummary, "campaign">>;
/** A campaign installed; its ready-made builds (builds.json), where a backend has them (the zoo's menu offers them: M6). */
export type CampaignRow = Pick<Campaign, "key" | "version" | "title" | "json"> & Partial<Pick<Campaign, "builds">>;
export type SeatRow = Pick<SeatView, "playerId" | "gameId" | "sceneId">;
export type PlayerRow = Pick<Player, "name" | "concept">;
export type SheetRow = Pick<Sheet, "data" | "pockets" | "build" | "statusLine">;

/**
 * The view once it says so (`done`), each one seen on the way (`see`); an error when `ms` pass
 * first. A move's own rows come with its commit; the GM's answer takes seconds.
 */
export function viewWhen(game: Backend, done: (view: SceneView) => boolean, ms: number, see?: (view: SceneView) => void): Promise<SceneView> {
  return when(game, () => game.view(), done, ms, see);
}

/** The rows outside a scene once they say so (`done`): a creation step's answer, a game made. An error when `ms` pass first. */
export function homeWhen(game: Backend, done: (rows: HomeRows) => boolean, ms: number): Promise<HomeRows> {
  return when(game, () => game.home(), done, ms);
}

/** What `read` gives, once `done` says it's what was waited for. */
function when<T>(game: Backend, read: () => T | undefined, done: (value: T) => boolean, ms: number, see?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const value = read();
      if (value) see?.(value);
      if (!value || !done(value)) return;
      clearTimeout(timer);
      stop();
      resolve(value);
    };
    const timer = setTimeout(() => { stop(); reject(new Error(`No answer in ${ms / 1000} s: observe again in a moment.`)); }, ms);
    const stop = game.onChange(check);
    check();
  });
}

/** A map move (shared/map/moves.ts moveOf makes one from an action id) through the backend's walk, interact or travel, or, the action menu's (town-design §3.2), its act. */
export function mapMove(game: Pick<Backend, "walk" | "interact" | "travel" | "act">, m: MapMove): Promise<Rejection | undefined> {
  switch (m.move) {
    case "walk": return game.walk(m.args);
    case "interact": return game.interact(m.args);
    case "travel": return game.travel(m.args);
    case "cast": return game.act("cast", { spell: m.args.spell, at: m.args.at, self: m.args.self });
    case "attack": return game.act("attack", { how: m.args.how, at: m.args.at });
    case "useFeature": return game.act("useFeature", { feature: m.args.feature, at: m.args.at, self: m.args.self });
    case "leap": return game.act("leap", { at: m.args.at });
    case "hide": return game.act("hide", {});
    case "rest": return game.act("rest", { length: m.args.length, recover: m.args.recover });
    case "useItem": return game.act("useItem", { item: m.args.item });
  }
}

/** The map between scenes once it says so (`done`): a new game on its map, a move's row. An error when `ms` pass first. */
export function exploreWhen(game: Backend, done: (view: ExploreView) => boolean, ms: number): Promise<ExploreView> {
  return when(game, () => game.explore(), done, ms);
}

/** The game's fight once it says so (`done`): a ring's fight started, the other side's turns played up to the player's. An error when `ms` pass first. */
export function fightWhen(game: Backend, done: (view: FightView) => boolean, ms: number): Promise<FightView> {
  return when(game, () => game.fight?.(), done, ms);
}

/** A new game, as new_game takes it: the campaign's key, the character's name and concept, a ready-made build's id. */
export interface NewGame { campaign: string; name: string; concept: string; build: string }

/** The character of a new game from "Name: concept" (the prototype's QA console's --as): all of it is the name without a colon. */
export function newGameOf(who: string, build: string, campaign: string): NewGame {
  const [name = "", ...rest] = who.split(":");
  return { campaign, name: name.trim(), concept: rest.join(":").trim(), build };
}

/**
 * Why a move wasn't made: the simulation's refusal, in the game's words (nothing changed), or
 * what went wrong on the way (the server out of reach, a bug in the module), as an "error".
 */
export type Rejection = Refusal | { code: "error"; text: string };
