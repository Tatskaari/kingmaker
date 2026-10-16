import type { Backend, HomeRows } from "../backend.ts";
import { CreationModel } from "../creation/model.ts";
import { SceneModel, type SheetShown } from "../scene/model.ts";
import type { SceneView } from "../scene/view.ts";
import { TitleModel } from "../title/model.ts";

/**
 * Which screen is up (v1-design §3.10): the title, character creation's six, or the game, from the
 * rows the client holds and what the player last asked for (`Intent`, the client's own): screenOf,
 * pure and tested. The AppModel below keeps the intent and asks it whenever the rows change.
 */

/**
 * What the player last asked for: the title; a new character (the create screen, until its concept
 * goes in: a character made before, or half made, isn't this one); the character the creation row
 * is making; the game their seat is in.
 */
export type Intent = "title" | "new" | "creation" | "game";

export type Screen = "title" | "create" | "creating" | "choose" | "custom" | "backstory" | "created" | "scene";

/** What the title says when the game the player was in has gone from the server. */
export const GONE = "(The game's server no longer has that game: carry on another, or start a new one.)";

/** What the screen depends on, of the rows. */
export interface ScreenRows {
  /** my_creation: where the character being made is, what the GM is working on, and whether the builds and the chosen one have come. */
  creation?: { step: string; busy?: string | undefined; offer?: string | undefined; chosen?: string | undefined };
  /** my_seat: the game they're in, and its scene once it has begun. */
  seat?: { gameId: bigint; sceneId?: bigint | undefined };
  /** The seat's sheet is in, with what the engine made: the created screen has something to show. */
  sheet: boolean;
  /** The seat's scene's rows are in: the scene screen has something to draw. */
  scene: boolean;
}

/** What the creating screen waits through: the three builds measured, the GM picking one, the character written into the story. */
export const CREATING_BUSY: readonly string[] = ["builds", "pick", "traits"];

export function screenOf(rows: ScreenRows, intent: Intent): Screen {
  switch (intent) {
    case "title": return "title";
    case "new": return "create";
    case "creation": return creationScreen(rows.creation);
    case "game": return gameScreen(rows);
  }
}

/**
 * The character being made: the create screen until there's a concept to work from (and again when
 * what the GM was asked for didn't come: the row's note says why there, as the prototype's error did);
 * the creating screen while the GM measures, picks or writes; else the row's step.
 */
function creationScreen(c: ScreenRows["creation"]): Screen {
  if (!c) return "create";
  if (c.busy && CREATING_BUSY.includes(c.busy)) return "creating";
  switch (c.step) {
    case "choose": return c.offer ? "choose" : "create";
    case "custom": return "custom";
    case "backstory": return c.chosen ? "backstory" : "create";
    default: return "create";
  }
}

/** The game: its scene once it has begun and its rows are in; before, the sheet the engine made (or the creating screen while it comes). */
function gameScreen(rows: ScreenRows): Screen {
  if (!rows.seat) return "title";
  if (rows.seat.sceneId !== undefined && rows.scene) return "scene";
  return rows.sheet ? "created" : "creating";
}

// ---------------------------------------------------------------------------------------------
// The app: the intent, the rows, and the screens' models over them.

/** What the title's and creation's models need of the app: the rows, the screen and the intent, the moves, a redraw, and leaving. */
export interface AppPart {
  readonly rows: HomeRows;
  readonly screen: Screen;
  readonly intent: Intent;
  /** The campaign a new character's game is in (the client's --campaign): caerwyn. */
  readonly campaign: string;
  /** Something that went wrong in the client itself, until the next move: the title's and creation's error line says it. */
  readonly problem: string | undefined;
  /** The last move's refusal, on the screen it was made on: the title's and creation's error line (a scene's is its status line). */
  readonly refusal: string | undefined;
  go(intent: Intent): void;
  act: Backend["act"];
  subscribe(listener: () => void): () => void;
  emit(): void;
  quit(): void;
}

/**
 * The whole client (the prototype's Game, as far as the screens go): which screen is up, from the
 * rows and the intent; the title's, creation's and the scene's models; and the scene's view kept up
 * to date. It holds no React: the App subscribes, and draws the screen it names.
 */
export class AppModel implements AppPart {
  intent: Intent;
  rows: HomeRows;
  readonly campaign: string;
  readonly title: TitleModel;
  readonly creation: CreationModel;
  /** The scene, once the seat's game has one: a new model for each game, so nothing of the last one's stays open. */
  scene?: SceneModel;
  /** The player asked to leave: the host takes the screen down. */
  quitting = false;
  problem: string | undefined;

