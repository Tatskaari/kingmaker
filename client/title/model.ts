// The prototype's src/app/game.ts:469-492 at 44c6d4a (loadSaves, deleteSave, newCharacter) and src/app/ui/title.tsx:24-38 (ago, describe), as a model over my_games: saves are rows, resume is continue_game, deleteSave is delete_game. The zoo is v2's own (M6: the prototype's Game.zoo carried a visit on; here a visit opens an exhibit afresh, its exhibits and builds from the installed zoo's row: client/zoo/zoo.ts), with its sound board (client/sound/board.ts: every sound, by kind).
import type { AppPart } from "../app/model.ts";
import type { GameRow } from "../backend.ts";
import { timeWords } from "../creation/words.ts";
import { leaveBoard } from "../sound/board.ts";
import { soundOn } from "../sound/cues.ts";
import { isVisit, visit, zooOf, type VisitWith, type Zoo } from "../zoo/zoo.ts";

/**
 * The zoo's menu on the title (z): its exhibits; then, an exhibit picked, who to be. Or its sound
 * board: the kinds of sound, then a kind's sounds, each played as it's chosen.
 */
export type ZooMenu = { step: "exhibits" } | { step: "builds"; exhibit: string } | { step: "sounds" } | { step: "sound"; kind: string };

/** What the sound board says where nothing plays it: a terminal (the sound is the page's), the headless client. */
export const NO_SOUND = "(There's no sound here: it plays on the game's page, from the first key or click.)";

/** What the title says when the server hasn't the zoo installed. */
export const NO_ZOO = "(The zoo isn't installed on this server: the dev stack installs it as it starts.)";

/**
 * The title screen's model (v1-design §3.10): the player's games, most recent first, to carry on
 * or delete; a new character; quitting. Its names are the prototype's Game's, so the title screen
 * reads as it did.
 */
export class TitleModel {
  /** The zoo's menu, while it's open over the title's own. */
  zooMenu: ZooMenu | undefined;
  /** Something the zoo's menu has to say (not installed, a visit refused): until it's closed or used again. */
  zooNote: string | undefined;
  private readonly app: AppPart;

  constructor(app: AppPart) {
    this.app = app;
  }

  subscribe(listener: () => void): () => void {
    return this.app.subscribe(listener);
  }

  /** The app's count of changes, which its screens draw by (useStore). */
  get version(): number { return this.app.version; }

  get screen(): string { return this.app.screen; }

  /** The player's games (my_games), the one played last first: the story's, a zoo visit kept apart. */
  get saves(): GameRow[] {
    return [...this.app.rows.games].filter(g => !isVisit(g)).sort((a, b) => Number(b.lastPlayedAt.microsSinceUnixEpoch - a.lastPlayedAt.microsSinceUnixEpoch));
  }

  /** The zoo, as installed on the server: its exhibits and who a visitor can be (none when it isn't). */
  get zoo(): Zoo | undefined { return zooOf(this.app.rows); }

  /** The zoo's menu opened over the title's (z): its exhibits. */
  openZoo(): void {
    this.zooMenu = { step: "exhibits" };
    this.zooNote = this.zoo ? undefined : NO_ZOO;
    this.app.emit();
  }

  /** An exhibit picked: who to be next. */
  pickExhibit(exhibit: string): void {
    this.zooMenu = { step: "builds", exhibit };
    this.zooNote = undefined;
    this.app.emit();
  }

  /** The sound board, from the zoo's menu: its kinds of sound. */
  openSounds(): void {
    this.zooMenu = { step: "sounds" };
    this.zooNote = soundOn() ? undefined : NO_SOUND;
    this.app.emit();
  }

  /** A kind of sound picked on the board: its sounds. */
  pickSounds(kind: string): void {
    this.zooMenu = { step: "sound", kind };
    this.app.emit();
  }

  /** Back a step in the zoo's menu: from who to be to the exhibits, from a kind of sound to the board's kinds, from the board to the exhibits (its music let go), from the exhibits to the title. */
  zooBack(): void {
    const step = this.zooMenu?.step;
    if (step === "sounds") leaveBoard();
    this.zooMenu = step === "builds" || step === "sounds" ? { step: "exhibits" } : step === "sound" ? { step: "sounds" } : undefined;
    this.zooNote = step === "sound" && !soundOn() ? NO_SOUND : undefined;
    this.app.emit();
  }

  /** A visit to the zoo, opening an exhibit as one of its builds (a visit before goes): the game's screen, once it's made; else why not, on the menu. */
  async visit(how: VisitWith): Promise<boolean> {
    const refused = await visit(this.app, how);
    if (refused) {
      this.zooNote = refused.text;
      this.app.emit();
      return false;
    }
    this.zooMenu = undefined;
    this.zooNote = undefined;
    this.app.go("game");
    return true;
  }

  /** Why the last move on the title wasn't made (a game deleted elsewhere, say), in the game's words; or what went wrong in the client. */
  get error(): string | undefined { return this.app.refusal ?? this.app.problem; }

  /** New game: a name and a concept to start with. */
  newCharacter(): void {
    this.app.go("new");
  }

  /** Carry on with a game: the seat moves to it, and its sheet or its scene comes up. */
  async resume(save: GameRow): Promise<void> {
    const refused = await this.app.act("continueGame", { game: save.gameId });
    if (!refused) this.app.go("game");
  }

  /** Off the title's list for good: the game's every row goes. */
  deleteSave(save: GameRow): void {
    void this.app.act("deleteGame", { game: save.gameId });
  }

  quit(): void {
    this.app.quit();
  }

  /** Report a problem with the latest game played (M5: b, or the title's line). */
  report(): void {
    this.app.askReport("the title");
  }
}

/** How long ago, in a few words: "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(ms: number, now: number = Date.now()): string {
  const minutes = Math.round((now - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** A game as the title lists it: "Tamsin Vell: Morning, in The Hanged Clerk (just now)". */
export function describe(save: Pick<GameRow, "name" | "time" | "where" | "lastPlayedAt">, now: number = Date.now()): string {
  return `${save.name}: ${timeWords(save.time).split(",")[0]}, ${save.where} (${ago(Number(save.lastPlayedAt.toMillis()), now)})`;
}
