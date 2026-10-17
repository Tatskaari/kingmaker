import type { Refusal } from "../shared/protocol/refusals.ts";
import type { DbConnection } from "./module_bindings/index.ts";
import type { Campaign, Creation, GameSummary, Player, SeatView, Sheet } from "./module_bindings/types.ts";
import type { SceneView } from "./scene/view.ts";

/**
 * What the screens and the headless client play through: the scene's view, the rows the title and
 * character creation read, word when they change, and the moves, each answered with why not when it
 * wasn't made. The SpacetimeDB connection (net/connection.ts) is one; the demo (demo.ts), canned
 * turns and a canned character with no server, is another.
 */
export interface Backend {
  /** The scene as this client sees it; undefined while there's no seat, its game hasn't begun, or its rows haven't come yet. */
  view(): SceneView | undefined;
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
  /** One of V1's moves (v1-design §3.3), by its reducer's name. The refusal's words are home()'s `refusal` too, until the next move. */
  act<K extends MoveName>(move: K, args: Moves[K]): Promise<Rejection | undefined>;
  close(): void;
}

/** Character creation's moves, and the games': called by name (v1-design §3.10). */
export type MoveName =
  | "startCreation" | "creationBack" | "chooseBuild" | "makeOwn" | "pickOwn" | "takeOwn" | "setBackstory" | "draftBackstory"
  | "workInBackstory" | "takeProposal" | "leaveProposal" | "finishBackstory" | "acceptFix" | "rewriteIssue" | "skipBackstory"
  | "chooseAgain" | "begin" | "continueGame" | "deleteGame";

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
export type GameRow = Pick<GameSummary, "gameId" | "name" | "time" | "where" | "hook" | "begun" | "lastPlayedAt">;
export type CampaignRow = Pick<Campaign, "key" | "version" | "title" | "json">;
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