  private readonly backend: Backend;
  private readonly onQuit: () => void;
  private readonly listeners = new Set<() => void>();
  private shown: Screen;
  /** The creation's step at the last change: one that turns made takes the player on to its sheet. */
  private stepWas: string | undefined;
  /** The screen the last refusal came on (none once the player has gone to another): a line refused in a scene isn't the title's to say after /quit, nor a name refused on the create screen New game's next time. */
  private refusedOn?: { words: string; screen?: Screen };

  constructor(backend: Backend, options: { campaign: string; intent?: Intent; onQuit?: () => void; saveMs?: number }) {
    this.backend = backend;
    this.campaign = options.campaign;
    this.intent = options.intent ?? "title";
    this.onQuit = options.onQuit ?? (() => {});
    this.rows = backend.home();
    this.title = new TitleModel(this);
    this.creation = new CreationModel(this, options.saveMs !== undefined ? { saveMs: options.saveMs } : {});
    this.stepWas = this.rows.creation?.step;
    const view = backend.view();
    this.followScene(view);
    this.shown = this.screenNow(view);
    this.noteRefusal();
    backend.onChange(() => this.update());
  }

  get screen(): Screen { return this.shown; }

  get refusal(): string | undefined {
    return this.refusedOn?.screen === this.shown ? this.refusedOn.words : undefined;
  }

  /** A move: what went wrong before it, and the last refusal, are behind it (a refusal of this one is new, whatever its words). */
  act: Backend["act"] = (move, args) => {
    this.problem = undefined;
    this.refusedOn = undefined;
    return this.backend.act(move, args);
  };

  /** Something went wrong in the client itself: said on the scene's status line, or on the title's or creation's error line. */
  trouble(words: string): void {
    if (this.shown === "scene" && this.scene) { this.scene.status = words; this.scene.emit(); return; }
    this.problem = words;
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }

  go(intent: Intent): void {
    this.intent = intent;
    this.problem = undefined;
    this.shown = this.screenNow(this.backend.view());
    this.leaveRefusal();
    this.emit();
  }

  quit(): void {
    this.quitting = true;
    this.onQuit();
  }

  /**
   * The rows changed: the screens' models read them afresh, a character just made goes on to its
   * sheet, and the scene follows. A game whose seat goes from under the player (deleted by its host,
   * or the server started again with no data) falls back to the title, which says why.
   */
  private update(): void {
    this.rows = this.backend.home();
    const view = this.backend.view();
    const was = this.shown;
    this.noteRefusal();
    this.onToTheSheet();
    this.followScene(view);
    this.shown = this.screenNow(view);
    if (this.intent === "game" && was !== "title" && this.shown === "title") this.problem = GONE;
    this.emit();
  }

  /** The player went elsewhere: the last refusal was said where it came, and isn't said again (its words stay the rows' until the next move, so it isn't new). */
  private leaveRefusal(): void {
    if (this.refusedOn) this.refusedOn = { words: this.refusedOn.words };
  }

  /** A refusal that's new: said on the screen it came on (a refused move changes no rows, so the screen hasn't moved). */
  private noteRefusal(): void {
    const words = this.rows.refusal;
    if (!words) this.refusedOn = undefined;
    else if (words !== this.refusedOn?.words) this.refusedOn = { words, screen: this.shown };
  }

  /** The character being made is made: the game it made is the seat's now, and its sheet comes up. */
  private onToTheSheet(): void {
    const step = this.rows.creation?.step;
    if (this.intent === "creation" && step === "made" && this.stepWas !== "made") this.intent = "game";
    this.stepWas = step;
  }

  /** The scene's model, fed the seat's scene as it changes; a new one for another game. */
  private followScene(view: SceneView | undefined): void {
    if (!view) return;
    if (this.scene?.view.game === view.game) { this.scene.update(view); return; }
    this.scene = new SceneModel(view, {
      say: text => void this.backend.say(text),
      retry: () => void this.backend.retry(),
      quit: () => this.go("title"),
    }, () => this.sheetShown());
  }

  /** The seat's sheet for /sheet: none while the engine hasn't made one (a spectator's seat has none of its own). */
  private sheetShown(): SheetShown | undefined {
    const data = this.creation.sheet;
    return data ? { data, who: this.creation.who } : undefined;
  }

  private screenNow(view: SceneView | undefined): Screen {
    const { creation, seat, sheet } = this.rows;
    return screenOf({ ...(creation ? { creation } : {}), ...(seat ? { seat } : {}), sheet: !!sheet?.data, scene: !!view }, this.intent);
  }
}
