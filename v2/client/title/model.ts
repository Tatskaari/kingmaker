// The prototype's src/app/game.ts:469-492 at 44c6d4a (loadSaves, deleteSave, newCharacter) and src/app/ui/title.tsx:24-38 (ago, describe), as a model over my_games: saves are rows, resume is continue_game, deleteSave is delete_game; the zoo goes (V19).
import type { AppPart } from "../app/model.ts";
import type { GameRow } from "../backend.ts";
import { timeWords } from "../creation/words.ts";

/**
 * The title screen's model (v1-design §3.10): the player's games, most recent first, to carry on
 * or delete; a new character; quitting. Its names are the prototype's Game's, so the title screen
 * reads as it did.
 */
export class TitleModel {
  private readonly app: AppPart;

  constructor(app: AppPart) {
    this.app = app;
  }

  subscribe(listener: () => void): () => void {
    return this.app.subscribe(listener);
  }

  get screen(): string { return this.app.screen; }

  /** The player's games (my_games), the one played last first. */
  get saves(): GameRow[] {
    return [...this.app.rows.games].sort((a, b) => Number(b.lastPlayedAt.microsSinceUnixEpoch - a.lastPlayedAt.microsSinceUnixEpoch));
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
