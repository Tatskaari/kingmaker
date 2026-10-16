import type { Refusal } from "../shared/protocol/refusals.ts";
import type { SceneView } from "./scene/view.ts";

/**
 * What the screen and the headless client play through: the scene's view, word when it changes,
 * and the moves, each answered with why not when it wasn't made. The SpacetimeDB connection
 * (net/connection.ts) is one; the demo (demo.ts), canned turns with no server, is another.
 */
export interface Backend {
  /** The scene as this client sees it; undefined while there's no seat, or its rows haven't come yet. */
  view(): SceneView | undefined;
  /** Called (once a tick at most) whenever the view may have changed; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  newGame(args: NewGame): Promise<Rejection | undefined>;
  joinGame(game: bigint): Promise<Rejection | undefined>;
  say(text: string): Promise<Rejection | undefined>;
  /** Carries the failed turn on: retry_turn on the scene's turn in flight. */
  retry(): Promise<Rejection | undefined>;
  close(): void;
}

/**
 * The view once it says so (`done`), each one seen on the way (`see`); an error when `ms` pass
 * first. A move's own rows come with its commit; the GM's answer takes seconds.
 */
export function viewWhen(game: Backend, done: (view: SceneView) => boolean, ms: number, see?: (view: SceneView) => void): Promise<SceneView> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const view = game.view();
      if (view) see?.(view);
      if (!view || !done(view)) return;
      clearTimeout(timer);
      stop();
      resolve(view);
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
