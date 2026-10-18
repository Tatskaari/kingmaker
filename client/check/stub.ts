import type { InteractArgs, TravelArgs, WalkArgs } from "../../shared/map/moves.ts";
import type { Backend, CampaignRow, HomeRows, MoveName, Moves, NewGame, Rejection } from "../backend.ts";
import type { ExploreView } from "../explore/rows.ts";
import type { SceneView } from "../scene/view.ts";

/**
 * A backend over rows a check sets, each move recorded (the screen check's, and the models'
 * tests'): nothing happens on a move unless `answers` says what (a refusal, or rows changed), as
 * the simulation would; `set` changes the rows and tells the listeners, as a commit does.
 */
export class StubBackend implements Backend {
  rows: HomeRows;
  scene?: SceneView;
  /** The map between scenes, when a check sets one. */
  map?: ExploreView;
  /** Every move made, in order: its name and its arguments. */
  readonly moves: Array<{ name: string; args: unknown }> = [];
  /** What a move does, by name: a refusal to answer with, or nothing (after changing the rows, say). */
  readonly answers: Partial<Record<MoveName | "say" | "retry" | "setSuggestions" | "newGame" | "joinGame" | "walk" | "interact" | "travel", (args: never) => Rejection | void>> = {};
  private readonly listeners = new Set<() => void>();

  constructor(rows: Partial<HomeRows> = {}, scene?: SceneView) {
    this.rows = { games: [], campaigns: [CAERWYN], ...rows };
    if (scene) this.scene = scene;
  }

  /** The rows changed (and the scene's view, when one's given; null takes it away), as a commit changes them. */
  set(patch: Partial<HomeRows>, scene?: SceneView | null): void {
    this.rows = { ...this.rows, ...patch };
    for (const key of Object.keys(patch) as Array<keyof HomeRows>) if (patch[key] === undefined) delete this.rows[key];
    if (scene === null) delete this.scene;
    else if (scene) this.scene = scene;
    for (const listener of this.listeners) listener();
  }

  /** The names of the moves made since the last look, and forget them. */
  made(): string[] {
    return this.moves.splice(0).map(m => m.name);
  }

  view(): SceneView | undefined { return this.scene; }
  explore(): ExploreView | undefined { return this.map; }
  home(): HomeRows { return this.rows; }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  newGame(args: NewGame): Promise<Rejection | undefined> { return this.answer("newGame", args); }
  joinGame(game: bigint): Promise<Rejection | undefined> { return this.answer("joinGame", { game }); }
  say(text: string): Promise<Rejection | undefined> { return this.answer("say", { text }); }
  retry(): Promise<Rejection | undefined> { return this.answer("retry", {}); }
  setSuggestions(on: boolean): Promise<Rejection | undefined> { return this.answer("setSuggestions", { on }); }
  walk(args: WalkArgs): Promise<Rejection | undefined> { return this.answer("walk", args); }
  interact(args: InteractArgs): Promise<Rejection | undefined> { return this.answer("interact", args); }
  travel(args: TravelArgs): Promise<Rejection | undefined> { return this.answer("travel", args); }
  act<K extends MoveName>(move: K, args: Moves[K]): Promise<Rejection | undefined> { return this.answer(move, args); }
  close(): void {}

  private answer(name: keyof StubBackend["answers"], args: unknown): Promise<Rejection | undefined> {
    this.moves.push({ name, args });
    const refused = (this.answers[name] as ((args: unknown) => Rejection | void) | undefined)?.(args) ?? undefined;
    this.set(refused ? { refusal: refused.text } : { refusal: undefined });
    return Promise.resolve(refused);
  }
}

/** The campaign installed, as its row has it: Caerwyn, whose characters are made at level 3. */
export const CAERWYN: CampaignRow = { key: "caerwyn", version: "0.1.0", title: "Caerwyn", json: JSON.stringify({ id: "caerwyn", title: "Caerwyn", level: 3 }) };
